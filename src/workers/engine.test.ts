import { describe, expect, it } from 'vitest';
import { buildContext, computeFeedback, computeGrid, computeReflections, computeRt60 } from './engine';
import { defaultAmpModels, defaultMaterials, defaultSpeakerModels } from '../core/defaults';
import { defaultSurfaces } from '../core/roomAcoustics';
import { createLayout, createVenue } from '../core/factory';
import { defaultDsp, newId, type LineArray, type Microphone, type PlacedSpeaker } from '../core/types';
import type { SceneSnapshot } from './protocol';

function snapshot(): SceneSnapshot {
  const mats = defaultMaterials();
  const hard = mats.find((m) => m.name.includes('混凝土'))!;
  const ceil = mats.find((m) => m.name.includes('石膏板'))!;
  const floor = mats.find((m) => m.name.includes('观众席（满座）'))!;
  const venue = createVenue('测试剧场');
  venue.room.surfaces = defaultSurfaces(floor.id, hard.id, ceil.id);
  const layout = createLayout(venue.id, '测试方案');
  const spkModel = defaultSpeakerModels().find((m) => m.id === 'spk_ps15')!;
  const amp = defaultAmpModels()[0];
  const speaker: PlacedSpeaker = {
    id: newId('p'),
    name: '主扩',
    speakerModelId: spkModel.id,
    position: { x: 2, y: 7.5, z: 5 },
    azimuth: 0,
    tilt: -10,
    amp: { ampId: amp.id, channel: 1 },
    dsp: defaultDsp(),
  };
  const laModel = defaultSpeakerModels().find((m) => m.isLineArrayElement)!;
  const array: LineArray = {
    id: newId('la'),
    name: '线阵列',
    hangPoint: { x: 1, y: 7.5, z: 7 },
    azimuth: 0,
    startTilt: -3,
    interAngles: [1, 1, 1, 1],
    speakerModelId: laModel.id,
    ampBindings: [{ ampId: amp.id, channel: 1 }],
    riggingRatedLoadKg: 200,
    hangPointCount: 2,
    dsp: defaultDsp(),
  };
  const mic: Microphone = {
    id: newId('mic'),
    name: '主持话筒',
    position: { x: 1, y: 7.5, z: 1.5 },
    azimuth: 0,
    tilt: 0,
  };
  layout.speakers.push(speaker);
  layout.lineArrays.push(array);
  layout.microphones.push(mic);
  return { venue, layout, room: venue.room, materials: mats, speakerModels: defaultSpeakerModels() };
}

describe('Worker 计算引擎', () => {
  it('上下文构建与 RT60', () => {
    const scene = snapshot();
    const ctx = buildContext(scene);
    expect(ctx.faces).toHaveLength(6);
    expect(ctx.materials.size).toBeGreaterThan(5);
    const rt = computeRt60(scene);
    expect(rt[1000]).toBeGreaterThan(0);
  });

  it('网格 SPL 计算返回完整数组与统计量', () => {
    const scene = snapshot();
    const seats = [
      { x: 8, y: 7.5, z: 1.2 },
      { x: 12, y: 6, z: 1.2 },
      { x: 16, y: 9, z: 1.2 },
    ];
    const grid = computeGrid(scene, seats, () => false)!;
    expect(grid.values).toHaveLength(3);
    expect(grid.max).toBeGreaterThanOrEqual(grid.min);
    expect(Number.isFinite(grid.average)).toBe(true);
  });

  it('反射计算带进度回调，取消标志生效', () => {
    const scene = snapshot();
    const seats = Array.from({ length: 5 }, (_, i) => ({ x: 6 + i * 2, y: 7.5, z: 1.2 }));
    let progressCalls = 0;
    const out = computeReflections(scene, seats, 1, () => false, () => progressCalls++);
    expect(out).toHaveLength(5);
    expect(progressCalls).toBe(5);
    const cancelled = computeReflections(scene, seats, 1, () => true);
    expect(cancelled).toEqual([]);
  });

  it('啸叫计算逐话筒返回 8 频段结果', () => {
    const scene = snapshot();
    const results = computeFeedback(scene, scene.layout.microphones, -10, () => false);
    expect(results).toHaveLength(1);
    expect(results[0].bands).toHaveLength(8);
    expect(results[0].worstFreqs).toHaveLength(3);
  });
});
