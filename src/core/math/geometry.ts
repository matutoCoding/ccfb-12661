import type { Vec3, Surface, BoxFaceName, Venue } from '../types';
import { add, cross, dot, normalize, scale, sub, v3 } from './vec3';

export interface Plane {
  point: Vec3;
  normal: Vec3;
}

export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

/** 由共面多边形构造平面（取前三个点） */
export function planeFromPolygon(poly: Vec3[]): Plane {
  const n = normalize(cross(sub(poly[1], poly[0]), sub(poly[2], poly[0])));
  return { point: poly[0], normal: n };
}

/** 射线与平面求交，返回 t（射线 origin+t*dir），不相交返回 null */
export function rayPlane(ray: Ray, plane: Plane): number | null {
  const denom = dot(ray.dir, plane.normal);
  if (Math.abs(denom) < 1e-9) return null;
  const t = dot(sub(plane.point, ray.origin), plane.normal) / denom;
  return t >= -1e-9 ? t : null;
}

/** 三维点在三角形内（共面前提），重心坐标法 */
function pointInTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const v0 = sub(c, a), v1 = sub(b, a), v2 = sub(p, a);
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1);
  const d20 = dot(v2, v0), d21 = dot(v2, v1);
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-12) return false;
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;
  return u >= -1e-6 && v >= -1e-6 && w >= -1e-6;
}

/** 点在多边形内（扇形三角化，共面） */
export function pointInPolygon3D(p: Vec3, poly: Vec3[]): boolean {
  if (poly.length < 3) return false;
  for (let i = 1; i < poly.length - 1; i++) {
    if (pointInTriangle(p, poly[0], poly[i], poly[i + 1])) return true;
  }
  return false;
}

/** 射线与多边形面求交，返回交点与 t */
export function rayPolygonHit(ray: Ray, poly: Vec3[]): { t: number; point: Vec3 } | null {
  const plane = planeFromPolygon(poly);
  const t = rayPlane(ray, plane);
  if (t === null) return null;
  const point = add(ray.origin, scale(ray.dir, t));
  if (!pointInPolygon3D(point, poly)) return null;
  return { t, point };
}

/** 点相对平面的镜像（镜像声源核心） */
export function mirrorPoint(p: Vec3, plane: Plane): Vec3 {
  const d = dot(sub(plane.point, p), plane.normal);
  return add(p, scale(plane.normal, 2 * d));
}

/** 反射方向 */
export function reflect(dir: Vec3, normal: Vec3): Vec3 {
  return sub(dir, scale(normal, 2 * dot(dir, normal)));
}

// ---------- 房间盒体六个面 ----------

export function boxFacePolygons(v: Venue): Record<BoxFaceName, Vec3[]> {
  const W = v.width, L = v.length, H = v.height;
  return {
    floor: [v3(0, 0, 0), v3(W, 0, 0), v3(W, L, 0), v3(0, L, 0)],
    ceiling: [v3(0, 0, H), v3(0, L, H), v3(W, L, H), v3(W, 0, H)],
    'wall-s': [v3(0, 0, 0), v3(0, L, 0), v3(0, L, H), v3(0, 0, H)], // x=0
    'wall-n': [v3(W, 0, 0), v3(W, 0, H), v3(W, L, H), v3(W, L, 0)], // x=W
    'wall-w': [v3(0, 0, 0), v3(W, 0, 0), v3(W, 0, H), v3(0, 0, H)], // y=0
    'wall-e': [v3(0, L, 0), v3(0, L, H), v3(W, L, H), v3(W, L, 0)]  // y=L
  };
}

/** 取面的世界坐标多边形 */
export function surfacePolygon(s: Surface, v: Venue): Vec3[] {
  if (s.type === 'polygon' && s.polygon) return s.polygon;
  const faces = boxFacePolygons(v);
  return faces[s.boxFace!];
}

export function surfacePlane(s: Surface, v: Venue): Plane {
  return planeFromPolygon(surfacePolygon(s, v));
}

/** 面面积 m²（任意共面多边形，向量叉积分拆） */
export function polygonArea3D(poly: Vec3[]): number {
  if (poly.length < 3) return 0;
  const acc = v3();
  for (let i = 1; i < poly.length - 1; i++) {
    const tri = cross(sub(poly[i], poly[0]), sub(poly[i + 1], poly[0]));
    acc.x += tri.x; acc.y += tri.y; acc.z += tri.z;
  }
  return Math.hypot(acc.x, acc.y, acc.z) / 2;
}

/** 线段是否被房间内其它面阻挡（用于镜像路径有效性校验） */
export function segmentBlocked(a: Vec3, b: Vec3, surfaces: Surface[], venue: Venue, ignore: Set<string>): boolean {
  const dir = normalize(sub(b, a));
  const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const ray: Ray = { origin: a, dir };
  for (const s of surfaces) {
    if (ignore.has(s.id)) continue;
    const hit = rayPolygonHit(ray, surfacePolygon(s, venue));
    if (hit && hit.t > 1e-4 && hit.t < length - 1e-4) return true;
  }
  return false;
}
