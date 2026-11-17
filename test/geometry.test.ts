import { describe, it, expect } from 'vitest';
import { add, cross, dot, normalize, pointInPolygon, eulerToDir, angleBetweenDeg, polygonArea2D } from '../src/core/math/vec3';
import { boxFacePolygons, mirrorPoint, planeFromPolygon, rayPolygonHit, polygonArea3D, surfacePlane } from '../src/core/math/geometry';
import { defaultVenue } from '../src/core/seed';
import type { Surface } from '../src/core/types';

describe('向量与几何', () => {
  it('叉积与点积', () => {
    expect(dot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(0);
    const c = cross({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(c).toEqual({ x: 0, y: 0, z: 1 });
    expect(add({ x: 1, y: 2, z: 3 }, { x: -1, y: -2, z: -3 })).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('归一化零向量不爆炸', () => {
    const n = normalize({ x: 0, y: 0, z: 0 });
    expect(Math.hypot(n.x, n.y, n.z)).toBe(1);
  });

  it('多边形内外判断', () => {
    const poly = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(pointInPolygon({ x: 5, y: 5 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, poly)).toBe(false);
  });

  it('面积计算 2D/3D 一致', () => {
    expect(polygonArea2D([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }])).toBeCloseTo(12, 6);
    expect(polygonArea3D([{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }])).toBeCloseTo(12, 6);
  });

  it('欧拉角主轴与偏轴角', () => {
    const d = eulerToDir({ yaw: 0, pitch: 0, roll: 0 });
    expect(d.x).toBeCloseTo(0, 10);
    expect(d.y).toBeCloseTo(1, 10);
    expect(d.z).toBeCloseTo(0, 10);
    const down = eulerToDir({ yaw: 0, pitch: 90, roll: 0 });
    expect(down.z).toBeCloseTo(-1, 6);
    expect(angleBetweenDeg({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(90, 6);
  });

  it('盒体六面面积之和', () => {
    const v = defaultVenue(20, 30, 10);
    const faces = boxFacePolygons(v);
    const total = Object.values(faces).reduce((a, p) => a + polygonArea3D(p), 0);
    expect(total).toBeCloseTo(2 * (20 * 30 + 20 * 10 + 30 * 10), 6);
  });

  it('镜像点关于地面对称', () => {
    const v = defaultVenue();
    const floor: Surface = v.surfaces[0];
    const plane = surfacePlane(floor, v);
    const img = mirrorPoint({ x: 5, y: 5, z: 3 }, plane);
    expect(img.z).toBeCloseTo(-3, 6);
    expect(img.x).toBeCloseTo(5, 6);
  });

  it('射线命中墙面多边形', () => {
    const v = defaultVenue();
    const wall = v.surfaces.find((s) => s.boxFace === 'wall-w')!;
    const poly = boxFacePolygons(v)[wall.boxFace!];
    const plane = planeFromPolygon(poly);
    // 从房间中部向 y=0 墙水平发射
    const hit = rayPolygonHit({ origin: { x: 12, y: 10, z: 5 }, dir: normalize({ x: 0, y: -1, z: 0 }) }, poly);
    expect(hit).not.toBeNull();
    expect(hit!.point.y).toBeCloseTo(0, 6);
    expect(hit!.point.z).toBeCloseTo(5, 6);
    void plane;
  });
});
