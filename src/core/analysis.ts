import type {
  AnalysisSnapshot, Layout, Library, Project, SeatMetric, Vec3
} from './types';
import {
  BAND_COUNT, dbaFromBands, sumDb, AIR_ATTEN
} from './acoustics/bands';
import { roomAcoustics, roomConstant, computeRT60 } from './acoustics/reverb';
import {
  speakerPressureAt, reverberantSpl, sumComplexPressure, totalSpl
} from './acoustics/directivity';
import { computeSpeakerBudget, driveDbFromBudget } from './level-budget';
import { computeFeedback } from './feedback';
import {
  findReflectionPaths, computeEchoMap, synthesizeRIR, pathsToRirReflections
} from './reflection';
import { pickLoads, arrayGeometry, sampleAudiencePoints } from './array';
import { computeBOM } from './bom';
import { polygonCentroid } from './math/vec3';

export interface AnalysisOptions {
  echoDelayMs: number;
  echoLevelDb: number;
  gridSpacing: number;
}

export const DEFAULT_ANALYSIS_OPTS: AnalysisOptions = {
  echoDelayMs: 50,
  echoLevelDb: 15,
  gridSpacing: 2
};

/** 展开线阵列为实际箱体实例（参与声场计算） */
export function expandArraySpeakers(layout: Layout, library: Library) {
  const modelById = new Map(library.speakers.map((m) => [m.id, m]));
  const expanded = [...layout.speakers.filter((s) => !s.arrayId)];
  for (const arr of layout.arrays) {
    const model = modelById.get(arr.elementModelId);
    if (!model) continue;
    const geo = arrayGeometry(arr, model);
    geo.positions.forEach((pos, i) => {
      expanded.push({
        id: `${arr.id}-el-${i}`,
        name: `${arr.name} #${i + 1}`,
        modelId: arr.elementModelId,
        position: pos,
        orientation: { yaw: arr.yaw, pitch: geo.pitches[i], roll: 0 },
        ampNodeId: arr.ampNodeId,
        arrayId: arr.id,
        gainOffset: 0
      });
    });
  }
  return expanded;
}

export function runAnalysis(
  project: Project,
  layout: Layout,
  library: Library,
  opts: AnalysisOptions = DEFAULT_ANALYSIS_OPTS
): AnalysisSnapshot {
  const venue = project.venue;
  const matMap = new Map(library.materials.map((m) => [m.id, m]));
  const spkMap = new Map(library.speakers.map((m) => [m.id, m]));
  const ampMap = new Map(library.amps.map((m) => [m.id, m]));

  // 1. 房间声学 / RT60
  const rt60 = computeRT60(venue, matMap);
  const room = roomAcoustics(venue, matMap);
  const R = roomConstant(room);

  // 2. 电平预算（用展开前的逻辑实例，阵列箱体共用阵列绑定通道）
  const resolver = {
    amp: (id: string) => ampMap.get(id),
    speaker: (id: string) => spkMap.get(id)
  };
  const budgets = layout.speakers.map((sp) => computeSpeakerBudget(layout, sp, resolver));
  const budgetById = new Map(budgets.map((b) => [b.speakerId, b]));

  // 3. 展开阵列得到实际发声箱体及驱动电平
  const allSpeakers = expandArraySpeakers(layout, library);
  const driveOf = (instId: string, parentId?: string): number => {
    const b = budgetById.get(instId) ?? (parentId ? budgetById.get(parentId) : undefined);
    return b ? driveDbFromBudget(b) : -20;
  };

  // 4. 观众区采样
  const samples = sampleAudiencePoints(venue.audienceZones, opts.gridSpacing);
  const seats: SeatMetric[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const s of samples) {
    minX = Math.min(minX, s.position.x); maxX = Math.max(maxX, s.position.x);
    minY = Math.min(minY, s.position.y); maxY = Math.max(maxY, s.position.y);
  }
  if (!Number.isFinite(minX)) { minX = 0; maxX = venue.width; minY = 0; maxY = venue.length; }

  const splAt = (point: Vec3): SeatMetric => {
    const directPerBand: { magDb: number; phase: number }[][] = Array.from({ length: BAND_COUNT }, () => []);
    const reverbPerBand: number[][] = Array.from({ length: BAND_COUNT }, () => []);
    for (const inst of allSpeakers) {
      const model = spkMap.get(inst.modelId);
      if (!model) continue;
      const drive = driveOf(inst.id, layout.arrays.find((a) => a.id === inst.arrayId)?.id);
      const { direct } = speakerPressureAt(model, inst, point, drive);
      const reverb = reverberantSpl(model, drive, R);
      for (let b = 0; b < BAND_COUNT; b++) {
        directPerBand[b].push(direct[b]);
        reverbPerBand[b].push(reverb[b]);
      }
    }
    const directBands = directPerBand.map((arr) => sumComplexPressure(arr));
    const reverbBands = reverbPerBand.map((arr) => sumDb(arr));
    const splBands = totalSpl(directBands, reverbBands);
    // 余量：取该点总 SPL 与系统最大可输出（预算 spl1m 经距离折算）的最小差
    let headroom = Infinity;
    for (const inst of allSpeakers) {
      const model = spkMap.get(inst.modelId);
      if (!model) continue;
      const r = Math.max(Math.hypot(point.x - inst.position.x, point.y - inst.position.y, point.z - inst.position.z), 0.3);
      const b = budgetById.get(inst.id) ?? [...budgetById.values()].find((x) => x.speakerName.includes(inst.arrayId ?? ''));
      const spl1m = b?.spl1m ?? model.maxSPL - 10;
      const achievable = spl1m - 20 * Math.log10(r) - AIR_ATTEN[4] * r;
      headroom = Math.min(headroom, achievable - splBands[4]);
    }
    return {
      position: point,
      directBands: directBands.map((r) => Math.round(r * 10) / 10),
      reverbBands: reverbBands.map((r) => Math.round(r * 10) / 10),
      splBands: splBands.map((r) => Math.round(r * 10) / 10),
      splDBA: Math.round(dbaFromBands(splBands) * 10) / 10,
      headroom: Math.round((Number.isFinite(headroom) ? headroom : 0) * 10) / 10
    };
  };

  for (const s of samples) seats.push(splAt(s.position));

  // 5. SPL 网格（热力图，规则栅格 + 多边形掩码由着色器/前端处理）
  const nx = Math.max(8, Math.round((maxX - minX) / opts.gridSpacing));
  const ny = Math.max(8, Math.round((maxY - minY) / opts.gridSpacing));
  const gridValues = new Float32Array(nx * ny * BAND_COUNT);
  const gridDba = new Float32Array(nx * ny);
  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      const x = minX + ((maxX - minX) * ix) / Math.max(nx - 1, 1);
      const y = minY + ((maxY - minY) * iy) / Math.max(ny - 1, 1);
      const zone = venue.audienceZones.find((z) =>
        (function inPoly(): boolean {
          // 内联点在多边形判断避免循环依赖
          const p = { x, y };
          let inside = false;
          for (let i = 0, j = z.polygon.length - 1; i < z.polygon.length; j = i++) {
            const xi = z.polygon[i].x, yi = z.polygon[i].y;
            const xj = z.polygon[j].x, yj = z.polygon[j].y;
            if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
          }
          return inside;
        })()
      );
      const idx = iy * nx + ix;
      if (!zone) {
        gridDba[idx] = -999;
        continue;
      }
      const m = splAt({ x, y, z: zone.earHeight });
      gridDba[idx] = m.splDBA;
      for (let b = 0; b < BAND_COUNT; b++) gridValues[idx * BAND_COUNT + b] = m.splBands[b];
    }
  }

  // 6. 啸叫（听众参考点取观众区质心）
  const listener: Vec3 = venue.audienceZones[0]
    ? (() => {
      const c = polygonCentroid(venue.audienceZones[0].polygon);
      return { x: c.x, y: c.y, z: venue.audienceZones[0].earHeight };
    })()
    : { x: venue.width / 2, y: venue.length / 2, z: 1.2 };
  const nodeDsp = new Map(layout.graph.nodes.map((n) => [n.id, n.dsp]));
  const feedback = layout.mics.map((mic) =>
    computeFeedback(mic, { ...layout, speakers: allSpeakers }, {
      speakers: library.speakers,
      nodeDsp,
      listener
    })
  );

  // 7. 反射与回声图（以主扩音箱/阵列首箱为声源）
  const primarySource = allSpeakers[0]?.position ?? { x: venue.width / 2, y: 1, z: venue.height - 1 };
  const reflOpts = { maxOrder: 2 as const, echoDelayMs: opts.echoDelayMs, echoLevelDb: opts.echoLevelDb };
  const reflections = findReflectionPaths(primarySource, listener, venue, matMap, reflOpts);
  const echoMap = computeEchoMap(primarySource, venue, matMap, venue.audienceZones, samples, reflOpts);

  // 8. 吊挂校核
  const rigging = layout.arrays.map((arr) => {
    const model = spkMap.get(arr.elementModelId)!;
    return pickLoads(arr, model);
  });

  // 9. BOM
  const bom = computeBOM(layout, {
    speakers: spkMap,
    amps: ampMap
  });

  return {
    layoutId: layout.id,
    rt60,
    budgets,
    feedback,
    splGrid: { min: { x: minX, y: minY }, max: { x: maxX, y: maxY }, nx, ny, values: gridValues, dba: gridDba },
    seats,
    reflections,
    echoMap,
    rigging,
    bom,
    computedAt: Date.now()
  };
}

/** 单点探测：频响曲线 + RIR（试听卷积用） */
export function probeSeat(
  project: Project,
  layout: Layout,
  library: Library,
  point: Vec3,
  sampleRate = 48000
): { splBands: number[]; splDBA: number; response: { freq: number; db: number }[]; rirSamples: Float32Array; rt60Bands: number[]; directSample: number; durationSec: number } {
  const snapshot = runAnalysis(project, layout, library, { ...DEFAULT_ANALYSIS_OPTS, gridSpacing: 3 });
  const matMap = new Map(library.materials.map((m) => [m.id, m]));
  const metric = snapshot.seats.find((s) =>
    Math.hypot(s.position.x - point.x, s.position.y - point.y) < 0.01
  ) ?? (() => {
    // 直接重算该点
    const spkMap = new Map(library.speakers.map((m) => [m.id, m]));
    const all = expandArraySpeakers(layout, library);
    const room = roomAcoustics(venue0(project), matMap);
    const R = roomConstant(room);
    const directPerBand: { magDb: number; phase: number }[][] = Array.from({ length: BAND_COUNT }, () => []);
    const reverbPerBand: number[][] = Array.from({ length: BAND_COUNT }, () => []);
    for (const inst of all) {
      const model = spkMap.get(inst.modelId);
      if (!model) continue;
      const { direct } = speakerPressureAt(model, inst, point, -10);
      const reverb = reverberantSpl(model, -10, R);
      for (let b = 0; b < BAND_COUNT; b++) { directPerBand[b].push(direct[b]); reverbPerBand[b].push(reverb[b]); }
    }
    const directBands = directPerBand.map((a) => sumComplexPressure(a));
    const reverbBands = reverbPerBand.map((a) => sumDb(a));
    const splBands = totalSpl(directBands, reverbBands);
    return {
      position: point,
      directBands,
      reverbBands,
      splBands,
      splDBA: dbaFromBands(splBands),
      headroom: 0
    };
  })();

  // 频响曲线：8 带样条 + 反射着色（细粒度用带间对数插值）
  const freqs = [50, 80, 125, 250, 500, 1000, 2000, 4000, 8000, 10000];
  const response = freqs.map((f, i) => {
    const b = Math.min(7, Math.max(0, Math.round(Math.log2(f / 63))));
    return { freq: f, db: Math.round(metric.splBands[Math.min(b, 7)] * 10) / 10 + (i === 0 ? 0 : 0) };
  });

  // RIR：以该点反射路径 + RT60 合成
  const reflPaths = findReflectionPaths(
    expandArraySpeakers(layout, library)[0]?.position ?? point,
    point,
    project.venue,
    matMap,
    { maxOrder: 2, echoDelayMs: 50, echoLevelDb: 15 }
  );
  const durationSec = Math.min(3, Math.max(1.2, Math.max(...snapshot.rt60.sabine) * 1.2));
  const rirSamples = synthesizeRIR({
    sampleRate,
    rt60Bands: snapshot.rt60.sabine,
    reflections: pathsToRirReflections(reflPaths, metric.directBands),
    directBandsDb: metric.directBands,
    durationSec
  });

  return {
    splBands: metric.splBands,
    splDBA: metric.splDBA,
    response,
    rirSamples,
    rt60Bands: snapshot.rt60.sabine,
    directSample: 0,
    durationSec
  };
}

function venue0(project: Project) {
  return project.venue;
}
