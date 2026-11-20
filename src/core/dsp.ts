import type { ChannelDsp, EqBand } from './types';

// ---------- 电平换算 ----------
/** dBu → 电压 V（0dBu = 0.7746V） */
export const dbuToVolt = (dbu: number): number => 0.7746 * Math.pow(10, dbu / 20);
export const voltToDbu = (v: number): number => 20 * Math.log10(Math.max(v, 1e-12) / 0.7746);

/** 功率 W → dB（相对 1W） */
export const powerToDb = (w: number): number => 10 * Math.log10(Math.max(w, 1e-12));
export const dbToPower = (db: number): number => Math.pow(10, db / 10);

/** 声压级能量叠加（dB） */
export function sumLevels(levels: number[]): number {
  if (levels.length === 0) return -Infinity;
  const sum = levels.reduce((acc, l) => acc + Math.pow(10, l / 10), 0);
  return 10 * Math.log10(sum);
}

/** 距离衰减：球面波 20log10(r)，线声源可传 rollOffPerDouble（每倍频程 3dB） */
export function distanceAttenuation(r: number, rollOffPerDouble = 6): number {
  if (r <= 1) return 0;
  return -(rollOffPerDouble * Math.log2(r));
}

// ---------- RBJ Cookbook 双二阶滤波器 ----------
export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
}

/** 一阶高/低切（12 dB/oct，按 butterworth 二阶实现，处理器中最常见） */
export function highpassCoeffs(fc: number, sampleRate: number): BiquadCoeffs {
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cosw = Math.cos(w0);
  const q = 0.7071;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cosw) / 2 / a0,
    b1: -(1 + cosw) / a0,
    b2: (1 + cosw) / 2 / a0,
    a0: 1,
    a1: (-2 * cosw) / a0,
    a2: (1 - alpha) / a0,
  };
}

export function lowpassCoeffs(fc: number, sampleRate: number): BiquadCoeffs {
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cosw = Math.cos(w0);
  const q = 0.7071;
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cosw) / 2 / a0,
    b1: (1 - cosw) / a0,
    b2: (1 - cosw) / 2 / a0,
    a0: 1,
    a1: (-2 * cosw) / a0,
    a2: (1 - alpha) / a0,
  };
}

export function peakingCoeffs(fc: number, gainDb: number, q: number, sampleRate: number): BiquadCoeffs {
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const a = Math.pow(10, gainDb / 40);
  const a0 = 1 + alpha / a;
  return {
    b0: (1 + alpha * a) / a0,
    b1: (-2 * Math.cos(w0)) / a0,
    b2: (1 - alpha * a) / a0,
    a0: 1,
    a1: (-2 * Math.cos(w0)) / a0,
    a2: (1 - alpha / a) / a0,
  };
}

export function shelfCoeffs(
  fc: number,
  gainDb: number,
  high: boolean,
  sampleRate: number,
): BiquadCoeffs {
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const a = Math.pow(10, gainDb / 40);
  const cosw = Math.cos(w0);
  const sinw = Math.sin(w0);
  const s = 1; // shelf slope
  const alpha = (sinw / 2) * Math.sqrt((a + 1 / a) * (1 / s - 1) + 2);
  const sq = 2 * Math.sqrt(a) * alpha;
  const a0 = (a + 1) + (high ? 1 : -1) * (a - 1) * cosw + sq;
  if (high) {
    return {
      b0: a * ((a + 1) + (a - 1) * cosw + sq) / a0,
      b1: -2 * a * ((a - 1) + (a + 1) * cosw) / a0,
      b2: a * ((a + 1) + (a - 1) * cosw - sq) / a0,
      a0: 1,
      a1: 2 * ((a - 1) - (a + 1) * cosw) / a0,
      a2: ((a + 1) - (a - 1) * cosw + sq) / a0,
    };
  }
  return {
    b0: a * ((a + 1) - (a - 1) * cosw + sq) / a0,
    b1: 2 * a * ((a - 1) - (a + 1) * cosw) / a0,
    b2: a * ((a + 1) - (a - 1) * cosw - sq) / a0,
    a0: 1,
    a1: -2 * ((a - 1) + (a + 1) * cosw) / a0,
    a2: ((a + 1) + (a - 1) * cosw + sq) / a0,
  };
}

/** 双二阶滤波器在频率 f 处的幅频响应（dB） */
export function biquadMagnitudeDb(c: BiquadCoeffs, f: number, sampleRate: number): number {
  const w = (2 * Math.PI * f) / sampleRate;
  const phi = Math.cos(w);
  const psi = Math.sin(w);
  const real =
    (c.b0 + c.b1 * phi + c.b2 * Math.cos(2 * w)) /
    (c.a0 + c.a1 * phi + c.a2 * Math.cos(2 * w));
  const imag =
    (c.b1 * psi + c.b2 * Math.sin(2 * w)) / (c.a0 + c.a1 * phi + c.a2 * Math.cos(2 * w));
  return 20 * Math.log10(Math.max(Math.hypot(real, imag), 1e-9));
}

/** 单条 EQ 段频响 */
export function eqBandMagnitudeDb(band: EqBand, f: number, sampleRate: number): number {
  if (!band.enabled) return 0;
  let c: BiquadCoeffs;
  if (band.type === 'peaking') {
    c = peakingCoeffs(band.freq, band.gain, band.q, sampleRate);
  } else {
    c = shelfCoeffs(band.freq, band.gain, band.type === 'highshelf', sampleRate);
  }
  return biquadMagnitudeDb(c, f, sampleRate);
}

/**
 * 整条 DSP 通道在频率 f 处的总幅频响应（dB）。
 * 高/低切各按 2 阶 Linkwitz-Riley 风格处理（两级 2 阶 butterworth = 4 阶，
 * 工程处理器常见，这里用单级 butterworth 近似再 ×2 叠加）。
 */
export function dspMagnitudeDb(dsp: ChannelDsp | undefined, f: number, sampleRate = 48000): number {
  if (!dsp || dsp.muted) return dsp?.muted ? -Infinity : 0;
  let g = dsp.gainDb;
  if (dsp.highpass !== null && f < dsp.highpass * 4) {
    g += 2 * biquadMagnitudeDb(highpassCoeffs(dsp.highpass, sampleRate), f, sampleRate);
  }
  if (dsp.lowpass !== null && f > dsp.lowpass / 4) {
    g += 2 * biquadMagnitudeDb(lowpassCoeffs(dsp.lowpass, sampleRate), f, sampleRate);
  }
  for (const band of dsp.eq) {
    g += eqBandMagnitudeDb(band, f, sampleRate);
  }
  return g;
}

/** DSP 引入的群延时近似（仅延时器部分，单位 ms；EQ 相移延时忽略） */
export function dspDelayMs(dsp: ChannelDsp | undefined): number {
  return dsp?.delayMs ?? 0;
}

/**
 * 限幅器作用后的电平（dBu）。超过阈值按压缩比衰减。
 */
export function applyLimiter(dsp: ChannelDsp | undefined, inputDbu: number): number {
  if (!dsp) return inputDbu;
  if (inputDbu <= dsp.limiterThresholdDbu) return inputDbu;
  const over = inputDbu - dsp.limiterThresholdDbu;
  return dsp.limiterThresholdDbu + over / Math.max(1, dsp.limiterRatio);
}
