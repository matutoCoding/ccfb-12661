import { BAND_FREQS, type BandValues, type Vec3 } from './types';
import type { ReflectionResult } from './reflection';
import { SOUND_SPEED } from './reflection';
import { responseAtFreqs, fft as baseFft } from './fft';
import type { SpeakerInstance } from './speakers';
import { analyzePoint } from './analysis';

export interface IrReflectionSpec {
  delayMs: number;
  /** 相对直达声的中频级差 dB（负值） */
  relLevelDb: number;
}

export interface IrSpec {
  sampleRate: number;
  rt60: BandValues;
  /** 直达声传播延时 ms */
  directDelayMs: number;
  reflections: IrReflectionSpec[];
  /** 直达/混响比 dB（来自分析器） */
  directToReverbDb: number;
}

/** 简易 biquad 实时滤波器（用于逐频段噪声塑形） */
class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(private c: { b0: number; b1: number; b2: number; a1: number; a2: number }) {}
  process(x: number): number {
    const y =
      this.c.b0 * x + this.c.b1 * this.x1 + this.c.b2 * this.x2 - this.c.a1 * this.y1 - this.c.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

function bandpassCoeffs(fc: number, bandwidthHz: number, sr: number) {
  const w0 = (2 * Math.PI * fc) / sr;
  const q = fc / bandwidthHz;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * Math.cos(w0)) / a0,
    a2: (1 - alpha) / a0,
  };
}

/** 可复现的伪随机数（线性同余），保证同参数 IR 一致 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
}

/**
 * 合成座位脉冲响应。
 * 结构：直达脉冲 + 早期反射（一阶/二阶离散声线）+ 指数衰减扩散尾（混响）。
 * 混响尾逐倍频程带按该频段 RT60 独立做指数包络，因此反推 RT60 与赛宾结果一致。
 */
export function synthesizeImpulseResponse(spec: IrSpec, seed = 42): Float32Array {
  const sr = spec.sampleRate;
  const maxRt = Math.max(...BAND_FREQS.map((f) => spec.rt60[f]));
  // 尾音保留到最长 RT60 的 1.2 倍（-72dB 以下截断）
  const tailSec = Math.min(4, Math.max(0.5, maxRt * 1.2));
  const totalSec = tailSec + spec.directDelayMs / 1000 + 0.05;
  const n = Math.floor(totalSec * sr);
  const ir = new Float32Array(n);
  const rng = makeRng(seed);

  // 1) 直达声（归一为 1.0）
  const d0 = Math.floor((spec.directDelayMs / 1000) * sr);
  if (d0 < n) ir[d0] = 1;

  // 2) 早期反射
  for (const r of spec.reflections) {
    const idx = Math.floor(((spec.directDelayMs + r.delayMs) / 1000) * sr);
    if (idx < n) {
      ir[idx] += Math.pow(10, r.relLevelDb / 20);
    }
  }

  // 3) 扩散混响尾：起始时间取 80ms 或最早反射之后
  const startMs = Math.max(80, spec.directDelayMs + 20);
  const startSample = Math.floor((startMs / 1000) * sr);
  // 混响尾整体电平由 D/R 比决定
  const tailRms = Math.pow(10, -Math.max(0, spec.directToReverbDb) / 20) * 0.9;

  for (const band of BAND_FREQS) {
    const rt = spec.rt60[band];
    // 60dB 衰减对应指数时间常数 τ = RT60 / ln(1000)
    const tau = rt / Math.log(1000);
    const bw = band / Math.SQRT2; // 倍频程带宽
    const filter = new Biquad(bandpassCoeffs(band, bw, sr));
    // 该带能量权重（按 D/R 与默认频谱微调，高频自然弱一些）
    const weight = band <= 4000 ? 1 : 0.7;
    for (let i = startSample; i < n; i++) {
      const t = (i - startSample) / sr;
      const white = rng() * 2;
      const shaped = filter.process(white);
      const envelope = Math.exp(-t / tau);
      ir[i] += shaped * envelope * tailRms * weight;
    }
  }

  // 归一化（保留 0.9 余量防削波）
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(ir[i]));
  const norm = 0.9 / peak;
  for (let i = 0; i < n; i++) ir[i] *= norm;
  return ir;
}

/** 从反射分析结果构造 IR 规格 */
export function buildIrSpec(
  listener: Vec3,
  speakers: SpeakerInstance[],
  reflection: ReflectionResult | null,
  rt60: BandValues,
  sampleRate: number,
): IrSpec {
  const pointResult = analyzePoint(listener, speakers);
  const directMs = reflection
    ? (reflection.directLength / SOUND_SPEED) * 1000
    : 5;
  const reflections: IrReflectionSpec[] = [];
  if (reflection) {
    for (const p of reflection.paths) {
      const midRel = (p.relToDirectDb[500] + p.relToDirectDb[1000]) / 2;
      reflections.push({
        delayMs: p.delayMs,
        relLevelDb: Math.max(-40, midRel),
      });
    }
  }
  return {
    sampleRate,
    rt60,
    directDelayMs: directMs,
    reflections,
    directToReverbDb: pointResult.directToReverbDb,
  };
}

export interface FrequencyCurve {
  freqs: number[];
  /** dB，归一到曲线均值 0 */
  db: number[];
}

/** 由 IR 求座位频响曲线（1/12 倍频程采样，50Hz~12kHz） */
export function seatFrequencyResponse(ir: Float32Array, sampleRate: number): FrequencyCurve {
  const freqs: number[] = [];
  for (let f = 50; f <= 12000; f *= Math.pow(2, 1 / 12)) freqs.push(Math.round(f));
  const raw = responseAtFreqs(ir, freqs, sampleRate);
  const mean = raw.reduce((s, v) => s + v, 0) / raw.length;
  return { freqs, db: raw.map((v) => +(v - mean).toFixed(2)) };
}

/** 离线卷积（干声样本 × IR），用于非实时预览/导出 */
export function convolveOffline(dry: Float32Array, ir: Float32Array): Float32Array {
  const n = dry.length + ir.length - 1;
  const out = new Float32Array(n);
  // 大长度走 FFT 分块，这里样本只有几秒、IR <4s，直接时域卷积并按稀疏优化
  if (ir.length * dry.length > 2_000_000) {
    return convolveFft(dry, ir);
  }
  for (let i = 0; i < dry.length; i++) {
    const x = dry[i];
    if (Math.abs(x) < 1e-6) continue;
    for (let j = 0; j < ir.length; j++) {
      out[i + j] += x * ir[j];
    }
  }
  return normalizeOutput(out);
}

function nextPow2(n: number): number {
  return 1 << (32 - Math.clz32(n - 1));
}

function convolveFft(dry: Float32Array, ir: Float32Array): Float32Array {
  // 动态 import 会破坏 worker 打包，这里用内联简化 DFT 分块策略：
  // 以 2048 样本块做重叠相加，每块走基 2 FFT
  const block = 2048;
  const fftSize = nextPow2(block + ir.length - 1);
  const out = new Float32Array(dry.length + ir.length - 1);
  const irRe = new Float64Array(fftSize);
  const irIm = new Float64Array(fftSize);
  ir.forEach((v, i) => (irRe[i] = v));
  baseFft(irRe, irIm);
  for (let off = 0; off < dry.length; off += block) {
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < block && off + i < dry.length; i++) re[i] = dry[off + i];
    baseFft(re, im);
    const pr = new Float64Array(fftSize);
    const pi = new Float64Array(fftSize);
    for (let k = 0; k < fftSize; k++) {
      pr[k] = re[k] * irRe[k] - im[k] * irIm[k];
      pi[k] = re[k] * irIm[k] + im[k] * irRe[k];
    }
    inverseFft(pr, pi, fftSize);
    for (let i = 0; i < fftSize && off + i < out.length; i++) {
      out[off + i] += pr[i];
    }
  }
  return normalizeOutput(out);
}

function inverseFft(re: Float64Array, im: Float64Array, n: number): void {
  for (let i = 0; i < n; i++) im[i] = -im[i];
  baseFft(re, im);
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

function normalizeOutput(buf: Float32Array): Float32Array {
  let peak = 1e-9;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const k = 0.9 / peak;
  for (let i = 0; i < buf.length; i++) buf[i] *= k;
  return buf;
}

/** 从 IR 反推各频段 RT60（Schroeder 反向积分 + T30 外推，单位秒） */
export function estimateRt60FromIr(ir: Float32Array, sampleRate: number): BandValues {
  const result = {} as BandValues;
  for (const band of BAND_FREQS) {
    // 带通滤波后取能量序列
    const bw = band / Math.SQRT2;
    const filter = new Biquad(bandpassCoeffs(band, bw, sampleRate));
    const n = ir.length;
    const e = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const y = filter.process(ir[i]);
      e[i] = y * y;
    }
    // Schroeder 反向积分 E(t) = Σ_{τ=t}^{end} e(τ)
    const schroeder = new Float64Array(n);
    let acc = 0;
    for (let i = n - 1; i >= 0; i--) {
      acc += e[i];
      schroeder[i] = acc;
    }
    const peak = schroeder[0] || 1e-12;
    // 找到 -5dB 与 -35dB 穿越点（T30：两点斜率外推到 -60dB）
    let t5 = -1;
    let t35 = -1;
    for (let i = 0; i < n; i++) {
      const db = 10 * Math.log10(Math.max(1e-12, schroeder[i] / peak));
      if (t5 < 0 && db <= -5) t5 = i / sampleRate;
      if (t35 < 0 && db <= -35) t35 = i / sampleRate;
    }
    result[band] = t5 > 0 && t35 > t5 ? +((t35 - t5) * 2).toFixed(3) : 0;
  }
  return result;
}
