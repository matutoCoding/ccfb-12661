import { describe, expect, it } from 'vitest';
import { BAND_FREQS, type BandValues } from './types';
import { generateDrySample } from './defaults';
import {
  convolveOffline,
  estimateRt60FromIr,
  seatFrequencyResponse,
  synthesizeImpulseResponse,
  type IrSpec,
} from './auralization';
import { sabineRT60 } from './roomAcoustics';
import { defaultMaterials } from './defaults';
import { defaultSurfaces } from './roomAcoustics';
import type { Room } from './types';

function flatRt(seconds: number): BandValues {
  const v = {} as BandValues;
  for (const f of BAND_FREQS) v[f] = seconds;
  return v;
}

describe('端到端试听链路', () => {
  it('干声卷积座位 IR 后长度与能量合理，且无削波', () => {
    const dry = generateDrySample('voice', 1, 48000);
    const spec: IrSpec = {
      sampleRate: 48000,
      rt60: flatRt(1.1),
      directDelayMs: 12,
      reflections: [{ delayMs: 30, relLevelDb: -8 }],
      directToReverbDb: 6,
    };
    const ir = synthesizeImpulseResponse(spec, 5);
    const wet = convolveOffline(dry.channelData, ir);
    expect(wet.length).toBe(dry.channelData.length + ir.length - 1);
    let peak = 0;
    let tailEnergy = 0;
    for (let i = 0; i < wet.length; i++) {
      expect(Number.isFinite(wet[i])).toBe(true);
      peak = Math.max(peak, Math.abs(wet[i]));
      if (i > dry.channelData.length) tailEnergy += wet[i] * wet[i];
    }
    expect(peak).toBeLessThanOrEqual(0.95);
    // 干声结束后仍有混响尾能量（试听的“混响感”来源）
    expect(tailEnergy).toBeGreaterThan(0);
  });

  it('赛宾 RT60 → IR → 反推 RT60 全链路一致（中频 ±30%）', () => {
    const mats = new Map(defaultMaterials().map((m) => [m.id, m]));
    const hard = [...mats.values()].find((m) => m.name.includes('混凝土'))!;
    const ceil = [...mats.values()].find((m) => m.name.includes('石膏板'))!;
    // 常规剧场混响（1s 量级），避免极短 RT60 撞上尾音截断边界
    const room: Room = {
      length: 18,
      width: 12,
      height: 7,
      surfaces: defaultSurfaces(hard.id, hard.id, ceil.id),
    };
    const sabine = sabineRT60(room, mats);
    expect(sabine[1000]).toBeGreaterThan(0.6);
    const ir = synthesizeImpulseResponse({
      sampleRate: 48000,
      rt60: sabine,
      directDelayMs: 10,
      reflections: [],
      directToReverbDb: 6,
    });
    const estimated = estimateRt60FromIr(ir, 48000);
    for (const f of [500, 1000] as const) {
      expect(estimated[f]).toBeGreaterThan(sabine[f] * 0.7);
      expect(estimated[f]).toBeLessThan(sabine[f] * 1.3);
    }
  });

  it('座位频响曲线覆盖 50Hz~12kHz 且为有限值', () => {
    const ir = synthesizeImpulseResponse({
      sampleRate: 48000,
      rt60: flatRt(0.9),
      directDelayMs: 8,
      reflections: [],
      directToReverbDb: 6,
    });
    const curve = seatFrequencyResponse(ir, 48000);
    expect(curve.freqs[0]).toBeLessThanOrEqual(63);
    expect(curve.freqs[curve.freqs.length - 1]).toBeGreaterThanOrEqual(10000);
    expect(curve.db.every((v) => Number.isFinite(v))).toBe(true);
  });
});
