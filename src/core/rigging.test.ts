import { describe, expect, it } from 'vitest';
import { defaultSpeakerModels } from './defaults';
import type { LineArray } from './types';
import { analyzeRigging, suggestSplay } from './rigging';
import { lineArrayElementsWorld } from './speakers';

const model = defaultSpeakerModels().find((m) => m.id === 'spk_la12')!;

function baseArray(over: Partial<LineArray> = {}): LineArray {
  return {
    id: 'la1',
    name: '主扩',
    hangPoint: { x: 1, y: 7.5, z: 7 },
    azimuth: 0,
    startTilt: -2,
    interAngles: [1, 1, 1, 1, 1, 1, 1, 1],
    speakerModelId: model.id,
    ampBindings: [],
    riggingRatedLoadKg: 200,
    hangPointCount: 2,
    ...over,
  };
}

describe('线阵列吊挂校核', () => {
  it('总重 = 单只重量 × 数量', () => {
    const a = baseArray();
    const r = analyzeRigging(a, model);
    expect(r.cabinetCount).toBe(8);
    expect(r.totalWeightKg).toBeCloseTo(model.weight * 8, 1);
    expect(r.overloaded).toBe(false);
  });

  it('超过吊具额定值时报警', () => {
    const a = baseArray({ riggingRatedLoadKg: 30, hangPointCount: 1 });
    const r = analyzeRigging(a, model);
    expect(r.overloaded).toBe(true);
    expect(r.warnings.join('')).toContain('超过吊具额定');
  });

  it('逐只箱体位置沿吊挂点向下排列', () => {
    const a = baseArray();
    const els = lineArrayElementsWorld(a, model);
    expect(els).toHaveLength(8);
    for (let i = 1; i < els.length; i++) {
      expect(els[i].position.z).toBeLessThan(els[i - 1].position.z);
      expect(els[i].tilt).toBeLessThan(els[i - 1].tilt);
    }
  });

  it('按前后排反推的张角覆盖目标俯角范围', () => {
    const a = baseArray();
    const near = { x: 6, y: 7.5, z: 1.2 };
    const far = { x: 18, y: 7.5, z: 1.2 };
    const s = suggestSplay(a, near, far);
    expect(s.interAngles).toHaveLength(a.interAngles.length);
    expect(s.aimPoints).toHaveLength(8);
    // 最上一只俯角应更浅（瞄远端），最下一只更深（瞄近端）
    expect(s.startTilt).toBeLessThan(0);
    const total = s.interAngles.reduce((x, y) => x + y, 0);
    expect(total).toBeGreaterThan(0);
  });
});
