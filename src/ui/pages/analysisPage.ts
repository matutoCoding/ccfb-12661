import { BAND_FREQS, type Project, type Vec3 } from '../../core/types';
import { store } from '../../state/store';
import { buildSnapshot, audienceSeatGrid } from '../../core/factory';
import { AcousticsClient, isCancelled } from '../../workers/client';
import { sabineRT60, roomFaces } from '../../core/roomAcoustics';
import { traceReflections, detectEchoes } from '../../core/reflection';
import { analyzeFeedback } from '../../core/feedback';
import { expandSpeakers } from '../../core/speakers';
import { analyzeMeasurePoints, analyzePoint, type SplGrid } from '../../core/analysis';
import { buildIrSpec, synthesizeImpulseResponse, seatFrequencyResponse, estimateRt60FromIr } from '../../core/auralization';
import { h, clear, toast, drawLineChart, drawBarChart, fmt } from '../dom';
import { View3D } from '../../webgl/View3D';
import { heatColor, type HeatGrid } from '../../webgl/SceneRenderer';
import { AudioEngine } from '../../audio/AudioEngine';
import { router } from '../router';
import type { ReflectionSeatOutput } from '../../workers/protocol';

type Mode = 'heat' | 'reflection' | 'feedback';

export function renderAnalysisPage(
  host: HTMLElement,
  _router: typeof router,
  project: Project,
  layoutId: string,
  compareLayoutId?: string,
): void {
  if (!project.venueId) return;
  const venue = store.getVenue(project.venueId)!;
  const layout = store.getLayout(layoutId)!;
  const client = new AcousticsClient();
  let mode: Mode = 'heat';
  let reflectionOrder: 1 | 2 = 1;
  let heat: HeatGrid | null = null;
  let heatStats: SplGrid | null = null;
  let reflectionSeats: ReflectionSeatOutput[] = [];
  let selectedSeat: Vec3 | null = null;
  let progress = 0;
  let busy = false;
  let audio: AudioEngine | null = null;

  const sidebar = h('div', { class: 'sidebar wide' });
  const content = h('div', { class: 'content' });
  host.append(sidebar, content);

  const canvas = h('canvas') as HTMLCanvasElement;
  const viewport = h('div', { class: 'viewport' }, [canvas]);
  const legend = h('div', { class: 'overlay-legend' });
  const hud = h('div', { class: 'overlay-hud' });
  viewport.append(legend, hud);
  content.append(viewport);
  const view = new View3D(canvas);
  view.setData(venue, layout, store.listSpeakerModels(), store.listMaterials());

  const snapshot = () => buildSnapshot(store.state, venue, store.getLayout(layoutId)!);
  const seats = audienceSeatGrid(venue, 1.6);

  function renderSidebar() {
    clear(sidebar);
    sidebar.append(
      h('div', { class: 'panel' }, [
        h('h3', { text: '分析模式（Worker 计算）' }),
        h('div', { class: 'pill-row' }, [
          modeButton('heat', 'SPL 热力图'),
          modeButton('reflection', '反射声线/回声'),
          modeButton('feedback', '啸叫余量'),
        ]),
        h('button', {
          class: 'btn',
          style: 'width:100%;margin:8px 0',
          text: busy ? '计算中…' : '↻ 重新计算（拖动设备后点击）',
          disabled: busy ? '' : null,
          onclick: () => void runAnalysis(),
        }),
        h('div', { class: 'muted', style: 'font-size:12px' }, [
          client.usingWorker ? '计算运行于 Web Worker，界面保持可交互。' : 'Worker 不可用，已降级主线程计算。',
          h('br'),
          `网格座位 ${seats.length} 个，新请求会自动取消未完成的旧请求。`,
        ]),
        busy ? h('div', { class: 'progress-bar', style: 'margin-top:10px' }, [h('div', { style: `width:${progress * 100}%` })]) : null,
      ]),
      modeControls(),
    );
    if (selectedSeat) seatPanel(selectedSeat);
    if (mode === 'feedback') feedbackPanel();
  }

  function modeButton(key: Mode, label: string) {
    return h('button', {
      class: key === mode ? 'active' : '',
      text: label,
      onclick: () => {
        mode = key;
        selectedSeat = null;
        renderSidebar();
        void runAnalysis();
      },
    });
  }

  function modeControls() {
    if (mode === 'reflection') {
      return h('div', { class: 'panel' }, [
        h('h3', { text: '反射阶数' }),
        h('div', { class: 'pill-row' }, [
          h('button', { class: reflectionOrder === 1 ? 'active' : '', text: '一阶', onclick: () => { reflectionOrder = 1; void runAnalysis(); } }),
          h('button', { class: reflectionOrder === 2 ? 'active' : '', text: '一阶+二阶', onclick: () => { reflectionOrder = 2; void runAnalysis(); } }),
        ]),
        h('div', { class: 'muted', style: 'font-size:12px' }, [
          '黄色=一阶反射，橙色=二阶，红色线=超过回声判据（Δt>50ms 且 ΔL>-10dB）的危险反射。',
        ]),
      ]);
    }
    if (mode === 'heat') {
      return h('div', { class: 'panel' }, [
        h('h3', { text: '热力图统计' }),
        heatStats
          ? h('div', {}, [
              statGrid([
                [fmt(heatStats.average, 1), '平均 SPL dB'],
                [fmt(heatStats.max, 1), '最大 dB'],
                [fmt(heatStats.min, 1), '最小 dB'],
                [fmt(heatStats.uniformityDb, 1), '不均匀度 dB'],
              ]),
              h('div', { class: 'muted', style: 'font-size:12px;margin-top:8px' }, [
                '蓝→红表示声压级由低到高，不均匀度建议控制在 6~10dB 内。',
              ]),
            ])
          : h('div', { class: 'muted', text: '计算中…' }),
      ]);
    }
    return h('div', { class: 'panel' }, [
      h('h3', { text: '啸叫分析说明' }),
      h('div', { class: 'muted', style: 'font-size:12px;line-height:1.7' }, [
        '闭合回路：话筒→处理链→音箱→房间→话筒。',
        h('br'),
        '余量 = 回路距离自激还差的 dB；负值即满足啸叫幅值条件。',
        h('br'),
        '在三维视图中拖动话筒/音箱位置后余量自动重算。',
      ]),
    ]);
  }

  async function runAnalysis() {
    busy = true;
    progress = 0;
    renderSidebar();
    try {
      const snap = snapshot();
      if (mode === 'heat') {
        const res = await client.grid(snap, seats);
        const g = res.grid;
        heatStats = g;
        const span = Math.max(1e-6, g.max - g.min);
        heat = {
          positions: g.positions,
          values: g.values.map((v) => (v - g.min) / span),
          cellMeters: 1.6,
        };
        legend.replaceChildren(
          ...[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const c = heatColor(t);
            return h('div', { style: `display:flex;align-items:center;gap:6px;margin:2px 0` }, [
              h('span', { style: `width:14px;height:14px;background:rgb(${c.map((x) => x * 255).join(',')});border-radius:3px;display:inline-block` }),
              h('span', { text: fmt(g.min + t * span, 0) + ' dB' }),
            ]);
          }),
        );
      } else if (mode === 'reflection') {
        const res = await client.reflections(snap, seats, reflectionOrder, (done, total) => {
          progress = done / total;
          const bar = sidebar.querySelector('.progress-bar > div') as HTMLElement | null;
          if (bar) bar.style.width = `${progress * 100}%`;
        });
        reflectionSeats = res.seats;
        legend.replaceChildren(h('div', { text: `已分析 ${res.seats.length} 个座位的 ${reflectionOrder} 阶声线` }));
      } else {
        const l = store.getLayout(layoutId)!;
        if (l.microphones.length === 0) {
          reflectionSeats = [];
          toast('请先在布置页添加话筒');
        } else {
          const res = await client.feedback(snap, l.microphones, 0);
          renderFeedbackHud(res.results);
        }
      }
      updateView();
    } catch (err) {
      if (!isCancelled(err)) toast('计算失败：' + (err as Error).message);
    } finally {
      busy = false;
      renderSidebar();
    }
  }

  function updateView() {
    const l = store.getLayout(layoutId)!;
    view.setData(venue, l, store.listSpeakerModels(), store.listMaterials());
    view.setOptions({
      showRoom: true,
      showAudience: true,
      showSpeakers: true,
      showMicrophones: mode === 'feedback',
      heat: mode === 'heat' ? heat : null,
      reflections: mode === 'reflection' ? reflectionSeats : [],
      reflectionOrder,
      onPick: (_kind, _id, point) => {
        if (point) {
          selectedSeat = point;
          renderSidebar();
        }
      },
    });
  }

  function feedbackPanel() {
    const l = store.getLayout(layoutId)!;
    const mats = new Map(store.listMaterials().map((m) => [m.id, m]));
    const speakers = expandSpeakers(l.speakers, l.lineArrays, new Map(store.listSpeakerModels().map((m) => [m.id, m])));
    const panel = h('div', { class: 'panel' }, [h('h3', { text: '逐话筒啸叫余量' })]);
    for (const mic of l.microphones) {
      const r = analyzeFeedback(mic, speakers);
      const chart = h('canvas', { class: 'chart-canvas', style: 'height:150px' }) as HTMLCanvasElement;
      panel.append(
        h('div', { class: 'list-item' }, [
          h('div', { style: 'display:flex;justify-content:space-between' }, [
            h('strong', { text: mic.name }),
            h('span', {
              class: `badge ${r.minMarginDb < 6 ? 'danger' : r.minMarginDb < 12 ? 'warn' : 'ok'}`,
              text: `最小余量 ${fmt(r.minMarginDb, 1)} dB`,
            }),
          ]),
          h('div', { class: 'muted', style: 'font-size:12px;margin:4px 0' }, [
            `易啸频率：${r.worstFreqs.join(' / ')} Hz · 可用增益 ${fmt(r.availableGainDb, 1)} dB · 传声增益 ${fmt(r.transmissionGainDb, 1)} dB`,
          ]),
          chart,
        ]),
      );
      requestAnimationFrame(() =>
        drawLineChart(
          chart,
          [
            {
              label: '啸叫余量 dB',
              color: '#4f9cf9',
              points: r.bands.map((b) => ({ x: b.freq, y: b.marginDb })),
            },
          ],
          { xLog: true, markers: r.worstFreqs.map((f) => ({ x: f, label: `${f}Hz`, color: '#ef5b5b' })) },
        ),
      );
    }
    void mats;
    sidebar.append(panel);
  }

  function renderFeedbackHud(results: ReturnType<typeof analyzeFeedback>[]) {
    clear(hud);
    if (!results.length) return;
    const worst = results.reduce((a, b) => (a.minMarginDb < b.minMarginDb ? a : b));
    hud.append(
      h('div', { style: 'font-weight:600;margin-bottom:6px' }, [
        `最危险话筒：${worst.micId}`,
      ]),
      h('div', { style: 'color:var(--warn)' }, [
        `最小啸叫余量 ${fmt(worst.minMarginDb, 1)} dB @ ${worst.worstFreqs.join('/')}Hz`,
      ]),
    );
  }

  function seatPanel(seat: Vec3) {
    const l = store.getLayout(layoutId)!;
    const mats = new Map(store.listMaterials().map((m) => [m.id, m]));
    const speakerModels = new Map(store.listSpeakerModels().map((m) => [m.id, m]));
    const speakers = expandSpeakers(l.speakers, l.lineArrays, speakerModels);
    const pointResult = analyzePoint(seat, speakers);
    const rt60 = sabineRT60(venue.room, mats);
    // 该座位反射（即时计算，单点开销小）
    const allPaths = [];
    for (const sp of speakers) {
      const r = traceReflections(sp, seat, roomFaces(venue.room), mats, reflectionOrder);
      allPaths.push(r);
    }
    const merged = {
      directLength: allPaths[0]?.directLength ?? 1,
      directLevelByBand: allPaths[0]?.directLevelByBand ?? ({} as never),
      paths: allPaths.flatMap((r) => r.paths),
    };
    const echoes = detectEchoes(merged, seat);

    const irSpec = buildIrSpec(seat, speakers, merged, rt60, 48000);
    const ir = synthesizeImpulseResponse(irSpec, 99);
    const curve = seatFrequencyResponse(ir, 48000);
    const rtCheck = estimateRt60FromIr(ir, 48000);

    const freqCanvas = h('canvas', { class: 'chart-canvas', style: 'height:170px' }) as HTMLCanvasElement;
    const rtCanvas = h('canvas', { class: 'chart-canvas', style: 'height:150px' }) as HTMLCanvasElement;
    const panel = h('div', { class: 'panel' }, [
      h('h3', { text: `座位响应 (${fmt(seat.x, 1)}, ${fmt(seat.y, 1)}, ${fmt(seat.z, 1)})` }),
      h('div', { class: 'grid-2' }, [
        h('div', {}, [
          h('div', { class: 'muted', style: 'font-size:11px' }, [
            `总 SPL ${fmt(pointResult.splTotal, 1)} dB · D/R ${fmt(pointResult.directToReverbDb, 1)} dB`,
          ]),
          freqCanvas,
        ]),
        h('div', {}, [
          h('div', { class: 'muted', style: 'font-size:11px' }, ['IR 反推 RT60 vs 赛宾']),
          rtCanvas,
        ]),
      ]),
      h('div', { class: 'muted', style: 'font-size:11.5px;margin-top:6px' }, [
        `赛宾中频 RT60 ${fmt((rt60[500] + rt60[1000]) / 2, 2)}s · IR 反推 ${fmt((rtCheck[500] + rtCheck[1000]) / 2, 2)}s`,
      ]),
      h('h3', { text: '回声风险', style: 'margin-top:10px' }),
      echoes.risks.length
        ? h('div', {}, echoes.risks.slice(0, 5).map((r) =>
            h('div', { style: 'color:var(--danger);font-size:12px' }, [
              `⚠ ${r.faceLabel}：延时 ${fmt(r.delayMs, 0)}ms，相对级差 ${fmt(r.midRelLevelDb, 1)}dB`,
            ]),
          ))
        : h('div', { class: 'badge ok', text: '未发现超过判据的孤立回声' }),
      auditionArea(ir),
    ]);
    sidebar.append(panel);
    requestAnimationFrame(() => {
      drawLineChart(
        freqCanvas,
        [{ label: '座位频响 dB', color: '#34d399', points: curve.freqs.map((f, i) => ({ x: f, y: curve.db[i] })) }],
        { xLog: true },
      );
      drawBarChart(
        rtCanvas,
        BAND_FREQS.map((f, i) => ({
          label: String(f),
          value: rtCheck[BAND_FREQS[i]],
          color: '#f5b942',
        })),
        { unit: 's', yMax: Math.max(...BAND_FREQS.map((f) => rt60[f])) * 1.2 },
      );
    });
  }

  function auditionArea(ir: Float32Array) {
    const samples = store.listDrySamples();
    const select = h('select') as HTMLSelectElement;
    for (const s of samples) select.append(h('option', { value: s.id, text: s.name }));
    const wetSlider = h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: '0.85' }) as HTMLInputElement;
    const ensureAudio = () => {
      if (!audio) audio = new AudioEngine();
      return audio;
    };
    return h('div', { style: 'margin-top:10px' }, [
      h('h3', { text: '卷积试听（干声→该座位 IR）' }),
      h('label', { class: 'field' }, [h('span', { text: '干声样本（程序生成，无外部依赖）' }), select]),
      h('label', { class: 'field' }, [h('span', { text: '混响/干湿比' }), wetSlider]),
      h('div', { class: 'btn-row' }, [
        h('button', {
          class: 'btn',
          text: '▶ 试听该座位效果',
          onclick: () => {
            const eng = ensureAudio();
            const sample = store.state.drySamples[select.value];
            eng.setImpulseResponse(ir, 48000);
            eng.setWetMix(parseFloat(wetSlider.value));
            void eng.play(sample, store.getLayout(layoutId)!.speakers[0]?.dsp);
            toast('正在播放卷积混响试听');
          },
        }),
        h('button', { class: 'btn ghost', text: '■ 停止', onclick: () => audio?.stop() }),
      ]),
    ]);
  }

  function statGrid(rows: Array<[string, string]>) {
    return h('div', { class: 'grid-2' }, rows.map(([num, lbl]) => h('div', { class: 'stat' }, [h('div', { class: 'num', text: num }), h('div', { class: 'lbl', text: lbl })])));
  }

  // ---------- 双方案对比表 ----------
  function comparisonSection() {
    if (!compareLayoutId) return null;
    const other = store.getLayout(compareLayoutId);
    if (!other) return null;
    const a = analyzeMeasurePoints(layout.measurePoints, expandSpeakers(layout.speakers, layout.lineArrays, new Map(store.listSpeakerModels().map((m) => [m.id, m]))));
    const b = analyzeMeasurePoints(other.measurePoints, expandSpeakers(other.speakers, other.lineArrays, new Map(store.listSpeakerModels().map((m) => [m.id, m]))));
    const rows = layout.measurePoints.map((mp, i) => {
      const ra = a[i]?.result;
      const rb = b[i]?.result;
      if (!ra || !rb) return null;
      const splDiff = Math.abs(ra.splTotal - rb.splTotal);
      const rtA = sabineRT60(venue.room, new Map(store.listMaterials().map((m) => [m.id, m])));
      const rtB = rtA;
      const rtMidA = (rtA[500] + rtA[1000]) / 2;
      const rtMidB = (rtB[500] + rtB[1000]) / 2;
      const marginDiff = Math.abs(ra.directToReverbDb - rb.directToReverbDb);
      return h('tr', {}, [
        h('td', { text: mp.name }),
        diffCell(ra.splTotal, rb.splTotal, splDiff, 3),
        diffCell(rtMidA, rtMidB, Math.abs(rtMidA - rtMidB), 0.2, 's'),
        diffCell(ra.directToReverbDb, rb.directToReverbDb, marginDiff, 4, 'dB'),
      ]);
    });
    return h('div', { class: 'panel', style: 'margin:14px' }, [
      h('h3', { text: `方案对比：${layout.name} ⇄ ${other.name}` }),
      h('table', { class: 'data' }, [
        h('thead', {}, [
          h('tr', {}, [h('th', { text: '测点' }), h('th', { text: '输出声压 A/B (dB)' }), h('th', { text: '混响时间 A/B (s)' }), h('th', { text: 'D/R 余量 A/B (dB)' })]),
        ]),
        h('tbody', {}, rows),
      ]),
      h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, [
        '差值超阈值的格子自动标红（SPL>3dB、RT60>0.2s、余量>4dB），黄色为接近阈值。',
      ]),
    ]);
  }

  function diffCell(a: number, b: number, diff: number, threshold: number, unit = 'dB') {
    const cls = diff > threshold ? 'diff-high' : diff > threshold * 0.6 ? 'diff-mid' : '';
    return h('td', { class: cls }, [`${fmt(a, 1)} / ${fmt(b, 1)} ${unit}（Δ${fmt(diff, 1)}）`]);
  }

  // 对比表放在侧栏下方独立滚动区
  const compareHost = h('div', { class: 'scroll-y' });
  sidebar.append(compareHost);
  const renderCompare = () => {
    clear(compareHost);
    const section = comparisonSection();
    if (section) compareHost.append(section);
    if (project.layoutIds.length > 1 && !compareLayoutId) {
      const select = h('select') as HTMLSelectElement;
      select.append(h('option', { value: '', text: '选择第二套方案并排对比' }));
      for (const id of project.layoutIds) {
        if (id === layoutId) continue;
        const opt = store.getLayout(id);
        select.append(h('option', { value: id, text: opt?.name ?? id }));
      }
      select.onchange = () => {
        if (select.value) router.go({ name: 'analysis', projectId: project.id, layoutId, compareLayoutId: select.value });
      };
      compareHost.append(h('div', { class: 'panel' }, [h('h3', { text: '双方案对比' }), select]));
    }
  };

  void renderCompare;
  renderCompare();
  void runAnalysis();
  router.setMeta(`声场分析 · ${layout.name}`);

  // 页面卸载时释放 Worker / Audio / WebGL 资源
  const observer = new MutationObserver(() => {
    if (!document.body.contains(host)) {
      client.dispose();
      audio?.dispose();
      view.dispose();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
