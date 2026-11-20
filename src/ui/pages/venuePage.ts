import { BAND_FREQS, type Material, type Project, type RoomSurface } from '../../core/types';
import { newId } from '../../core/types';
import { roomFaces, sabineRT60, roomVolume } from '../../core/roomAcoustics';
import { store } from '../../state/store';
import { h, clear, toast, drawBarChart, fmt } from '../dom';
import { View3D } from '../../webgl/View3D';
import type { Router } from '../router';

const FACE_NAMES = ['地面', '顶棚', '西侧墙', '东侧墙', '舞台后墙', '观众厅后墙'];

export function renderVenuePage(host: HTMLElement, router: Router, project: Project): void {
  if (!project.venueId) {
    host.append(h('div', { class: 'content scroll' }, [h('div', { class: 'panel', text: '项目缺少场地数据' })]));
    return;
  }
  const venue = store.getVenue(project.venueId)!;
  const sidebar = h('div', { class: 'sidebar wide' });
  const content = h('div', { class: 'content' });
  host.append(sidebar, content);

  const canvas = h('canvas') as HTMLCanvasElement;
  const viewport = h('div', { class: 'viewport' }, [canvas]);
  content.append(viewport);
  const view = new View3D(canvas);
  const layout = store.getLayout(project.layoutIds[0] ?? '');
  view.setData(
    venue,
    layout ?? blankLayout(venue.id),
    store.listSpeakerModels(),
    store.listMaterials(),
  );
  view.setOptions({ showRoom: true, showAudience: true, showSpeakers: false, showMicrophones: false });

  const rtPanel = h('div', { class: 'overlay-hud' });
  viewport.append(rtPanel);

  const refreshView = () => {
    const v = store.getVenue(venue.id)!;
    view.setData(v, layout ?? blankLayout(v.id), store.listSpeakerModels(), store.listMaterials());
  };

  const renderRt = () => {
    clear(rtPanel);
    const v = store.getVenue(venue.id)!;
    const mats = new Map(store.listMaterials().map((m) => [m.id, m]));
    const rt = sabineRT60(v.room, mats);
    const chart = h('canvas', { class: 'chart-canvas', style: 'height:140px' }) as HTMLCanvasElement;
    rtPanel.append(
      h('div', { style: 'margin-bottom:6px;font-weight:600' }, [
        `赛宾 RT60（容积 ${fmt(roomVolume(v.room), 0)} m³）`,
      ]),
      chart,
      h('div', { class: 'muted', style: 'margin-top:6px' }, [
        `中频 RT60：${fmt((rt[500] + rt[1000]) / 2, 2)} s`,
      ]),
    );
    requestAnimationFrame(() =>
      drawBarChart(
        chart,
        BAND_FREQS.map((f) => ({ label: String(f), value: rt[f], color: '#4f9cf9' })),
        { unit: 's' },
      ),
    );
  };

  const renderSidebar = () => {
    clear(sidebar);
    const v = store.getVenue(venue.id)!;
    sidebar.append(
      h('div', { class: 'panel' }, [
        h('h3', { text: '房间尺寸（米）' }),
        dimInput('长度 L（舞台→观众厅）', v.room.length, (val) =>
          updateRoom(v.id, (r) => (r.length = val)),
        ),
        dimInput('宽度 W', v.room.width, (val) => updateRoom(v.id, (r) => (r.width = val))),
        dimInput('高度 H', v.room.height, (val) => updateRoom(v.id, (r) => (r.height = val))),
      ]),
      surfacePanel(v),
      audiencePanel(v),
      materialLibraryPanel(),
    );
  };

  function dimInput(label: string, value: number, onCommit: (v: number) => void) {
    const input = h('input', { type: 'number', step: '0.1', min: '1', value: String(value) }) as HTMLInputElement;
    input.onchange = () => {
      const val = parseFloat(input.value);
      if (Number.isFinite(val) && val > 0) onCommit(val);
    };
    return h('label', { class: 'field' }, [h('span', { text: label }), input]);
  }

  function updateRoom(venueId: string, fn: (r: import('../../core/types').Room) => void) {
    store.mutate((db) => {
      const ven = db.venues[venueId];
      fn(ven.room);
      ven.updatedAt = Date.now();
    });
    refreshView();
    renderRt();
  }

  function surfacePanel(v: typeof venue) {
    const mats = store.listMaterials();
    const faces = roomFaces(v.room);
    return h('div', { class: 'panel' }, [
      h('h3', { text: '墙面材料（吸声系数）' }),
      ...faces.map((face, i) => {
        const select = h('select') as HTMLSelectElement;
        for (const m of mats) {
          select.append(h('option', { value: m.id, text: m.name, selected: m.id === face.materialId ? '' : null }));
        }
        select.onchange = () => {
          store.mutate((db) => {
            const ven = db.venues[v.id];
            const surf: RoomSurface | undefined = ven.room.surfaces[i];
            if (surf) surf.materialId = select.value;
            ven.updatedAt = Date.now();
          });
          renderRt();
          renderSidebar();
        };
        const mat = mats.find((m) => m.id === face.materialId);
        return h('label', { class: 'field' }, [
          h('span', { text: FACE_NAMES[i] + `（${fmt(face.area, 1)} m²）` }),
          select,
          h('div', { class: 'muted mono', style: 'font-size:11px;margin-top:3px' }, [
            mat ? `α: ${BAND_FREQS.map((f) => fmt(mat.absorption[f], 2)).join(' / ')}` : '',
          ]),
        ]);
      }),
    ]);
  }

  function audiencePanel(v: typeof venue) {
    const area = v.audienceAreas[0];
    if (!area) return h('div', { class: 'panel' }, [h('h3', { text: '观众区' }), h('div', { class: 'muted', text: '无观众区' })]);
    const points = area.polygon;
    const rows = points.map((p, i) =>
      h('div', { style: 'display:flex;gap:6px;align-items:center;margin-bottom:6px' }, [
        h('span', { class: 'muted', style: 'width:18px', text: `P${i + 1}` }),
        numSmall(p.x, (x) => updatePoly(i, { x, y: points[i].y })),
        numSmall(p.y, (y) => updatePoly(i, { x: points[i].x, y })),
        h('button', {
          class: 'btn danger small',
          text: '×',
          onclick: () => {
            if (points.length <= 3) return toast('多边形至少保留 3 个顶点');
            store.mutate((db) => {
              db.venues[v.id].audienceAreas[0].polygon.splice(i, 1);
            });
            refreshView();
            renderSidebar();
          },
        }),
      ]),
    );
    return h('div', { class: 'panel' }, [
      h('h3', { text: '观众区多边形（俯视 x/y，米）' }),
      h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:8px' }, [
        '在三维视图中绿色线框即观众区，测点取耳高平面。',
      ]),
      ...rows,
      h('div', { class: 'btn-row' }, [
        h('button', {
          class: 'btn ghost small',
          text: '+ 添加顶点',
          onclick: () => {
            const last = points[points.length - 1];
            store.mutate((db) => {
              db.venues[v.id].audienceAreas[0].polygon.push({ x: last.x - 1, y: last.y + 1 });
            });
            refreshView();
            renderSidebar();
          },
        }),
        dimInput('耳高（米）', area.earHeight, (val) => {
          store.mutate((db) => (db.venues[v.id].audienceAreas[0].earHeight = val));
          refreshView();
        }),
      ]),
    ]);
  }

  function updatePoly(index: number, p: { x: number; y: number }) {
    store.mutate((db) => {
      const poly = db.venues[venue.id].audienceAreas[0].polygon;
      poly[index] = p;
    });
    refreshView();
  }

  function numSmall(value: number, onCommit: (v: number) => void) {
    const input = h('input', { type: 'number', step: '0.1', value: String(value), style: 'width:90px' }) as HTMLInputElement;
    input.onchange = () => {
      const val = parseFloat(input.value);
      if (Number.isFinite(val)) onCommit(val);
    };
    return input;
  }

  function materialLibraryPanel() {
    const panel = h('div', { class: 'panel' }, [
      h('h3', { text: '材料库（支持自定义）' }),
    ]);
    const list = h('div');
    for (const m of store.listMaterials()) {
      list.append(
        h('div', { class: 'list-item', style: 'padding:8px 10px' }, [
          h('div', { style: 'display:flex;justify-content:space-between' }, [
            h('strong', { text: m.name }),
            m.builtin ? h('span', { class: 'badge ok', text: '内置' }) : h('span', { class: 'badge warn', text: '自定义' }),
          ]),
          h('div', { class: 'btn-row', style: 'margin-top:6px' }, [
            h('button', { class: 'btn ghost small', text: '编辑', onclick: () => editMaterial(m) }),
            !m.builtin
              ? h('button', {
                  class: 'btn danger small',
                  text: '删除',
                  onclick: () => {
                    store.mutate((db) => delete db.materials[m.id]);
                    toast('材料已删除');
                    renderSidebar();
                    renderRt();
                  },
                })
              : null,
          ]),
        ]),
      );
    }
    panel.append(
      list,
      h('button', {
        class: 'btn',
        style: 'width:100%',
        text: '+ 新增材料',
        onclick: () => editMaterial(null),
      }),
    );
    return panel;
  }

  function editMaterial(existing: Material | null) {
    const mat: Material = existing
      ? structuredClone(existing)
      : {
          id: newId('mat'),
          name: '新材料',
          absorption: Object.fromEntries(BAND_FREQS.map((f) => [f, 0.2])) as Material['absorption'],
        };
    const nameInput = h('input', { value: mat.name }) as HTMLInputElement;
    const backdrop = h('div', { class: 'modal-backdrop' });
    const bandInputs = BAND_FREQS.map((f) => {
      const input = h('input', {
        type: 'number',
        step: '0.01',
        min: '0',
        max: '1',
        value: String(mat.absorption[f]),
      }) as HTMLInputElement;
      input.oninput = () => {
        const val = Math.min(1, Math.max(0, parseFloat(input.value) || 0));
        mat.absorption[f] = val;
      };
      return h('label', { class: 'field', style: 'margin:0' }, [h('span', { text: `${f}Hz α` }), input]);
    });
    backdrop.append(
      h('div', { class: 'modal' }, [
        h('h2', { text: existing ? '编辑材料' : '新增材料' }),
        h('label', { class: 'field' }, [h('span', { text: '材料名称' }), nameInput]),
        h('div', { class: 'grid-3' }, bandInputs),
        h('div', { class: 'btn-row right', style: 'margin-top:14px' }, [
          h('button', { class: 'btn ghost', text: '取消', onclick: () => backdrop.remove() }),
          h('button', {
            class: 'btn',
            text: '保存',
            onclick: () => {
              mat.name = nameInput.value.trim() || mat.name;
              store.mutate((db) => (db.materials[mat.id] = mat));
              backdrop.remove();
              toast('材料已保存');
              renderSidebar();
              renderRt();
            },
          }),
        ]),
      ]),
    );
    document.body.append(backdrop);
  }

  renderSidebar();
  renderRt();
  router.setMeta(`场地建模 · ${venue.name}`);
}

function blankLayout(venueId: string): import('../../core/types').Layout {
  return {
    id: 'blank',
    venueId,
    name: '',
    speakers: [],
    lineArrays: [],
    microphones: [],
    signalNodes: [],
    signalEdges: [],
    levelChains: [],
    measurePoints: [],
    createdAt: 0,
    updatedAt: 0,
  };
}
