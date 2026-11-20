import { describe, expect, it } from 'vitest';
import { BAND_FREQS, type Material, type Room } from './types';
import { defaultMaterials } from './defaults';
import { defaultSurfaces, roomFaces, roomVolume, sabineRT60, totalAbsorption } from './roomAcoustics';

function testRoom(): { room: Room; mats: Map<string, Material> } {
  const mats = new Map(defaultMaterials().map((m) => [m.id, m]));
  const hard = [...mats.values()].find((m) => m.name.includes('混凝土'))!;
  const wool = [...mats.values()].find((m) => m.name.includes('玻璃棉'))!;
  const surfaces = defaultSurfaces(hard.id, hard.id, wool.id);
  const room: Room = { length: 20, width: 15, height: 8, surfaces };
  return { room, mats };
}

describe('room acoustics', () => {
  it('六面墙面积与房间容积', () => {
    const { room } = testRoom();
    const faces = roomFaces(room);
    expect(faces).toHaveLength(6);
    expect(roomVolume(room)).toBe(20 * 15 * 8);
    expect(faces[0].area).toBe(300);
    expect(faces[2].area).toBe(160);
  });

  it('赛宾 RT60 随吸声增强而下降，且处于合理区间', () => {
    const { room, mats } = testRoom();
    const rt = sabineRT60(room, mats);
    for (const f of BAND_FREQS) {
      expect(rt[f]).toBeGreaterThan(0.2);
      expect(rt[f]).toBeLessThan(8);
    }
    // 顶棚强吸声时，高频 RT60 应明显短于低频
    expect(rt[4000]).toBeLessThan(rt[125]);
  });

  it('全硬房间 RT60 很长，全吸声房间 RT60 很短', () => {
    const { room, mats } = testRoom();
    const hard = [...mats.values()].find((m) => m.name.includes('混凝土'))!;
    const wool = [...mats.values()].find((m) => m.name.includes('玻璃棉'))!;
    const hardRoom: Room = { ...room, surfaces: defaultSurfaces(hard.id, hard.id, hard.id) };
    const softRoom: Room = { ...room, surfaces: defaultSurfaces(wool.id, wool.id, wool.id) };
    const rtHard = sabineRT60(hardRoom, mats);
    const rtSoft = sabineRT60(softRoom, mats);
    expect(rtHard[1000]).toBeGreaterThan(rtSoft[1000] * 3);
    expect(totalAbsorption(softRoom, mats)[1000]).toBeGreaterThan(totalAbsorption(hardRoom, mats)[1000]);
  });
});
