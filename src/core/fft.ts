/** 迭代版 radix-2 FFT（长度需为 2 的幂），就地运算 */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if ((n & (n - 1)) !== 0) throw new Error('FFT 长度必须为 2 的幂');
  // 位反转置换
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curR = 1;
      let curI = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + half] * curR - im[i + k + half] * curI;
        const vi = re[i + k + half] * curI + im[i + k + half] * curR;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + half] = ur - vr;
        im[i + k + half] = ui - vi;
        const nextR = curR * wr - curI * wi;
        curI = curR * wi + curI * wr;
        curR = nextR;
      }
    }
  }
}

/** 幅度谱（dB），输入实时信号，输出 n/2 个 bin（频率需结合采样率换算） */
export function magnitudeSpectrumDb(signal: Float32Array): { binIndex: number[]; db: number[] } {
  let size = 1;
  while (size < signal.length) size <<= 1;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < signal.length; i++) re[i] = signal[i];
  fft(re, im);
  const bins = size >> 1;
  const binIndex: number[] = [];
  const db: number[] = [];
  for (let i = 0; i < bins; i++) {
    binIndex.push(i);
    const mag = Math.hypot(re[i], im[i]) / size;
    db.push(20 * Math.log10(Math.max(1e-8, mag)));
  }
  return { binIndex, db };
}

/** 在指定频率列表上求信号的幅频响应（dB），用单点 DFT，适合少量频点 */
export function responseAtFreqs(
  signal: Float32Array,
  freqsHz: number[],
  sampleRate: number,
): number[] {
  const n = signal.length;
  return freqsHz.map((f) => {
    const w = (2 * Math.PI * f) / sampleRate;
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const x = signal[t];
      re += x * Math.cos(w * t);
      im -= x * Math.sin(w * t);
    }
    return 20 * Math.log10(Math.max(1e-8, Math.hypot(re, im) / n));
  });
}
