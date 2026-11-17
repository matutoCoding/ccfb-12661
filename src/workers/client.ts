import type { Layout, Library, Project, Vec3, AnalysisSnapshot, ReflectionPath, FeedbackResult, SeatProbe } from '../core/types';
import type { AnalysisOptions } from '../core/analysis';
import type { WorkerRequest, WorkerResponse } from './acoustics.worker';
// RIR 结果类型与 SeatProbe 对齐（worker 返回不含包装）
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
interface ProbePayload {
  splBands: number[];
  splDBA: number;
  response: { freq: number; db: number }[];
  rirSamples: Float32Array;
  rt60Bands: number[];
  directSample: number;
  durationSec: number;
}

class WorkerClient {
  private worker: Worker | null = null;
  private reqId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (p: { phase: string; percent: number }) => void }>();

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./acoustics.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        const entry = this.pending.get(msg.reqId);
        if (!entry) return;
        if (msg.kind === 'progress') {
          entry.onProgress?.({ phase: msg.phase, percent: msg.percent });
        } else {
          this.pending.delete(msg.reqId);
          const payload = msg.payload as { __error?: string };
          if (payload && typeof payload === 'object' && '__error' in payload) {
            entry.reject(new Error(payload.__error));
          } else {
            entry.resolve(msg.payload);
          }
        }
      };
      this.worker.onerror = (e) => {
        for (const [, entry] of this.pending) entry.reject(new Error(e.message));
        this.pending.clear();
      };
    }
    return this.worker;
  }

  private call<T>(msg: DistributiveOmit<WorkerRequest, 'reqId'>, onProgress?: (p: { phase: string; percent: number }) => void): Promise<T> {
    const reqId = ++this.reqId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      this.ensure().postMessage({ ...msg, reqId } as WorkerRequest);
    });
  }

  runAnalysis(project: Project, layout: Layout, library: Library, options: AnalysisOptions, onProgress?: (p: { phase: string; percent: number }) => void) {
    return this.call<AnalysisSnapshot>({ kind: 'analysis', project, layout, library, options }, onProgress);
  }

  findReflections(project: Project, library: Library, source: Vec3, receiver: Vec3, echoDelayMs: number, echoLevelDb: number) {
    return this.call<ReflectionPath[]>({ kind: 'reflections', project, library, source, receiver, echoDelayMs, echoLevelDb });
  }

  computeFeedback(project: Project, layout: Layout, library: Library) {
    return this.call<FeedbackResult[]>({ kind: 'feedback', project, layout, library });
  }

  probeSeat(project: Project, layout: Layout, library: Library, point: Vec3, sampleRate: number) {
    return this.call<ProbePayload>({ kind: 'probe', project, layout, library, point, sampleRate });
  }
}

export const workerClient = new WorkerClient();
export type { ProbePayload, SeatProbe };
