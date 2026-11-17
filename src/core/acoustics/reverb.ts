import type { Material, Surface, Venue, RT60Result } from '../types';
import { BAND_COUNT, SOUND_SPEED } from './bands';
import { polygonArea3D, surfacePolygon } from '../math/geometry';

/** 单个面在各频带的吸声量 A = S·α（赛宾） */
export function surfaceAbsorption(surface: Surface, venue: Venue, mat: Material): { area: number; a: number[] } {
  const area = polygonArea3D(surfacePolygon(surface, venue));
  return { area, a: mat.absorption.map((alpha) => area * alpha) };
}

export interface RoomAcoustics {
  volume: number;
  surfaceArea: number;
  /** 各带总吸声量 A（m² 赛宾） */
  absorption: number[];
  /** 各带平均吸声系数 ᾱ */
  meanAlpha: number[];
}

export function roomAcoustics(venue: Venue, materials: Map<string, Material>): RoomAcoustics {
  const volume = venue.width * venue.length * venue.height;
  const absorption = new Array(BAND_COUNT).fill(0);
  let surfaceArea = 0;
  for (const s of venue.surfaces) {
    const mat = materials.get(s.materialId);
    if (!mat) continue;
    const { area, a } = surfaceAbsorption(s, venue, mat);
    surfaceArea += area;
    for (let i = 0; i < BAND_COUNT; i++) absorption[i] += a[i];
  }
  const meanAlpha = absorption.map((a) => (surfaceArea > 0 ? a / surfaceArea : 0));
  return { volume, surfaceArea, absorption, meanAlpha };
}

/** 赛宾公式 RT60 = 0.161 V / A */
export function sabineRT60(volume: number, absorption: number[]): number[] {
  return absorption.map((a) => (a > 0.01 ? (0.161 * volume) / a : 9.99));
}

/** 伊林-努特森公式 RT60 = 0.161 V / [-S·ln(1-ᾱ) + 4mV]，此处忽略空气项（与赛宾同口径，另留接口） */
export function eyringRT60(volume: number, surfaceArea: number, meanAlpha: number[]): number[] {
  return meanAlpha.map((alpha) => {
    const a = Math.min(alpha, 0.999);
    const denom = -surfaceArea * Math.log(1 - a);
    return denom > 0.01 ? (0.161 * volume) / denom : 9.99;
  });
}

export function computeRT60(venue: Venue, materials: Map<string, Material>): RT60Result {
  const r = roomAcoustics(venue, materials);
  return {
    sabine: sabineRT60(r.volume, r.absorption),
    eyring: eyringRT60(r.volume, r.surfaceArea, r.meanAlpha),
    volume: r.volume,
    totalAbsorption: r.absorption,
    surfaceArea: r.surfaceArea
  };
}

/** 房间常数 R = S·ᾱ/(1-ᾱ)，各带 */
export function roomConstant(room: RoomAcoustics): number[] {
  return room.meanAlpha.map((a) => {
    const aa = Math.min(a, 0.99);
    return room.surfaceArea * aa / Math.max(1 - aa, 0.01);
  });
}

/** 混响声场建立时间常数（用于 RIR 晚期指数包络），τ = RT60 / (6·ln10) */
export function rt60ToTau(rt60: number): number {
  return rt60 / 13.8155;
}

/** 给定 RT60 与行程，晚期混响起始时间（能量翻倍时间近似，取 0.5×RT60 之前为早期） */
export function mixingTime(rt60Mid: number, volume: number): number {
  // 常用经验混合时间 t_mix ≈ 0.5·sqrt(V) ms 量级，单位换算为秒
  return Math.min(0.08, Math.max(0.025, Math.sqrt(volume) * 0.011 + rt60Mid * 0.05));
}

export { SOUND_SPEED };
