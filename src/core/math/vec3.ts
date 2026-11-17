import type { Vec2, Vec3, Euler } from '../types';

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
});
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));
export const normalize = (a: Vec3): Vec3 => {
  const l = len(a);
  return l < 1e-12 ? { x: 0, y: 0, z: 1 } : scale(a, 1 / l);
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const v3lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t)
});
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export const deg2rad = (d: number): number => (d * Math.PI) / 180;
export const rad2deg = (r: number): number => (r * 180) / Math.PI;

/** 欧拉角（ZYX 顺序）→ 方向向量（局部 +Y 为音箱主轴） */
export function eulerToDir(e: Euler): Vec3 {
  const y = deg2rad(e.yaw), p = deg2rad(e.pitch), r = deg2rad(e.roll);
  // 局部主轴 +Y
  const cy = Math.cos(y), sy = Math.sin(y);
  const cp = Math.cos(p), sp = Math.sin(p);
  const cr = Math.cos(r), sr = Math.sin(r);
  // Rz * Ry * Rx 作用于 (0,1,0)
  const x = sy * cp;
  const yv = cy * cp;
  const zv = -sp;
  // roll 不改变主轴方向（仅绕轴），保留 roll 用于箱体姿态
  void cr; void sr;
  return { x, y: yv, z: zv };
}

/** 两个方向夹角（度） */
export function angleBetweenDeg(a: Vec3, b: Vec3): number {
  const d = clamp(dot(normalize(a), normalize(b)), -1, 1);
  return rad2deg(Math.acos(d));
}

/** 点到线段最近点 */
export function closestPointOnSegment(p: Vec3, a: Vec3, b: Vec3): { point: Vec3; t: number } {
  const ab = sub(b, a);
  const t = clamp(dot(sub(p, a), ab) / Math.max(dot(ab, ab), 1e-12), 0, 1);
  return { point: add(a, scale(ab, t)), t };
}

/** 二维点是否在多边形内（射线法） */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let x = 0, y = 0;
  for (const p of poly) { x += p.x; y += p.y; }
  return { x: x / poly.length, y: poly.length ? y / poly.length : 0 };
}

export function polygonArea2D(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return Math.abs(a) / 2;
}

export function uid(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

/** 简单深拷贝（结构化数据，含 Float32Array 场景由调用方处理） */
export function deepClone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}
