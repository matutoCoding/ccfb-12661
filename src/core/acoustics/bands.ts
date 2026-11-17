// 倍频程带定义与声学常量
export const BAND_CENTERS = [63, 125, 250, 500, 1000, 2000, 4000, 8000] as const;
export const BAND_COUNT = 8;

/** A 计权修正 dB（GB/T 3785 标准值，对应上述 8 个倍频程中心频率） */
export const A_WEIGHTING = [-26.2, -16.1, -8.6, -3.2, 0, 1.2, 1.0, -1.1];

/** 空气吸收衰减系数 m^-1（20℃ / 50%RH，ISO 9613-1 近似） */
export const AIR_ATTEN = [0.0001, 0.0003, 0.0006, 0.0013, 0.0024, 0.0055, 0.014, 0.038];

/** 声速 m/s（20℃） */
export const SOUND_SPEED = 343;
/** 空气密度 kg/m³ */
export const AIR_DENSITY = 1.204;
/** 参考声压 Pa */
export const P_REF = 2e-5;

/** dBu 与电压：0dBu = 0.7746V */
export const DBU_REF = 0.7745966692;

export function dbuToVolts(dbu: number): number {
  return DBU_REF * Math.pow(10, dbu / 20);
}

export function voltsToDbu(v: number): number {
  return 20 * Math.log10(Math.max(v, 1e-12) / DBU_REF);
}

/** 功率 W → 分贝 */
export function powerToDb(w: number): number {
  return 10 * Math.log10(Math.max(w, 1e-12));
}

/** 分贝能量叠加：输入各声源 dB，输出合成 dB */
export function sumDb(levels: number[]): number {
  if (levels.length === 0) return -Infinity;
  let sum = 0;
  for (const l of levels) {
    if (Number.isFinite(l)) sum += Math.pow(10, l / 10);
  }
  return sum <= 0 ? -Infinity : 10 * Math.log10(sum);
}

/** A 计权总声压级 */
export function dbaFromBands(bandLevels: number[]): number {
  return sumDb(bandLevels.map((l, i) => l + (A_WEIGHTING[i] ?? 0)));
}

/**
 * 对数等距频率点（啸叫曲线 / 频响曲线共用）
 * @param fLow 默认 40Hz，@param fHigh 默认 12kHz
 */
export function logFreqPoints(n: number, fLow = 40, fHigh = 12000): number[] {
  const out: number[] = [];
  const a = Math.log10(fLow), b = Math.log10(fHigh);
  for (let i = 0; i < n; i++) out.push(Math.pow(10, a + ((b - a) * i) / (n - 1)));
  return out;
}

/** 把细粒度频率上的响应归并到最近倍频程带（简单最近邻，用于 8 带汇总） */
export function nearestBandIndex(freq: number): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < BAND_CENTERS.length; i++) {
    const d = Math.abs(Math.log2(freq / BAND_CENTERS[i]));
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
