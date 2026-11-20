import { describe, expect, it } from 'vitest';
import { angleBetween, directionFromAngles, pointInPolygon, rayPlane } from './geometry';

describe('geometry', () => {
  it('方位角/俯仰角与方向向量互逆', () => {
    const d = directionFromAngles(30, -15);
    const r = (Math.PI / 180);
    expect(d.x).toBeCloseTo(Math.cos(-15 * r) * Math.cos(30 * r), 6);
    expect(d.z).toBeCloseTo(Math.sin(-15 * r), 6);
    expect(angleBetween(directionFromAngles(0, 0), directionFromAngles(90, 0))).toBeCloseTo(90, 6);
  });

  it('射线与平面求交', () => {
    const t = rayPlane(
      { origin: { x: 0, y: 0, z: 0 }, dir: { x: 1, y: 0, z: 0 } },
      { point: { x: 5, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
    );
    expect(t).toBe(5);
    expect(
      rayPlane(
        { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 1, z: 0 } },
        { point: { x: 5, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } },
      ),
    ).toBeNull();
  });

  it('多边形包含判定', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 8 },
      { x: 0, y: 8 },
    ];
    expect(pointInPolygon({ x: 5, y: 4 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 11, y: 4 }, poly)).toBe(false);
  });
});
