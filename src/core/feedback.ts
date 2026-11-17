import type {
  FeedbackPoint, FeedbackResult, Layout, MicInstance, SpeakerInstance, SpeakerModel
} from './types';
import { BAND_CENTERS, BAND_COUNT, logFreqPoints, nearestBandIndex, sumDb } from './acoustics/bands';
import { angleBetweenDeg, eulerToDir, normalize, sub } from './math/vec3';
import { chainFilterResponseDb } from './dsp';
import { offAxisAttenuation } from './acoustics/directivity';

interface FeedbackCtx {
  speakers: SpeakerModel[];
  /** 音箱节点 DSP（按 ampNodeId 查） */
  nodeDsp: Map<string, import('./types').DSPChain | undefined>;
  listener: import('./types').Vec3;
}

/** 心形指向的相对拾取增益 dB（0° 主轴 0dB，180° 背面约 -20dB） */
function micPatternGainDb(pattern: MicInstance['pattern'], angleDeg: number): number {
  if (pattern === 'omni') return 0;
  const a = (angleDeg * Math.PI) / 180;
  // 心形 p=(1+cosθ)/2，归一化到轴向
  const p = (1 + Math.cos(a)) / 2;
  return 20 * Math.log10(Math.max(p, 0.05));
}

/**
 * 单话筒在某频率的环路增益（dB）：
 * LG = Σ 音箱轴上输出 - 距离衰减 - 音箱偏轴 - 话筒偏轴 - DSP 滤波 + NOM 罚分
 * 啸叫余量 = -LG（LG 越接近 0 越危险）。
 */
function loopGainAt(
  mic: MicInstance,
  layout: Layout,
  ctx: FeedbackCtx,
  freq: number
): number {
  const bandIdx = nearestBandIndex(freq);
  const micDir = eulerToDir(mic.orientation);
  const contributions: number[] = [];
  let dSpeaker = Infinity;

  for (const sp of layout.speakers) {
    const model = ctx.speakers.find((m) => m.id === sp.modelId);
    if (!model) continue;
    const delta = sub(mic.position, sp.position);
    const r = Math.max(Math.hypot(delta.x, delta.y, delta.z), 0.3);
    dSpeaker = Math.min(dSpeaker, r);
    const dirFromSp = normalize(delta);
    const spDir = eulerToDir(sp.orientation);
    const spAtt = offAxisAttenuation(model, dirFromSp, spDir);
    const micIncident = normalize(sub(sp.position, mic.position)); // 指向音箱
    const micAngle = angleBetweenDeg(micDir, micIncident);
    const micAtt = micPatternGainDb(mic.pattern, micAngle);
    const distanceLoss = 20 * Math.log10(r);
    // 该音箱通道 DSP 在该频率的响应
    const dsp = sp.ampNodeId ? ctx.nodeDsp.get(sp.ampNodeId) : undefined;
    const dspDb = dsp ? sp.gainOffset + chainFilterResponseDb(dsp, freq) : sp.gainOffset;
    const bandColor = (model.bandResponse[bandIdx] ?? 0) + dspDb;
    // 环路中该路径的增益（以音箱 1m 最大声压为 0 参考的相对量）
    contributions.push(spAtt + micAtt - distanceLoss + bandColor);
  }
  if (contributions.length === 0) return -Infinity;
  // 多音箱能量叠加
  let lg = sumDb(contributions.map((c) => c));
  // NOM 罚分：10log10(N)，多话筒同时开启降低可用增益
  lg -= 10 * Math.log10(Math.max(layout.openMicCount, 1));
  return lg;
}

export function computeFeedback(
  mic: MicInstance,
  layout: Layout,
  ctx: FeedbackCtx
): FeedbackResult {
  const freqs = logFreqPoints(48, 50, 10000);
  const curve: FeedbackPoint[] = freqs.map((freq) => ({
    freq,
    marginDb: Math.round(-loopGainAt(mic, layout, ctx, freq) * 10) / 10
  }));
  const bandMargins = new Array(BAND_COUNT).fill(0).map((_, b) => {
    const inBand = curve.filter((p) => nearestBandIndex(p.freq) === b);
    const margins = inBand.length ? inBand.map((p) => p.marginDb) : [99];
    return Math.round(Math.min(...margins) * 10) / 10;
  });
  // 余量最小的 5 个频率点（局部谷值优先）
  const worst = [...curve]
    .filter((p, i) => {
      const prev = curve[i - 1]?.marginDb ?? Infinity;
      const next = curve[i + 1]?.marginDb ?? Infinity;
      return p.marginDb <= prev && p.marginDb <= next;
    })
    .sort((a, b) => a.marginDb - b.marginDb)
    .slice(0, 5);

  const dListener = Math.max(
    Math.hypot(
      ctx.listener.x - mic.position.x,
      ctx.listener.y - mic.position.y,
      ctx.listener.z - mic.position.z
    ),
    0.5
  );
  const dSpeaker = layout.speakers.reduce((m, sp) => {
    const r = Math.hypot(
      sp.position.x - mic.position.x,
      sp.position.y - mic.position.y,
      sp.position.z - mic.position.z
    );
    return Math.min(m, r);
  }, Infinity);

  return {
    micId: mic.id,
    micName: mic.name,
    curve,
    bandMargins,
    worst,
    dListener: Math.round(dListener * 10) / 10,
    dSpeaker: Math.round(Math.max(dSpeaker, 0.3) * 10) / 10
  };
}

/** 潜在声增益 PAG = 20log10(D_s/D_m)（工程简化，供报告展示） */
export function potentialAcousticGain(dListener: number, dSpeaker: number): number {
  return 20 * Math.log10(Math.max(dListener, 0.5) / Math.max(dSpeaker, 0.3));
}

export { BAND_CENTERS };
