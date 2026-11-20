import { describe, expect, it } from 'vitest';
import { defaultMaterials, defaultSpeakerModels } from './defaults';
import { defaultSurfaces, roomFaces } from './roomAcoustics';
import { detectEchoes, traceReflections } from './reflection';
import type { Material, Room } from './types';
import type { SpeakerInstance } from './speakers';

function scene() {
  const mats = new Map(defaultMaterials().map((m) => [m.id, m]));
  const hard = [...mats.values()].find((m) => m.name.includes('混凝土'))!;
  const room: Room = {
    length: 20,
    width: 12,
    height: 8,
    surfaces: defaultSurfaces(hard.id, hard.id, hard.id),
  };
  const model = defaultSpeakerModels().find((m) => m.id === 'spk_ps15')!;
  const speaker: SpeakerInstance = {
    uid: 's1',
    model,
    position: { x: 1, y: 6, z: 5 },
    azimuth: 0,
    tilt: -10,
    dsp: undefined,
    amp: { ampId: 'a', channel: 1 },
    lineArrayId: null,
    name: '主扩',
  };
  return { room, mats, speaker };
}

describe('反射声线（虚声源法）', () => {
  it('一阶反射命中 6 个面中的有效面，路径长于直达声', () => {
    const { room, mats, speaker } = scene();
    const listener = { x: 12, y: 6, z: 1.2 };
    const r = traceReflections(speaker, listener, roomFaces(room), mats, 1);
    const firstOrder = r.paths.filter((p) => p.order === 1);
    expect(firstOrder.length).toBeGreaterThan(0);
    expect(firstOrder.length).toBeLessThanOrEqual(6);
    for (const p of firstOrder) {
      expect(p.pathLength).toBeGreaterThan(r.directLength);
      expect(p.delayMs).toBeGreaterThan(0);
      expect(p.reflectionPoints).toHaveLength(1);
    }
  });

  it('二阶反射经两个反射点且延时显著长于一阶（接收球模型）', () => {
    const { room, mats, speaker } = scene();
    const listener = { x: 10, y: 5, z: 1.4 };
    const r = traceReflections(speaker, listener, roomFaces(room), mats, 2);
    const first = r.paths.filter((p) => p.order === 1);
    const second = r.paths.filter((p) => p.order === 2);
    expect(first).toHaveLength(6);
    // 矩形盒中二阶路径数量取决于几何，至少应能识别出跨墙二次反射
    expect(second.length).toBeGreaterThan(0);
    for (const p of second) {
      expect(p.reflectionPoints).toHaveLength(2);
      expect(p.pathLength).toBeGreaterThan(r.directLength);
      const firstMaxDelay = Math.max(...first.map((q) => q.delayMs));
      expect(p.delayMs).toBeGreaterThan(firstMaxDelay);
    }
  });

  it('硬墙大厅存在显著延时的回声风险，加吸声后风险下降', () => {
    const mats = new Map(defaultMaterials().map((m) => [m.id, m]));
    const hard = [...mats.values()].find((m) => m.name.includes('混凝土'))!;
    const room: Room = {
      length: 30,
      width: 24,
      height: 12,
      surfaces: defaultSurfaces(hard.id, hard.id, hard.id),
    };
    const model = defaultSpeakerModels().find((m) => m.id === 'spk_ps15')!;
    const spk: SpeakerInstance = {
      uid: 's1',
      model,
      position: { x: 2, y: 12, z: 7 },
      azimuth: 0,
      tilt: -5,
      dsp: undefined,
      amp: { ampId: 'a', channel: 1 },
      lineArrayId: null,
      name: '主扩',
    };
    // 前排座位：舞台后墙的长延时反射在此形成回声
    const listener = { x: 8, y: 10, z: 1.2 };
    const hardResult = traceReflections(spk, listener, roomFaces(room), mats, 2);
    const echoesHard = detectEchoes(hardResult, listener, { minDelayMs: 30 });
    expect(echoesHard.risks.length).toBeGreaterThan(0);
    expect(echoesHard.risks[0].delayMs).toBeGreaterThan(50);

    // 换成强吸声墙面：反射级差普遍跌到判据以下，回声减少
    const wool = [...mats.values()].find((m) => m.name.includes('玻璃棉'))!;
    const softMats = new Map(mats);
    for (const m of softMats.values()) {
      const patched: Material = { ...m, absorption: { ...wool.absorption } };
      softMats.set(m.id, patched);
    }
    const softResult = traceReflections(spk, listener, roomFaces(room), softMats, 2);
    const echoesSoft = detectEchoes(softResult, listener, { minDelayMs: 30 });
    expect(echoesSoft.risks.length).toBeLessThan(echoesHard.risks.length);
  });
});
