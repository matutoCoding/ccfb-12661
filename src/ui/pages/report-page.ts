import { h, mount, button, section, badge, table, toast } from '../dom';
import { store } from '../../state/store';
import { workerClient } from '../../workers/client';
import type { AnalysisSnapshot } from '../../core/types';
import { BAND_CENTERS } from '../../core/acoustics/bands';

export async function renderReportPage(root: HTMLElement): Promise<void> {
  const project = store.currentProject;
  if (!project) { mount(root, h('p', { class: 'muted' }, '请先选择项目。')); return; }
  const layout = store.currentLayout;
  if (!layout) { mount(root, h('p', { class: 'muted' }, '请先选择布置方案。')); return; }
  let snapshot: AnalysisSnapshot | null = store.state.snapshots[layout.id] ?? null;
  if (!snapshot) {
    store.setBusy(true, '生成报告数据…', 30);
    snapshot = await workerClient.runAnalysis(project, layout, store.state.library, { echoDelayMs: 50, echoLevelDb: 15, gridSpacing: 2 });
    store.update((s) => { s.snapshots[layout.id] = snapshot!; });
    store.setBusy(false);
  }
  const s = snapshot;
  const groups = s.bom.groups;
  let activeGroup = '全部';

  const print = () => window.print();

  const exportCsv = () => {
    const rows = [['类别', '名称', '型号ID', '单位', '数量', '分组', '单重kg', '单功耗W']];
    for (const it of s.bom.items) rows.push([it.category, it.name, it.modelId, it.unit, String(it.quantity), it.group, String(it.weightEach ?? ''), String(it.powerEach ?? '')]);
    const csv = '﻿' + rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${project.name}-${layout.name}-设备清单.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
    toast('CSV 已导出');
  };

  const renderScreen = () => {
    const items = activeGroup === '全部' ? s.bom.items : s.bom.items.filter((i) => i.group === activeGroup);
    mount(root,
      h('div', { class: 'toolbar no-print', style: { marginBottom: '14px', justifyContent: 'space-between' } },
        h('div', { class: 'toolbar' },
          button('全部', () => { activeGroup = '全部'; renderScreen(); }, activeGroup === '全部' ? 'primary' : 'ghost'),
          ...groups.map((g) => button(g, () => { activeGroup = g; renderScreen(); }, activeGroup === g ? 'primary' : 'ghost'))
        ),
        h('div', { class: 'toolbar' },
          button('导出 CSV 清单', exportCsv),
          button('打印 / 另存 PDF', print, 'primary')
        )
      ),
      h('div', { class: 'report-doc' },
        h('h1', {}, '扩声系统设计报告'),
        h('p', {}, h('b', {}, '项目：'), project.name, h('br'),
          h('b', {}, '布置方案：'), layout.name, h('br'),
          h('b', {}, '场地尺寸：'), `${project.venue.width}m × ${project.venue.length}m × ${project.venue.height}m`, h('br'),
          h('b', {}, '生成时间：'), new Date(s.computedAt).toLocaleString('zh-CN')),

        h('h2', {}, '1. 房间声学指标'),
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, '频带 Hz'), ...BAND_CENTERS.map((f) => h('th', {}, String(f))))),
          h('tbody', {},
            h('tr', {}, h('td', {}, '赛宾 RT60 (s)'), ...s.rt60.sabine.map((v) => h('td', {}, v.toFixed(2)))),
            h('tr', {}, h('td', {}, '伊林 RT60 (s)'), ...s.rt60.eyring.map((v) => h('td', {}, v.toFixed(2)))),
            h('tr', {}, h('td', {}, '总吸声量 A (m²)'), ...s.rt60.totalAbsorption.map((v) => h('td', {}, v.toFixed(1))))
          )
        ),
        h('p', {}, `房间容积 ${s.rt60.volume.toFixed(0)} m³，内表面积 ${s.rt60.surfaceArea.toFixed(0)} m²。`),

        h('h2', {}, '2. 声场覆盖与电平预算摘要'),
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, '音箱'), h('th', {}, '端功率 W'), h('th', {}, '1m SPL'), h('th', {}, '最先过载级'), h('th', {}, '状态'))),
          h('tbody', {}, ...s.budgets.map((b) => h('tr', {},
            h('td', {}, b.speakerName),
            h('td', {}, String(b.powerW)),
            h('td', {}, `${b.spl1m} dB`),
            h('td', {}, b.firstOverload >= 0 ? b.stages[b.firstOverload].stage : '无'),
            h('td', {}, b.firstOverload >= 0 ? '过载/限幅' : '正常')
          )))
        ),

        h('h2', {}, '3. 传声增益与啸叫余量'),
        ...s.feedback.flatMap((f) => [
          h('h3', {}, f.micName),
          h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, '频带 Hz'), ...BAND_CENTERS.map((x) => h('th', {}, String(x))))),
            h('tbody', {}, h('tr', {}, h('td', {}, '余量 dB'), ...f.bandMargins.map((m) => h('td', {}, m.toFixed(1)))))
          ),
          h('p', {}, '最易啸叫频点：', f.worst.map((w) => `${Math.round(w.freq)}Hz(${w.marginDb.toFixed(1)}dB)`).join('、') || '—')
        ]),

        h('h2', {}, '4. 反射与回声评估'),
        h('p', {}, `共追踪反射路径 ${s.reflections.length} 条（一阶 ${s.reflections.filter((p) => p.order === 1).length} / 二阶 ${s.reflections.filter((p) => p.order === 2).length}），其中疑似回声 ${s.reflections.filter((p) => p.isEcho).length} 条；受影响座位占比 ${Math.round((s.echoMap.points.filter((p) => p.echo).length / Math.max(s.echoMap.points.length, 1)) * 100)}%。`),

        h('h2', {}, '5. 线阵列吊挂校核'),
        ...s.rigging.map((r) => h('div', {},
          h('h3', {}, layout.arrays.find((a) => a.id === r.arrayId)?.name ?? r.arrayId),
          h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, '吊点'), h('th', {}, '载荷 kg'), h('th', {}, '额定 kg'), h('th', {}, '状态'))),
            h('tbody', {}, ...r.picks.map((p) => h('tr', {}, h('td', {}, p.name), h('td', {}, String(p.loadKg)), h('td', {}, String(p.ratedKg)), h('td', {}, p.ok ? '合格' : '超载报警'))))
          ),
          h('p', {}, `整串总重 ${r.totalWeight}kg，重心偏移 纵向 ${r.comOffset.along}m / 下沉 ${r.comOffset.down}m。`,
            r.warnings.length ? h('b', { style: { color: '#c0392b' } }, ' 报警：' + r.warnings.join('；')) : null)
        )),
        s.rigging.length === 0 ? h('p', {}, '本方案未使用线阵列。') : null,

        h('h2', {}, `6. 设备清单（${activeGroup === '全部' ? '全部分组' : activeGroup}）`),
        h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, '类别'), h('th', {}, '名称/型号'), h('th', {}, '单位'), h('th', {}, '数量'), h('th', {}, '分组'), h('th', {}, '单重 kg'), h('th', {}, '单功耗 W'))),
          h('tbody', {}, ...items.map((it) => h('tr', {},
            h('td', {}, it.category), h('td', {}, it.name), h('td', {}, it.unit), h('td', {}, String(it.quantity)),
            h('td', {}, it.group), h('td', {}, String(it.weightEach ?? '—')), h('td', {}, String(it.powerEach ?? '—'))
          )))
        ),
        h('p', {}, h('b', {}, `整套系统估算总功耗：${s.bom.totalPowerW} W；吊挂与设备总重：${s.bom.totalWeightKg} kg。`))
      ),
      section('分组核对状态（屏幕视图）',
        table(['分组', '条目数', '设备数量合计', '功耗 W'],
          ['全部', ...groups].map((g) => {
            const its = g === '全部' ? s.bom.items : s.bom.items.filter((i) => i.group === g);
            const qty = its.reduce((n, i) => n + i.quantity, 0);
            const power = its.reduce((n, i) => n + (i.powerEach ?? 0) * i.quantity, 0);
            return [g, its.length, qty, power];
          })
        ),
        h('div', { class: 'toolbar', style: { marginTop: '10px' } }, badge(`总功耗 ${s.bom.totalPowerW} W`, 'warn'), badge(`总重 ${s.bom.totalWeightKg} kg`, 'info'))
      )
    );
  };
  renderScreen();
}
