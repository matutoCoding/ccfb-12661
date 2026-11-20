import type { Material, Microphone, SpeakerModel, Vec3 } from '../core/types';
import { expandSpeakers } from '../core/speakers';
import { roomFaces, sabineRT60, type RoomFace } from '../core/roomAcoustics';
import { traceReflections, detectEchoes } from '../core/reflection';
import { analyzeFeedback } from '../core/feedback';
import { analyzeGrid } from '../core/analysis';
import { analyzeRigging } from '../core/rigging';
import type { SceneSnapshot, ReflectionSeatOutput } from './protocol';

export interface EngineContext {
  materials: Map<string, Material>;
  speakerModels: Map<string, SpeakerModel>;
  faces: RoomFace[];
}

export function buildContext(scene: SceneSnapshot): EngineContext {
  return {
    materials: new Map(scene.materials.map((m) => [m.id, m])),
    speakerModels: new Map(scene.speakerModels.map((m) => [m.id, m])),
    faces: roomFaces(scene.room),
  };
}

export function computeRt60(scene: SceneSnapshot) {
  const ctx = buildContext(scene);
  return sabineRT60(scene.room, ctx.materials);
}

export function computeRigging(scene: SceneSnapshot) {
  const ctx = buildContext(scene);
  return scene.layout.lineArrays.map((a) => {
    const model = ctx.speakerModels.get(a.speakerModelId);
    return model ? analyzeRigging(a, model) : null;
  }).filter((r): r is NonNullable<typeof r> => r !== null);
}

/** 反射声线 + 回声（重负载，逐座位 yield 进度并支持取消标志） */
export function computeReflections(
  scene: SceneSnapshot,
  seats: Vec3[],
  maxOrder: 1 | 2,
  isCancelled: () => boolean,
  onProgress?: (done: number, total: number) => void,
): ReflectionSeatOutput[] {
  const ctx = buildContext(scene);
  const speakers = expandSpeakers(
    scene.layout.speakers,
    scene.layout.lineArrays,
    ctx.speakerModels,
  );
  const out: ReflectionSeatOutput[] = [];
  for (let i = 0; i < seats.length; i++) {
    if (isCancelled()) return [];
    const seat = seats[i];
    const allPaths = [];
    for (const sp of speakers) {
      const r = traceReflections(sp, seat, ctx.faces, ctx.materials, maxOrder);
      allPaths.push(r);
    }
    // 合并各音箱路径，回声检测在合并结果上做
    const merged = perSpeakerPaths(allPaths.map((r) => r.paths));
    const echoes = detectEchoes(
      {
        directLength: allPaths[0]?.directLength ?? 1,
        directLevelByBand: allPaths[0]?.directLevelByBand ?? ({} as never),
        paths: merged,
      },
      seat,
    );
    out.push({ position: seat, paths: merged, echoes });
    onProgress?.(i + 1, seats.length);
  }
  return out;
}

function perSpeakerPaths(perSpeaker: ReturnType<typeof traceReflections>['paths'][]) {
  return perSpeaker.flat();
}

/** 啸叫余量（逐话筒、逐频段） */
export function computeFeedback(
  scene: SceneSnapshot,
  microphones: Microphone[],
  systemGainDb = 0,
  isCancelled: () => boolean,
) {
  const ctx = buildContext(scene);
  const speakers = expandSpeakers(
    scene.layout.speakers,
    scene.layout.lineArrays,
    ctx.speakerModels,
  );
  const results = [];
  for (const mic of microphones) {
    if (isCancelled()) return [];
    results.push(analyzeFeedback(mic, speakers, { systemGainDb }));
  }
  return results;
}

/** 观众区 SPL 网格 */
export function computeGrid(scene: SceneSnapshot, seats: Vec3[], isCancelled: () => boolean) {
  const ctx = buildContext(scene);
  if (isCancelled()) return null;
  const speakers = expandSpeakers(
    scene.layout.speakers,
    scene.layout.lineArrays,
    ctx.speakerModels,
  );
  return analyzeGrid(seats, speakers);
}
