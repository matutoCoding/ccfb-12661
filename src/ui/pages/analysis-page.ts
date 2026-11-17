import { h, mount, button, selectInput, numInput, labeled, section, toast, badge, table } from '../dom';
import { store } from '../../state/store';
import { viewport, DEFAULT_SCENE_OPTS } from '../viewport';
import { workerClient } from '../../workers/client';
import { BAND_CENTERS, A_WEIGHTING } from '../../core/acoustics/bands';
import { potentialAcousticGain } from '../../core/feedback';
import { lineChart, barChart } from '../charts';
import { audioEngine } from '../../audio/engine';
import { generateMusicSample, generatePinkNoise, generateSpeechSample } from '../../audio/signal-generator';
import type { AnalysisSnapshot, Layout } from '../../core/types';
import { renderCompareView } from './compare-page';

export function renderAnalysisPage(root: HTMLElement): void {
  const projectMaybe = store.currentProject;
  const layout = store.currentLayout;
  if (!projectMaybe || !layout) { mount(root, h('p', { class: 'muted' }, '请先选择项目并创建设备方案。')); return; }
  const project0: import('../../core/types').Project = projectMaybe;
  const project = project0;

  let snapshot: AnalysisSnapshot | null = store.state.snapshots[layout.id] ?? null;
  let subTab: 'field' | 'budget' | 'feedback' | 'reflection' | 'compare' = 'field';
  let opts = { showHeatmap: true, showReflections: false, showEcho: false, showCoverage: false, heatmapRange: [65, 100] as [number, number] };
  let echoDelayMs = 50, echoLevelDb = 15, gridSpacing = 2;

  const run = () => {
    store.setBusy(true, '启动 Worker…', 5);
    workerClient.runAnalysis(
      project, layout, store.state.library,
      { echoDelayMs, echoLevelDb, gridSpacing },
      (p) => store.setBusy(true, p.phase, p.percent)
    ).then((res) => {
      snapshot = res;
      store.update((s) => { s.snapshots[layout.id] = res; });
      store.setBusy(false);
      toast('声场分析完成（Worker 线程）');
      render();
    }).catch((e) => {
      store.setBusy(false);
      toast('分析失败：' + e.message, 'err');
    });
  };

  const fieldTab = () => h('div', {},
    section('分析控制（重计算在 Web Worker 中执行，界面不阻塞）',
      h('div', { class: 'field-row-3' },
        labeled('回声延时阈值 ms', numInput(echoDelayMs, (v) => { echoDelayMs = v; }, 5, 20, 200)),
        labeled('回声强度阈值 dB', numInput(echoLevelDb, (v) => { echoLevelDb = v; }, 1, 3, 30)),
        labeled('采样网格间距 m', numInput(gridSpacing, (v) => { gridSpacing = Math.max(0.8, Math.min(4, v)); }, 0.5))
      ),
      h('div', { class: 'toolbar' },
        button(snapshot ? '重新运行分析' : '运行声场分析', run, 'primary'),
        h('label', { class: 'field', style: { flexDirection: 'row', gap: '6px', alignItems: 'center', margin: 0 } },
          h('input', { type: 'checkbox', checked: opts.showHeatmap, onchange: (e: Event) => { opts.showHeatmap = (e.target as HTMLInputElement).checked; render(); } }), 'SPL 热力图'),
        h('label', { class: 'field', style: { flexDirection: 'row', gap: '6px', alignItems: 'center', margin: 0 } },
          h('input', { type: 'checkbox', checked: opts.showReflections, onchange: (e: Event) => { opts.showReflections = (e.target as HTMLInputElement).checked; render(); } }), '反射声线'),
        h('label', { class: 'field', style: { flexDirection: 'row', gap: '6px', alignItems: 'center', margin: 0 } },
          h('input', { type: 'checkbox', checked: opts.showEcho, onchange: (e: Event) => { opts.showEcho = (e.target as HTMLInputElement).checked; render(); } }), '回声座位标记'),
        labeled('色标范围 dB', h('div', { class: 'field-row' },
          numInput(opts.heatmapRange[0], (v) => { opts.heatmapRange[0] = v; render(); }, 1),
          numInput(opts.heatmapRange[1], (v) => { opts.heatmapRange[1] = v; render(); }, 1)))
      ),
      h('p', { class: 'muted' }, '单击观众区任意位置可进行单点探测（频响 + 脉冲响应 + 卷积试听）。')
    ),
    snapshot ? fieldResults() : h('p', { class: 'muted' }, '尚未运行分析。')
  );

  const fieldResults = () => {
    const s = snapshot!;
    const dbaValues = Array.from(s.splGrid.dba).filter((v) => v > -900);
    const stats = dbaValues.length ? {
      min: Math.min(...dbaValues), max: Math.max(...dbaValues),
      avg: dbaValues.reduce((a, b) => a + b, 0) / dbaValues.length
    } : { min: 0, max: 0, avg: 0 };
    return h('div', { class: 'grid-2' },
      section('混响时间 RT60（赛宾公式，伊林对照）',
        barChart(BAND_CENTERS.map((f) => (f >= 1000 ? `${f / 1000}k` : String(f))), s.rt60.sabine, '#4da3ff', { yMax: Math.max(2.5, Math.ceil(Math.max(...s.rt60.sabine) * 1.2)), unit: '秒' }),
        table(['指标', '数值'], [
          ['房间容积 m³', s.rt60.volume.toFixed(0)],
          ['总内表面积 m²', s.rt60.surfaceArea.toFixed(0)],
          ['500Hz 赛宾 RT60 s', s.rt60.sabine[3].toFixed(2)],
          ['1kHz 伊林 RT60 s', s.rt60.eyring[4].toFixed(2)],
          ['中频平均 RT60 s', ((s.rt60.sabine[3] + s.rt60.sabine[4]) / 2).toFixed(2)]
        ])
      ),
      section('观众区声压级统计（dBA）',
        h('div', { class: 'field-row-3' },
          h('div', { class: 'panel', style: { margin: 0 } }, h('h4', { class: 'panel-title' }, '最小'), h('div', { style: { fontSize: '24px', fontWeight: 700 } }, stats.min.toFixed(1), ' dB')),
          h('div', { class: 'panel', style: { margin: 0 } }, h('h4', { class: 'panel-title' }, '平均'), h('div', { style: { fontSize: '24px', fontWeight: 700, color: 'var(--accent-2)' } }, stats.avg.toFixed(1), ' dB')),
          h('div', { class: 'panel', style: { margin: 0 } }, h('h4', { class: 'panel-title' }, '最大'), h('div', { style: { fontSize: '24px', fontWeight: 700 } }, stats.max.toFixed(1), ' dB'))
        ),
        h('div', { class: 'kv' }, h('span', {}, '声场不均匀度（最大-最小）'), h('span', {}, (stats.max - stats.min).toFixed(1), ' dB')),
        h('div', { class: 'kv' }, h('span', {}, '采样测点数'), h('span', {}, String(s.seats.length))),
        barChart(BAND_CENTERS.map((f) => (f >= 1000 ? `${f / 1000}k` : String(f))),
          BAND_CENTERS.map((_, b) => s.seats.reduce((a, x) => a + x.splBands[b], 0) / Math.max(s.seats.length, 1)),
          '#36d399', { unit: '各带平均 SPL dB' })
      )
    );
  };

  const budgetTab = () => {
    const s = snapshot!;
    return h('div', {}, ...s.budgets.map((b) =>
      section(`电平预算 · ${b.speakerName}（1m 最大 ${b.spl1m} dB SPL / 端功率 ${b.powerW} W）`,
        table(['级', '输入 dBu', '增益 dB', '输出 dBu', '削波 dBu', '余量 dB', '状态'],
          b.stages.map((st, i) => [
            st.stage, st.inputDbu, st.gainDb, st.outputDbu, st.clipDbu, st.headroomDb,
            st.overload ? badge('过载', 'bad') : st.limited ? badge('限幅', 'warn') : i === b.firstOverload ? badge('最先瓶颈', 'warn') : badge('正常', 'ok')
          ]),
          { cellClass: (r) => b.stages[r].overload ? 'cell-bad' : b.stages[r].headroomDb < 3 ? 'cell-warn' : '' }
        ),
        b.firstOverload >= 0 ? h('p', { class: 'badge badge-bad', style: { marginTop: '8px' } }, `⚠ 第 ${b.firstOverload + 1} 级最先过载/触及限幅，余量已标红，请降低前级增益或提升设备额定值。`) :
          h('p', { class: 'badge badge-ok', style: { marginTop: '8px' } }, '全链路未过载。')
      )
    ));
  };

  const feedbackTab = () => {
    const s = snapshot!;
    return h('div', {}, ...s.feedback.map((f) =>
      section(`啸叫余量 · ${f.micName}（最近音箱 ${f.dSpeaker}m / 参考听距 ${f.dListener}m，PAG≈${potentialAcousticGain(f.dListener, f.dSpeaker).toFixed(1)}dB）`,
        lineChart([{ label: '啸叫余量 dB（越低越危险）', color: '#ff7a7a', points: f.curve.map((p) => ({ x: p.freq, y: p.marginDb })) }],
          { xLog: true, height: 220, yMin: 0, yMax: Math.max(30, Math.ceil(Math.max(...f.curve.map((c) => c.marginDb)) / 5) * 5), xLabel: 'Hz', markers: f.worst.slice(0, 3).map((w) => ({ x: w.freq, label: `${Math.round(w.freq)}Hz` })) }),
        h('div', { class: 'toolbar', style: { marginTop: '8px' } },
          ...f.worst.map((w) => h('span', { class: 'chip' }, badge(`${Math.round(w.freq)} Hz`, 'bad'), `余量 ${w.marginDb.toFixed(1)} dB`))
        ),
        table(BAND_CENTERS.map((x) => (x >= 1000 ? `${x / 1000}k` : String(x))), [f.bandMargins.map((m) => m)], {
          cellClass: (_r, c) => f.bandMargins[c] < 6 ? 'cell-bad' : f.bandMargins[c] < 10 ? 'cell-warn' : ''
        }),
        h('p', { class: 'muted' }, '在布置页拖动话筒或音箱后重新运行分析，余量曲线会随距离与偏轴角实时重算（Worker）。')
      )
    ));
  };

  const reflectionTab = () => {
    const s = snapshot!;
    const echoes = s.reflections.filter((p) => p.isEcho);
    return h('div', {},
      section('一阶 / 二阶反射路径（镜像声源法）',
        h('div', { class: 'toolbar', style: { marginBottom: '8px' } },
          h('span', { class: 'chip' }, badge('一阶', 'info'), `${s.reflections.filter((p) => p.order === 1).length} 条`),
          h('span', { class: 'chip' }, badge('二阶', 'info'), `${s.reflections.filter((p) => p.order === 2).length} 条`),
          h('span', { class: 'chip' }, badge('疑似回声', 'bad'), `${echoes.length} 条`)
        ),
        table(['阶数', '反射面', '路径长 m', '相对延时 ms', '中频级差 dB', '判定'],
          s.reflections.slice(0, 24).map((p) => [
            p.order, p.surfaceIds.map((id) => project0.venue.surfaces.find((x) => x.id === id)?.name ?? id).join(' → '),
            p.lengthM, p.delayMs, p.levelDelta, p.isEcho ? badge('回声风险', 'bad') : badge('正常', 'ok')
          ]),
          { cellClass: (r) => s.reflections.slice(0, 24)[r].isEcho ? 'cell-warn' : '' }
        )
      ),
      section('受回声影响座位区',
        h('p', { class: 'muted' }, `回声判定：相对直达延时 ≥ ${echoDelayMs}ms 且中频级差 ≥ -${echoLevelDb}dB。红点座位存在可闻回声风险，更换墙面吸声材料后重新分析即更新。`),
        table(['状态', '座位数', '占比'], [
          [badge('受影响', 'bad'), s.echoMap.points.filter((p) => p.echo).length, `${Math.round((s.echoMap.points.filter((p) => p.echo).length / Math.max(s.echoMap.points.length, 1)) * 100)}%`],
          [badge('正常', 'ok'), s.echoMap.points.filter((p) => !p.echo).length, '']
        ])
      )
    );
  };

  const seatProbePanel = (point: { x: number; y: number; z: number }) => {
    store.setBusy(true, '合成座位脉冲响应…', 30);
    workerClient.probeSeat(project, layout, store.state.library, point, 48000).then((probe) => {
      store.setBusy(false);
      const mask = h('div', { class: 'modal-mask', onclick: (e: Event) => { if (e.target === mask) { audioEngine.stop(); mask.remove(); } } });
      const play = async (kind: 'speech' | 'music' | 'noise') => {
        const dry = kind === 'speech' ? generateSpeechSample(48000) : kind === 'music' ? generateMusicSample(48000) : generatePinkNoise(48000);
        audioEngine.setRoomImpulse(probe.rirSamples, 48000);
        const ampNode = layout.graph.nodes.find((n) => n.kind === 'amp');
        if (ampNode?.dsp) audioEngine.setDSPChain(ampNode.dsp);
        await audioEngine.play(dry, 0.72);
      };
      mask.append(h('div', { class: 'modal', style: { width: '640px' } },
        h('h3', {}, `座位探测 (${point.x.toFixed(1)}, ${point.y.toFixed(1)}, ${point.z.toFixed(1)})`),
        h('div', { class: 'kv' }, h('span', {}, '总声压级 dBA'), h('span', {}, probe.splDBA.toFixed(1), ' dB')),
        section('频响曲线',
          lineChart([{ label: 'SPL dB', color: '#36d399', points: probe.response.map((p) => ({ x: p.freq, y: p.db })) }], { xLog: true, height: 200, xLabel: 'Hz' })
        ),
        section(`脉冲响应（卷积试听，RT60 尾与赛宾计算一致，时长 ${probe.durationSec.toFixed(1)}s）`,
          barChart(['63', '125', '250', '500', '1k', '2k', '4k', '8k'], probe.rt60Bands, '#f5b945', { unit: 'RT60 s', yMax: Math.max(2, Math.ceil(Math.max(...probe.rt60Bands) * 1.2)) }),
          h('div', { class: 'toolbar', style: { marginTop: '10px' } },
            button('▶ 试听语音干声', () => play('speech'), 'primary'),
            button('▶ 试听音乐片段', () => play('music'), 'primary'),
            button('▶ 试听粉噪声', () => play('noise')),
            button('■ 停止', () => audioEngine.stop(), 'danger')
          ),
          h('p', { class: 'muted' }, '干声样本全部由 Web Audio 离线合成，无外部资源；卷积核即该座位 RIR。')
        ),
        button('关闭', () => { audioEngine.stop(); mask.remove(); })
      ));
      document.body.append(mask);
    }).catch((e) => { store.setBusy(false); toast('探测失败：' + e.message, 'err'); });
  };

  function render() {
    const { el } = viewport(
      project,
      () => (layout ?? null),
      () => snapshot,
      store.state.library,
      () => opts,
      (pick) => { if (pick) seatProbePanel(pick.point); }
    );
    const tabs = h('div', { class: 'tabs' },
      ...([['field', '声场/RT60'], ['budget', '电平预算'], ['feedback', '啸叫余量'], ['reflection', '反射/回声'], ['compare', '方案对比']] as const).map(([k, label]) =>
        h('button', { class: `tab ${subTab === k ? 'active' : ''}`, onclick: () => { subTab = k; render(); } }, label)
      )
    );
    let body: HTMLElement;
    if (subTab === 'field') body = fieldTab();
    else if (subTab === 'budget') body = snapshot ? budgetTab() : needRun();
    else if (subTab === 'feedback') body = snapshot ? feedbackTab() : needRun();
    else if (subTab === 'reflection') body = snapshot ? reflectionTab() : needRun();
    else body = renderCompareView(project, store.state.layouts, store.state.library);
    mount(root, tabs, h('div', { class: 'layout-split' }, el, h('div', { class: 'inspector', style: { overflow: 'visible' } }, body)));
  }
  const needRun = () => h('p', { class: 'muted' }, '请先在「声场/RT60」标签运行分析。');
  render();
}
