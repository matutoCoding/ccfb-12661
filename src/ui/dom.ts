/** 极简 DOM 构造器：h('div', {class, onclick}, [children]) */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  children: Array<Node | string | null | undefined> = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'dataset') {
      Object.assign(el.dataset, v);
    } else if (v !== null && v !== undefined) {
      el.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  el.replaceChildren();
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function toast(message: string, durationMs = 2600): void {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = h('div', { class: 'toast', text: message });
  document.body.append(el);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), durationMs);
}

export function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

/** 折线图（频响/RT60/余量），纯 Canvas2D */
export interface LineChartSeries {
  label: string;
  color: string;
  points: Array<{ x: number; y: number }>;
}

export function drawLineChart(
  canvas: HTMLCanvasElement,
  series: LineChartSeries[],
  opts: {
    xLabel?: string;
    yLabel?: string;
    xLog?: boolean;
    yMin?: number;
    yMax?: number;
    markers?: Array<{ x: number; label: string; color: string }>;
  } = {},
): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const padL = 48;
  const padR = 14;
  const padT = 14;
  const padB = 34;
  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  if (!allX.length) return;
  const xMin = Math.min(...allX);
  const xMax = Math.max(...allX);
  const yMin = opts.yMin ?? Math.floor(Math.min(...allY) - 2);
  const yMax = opts.yMax ?? Math.ceil(Math.max(...allY) + 2);
  const xMap = (x: number) => {
    const t = opts.xLog ? Math.log(x / xMin) / Math.log(xMax / xMin) : (x - xMin) / (xMax - xMin);
    return padL + t * (w - padL - padR);
  };
  const yMap = (y: number) => padT + (1 - (y - yMin) / (yMax - yMin)) * (h - padT - padB);

  // 网格与坐标
  ctx.strokeStyle = 'rgba(140,150,165,0.18)';
  ctx.fillStyle = 'rgba(160,170,185,0.9)';
  ctx.font = '11px sans-serif';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = yMin + ((yMax - yMin) * i) / 4;
    const py = yMap(y);
    ctx.beginPath();
    ctx.moveTo(padL, py);
    ctx.lineTo(w - padR, py);
    ctx.stroke();
    ctx.fillText(y.toFixed(0), 6, py + 4);
  }
  const xTicks = opts.xLog ? [63, 125, 250, 500, 1000, 2000, 4000, 8000].filter((f) => f >= xMin && f <= xMax) : undefined;
  if (xTicks) {
    for (const f of xTicks) {
      const px = xMap(f);
      ctx.fillText(String(f), px - 10, h - 12);
      ctx.strokeStyle = 'rgba(140,150,165,0.1)';
      ctx.beginPath();
      ctx.moveTo(px, padT);
      ctx.lineTo(px, h - padB);
      ctx.stroke();
    }
  }
  for (const m of opts.markers ?? []) {
    const px = xMap(m.x);
    ctx.strokeStyle = m.color;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px, padT);
    ctx.lineTo(px, h - padB);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = m.color;
    ctx.fillText(m.label, px + 3, padT + 10);
  }

  // 数据线
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const px = xMap(p.x);
      const py = yMap(p.y);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
  // 图例
  let lx = padL;
  ctx.font = '12px sans-serif';
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, h - 8, 12, 3);
    ctx.fillStyle = 'rgba(200,208,220,0.95)';
    ctx.fillText(s.label, lx + 16, h - 4);
    lx += ctx.measureText(s.label).width + 34;
  }
}

/** 柱状图（RT60 逐频段） */
export function drawBarChart(
  canvas: HTMLCanvasElement,
  bars: Array<{ label: string; value: number; color?: string }>,
  opts: { yMax?: number; unit?: string } = {},
): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const padL = 44;
  const padB = 30;
  const padT = 12;
  const yMax = opts.yMax ?? Math.max(...bars.map((b) => b.value)) * 1.15;
  const bw = (w - padL - 16) / bars.length;
  ctx.strokeStyle = 'rgba(140,150,165,0.18)';
  ctx.fillStyle = 'rgba(160,170,185,0.9)';
  ctx.font = '11px sans-serif';
  for (let i = 0; i <= 4; i++) {
    const y = yMax * (i / 4);
    const py = padT + (1 - i / 4) * (h - padT - padB);
    ctx.beginPath();
    ctx.moveTo(padL, py);
    ctx.lineTo(w - 10, py);
    ctx.stroke();
    ctx.fillText(y.toFixed(1), 8, py + 4);
  }
  bars.forEach((b, i) => {
    const bh = (b.value / yMax) * (h - padT - padB);
    const x = padL + i * bw + bw * 0.18;
    ctx.fillStyle = b.color ?? '#4f9cf9';
    ctx.fillRect(x, h - padB - bh, bw * 0.64, bh);
    ctx.fillStyle = 'rgba(200,208,220,0.95)';
    ctx.textAlign = 'center';
    ctx.fillText(b.label, x + bw * 0.32, h - 14);
    ctx.fillText(b.value.toFixed(2) + (opts.unit ?? ''), x + bw * 0.32, h - padB - bh - 4);
    ctx.textAlign = 'left';
  });
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
