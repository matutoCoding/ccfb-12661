import type { AmpChannelBinding, ChannelDsp, LineArray, PlacedSpeaker, SpeakerModel, Vec3 } from './types';
import { directionFromAngles, rotateZ, sub, v3, angleBetween, clamp } from './geometry';

/** 展开后的可发声单元（单只音箱或线阵列中的一只箱体） */
export interface SpeakerInstance {
  uid: string;
  model: SpeakerModel;
  position: Vec3;
  azimuth: number;
  tilt: number;
  dsp: ChannelDsp | undefined;
  amp: AmpChannelBinding;
  /** 所属线阵列 id（点声源为 null） */
  lineArrayId: string | null;
  name: string;
}

/**
 * 计算一只箱体在给定偏轴角（度）下的指向性衰减（dB）。
 * 采用基于 -6dB 覆盖角的幂指数模型，频率越高指向性越强，
 * 高频在 2kHz 以上额外收窄（号筒效应的工程近似）。
 */
export function polarAttenuationDb(
  model: SpeakerModel,
  offAxisAngleDeg: number,
  freq: number,
): number {
  const theta = Math.abs(offAxisAngleDeg);
  // 覆盖角随频率收窄：2kHz 以上每倍频程收窄 12%，最低收到参考角的 55%
  const shrink = freq >= 2000
    ? Math.max(0.55, Math.pow(0.88, Math.log2(freq / 2000)))
    : 1;
  const covV = model.coverageV * shrink;
  // -6dB @ coverage/2 → 指数 k 使 angle=cov/2 时衰减 6dB
  const k = 6 / Math.pow(covV / 2, 2);
  const vert = -k * theta * theta;
  // 水平方向用 coverageH，简化为同轴对称合成（取较弱方向）
  // 调用方一般只给垂直偏轴；水平分量在 offAxis3d 中合并
  return vert;
}

/** 三维偏轴：综合水平/垂直覆盖角后的衰减 */
export function offAxisAttenuationDb(
  model: SpeakerModel,
  forward: Vec3,
  toListener: Vec3,
  freq: number,
): number {
  const angle = angleBetween(forward, toListener);
  // 分解为水平与垂直分量（绕 z 轴的投影）
  const fHz = Math.hypot(forward.x, forward.y);
  const lHz = Math.hypot(toListener.x, toListener.y);
  let hAngle = 0;
  if (fHz > 1e-9 && lHz > 1e-9) {
    const cosH = clamp(
      (forward.x * toListener.x + forward.y * toListener.y) / (fHz * lHz),
      -1,
      1,
    );
    hAngle = (Math.acos(cosH) * 180) / Math.PI;
  }
  const vAngle = Math.sqrt(Math.max(0, angle * angle - hAngle * hAngle));
  const shrink = freq >= 2000 ? Math.max(0.55, Math.pow(0.88, Math.log2(freq / 2000))) : 1;
  const kV = 6 / Math.pow((model.coverageV * shrink) / 2, 2);
  const kH = 6 / Math.pow(model.coverageH / 2, 2);
  return -(kV * vAngle * vAngle + kH * hAngle * hAngle);
}

/** 线阵列逐只箱体的位置与姿态（直吊杆简化模型，箱体沿夹角张开） */
export function lineArrayElements(array: LineArray, model: SpeakerModel): SpeakerInstance[] {
  const n = array.interAngles.length;
  const out: SpeakerInstance[] = [];
  // 当前箱体顶部中心点，第一只从吊挂点下移半个箱高
  let top: Vec3 = sub(array.hangPoint, v3(0, 0, model.size.h / 2));
  let tilt = array.startTilt;
  for (let i = 0; i < n; i++) {
    const center = sub(top, v3(0, 0, model.size.h / 2));
    const pos = rotateZ(center, 0); // 吊挂点已在世界坐标，方位角通过 forward 体现
    out.push({
      uid: `${array.id}#${i}`,
      model,
      position: pos,
      azimuth: array.azimuth,
      tilt,
      dsp: array.dsp,
      amp: array.ampBindings[i] ?? array.ampBindings[0],
      lineArrayId: array.id,
      name: `${array.name} #${i + 1}`,
    });
    // 下一只：沿当前箱体底面法向移动一个箱高，并叠加相邻夹角（俯角越来越负）
    top = sub(center, v3(0, 0, model.size.h / 2));
    tilt -= array.interAngles[i] ?? 0;
  }
  return out;
}

/** 线阵列箱体的实际世界坐标（考虑方位角，吊挂框架绕 z 旋转） */
export function lineArrayElementsWorld(array: LineArray, model: SpeakerModel): SpeakerInstance[] {
  const local = lineArrayElements(array, model);
  // 局部坐标以吊挂点为原点，先平移使吊挂点归零再绕 z 旋转后还原
  return local.map((el) => {
    const rel = sub(el.position, array.hangPoint);
    const rotated = rotateZ(rel, array.azimuth);
    return {
      ...el,
      position: {
        x: array.hangPoint.x + rotated.x,
        y: array.hangPoint.y + rotated.y,
        z: array.hangPoint.z + rotated.z,
      },
    };
  });
}

/** 把整套布置展开为发声单元列表 */
export function expandSpeakers(
  speakers: PlacedSpeaker[],
  arrays: LineArray[],
  models: Map<string, SpeakerModel>,
): SpeakerInstance[] {
  const out: SpeakerInstance[] = [];
  for (const s of speakers) {
    const model = models.get(s.speakerModelId);
    if (!model) continue;
    out.push({
      uid: s.id,
      model,
      position: s.position,
      azimuth: s.azimuth,
      tilt: s.tilt,
      dsp: s.dsp,
      amp: s.amp,
      lineArrayId: null,
      name: s.name,
    });
  }
  for (const a of arrays) {
    const model = models.get(a.speakerModelId);
    if (!model) continue;
    out.push(...lineArrayElementsWorld(a, model));
  }
  return out;
}

/** 单元主轴方向（世界坐标） */
export function speakerForward(el: SpeakerInstance): Vec3 {
  return directionFromAngles(el.azimuth, el.tilt);
}

/**
 * 单只单元在听众位置、给定频率下贡献的声压级（dB SPL）。
 * 基准：1m 全功率 maxSPL，叠加距离衰减、偏轴衰减、DSP 幅频响应。
 */
export function splAtListener(
  el: SpeakerInstance,
  listener: Vec3,
  freq: number,
): number {
  const delta = sub(listener, el.position);
  const r = Math.hypot(delta.x, delta.y, delta.z);
  if (r < 0.3) return el.model.maxSPL;
  const forward = speakerForward(el);
  const dir = { x: delta.x / r, y: delta.y / r, z: delta.z / r };
  const offAxis = offAxisAttenuationDb(el.model, forward, dir, freq);
  // 点声源 6dB/倍距；线声源单元 3dB/倍距（远距离圆柱波近似）
  const roll = el.model.isLineArrayElement ? 3 : 6;
  const distLoss = -(roll * Math.log2(r));
  // 空气吸收（2kHz 以上，近似 0.2 dB/m @8kHz 线性插值），小厅堂量很小
  const airLoss = freq >= 2000 ? -0.0001 * (freq / 1000) * r : 0;
  const dspGain = el.dsp && el.dsp.muted ? -Infinity : 0; // 频响由 analysis 层叠加
  if (dspGain === -Infinity) return -Infinity;
  return el.model.maxSPL + distLoss + offAxis + airLoss;
}
