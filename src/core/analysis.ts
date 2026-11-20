import { BAND_FREQS, type BandValues, type LevelBudgetChain, type MeasurePoint, type Vec3 } from './types';
import { dspMagnitudeDb, sumLevels, applyLimiter, powerToDb } from './dsp';
import { splAtListener, type SpeakerInstance } from './speakers';
import { sub } from './geometry';

/** 单个测点/网格点的声场结果 */
export interface PointAcousticResult {
  position: Vec3;
  /** 各频段总声压级（所有发声单元能量叠加，含 DSP 频响） */
  splByBand: BandValues;
  /** 宽带总声压级（频段能量和，dB SPL） */
  splTotal: number;
  /** 语言清晰度代理指标：直达声/混响声比 D/R（dB），由几何距离与房间 RT60 估算 */
  directToReverbDb: number;
}

/** 计算单点各单元贡献并叠加 */
export function analyzePoint(
  position: Vec3,
  speakers: SpeakerInstance[],
  opts: { sampleRate?: number } = {},
): PointAcousticResult {
  const sr = opts.sampleRate ?? 48000;
  const splByBand = {} as BandValues;
  let totalEnergy = 0;
  for (const f of BAND_FREQS) {
    const contributions: number[] = [];
    for (const el of speakers) {
      if (el.dsp?.muted) continue;
      let spl = splAtListener(el, position, f);
      if (!Number.isFinite(spl)) continue;
      spl += dspMagnitudeDb(el.dsp, f, sr);
      contributions.push(spl);
    }
    const bandLevel = contributions.length ? sumLevels(contributions) : -20;
    splByBand[f] = bandLevel;
    totalEnergy += Math.pow(10, bandLevel / 10);
  }
  return {
    position,
    splByBand,
    splTotal: 10 * Math.log10(totalEnergy),
    directToReverbDb: estimateDirectReverb(position, speakers),
  };
}

/**
 * 直达/混响比估算（dB）。
 * 直达声能量取最近音箱轴上贡献；混响声场按扩散场近似
 * R = S·ā/(1-ā)，混响声压级 Lr = Lw + 10log(4/R)，这里只做相对比值。
 */
export function estimateDirectReverb(position: Vec3, speakers: SpeakerInstance[]): number {
  let bestDirect = -Infinity;
  for (const el of speakers) {
    const r = Math.hypot(...Object.values(sub(position, el.position)));
    // 直达声相对 1m 的衰减
    const direct = el.model.maxSPL - (el.model.isLineArrayElement ? 3 : 6) * Math.log2(Math.max(1, r));
    bestDirect = Math.max(bestDirect, direct);
  }
  // 混响声能近似：所有单元满功率注入，混响场比直达声低一个与距离相关的量
  // 简化为经验式：Lr ≈ 平均 maxSPL - 12dB（小厅扩散场典型偏移）
  if (speakers.length === 0) return 0;
  const avgMax = speakers.reduce((s, e) => s + e.model.maxSPL, 0) / speakers.length;
  const reverb = avgMax - 12;
  return +(bestDirect - reverb).toFixed(1);
}

/** 测点结果表（方案对比页使用） */
export interface MeasureRow {
  point: MeasurePoint;
  result: PointAcousticResult;
}

export function analyzeMeasurePoints(
  points: MeasurePoint[],
  speakers: SpeakerInstance[],
): MeasureRow[] {
  return points.map((p) => ({ point: p, result: analyzePoint(p.position, speakers) }));
}

/** 观众区网格声场（WebGL 热力图数据源） */
export interface SplGrid {
  positions: Vec3[];
  values: number[];
  min: number;
  max: number;
  /** 不均匀度（最大-最小，dB） */
  uniformityDb: number;
  average: number;
}

export function analyzeGrid(positions: Vec3[], speakers: SpeakerInstance[]): SplGrid {
  const values: number[] = [];
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const p of positions) {
    const r = analyzePoint(p, speakers);
    values.push(r.splTotal);
    min = Math.min(min, r.splTotal);
    max = Math.max(max, r.splTotal);
    sum += r.splTotal;
  }
  if (positions.length === 0) {
    min = max = 0;
  }
  return {
    positions,
    values,
    min,
    max,
    uniformityDb: max - min,
    average: positions.length ? sum / positions.length : 0,
  };
}

// ---------- 电平预算 ----------
export interface LevelStageResult {
  name: string;
  /** 进入本级的节目信号峰值电平 dBu */
  inputDbu: number;
  /** 本级处理后输出电平 dBu */
  outputDbu: number;
  /** 本级额定最大输出 dBu */
  maxOutputDbu: number;
  /** 剩余动态余量 headroom（dB），负值即过载 */
  headroomDb: number;
  overloaded: boolean;
  /** 限幅器是否启动 */
  limiting: boolean;
}

export interface LevelBudgetResult {
  chainId: string;
  stages: LevelStageResult[];
  /** 最先过载的级索引（-1 表示无过载） */
  firstOverloadIndex: number;
  /** 末端音箱实际可达最大声压级（1m 轴上，dB SPL） */
  speakerMaxAchievableSpl: number;
  /** 节目信号（非峰值）下音箱实际声压级（按额定工作点估算） */
  speakerProgramSpl: number;
}

/**
 * 沿链路逐级推算电平。
 * 节目源输出电平 → 各级增益/DSP/限幅 → 功放削波点 → 折算音箱声压。
 */
export function analyzeLevelBudget(
  chain: LevelBudgetChain,
  target: SpeakerInstance | undefined,
): LevelBudgetResult {
  const stages: LevelStageResult[] = [];
  let level = chain.sourceLevelDbu;
  let firstOverload = -1;
  for (let i = 0; i < chain.stages.length; i++) {
    const st = chain.stages[i];
    const input = level;
    let out = input + st.gainDb + (st.dsp?.gainDb ?? 0);
    let limiting = false;
    if (st.dsp) {
      const before = out;
      out = applyLimiter(st.dsp, out);
      limiting = out < before - 0.05;
      if (st.dsp.muted) out = -120;
    }
    const headroom = st.maxOutputDbu - out;
    const overloaded = out > st.maxOutputDbu + 0.5;
    if (overloaded && firstOverload < 0) firstOverload = i;
    stages.push({
      name: st.name,
      inputDbu: input,
      outputDbu: out,
      maxOutputDbu: st.maxOutputDbu,
      headroomDb: +headroom.toFixed(2),
      overloaded,
      limiting,
    });
    level = out;
  }

  // 末端电平 → 音箱声压：以功放额定输入灵敏度为桥接
  // 音箱额定最大 SPL 已在型号参数中；链路末端余量按"末级输出 vs 末级额定"的差值折算
  let maxAchievable = 0;
  let programSpl = 0;
  if (target) {
    maxAchievable = target.model.maxSPL;
    const last = stages[stages.length - 1];
    if (last) {
      // 节目工作点相对满刻度的缺口
      const deficit = Math.max(0, last.maxOutputDbu - last.outputDbu);
      programSpl = maxAchievable - deficit;
    }
  }
  return {
    chainId: chain.id,
    stages,
    firstOverloadIndex: firstOverload,
    speakerMaxAchievableSpl: maxAchievable,
    speakerProgramSpl: programSpl,
  };
}

/** 由音箱功率与灵敏度核算最大 SPL（校验型号参数自洽性） */
export function theoreticalMaxSpl(sensitivityDb: number, powerW: number): number {
  return sensitivityDb + powerToDb(powerW);
}
