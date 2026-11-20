import type { Layout, LineArray, SpeakerModel } from '../../core/types';
import { analyzeRigging, suggestSplay } from '../../core/rigging';
import { lineArrayElementsWorld } from '../../core/speakers';
import { h, fmt, toast } from '../dom';

/** 线阵列吊挂物理校核面板 */
export function riggingPanel(
  layout: Layout,
  models: Map<string, SpeakerModel>,
  onMutate: (fn: (l: Layout) => void) => void,
  getNearFar: () => { near: import('../../core/types').Vec3; far: import('../../core/types').Vec3 } | null,
): HTMLElement {
  const root = h('div');

  function render() {
    root.replaceChildren();
    if (layout.lineArrays.length === 0) {
      root.append(h('div', { class: 'muted', text: '当前方案还没有线阵列。在左侧「新增线阵列」后这里会显示吊挂校核。' }));
      return;
    }
    for (const array of layout.lineArrays) {
      const model = models.get(array.speakerModelId);
      if (!model) continue;
      const report = analyzeRigging(array, model);
      const elements = lineArrayElementsWorld(array, model);
      root.append(
        h('div', { class: 'panel' }, [
          h('div', { style: 'display:flex;justify-content:space-between;align-items:center' }, [
            h('h3', { text: `吊挂校核 · ${array.name}`, style: 'margin:0' }),
            h('span', {
              class: `badge ${report.overloaded ? 'danger' : report.utilizationPct > 80 ? 'warn' : 'ok'}`,
              text: report.overloaded ? '过载报警' : `利用率 ${fmt(report.utilizationPct, 0)}%`,
            }),
          ]),
          h('div', { class: 'grid-3', style: 'margin-top:10px' }, [
            stat(report.cabinetCount, '箱体数（只）'),
            stat(fmt(report.totalWeightKg, 1), '整串总重 (kg)'),
            stat(fmt(report.factoredLoadPerPointKg, 1), '单吊点均载×1.25 (kg)'),
            stat(fmt(report.maxPointLoadKg, 1), '最大吊点载荷 (kg)'),
            stat(fmt(report.cgOffsetHorizontal, 2), '重心水平偏移 (m)'),
            stat(fmt(array.riggingRatedLoadKg, 0), '吊具额定 (kg)'),
          ]),
          h('div', { class: 'muted', style: 'font-size:12px;margin:8px 0' }, [
            `重心坐标 (${fmt(report.centerOfGravity.x, 2)}, ${fmt(report.centerOfGravity.y, 2)}, ${fmt(report.centerOfGravity.z, 2)}) m`,
          ]),
          report.warnings.length
            ? h('div', { style: 'color:var(--warn);font-size:12.5px;line-height:1.7' },
                report.warnings.map((w) => h('div', { text: '⚠ ' + w })))
            : h('div', { class: 'badge ok', text: '✓ 全部校核通过' }),
          h('h3', { text: '逐只夹角（度，正值=向下张开）', style: 'margin-top:14px' }),
          h('div', { class: 'grid-3' },
            array.interAngles.map((angle, i) => {
              const input = h('input', {
                type: 'number',
                step: '0.1',
                value: String(angle),
              }) as HTMLInputElement;
              input.onchange = () => {
                const v = parseFloat(input.value);
                if (!Number.isFinite(v)) return;
                onMutate((l) => {
                  const a = l.lineArrays.find((x) => x.id === array.id);
                  if (a) a.interAngles[i] = v;
                });
                render();
              };
              return h('label', { class: 'field' }, [
                h('span', { text: `#${i + 1}→#${i + 2}` }),
                input,
              ]);
            }),
          ),
          h('div', { class: 'grid-2' }, [
            angleField('起始俯仰角 (°)', array.startTilt, (v) =>
              patch(array.id, (a) => (a.startTilt = v))),
            angleField('方位角 (°)', array.azimuth, (v) =>
              patch(array.id, (a) => (a.azimuth = v))),
            angleField('吊点数量', array.hangPointCount, (v) =>
              patch(array.id, (a) => (a.hangPointCount = Math.max(1, Math.round(v)))), true),
            angleField('吊具额定载荷 (kg)', array.riggingRatedLoadKg, (v) =>
              patch(array.id, (a) => (a.riggingRatedLoadKg = v)), true),
          ]),
          h('div', { class: 'btn-row' }, [
            h('button', {
              class: 'btn',
              text: '按观众区前后排反推张角',
              onclick: () => applySuggestion(array, model),
            }),
            h('button', {
              class: 'btn ghost small',
              text: `最下一只俯角 ${fmt(elements[elements.length - 1]?.tilt ?? 0, 1)}°`,
              disabled: '',
            }),
          ]),
        ]),
      );
    }
  }

  function patch(id: string, fn: (a: LineArray) => void) {
    onMutate((l) => {
      const a = l.lineArrays.find((x) => x.id === id);
      if (a) fn(a);
    });
    render();
  }

  function angleField(label: string, value: number, onCommit: (v: number) => void, integer = false) {
    const input = h('input', {
      type: 'number',
      step: integer ? '1' : '0.1',
      value: String(value),
    }) as HTMLInputElement;
    input.onchange = () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) onCommit(v);
    };
    return h('label', { class: 'field' }, [h('span', { text: label }), input]);
  }

  function applySuggestion(array: LineArray, model: SpeakerModel) {
    const venueArea = layoutMeasureNearFar();
    if (!venueArea) {
      toast('缺少观众区，无法反推');
      return;
    }
    const { near, far } = venueArea;
    const suggestion = suggestSplay(array, near, far);
    onMutate((l) => {
      const a = l.lineArrays.find((x) => x.id === array.id);
      if (!a) return;
      a.startTilt = suggestion.startTilt;
      a.interAngles = suggestion.interAngles;
    });
    toast(`已反推：起始俯角 ${suggestion.startTilt}°，总张角 ${fmt(suggestion.interAngles.reduce((s, x) => s + x, 0), 1)}°`);
    render();
    void model;
  }

  // 由调用方注入观众区前后排坐标
  function layoutMeasureNearFar(): { near: import('../../core/types').Vec3; far: import('../../core/types').Vec3 } | null {
    return getNearFar();
  }

  render();
  return root;
}

function stat(num: number | string, label: string): HTMLElement {
  return h('div', { class: 'stat' }, [
    h('div', { class: 'num', text: String(num) }),
    h('div', { class: 'lbl', text: label }),
  ]);
}
