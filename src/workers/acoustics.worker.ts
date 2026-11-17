/// <reference lib="webworker" />
import type { Layout, Library, Project, Vec3 } from '../core/types';
import type { AnalysisOptions } from '../core/analysis';
import { runAnalysis, probeSeat, expandArraySpeakers } from '../core/analysis';
import { findReflectionPaths } from '../core/reflection';
import { computeFeedback } from '../core/feedback';

export type WorkerRequest =
  | { kind: 'analysis'; reqId: number; project: Project; layout: Layout; library: Library; options: AnalysisOptions }
  | { kind: 'reflections'; reqId: number; project: Project; library: Library; source: Vec3; receiver: Vec3; echoDelayMs: number; echoLevelDb: number }
  | { kind: 'feedback'; reqId: number; project: Project; layout: Layout; library: Library }
  | { kind: 'probe'; reqId: number; project: Project; layout: Layout; library: Library; point: Vec3; sampleRate: number };

export type WorkerResponse =
  | { kind: 'progress'; reqId: number; phase: string; percent: number }
  | { kind: 'result'; reqId: number; payload: unknown };

const selfRef = self as unknown as DedicatedWorkerGlobalScope;

selfRef.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  const post = (payload: unknown) => selfRef.postMessage({ kind: 'result', reqId: msg.reqId, payload } satisfies WorkerResponse);
  const progress = (phase: string, percent: number) =>
    selfRef.postMessage({ kind: 'progress', reqId: msg.reqId, phase, percent } satisfies WorkerResponse);

  try {
    if (msg.kind === 'analysis') {
      progress('房间混响计算', 10);
      const snapshot = runAnalysis(msg.project, msg.layout, msg.library, msg.options);
      progress('完成', 100);
      // Float32Array 可结构化克隆，直接传输
      post(snapshot);
    } else if (msg.kind === 'reflections') {
      const matMap = new Map(msg.library.materials.map((m) => [m.id, m]));
      const paths = findReflectionPaths(
        msg.source,
        msg.receiver,
        msg.project.venue,
        matMap,
        { maxOrder: 2, echoDelayMs: msg.echoDelayMs, echoLevelDb: msg.echoLevelDb }
      );
      post(paths);
    } else if (msg.kind === 'feedback') {
      const all = expandArraySpeakers(msg.layout, msg.library);
      const nodeDsp = new Map(msg.layout.graph.nodes.map((n) => [n.id, n.dsp]));
      const venue = msg.project.venue;
      const z0 = venue.audienceZones[0];
      const listener: Vec3 = z0
        ? { x: venue.width / 2, y: venue.length / 2, z: z0.earHeight }
        : { x: venue.width / 2, y: venue.length / 2, z: 1.2 };
      const results = msg.layout.mics.map((mic) =>
        computeFeedback(mic, { ...msg.layout, speakers: all }, { speakers: msg.library.speakers, nodeDsp, listener })
      );
      post(results);
    } else if (msg.kind === 'probe') {
      const r = probeSeat(msg.project, msg.layout, msg.library, msg.point, msg.sampleRate);
      post(r);
    }
  } catch (err) {
    selfRef.postMessage({ kind: 'result', reqId: msg.reqId, payload: { __error: (err as Error).message } } satisfies WorkerResponse);
  }
};
