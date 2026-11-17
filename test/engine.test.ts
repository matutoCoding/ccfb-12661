import { describe, it, expect } from 'vitest';
import { arrayGeometry, autoSplay, pickLoads, totalArrayWeight } from '../src/core/array';
import { computeSpeakerBudget } from '../src/core/level-budget';
import { findReflectionPaths } from '../src/core/reflection';
import { createDemoProject, seedLibrary } from '../src/core/seed';
import { FFT, convolveReal, nextPow2 } from '../src/core/math/fft';
import { runAnalysis, expandArraySpeakers } from '../src/core/analysis';
import { synthesizeRIR } from '../src/core/reflection';
import type { LineArray } from '../src/core/types';

const lib = seedLibrary();
const la12 = lib.speakers.find((m) => m.id === 'spk-la12')!;

describe('线阵列吊挂校核', () => {
  const base: LineArray = {
    id: 'arr-t', name: '测试阵列', elementModelId: 'spk-la12',
    framePosition: { x: 12, y: 2, z: 9 }, yaw: 0, count: 6,
    interAngles: [1, 1.2, 1.5, 1.8, 2], ratedPickLoad: 200, pickPointCount: 2
  };

  it('总重 = 单元数×单重×1.08', () => {
    expect(totalArrayWeight(base, la12)).toBeCloseTo(6 * 18.5 * 1.08, 5);
  });

  it('箱体位置逐只下沉，数量与输入一致', () => {
    const geo = arrayGeometry(base, la12);
    expect(geo.positions).toHaveLength(6);
    for (let i = 1; i < 6; i++) {
      expect(geo.positions[i].z).toBeLessThan(geo.positions[i - 1].z);
    }
  });

  it('吊点载荷之和等于总重', () => {
    const r = pickLoads(base, la12);
    const sum = r.picks.reduce((a, p) => a + p.loadKg, 0);
    expect(sum).toBeCloseTo(r.totalWeight, 4);
    expect(r.picks.every((p) => p.ok)).toBe(true);
  });

  it('额定值过低时报警', () => {
    const r = pickLoads({ ...base, ratedPickLoad: 10 }, la12);
    expect(r.picks.some((p) => !p.ok)).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('按观众区反推张角：张角数量正确且为正', () => {
    const { project } = createDemoProject();
    const angles = autoSplay(base, la12, project.venue.audienceZones);
    expect(angles).toHaveLength(5);
    expect(angles.every((a) => a > 0)).toBe(true);
  });
});

describe('电平预算', () => {
  it('演示方案沿链路逐级推算并能检测过载', () => {
    const { layouts } = createDemoProject();
    const layout = layouts[0];
    const spkMap = new Map(lib.speakers.map((m) => [m.id, m]));
    const ampMap = new Map(lib.amps.map((m) => [m.id, m]));
    const sp = layout.speakers[0];
    const budget = computeSpeakerBudget(layout, sp, { amp: (id) => ampMap.get(id), speaker: (id) => spkMap.get(id) });
    expect(budget.stages.length).toBeGreaterThan(2);
    expect(budget.powerW).toBeGreaterThan(0);
    // 级联输出电平单调可追踪
    for (const st of budget.stages) expect(Number.isFinite(st.outputDbu)).toBe(true);
  });

  it('极高源电平会把某一级标为过载', () => {
    const { layouts } = createDemoProject();
    const layout = layouts[0];
    layout.sourceLevel = 30; // 远超削波
    const spkMap = new Map(lib.speakers.map((m) => [m.id, m]));
    const ampMap = new Map(lib.amps.map((m) => [m.id, m]));
    const budget = computeSpeakerBudget(layout, layout.speakers[0], { amp: (id) => ampMap.get(id), speaker: (id) => spkMap.get(id) });
    expect(budget.firstOverload).toBeGreaterThanOrEqual(0);
    expect(budget.stages.some((s) => s.overload)).toBe(true);
  });
});

describe('镜像反射路径', () => {
  it('演示剧场可枚举一阶/二阶反射且延时非负', () => {
    const { project } = createDemoProject();
    const matMap = new Map(lib.materials.map((m) => [m.id, m]));
    const paths = findReflectionPaths(
      { x: 12, y: 2, z: 8 }, { x: 12, y: 20, z: 1.2 },
      project.venue, matMap, { maxOrder: 2, echoDelayMs: 50, echoLevelDb: 15 }
    );
    expect(paths.some((p) => p.order === 1)).toBe(true);
    expect(paths.some((p) => p.order === 2)).toBe(true);
    for (const p of paths) {
      expect(p.delayMs).toBeGreaterThanOrEqual(0);
      expect(p.points.length).toBe(p.order + 2);
    }
    // 延时排序
    for (let i = 1; i < paths.length; i++) expect(paths[i].delayMs).toBeGreaterThanOrEqual(paths[i - 1].delayMs);
  });
});

describe('FFT 与卷积', () => {
  it('FFT/IFFT 往返还原', () => {
    const n = 16;
    const fft = new FFT(n);
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * i) / n);
    const re0 = new Float64Array(re);
    fft.transform(re, im);
    fft.transform(re, im, true);
    for (let i = 0; i < n; i++) expect(re[i]).toBeCloseTo(re0[i], 9);
  });

  it('卷积长度 = Na+Nb-1，冲激输入保持原信号', () => {
    const a = new Float32Array([1, 0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    const c = convolveReal(a, b);
    expect(c.length).toBe(4 + 3 - 1);
    expect(Array.from(c).slice(0, 3).map((x) => Math.round(x * 1000) / 1000)).toEqual([1, 2, 3]);
    expect(nextPow2(33)).toBe(64);
  });
});

describe('端到端分析与 RIR 一致性', () => {
  const { project, layouts } = createDemoProject();
  const snapshot = runAnalysis(project, layouts[0], lib, { echoDelayMs: 50, echoLevelDb: 15, gridSpacing: 3 });

  it('产出完整分析快照', () => {
    expect(snapshot.rt60.sabine).toHaveLength(8);
    expect(snapshot.budgets.length).toBeGreaterThan(0);
    expect(snapshot.feedback.length).toBe(layouts[0].mics.length);
    expect(snapshot.rigging.length).toBe(layouts[0].arrays.length);
    expect(snapshot.seats.length).toBeGreaterThan(0);
    expect(snapshot.bom.items.length).toBeGreaterThan(0);
    expect(snapshot.bom.totalPowerW).toBeGreaterThan(0);
  });

  it('SPL 网格有限值与掩码共存', () => {
    const valid = Array.from(snapshot.splGrid.dba).filter((v) => v > -900);
    expect(valid.length).toBeGreaterThan(0);
    expect(valid.every((v) => Number.isFinite(v) && v > 40 && v < 140)).toBe(true);
  });

  it('阵列展开后箱体数等于各阵列 count 之和加独立箱', () => {
    const expanded = expandArraySpeakers(layouts[0], lib);
    const expected = layouts[0].speakers.length + layouts[0].arrays.reduce((n, a) => n + a.count, 0);
    expect(expanded.length).toBe(expected);
  });

  it('合成 RIR 的衰减时间常数与 RT60 对齐（晚期场包络回归斜率）', () => {
    const rt60 = snapshot.rt60.sabine;
    // 单频带隔离验证：除 1kHz 外其余频带 RT60 设为同一极小值，避免多 τ 混合拉平斜率
    const singleBand = [0.05, 0.05, 0.05, 0.05, 1.0, 0.05, 0.05, 0.05];
    const rir = synthesizeRIR({
      sampleRate: 48000,
      rt60Bands: singleBand,
      reflections: [],
      directBandsDb: [-30, -30, -30, -30, -30, -30, -30, -30],
      durationSec: 2
    });
    // 在晚期场窗口（0.1s..1.4s）内对瞬时功率做滑动能量平均，再线性回归 ln(E)~t
    const sr = 48000;
    const win = Math.floor(0.02 * sr);
    const t0 = Math.floor(0.1 * sr), t1 = Math.floor(1.4 * sr);
    const xs: number[] = [], ys: number[] = [];
    for (let i = t0; i < t1; i += win) {
      let e = 0;
      for (let j = i; j < i + win; j++) e += rir[j] * rir[j];
      if (e > 0) { xs.push(i / sr); ys.push(Math.log(e / win)); }
    }
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    const slope = num / den; // ln(E) = -2t/τ → τ = -2/slope
    const tauFit = -2 / slope;
    const tauExpected = 1.0 / 13.8155;
    // 单频带包络应与 τ=RT60/13.8155 吻合，25% 容差
    expect(tauFit).toBeGreaterThan(tauExpected * 0.75);
    expect(tauFit).toBeLessThan(tauExpected * 1.25);
    // 实际多频带 RIR 也应具备可测的衰减尾部（非零能量覆盖到 1 秒后）
    const realRir = synthesizeRIR({
      sampleRate: 48000, rt60Bands: rt60,
      reflections: [{ delayMs: 0, gainBands: snapshot.seats[0].directBands }],
      directBandsDb: snapshot.seats[0].directBands, durationSec: 2
    });
    let tailEnergy = 0;
    for (let i = sr; i < sr * 1.5; i++) tailEnergy += realRir[i] ** 2;
    expect(tailEnergy).toBeGreaterThan(0);
  });
});
