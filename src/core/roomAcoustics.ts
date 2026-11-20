import {
  BAND_FREQS,
  newId,
  type BandFreq,
  type BandValues,
  type ID,
  type Material,
  type Room,
  type RoomSurface,
  type Vec3,
} from './types';
import type { Plane } from './geometry';

/** 房间六面墙的逻辑标识 */
export type FaceId = 'floor' | 'ceiling' | 'west' | 'east' | 'north' | 'south';

export interface RoomFace {
  id: FaceId;
  type: RoomSurface['type'];
  plane: Plane;
  /** 轴对齐矩形两个角 */
  min: Vec3;
  max: Vec3;
  area: number;
  materialId: ID;
}

/** 生成六面墙的默认表面记录（材料在 defaultMaterials 中给默认 id） */
export function defaultSurfaces(floorMatId: ID, wallMatId: ID, ceilMatId: ID): RoomSurface[] {
  return [
    { id: newId('surf'), type: 'floor', materialId: floorMatId },
    { id: newId('surf'), type: 'ceiling', materialId: ceilMatId },
    { id: newId('surf'), type: 'wall', materialId: wallMatId },
    { id: newId('surf'), type: 'wall', materialId: wallMatId },
    { id: newId('surf'), type: 'wall', materialId: wallMatId },
    { id: newId('surf'), type: 'wall', materialId: wallMatId },
  ];
}

/**
 * 展开房间六面几何。约定：舞台在 x=0，观众区朝 +x；
 * 西/东为 y=0/width 两面侧墙，北墙 x=0（舞台后墙），南墙 x=length（观众厅后墙）。
 * surfaces 顺序：[floor, ceiling, west, east, north, south]
 */
export function roomFaces(room: Room): RoomFace[] {
  const { length: L, width: W, height: H } = room;
  const matOf = (i: number): ID => room.surfaces[i]?.materialId ?? '';
  const faces: Array<Omit<RoomFace, 'materialId'>> = [
    {
      id: 'floor',
      type: 'floor',
      plane: { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } },
      min: { x: 0, y: 0, z: 0 },
      max: { x: L, y: W, z: 0 },
      area: L * W,
    },
    {
      id: 'ceiling',
      type: 'ceiling',
      plane: { point: { x: 0, y: 0, z: H }, normal: { x: 0, y: 0, z: -1 } },
      min: { x: 0, y: 0, z: H },
      max: { x: L, y: W, z: H },
      area: L * W,
    },
    {
      id: 'west',
      type: 'wall',
      plane: { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } },
      min: { x: 0, y: 0, z: 0 },
      max: { x: L, y: 0, z: H },
      area: L * H,
    },
    {
      id: 'east',
      type: 'wall',
      plane: { point: { x: 0, y: W, z: 0 }, normal: { x: 0, y: -1, z: 0 } },
      min: { x: 0, y: W, z: 0 },
      max: { x: L, y: W, z: H },
      area: L * H,
    },
    {
      id: 'north',
      type: 'wall',
      plane: { point: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: W, z: H },
      area: W * H,
    },
    {
      id: 'south',
      type: 'wall',
      plane: { point: { x: L, y: 0, z: 0 }, normal: { x: -1, y: 0, z: 0 } },
      min: { x: L, y: 0, z: 0 },
      max: { x: L, y: W, z: H },
      area: W * H,
    },
  ];
  return faces.map((f, i) => ({ ...f, materialId: matOf(i) }));
}

/** 房间容积 m³ */
export const roomVolume = (room: Room): number => room.length * room.width * room.height;

/** 各频段总吸声量 A = Σ S·α（含空气吸收忽略，小型厅堂可接受） */
export function totalAbsorption(room: Room, materials: Map<ID, Material>): BandValues {
  const result = {} as BandValues;
  for (const f of BAND_FREQS) {
    let a = 0;
    for (const face of roomFaces(room)) {
      const mat = materials.get(face.materialId);
      const alpha = mat ? mat.absorption[f] : 0.1;
      a += face.area * alpha;
    }
    result[f] = Math.max(a, 1e-6);
  }
  return result;
}

/** 赛宾公式 RT60 = 0.161 V / A，逐频段 */
export function sabineRT60(room: Room, materials: Map<ID, Material>): BandValues {
  const v = roomVolume(room);
  const abs = totalAbsorption(room, materials);
  const result = {} as BandValues;
  for (const f of BAND_FREQS) {
    result[f] = (0.161 * v) / abs[f];
  }
  return result;
}

/** 平均吸声系数（面积加权，用于反射能量计算），逐频段 */
export function meanAbsorption(room: Room, materials: Map<ID, Material>): BandValues {
  const result = {} as BandValues;
  const faces = roomFaces(room);
  const totalArea = faces.reduce((s, f) => s + f.area, 0);
  for (const f of BAND_FREQS) {
    let a = 0;
    for (const face of faces) {
      const mat = materials.get(face.materialId);
      a += face.area * (mat ? mat.absorption[f] : 0.1);
    }
    result[f] = a / totalArea;
  }
  return result;
}

/** 墙面在某频段的反射系数（能量比） */
export function reflectionCoefficient(material: Material | undefined, freq: BandFreq): number {
  if (!material) return 0.9;
  return Math.max(0, 1 - material.absorption[freq]);
}

/** 中频（500/1k 平均）RT60，供卷积混响核对用 */
export function midBandRT60(rt: BandValues): number {
  return (rt[500] + rt[1000]) / 2;
}
