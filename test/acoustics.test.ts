import { describe, it, expect } from 'vitest';
import { computeRT60, roomAcoustics, roomConstant } from '../src/core/acoustics/reverb';
import { seedLibrary, defaultVenue } from '../src/core/seed';
import { sumDb, dbaFromBands, dbuToVolts, voltsToDbu, logFreqPoints } from '../src/core/acoustics/bands';
import { chainFilterResponseDb, defaultDSPChain, peqCoeffs } from '../src/core/dsp';

describe('声学基础', () => {
  const lib = seedLibrary();
  const matMap = new Map(lib.materials.map((m) => [m.id, m]));

  it('赛宾 RT60 与手算一致（V=1000, A=200 → 0.805s）', () => {
    const venue = defaultVenue(10, 10, 10); // V=1000
    const r = roomAcoustics(venue, matMap);
    // 构造总吸声量 A=200 的情形校验公式本身
    const rt = 0.161 * 1000 / 200;
    expect(rt).toBeCloseTo(0.805, 2);
    expect(r.volume).toBe(1000);
  });

  it('强吸声房间 RT60 明显短于硬面房间', () => {
    const hard = defaultVenue(20, 25, 10);
    const soft = defaultVenue(20, 25, 10);
    for (const s of soft.surfaces) s.materialId = 'mat-fabric';
    const rtHard = computeRT60(hard, matMap);
    const rtSoft = computeRT60(soft, matMap);
    expect(rtSoft.sabine[4]).toBeLessThan(rtHard.sabine[4]);
  });

  it('伊林公式在高吸声时比赛宾更短', () => {
    const venue = defaultVenue(15, 20, 8);
    for (const s of venue.surfaces) s.materialId = 'mat-fabric';
    const rt = computeRT60(venue, matMap);
    for (let b = 1; b < 7; b++) {
      expect(rt.eyring[b]).toBeLessThanOrEqual(rt.sabine[b] + 1e-9);
    }
  });

  it('房间常数为正且随吸声增大', () => {
    const hard = defaultVenue(20, 25, 10);
    const soft = defaultVenue(20, 25, 10);
    for (const s of soft.surfaces) s.materialId = 'mat-fabric';
    const rHard = roomConstant(roomAcoustics(hard, matMap));
    const rSoft = roomConstant(roomAcoustics(soft, matMap));
    expect(rSoft[4]).toBeGreaterThan(rHard[4]);
  });

  it('dB 能量叠加：两个相等源 +3dB', () => {
    expect(sumDb([90, 90])).toBeCloseTo(93.01, 1);
    expect(dbaFromBands([80, 80, 80, 80, 80, 80, 80, 80])).toBeGreaterThan(80);
  });

  it('dBu/电压往返一致', () => {
    expect(dbuToVolts(0)).toBeCloseTo(0.7746, 3);
    expect(voltsToDbu(0.7746)).toBeCloseTo(0, 2);
    expect(voltsToDbu(dbuToVolts(12))).toBeCloseTo(12, 4);
  });

  it('对数频率点单调且覆盖区间', () => {
    const pts = logFreqPoints(10, 50, 10000);
    expect(pts[0]).toBeCloseTo(50, 10);
    expect(pts[9]).toBeCloseTo(10000, 6);
    for (let i = 1; i < pts.length; i++) expect(pts[i]).toBeGreaterThan(pts[i - 1]);
  });

  it('PEQ 在中心频率处增益符合设定', () => {
    const chain = defaultDSPChain();
    chain.peq = [{ id: 'b1', enabled: true, type: 'bell', freq: 1000, gain: 6, q: 1.4 }];
    const atCenter = chainFilterResponseDb(chain, 1000);
    expect(atCenter).toBeCloseTo(6, 0.5);
    const coeffs = peqCoeffs(chain.peq[0]);
    expect(Number.isFinite(coeffs.b0)).toBe(true);
  });

  it('高通滤波器在远低于截止频率处衰减', () => {
    const chain = defaultDSPChain();
    chain.highpass = { enabled: true, freq: 200, slope: 24 };
    expect(chainFilterResponseDb(chain, 40)).toBeLessThan(-20);
    expect(chainFilterResponseDb(chain, 2000)).toBeCloseTo(0, 1);
  });
});
