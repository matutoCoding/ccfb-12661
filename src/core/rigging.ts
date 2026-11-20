import type { LineArray, SpeakerModel, Vec3 } from './types';
import { sub } from './geometry';
import { lineArrayElementsWorld } from './speakers';

export interface RiggingReport {
  cabinetCount: number;
  totalWeightKg: number;
  /** 整串重心（世界坐标） */
  centerOfGravity: Vec3;
  /** 重心相对主吊挂点的水平偏移（米） */
  cgOffsetHorizontal: number;
  /** 单吊点平均载荷 kg（静态，不含冲击系数） */
  loadPerHangPointKg: number;
  /** 考虑 12:1 设计习惯之外的动态冲击系数（1.25）后的载荷 */
  factoredLoadPerPointKg: number;
  riggingRatedLoadKg: number;
  hangPointCount: number;
  /** 利用率（%），>100 报警 */
  utilizationPct: number;
  overloaded: boolean;
  /** 各吊点不均载估算（重心偏移导致，kg） */
  maxPointLoadKg: number;
  minPointLoadKg: number;
  warnings: string[];
}

const DYNAMIC_FACTOR = 1.25;

/**
 * 吊挂校核。多吊点沿水平方向均布，重心偏移按杠杆原理分配不均载。
 */
export function analyzeRigging(array: LineArray, model: SpeakerModel): RiggingReport {
  const elements = lineArrayElementsWorld(array, model);
  const n = elements.length;
  const warnings: string[] = [];
  if (n === 0) {
    return {
      cabinetCount: 0,
      totalWeightKg: 0,
      centerOfGravity: array.hangPoint,
      cgOffsetHorizontal: 0,
      loadPerHangPointKg: 0,
      factoredLoadPerPointKg: 0,
      riggingRatedLoadKg: array.riggingRatedLoadKg,
      hangPointCount: array.hangPointCount,
      utilizationPct: 0,
      overloaded: false,
      maxPointLoadKg: 0,
      minPointLoadKg: 0,
      warnings: ['线阵列中没有箱体'],
    };
  }

  const cabinetWeight = model.weight;
  const totalWeight = cabinetWeight * n;

  // 重心 = 各箱体中心的等权平均（同型号等重）
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const el of elements) {
    sx += el.position.x;
    sy += el.position.y;
    sz += el.position.z;
  }
  const cog: Vec3 = { x: sx / n, y: sy / n, z: sz / n };
  const cgOffset = Math.hypot(cog.x - array.hangPoint.x, cog.y - array.hangPoint.y);

  const pointCount = Math.max(1, array.hangPointCount);
  const evenLoad = totalWeight / pointCount;

  // 不均载：把重心偏移等效为力矩，按吊点跨距（取整串水平投影长度，至少 0.3m）分配
  const first = elements[0].position;
  const last = elements[n - 1].position;
  const span = Math.max(0.3, Math.hypot(first.x - last.x, first.y - last.y));
  // 偏心弯矩 M = W·e，两端吊点反力差 Δ = M / L（两点吊挂模型；多点按等效折算）
  const momentLoad = (totalWeight * cgOffset) / span;
  const maxPointLoad = evenLoad + momentLoad / Math.min(2, pointCount);
  const minPointLoad = Math.max(0, evenLoad - momentLoad / Math.min(2, pointCount));

  const factoredMax = maxPointLoad * DYNAMIC_FACTOR;
  const utilizationPct = (factoredMax / Math.max(1e-6, array.riggingRatedLoadKg)) * 100;
  const overloaded = factoredMax > array.riggingRatedLoadKg;

  if (overloaded) {
    warnings.push(
      `单吊点最大载荷 ${factoredMax.toFixed(1)}kg 超过吊具额定 ${array.riggingRatedLoadKg}kg`,
    );
  }
  if (utilizationPct > 80) {
    warnings.push(`吊具利用率 ${utilizationPct.toFixed(0)}%，建议预留更多安全余量`);
  }
  if (cgOffset > 0.5) {
    warnings.push(`重心水平偏移 ${cgOffset.toFixed(2)}m 较大，注意吊挂框架平衡`);
  }
  if (array.interAngles.some((a) => Math.abs(a) > 10)) {
    warnings.push('存在单只夹角 >10°，超出多数吊挂件允许范围，请核对硬件');
  }

  return {
    cabinetCount: n,
    totalWeightKg: totalWeight,
    centerOfGravity: cog,
    cgOffsetHorizontal: cgOffset,
    loadPerHangPointKg: evenLoad,
    factoredLoadPerPointKg: evenLoad * DYNAMIC_FACTOR,
    riggingRatedLoadKg: array.riggingRatedLoadKg,
    hangPointCount: pointCount,
    utilizationPct,
    overloaded,
    maxPointLoadKg: factoredMax,
    minPointLoadKg: minPointLoad * DYNAMIC_FACTOR,
    warnings,
  };
}

export interface SplaySuggestion {
  /** 建议的起始俯仰角（度，负值向下） */
  startTilt: number;
  /** 建议的逐只夹角（度） */
  interAngles: number[];
  /** 各只箱体主轴命中点（从近到远） */
  aimPoints: Vec3[];
}

/**
 * 按观众区前、后排位置反推张角。
 * near/far 为前、后排目标点（世界坐标，通常取耳高）；
 * 算法：把前后排之间的俯角范围按箱体数均分，箱体主轴依次指向均匀间隔的落点，
 * 相邻主轴夹角即 interAngles（业内 "aim each cabinet at a row" 做法的工程化版本）。
 * 角度约定：俯角为负，越靠下的箱体俯角越负。
 */
export function suggestSplay(
  array: LineArray,
  near: Vec3,
  far: Vec3,
): SplaySuggestion {
  const n = Math.max(1, array.interAngles.length || 1);
  const aimPoints: Vec3[] = [];
  // 每只箱体的俯角（度，负值）。最上一只瞄远端 far，最下一只瞄近端 near
  const tilts: number[] = [];
  for (let i = 0; i < n; i++) {
    // i=0 最上 → far；i=n-1 最下 → near
    const t = n === 1 ? 0.5 : i / (n - 1);
    const target = {
      x: far.x + (near.x - far.x) * t,
      y: far.y + (near.y - far.y) * t,
      z: far.z + (near.z - far.z) * t,
    };
    aimPoints.push(target);
    const dir = sub(target, array.hangPoint);
    const horizontal = Math.hypot(dir.x, dir.y);
    const tilt = -(Math.atan2(-dir.z, horizontal) * 180) / Math.PI;
    tilts.push(tilt);
  }
  // startTilt = 最上一只俯角；interAngles 为相邻俯角差值的绝对值（张开量）
  const startTilt = tilts[0];
  const interAngles: number[] = [];
  for (let i = 1; i < n; i++) {
    interAngles.push(+Math.abs(tilts[i] - tilts[i - 1]).toFixed(2));
  }
  while (interAngles.length < array.interAngles.length) interAngles.push(0);
  return { startTilt: +startTilt.toFixed(2), interAngles, aimPoints };
}

/** 校验整串总张角是否能覆盖前、后排（返回几何覆盖俯角范围，度） */
export function arrayCoverageAngles(array: LineArray, model: SpeakerModel): {
  topTilt: number;
  bottomTilt: number;
  totalVerticalSpread: number;
} {
  const elements = lineArrayElementsWorld(array, model);
  if (elements.length === 0) {
    return { topTilt: 0, bottomTilt: 0, totalVerticalSpread: 0 };
  }
  const topTilt = elements[0].tilt;
  const bottomTilt = elements[elements.length - 1].tilt;
  return {
    topTilt,
    bottomTilt,
    totalVerticalSpread: bottomTilt - topTilt + model.coverageV,
  };
}

/** 目标点相对吊挂点的俯角（度） */
export function depressionAngle(hangPoint: Vec3, target: Vec3): number {
  const d = sub(target, hangPoint);
  const horizontal = Math.hypot(d.x, d.y);
  return (Math.atan2(-d.z, horizontal) * 180) / Math.PI;
}
