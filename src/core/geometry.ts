import type { Point2, Vec3 } from './types';

// ---------- 三维向量 ----------
export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: Vec3, b: Vec3): number => length(sub(a, b));
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l < 1e-12 ? v3(0, 0, 1) : scale(a, 1 / l);
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  z: lerp(a.z, b.z, t),
});
export const midpoint = (a: Vec3, b: Vec3): Vec3 => scale(add(a, b), 0.5);

/** 角度转弧度 */
export const rad = (deg: number): number => (deg * Math.PI) / 180;
export const deg = (radVal: number): number => (radVal * 180) / Math.PI;
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * 方位角/俯仰角 → 单位方向向量。
 * 方位角 0° 指向 +x（舞台朝观众方向），绕 z 旋转；
 * 俯仰角 0° 水平，负值向下。
 */
export function directionFromAngles(azimuthDeg: number, tiltDeg: number): Vec3 {
  const az = rad(azimuthDeg);
  const ti = rad(tiltDeg);
  const cz = Math.cos(ti);
  return {
    x: cz * Math.cos(az),
    y: cz * Math.sin(az),
    z: Math.sin(ti),
  };
}

/** 单位向量 → 方位角/俯仰角（度） */
export function anglesFromDirection(d: Vec3): { azimuth: number; tilt: number } {
  const n = normalize(d);
  const tilt = deg(Math.asin(clamp(n.z, -1, 1)));
  const azimuth = deg(Math.atan2(n.y, n.x));
  return { azimuth, tilt };
}

/** 两方向夹角（度） */
export function angleBetween(a: Vec3, b: Vec3): number {
  const c = clamp(dot(normalize(a), normalize(b)), -1, 1);
  return deg(Math.acos(c));
}

/** 绕 z 轴旋转向量 */
export function rotateZ(p: Vec3, angleDeg: number): Vec3 {
  const a = rad(angleDeg);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
}

// ---------- 二维多边形（观众区） ----------
export function polygonArea(poly: Point2[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

export function polygonCentroid(poly: Point2[]): Point2 {
  let cx = 0;
  let cy = 0;
  for (const p of poly) {
    cx += p.x;
    cy += p.y;
  }
  const n = Math.max(1, poly.length);
  return { x: cx / n, y: cy / n };
}

/** 射线法判断点是否在多边形内（边界算在内） */
export function pointInPolygon(p: Point2, poly: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 在多边形包围盒内生成规则网格点，再裁掉多边形外的点 */
export function gridInPolygon(poly: Point2[], spacing: number): Point2[] {
  if (poly.length < 3) return [];
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const out: Point2[] = [];
  for (let x = minX + spacing / 2; x <= maxX; x += spacing) {
    for (let y = minY + spacing / 2; y <= maxY; y += spacing) {
      const p = { x, y };
      if (pointInPolygon(p, poly)) out.push(p);
    }
  }
  return out;
}

/** 多边形等距缩放量（米），用于把网格点向内部收，避免贴墙 */
export function offsetPolygon(poly: Point2[], d: number): Point2[] {
  // 简单实现：向质心方向收缩（对凸多边形足够，观众区一般为凸形）
  const c = polygonCentroid(poly);
  return poly.map((p) => {
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / l) * d, y: p.y + (dy / l) * d };
  });
}

// ---------- 平面/射线几何（反射声线用） ----------
export interface Plane {
  /** 面上一点 */
  point: Vec3;
  /** 单位法向 */
  normal: Vec3;
}

export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

/** 射线与平面求交，返回 t（沿射线距离），不相交返回 null */
export function rayPlane(r: Ray, plane: Plane): number | null {
  const denom = dot(r.dir, plane.normal);
  if (Math.abs(denom) < 1e-9) return null;
  const t = dot(sub(plane.point, r.origin), plane.normal) / denom;
  return t >= 0 ? t : null;
}

/** 点相对平面的镜像（虚声源法） */
export function mirrorPoint(p: Vec3, plane: Plane): Vec3 {
  const d = dot(sub(plane.point, p), plane.normal);
  return add(p, scale(plane.normal, 2 * d));
}

/** 反射方向：入射向量 d 相对平面法向 n 的镜面反射 */
export function reflect(d: Vec3, n: Vec3): Vec3 {
  const k = 2 * dot(d, n);
  return normalize({ x: d.x - k * n.x, y: d.y - k * n.y, z: d.z - k * n.z });
}

/** 线段与矩形面（轴对齐）求交，返回交点或 null。rect 给出 min/max 两个角 */
export function rayAabbFace(
  r: Ray,
  facePlane: Plane,
  min: Vec3,
  max: Vec3,
): { point: Vec3; t: number } | null {
  const t = rayPlane(r, facePlane);
  if (t === null) return null;
  const p = add(r.origin, scale(r.dir, t));
  const eps = 1e-6;
  if (
    p.x < Math.min(min.x, max.x) - eps ||
    p.x > Math.max(min.x, max.x) + eps ||
    p.y < Math.min(min.y, max.y) - eps ||
    p.y > Math.max(min.y, max.y) + eps ||
    p.z < Math.min(min.z, max.z) - eps ||
    p.z > Math.max(min.z, max.z) + eps
  ) {
    return null;
  }
  return { point: p, t };
}
