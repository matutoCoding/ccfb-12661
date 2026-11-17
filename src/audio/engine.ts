import type { DSPChain } from '../core/types';
import { rirToBuffer } from './signal-generator';

/**
 * 试听引擎：干声 → 与通道 DSP 一致的滤波链 → 房间卷积（ConvolverNode）→ 限幅 → 输出。
 * 卷积核即声场分析合成的 RIR，其衰减时间常数由赛宾 RT60 反推，保证听感与计算值对齐。
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private dryGain!: GainNode;
  private wetGain!: GainNode;
  private master!: GainNode;
  private convolver!: ConvolverNode;
  private input!: GainNode;
  private preFilter!: BiquadFilterNode[];
  private limiter!: DynamicsCompressorNode;
  private source: AudioBufferSourceNode | null = null;
  private analyser!: AnalyserNode;
  private chain: DSPChain | null = null;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.limiter = this.ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -6;
      this.limiter.knee.value = 6;
      this.limiter.ratio.value = 20;
      this.dryGain = this.ctx.createGain();
      this.wetGain = this.ctx.createGain();
      this.convolver = this.ctx.createConvolver();
      this.preFilter = [];
      // 链路：source → input → preFilter(并联 dry/wet) → convolver → limiter → master → analyser → destination
      this.input = this.ctx.createGain();
      this.input.connect(this.dryGain);
      this.input.connect(this.convolver);
      this.convolver.connect(this.wetGain);
      this.dryGain.connect(this.master);
      this.wetGain.connect(this.master);
      this.master.connect(this.limiter);
      this.limiter.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** 安装 RIR（座位脉冲响应） */
  setRoomImpulse(rir: Float32Array, sampleRate: number): void {
    const ctx = this.ensureContext();
    const buffer = rirToBuffer(rir, sampleRate);
    // 采样率不一致时重采样
    if (buffer.sampleRate !== ctx.sampleRate) {
      const ratio = ctx.sampleRate / buffer.sampleRate;
      const resampled = ctx.createBuffer(1, Math.floor(buffer.length * ratio), ctx.sampleRate);
      const src = buffer.getChannelData(0);
      const dst = resampled.getChannelData(0);
      for (let i = 0; i < dst.length; i++) {
        const pos = i / ratio;
        const i0 = Math.floor(pos);
        const frac = pos - i0;
        dst[i] = (src[i0] ?? 0) * (1 - frac) + (src[i0 + 1] ?? src[i0] ?? 0) * frac;
      }
      this.convolver.buffer = resampled;
    } else {
      this.convolver.buffer = buffer;
    }
  }

  /** 按 DSPChain 重建预滤波（PEQ + 高低切），与计算引擎同一组参数 */
  setDSPChain(chain: DSPChain): void {
    const ctx = this.ensureContext();
    this.chain = chain;
    // 断开 input 当前全部下游，移除旧滤波链，保证不会重复出声
    try { this.input.disconnect(); } catch { /* noop */ }
    for (const f of this.preFilter) {
      try { f.disconnect(); } catch { /* noop */ }
    }
    this.preFilter = [];
    const filters: BiquadFilterNode[] = [];
    const make = (type: BiquadFilterType, freq: number, gain = 1, q = 1): BiquadFilterNode => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.gain.value = gain;
      f.Q.value = q;
      return f;
    };
    if (chain.highpass.enabled) {
      filters.push(make('highpass', chain.highpass.freq, 0, chain.highpass.slope === 24 ? 0.707 : 0.5));
      if (chain.highpass.slope === 24) filters.push(make('highpass', chain.highpass.freq, 0, 1.31));
    }
    for (const band of chain.peq) {
      if (!band.enabled) continue;
      const type = band.type === 'bell' ? 'peaking' : band.type === 'lowshelf' ? 'lowshelf' : 'highshelf';
      filters.push(make(type, band.freq, band.gain, band.q));
    }
    if (chain.lowpass.enabled) {
      filters.push(make('lowpass', chain.lowpass.freq, 0, chain.lowpass.slope === 24 ? 0.707 : 0.5));
      if (chain.lowpass.slope === 24) filters.push(make('lowpass', chain.lowpass.freq, 0, 1.31));
    }
    // input → filter1 → … → (dryGain + convolver)；无滤波时 input 直连
    let node: AudioNode = this.input;
    for (const f of filters) {
      node.connect(f);
      node = f;
    }
    node.connect(this.dryGain);
    node.connect(this.convolver);
    this.preFilter = filters;
    this.limiter.threshold.value = chain.limiter.enabled ? chain.limiter.threshold - 24 : -3;
  }

  async play(buffer: AudioBuffer, wetMix = 0.7): Promise<void> {
    const ctx = this.ensureContext();
    await ctx.resume();
    this.stop();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.input);
    this.dryGain.gain.value = 1 - wetMix;
    this.wetGain.gain.value = wetMix;
    if (this.chain?.mute) this.master.gain.value = 0;
    else this.master.gain.value = Math.pow(10, (this.chain?.gain ?? 0) / 20) * 0.8;
    src.start();
    this.source = src;
  }

  stop(): void {
    if (this.source) {
      try { this.source.stop(); } catch { /* noop */ }
      this.source.disconnect();
      this.source = null;
    }
  }

  get isPlaying(): boolean {
    return this.source !== null;
  }

  /** 实时电平表（-60..0 dBFS） */
  readLevel(): number {
    if (!this.ctx) return -Infinity;
    const arr = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(arr);
    let peak = 0;
    for (const v of arr) peak = Math.max(peak, Math.abs(v - 128) / 128);
    return peak <= 0 ? -60 : 20 * Math.log10(peak);
  }

  get sampleRate(): number {
    return this.ensureContext().sampleRate;
  }
}

export const audioEngine = new AudioEngine();
