import { h, button, selectInput, section, badge, table } from '../dom';
import { store } from '../../state/store';
import { workerClient } from '../../workers/client';
import { BAND_CENTERS } from '../../core/acoustics/bands';
import type { AnalysisSnapshot, Layout, Library, Project } from '../../core/types';

interface CompareMetrics {
  rt60Mid: number;
  splAvg: number;
  splMin: number;
  splMax: number;
  uniformity: number;
  headroomMin: number;
  feedbackWorst: number;
  echoRatio: number;
  totalWeight: number;
  totalPower: number;
}

function metricsOf(s: AnalysisSnapshot): CompareMetrics {
  const dba = Array.from(s.splGrid.dba).filter((v) => v > -900);
  const rt60Mid = (s.rt60.sabine[3] + s.rt60.sabine[4]) / 2;
  const headroomMin = s.seats.length ? Math.min(...s.seats.map((x) => x.headroom)) : 0;
  const feedbackWorst = s.feedback.length ? Math.min(...s.feedback.flatMap((f) => f.worst.map((w) => w.marginDb))) : 99;
  const echoRatio = s.echoMap.points.length ? s.echoMap.points.filter((p) => p.echo).length / s.echoMap.points.length : 0;
  return {
    rt60Mid,
    splAvg: dba.length ? dba.reduce((a, b) => a + b, 0) / dba.length : 0,
    splMin: dba.length ? Math.min(...dba) : 0,
    splMax: dba.length ? Math.max(...dba) : 0,
    uniformity: dba.length ? Math.max(...dba) - Math.min(...dba) : 0,
    headroomMin,
    feedbackWorst,
    echoRatio,
    totalWeight: s.bom.totalWeightKg,
    totalPower: s.bom.totalPowerW
  };
}

/** 方案并排对比：选择两套方案 → 各自跑 Worker 分析 → 对照表，差异超阈值格子描红 */
export function renderCompareView(project: Project, layouts: Layout[], _library: Library): HTMLElement {
  let idA: string = store.state.compareIds[0] ?? layouts[0]?.id ?? '';
  let idB: string = store.state.compareIds[1] ?? layouts[1]?.id ?? '';
  let snapA: AnalysisSnapshot | null = store.state.snapshots[idA] ?? null;
  let snapB: AnalysisSnapshot | null = store.state.snapshots[idB] ?? null;
  const wrap = h('div', {});

  const DIFF_THRESHOLDS: Record<keyof CompareMetrics, number> = {
    rt60Mid: 0.15, splAvg: 2, splMin: 3, splMax: 3, uniformity: 2,
    headroomMin: 3, feedbackWorst: 3, echoRatio: 0.1, totalWeight: 20, totalPower: 200
  };

  const runBoth = async () => {
    const la = layouts.find((l) => l.id === idA)!;
    const lb = layouts.find((l) => l.id === idB)!;
    store.setBusy(true, '对比分析 A…', 20);
    const [a, b] = await Promise.all([
      workerClient.runAnalysis(project, la, store.state.library, { echoDelayMs: 50, echoLevelDb: 15, gridSpacing: 2 }, (p) => store.setBusy(true, `方案A · ${p.phase}`, p.percent / 2)),
      workerClient.runAnalysis(project, lb, store.state.library, { echoDelayMs: 50, echoLevelDb: 15, gridSpacing: 2 }, (p) => store.setBusy(true, `方案B · ${p.phase}`, 50 + p.percent / 2))
    ]);
    snapA = a; snapB = b;
    store.update((s) => { s.snapshots[a.layoutId] = a; s.snapshots[b.layoutId] = b; });
    store.setBusy(false);
    render();
  };

  function render() {
    const nameA = layouts.find((l) => l.id === idA)?.name ?? '—';
    const nameB = layouts.find((l) => l.id === idB)?.name ?? '—';
    let tableEl: HTMLElement;
    if (snapA && snapB && idA !== idB) {
      const ma = metricsOf(snapA), mb = metricsOf(snapB);
      const rowsDef: { key: keyof CompareMetrics; label: string; unit: string; fmt: (v: number) => string; lowerBetter?: boolean }[] = [
        { key: 'rt60Mid', label: '中频混响 RT60', unit: 's', fmt: (v) => v.toFixed(2) },
        { key: 'splAvg', label: '平均声压级', unit: 'dBA', fmt: (v) => v.toFixed(1) },
        { key: 'splMin', label: '最小声压级', unit: 'dBA', fmt: (v) => v.toFixed(1) },
        { key: 'splMax', label: '最大声压级', unit: 'dBA', fmt: (v) => v.toFixed(1) },
        { key: 'uniformity', label: '声场不均匀度', unit: 'dB', fmt: (v) => v.toFixed(1), lowerBetter: true },
        { key: 'headroomMin', label: '最小动态余量', unit: 'dB', fmt: (v) => v.toFixed(1) },
        { key: 'feedbackWorst', label: '最差啸叫余量', unit: 'dB', fmt: (v) => v.toFixed(1) },
        { key: 'echoRatio', label: '回声座位占比', unit: '', fmt: (v) => `${(v * 100).toFixed(0)}%`, lowerBetter: true },
        { key: 'totalWeight', label: '吊挂/设备总重', unit: 'kg', fmt: (v) => v.toFixed(0), lowerBetter: true },
        { key: 'totalPower', label: '估算总功耗', unit: 'W', fmt: (v) => v.toFixed(0), lowerBetter: true }
      ];
      tableEl = table(['对照指标', `${nameA} (A)`, `${nameB} (B)`, '差值 B-A', '判定'],
        rowsDef.map((r) => {
          const va = ma[r.key], vb = mb[r.key];
          const diff = vb - va;
          const hot = Math.abs(diff) > DIFF_THRESHOLDS[r.key];
          const winner = r.lowerBetter ? (vb < va ? 'B 优' : va < vb ? 'A 优' : '持平')
            : r.key === 'feedbackWorst' || r.key === 'headroomMin'
              ? (vb > va ? 'B 优' : va > vb ? 'A 优' : '持平')
              : '—';
          return [
            `${r.label} ${r.unit ? `(${r.unit})` : ''}`,
            r.fmt(va), r.fmt(vb),
            h('span', { class: hot ? 'diff-hot' : '', style: { padding: '2px 6px', borderRadius: '4px', display: 'inline-block' } }, (diff >= 0 ? '+' : '') + diff.toFixed(2)),
            hot ? badge(winner === '持平' ? '差异显著' : winner, 'warn') : badge(winner, winner === '持平' ? 'info' : 'ok')
          ];
        }),
        { cellClass: (r, c) => (c === 3 && Math.abs((metricsOf(snapB!)[rowsDef[r].key] - metricsOf(snapA!)[rowsDef[r].key])) > DIFF_THRESHOLDS[rowsDef[r].key]) ? 'diff-hot' : undefined }
      );
    } else {
      tableEl = h('p', { class: 'muted' }, idA === idB ? '请选择两套不同的布置方案。' : '选择方案后点击「运行对比分析」。');
    }

    // 逐测点 RT60/SPL/余量对照（采样点按索引配对）
    const seatTable: HTMLElement[] = [];
    if (snapA && snapB) {
      const n = Math.min(snapA.seats.length, snapB.seats.length, 12);
      seatTable.push(section('测点级对照（前 12 个采样点，差值>2dB 自动标红）',
        table(['#', 'RT60 A/B (s)', 'SPL A (dBA)', 'SPL B (dBA)', '余量 A (dB)', '余量 B (dB)'],
          Array.from({ length: n }, (_, i) => {
            const a = snapA!.seats[i], b = snapB!.seats[i];
            const splDiff = Math.abs(b.splDBA - a.splDBA);
            const hrDiff = Math.abs(b.headroom - a.headroom);
            return [
              String(i + 1),
              `${snapA!.rt60.sabine[4].toFixed(2)} / ${snapB!.rt60.sabine[4].toFixed(2)}`,
              h('span', { class: splDiff > 2 ? 'diff-hot' : '', style: { padding: '2px 6px', borderRadius: '4px' } }, a.splDBA.toFixed(1)),
              h('span', { class: splDiff > 2 ? 'diff-hot' : '', style: { padding: '2px 6px', borderRadius: '4px' } }, b.splDBA.toFixed(1)),
              h('span', { class: hrDiff > 2 ? 'diff-hot' : '', style: { padding: '2px 6px', borderRadius: '4px' } }, a.headroom.toFixed(1)),
              h('span', { class: hrDiff > 2 ? 'diff-hot' : '', style: { padding: '2px 6px', borderRadius: '4px' } }, b.headroom.toFixed(1))
            ];
          })
        )
      ));
    }

    wrap.replaceChildren(
      section('选择对比方案（同一场地可挂多套布置）',
        h('div', { class: 'field-row' },
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, '方案 A'),
            selectInput(layouts.map((l) => ({ value: l.id, label: l.name })), idA, (v) => { idA = v; snapA = store.state.snapshots[v] ?? null; render(); })),
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, '方案 B'),
            selectInput(layouts.map((l) => ({ value: l.id, label: l.name })), idB, (v) => { idB = v; snapB = store.state.snapshots[v] ?? null; render(); }))
        ),
        h('div', { class: 'toolbar' },
          button('运行对比分析（双 Worker 并行）', runBoth, 'primary'),
          h('span', { class: 'muted' }, `当前：${nameA}  vs  ${nameB}`)
        )
      ),
      section('核心指标对照表（超过阈值的差值格自动描红）', tableEl),
      ...seatTable,
      ...(() => {
        const a = snapA, b = snapB;
        return a && b ? [section('倍频程 RT60 对照',
          table(['频带 Hz', ...BAND_CENTERS.map(String)], [
            ['A 赛宾', ...a.rt60.sabine.map((v) => v.toFixed(2))],
            ['B 赛宾', ...b.rt60.sabine.map((v) => v.toFixed(2))],
            ['差值', ...b.rt60.sabine.map((v, i) => {
              const d = v - a.rt60.sabine[i];
              return h('span', { class: Math.abs(d) > 0.2 ? 'diff-hot' : '', style: { padding: '1px 5px', borderRadius: '4px' } }, d.toFixed(2));
            })]
          ])
        )] : [];
      })()
    );
  }
  render();
  return wrap;
}
