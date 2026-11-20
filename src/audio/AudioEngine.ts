import type { ChannelDsp, DrySample } from '../core/types';
import {
  highpassCoeffs,
  lowpassCoeffs,
  peakingCoeffs,
  shelfCoeffs,
  applyLimiter,
  type BiquadCoeffs,
} from '../core/dsp';

/**
 * Web Audio 试听引擎。
 * 信号链：干声样本 → 通道 DSP（高低切/EQ/延时/增益）→ Convolver（座位 IR，
 * 混响尾音由赛宾 RT60 驱动）→ 限幅器 → 主输出。
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private convolver: ConvolverNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private preDspGain: GainNode;
  private filters: BiquadFilterNode[] = [];
  private delay: DelayNode | null = null;
  private limiter: DynamicsCompressorNode;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentSample: DrySample | null = null;
  private playing = false;

  constructor() {
    this.ctx = new AudioContext({ sampleRate: 48000 });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.convolver = this.ctx.createConvolver();
    this.dryGain = this.ctx.createGain();
    this.wetGain = this.ctx.createGain();
    this.wetGain.gain.value = 0.85;
    this.dryGain.gain.value = 0.6;
    this.preDspGain = this.ctx.createGain();
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 2;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.12;

    this.preDspGain.connect(this.dryGain);
    this.preDspGain.connect(this.convolver);
    this.convolver.connect(this.wetGain);
    this.dryGain.connect(this.limiter);
    this.wetGain.connect(this.limiter);
    this.limiter.connect(this.master);
    this.master.connect(this.ctx.destination);
  }

  /** 安装座位脉冲响应（由 auralization.synthesizeImpulseResponse 生成） */
  setImpulseResponse(ir: Float32Array, sampleRate: number): void {
    const buffer = this.ctx.createBuffer(1, ir.length, sampleRate);
    buffer.copyToChannel(new Float32Array(ir), 0);
    // 无缝替换：先挂临时节点再切换
    const next = this.ctx.createConvolver();
    next.buffer = buffer;
    try {
      this.preDspGain.disconnect(this.convolver);
      this.convolver.disconnect(this.wetGain);
    } catch {
      /* 首次尚未连接时忽略 */
    }
    this.preDspGain.connect(next);
    next.connect(this.wetGain);
    this.convolver = next;
  }

  setWetMix(wet: number): void {
    this.wetGain.gain.value = Math.max(0, Math.min(1, wet));
    this.dryGain.gain.value = 1 - this.wetGain.gain.value * 0.4;
  }

  /** 把 DSP 参数映射到 Web Audio 节点（重建滤波器组） */
  applyDsp(dsp: ChannelDsp | undefined): void {
    for (const f of this.filters) {
      try {
        f.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.filters = [];
    if (!dsp) {
      this.preDspGain.gain.value = 1;
      return;
    }
    this.preDspGain.gain.value = Math.pow(10, dsp.gainDb / 20);
    const sr = this.ctx.sampleRate;
    const add = (c: BiquadCoeffs, type: BiquadFilterType, freq: number, gainOrQ: number, q: number) => {
      const node = this.ctx.createBiquadFilter();
      node.type = type;
      node.frequency.value = freq;
      node.Q.value = q;
      if (type === 'peaking' || type === 'lowshelf' || type === 'highshelf') node.gain.value = gainOrQ;
      this.filters.push(node);
      void c;
    };
    if (dsp.highpass !== null) add(highpassCoeffs(dsp.highpass, sr), 'highpass', dsp.highpass, 0, 0.707);
    if (dsp.lowpass !== null) add(lowpassCoeffs(dsp.lowpass, sr), 'lowpass', dsp.lowpass, 0, 0.707);
    for (const band of dsp.eq) {
      if (!band.enabled) continue;
      if (band.type === 'peaking') {
        add(peakingCoeffs(band.freq, band.gain, band.q, sr), 'peaking', band.freq, band.gain, band.q);
      } else {
        add(
          shelfCoeffs(band.freq, band.gain, band.type === 'highshelf', sr),
          band.type,
          band.freq,
          band.gain,
          band.q,
        );
      }
    }
    // 串联：preDspGain → f1 → f2 → ... → (dry/wet)
    let tail: AudioNode = this.preDspGain;
    for (const f of this.filters) {
      tail.connect(f);
      tail = f;
    }
    tail.connect(this.dryGain);
    tail.connect(this.convolver);

    if (this.delay) {
      try {
        this.delay.disconnect();
      } catch {
        /* ignore */
      }
    }
    if (dsp.delayMs > 0) {
      this.delay = this.ctx.createDelay(2);
      this.delay.delayTime.value = dsp.delayMs / 1000;
    }
  }

  /** 限幅阈值同步到压缩器（dBu 近似映射到 dBFS，18dBu≈0dBFS） */
  syncLimiter(dsp: ChannelDsp | undefined): void {
    if (!dsp) return;
    this.limiter.threshold.value = Math.max(-40, dsp.limiterThresholdDbu - 18);
    this.limiter.ratio.value = dsp.limiterRatio;
    // 校验与核心引擎一致（仅用于控制台自检）
    void applyLimiter;
  }

  async play(sample: DrySample, dsp?: ChannelDsp): Promise<void> {
    await this.ctx.resume();
    this.stop();
    const buffer = this.ctx.createBuffer(1, sample.channelData.length, sample.sampleRate);
    buffer.copyToChannel(new Float32Array(sample.channelData), 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.preDspGain);
    src.onended = () => {
      if (this.currentSource === src) {
        this.playing = false;
        this.currentSource = null;
      }
    };
    this.currentSource = src;
    this.currentSample = sample;
    this.applyDsp(dsp);
    this.syncLimiter(dsp);
    src.start();
    this.playing = true;
  }

  stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        /* 已停止 */
      }
      this.currentSource = null;
    }
    this.playing = false;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get activeSample(): DrySample | null {
    return this.currentSample;
  }

  setMasterVolume(v: number): void {
    this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  dispose(): void {
    this.stop();
    void this.ctx.close();
  }
}
