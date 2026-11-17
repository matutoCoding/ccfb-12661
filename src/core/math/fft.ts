// 轻量 radix-2 FFT（迭代位反转），零依赖
export class FFT {
  readonly n: number;
  private readonly rev: Int32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  constructor(n: number) {
    if ((n & (n - 1)) !== 0 || n < 2) throw new Error('FFT 长度必须是 2 的幂');
    this.n = n;
    this.rev = new Int32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let x = i, r = 0;
      for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
  }

  /** 原地变换，inverse=true 为 IFFT */
  transform(re: Float64Array, im: Float64Array, inverse = false): void {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const twR = this.cos[k * step];
          const twI = (inverse ? -this.sin[k * step] : this.sin[k * step]);
          const a = start + k;
          const b = a + half;
          const tr = re[b] * twR - im[b] * twI;
          const ti = re[b] * twI + im[b] * twR;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

/** 求不小于 n 的最小 2 的幂 */
export function nextPow2(n: number): number {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(n, 2))));
}

/** 两个实信号的线性卷积（频域实现） */
export function convolveReal(a: Float32Array | number[], b: Float32Array | number[]): Float32Array {
  const outLen = a.length + b.length - 1;
  const n = nextPow2(outLen);
  const fft = new FFT(n);
  const reA = new Float64Array(n), imA = new Float64Array(n);
  const reB = new Float64Array(n), imB = new Float64Array(n);
  for (let i = 0; i < a.length; i++) reA[i] = a[i];
  for (let i = 0; i < b.length; i++) reB[i] = b[i];
  fft.transform(reA, imA);
  fft.transform(reB, imB);
  const reC = new Float64Array(n), imC = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    reC[i] = reA[i] * reB[i] - imA[i] * imB[i];
    imC[i] = reA[i] * imB[i] + imA[i] * reB[i];
  }
  fft.transform(reC, imC, true);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = reC[i];
  return out;
}

/** 单边幅度谱（dB，归一化到峰值 0） */
export function magnitudeSpectrumDb(signal: Float32Array, sampleRate: number): { freq: number; db: number }[] {
  const n = nextPow2(signal.length);
  const fft = new FFT(n);
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < signal.length; i++) re[i] = signal[i];
  fft.transform(re, im);
  const half = n / 2;
  let peak = 1e-12;
  const mags = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    mags[i] = Math.hypot(re[i], im[i]);
    if (mags[i] > peak) peak = mags[i];
  }
  const out: { freq: number; db: number }[] = [];
  for (let i = 1; i < half; i++) out.push({ freq: (i * sampleRate) / n, db: 20 * Math.log10(mags[i] / peak) });
  return out;
}
