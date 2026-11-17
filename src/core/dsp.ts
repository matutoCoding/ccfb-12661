import type { DSPChain, PEQBand, XOverFilter } from './types';
import { BAND_CENTERS } from './acoustics/bands';

export interface BiquadCoeffs {
  b0: number; b1: number; b2: number; a1: number; a2: number;
}

/** RBJ Cookbook 双二阶系数，fs 仅决定预畸，频率响应用 H(jω) 连续形式 */
export function peqCoeffs(b: PEQBand): BiquadCoeffs {
  const w0 = (2 * Math.PI * b.freq) / 48000;
  const alpha = Math.sin(w0) / (2 * b.q);
  const A = Math.pow(10, b.gain / 40);
  const cosw = Math.cos(w0), sinw = Math.sin(w0);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  if (b.type === 'bell') {
    b0 = 1 + alpha * A;
    b1 = -2 * cosw;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cosw;
    a2 = 1 - alpha / A;
  } else if (b.type === 'lowshelf') {
    const sa = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) - (A - 1) * cosw + sa);
    b1 = 2 * A * ((A - 1) - (A + 1) * cosw);
    b2 = A * ((A + 1) - (A - 1) * cosw - sa);
    a0 = (A + 1) + (A - 1) * cosw + sa;
    a1 = -2 * ((A - 1) + (A + 1) * cosw);
    a2 = (A + 1) + (A - 1) * cosw - sa;
  } else {
    const sa = 2 * Math.sqrt(A) * alpha;
    b0 = A * ((A + 1) + (A - 1) * cosw + sa);
    b1 = -2 * A * ((A - 1) + (A + 1) * cosw);
    b2 = A * ((A + 1) + (A - 1) * cosw - sa);
    a0 = (A + 1) - (A - 1) * cosw + sa;
    a1 = 2 * ((A - 1) - (A + 1) * cosw);
    a2 = (A + 1) - (A - 1) * cosw - sa;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** 高低切：一阶/二阶巴特沃斯级联（slope 12→1 阶 biquad，24→2 阶） */
export function xoverCoeffs(f: XOverFilter, kind: 'hp' | 'lp'): BiquadCoeffs[] {
  if (!f.enabled) return [];
  const orders = f.slope === 24 ? 2 : 1;
  const out: BiquadCoeffs[] = [];
  for (let k = 0; k < orders; k++) {
    // 多级时按巴特沃斯多项式分配 Q
    const q = orders === 1 ? 0.7071 : k === 0 ? 0.5412 : 1.3066;
    const w0 = (2 * Math.PI * f.freq) / 48000;
    const alpha = Math.sin(w0) / (2 * q);
    const cosw = Math.cos(w0);
    let b0: number, b1: number, b2: number;
    if (kind === 'lp') {
      b0 = (1 - cosw) / 2; b1 = 1 - cosw; b2 = (1 - cosw) / 2;
    } else {
      b0 = (1 + cosw) / 2; b1 = -(1 + cosw); b2 = (1 + cosw) / 2;
    }
    const a0 = 1 + alpha, a1 = -2 * cosw, a2 = 1 - alpha;
    out.push({ b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 });
  }
  return out;
}

/** 双二阶在给定角频率 ω 下的复数响应幅度 dB */
function biquadResponseDb(c: BiquadCoeffs, omega: number): number {
  const jw = { re: Math.cos(omega), im: Math.sin(omega) };
  const e1 = { re: Math.cos(2 * omega), im: Math.sin(2 * omega) };
  const numRe = c.b0 + c.b1 * jw.re + c.b2 * e1.re;
  const numIm = c.b1 * jw.im + c.b2 * e1.im;
  const denRe = 1 + c.a1 * jw.re + c.a2 * e1.re;
  const denIm = c.a1 * jw.im + c.a2 * e1.im;
  const num = Math.hypot(numRe, numIm);
  const den = Math.hypot(denRe, denIm);
  return 20 * Math.log10(Math.max(num / Math.max(den, 1e-9), 1e-9));
}

/** 收集一条通道链上全部 biquad */
export function chainBiquads(chain: DSPChain): BiquadCoeffs[] {
  const out: BiquadCoeffs[] = [];
  for (const b of chain.peq) if (b.enabled) out.push(peqCoeffs(b));
  out.push(...xoverCoeffs(chain.highpass, 'hp'));
  out.push(...xoverCoeffs(chain.lowpass, 'lp'));
  return out;
}

/** 通道链在某频率的滤波响应 dB（不含增益/限幅） */
export function chainFilterResponseDb(chain: DSPChain, freq: number): number {
  const omega = (2 * Math.PI * freq) / 48000;
  let db = 0;
  for (const c of chainBiquads(chain)) db += biquadResponseDb(c, omega);
  return db;
}

/** 通道链在 8 个倍频程带的总响应（含通道增益，不含限幅） */
export function chainBandResponse(chain: DSPChain): number[] {
  return BAND_CENTERS.map((f) => chain.gain + chainFilterResponseDb(chain, f));
}

/** 细粒度频率响应曲线 */
export function chainResponseCurve(chain: DSPChain, freqs: number[]): { freq: number; db: number }[] {
  return freqs.map((freq) => ({ freq, db: chain.gain + chainFilterResponseDb(chain, freq) }));
}

/** 限幅器对信号电平的钳制（dBu → dBu），并返回是否被限 */
export function applyLimiter(chain: DSPChain, levelDbu: number): { out: number; limited: boolean } {
  if (!chain.limiter.enabled) return { out: levelDbu, limited: false };
  if (levelDbu <= chain.limiter.threshold) return { out: levelDbu, limited: false };
  return { out: chain.limiter.threshold, limited: true };
}

/** 新建一条默认 DSP 链 */
export function defaultDSPChain(): DSPChain {
  return {
    gain: 0,
    delayMs: 0,
    mute: false,
    peq: [],
    highpass: { enabled: false, freq: 80, slope: 24 },
    lowpass: { enabled: false, freq: 16000, slope: 24 },
    limiter: { enabled: false, threshold: 18, attackMs: 5, releaseMs: 200 }
  };
}

export function defaultPEQBand(): PEQBand {
  return { id: `peq-${Math.random().toString(36).slice(2, 8)}`, enabled: true, type: 'bell', freq: 1000, gain: 0, q: 1.4 };
}
