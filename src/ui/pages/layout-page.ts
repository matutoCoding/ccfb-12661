import { h, mount, button, selectInput, numInput, textInput, labeled, section, toast, badge, table } from '../dom';
import { store } from '../../state/store';
import { viewport, DEFAULT_SCENE_OPTS } from '../viewport';
import { uid, eulerToDir, deepClone } from '../../core/math/vec3';
import { autoSplay, pickLoads } from '../../core/array';
import type { Layout, LineArray, SpeakerInstance, MicInstance } from '../../core/types';
import { renderSignalFlow } from './signal-flow';

export function renderLayoutPage(root: HTMLElement): void {
  const projectMaybe = store.currentProject;
  if (!projectMaybe) { mount(root, h('p', { class: 'muted' }, '请先选择项目。')); return; }
  const project: import('../../core/types').Project = projectMaybe;
  const project0 = project;
  let layout = store.currentLayout;
  if (!layout) {
    mount(root, h('div', {},
      h('p', { class: 'muted' }, '当前项目还没有布置方案。'),
      button('+ 新建布置方案', () => { createLayout(); }, 'primary')
    ));
    return;
  }
  let selected: { kind: 'speaker' | 'mic' | 'array'; id: string } | null = null;
  let subTab: 'place' | 'rigging' | 'signal' = 'place';

  const persist = () => store.saveLayout(layout);
  const refresh = () => { persist(); render(); };

  const createLayout = () => {
    const now = Date.now();
    const nl: Layout = {
      id: uid('layout'), name: `方案 ${project0.layoutIds.length + 1}`, note: '', updatedAt: now,
      speakers: [], arrays: [], mics: [],
      graph: { nodes: [{ id: uid('node'), kind: 'mixer', name: '主调音台' }], edges: [] },
      sourceLevel: 4, openMicCount: 1
    };
    store.state.layouts.push(nl);
    project0.layoutIds.push(nl.id);
    layout = nl;
    store.update((s) => { s.currentLayoutId = nl.id; });
    persist().then(() => store.saveProject()).then(() => { toast('方案已创建'); render(); });
  };

  const duplicateLayout = (src: Layout) => {
    const copy = deepClone(src);
    copy.id = uid('layout');
    copy.name = `${src.name}（副本）`;
    copy.updatedAt = Date.now();
    store.state.layouts.push(copy);
    project0.layoutIds.push(copy.id);
    store.update((s) => { s.currentLayoutId = copy.id; });
    layout = copy;
    persist().then(() => store.saveProject()).then(() => { toast('方案已复制'); render(); });
  };

  const addSpeaker = (modelId: string) => {
    const sp: SpeakerInstance = {
      id: uid('sp'), name: `音箱 ${layout!.speakers.length + 1}`, modelId,
      position: { x: project0.venue.width / 2, y: 2, z: project0.venue.height - 1.5 },
      orientation: { yaw: 0, pitch: -15, roll: 0 }, gainOffset: 0
    };
    layout!.speakers.push(sp);
    selected = { kind: 'speaker', id: sp.id };
    refresh();
  };

  const addMic = () => {
    const mic: MicInstance = {
      id: uid('mic'), name: `话筒 ${layout!.mics.length + 1}`,
      position: { x: project0.venue.width / 2, y: 3, z: 1.5 },
      pattern: 'cardioid', orientation: { yaw: 0, pitch: 0, roll: 0 }
    };
    layout!.mics.push(mic);
    selected = { kind: 'mic', id: mic.id };
    refresh();
  };

  const addArray = () => {
    const arr: LineArray = {
      id: uid('arr'), name: `线阵列 ${layout!.arrays.length + 1}`,
      elementModelId: store.state.library.speakers.find((s) => s.kind === 'line-element')?.id ?? store.state.library.speakers[0].id,
      framePosition: { x: project0.venue.width / 2, y: 1.5, z: project0.venue.height - 0.8 },
      yaw: 0, count: 6, interAngles: [1, 1.2, 1.5, 1.8, 2.1],
      ratedPickLoad: 120, pickPointCount: 2
    };
    layout!.arrays.push(arr);
    selected = { kind: 'array', id: arr.id };
    refresh();
  };

  const inspector = (): HTMLElement => {
    if (subTab === 'signal') {
      return h('div', { class: 'inspector', style: { maxWidth: 'none', width: '100%' } },
        renderSignalFlow(layout!, persist));
    }
    if (subTab === 'rigging') return riggingPanel();
    if (!selected) {
      return h('div', { class: 'inspector' },
        section('方案',
          labeled('方案名称', textInput(layout!.name, (v) => { layout!.name = v; })),
          labeled('备注', h('textarea', { rows: 2, oninput: (e: Event) => { layout!.note = (e.target as HTMLTextAreaElement).value; } }, layout!.note)),
          labeled('节目源输出电平 dBu', numInput(layout!.sourceLevel, (v) => { layout!.sourceLevel = v; }, 0.5)),
          labeled('同时开启话筒数 NOM', numInput(layout!.openMicCount, (v) => { layout!.openMicCount = Math.max(1, v); }, 1, 1)),
          h('div', { class: 'toolbar' }, button('保存', refresh, 'primary'))
        ),
        section('添加设备',
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, '音箱型号'),
            selectInput(store.state.library.speakers.map((m) => ({ value: m.id, label: `${m.manufacturer} ${m.model}` })), store.state.library.speakers[0]?.id ?? '', () => { })),
          h('div', { class: 'toolbar' },
            button('+ 点声源/补声', () => addSpeaker(store.state.library.speakers.find((m) => m.kind === 'point')?.id ?? store.state.library.speakers[0].id), 'primary'),
            button('+ 超低', () => addSpeaker(store.state.library.speakers.find((m) => m.kind === 'sub')?.id ?? store.state.library.speakers[0].id)),
            button('+ 线阵列', addArray, 'primary'),
            button('+ 话筒', addMic)
          )
        ),
        section('设备清单（本方案）',
          table(['类型', '数量'], [
            ['独立音箱', layout!.speakers.filter((s) => !s.arrayId).length],
            ['线阵列', `${layout!.arrays.length} 串 / ${layout!.arrays.reduce((n, a) => n + a.count, 0)} 只单元`],
            ['话筒', layout!.mics.length],
            ['信号节点', layout!.graph.nodes.length]
          ])
        )
      );
    }
    if (selected.kind === 'speaker') return speakerInspector(layout!.speakers.find((s) => s.id === selected!.id)!);
    if (selected.kind === 'mic') return micInspector(layout!.mics.find((m) => m.id === selected!.id)!);
    return arrayInspector(layout!.arrays.find((a) => a.id === selected!.id)!);
  };

  const speakerInspector = (sp: SpeakerInstance): HTMLElement => {
    const model = store.state.library.speakers.find((m) => m.id === sp.modelId);
    const ampNodes = layout!.graph.nodes.filter((n) => n.kind === 'amp');
    return h('div', { class: 'inspector' },
      section('音箱属性',
        labeled('名称', textInput(sp.name, (v) => { sp.name = v; })),
        labeled('型号', selectInput(store.state.library.speakers.map((m) => ({ value: m.id, label: `${m.manufacturer} ${m.model}（${model?.maxSPL ?? ''}dB）` })), sp.modelId, (v) => { sp.modelId = v; refresh(); })),
        h('div', { class: 'field-row-3' },
          labeled('X m', numInput(sp.position.x, (v) => { sp.position.x = v; render(); }, 0.1)),
          labeled('Y m', numInput(sp.position.y, (v) => { sp.position.y = v; render(); }, 0.1)),
          labeled('Z m', numInput(sp.position.z, (v) => { sp.position.z = v; render(); }, 0.1))
        ),
        h('div', { class: 'field-row-3' },
          labeled('偏航°', numInput(sp.orientation.yaw, (v) => { sp.orientation.yaw = v; render(); }, 0.5)),
          labeled('俯仰°', numInput(sp.orientation.pitch, (v) => { sp.orientation.pitch = v; render(); }, 0.5)),
          labeled('翻滚°', numInput(sp.orientation.roll, (v) => { sp.orientation.roll = v; render(); }, 0.5))
        ),
        labeled('增益偏移 dB', numInput(sp.gainOffset, (v) => { sp.gainOffset = v; }, 0.5, -20, 10)),
        labeled('绑定功放通道', selectInput([{ value: '', label: '— 未绑定 —' }, ...ampNodes.map((n) => ({ value: n.id, label: n.name }))], sp.ampNodeId ?? '', (v) => { sp.ampNodeId = v || undefined; refresh(); })),
        h('div', { class: 'kv' }, h('span', {}, '主轴指向'), h('span', { class: 'mono' }, JSON.stringify(Object.values(eulerToDir(sp.orientation)).map((x) => x.toFixed(2))))),
        h('div', { class: 'toolbar' },
          button('保存', refresh, 'primary'),
          button('删除音箱', () => { layout!.speakers = layout!.speakers.filter((x) => x.id !== sp.id); selected = null; refresh(); }, 'danger')
        )
      )
    );
  };

  const micInspector = (mic: MicInstance): HTMLElement => h('div', { class: 'inspector' },
    section('话筒属性',
      labeled('名称', textInput(mic.name, (v) => { mic.name = v; })),
      labeled('指向性', selectInput([{ value: 'cardioid', label: '心形指向' }, { value: 'omni', label: '全指向' }], mic.pattern, (v) => { mic.pattern = v as MicInstance['pattern']; refresh(); })),
      h('div', { class: 'field-row-3' },
        labeled('X m', numInput(mic.position.x, (v) => { mic.position.x = v; render(); }, 0.1)),
        labeled('Y m', numInput(mic.position.y, (v) => { mic.position.y = v; render(); }, 0.1)),
        labeled('Z m', numInput(mic.position.z, (v) => { mic.position.z = v; render(); }, 0.1))
      ),
      labeled('朝向偏航°', numInput(mic.orientation.yaw, (v) => { mic.orientation.yaw = v; render(); }, 0.5)),
      h('div', { class: 'toolbar' },
        button('保存', refresh, 'primary'),
        button('删除话筒', () => { layout!.mics = layout!.mics.filter((x) => x.id !== mic.id); selected = null; refresh(); }, 'danger')
      )
    )
  );

  const arrayInspector = (arr: LineArray): HTMLElement => {
    const model = store.state.library.speakers.find((m) => m.id === arr.elementModelId)!;
    const ensureAngles = () => {
      while (arr.interAngles.length < arr.count - 1) arr.interAngles.push(1.5);
      arr.interAngles.length = arr.count - 1;
    };
    ensureAngles();
    const rig = pickLoads(arr, model);
    return h('div', { class: 'inspector' },
      section('线阵列吊挂',
        labeled('名称', textInput(arr.name, (v) => { arr.name = v; })),
        labeled('单元型号', selectInput(store.state.library.speakers.filter((m) => m.kind === 'line-element').map((m) => ({ value: m.id, label: `${m.manufacturer} ${m.model}` })), arr.elementModelId, (v) => { arr.elementModelId = v; refresh(); })),
        labeled('箱体数量', numInput(arr.count, (v) => { arr.count = Math.max(2, Math.min(24, v)); ensureAngles(); refresh(); }, 1, 2, 24)),
        h('div', { class: 'field-row-3' },
          labeled('框架 X', numInput(arr.framePosition.x, (v) => { arr.framePosition.x = v; render(); }, 0.1)),
          labeled('框架 Y', numInput(arr.framePosition.y, (v) => { arr.framePosition.y = v; render(); }, 0.1)),
          labeled('框架 Z', numInput(arr.framePosition.z, (v) => { arr.framePosition.z = v; render(); }, 0.1))
        ),
        labeled('整体偏航°', numInput(arr.yaw, (v) => { arr.yaw = v; render(); }, 0.5)),
        h('div', { class: 'field-row' },
          labeled('吊点数', numInput(arr.pickPointCount, (v) => { arr.pickPointCount = Math.max(1, Math.min(4, v)); refresh(); }, 1, 1, 4)),
          labeled('单吊点额定 kg', numInput(arr.ratedPickLoad, (v) => { arr.ratedPickLoad = v; refresh(); }, 5, 20))
        ),
        button('按观众区前后排反推张角', () => {
          arr.interAngles = autoSplay(arr, model, project0.venue.audienceZones);
          toast('已根据观众区覆盖重新计算张角');
          refresh();
        }, 'primary')
      ),
      section('逐只张角（相邻箱体夹角）',
        h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
          h('thead', {}, h('tr', {}, h('th', {}, '接缝'), h('th', {}, '张角°'), h('th', {}, '调整'))),
          h('tbody', {}, ...arr.interAngles.map((ang, i) => h('tr', {},
            h('td', {}, `${i + 1}→${i + 2}`),
            h('td', { class: 'mono' }, ang.toFixed(1)),
            h('td', {}, numInput(ang, (v) => { arr.interAngles[i] = Math.max(0, Math.min(10, v)); refresh(); }, 0.1, 0, 10))
          )))
        ))
      ),
      section('物理校核',
        h('div', { class: 'kv' }, h('span', {}, '整串总重（含框架 8%）'), h('span', {}, `${rig.totalWeight} kg`)),
        h('div', { class: 'kv' }, h('span', {}, '重心纵向偏移'), h('span', {}, `${rig.comOffset.along} m`)),
        h('div', { class: 'kv' }, h('span', {}, '重心下沉'), h('span', {}, `${rig.comOffset.down} m`)),
        table(['吊点', '载荷 kg', '额定 kg', '状态'], rig.picks.map((p) => [
          p.name, p.loadKg, p.ratedKg, p.ok ? badge('合格', 'ok') : badge('超载!', 'bad')
        ]), { cellClass: (r) => (rig.picks[r].ok ? '' : 'cell-bad') }),
        rig.warnings.length ? h('div', { style: { marginTop: '8px' } }, ...rig.warnings.map((w) => h('p', { class: 'badge badge-bad', style: { marginBottom: '4px' } }, '⚠ ' + w))) : h('p', { class: 'badge badge-ok' }, '全部吊点在额定载荷内'),
        h('div', { class: 'toolbar', style: { marginTop: '10px' } },
          button('保存', refresh, 'primary'),
          button('删除阵列', () => { layout!.arrays = layout!.arrays.filter((x) => x.id !== arr.id); selected = null; refresh(); }, 'danger')
        )
      )
    );
  };

  const riggingPanel = (): HTMLElement => h('div', { class: 'inspector', style: { maxWidth: 'none' } },
    section('全部线阵列吊挂校核汇总',
      ...layout!.arrays.map((arr) => {
        const model = store.state.library.speakers.find((m) => m.id === arr.elementModelId)!;
        const rig = pickLoads(arr, model);
        return h('div', { style: { marginBottom: '14px' } },
          h('h4', {}, arr.name, ' ', rig.warnings.length ? badge('存在报警', 'bad') : badge('安全', 'ok')),
          h('div', { class: 'kv' }, h('span', {}, '单元数 / 总重'), h('span', {}, `${arr.count} 只 / ${rig.totalWeight} kg`)),
          table(['吊点', '载荷 kg', '额定 kg', '利用率', '状态'],
            rig.picks.map((p) => [p.name, p.loadKg, p.ratedKg, `${Math.round((p.loadKg / p.ratedKg) * 100)}%`, p.ok ? badge('合格', 'ok') : badge('超载', 'bad')]),
            { cellClass: (r) => (rig.picks[r].ok ? (rig.picks[r].loadKg / rig.picks[r].ratedKg > 0.85 ? 'cell-warn' : '') : 'cell-bad') }
          )
        );
      }),
      layout!.arrays.length === 0 ? h('p', { class: 'muted' }, '本方案暂无线阵列。') : null
    )
  );

  const layoutSwitcher = () => h('div', { class: 'toolbar', style: { marginBottom: '10px' } },
    ...store.state.layouts.map((l) =>
      h('button', { class: `btn btn-sm ${l.id === layout!.id ? 'btn-primary' : ''}`, onclick: () => { store.update((s) => { s.currentLayoutId = l.id; }); layout = l; selected = null; render(); } }, l.name)
    ),
    button('+ 新建', createLayout, 'primary'),
    button('复制当前', () => duplicateLayout(layout!))
  );

  function render() {
    const { el } = viewport(
      project,
      () => store.currentLayout ?? null,
      () => null,
      store.state.library,
      () => ({ ...DEFAULT_SCENE_OPTS, showCoverage: true, showHeatmap: false }),
      (pick) => {
        if (!pick) { selected = null; render(); return; }
        if (pick.kind === 'array') {
          const arrId = pick.id.split('@')[0];
          selected = { kind: 'array', id: arrId };
        } else if (pick.kind === 'speaker') {
          selected = { kind: 'speaker', id: pick.id };
        } else if (pick.kind === 'mic') {
          selected = { kind: 'mic', id: pick.id };
        }
        render();
      }
    );
    mount(root,
      layoutSwitcher(),
      h('div', { class: 'tabs' },
        ...([['place', '设备布置'], ['rigging', '吊挂校核'], ['signal', '信号流 / DSP']] as const).map(([k, label]) =>
          h('button', { class: `tab ${subTab === k ? 'active' : ''}`, onclick: () => { subTab = k; render(); } }, label)
        )
      ),
      h('div', { class: 'layout-split', style: subTab === 'signal' ? { gridTemplateColumns: '1fr' } : undefined },
        subTab === 'signal' ? null : el,
        inspector()
      )
    );
  }
  render();
}
