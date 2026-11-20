import type { Layout, SignalNode } from '../../core/types';
import { newId } from '../../core/types';
import { h, clear, toast } from '../dom';

/**
 * 信号流图：调音台 → 处理器 → 功放 → 音箱。
 * 用绝对定位 SVG 绘制，节点按类型分列自动布局，边上显示 DSP 状态。
 */
export function signalFlowGraph(
  layout: Layout,
  onMutate: (fn: (l: Layout) => void) => void,
  onEdgeClick: (edgeId: string) => void,
): HTMLElement {
  const root = h('div');
  const W = 860;
  const ROW_H = 64;

  function render() {
    clear(root);
    const nodes = ensureDefaultNodes(layout);
    const byType = new Map<SignalNode['type'], SignalNode[]>();
    for (const n of nodes) {
      const arr = byType.get(n.type) ?? [];
      arr.push(n);
      byType.set(n.type, arr);
    }
    const columns: Array<{ type: SignalNode['type']; title: string; x: number }> = [
      { type: 'mixer', title: '调音台', x: 30 },
      { type: 'processor', title: '处理器', x: 240 },
      { type: 'amp', title: '功放', x: 470 },
      { type: 'speaker', title: '音箱', x: 690 },
    ];
    const height = Math.max(360, (nodes.length + 2) * ROW_H);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(height));
    svg.classList.add('signal-canvas');
    svg.style.height = height + 'px';

    const pos = new Map<string, { x: number; y: number }>();
    for (const col of columns) {
      const list = byType.get(col.type) ?? [];
      list.forEach((n, i) => pos.set(n.id, { x: col.x, y: 40 + i * ROW_H }));
      svg.append(svgText(col.x + 60, 18, col.title, true));
    }

    // 边
    for (const edge of layout.signalEdges) {
      const a = pos.get(edge.from);
      const b = pos.get(edge.to);
      if (!a || !b) continue;
      const x1 = a.x + 130;
      const x2 = b.x;
      const y = (a.y + b.y) / 2 + 12;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${a.y + 12} C ${(x1 + x2) / 2} ${a.y + 12}, ${(x1 + x2) / 2} ${b.y + 12}, ${x2} ${b.y + 12}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', edge.dsp?.muted ? '#ef5b5b' : '#4f9cf9');
      path.setAttribute('stroke-width', '2');
      path.style.cursor = 'pointer';
      path.addEventListener('click', () => onEdgeClick(edge.id));
      svg.append(path);
      const label = svgText((x1 + x2) / 2 - 30, y - 6, edgeLabel(edge.dsp), false);
      label.setAttribute('fill', '#93a0b2');
      label.style.cursor = 'pointer';
      label.addEventListener('click', () => onEdgeClick(edge.id));
      svg.append(label);
    }

    // 节点
    for (const n of nodes) {
      const p = pos.get(n.id)!;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', String(p.x));
      rect.setAttribute('y', String(p.y));
      rect.setAttribute('width', '130');
      rect.setAttribute('height', '44');
      rect.setAttribute('rx', '8');
      rect.setAttribute('fill', '#1e2530');
      rect.setAttribute('stroke', '#2a3340');
      g.append(rect);
      g.append(svgText(p.x + 10, p.y + 19, n.name, true));
      g.append(svgText(p.x + 10, p.y + 35, nodeSubtitle(n.type), false));
      svg.append(g);
    }

    root.append(
      svg,
      h('div', { class: 'btn-row', style: 'margin-top:8px' }, [
        h('button', {
          class: 'btn ghost small',
          text: '+ 处理器节点',
          onclick: () => {
            onMutate((l) => {
              const node: SignalNode = { id: newId('node'), type: 'processor', name: `处理器 ${l.signalNodes.filter((n) => n.type === 'processor').length + 1}` };
              l.signalNodes.push(node);
              const mixer = l.signalNodes.find((n) => n.type === 'mixer');
              if (mixer) l.signalEdges.push({ id: newId('edge'), from: mixer.id, to: node.id });
            });
            render();
          },
        }),
        h('button', {
          class: 'btn ghost small',
          text: '自动连线到全部音箱',
          onclick: () => {
            onMutate((l) => autoConnect(l));
            toast('已按 调音台→处理器→功放→音箱 自动连线');
            render();
          },
        }),
      ]),
      h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, [
        '点击蓝色连线可编辑该通道 DSP（EQ/高低切/限幅器）。',
      ]),
    );
  }

  render();
  return root;
}

function edgeLabel(dsp: import('../../core/types').ChannelDsp | undefined): string {
  if (!dsp) return '点击配置 DSP';
  const parts: string[] = [];
  if (dsp.highpass) parts.push(`HPF ${dsp.highpass}Hz`);
  if (dsp.lowpass) parts.push(`LPF ${dsp.lowpass}Hz`);
  if (dsp.eq.length) parts.push(`EQ×${dsp.eq.length}`);
  parts.push(`限幅 ${dsp.limiterThresholdDbu}dBu`);
  if (dsp.muted) parts.push('哑音');
  return parts.join(' · ');
}

function nodeSubtitle(type: SignalNode['type']): string {
  return { mixer: '混音/路由', processor: 'DSP 处理', amp: '功率放大', speaker: '发声终端' }[type];
}

function svgText(x: number, y: number, text: string, bold: boolean): SVGTextElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  el.setAttribute('x', String(x));
  el.setAttribute('y', String(y));
  el.setAttribute('fill', '#e6ebf2');
  el.setAttribute('font-size', bold ? '13' : '10.5');
  if (bold) el.setAttribute('font-weight', '700');
  el.textContent = text;
  return el;
}

/** 保证图中存在基础四类节点（首次进入时自动建） */
function ensureDefaultNodes(layout: Layout): SignalNode[] {
  return layout.signalNodes;
}

export function ensureSignalScaffold(layout: Layout): void {
  if (layout.signalNodes.length > 0) return;
  const mixer = { id: newId('node'), type: 'mixer' as const, name: '数字调音台' };
  const proc = { id: newId('node'), type: 'processor' as const, name: '系统处理器' };
  const amp = { id: newId('node'), type: 'amp' as const, name: '功放机房' };
  layout.signalNodes.push(mixer, proc, amp);
  for (const s of [...layout.speakers, ...layout.lineArrays]) {
    const spkNode = { id: newId('node'), type: 'speaker' as const, name: s.name };
    layout.signalNodes.push(spkNode);
    layout.signalEdges.push(
      { id: newId('edge'), from: mixer.id, to: proc.id },
      { id: newId('edge'), from: proc.id, to: amp.id },
      { id: newId('edge'), from: amp.id, to: spkNode.id },
    );
  }
}

function autoConnect(layout: Layout): void {
  ensureSignalScaffold(layout);
  const mixer = layout.signalNodes.find((n) => n.type === 'mixer')!;
  const proc = layout.signalNodes.find((n) => n.type === 'processor')!;
  const amp = layout.signalNodes.find((n) => n.type === 'amp')!;
  const hasEdge = (a: string, b: string) => layout.signalEdges.some((e) => e.from === a && e.to === b);
  for (const pair of [[mixer.id, proc.id], [proc.id, amp.id]]) {
    if (!hasEdge(pair[0], pair[1])) {
      layout.signalEdges.push({ id: newId('edge'), from: pair[0], to: pair[1] });
    }
  }
  const speakerNames = new Set([...layout.speakers.map((s) => s.name), ...layout.lineArrays.map((a) => a.name)]);
  for (const node of layout.signalNodes) {
    if (node.type === 'speaker' && speakerNames.has(node.name) && !hasEdge(amp.id, node.id)) {
      layout.signalEdges.push({ id: newId('edge'), from: amp.id, to: node.id });
    }
  }
}
