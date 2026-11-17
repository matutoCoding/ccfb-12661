import type { SpeakerModel, SpeakerInstance, Vec3 } from '../types';
import { BAND_COUNT, AIR_ATTEN, SOUND_SPEED, sumDb } from './bands';
import { angleBetweenDeg, deg2rad, eulerToDir, normalize, sub } from '../math/vec3';

/**
 * 余弦幂指向性模型：-6dB 夹角 θ60 对应指数 n = 0.5/log10(cos(θ60/2))…
 * 这里用衰减式：att(dB) = -6·(θ/θ60)² 在覆盖角内平滑，外面按 cos^n 滚降。
 * 水平 / 垂直两个切面分别计算后按能量合成。
 */
export function offAxisAttenuation(model: SpeakerModel, fromSpeaker: Vec3, speakerDir: Vec3): number {
  const theta = angleBetweenDeg(speakerDir, fromSpeaker); // 总偏轴角 0..180
  if (theta < 0.01) return 0;
  const theta60H = Math.max(model.coverageH, 1);
  const theta60V = Math.max(model.coverageV, 1);
  // 等效余弦幂指数：在 θ60 处恰为 -6dB → n = -0.5/log2(cos(θ60/2)) 形式不稳，
  // 采用工程近似 n = 6 / (20·log10(1/cos(θ60/2)))
  const nH = 6 / (20 * Math.log10(1 / Math.max(Math.cos(deg2rad(theta60H / 2)), 0.05)));
  const nV = 6 / (20 * Math.log10(1 / Math.max(Math.cos(deg2rad(theta60V / 2)), 0.05)));
  // 把总偏轴角按覆盖角比例拆给 H/V（椭圆投影近似，θH²+θV² ≈ 2θ²）
  const ratio = theta60H / Math.max(theta60V, 1);
  const thetaH = theta * Math.sqrt(ratio / (ratio + 1)) * Math.SQRT2;
  const thetaV = theta * Math.sqrt(1 / (ratio + 1)) * Math.SQRT2;
  const cosPowerAtt = (n: number, t: number): number =>
    -10 * n * Math.log10(Math.max(Math.cos(deg2rad(Math.min(t, 89.5))), 0.001));
  const attH = cosPowerAtt(nH, thetaH);
  const attV = cosPowerAtt(nV, thetaV);
  // 背后（>90°）附加障板滚降
  const rear = theta > 90 ? -10 * ((theta - 90) / 90) : 0;
  return Math.min(0, attH + attV + rear);
}

/** 音箱在某频带、某点处的轴向 1m 最大声压级（节目功率下） */
export function onAxisMaxSpl1m(model: SpeakerModel): number[] {
  const powerDb = 10 * Math.log10(Math.max(model.powerHandling, 1e-9));
  const base = model.sensitivity + powerDb; // 1W 灵敏度 + 功率增益
  return model.bandResponse.map((b) => base + b);
}

export interface SourceDrive {
  speakerId: string;
  /** 相对节目满功率的驱动电平差 dB（0 = 满功率额定输出，负值为实际驱动不足） */
  driveDb: number;
}

export interface ComplexPressure {
  /** 幅度 dB SPL（该带） */
  magDb: number;
  /** 相位 rad（用于相干叠加） */
  phase: number;
}

/** 单只音箱在接收点的各带声压（含距离、空气吸收、指向性、驱动电平） */
export function speakerPressureAt(
  model: SpeakerModel,
  inst: SpeakerInstance,
  point: Vec3,
  driveDb = 0
): { direct: ComplexPressure[]; distance: number; dir: Vec3 } {
  const delta = sub(point, inst.position);
  const distance = Math.max(Math.hypot(delta.x, delta.y, delta.z), 0.3);
  const dir = normalize(delta);
  const speakerDir = eulerToDir(inst.orientation);
  const att = offAxisAttenuation(model, dir, speakerDir);
  const max1m = onAxisMaxSpl1m(model);
  const direct: ComplexPressure[] = [];
  for (let b = 0; b < BAND_COUNT; b++) {
    const distanceLoss = 20 * Math.log10(distance);
    const airLoss = AIR_ATTEN[b] * distance;
    const mag = max1m[b] + driveDb + inst.gainOffset + att - distanceLoss - airLoss;
    // 相位：波数 k=2πf/c × 距离
    const k = (2 * Math.PI * [63, 125, 250, 500, 1000, 2000, 4000, 8000][b]) / SOUND_SPEED;
    direct.push({ magDb: mag, phase: k * distance });
  }
  return { direct, distance, dir };
}

/** 相干声压叠加（同带多声源）：复数和 → dB SPL */
export function sumComplexPressure(items: ComplexPressure[]): number {
  let re = 0, im = 0;
  for (const p of items) {
    const amp = Math.pow(10, p.magDb / 20);
    re += amp * Math.cos(p.phase);
    im += amp * Math.sin(p.phase);
  }
  const mag = Math.hypot(re, im);
  return mag <= 1e-9 ? -999 : 20 * Math.log10(mag);
}

/** 混响声场 SPL（各带），Lr = Lw + 10log10(4/R)，R 为房间常数 */
export function reverberantSpl(
  model: SpeakerModel,
  driveDb: number,
  roomConstantBands: number[]
): number[] {
  const max1m = onAxisMaxSpl1m(model);
  // 声功率级 Lw ≈ 轴向 1m SPL - 10log10(Q)，Q 由 DI 得
  return max1m.map((l1m, b) => {
    const Q = Math.pow(10, (model.directivityIndex[b] ?? 0) / 10);
    const lw = l1m + driveDb - 10 * Math.log10(Math.max(Q, 1));
    const R = Math.max(roomConstantBands[b], 0.1);
    return lw + 10 * Math.log10(4 / R);
  });
}

/** 直达 + 混响总 SPL（单只，能量叠加） */
export function totalSpl(directBands: number[], reverbBands: number[]): number[] {
  return directBands.map((d, b) => sumDb([d, reverbBands[b]]));
}
