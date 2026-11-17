import { h, mount, button, selectInput, numInput, textInput, labeled, section, toast, badge } from '../dom';
import { store } from '../../state/store';
import { viewport, DEFAULT_SCENE_OPTS } from '../viewport';
import { defaultSurfaces } from '../../core/seed';
import { uid, pointInPolygon } from '../../core/math/vec3';
import type { Material, Surface, AudienceZone, Vec2 } from '../../core/types';

export function renderVenuePage(root: HTMLElement): void {
  const projectMaybe = store.currentProject;
  if (!projectMaybe) { mount(root, h('p', { class: 'muted' }, '请先在项目列表中选择一个项目。')); return; }
  const project: import('../../core/types').Project = projectMaybe;
  const project0 = project;
  const venue = project.venue;
  let selectedSurfaceId: string | null = venue.surfaces[0]?.id ?? null;
  let selectedZoneId: string | null = venue.audienceZones[0]?.id ?? null;
  let tab: 'room' | 'zone' | 'surface' | 'materials' = 'room';

  const save = () => store.saveProject().then(() => toast('场地已保存'));

  const rebuild = () => render();

  const sidePanel = (): HTMLElement => {
    const tabs = h('div', { class: 'tabs' },
      ...([['room', '房间'], ['zone', '观众区'], ['surface', '墙面材料'], ['materials', '材料库']] as const).map(([k, label]) =>
        h('button', { class: `tab ${tab === k ? 'active' : ''}`, onclick: () => { tab = k; rebuild(); } }, label)
      )
    );

    let body: HTMLElement;
    if (tab === 'room') {
      body = section('房间净尺寸（米）',
        labeled('宽度 W（x 向）', numInput(venue.width, (v) => { venue.width = Math.max(4, v); resizeRoom(); }, 0.5, 4, 200)),
        labeled('长度 L（y 向）', numInput(venue.length, (v) => { venue.length = Math.max(4, v); resizeRoom(); }, 0.5, 4, 200)),
        labeled('高度 H（z 向）', numInput(venue.height, (v) => { venue.height = Math.max(2.5, v); resizeRoom(); }, 0.5, 2.5, 40)),
        h('p', { class: 'muted' }, `房间容积 ${(venue.width * venue.length * venue.height).toFixed(0)} m³，内表面积 ${innerArea().toFixed(0)} m²`),
        button('保存修改', save, 'primary')
      );
    } else if (tab === 'zone') {
      const zone = venue.audienceZones.find((z) => z.id === selectedZoneId) ?? venue.audienceZones[0];
      body = section('观众区多边形',
        h('div', { class: 'toolbar', style: { marginBottom: '10px' } },
          ...venue.audienceZones.map((z) =>
            h('button', { class: `btn btn-sm ${z.id === zone?.id ? 'btn-primary' : ''}`, onclick: () => { selectedZoneId = z.id; rebuild(); } }, z.name)
          ),
          button('+ 新区', () => {
            const nz: AudienceZone = { id: uid('zone'), name: `观众区 ${venue.audienceZones.length + 1}`, earHeight: 1.2, polygon: [{ x: 4, y: 8 }, { x: venue.width - 4, y: 8 }, { x: venue.width - 3, y: venue.length - 3 }, { x: 3, y: venue.length - 3 }] };
            venue.audienceZones.push(nz); selectedZoneId = nz.id; rebuild();
          }, 'primary')
        ),
        zone ? h('div', {},
          labeled('名称', textInput(zone.name, (v) => { zone.name = v; })),
          labeled('人耳高度 m', numInput(zone.earHeight, (v) => { zone.earHeight = Math.max(0.8, Math.min(2, v)); }, 0.05)),
          h('p', { class: 'muted' }, '在 3D 视图中单击地面可向当前观众区追加顶点；拖动下方列表可精确编辑坐标。'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
            h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'X (m)'), h('th', {}, 'Y (m)'), h('th', {}, ''))),
            h('tbody', {}, ...zone.polygon.map((p, i) => h('tr', {},
              h('td', {}, String(i + 1)),
              h('td', {}, numInput(p.x, (v) => { p.x = v; }, 0.1)),
              h('td', {}, numInput(p.y, (v) => { p.y = v; }, 0.1)),
              h('td', {}, button('删', () => { if (zone.polygon.length > 3) { zone.polygon.splice(i, 1); rebuild(); } }, 'danger'))
            )))
          )),
          h('div', { class: 'toolbar', style: { marginTop: '8px' } },
            button('矩形重置', () => { zone.polygon = [{ x: 3, y: 8 }, { x: venue.width - 3, y: 8 }, { x: venue.width - 2, y: venue.length - 2 }, { x: 2, y: venue.length - 2 }]; rebuild(); }),
            button('删除该区', () => { const i = venue.audienceZones.indexOf(zone); if (i >= 0 && venue.audienceZones.length > 1) { venue.audienceZones.splice(i, 1); selectedZoneId = venue.audienceZones[0].id; rebuild(); } }, 'danger')
          )
        ) : h('p', { class: 'muted' }, '暂无观众区')
      );
    } else if (tab === 'surface') {
      const surface = venue.surfaces.find((s) => s.id === selectedSurfaceId);
      body = section('墙面 / 地面 / 顶棚材料',
        h('div', { class: 'toolbar', style: { marginBottom: '10px' } },
          ...venue.surfaces.map((s) => h('button', { class: `btn btn-sm ${s.id === selectedSurfaceId ? 'btn-primary' : ''}`, onclick: () => { selectedSurfaceId = s.id; rebuild(); } }, s.name))
        ),
        surface ? h('div', {},
          labeled('吸声材料', selectInput(store.state.library.materials.map((m) => ({ value: m.id, label: `${m.name}（α₅₀₀=${m.absorption[3]}）` })), surface.materialId, (v) => { surface.materialId = v; rebuild(); })),
          materialPreview(surface.materialId)
        ) : h('p', { class: 'muted' }, '请选择一个面')
      );
    } else {
      body = section('材料库（可自定义新材料）',
        h('div', { class: 'toolbar', style: { marginBottom: '10px' } },
          button('+ 新增材料', () => {
            const mat: Material = { id: uid('mat'), name: '新材料', category: '自定义', builtin: false, absorption: [0.1, 0.2, 0.3, 0.4, 0.5, 0.5, 0.4, 0.3] };
            store.state.library.materials.push(mat);
            store.saveLibrary().then(() => rebuild());
          }, 'primary')
        ),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
          h('thead', {}, h('tr', {}, h('th', {}, '材料'), h('th', {}, '类别'), h('th', {}, '125'), h('th', {}, '250'), h('th', {}, '500'), h('th', {}, '1k'), h('th', {}, '2k'), h('th', {}, '4k'), h('th', {}, ''))),
          h('tbody', {}, ...store.state.library.materials.map((m) => h('tr', {},
            h('td', {}, m.name, m.builtin ? badge('内置', 'info') : badge('自定义', 'warn')),
            h('td', {}, m.category),
            ...m.absorption.slice(1, 7).map((a) => h('td', { class: a > 0.6 ? 'cell-ok' : '' }, a.toFixed(2))),
            h('td', {}, m.builtin ? '' : button('编辑', () => editMaterial(m), 'primary'))
          )))
        ))
      );
    }
    return h('div', { class: 'inspector' }, tabs, body);
  };

  const materialPreview = (materialId: string): HTMLElement => {
    const m = store.state.library.materials.find((x) => x.id === materialId);
    if (!m) return h('div', {});
    return h('div', { style: { marginTop: '8px' } },
      h('div', { class: 'kv' }, h('span', {}, '类别'), h('span', {}, m.category)),
      h('div', { class: 'muted', style: { marginTop: '6px' } }, '各倍频程带吸声系数 α：'),
      h('div', { class: 'field-row-3', style: { marginTop: '6px' } },
        ...[63, 125, 250, 500, 1000, 2000].map((f, i) => h('div', { class: 'field' }, h('span', { class: 'field-label' }, `${f}Hz`), h('span', { class: 'mono' }, m.absorption[i].toFixed(2))))
      )
    );
  };

  const editMaterial = (m: Material) => {
    const mask = h('div', { class: 'modal-mask', onclick: (e: Event) => { if (e.target === mask) mask.remove(); } });
    const inputs = m.absorption.map((a, i) => labeled(`${[63, 125, 250, 500, 1000, 2000, 4000, 8000][i]}Hz`, numInput(a, (v) => { m.absorption[i] = Math.min(0.99, Math.max(0.01, v)); }, 0.01, 0.01, 0.99)));
    mask.append(h('div', { class: 'modal' },
      h('h3', {}, '编辑材料'),
      labeled('名称', textInput(m.name, (v) => { m.name = v; })),
      labeled('类别', textInput(m.category, (v) => { m.category = v; })),
      h('div', { class: 'field-row-3' }, ...inputs),
      h('div', { class: 'toolbar', style: { marginTop: '12px' } },
        button('保存', () => { store.saveLibrary().then(() => { mask.remove(); rebuild(); toast('材料已保存'); }); }, 'primary'),
        button('取消', () => mask.remove())
      )
    ));
    document.body.append(mask);
  };

  const resizeRoom = () => {
    // 尺寸变化后重建盒体面（保留材料绑定）
    const oldMap = new Map(venue.surfaces.map((s) => [s.boxFace, s.materialId]));
    const fresh = defaultSurfaces(venue.width, venue.length, venue.height);
    for (const s of fresh) if (oldMap.has(s.boxFace)) s.materialId = oldMap.get(s.boxFace)!;
    venue.surfaces = fresh;
  };

  const innerArea = () => {
    const { width: w, length: l, height: hh } = venue;
    return 2 * (w * l + w * hh + l * hh);
  };

  function render() {
    const { el } = viewport(
      project,
      () => null,
      () => null,
      store.state.library,
      () => ({ ...DEFAULT_SCENE_OPTS, showCoverage: false }),
      (pick) => {
        if (pick && tab === 'zone') {
          const zone = venue.audienceZones.find((z) => z.id === selectedZoneId);
          if (zone) {
            const p2: Vec2 = { x: Math.round(pick.point.x * 10) / 10, y: Math.round(pick.point.y * 10) / 10 };
            if (!pointInPolygon(p2, zone.polygon)) {
              zone.polygon.push(p2);
              toast(`已追加顶点 (${p2.x}, ${p2.y})`);
              rebuild();
            }
          }
        }
      }
    );
    mount(root, h('div', { class: 'layout-split' }, el, sidePanel()));
  }
  render();
}
