import type { ChannelDsp, EqBand } from '../../core/types';
import { defaultDsp, newId } from '../../core/types';
import { h } from '../dom';

/** DSP 通道编辑器：高/低切、参量 EQ、限幅器、增益、延时、哑音 */
export function dspEditor(
  dsp: ChannelDsp,
  onChange: (next: ChannelDsp) => void,
  presets: { name: string; dsp: ChannelDsp }[],
  onSavePreset: (name: string, dsp: ChannelDsp) => void,
): HTMLElement {
  const root = h('div');
  const update = (patch: Partial<ChannelDsp>) => onChange({ ...dsp, ...patch });

  const render = () => {
    root.replaceChildren();
    root.append(
      h('div', { class: 'grid-2' }, [
        numberField('高切 HPF (Hz，空=旁路)', dsp.highpass ?? '', (v) =>
          update({ highpass: v ?? undefined })),
        numberField('低切 LPF (Hz，空=旁路)', dsp.lowpass ?? '', (v) =>
          update({ lowpass: v ?? undefined })),
        numberField('通道增益 (dB)', dsp.gainDb, (v) => update({ gainDb: v ?? 0 })),
        numberField('延时 (ms)', dsp.delayMs, (v) => update({ delayMs: Math.max(0, v ?? 0) })),
        numberField('限幅阈值 (dBu)', dsp.limiterThresholdDbu, (v) =>
          update({ limiterThresholdDbu: v ?? 18 })),
        numberField('限幅压缩比', dsp.limiterRatio, (v) =>
          update({ limiterRatio: Math.max(1, v ?? 10) })),
      ]),
      h('label', { class: 'field', style: 'display:flex;align-items:center;gap:8px;margin:8px 0' }, [
        h('input', {
          type: 'checkbox',
          ...(dsp.muted ? { checked: '' } : {}),
          onchange: (e: Event) => update({ muted: (e.target as HTMLInputElement).checked }),
        }),
        h('span', { text: '哑音该通道', style: 'margin:0' }),
      ]),
      h('h3', { text: `参量均衡（${dsp.eq.length} 段）`, style: 'margin:' }),
      ...dsp.eq.map((band, i) => eqRow(band, (next) => {
        const eq = [...dsp.eq];
        eq[i] = next;
        update({ eq });
      }, () => update({ eq: dsp.eq.filter((_, j) => j !== i) }))),
      h('div', { class: 'btn-row', style: 'margin:8px 0' }, [
        h('button', {
          class: 'btn ghost small',
          text: '+ 添加 EQ 段',
          onclick: () => {
            const band: EqBand = {
              id: newId('eq'),
              enabled: true,
              freq: 1000,
              gain: 0,
              q: 1.4,
              type: 'peaking',
            };
            update({ eq: [...dsp.eq, band] });
          },
        }),
      ]),
      h('h3', { text: '通道预设' }),
      h('div', { class: 'btn-row' }, [
        ...presets.map((p) =>
          h('button', {
            class: 'btn ghost small',
            text: `套用：${p.name}`,
            title: '把预设参数复制到当前通道',
            onclick: () => {
              onChange(structuredClone(p.dsp));
            },
          }),
        ),
        h('button', {
          class: 'btn small',
          text: '存为预设',
          onclick: () => {
            const name = prompt('预设名称', '通道预设');
            if (name) onSavePreset(name, structuredClone(dsp));
          },
        }),
        h('button', {
          class: 'btn ghost small',
          text: '重置为默认',
          onclick: () => onChange(defaultDsp()),
        }),
      ]),
    );
  };

  function numberField(label: string, value: number | string, onCommit: (v: number | null) => void) {
    const input = h('input', {
      type: 'number',
      step: '0.1',
      value: String(value),
    }) as HTMLInputElement;
    input.onchange = () => {
      if (input.value.trim() === '') return onCommit(null);
      const v = parseFloat(input.value);
      onCommit(Number.isFinite(v) ? v : null);
    };
    return h('label', { class: 'field' }, [h('span', { text: label }), input]);
  }

  function eqRow(band: EqBand, onEdit: (b: EqBand) => void, onRemove: () => void) {
    const typeSelect = h('select') as HTMLSelectElement;
    for (const t of ['peaking', 'lowshelf', 'highshelf'] as const) {
      const label = t === 'peaking' ? '参量' : t === 'lowshelf' ? '低架' : '高架';
      typeSelect.append(h('option', { value: t, text: label, selected: band.type === t ? '' : null }));
    }
    typeSelect.onchange = () => onEdit({ ...band, type: typeSelect.value as EqBand['type'] });
    return h('div', {
      class: 'panel',
      style: 'padding:8px;background:var(--bg-panel-2);margin-bottom:6px',
    }, [
      h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [
        h('input', {
          type: 'checkbox',
          ...(band.enabled ? { checked: '' } : {}),
          onchange: (e: Event) => onEdit({ ...band, enabled: (e.target as HTMLInputElement).checked }),
        }),
        typeSelect,
        smallNum(band.freq, (v) => onEdit({ ...band, freq: v }), 'Hz', 20, 20000),
        smallNum(band.gain, (v) => onEdit({ ...band, gain: v }), 'dB', -18, 18),
        smallNum(band.q, (v) => onEdit({ ...band, q: v }), 'Q', 0.1, 10),
        h('button', { class: 'btn danger small', text: '删', onclick: onRemove }),
      ]),
    ]);
  }

  function smallNum(value: number, onCommit: (v: number) => void, unit: string, min: number, max: number) {
    const input = h('input', {
      type: 'number',
      step: unit === 'Hz' ? '10' : '0.1',
      min: String(min),
      max: String(max),
      value: String(value),
      style: 'width:84px',
    }) as HTMLInputElement;
    input.onchange = () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) onCommit(v);
    };
    return h('label', { style: 'display:flex;align-items:center;gap:4px;font-size:11px;color:var(--fg-dim)' }, [
      input,
      h('span', { text: unit }),
    ]);
  }

  render();
  return root;
}
