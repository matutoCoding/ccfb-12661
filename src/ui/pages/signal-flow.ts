import { h, mount, button, selectInput, numInput, labeled, section, toast, badge, table } from '../dom';
import { store } from '../../state/store';
import { chainResponseCurve, defaultDSPChain, defaultPEQBand } from '../../core/dsp';
import { logFreqPoints } from '../../core/acoustics/bands';
import { lineChart } from '../charts';
import { uid, deepClone } from '../../core/math/vec3';
import type { DSPChain, Layout, SignalNode } from '../../core/types';

/** 信号流图画布 + 节点属性/DSP 编辑（作为布置页的子标签） */
export function renderSignalFlow(layout: Layout, persist: () => Promise<void> | void): HTMLElement {
  let selectedNodeId: string | null = layout.graph.nodes.find((n) => n.kind === 'processor' || n.kind === 'amp')?.id ?? null;
  const wrap = h('div', {});

  const nodePos = new Map<string, { x: number; y: number }>();
  const layoutNodes = () => {
    // 按 mixer → processor → amp → speaker 列布局
    const cols: Record<string, number> = { mixer: 0, processor: 1, amp: 2, speaker: 3 };
    const counters = [0, 0, 0, 0];
    for (const n of layout.graph.nodes) {
      const col = cols[n.kind];
      nodePos.set(n.id, { x: 40 + col * 230, y: 40 + counters[col] * 110 });
      counters[col]++;
    }
  };
  layoutNodes();

  const addNode = (kind: SignalNode['kind']) => {
    const deviceModelId = kind === 'amp' ? store.state.library.amps[0]?.id : kind === 'processor' ? 'dsp-48' : undefined;
    const node: SignalNode = {
      id: uid('node'),
      kind,
      name: kind === 'amp' ? '新功放' : kind === 'processor' ? '新处理器' : '音箱节点',
      deviceModelId,
      dsp: kind === 'speaker' ? undefined : defaultDSPChain()
    };
    layout.graph.nodes.push(node);
    selectedNodeId = node.id;
    persist();
    render();
  };

  const connect = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    if (!layout.graph.edges.some((e) => e.from === fromId && e.to === toId)) {
      layout.graph.edges.push({ from: fromId, to: toId });
      persist();
      render();
    }
  };

  const dspEditor = (node: SignalNode): HTMLElement => {
    if (!node.dsp) {
      return section('节点属性',
        labeled('名称', h('input', { value: node.name, oninput: (e: Event) => { node.name = (e.target as HTMLInputElement).value; } })),
        h('p', { class: 'muted' }, '该类节点不带 DSP 链。'),
        button('删除节点', () => removeNode(node), 'danger')
      );
    }
    const chain: DSPChain = node.dsp;
    const freqs = logFreqPoints(64, 40, 16000);
    const curve = chainResponseCurve(chain, freqs);
    return h('div', {},
      section('节点属性',
        labeled('名称', h('input', { value: node.name, oninput: (e: Event) => { node.name = (e.target as HTMLInputElement).value; } })),
        node.kind === 'amp' ? labeled('功放型号', selectInput(store.state.library.amps.map((a) => ({ value: a.id, label: `${a.manufacturer} ${a.model}` })), node.deviceModelId ?? '', (v) => { node.deviceModelId = v; persist(); render(); })) : null,
        h('div', { class: 'field-row' },
          labeled('通道增益 dB', numInput(chain.gain, (v) => { chain.gain = v; persist(); render(); }, 0.5)),
          labeled('延时 ms', numInput(chain.delayMs, (v) => { chain.delayMs = Math.max(0, v); persist(); }, 0.1))
        ),
        h('label', { class: 'field', style: { flexDirection: 'row', gap: '8px', alignItems: 'center' } },
          h('input', { type: 'checkbox', checked: chain.mute, onchange: (e: Event) => { chain.mute = (e.target as HTMLInputElement).checked; persist(); render(); } }),
          '静音 Mute')
      ),
      section('通道频响（当前 DSP 链）',
        lineChart([{ label: '幅度 dB', color: '#4da3ff', points: curve.map((p) => ({ x: p.freq, y: p.db })) }], { xLog: true, height: 180, yMin: -30, yMax: 12, xLabel: 'Hz' })
      ),
      section('高通 / 低切',
        h('div', { class: 'field-row' },
          h('label', { class: 'field' }, '高通启用', h('input', { type: 'checkbox', checked: chain.highpass.enabled, onchange: (e: Event) => { chain.highpass.enabled = (e.target as HTMLInputElement).checked; persist(); render(); } })),
          labeled('HPF 频率', numInput(chain.highpass.freq, (v) => { chain.highpass.freq = v; persist(); render(); }, 5, 20, 1000)),
          labeled('HPF 斜率', selectInput([{ value: '12', label: '12 dB/oct' }, { value: '24', label: '24 dB/oct' }], String(chain.highpass.slope), (v) => { chain.highpass.slope = Number(v) as 12 | 24; persist(); render(); }))
        ),
        h('div', { class: 'field-row' },
          h('label', { class: 'field' }, '低通启用', h('input', { type: 'checkbox', checked: chain.lowpass.enabled, onchange: (e: Event) => { chain.lowpass.enabled = (e.target as HTMLInputElement).checked; persist(); render(); } })),
          labeled('LPF 频率', numInput(chain.lowpass.freq, (v) => { chain.lowpass.freq = v; persist(); render(); }, 50, 80, 20000)),
          labeled('LPF 斜率', selectInput([{ value: '12', label: '12 dB/oct' }, { value: '24', label: '24 dB/oct' }], String(chain.lowpass.slope), (v) => { chain.lowpass.slope = Number(v) as 12 | 24; persist(); render(); }))
        )
      ),
      section(`参量均衡 PEQ（${chain.peq.length} 段）`,
        h('div', { class: 'eq-band' }, h('b', {}, '启用'), h('b', {}, '类型'), h('b', {}, '频率 Hz'), h('b', {}, '增益/Q'), h('b', {}, '')),
        ...chain.peq.map((band, i) => h('div', { class: 'eq-band' },
          h('input', { type: 'checkbox', checked: band.enabled, onchange: (e: Event) => { band.enabled = (e.target as HTMLInputElement).checked; persist(); render(); } }),
          selectInput([{ value: 'bell', label: '钟形' }, { value: 'lowshelf', label: '低架' }, { value: 'highshelf', label: '高架' }], band.type, (v) => { band.type = v as typeof band.type; persist(); render(); }),
          numInput(band.freq, (v) => { band.freq = v; persist(); render(); }, 1, 20, 20000),
          h('div', { class: 'field-row' },
            numInput(band.gain, (v) => { band.gain = Math.max(-18, Math.min(18, v)); persist(); render(); }, 0.5),
            numInput(band.q, (v) => { band.q = Math.max(0.1, Math.min(10, v)); persist(); render(); }, 0.1)
          ),
          button('×', () => { chain.peq.splice(i, 1); persist(); render(); }, 'danger')
        )),
        h('div', { class: 'toolbar', style: { marginTop: '8px' } },
          button('+ 增加 PEQ 段', () => { chain.peq.push(defaultPEQBand()); persist(); render(); }, 'primary')
        )
      ),
      section('限幅器',
        h('label', { class: 'field', style: { flexDirection: 'row', gap: '8px', alignItems: 'center' } },
          h('input', { type: 'checkbox', checked: chain.limiter.enabled, onchange: (e: Event) => { chain.limiter.enabled = (e.target as HTMLInputElement).checked; persist(); render(); } }),
          '启用限幅器'),
        h('div', { class: 'field-row-3' },
          labeled('阈值 dBu', numInput(chain.limiter.threshold, (v) => { chain.limiter.threshold = v; persist(); render(); }, 0.5)),
          labeled('启动 ms', numInput(chain.limiter.attackMs, (v) => { chain.limiter.attackMs = v; persist(); render(); }, 0.1)),
          labeled('释放 ms', numInput(chain.limiter.releaseMs, (v) => { chain.limiter.releaseMs = v; persist(); render(); }, 1))
        )
      ),
      presetManager(chain),
      h('div', { class: 'toolbar' },
        button('保存全部修改', () => { void Promise.resolve(persist()).then(() => toast('信号链已保存')); }, 'primary'),
        button('删除节点', () => removeNode(node), 'danger')
      )
    );
  };

  const presetManager = (chain: DSPChain): HTMLElement => section('通道预设（可套用到其它通道）',
    h('div', { class: 'toolbar', style: { marginBottom: '8px' } },
      button('存为新预设', () => {
        store.state.library.presets.push({
          id: uid('preset'), name: `自定义预设 ${store.state.library.presets.length + 1}`, builtin: false,
          chain: deepClone(chain), createdAt: Date.now()
        });
        store.saveLibrary().then(() => { toast('预设已保存到库'); render(); });
      }, 'primary')
    ),
    table(['预设', '来源', '操作'], store.state.library.presets.map((p) => [
      p.name, p.builtin ? badge('内置', 'info') : badge('自定义', 'warn'),
      h('div', { class: 'toolbar' },
        button('套用', () => {
          Object.assign(chain, deepClone(p.chain));
          persist();
          toast(`已套用预设「${p.name}」`);
          render();
        }, 'primary'),
        p.builtin ? '' : button('删除', () => {
          store.state.library.presets = store.state.library.presets.filter((x) => x.id !== p.id);
          store.saveLibrary().then(render);
        }, 'danger')
      )
    ]))
  );

  const removeNode = (node: SignalNode) => {
    layout.graph.nodes = layout.graph.nodes.filter((n) => n.id !== node.id);
    layout.graph.edges = layout.graph.edges.filter((e) => e.from !== node.id && e.to !== node.id);
    selectedNodeId = null;
    persist();
    render();
  };

  function render() {
    const selected = layout.graph.nodes.find((n) => n.id === selectedNodeId) ?? null;
    const W = 960, H = 380;
    const canvas = h('canvas', { class: 'sig-canvas', width: W, height: H }) as HTMLCanvasElement;
    requestAnimationFrame(() => {
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, W, H);
      // 连线
      ctx.strokeStyle = '#4da3ff';
      ctx.lineWidth = 2;
      for (const edge of layout.graph.edges) {
        const a = nodePos.get(edge.from)!, b = nodePos.get(edge.to)!;
        ctx.beginPath();
        ctx.moveTo(a.x + 130, a.y + 26);
        ctx.bezierCurveTo(a.x + 180, a.y + 26, b.x - 40, b.y + 26, b.x, b.y + 26);
        ctx.stroke();
      }
    });

    const nodeEls = layout.graph.nodes.map((n) => {
      const pos = nodePos.get(n.id)!;
      const overload = store.state.snapshots[layout.id]?.budgets.some((b) => b.stages.some((s) => s.nodeId === n.id && s.overload));
      const el = h('div', {
        class: `sig-node ${n.id === selectedNodeId ? 'selected' : ''} ${overload ? 'overload' : ''}`,
        style: { left: `${pos.x}px`, top: `${pos.y}px` },
        onclick: () => { selectedNodeId = n.id; render(); }
      },
        h('div', { class: 'kind' }, { mixer: '调音台', processor: '处理器', amp: '功放', speaker: '音箱' }[n.kind]),
        h('div', {}, n.name),
        n.dsp?.limiter.enabled ? badge('限幅', 'warn') : null
      );
      return el;
    });

    // 连线小工具：选择两个节点
    let linkFrom: string | null = null;
    const linkBar = h('div', { class: 'toolbar', style: { margin: '10px 0' } },
      h('span', { class: 'muted' }, '快速连线：'),
      selectInput([{ value: '', label: '起点节点' }, ...layout.graph.nodes.map((n) => ({ value: n.id, label: n.name }))], '', (v) => { linkFrom = v; }),
      '→',
      selectInput([{ value: '', label: '终点节点' }, ...layout.graph.nodes.map((n) => ({ value: n.id, label: n.name }))], '', (v) => { if (linkFrom && v) connect(linkFrom, v); }),
      h('span', { style: { flex: 1 } }),
      button('+ 处理器', () => addNode('processor')),
      button('+ 功放', () => addNode('amp'), 'primary')
    );

    mount(wrap,
      section('信号流图（调音台 → 处理器 → 功放 → 音箱）',
        h('div', { style: { position: 'relative', width: `${W}px`, maxWidth: '100%' } }, canvas, ...nodeEls),
        linkBar
      ),
      selected ? dspEditor(selected) : h('p', { class: 'muted' }, '点击信号流中的节点编辑其 DSP 链、限幅与预设。')
    );
  }
  render();
  return wrap;
}
