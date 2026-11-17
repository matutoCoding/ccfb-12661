import type {
  Material, ReflectionPath, Surface, Vec3, Venue, AudienceZone, EchoSeatMap
} from './types';
import { BAND_CENTERS, BAND_COUNT, SOUND_SPEED, sumDb } from './acoustics/bands';
import {
  mirrorPoint, planeFromPolygon, rayPolygonHit, segmentBlocked, surfacePolygon, surfacePlane
} from './math/geometry';
import type { Plane, Ray } from './math/geometry';
import { add, normalize, scale, sub } from './math/vec3';
import { pointInPolygon } from './math/vec3';
import { rt60ToTau } from './acoustics/reverb';

/** 表面反射系数 R = √(1-α)（各带），能量守恒近似 */
function reflectionCoeffs(mat: Material): number[] {
  return mat.absorption.map((a) => Math.sqrt(Math.max(0.02, 1 - a)));
}

interface ImageHit {
  surface: Surface;
  plane: Plane;
  point: Vec3;
  t: number;
}

/** 从镜像源向接收点连线，依次求与反射面的交点 */
function imagePathHits(
  imageSource: Vec3,
  receiver: Vec3,
  chain: Surface[],
  venue: Venue
): ImageHit[] | null {
  const ray: Ray = { origin: imageSource, dir: normalize(sub(receiver, imageSource)) };
  const total = Math.hypot(receiver.x - imageSource.x, receiver.y - imageSource.y, receiver.z - imageSource.z);
  const hits: ImageHit[] = [];
  let cursor = imageSource;
  const ignore = new Set<string>();
  for (const surface of chain) {
    const poly = surfacePolygon(surface, venue);
    const hit = rayPolygonHit({ origin: cursor, dir: ray.dir }, poly);
    if (!hit || hit.t > total + 1e-4) return null;
    hits.push({ surface, plane: surfacePlane(surface, venue), point: hit.point, t: hit.t });
    ignore.add(surface.id);
    cursor = hit.point;
  }
  return hits;
}

export interface ReflectionOptions {
  maxOrder: 1 | 2;
  /** 回声判定：相对直达延时超过该值（ms） */
  echoDelayMs: number;
  /** 回声判定：相对直达声级差小于该值（dB，即反射足够强） */
  echoLevelDb: number;
}

/**
 * 镜像声源法枚举反射路径。
 * @param source 声源（音箱）位置
 * @param receiver 接收点
 */
export function findReflectionPaths(
  source: Vec3,
  receiver: Vec3,
  venue: Venue,
  materials: Map<string, Material>,
  opts: ReflectionOptions
): ReflectionPath[] {
  const out: ReflectionPath[] = [];
  const directLen = Math.hypot(receiver.x - source.x, receiver.y - source.y, receiver.z - source.z);
  const surfaces = venue.surfaces;

  const buildPath = (chain: Surface[], image: Vec3): ReflectionPath | null => {
    const hits = imagePathHits(image, receiver, chain, venue);
    if (!hits) return null;
    // 物理路径 = 源→各反射点→接收点
    const points = [source, ...hits.map((h) => h.point), receiver];
    const ignore = new Set(chain.map((s) => s.id));
    for (let i = 0; i < points.length - 1; i++) {
      if (segmentBlocked(points[i], points[i + 1], surfaces, venue, ignore)) return null;
    }
    let lengthM = 0;
    for (let i = 0; i < points.length - 1; i++) {
      lengthM += Math.hypot(
        points[i + 1].x - points[i].x,
        points[i + 1].y - points[i].y,
        points[i + 1].z - points[i].z
      );
    }
    const delayMs = ((lengthM - directLen) / SOUND_SPEED) * 1000;
    // 各带反射损失（乘积）+ 距离差
    const levelDeltaBands = new Array(BAND_COUNT).fill(0).map((_, b) => {
      let r = 0;
      for (const s of chain) {
        const mat = materials.get(s.materialId);
        if (mat) r += 20 * Math.log10(reflectionCoeffs(mat)[b]);
      }
      const extraSpread = 20 * Math.log10(directLen / Math.max(lengthM, 0.1));
      return r + extraSpread;
    });
    const mid = (levelDeltaBands[3] + levelDeltaBands[4] + levelDeltaBands[5]) / 3;
    const isEcho = delayMs >= opts.echoDelayMs && mid >= -opts.echoLevelDb;
    return {
      order: chain.length as 1 | 2,
      surfaceIds: chain.map((s) => s.id),
      points,
      lengthM: Math.round(lengthM * 100) / 100,
      delayMs: Math.round(delayMs * 10) / 10,
      levelDeltaBands: levelDeltaBands.map((x) => Math.round(x * 10) / 10),
      levelDelta: Math.round(mid * 10) / 10,
      isEcho
    };
  };

  // 一阶：对每个面镜像
  for (const s1 of surfaces) {
    const plane1 = surfacePlane(s1, venue);
    const img1 = mirrorPoint(source, plane1);
    const p = buildPath([s1], img1);
    if (p) out.push(p);

    if (opts.maxOrder >= 2) {
      // 二阶：先对 s2 镜像，再对 s1 镜像（按反射顺序）
      for (const s2 of surfaces) {
        if (s2.id === s1.id) continue;
        const plane2 = surfacePlane(s2, venue);
        const img2 = mirrorPoint(source, plane2);
        const img12 = mirrorPoint(img2, plane1);
        const p2 = buildPath([s1, s2], img12);
        if (p2) out.push(p2);
      }
    }
  }
  // 去重（同面组+相近长度）并按延时排序
  const seen = new Set<string>();
  return out
    .filter((p) => {
      const key = `${p.surfaceIds.join('|')}@${Math.round(p.lengthM * 10)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.delayMs - b.delayMs);
}

/** 观众区回声受影响座位图 */
export function computeEchoMap(
  source: Vec3,
  venue: Venue,
  materials: Map<string, Material>,
  zones: AudienceZone[],
  samplePoints: { position: Vec3; zone: AudienceZone }[],
  opts: ReflectionOptions
): EchoSeatMap {
  const points = samplePoints.map((sp) => {
    const paths = findReflectionPaths(source, sp.position, venue, materials, opts);
    const echoes = paths.filter((p) => p.isEcho);
    const worst = echoes.sort((a, b) => b.levelDelta - a.levelDelta)[0];
    return {
      position: sp.position,
      echo: echoes.length > 0,
      worstDelayMs: worst?.delayMs ?? 0,
      worstLevelDelta: worst?.levelDelta ?? -999
    };
  });
  return { points };
}

// ---------- 房间脉冲响应合成 ----------

export interface RIRSpec {
  sampleRate: number;
  rt60Bands: number[];
  /** 离散反射（直达 + 早期反射） */
  reflections: { delayMs: number; gainBands: number[] }[];
  /** 直达声各带相对幅度 dB */
  directBandsDb: number[];
  durationSec: number;
}

/**
 * 合成 RIR：离散早期脉冲 + 指数衰减晚期噪声（高斯白噪 × 每带包络后混合）。
 * 晚期衰减时间常数由 RT60 反推，保证试听混响尾与计算 RT60 一致。
 */
export function synthesizeRIR(spec: RIRSpec): Float32Array {
  const { sampleRate, rt60Bands, durationSec } = spec;
  const n = Math.floor(sampleRate * durationSec);
  const rir = new Float32Array(n);

  // 晚期场：每带一个噪声序列，按 exp(-t/τ) 包络，起始于混合时间
  const lateStartSec = 0.05;
  const lateStart = Math.floor(sampleRate * lateStartSec);
  let seed = 1234567;
  const randn = () => {
    // Box-Muller
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const u1 = (seed + 1) / 0x80000000;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const u2 = (seed + 1) / 0x80000000;
    return Math.sqrt(-2 * Math.log(Math.max(u1, 1e-9))) * Math.cos(2 * Math.PI * u2);
  };
  for (let b = 0; b < BAND_COUNT; b++) {
    const tau = rt60ToTau(rt60Bands[b] || 1);
    const bandWeight = Math.pow(10, ((spec.directBandsDb[b] ?? -30) + 6) / 20);
    // 简化的带通：用中心频率正弦调制噪声（频谱着色近似）
    const fc = BAND_CENTERS[b];
    for (let i = lateStart; i < n; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-(t - lateStartSec) / tau) * bandWeight * 0.12;
      rir[i] += randn() * env * (0.6 + 0.4 * Math.sin(2 * Math.PI * fc * t));
    }
  }

  // 离散反射脉冲（早期声），幅度受控，不做全局峰值归一化以保留晚期衰减斜率
  for (const refl of spec.reflections) {
    const idx = Math.floor((refl.delayMs / 1000) * sampleRate);
    if (idx >= n) continue;
    const gain = sumDb(refl.gainBands.map((g) => g));
    const amp = Math.pow(10, Math.min(gain, 100) / 20) * 0.02;
    // 短 sinc 展宽避免数字尖峰
    for (let k = -2; k <= 2; k++) {
      const j = idx + k;
      if (j >= 0 && j < n) rir[j] += amp * (k === 0 ? 1 : 0.25 / Math.abs(k));
    }
  }
  // 仅做软限幅，避免削波；晚期场内部相对包络不变
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(rir[i]));
  const ceiling = 0.7;
  if (peak > ceiling) {
    const k = ceiling / peak;
    for (let i = 0; i < n; i++) rir[i] *= k;
  }
  return rir;
}

/** 由反射路径结果组装 RIR 规格中的离散反射项 */
export function pathsToRirReflections(paths: ReflectionPath[], directBandsDb: number[]) {
  const refs = [{ delayMs: 0, gainBands: directBandsDb }];
  for (const p of paths.slice(0, 24)) {
    refs.push({
      delayMs: p.delayMs,
      gainBands: p.levelDeltaBands.map((d, b) => (directBandsDb[b] ?? -20) + d)
    });
  }
  return refs;
}

/** 判断二维点是否在任一观众区内 */
export function inAnyZone(x: number, y: number, zones: AudienceZone[]): AudienceZone | null {
  for (const zone of zones) {
    if (pointInPolygon({ x, y }, zone.polygon)) return zone;
  }
  return null;
}

export { planeFromPolygon, add, scale };
