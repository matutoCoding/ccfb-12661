import { describe, expect, it } from 'vitest';
import { generateDrySample, defaultAmpModels, defaultSpeakerModels } from './defaults';
import { generateBom } from './bom';
import { defaultDsp, newId, type Layout, type LineArray, type PlacedSpeaker } from './types';

function layout(): Layout {
  const spkModel = defaultSpeakerModels().find((m) => m.id === 'spk_ps15')!;
  const laModel = defaultSpeakerModels().find((m) => m.id === 'spk_la12')!;
  const amp = defaultAmpModels()[0];
  const placed: PlacedSpeaker = {
    id: newId('p'),
    name: '补声',
    speakerModelId: spkModel.id,
    position: { x: 12, y: 2, z: 4 },
    azimuth: 0,
    tilt: -10,
    amp: { ampId: amp.id, channel: 1 },
    dsp: defaultDsp(),
  };
  const array: LineArray = {
    id: newId('la'),
    name: '主扩左',
    hangPoint: { x: 1, y: 9, z: 7 },
    azimuth: 0,
    startTilt: -2,
    interAngles: [1, 1, 1, 1, 1, 1],
    speakerModelId: laModel.id,
    ampBindings: [
      { ampId: amp.id, channel: 1 },
      { ampId: amp.id, channel: 2 },
    ],
    riggingRatedLoadKg: 250,
    hangPointCount: 2,
    dsp: defaultDsp(),
  };
  return {
    id: newId('lay'),
    venueId: 'v1',
    name: '方案A',
    speakers: [placed],
    lineArrays: [array],
    microphones: [],
    signalNodes: [],
    signalEdges: [],
    levelChains: [],
    measurePoints: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('设备清单', () => {
  it('按型号统计音箱/功放/线缆/吊挂件并估算功耗与重量', () => {
    const lay = layout();
    const report = generateBom(
      lay,
      new Map(defaultSpeakerModels().map((m) => [m.id, m])),
      new Map(defaultAmpModels().map((m) => [m.id, m])),
      20,
    );
    const cats = new Map(report.lines.map((l) => [l.category, l]));
    // 1 只点声源 + 6 只线阵列单元 = 7 只（合并后跨两个型号条目）
    const speakerQty = report.lines
      .filter((l) => l.category === '音箱')
      .reduce((s, l) => s + l.quantity, 0);
    expect(speakerQty).toBe(7);
    expect(cats.get('吊挂件')).toBeTruthy();
    expect(cats.get('线缆')).toBeTruthy();
    expect(report.totalPowerW).toBeGreaterThan(0);
    expect(report.recommendedPowerW).toBeGreaterThan(report.totalPowerW);
    expect(report.totalRiggingWeightKg).toBeGreaterThan(0);
    expect(report.speakerCount).toBe(7);
  });
});

describe('干声样本生成', () => {
  it('三类样本均为有限时长且无削波', () => {
    for (const kind of ['voice', 'percussion', 'noise'] as const) {
      const s = generateDrySample(kind, 2, 48000);
      expect(s.channelData).toHaveLength(2 * 48000);
      let peak = 0;
      for (const v of s.channelData) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak).toBeLessThanOrEqual(0.9);
      expect(peak).toBeGreaterThan(0.01);
    }
  });
});
