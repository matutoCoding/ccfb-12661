import { BAND_FREQS, type BandValues, type Material, type Vec3 } from './types';
import {
  dist,
  mirrorPoint,
  normalize,
  rayAabbFace,
  reflect,
  sub,
  type Ray,
} from './geometry';
import type { RoomFace } from './roomAcoustics';
import { reflectionCoefficient } from './roomAcoustics';
import type { SpeakerInstance } from './speakers';
import { offAxisAttenuationDb, speakerForward } from './speakers';
import { dspMagnitudeDb } from './dsp';

const SPEED_OF_SOUND = 343;
/**
 * 二阶反射线指向听众的方向容差。
 * 纯镜面二阶反射只精确命中空间中的特定点，离散网格座位采用接收球模型
 * （EASE/Odeon 同类做法）：张角约 18°，对应余弦 0.95。
 */
const AIM_COS_TOLERANCE = 0.95;

export interface ReflectionPath {
  order: 1 | 2;
  /** 反射面（按传播顺序） */
  faces: RoomFace[];
  /** 反射点（按传播顺序） */
  reflectionPoints: Vec3[];
  /** 虚声源位置（一阶为镜像点，二阶为两次镜像点） */
  imageSource: Vec3;
  /** 总路径长度 m */
  pathLength: number;
  /** 相对直达声的延时 ms */
  delayMs: number;
  /** 直达声路径长度 m */
  directLength: number;
  /** 各频段反射声在听众处的声压级 dB */
  levelByBand: BandValues;
  /** 各频段相对直达声的声级差 dB（负值表示比直达声弱） */
  relToDirectDb: BandValues;
}

export interface ReflectionResult {
  directLength: number;
  directLevelByBand: BandValues;
  paths: ReflectionPath[];
}

/**
 * 反射声线引擎（混合法）：
 *  - 一阶：标准虚声源法，虚声源→听众射线与墙面求交；
 *  - 二阶：对每条有效一阶反射线做镜面反射，若反射后射线经过听众
 *    （方向夹角在容差内），则构成 S→f1→f2→L 的二阶路径。
 * 相比纯二阶虚声源枚举，混合法在轴对齐盒体中不会因镜像顺序/
 * 平行面几何约束漏掉真实可达路径。
 */
export function traceReflections(
  speaker: SpeakerInstance,
  listener: Vec3,
  faces: RoomFace[],
  materials: Map<string, Material>,
  maxOrder: 1 | 2 = 2,
): ReflectionResult {
  const directLen = dist(speaker.position, listener);
  const directLevel = {} as BandValues;
  const toListener = normalize(sub(listener, speaker.position));
  for (const f of BAND_FREQS) {
    const polar = offAxisAttenuationDb(speaker.model, speakerForward(speaker), toListener, f);
    const roll = speaker.model.isLineArrayElement ? 3 : 6;
    directLevel[f] =
      speaker.model.maxSPL -
      roll * Math.log2(Math.max(1, directLen)) +
      polar +
      dspMagnitudeDb(speaker.dsp, f);
  }

  const paths: ReflectionPath[] = [];

  // ---------- 一阶：虚声源法 ----------
  for (const face of faces) {
    const image = mirrorPoint(speaker.position, face.plane);
    const ray: Ray = { origin: image, dir: normalize(sub(listener, image)) };
    const total = dist(image, listener);
    const hit = rayAabbFace(ray, face.plane, face.min, face.max);
    if (!hit || hit.t <= 1e-6 || hit.t >= total - 1e-6) continue;

    const pathLength = dist(speaker.position, hit.point) + dist(hit.point, listener);
    paths.push(
      buildPath({
        order: 1,
        faces: [face],
        points: [hit.point],
        image,
        pathLength,
        directLen,
        speaker,
        materials,
        directLevel,
        listener,
      }),
    );

    // ---------- 二阶：一阶反射线继续镜面反射 ----------
    if (maxOrder < 2) continue;
    const incidentDir = normalize(sub(hit.point, speaker.position));
    const reflectedDir = reflect(incidentDir, face.plane.normal);
    const ray2: Ray = { origin: hit.point, dir: reflectedDir };
    for (const face2 of faces) {
      if (face2.id === face.id) continue;
      const hit2 = rayAabbFace(ray2, face2.plane, face2.min, face2.max);
      if (!hit2 || hit2.t <= 1e-3) continue;
      // 第二次反射后的射线是否指向听众（接收球容差），
      // 且听众必须位于第二反射点前方（射线传播方向上）
      const dirAfter2 = reflect(reflectedDir, face2.plane.normal);
      const from2toListener = sub(listener, hit2.point);
      const dist2ToL = Math.hypot(from2toListener.x, from2toListener.y, from2toListener.z);
      if (dist2ToL < 0.1) continue;
      const toListenerFrom2 = normalize(from2toListener);
      const cos =
        dirAfter2.x * toListenerFrom2.x +
        dirAfter2.y * toListenerFrom2.y +
        dirAfter2.z * toListenerFrom2.z;
      if (cos < AIM_COS_TOLERANCE) continue;
      const segment2 = dist(hit.point, hit2.point);
      const segment3 = dist(hit2.point, listener);
      const pathLength2 = dist(speaker.position, hit.point) + segment2 + segment3;
      const image2 = mirrorPoint(mirrorPoint(speaker.position, face.plane), face2.plane);
      paths.push(
        buildPath({
          order: 2,
          faces: [face, face2],
          points: [hit.point, hit2.point],
          image: image2,
          pathLength: pathLength2,
          directLen,
          speaker,
          materials,
          directLevel,
          listener,
        }),
      );
    }
  }

  return { directLength: directLen, directLevelByBand: directLevel, paths };
}

interface BuildPathArgs {
  order: 1 | 2;
  faces: RoomFace[];
  points: Vec3[];
  image: Vec3;
  pathLength: number;
  directLen: number;
  speaker: SpeakerInstance;
  materials: Map<string, Material>;
  directLevel: BandValues;
  listener: Vec3;
}

function buildPath(args: BuildPathArgs): ReflectionPath {
  const { order, faces, points, image, pathLength, directLen, speaker, materials, directLevel, listener } = args;
  const levelByBand = {} as BandValues;
  const relToDirect = {} as BandValues;
  for (const band of BAND_FREQS) {
    let reflectDb = 0;
    for (const face of faces) {
      const mat = materials.get(face.materialId);
      reflectDb += 10 * Math.log10(Math.max(1e-4, reflectionCoefficient(mat, band)));
    }
    const roll = speaker.model.isLineArrayElement ? 3 : 6;
    // 偏轴以虚声源→真实听众方向近似（虚声源法的等效辐射方向）
    const imgDir = normalize(sub(listener, image));
    const polar = offAxisAttenuationDb(speaker.model, speakerForward(speaker), imgDir, band);
    const level =
      speaker.model.maxSPL -
      roll * Math.log2(Math.max(1, pathLength)) +
      polar +
      reflectDb +
      dspMagnitudeDb(speaker.dsp, band);
    levelByBand[band] = level;
    relToDirect[band] = level - directLevel[band];
  }
  return {
    order,
    faces,
    reflectionPoints: points,
    imageSource: image,
    pathLength,
    delayMs: ((pathLength - directLen) / SPEED_OF_SOUND) * 1000,
    directLength: directLen,
    levelByBand,
    relToDirectDb: relToDirect,
  };
}

export interface EchoRisk {
  faceId: string;
  faceLabel: string;
  /** 回声延时 ms（相对直达声） */
  delayMs: number;
  /** 中频（500Hz/1kHz 平均）相对直达声级差 dB */
  midRelLevelDb: number;
  path: ReflectionPath;
}

export interface SeatEchoResult {
  position: Vec3;
  risks: EchoRisk[];
}

/**
 * 回声判定：延时超过阈值且强度足够高的反射视为潜在回声。
 * 剧场设计常用判据：Δt > 50ms 且 ΔL > -10dB（Haas 区域外仍可闻的孤立反射）。
 */
export function detectEchoes(
  result: ReflectionResult,
  position: Vec3,
  opts: { minDelayMs?: number; maxRelLevelDb?: number } = {},
): SeatEchoResult {
  const minDelay = opts.minDelayMs ?? 50;
  const maxRel = opts.maxRelLevelDb ?? -10;
  const risks: EchoRisk[] = [];
  for (const p of result.paths) {
    if (p.delayMs < minDelay) continue;
    const midRel = (p.relToDirectDb[500] + p.relToDirectDb[1000]) / 2;
    if (midRel < maxRel) continue;
    const face = p.faces[p.faces.length - 1];
    risks.push({
      faceId: face.id,
      faceLabel: faceLabel(face.id),
      delayMs: +p.delayMs.toFixed(1),
      midRelLevelDb: +midRel.toFixed(1),
      path: p,
    });
  }
  risks.sort((a, b) => b.midRelLevelDb - a.midRelLevelDb);
  return { position, risks };
}

export function faceLabel(id: string): string {
  const labels: Record<string, string> = {
    floor: '地面',
    ceiling: '顶棚',
    west: '西侧墙',
    east: '东侧墙',
    north: '舞台后墙',
    south: '观众厅后墙',
  };
  return labels[id] ?? id;
}

/** 声速（m/s），供其他模块复用 */
export const SOUND_SPEED = SPEED_OF_SOUND;
