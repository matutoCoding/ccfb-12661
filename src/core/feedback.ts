import { BAND_FREQS, type BandFreq, type Microphone, type Vec3 } from './types';
import { angleBetween, dist, sub } from './geometry';
import { dspMagnitudeDb, sumLevels } from './dsp';
import { offAxisAttenuationDb, speakerForward, type SpeakerInstance } from './speakers';

/** 讲话人参考声压级（1m 处，正常发言） */
export const TALKER_SPL_AT_1M = 70;
/** 心形话筒指向性最低衰减（dB，后向拾音底噪） */
const MIC_REJECTION_FLOOR = -40;

/**
 * 心形指向话筒对来自 sourceDir 方向声音的拾取衰减（dB）。
 * 主轴方向 0dB，正后方约 -∞（这里封底 -40dB）。
 */
export function micPolarDb(mic: Microphone, sourcePos: Vec3): number {
  const toSource = sub(sourcePos, mic.position);
  // 话筒主轴：azimuth=0 朝 -x（舞台）
  const forward = {
    x: -Math.cos((mic.azimuth * Math.PI) / 180),
    y: -Math.sin((mic.azimuth * Math.PI) / 180),
    z: Math.sin((mic.tilt * Math.PI) / 180),
  };
  const theta = angleBetween(forward, toSource);
  const factor = 0.5 * (1 + Math.cos((theta * Math.PI) / 180));
  return Math.max(MIC_REJECTION_FLOOR, 20 * Math.log10(Math.max(1e-4, factor)));
}

export interface FeedbackBandResult {
  freq: BandFreq;
  /** 闭环回路增益 dB（>=0 即满足啸叫幅值条件） */
  loopGainDb: number;
  /** 啸叫余量 = -loopGain，dB；越小越危险 */
  marginDb: number;
  /** 各只音箱在该频段的回路贡献 dB */
  contributions: { speakerUid: string; gainDb: number }[];
}

export interface FeedbackResult {
  micId: string;
  micPosition: Vec3;
  bands: FeedbackBandResult[];
  /** 全频段最小啸叫余量 dB */
  minMarginDb: number;
  /** 最易起啸的频率点（余量最小的前 3 个） */
  worstFreqs: BandFreq[];
  /** 系统还能再增加多少增益（dB）而不啸叫 */
  availableGainDb: number;
  /** 传声增益（dB）：讲话人 1m/70dB 参考下，系统稳定工作时的最大放大能力 */
  transmissionGainDb: number;
}

/**
 * 闭环啸叫分析。
 * 回路：话筒 → 调音台/处理链增益 → 音箱 → 房间(距离/指向) → 话筒
 * 以讲话人在话筒处产生的声压为参考，回路增益 = 音箱回到话筒的声压级 - 讲话人声压级。
 * 话筒灵敏度在电压域两侧抵消，因此只需声压级差值。
 */
export function analyzeFeedback(
  mic: Microphone,
  speakers: SpeakerInstance[],
  opts: { talkerDistanceM?: number; sampleRate?: number; systemGainDb?: number } = {},
): FeedbackResult {
  const sr = opts.sampleRate ?? 48000;
  const talkerDist = opts.talkerDistanceM ?? 1;
  const systemGain = opts.systemGainDb ?? 0;
  const talkerSplAtMic = TALKER_SPL_AT_1M - 20 * Math.log10(Math.max(0.3, talkerDist));

  const bands: FeedbackBandResult[] = [];
  for (const f of BAND_FREQS) {
    const contributions: { speakerUid: string; gainDb: number }[] = [];
    for (const el of speakers) {
      if (el.dsp?.muted) continue;
      const r = dist(el.position, mic.position);
      if (r < 0.2) continue;
      const toMic = normalize3(sub(mic.position, el.position));
      const speakerPolar = offAxisAttenuationDb(el.model, speakerForward(el), toMic, f);
      const roll = el.model.isLineArrayElement ? 3 : 6;
      const distLoss = -(roll * Math.log2(r));
      const micPolar = micPolarDb(mic, el.position);
      const dspGain = dspMagnitudeDb(el.dsp, f, sr);
      const splAtMic =
        el.model.maxSPL + systemGain + dspGain + distLoss + speakerPolar + micPolar;
      contributions.push({ speakerUid: el.uid, gainDb: splAtMic });
    }
    const totalReturn = contributions.length ? sumLevels(contributions.map((c) => c.gainDb)) : -40;
    const loopGain = +(totalReturn - talkerSplAtMic).toFixed(2);
    bands.push({
      freq: f,
      loopGainDb: loopGain,
      marginDb: +(-loopGain).toFixed(2),
      contributions,
    });
  }

  const sorted = [...bands].sort((a, b) => a.marginDb - b.marginDb);
  const minMargin = sorted[0]?.marginDb ?? 0;
  return {
    micId: mic.id,
    micPosition: mic.position,
    bands,
    minMarginDb: minMargin,
    worstFreqs: sorted.slice(0, 3).map((b) => b.freq),
    availableGainDb: +Math.max(0, minMargin).toFixed(1),
    transmissionGainDb: +(TALKER_SPL_AT_1M + minMargin).toFixed(1),
  };
}

function normalize3(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/** 多话筒场景：返回全局最危险的啸叫频率合并表 */
export function aggregateWorstFreqs(results: FeedbackResult[]): {
  freq: BandFreq;
  worstMargin: number;
}[] {
  const map = new Map<BandFreq, number>();
  for (const r of results) {
    for (const b of r.bands) {
      const cur = map.get(b.freq);
      map.set(b.freq, cur === undefined ? b.marginDb : Math.min(cur, b.marginDb));
    }
  }
  return [...map.entries()]
    .map(([freq, worstMargin]) => ({ freq, worstMargin }))
    .sort((a, b) => a.worstMargin - b.worstMargin);
}
