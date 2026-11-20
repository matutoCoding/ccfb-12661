import {
  defaultDsp,
  newId,
  type AmpChannelBinding,
  type ChannelDsp,
  type Layout,
  type LineArray,
  type Microphone,
  type PlacedSpeaker,
  type Project,
  type Vec3,
} from '../../core/types';
import { store } from '../../state/store';
import { createLayout, defaultLevelChain } from '../../core/factory';
import { h, clear, toast, fmt } from '../dom';
import { View3D } from '../../webgl/View3D';
import { dspEditor } from '../components/dspEditor';
import { signalFlowGraph, ensureSignalScaffold } from '../components/signalFlow';
import { riggingPanel } from '../components/riggingPanel';
import { analyzeLevelBudget } from '../../core/analysis';
import { expandSpeakers } from '../../core/speakers';
import { polygonCentroid } from '../../core/geometry';
import type { Router } from '../router';

type Tab = 'objects' | 'signal' | 'rigging' | 'levels';

export function renderLayoutPage(host: HTMLElement, router: Router, project: Project, layoutId: string): void {
  if (!project.venueId) return;
  const venue = store.getVenue(project.venueId)!;
  const layout = store.getLayout(layoutId);
  if (!layout) {
    host.append(h('div', { class: 'content' }, [h('div', { class: 'panel', text: '方案不存在' })]));
    return;
  }
  ensureSignalScaffold(layout);

  let tab: Tab = 'objects';
  const sidebar = h('div', { class: 'sidebar wide' });
  const content = h('div', { class: 'content' });
  host.append(sidebar, content);

  const canvas = h('canvas') as HTMLCanvasElement;
  const viewport = h('div', { class: 'viewport' }, [canvas]);
  content.append(viewport);
  const view = new View3D(canvas);
  const models = new Map(store.listSpeakerModels().map((m) => [m.id, m]));
  const amps = store.listAmpModels();

  const getNearFar = () => {
    const area = venue.audienceAreas[0];
    if (!area) return null;
    const c = polygonCentroid(area.polygon);
    const xs = area.polygon.map((p) => p.x);
    return {
      near: { x: Math.min(...xs) + 1, y: c.y, z: area.earHeight },
      far: { x: Math.max(...xs) - 1, y: c.y, z: area.earHeight },
    };
  };

  function refresh3d() {
    const fresh = store.getLayout(layoutId)!;
    const ven = store.getVenue(project.venueId!)!;
    view.setData(ven, fresh, store.listSpeakerModels(), store.listMaterials());
    view.setOptions({ showRoom: true, showAudience: true, showSpeakers: true, showMicrophones: true });
  }
  view.setData(venue, layout, store.listSpeakerModels(), store.listMaterials());
  view.setOptions({ showRoom: true, showAudience: true, showSpeakers: true, showMicrophones: true });

  const mutate = (fn: (l: Layout) => void) => {
    store.mutate((db) => {
      const l = db.layouts[layoutId];
      fn(l);
      l.updatedAt = Date.now();
    });
    refresh3d();
    renderSidebar();
  };

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'objects', label: '设备布置' },
    { key: 'signal', label: '信号流/DSP' },
    { key: 'rigging', label: '吊挂校核' },
    { key: 'levels', label: '电平预算' },
  ];

  function renderSidebar() {
    clear(sidebar);
    const l = store.getLayout(layoutId)!;
    sidebar.append(
      h('div', { class: 'panel' }, [
        h('h3', { text: '布置方案' }),
        layoutSwitcher(l),
        h('div', { class: 'pill-row', style: 'margin-top:10px' },
          tabs.map((t) =>
            h('button', {
              class: t.key === tab ? 'active' : '',
              text: t.label,
              onclick: () => {
                tab = t.key;
                renderSidebar();
              },
            }),
          ),
        ),
      ]),
    );
    if (tab === 'objects') objectsTab(l);
    if (tab === 'signal') signalTab(l);
    if (tab === 'rigging') {
      sidebar.append(riggingPanel(l, models, mutate, getNearFar));
    }
    if (tab === 'levels') levelsTab(l);
  }

  function layoutSwitcher(l: Layout) {
    const select = h('select') as HTMLSelectElement;
    for (const id of project.layoutIds) {
      const opt = store.getLayout(id);
      select.append(h('option', { value: id, text: opt?.name ?? id, selected: id === layoutId ? '' : null }));
    }
    select.onchange = () => router.go({ name: 'layout', projectId: project.id, layoutId: select.value });
    return h('div', {}, [
      h('label', { class: 'field' }, [h('span', { text: '当前方案（同场地可挂多套）' }), select]),
      h('div', { class: 'btn-row' }, [
        h('button', {
          class: 'btn ghost small',
          text: '+ 新建方案',
          onclick: () => {
            const nl = createLayout(venue.id, `方案 ${String.fromCharCode(65 + project.layoutIds.length)}`);
            store.mutate((db) => {
              db.layouts[nl.id] = nl;
              db.projects[project.id].layoutIds.push(nl.id);
            });
            router.go({ name: 'layout', projectId: project.id, layoutId: nl.id });
          },
        }),
        h('button', {
          class: 'btn ghost small',
          text: '复制当前方案',
          onclick: () => {
            const nl = structuredClone(l);
            nl.id = newId('lay');
            nl.name = l.name + ' 副本';
            store.mutate((db) => {
              db.layouts[nl.id] = nl;
              db.projects[project.id].layoutIds.push(nl.id);
            });
            toast('方案已复制');
            router.go({ name: 'layout', projectId: project.id, layoutId: nl.id });
          },
        }),
      ]),
    ]);
  }

  // ---------- 设备布置 ----------
  function objectsTab(l: Layout) {
    const panel = h('div', { class: 'panel' }, [
      h('h3', { text: '点声源/补声音箱' }),
      ...l.speakers.map((s) => speakerRow(s)),
      h('button', { class: 'btn', style: 'width:100%', text: '+ 新增点声源', onclick: () => addSpeaker(l) }),
    ]);
    const laPanel = h('div', { class: 'panel' }, [
      h('h3', { text: '线阵列' }),
      ...l.lineArrays.map((a) => lineArrayRow(a)),
      h('button', { class: 'btn', style: 'width:100%', text: '+ 新增线阵列', onclick: () => addLineArray(l) }),
    ]);
    const micPanel = h('div', { class: 'panel' }, [
      h('h3', { text: '话筒（啸叫分析）' }),
      ...l.microphones.map((m) => micRow(m)),
      h('button', { class: 'btn ghost', style: 'width:100%', text: '+ 新增话筒', onclick: () => addMic(l) }),
    ]);
    const mpPanel = h('div', { class: 'panel' }, [
      h('h3', { text: '测点（方案对比表）' }),
      ...l.measurePoints.map((p) =>
        h('div', { class: 'list-item', style: 'padding:6px 10px' }, [
          h('div', { style: 'display:flex;justify-content:space-between' }, [
            h('strong', { text: p.name }),
            h('button', {
              class: 'btn danger small',
              text: '×',
              onclick: () => mutate((x) => x.measurePoints = x.measurePoints.filter((q) => q.id !== p.id)),
            }),
          ]),
          h('div', { class: 'muted mono', style: 'font-size:11px', text: `(${fmt(p.position.x, 1)}, ${fmt(p.position.y, 1)}, ${fmt(p.position.z, 1)})` }),
        ]),
      ),
      h('button', {
        class: 'btn ghost small',
        style: 'width:100%',
        text: '+ 在观众区中心加测点',
        onclick: () => addMeasurePoint(),
      }),
    ]);
    sidebar.append(panel, laPanel, micPanel, mpPanel);
  }

  function speakerRow(s: PlacedSpeaker) {
    const model = models.get(s.speakerModelId);
    return h('div', { class: 'list-item' }, [
      h('div', { style: 'display:flex;justify-content:space-between' }, [
        h('strong', { text: s.name }),
        h('button', { class: 'btn danger small', text: '删除', onclick: () => mutate((x) => x.speakers = x.speakers.filter((q) => q.id !== s.id)) }),
      ]),
      h('div', { class: 'sub', text: model?.name ?? '未知型号' }),
      posEditor(s.position, (p) => mutate((x) => {
        const t = x.speakers.find((q) => q.id === s.id);
        if (t) t.position = p;
      })),
      h('div', { class: 'grid-2' }, [
        angleInput('方位角°', s.azimuth, (v) => mutate((x) => {
          const t = x.speakers.find((q) => q.id === s.id);
          if (t) t.azimuth = v;
        })),
        angleInput('俯仰角°', s.tilt, (v) => mutate((x) => {
          const t = x.speakers.find((q) => q.id === s.id);
          if (t) t.tilt = v;
        })),
      ]),
      ampBindingEditor(s.amp, (b) => mutate((x) => {
        const t = x.speakers.find((q) => q.id === s.id);
        if (t) t.amp = b;
      })),
      h('button', {
        class: 'btn ghost small',
        style: 'width:100%',
        text: s.dsp ? '编辑通道 DSP' : '配置通道 DSP',
        onclick: () => openDspModal(s.name, s.dsp, (dsp) => mutate((x) => {
          const t = x.speakers.find((q) => q.id === s.id);
          if (t) t.dsp = dsp;
        })),
      }),
    ]);
  }

  function lineArrayRow(a: LineArray) {
    const model = models.get(a.speakerModelId);
    return h('div', { class: 'list-item' }, [
      h('div', { style: 'display:flex;justify-content:space-between' }, [
        h('strong', { text: a.name }),
        h('button', { class: 'btn danger small', text: '删除', onclick: () => mutate((x) => x.lineArrays = x.lineArrays.filter((q) => q.id !== a.id)) }),
      ]),
      h('div', { class: 'sub', text: `${model?.name ?? ''} · ${a.interAngles.length} 只` }),
      posEditor(a.hangPoint, (p) => mutate((x) => {
        const t = x.lineArrays.find((q) => q.id === a.id);
        if (t) t.hangPoint = p;
      })),
      h('div', { class: 'btn-row' }, [
        h('button', {
          class: 'btn ghost small',
          text: `箱体数 ${a.interAngles.length} −`,
          onclick: () => mutate((x) => {
            const t = x.lineArrays.find((q) => q.id === a.id);
            if (t && t.interAngles.length > 1) t.interAngles.pop();
          }),
        }),
        h('button', {
          class: 'btn ghost small',
          text: '+ 加一只',
          onclick: () => mutate((x) => {
            const t = x.lineArrays.find((q) => q.id === a.id);
            if (t) t.interAngles.push(1);
          }),
        }),
      ]),
      ampBindingEditor(a.ampBindings[0] ?? { ampId: amps[0]?.id ?? '', channel: 1 }, (b) =>
        mutate((x) => {
          const t = x.lineArrays.find((q) => q.id === a.id);
          if (t) t.ampBindings = t.interAngles.map((_, i) => ({ ampId: b.ampId, channel: ((b.channel - 1 + i) % 8) + 1 }));
        }),
      ),
      h('button', {
        class: 'btn ghost small',
        style: 'width:100%',
        text: '整串通道 DSP',
        onclick: () => openDspModal(a.name, a.dsp, (dsp) => mutate((x) => {
          const t = x.lineArrays.find((q) => q.id === a.id);
          if (t) t.dsp = dsp;
        })),
      }),
    ]);
  }

  function micRow(m: Microphone) {
    return h('div', { class: 'list-item' }, [
      h('div', { style: 'display:flex;justify-content:space-between' }, [
        h('strong', { text: m.name }),
        h('button', { class: 'btn danger small', text: '×', onclick: () => mutate((x) => x.microphones = x.microphones.filter((q) => q.id !== m.id)) }),
      ]),
      posEditor(m.position, (p) => mutate((x) => {
        const t = x.microphones.find((q) => q.id === m.id);
        if (t) t.position = p;
      })),
      h('div', { class: 'grid-2' }, [
        angleInput('主轴方位°', m.azimuth, (v) => mutate((x) => {
          const t = x.microphones.find((q) => q.id === m.id);
          if (t) t.azimuth = v;
        })),
        angleInput('主轴俯仰°', m.tilt, (v) => mutate((x) => {
          const t = x.microphones.find((q) => q.id === m.id);
          if (t) t.tilt = v;
        })),
      ]),
    ]);
  }

  function posEditor(p: Vec3, onCommit: (p: Vec3) => void) {
    const mk = (axis: keyof Vec3, label: string) => {
      const input = h('input', { type: 'number', step: '0.1', value: String(p[axis]), style: 'width:100%' }) as HTMLInputElement;
      input.onchange = () => {
        const v = parseFloat(input.value);
        if (Number.isFinite(v)) onCommit({ ...p, [axis]: v });
      };
      return h('label', { class: 'field', style: 'margin-bottom:6px' }, [h('span', { text: label }), input]);
    };
    return h('div', { class: 'grid-3' }, [mk('x', 'X (m)'), mk('y', 'Y (m)'), mk('z', 'Z (m)')]);
  }

  function angleInput(label: string, value: number, onCommit: (v: number) => void) {
    const input = h('input', { type: 'number', step: '0.5', value: String(value) }) as HTMLInputElement;
    input.onchange = () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) onCommit(v);
    };
    return h('label', { class: 'field' }, [h('span', { text: label }), input]);
  }

  function ampBindingEditor(value: AmpChannelBinding, onCommit: (b: AmpChannelBinding) => void) {
    const ampSelect = h('select') as HTMLSelectElement;
    for (const a of amps) ampSelect.append(h('option', { value: a.id, text: a.name, selected: a.id === value.ampId ? '' : null }));
    const chInput = h('input', { type: 'number', min: '1', max: '8', value: String(value.channel), style: 'width:80px' }) as HTMLInputElement;
    ampSelect.onchange = () => onCommit({ ampId: ampSelect.value, channel: value.channel });
    chInput.onchange = () => onCommit({ ampId: value.ampId, channel: Math.max(1, parseInt(chInput.value) || 1) });
    return h('div', { class: 'grid-2' }, [
      h('label', { class: 'field' }, [h('span', { text: '绑定功放' }), ampSelect]),
      h('label', { class: 'field' }, [h('span', { text: '通道号' }), chInput]),
    ]);
  }

  function addSpeaker(l: Layout) {
    const model = store.listSpeakerModels().find((m) => !m.isLineArrayElement)!;
    const amp = amps[0];
    const s: PlacedSpeaker = {
      id: newId('sp'),
      name: `补声 ${l.speakers.length + 1}`,
      speakerModelId: model.id,
      position: { x: 2, y: venue.room.width / 2, z: venue.room.height - 1.5 },
      azimuth: 0,
      tilt: -12,
      amp: { ampId: amp.id, channel: 1 },
      dsp: defaultDsp(),
    };
    mutate((x) => x.speakers.push(s));
  }

  function addLineArray(l: Layout) {
    const model = store.listSpeakerModels().find((m) => m.isLineArrayElement)!;
    const amp = amps[0];
    const count = 6;
    const a: LineArray = {
      id: newId('la'),
      name: `线阵列 ${l.lineArrays.length + 1}`,
      hangPoint: { x: 1, y: venue.room.width / 2, z: venue.room.height - 0.5 },
      azimuth: 0,
      startTilt: -3,
      interAngles: Array(count).fill(1),
      speakerModelId: model.id,
      ampBindings: Array.from({ length: count }, (_, i) => ({ ampId: amp.id, channel: i + 1 })),
      riggingRatedLoadKg: 250,
      hangPointCount: 2,
      dsp: defaultDsp(),
    };
    mutate((x) => x.lineArrays.push(a));
  }

  function addMic(l: Layout) {
    const m: Microphone = {
      id: newId('mic'),
      name: `话筒 ${l.microphones.length + 1}`,
      position: { x: 1.5, y: venue.room.width / 2, z: 1.5 },
      azimuth: 0,
      tilt: 0,
    };
    mutate((x) => x.microphones.push(m));
  }

  function addMeasurePoint() {
    const area = venue.audienceAreas[0];
    const c = area ? polygonCentroid(area.polygon) : { x: 10, y: 7.5 };
    mutate((x) =>
      x.measurePoints.push({
        id: newId('mp'),
        name: `测点 ${x.measurePoints.length + 1}`,
        position: { x: c.x, y: c.y, z: area?.earHeight ?? 1.2 },
      }),
    );
  }

  // ---------- 信号流 ----------
  function signalTab(l: Layout) {
    const panel = h('div', { class: 'panel' });
    panel.append(
      signalFlowGraph(l, mutate, (edgeId) => {
        const edge = l.signalEdges.find((e) => e.id === edgeId);
        if (!edge) return;
        openDspModal('信号通道', edge.dsp, (dsp) =>
          mutate((x) => {
            const e = x.signalEdges.find((q) => q.id === edgeId);
            if (e) e.dsp = dsp;
          }),
        );
      }),
    );
    sidebar.append(panel);
  }

  function openDspModal(title: string, current: ChannelDsp | undefined, onSave: (dsp: ChannelDsp) => void) {
    let working = current ? structuredClone(current) : defaultDsp();
    const backdrop = h('div', { class: 'modal-backdrop' });
    const editorHost = h('div');
    const presets = store.listPresets();
    const draw = () => {
      editorHost.replaceChildren(
        dspEditor(
          working,
          (next) => {
            working = next;
            draw();
          },
          presets.map((p) => ({ name: p.name, dsp: p.dsp })),
          (name, dsp) => {
            store.mutate((db) => {
              db.presets[newId('preset')] = { id: newId('preset'), name, dsp: structuredClone(dsp), createdAt: Date.now() };
            });
            toast(`预设「${name}」已保存，可套用到其他通道`);
          },
        ),
      );
    };
    draw();
    backdrop.append(
      h('div', { class: 'modal' }, [
        h('h2', { text: `通道 DSP · ${title}` }),
        editorHost,
        h('div', { class: 'btn-row right', style: 'margin-top:14px' }, [
          h('button', { class: 'btn ghost', text: '取消', onclick: () => backdrop.remove() }),
          h('button', {
            class: 'btn',
            text: '保存',
            onclick: () => {
              onSave(working);
              backdrop.remove();
              toast('DSP 参数已保存');
            },
          }),
        ]),
      ]),
    );
    document.body.append(backdrop);
  }

  // ---------- 电平预算 ----------
  function levelsTab(l: Layout) {
    const instances = expandSpeakers(l.speakers, l.lineArrays, models);
    const panel = h('div', { class: 'panel' }, [
      h('h3', { text: '电平预算链路' }),
      h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' }, [
        '从节目源输出电平逐级推算到音箱声压，过载级在表中标红。',
      ]),
    ]);
    for (const chain of l.levelChains) {
      const target = instances.find((i) => i.uid === chain.targetSpeakerId || chain.targetSpeakerId.startsWith(i.uid));
      const result = analyzeLevelBudget(chain, target);
      panel.append(
        h('div', { class: 'panel', style: 'background:var(--bg-panel-2)' }, [
          h('div', { style: 'display:flex;justify-content:space-between' }, [
            h('strong', { text: chain.name }),
            h('button', {
              class: 'btn danger small',
              text: '删除链路',
              onclick: () => mutate((x) => x.levelChains = x.levelChains.filter((c) => c.id !== chain.id)),
            }),
          ]),
          h('table', { class: 'data', style: 'margin-top:8px' }, [
            h('thead', {}, [
              h('tr', {}, [
                h('th', { text: '级' }), h('th', { text: '输入 dBu' }), h('th', { text: '输出 dBu' }),
                h('th', { text: '额定 max' }), h('th', { text: '余量 dB' }), h('th', { text: '状态' }),
              ]),
            ]),
            h('tbody', {},
              result.stages.map((st) =>
                h('tr', {}, [
                  h('td', { text: st.name }),
                  h('td', { class: 'mono', text: fmt(st.inputDbu, 1) }),
                  h('td', { class: 'mono', text: fmt(st.outputDbu, 1) }),
                  h('td', { class: 'mono', text: fmt(st.maxOutputDbu, 1) }),
                  h('td', { class: `mono ${st.overloaded ? 'overload' : 'ok'}`, text: fmt(st.headroomDb, 1) }),
                  h('td', {}, [
                    st.overloaded
                      ? h('span', { class: 'badge danger', text: '过载' })
                      : st.limiting
                        ? h('span', { class: 'badge warn', text: '限幅中' })
                        : h('span', { class: 'badge ok', text: '正常' }),
                  ]),
                ]),
              ),
            ),
          ]),
          h('div', { class: 'muted', style: 'margin-top:6px;font-size:12px' }, [
            `音箱可达最大 SPL ${fmt(result.speakerMaxAchievableSpl, 1)} dB · 节目工作点 SPL ${fmt(result.speakerProgramSpl, 1)} dB`,
            result.firstOverloadIndex >= 0 ? ` · 最先过载：${result.stages[result.firstOverloadIndex].name}` : '',
          ]),
        ]),
      );
    }
    panel.append(
      h('button', {
        class: 'btn',
        style: 'width:100%',
        text: '+ 为第一个发声单元新建电平链路',
        onclick: () => {
          const first = instances[0];
          if (!first) return toast('请先布置音箱');
          mutate((x) => x.levelChains.push(defaultLevelChain(first.uid, `链路 ${x.levelChains.length + 1}`)));
        },
      }),
    );
    sidebar.append(panel);
  }

  renderSidebar();
  router.setMeta(`音箱布置 · ${layout.name}`);
}
