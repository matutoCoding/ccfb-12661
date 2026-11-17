import type { LineArray, SpeakerModel, AudienceZone, Vec2, Vec3, RiggingResult, RiggingPickLoad } from './types';
import { add, deg2rad, polygonCentroid, rad2deg, scale, v3 } from './math/vec3';
import { pointInPolygon } from './math/vec3';

export interface ArrayGeometry {
  positions: import('./types').Vec3[];
  pitches: number[];
  /** 每只箱体相对框架的纵向/竖向偏移（局部坐标，沿=向下瞄准方向，down=重力方向投影） */
  localOffsets: { along: number; down: number }[];
}

/**
 * 计算线阵列各箱体的世界坐标与姿态。
 * 局部坐标：框架点为原点，yaw=0 时阵列朝 -Y 方向投射，箱体沿向下弧线排布。
 */
export function arrayGeometry(array: LineArray, model: SpeakerModel): ArrayGeometry {
  const n = array.count;
  const h = model.dimensions.h;
  const yaw = deg2rad(array.yaw);
  // 局部“前向”单位向量（水平，由 yaw 旋转 -Y）
  const fwd = { x: -Math.sin(yaw), y: -Math.cos(yaw), z: 0 };
  const positions: Vec3[] = [];
  const pitches: number[] = [];
  const localOffsets: { along: number; down: number }[] = [];

  let cumAngle = 0; // 相对水平的累计俯角
  let localAlong = 0;
  let localDown = 0;
  for (let i = 0; i < n; i++) {
    // 第 i 只箱体中心：在当前累计角方向上沿箱高移动
    const pitch = -cumAngle; // 俯仰角（向下为负）
    const ang = deg2rad(cumAngle);
    const stepAlong = Math.sin(ang) * h;
    const stepDown = Math.cos(ang) * h;
    if (i > 0) {
      localAlong += stepAlong;
      localDown += stepDown;
    }
    const center = add(array.framePosition, add(scale(fwd, localAlong), v3(0, 0, -localDown)));
    positions.push(center);
    pitches.push(pitch);
    localOffsets.push({ along: localAlong, down: localDown });
    if (i < array.interAngles.length) cumAngle += array.interAngles[i];
  }
  return { positions, pitches, localOffsets };
}

/** 整串总重（含框架/吊挂件 8% 附加系数） */
export function totalArrayWeight(array: LineArray, model: SpeakerModel): number {
  return array.count * model.weight * 1.08;
}

/**
 * 吊点载荷：框架梁按刚体简支梁近似，重心位置决定各吊点反力。
 * 单吊点时载荷=总重；多吊点时按重心到各吊点距离静力分配。
 */
export function pickLoads(array: LineArray, model: SpeakerModel): RiggingResult {
  const geo = arrayGeometry(array, model);
  const total = totalArrayWeight(array, model);
  // 重心 = 各箱体等重平均（箱体同型号）
  let comAlong = 0, comDown = 0;
  for (const o of geo.localOffsets) { comAlong += o.along; comDown += o.down; }
  comAlong /= array.count;
  comDown /= array.count;

  const picks: RiggingPickLoad[] = [];
  const warnings: string[] = [];
  const k = Math.max(array.pickPointCount, 1);
  // 吊点沿框架梁均匀分布，跨度取阵列纵向包络
  const span = Math.max(comAlong * 2, 0.5);
  for (let i = 0; i < k; i++) {
    const pickPos = k === 1 ? span / 2 : (span * i) / (k - 1);
    // 线性杠杆分配：距重心越远载荷越小，保证合力=总重、力矩平衡
    let share: number;
    if (k === 1) {
      share = total;
    } else {
      const d = Math.abs(pickPos - comAlong);
      const w = 1 / Math.max(d, 0.05);
      const weights = Array.from({ length: k }, (_, j) => {
        const p = (span * j) / (k - 1);
        return 1 / Math.max(Math.abs(p - comAlong), 0.05);
      });
      const wSum = weights.reduce((a, b) => a + b, 0);
      share = (total * w) / wSum;
    }
    const ok = share <= array.ratedPickLoad;
    if (!ok) warnings.push(`吊点 ${i + 1} 载荷 ${share.toFixed(1)}kg 超过额定 ${array.ratedPickLoad}kg`);
    picks.push({ name: `吊点 ${i + 1}`, loadKg: round1(share), ratedKg: array.ratedPickLoad, ok });
  }
  // 力矩平衡校核提示
  if (k === 1 && comAlong > 0.3) {
    warnings.push(`重心相对单吊点纵向偏移 ${comAlong.toFixed(2)}m，建议增加配重或改用双吊点`);
  }
  return {
    arrayId: array.id,
    totalWeight: round1(total),
    comOffset: { along: round2(comAlong), down: round2(comDown) },
    picks,
    warnings,
    elementPositions: geo.positions,
    elementPitches: geo.pitches
  };
}

/**
 * 按观众区前后排位置反推张角：
 * 首只覆盖最远排、末只覆盖最近排，张角在箱体间按距离对数分配。
 */
export function autoSplay(array: LineArray, model: SpeakerModel, zones: AudienceZone[]): number[] {
  if (array.count < 2) return [];
  const frame = array.framePosition;
  // 观众区在阵列投射水平方向上的最近/最远投影
  let near = Infinity, far = 0;
  const yaw = deg2rad(array.yaw);
  const fwd = { x: -Math.sin(yaw), y: -Math.cos(yaw) };
  for (const zone of zones) {
    for (const p of zone.polygon) {
      const dx = p.x - frame.x;
      const dy = p.y - frame.y;
      const proj = dx * fwd.x + dy * fwd.y; // 沿投射方向距离
      if (proj > 0.5) {
        near = Math.min(near, proj);
        far = Math.max(far, proj);
      }
    }
  }
  if (!Number.isFinite(near)) {
    return new Array(array.count - 1).fill(2);
  }
  near = Math.max(near, 2);
  const height = frame.z; // 吊挂高度近似人耳平面高差
  const angleFar = rad2deg(Math.atan2(height, far));
  const angleNear = rad2deg(Math.atan2(height, near));
  const totalSpread = Math.min(Math.max(angleNear - angleFar, 4), model.coverageV * array.count * 0.8);
  // 按箱体垂直覆盖角给单只上限，剩余按对数距离加权
  const maxEach = model.coverageV * 0.9;
  const n = array.count - 1;
  const weights = Array.from({ length: n }, (_, i) => Math.log((far / near) * (i + 1)) + 1);
  const wSum = weights.reduce((a, b) => a + b, 0);
  let angles = weights.map((w) => (totalSpread * w) / wSum);
  angles = angles.map((a) => Math.min(a, maxEach));
  // 归一化回总张角
  const s = angles.reduce((a, b) => a + b, 0);
  angles = angles.map((a) => (a * totalSpread) / s);
  return angles.map((a) => round1(a));
}

/** 观众区采样点（用于热力图/回声图），按多边形边界规则网格 */
export function sampleAudiencePoints(zones: AudienceZone[], spacing = 1.5): { position: import('./types').Vec3; zone: AudienceZone }[] {
  const out: { position: import('./types').Vec3; zone: AudienceZone }[] = [];
  for (const zone of zones) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of zone.polygon) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    for (let x = minX; x <= maxX; x += spacing) {
      for (let y = minY; y <= maxY; y += spacing) {
        const p2: Vec2 = { x, y };
        if (pointInPolygon(p2, zone.polygon)) {
          out.push({ position: { x, y, z: zone.earHeight }, zone });
        }
      }
    }
    // 保证多边形至少有质心点
    if (zone.polygon.length >= 3 && !out.some((o) => o.zone === zone)) {
      const c = polygonCentroid(zone.polygon);
      out.push({ position: { x: c.x, y: c.y, z: zone.earHeight }, zone });
    }
  }
  return out;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;
