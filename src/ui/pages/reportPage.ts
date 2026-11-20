import { BAND_FREQS, type Project } from '../../core/types';
import { store } from '../../state/store';
import { generateBom } from '../../core/bom';
import { sabineRT60, roomVolume, roomFaces } from '../../core/roomAcoustics';
import { analyzeRigging } from '../../core/rigging';
import { expandSpeakers } from '../../core/speakers';
import { analyzeGrid } from '../../core/analysis';
import { audienceSeatGrid } from '../../core/factory';
import { h, fmt, toast, downloadText, drawBarChart } from '../dom';
import { router, type Router } from '../router';

export function renderReportPage(host: HTMLElement, _router: Router, project: Project, layoutId: string): void {
  if (!project.venueId) return;
  const venue = store.getVenue(project.venueId)!;
  const layout = store.getLayout(layoutId)!;
  const root = h('div', { class: 'content scroll', id: 'report-root' });
  host.append(root);

  const materials = new Map(store.listMaterials().map((m) => [m.id, m]));
  const speakerModels = new Map(store.listSpeakerModels().map((m) => [m.id, m]));
  const ampModels = new Map(store.listAmpModels().map((m) => [m.id, m]));
  const bom = generateBom(layout, speakerModels, ampModels, venue.room.length);
  const rt60 = sabineRT60(venue.room, materials);
  const speakers = expandSpeakers(layout.speakers, layout.lineArrays, speakerModels);
  const seats = audienceSeatGrid(venue, 2);
  const grid = analyzeGrid(seats, speakers);

  // 方案切换
  const select = h('select') as HTMLSelectElement;
  for (const id of project.layoutIds) {
    const opt = store.getLayout(id);
    select.append(h('option', { value: id, text: opt?.name ?? id, selected: id === layoutId ? '' : null }));
  }
  select.onchange = () => router.go({ name: 'report', projectId: project.id, layoutId: select.value });

  root.append(
    h('div', { class: 'panel', style: 'display:flex;justify-content:space-between;align-items:center' }, [
      h('div', {}, [
        h('h3', { text: '扩声系统设计报告', style: 'margin:0 0 4px' }),
        h('div', { class: 'muted', text: `${project.name} · ${venue.name} · ${layout.name} · 生成于 ${new Date().toLocaleString('zh-CN')}` }),
      ]),
      h('div', { class: 'btn-row' }, [
        h('label', { class: 'field', style: 'margin:0;min-width:180px' }, [h('span', { text: '方案' }), select]),
        h('button', { class: 'btn ghost', text: '打印 / 另存 PDF', onclick: () => window.print() }),
        h('button', { class: 'btn', text: '导出 JSON 报告', onclick: () => exportJson() }),
      ]),
    ]),
  );

  // 1. 项目与场地概要
  root.append(
    h('div', { class: 'panel' }, [
      h('h3', { text: '1. 场地概要' }),
      h('div', { class: 'grid-3' }, [
        stat(`${venue.room.length}×${venue.room.width}×${venue.room.height} m`, '房间尺寸 (L×W×H)'),
        stat(fmt(roomVolume(venue.room), 0) + ' m³', '房间容积'),
        stat(fmt((rt60[500] + rt60[1000]) / 2, 2) + ' s', '中频 RT60（赛宾）'),
        stat(String(venue.audienceAreas.length), '观众区数量'),
        stat(fmt(grid.average, 1) + ' dB', '平均观众区 SPL'),
        stat(fmt(grid.uniformityDb, 1) + ' dB', '声场不均匀度'),
      ]),
      surfaceTable(),
    ]),
  );

  // 2. RT60 图
  const rtCanvas = h('canvas', { class: 'chart-canvas', style: 'height:200px' }) as HTMLCanvasElement;
  root.append(
    h('div', { class: 'panel' }, [
      h('h3', { text: '2. 各倍频程混响时间 RT60' }),
      rtCanvas,
    ]),
  );
  requestAnimationFrame(() =>
    drawBarChart(
      rtCanvas,
      BAND_FREQS.map((f) => ({ label: String(f), value: rt60[f], color: '#4f9cf9' })),
      { unit: 's' },
    ),
  );

  // 3. 设备清单（按类别 + 区域分组）
  const categories = ['音箱', '功放', '吊挂件', '线缆'] as const;
  const bomPanels: (HTMLElement | null)[] = categories.map((cat) => {
    const lines = bom.lines.filter((l) => l.category === cat);
    if (!lines.length) return null;
    return h('div', { class: 'panel' }, [
      h('h3', { text: `3. 设备清单 · ${cat}（按区域分组核对）` }),
      h('table', { class: 'data' }, [
        h('thead', {}, [
          h('tr', {}, [
            h('th', { text: '型号' }), h('th', { text: '厂商' }), h('th', { text: '数量' }),
            h('th', { text: '单位' }), h('th', { text: '区域' }), h('th', { text: '功耗 W' }), h('th', { text: '重量 kg' }),
          ]),
        ]),
        h('tbody', {},
          lines.map((l) =>
            h('tr', {}, [
              h('td', { text: l.model }), h('td', { text: l.manufacturer }),
              h('td', { class: 'mono', text: String(l.quantity) }), h('td', { text: l.unit }),
              h('td', { text: l.zone }),
              h('td', { class: 'mono', text: l.powerW ? String(l.powerW) : '—' }),
              h('td', { class: 'mono', text: l.weightKg ? fmt(l.weightKg, 1) : '—' }),
            ]),
          ),
        ),
      ]),
    ]);
  });
  root.append(...bomPanels.filter((x): x is HTMLElement => x instanceof HTMLElement));

  // 4. 功耗与吊挂汇总
  root.append(
    h('div', { class: 'panel' }, [
      h('h3', { text: '4. 系统功耗与吊挂总重' }),
      h('div', { class: 'grid-3' }, [
        stat(bom.totalPowerW + ' W', '设备总功耗（实测口径）'),
        stat(bom.recommendedPowerW + ' W', '建议配电容量（含 20% 余量）'),
        stat(fmt(bom.totalRiggingWeightKg, 1) + ' kg', '吊挂总重（音箱+挂件）'),
        stat(String(bom.speakerCount), '发声单元总数'),
      ]),
    ]),
  );

  // 5. 吊挂校核汇总
  if (layout.lineArrays.length) {
    root.append(
      h('div', { class: 'panel' }, [
        h('h3', { text: '5. 线阵列吊挂校核' }),
        h('table', { class: 'data' }, [
          h('thead', {}, [
            h('tr', {}, [
              h('th', { text: '线阵列' }), h('th', { text: '箱数' }), h('th', { text: '总重 kg' }),
              h('th', { text: '最大吊点载荷 kg' }), h('th', { text: '额定 kg' }), h('th', { text: '利用率' }), h('th', { text: '状态' }),
            ]),
          ]),
          h('tbody', {},
            layout.lineArrays.map((a) => {
              const model = speakerModels.get(a.speakerModelId)!;
              const r = analyzeRigging(a, model);
              return h('tr', {}, [
                h('td', { text: a.name }),
                h('td', { class: 'mono', text: String(r.cabinetCount) }),
                h('td', { class: 'mono', text: fmt(r.totalWeightKg, 1) }),
                h('td', { class: 'mono', text: fmt(r.maxPointLoadKg, 1) }),
                h('td', { class: 'mono', text: String(a.riggingRatedLoadKg) }),
                h('td', { class: 'mono', text: fmt(r.utilizationPct, 0) + '%' }),
                h('td', {}, [
                  r.overloaded
                    ? h('span', { class: 'badge danger', text: '过载' })
                    : r.utilizationPct > 80
                      ? h('span', { class: 'badge warn', text: '偏高' })
                      : h('span', { class: 'badge ok', text: '合格' }),
                ]),
              ]);
            }),
          ),
        ]),
      ]),
    );
  }

  // 6. 墙面材料与吸声
  function surfaceTable() {
    const faces = roomFaces(venue.room);
    return h('details', { open: '' }, [
      h('summary', { style: 'cursor:pointer;margin:8px 0;font-weight:600' }, ['墙面材料与吸声系数明细']),
      h('table', { class: 'data' }, [
        h('thead', {}, [
          h('tr', {}, [
            h('th', { text: '表面' }), h('th', { text: '材料' }), h('th', { text: '面积 m²' }),
            ...BAND_FREQS.map((f) => h('th', { text: `${f}Hz α` })),
          ]),
        ]),
        h('tbody', {},
          faces.map((face, i) => {
            const mat = materials.get(face.materialId);
            const labels = ['地面', '顶棚', '西侧墙', '东侧墙', '舞台后墙', '观众厅后墙'];
            return h('tr', {}, [
              h('td', { text: labels[i] }),
              h('td', { text: mat?.name ?? '—' }),
              h('td', { class: 'mono', text: fmt(face.area, 1) }),
              ...BAND_FREQS.map((f) => h('td', { class: 'mono', text: fmt(mat?.absorption[f] ?? 0, 2) })),
            ]);
          }),
        ),
      ]),
    ]);
  }

  function exportJson() {
    const report = {
      generatedAt: new Date().toISOString(),
      project: { name: project.name, description: project.description },
      venue: { name: venue.name, room: venue.room, volume: roomVolume(venue.room) },
      layout: layout.name,
      rt60,
      bom,
      field: {
        averageSpl: grid.average,
        uniformityDb: grid.uniformityDb,
        seatCount: seats.length,
      },
      rigging: layout.lineArrays.map((a) => {
        const model = speakerModels.get(a.speakerModelId)!;
        return { name: a.name, ...analyzeRigging(a, model) };
      }),
    };
    downloadText(`report-${layout.name}.json`, JSON.stringify(report, null, 2));
    toast('报告 JSON 已导出');
  }

  router.setMeta(`报告 · ${layout.name}`);
}

function stat(num: string, label: string): HTMLElement {
  return h('div', { class: 'stat' }, [h('div', { class: 'num', style: 'font-size:17px', text: num }), h('div', { class: 'lbl', text: label })]);
}
