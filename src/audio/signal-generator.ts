// 程序化生成测试用干声样本与房间脉冲响应试听素材，全部离线合成、无外部依赖

/** 语音模拟干声：基频谐波 + 共振峰包络 + 音节幅度调制 */
export function generateSpeechSample(sampleRate = 48000, durationSec = 3): AudioBuffer {
  const ctx = new OfflineAudioContext(1, Math.floor(sampleRate * durationSec), sampleRate);
  const buffer = ctx.createBuffer(1, Math.floor(sampleRate * durationSec), sampleRate);
  const data = buffer.getChannelData(0);
  let phase = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    // 基频在 110-160Hz 间滑动（模拟语调）
    const f0 = 130 + 25 * Math.sin(2 * Math.PI * 0.7 * t) + 12 * Math.sin(2 * Math.PI * 2.3 * t);
    phase += (2 * Math.PI * f0) / sampleRate;
    // 谐波结构（声门波近似）
    let s = Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase) + 0.12 * Math.sin(4 * phase);
    // 三个共振峰带通着色（简化为时变增益）
    const formant =
      1.0 +
      0.8 * Math.sin(2 * Math.PI * 5.5 * t) +
      0.5 * Math.sin(2 * Math.PI * 8.1 * t + 1.3) +
      0.3 * Math.sin(2 * Math.PI * 11.7 * t);
    // 音节包络（~4Hz 说话节奏）+ 停顿
    const syllable = Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * 4.2 * t), 1.5);
    const pause = t > 1.4 && t < 1.7 ? 0.08 : 1;
    data[i] = s * formant * syllable * pause * 0.18;
  }
  return buffer;
}

/** 音乐片段干声：鼓点脉冲 + 贝斯线 + 和声pad */
export function generateMusicSample(sampleRate = 48000, durationSec = 4): AudioBuffer {
  const n = Math.floor(sampleRate * durationSec);
  const buffer = new OfflineAudioContext(1, n, sampleRate).createBuffer(1, n, sampleRate);
  const data = buffer.getChannelData(0);
  // 贝斯音型（Hz）
  const bassLine = [55, 55, 73.4, 65.4];
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const beat = t * 2; // 120 BPM 八分音符
    const step = Math.floor(beat) % bassLine.length;
    const f = bassLine[step];
    const bass = Math.sin(2 * Math.PI * f * t) * 0.12 * Math.exp(-((beat % 1) * 3));
    // 底鼓：60Hz 下滑短脉冲
    const kp = beat % 1;
    const kick = kp < 0.12 ? Math.sin(2 * Math.PI * (90 - 45 * kp / 0.12) * t) * Math.exp(-kp * 18) * 0.5 : 0;
    // pad：三和弦持续
    const pad =
      (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t)) *
      0.025 *
      (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t));
    data[i] = bass + kick + pad;
  }
  return buffer;
}

/** 粉噪声（系统调试常用），Voss-McCartney 简化 */
export function generatePinkNoise(sampleRate = 48000, durationSec = 2): AudioBuffer {
  const n = Math.floor(sampleRate * durationSec);
  const buffer = new OfflineAudioContext(1, n, sampleRate).createBuffer(1, n, sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;
    b1 = 0.963 * b1 + white * 0.2965164;
    b2 = 0.57 * b2 + white * 1.0526913;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.11;
  }
  return buffer;
}

/** Float32 RIR → AudioBuffer */
export function rirToBuffer(rir: Float32Array, sampleRate: number): AudioBuffer {
  const buffer = new OfflineAudioContext(1, rir.length, sampleRate).createBuffer(1, rir.length, sampleRate);
  buffer.copyToChannel(new Float32Array(rir), 0);
  return buffer;
}
