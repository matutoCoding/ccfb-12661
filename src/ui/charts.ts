import { h } from './dom';

export interface ChartSeries {
  label: string;
  color: string;
  points: { x: number; y: number }[];
  dashed?: boolean;
}

function drawChart(
  canvas: HTMLCanvasElement,
  series: ChartSeries[],
  opts: { xLog?: boolean; yMin?: number; yMax?: number; xLabel?: string; yLabel?: string; markers?: { x: number; label: string }[]; fillArea?: boolean }
): void {
  const dpr = Math.min(window.devicePixelRatio, 2);
  const w = canvas.clientWidth, hgt = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = hgt * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, hgt);
  const padL = 48, padR = 12, padT = 14, padB = 34;
  const cw = w - padL - padR, ch = hgt - padT - padB;

  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  if (allX.length === 0) return;
  const xMin = Math.min(...allX), xMax = Math.max(...allX);
  const yMin = opts.yMin ?? Math.floor(Math.min(...allY) / 5) * 5;
  const yMax = opts.yMax ?? Math.ceil(Math.max(...allY) / 5) * 5;
  const xMap = (x: number) => padL + cw * (opts.xLog ? Math.log10(x / xMin) / Math.log10(xMax / xMin) : (x - xMin) / (xMax - xMin || 1));
  const yMap = (y: number) => padT + ch * (1 - (y - yMin) / (yMax - yMin || 1));

  // 网格
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '11px system-ui';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = padT + (ch * i) / 5;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + cw, y); ctx.stroke();
    const val = yMax - ((yMax - yMin) * i) / 5;
    ctx.fillText(val.toFixed(0), 6, y + 4);
  }
  // X 轴刻度
  const ticks = opts.xLog ? [63, 125, 250, 500, 1000, 2000, 4000, 8000].filter((f) => f >= xMin && f <= xMax) : 4;
  if (opts.xLog) {
    for (const f of ticks as number[]) {
      const x = xMap(f);
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x - 8, hgt - 12);
    }
  } else {
    for (let i = 0; i <= (ticks as number); i++) {
      const val = xMin + ((xMax - xMin) * i) / (ticks as number);
      ctx.fillText(val.toFixed(1), padL + (cw * i) / (ticks as number) - 8, hgt - 12);
    }
  }

  // 标记线
  for (const m of opts.markers ?? []) {
    if (m.x < xMin || m.x > xMax) continue;
    const x = xMap(m.x);
    ctx.strokeStyle = 'rgba(255,90,90,0.7)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ch); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ff7a7a';
    ctx.fillText(m.label, x + 4, padT + 12);
  }

  // 曲线
  for (const s of series) {
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.setLineDash(s.dashed ? [5, 4] : []);
    ctx.beginPath();
    s.points.forEach((p, i) => {
      const x = xMap(p.x), y = yMap(p.y);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // 图例
  sLegend(ctx, series, padL, padT - 2);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  if (opts.xLabel) ctx.fillText(opts.xLabel, padL + cw / 2 - 10, hgt - 1);
  if (opts.yLabel) {
    ctx.save();
    ctx.translate(12, padT + ch / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.yLabel, -10, 0);
    ctx.restore();
  }
}

function sLegend(ctx: CanvasRenderingContext2D, series: ChartSeries[], x: number, y: number): void {
  let cx = x;
  ctx.font = '11px system-ui';
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(cx, y - 8, 12, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(s.label, cx + 16, y - 3);
    cx += ctx.measureText(s.label).width + 34;
  }
}

export function lineChart(series: ChartSeries[], opts: { height?: number; xLog?: boolean; yMin?: number; yMax?: number; xLabel?: string; yLabel?: string; markers?: { x: number; label: string }[] } = {}): HTMLElement {
  const canvas = h('canvas', { class: 'chart', style: { width: '100%', height: `${opts.height ?? 220}px` } }) as HTMLCanvasElement;
  const raf = { id: 0 };
  const render = () => drawChart(canvas, series, opts);
  requestAnimationFrame(render);
  const ro = new ResizeObserver(() => { cancelAnimationFrame(raf.id); raf.id = requestAnimationFrame(render); });
  ro.observe(canvas);
  return canvas;
}

/** 倍频程柱状图（RT60、SPL 等） */
export function barChart(labels: string[], values: number[], color: string, opts: { height?: number; yMin?: number; yMax?: number; unit?: string } = {}): HTMLElement {
  const canvas = h('canvas', { class: 'chart', style: { width: '100%', height: `${opts.height ?? 200}px` } }) as HTMLCanvasElement;
  const render = () => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = hgt * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, hgt);
    const padL = 44, padB = 28, padT = 12;
    const cw = w - padL - 10, ch = hgt - padB - padT;
    const yMin = opts.yMin ?? 0;
    const yMax = opts.yMax ?? Math.ceil(Math.max(...values) * 1.15);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '11px system-ui';
    for (let i = 0; i <= 4; i++) {
      const y = padT + (ch * i) / 4;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + cw, y); ctx.stroke();
      ctx.fillText((yMax - ((yMax - yMin) * i) / 4).toFixed(1), 6, y + 4);
    }
    const bw = cw / values.length * 0.62;
    values.forEach((v, i) => {
      const x = padL + (cw * i) / values.length + cw / values.length * 0.19;
      const bh = ch * ((v - yMin) / (yMax - yMin || 1));
      ctx.fillStyle = color;
      ctx.fillRect(x, padT + ch - bh, bw, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(v.toFixed(1), x + bw / 2 - 10, padT + ch - bh - 4);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(labels[i], x, hgt - 10);
    });
    if (opts.unit) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText(opts.unit, 6, padT); }
  };
  requestAnimationFrame(render);
  new ResizeObserver(() => requestAnimationFrame(render)).observe(canvas);
  return canvas;
}
