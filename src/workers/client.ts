import type {
  ReflectionSeatOutput,
  SceneSnapshot,
  WorkerRequest,
  WorkerResponse,
} from './protocol';
import type { FeedbackResult } from '../core/feedback';
import type { SplGrid } from '../core/analysis';
import type { Microphone, Vec3 } from '../core/types';
import { computeFeedback, computeGrid, computeReflections } from './engine';

type PendingEntry = {
  resolve: (v: never) => void;
  reject: (e: Error) => void;
  onProgress?: (done: number, total: number) => void;
};

/**
 * 声学计算客户端：优先 Web Worker，环境不支持时自动降级到主线程。
 * 同类型新请求会自动取消旧请求（拖动场景时只保留最新一次）。
 */
export class AcousticsClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, PendingEntry>();
  private lastByKind = new Map<string, number>();
  private fallbackCancelled = new Set<number>();

  constructor() {
    if (typeof Worker !== 'undefined') {
      try {
        this.worker = new Worker(new URL('./acoustics.worker.ts', import.meta.url), {
          type: 'module',
        });
        this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(ev.data);
        this.worker.onerror = (ev) => this.failAll(ev.message || 'worker 错误');
      } catch {
        this.worker = null;
      }
    }
  }

  get usingWorker(): boolean {
    return this.worker !== null;
  }

  private onMessage(msg: WorkerResponse): void {
    if (msg.type === 'pong') return;
    if (msg.type === 'progress') {
      this.pending.get(msg.reqId)?.onProgress?.(msg.done, msg.total);
      return;
    }
    const entry = this.pending.get(msg.reqId);
    if (!entry) return;
    this.pending.delete(msg.reqId);
    if (msg.type === 'error') entry.reject(new Error(msg.message));
    else if (msg.type === 'cancelled') entry.reject(new CancelledError());
    else entry.resolve(msg as never);
  }

  private failAll(message: string): void {
    for (const [, entry] of this.pending) entry.reject(new Error(message));
    this.pending.clear();
  }

  private nextReqId(kind: string): number {
    const id = ++this.seq;
    const prev = this.lastByKind.get(kind);
    if (prev !== undefined) this.cancel(prev);
    this.lastByKind.set(kind, id);
    return id;
  }

  cancel(reqId: number): void {
    if (this.worker) {
      const msg: WorkerRequest = { type: 'cancel', reqId };
      this.worker.postMessage(msg);
    } else {
      this.fallbackCancelled.add(reqId);
    }
    const entry = this.pending.get(reqId);
    if (entry) {
      this.pending.delete(reqId);
      entry.reject(new CancelledError());
    }
  }

  private send<T>(kind: string, req: Omit<WorkerRequest, 'reqId'>, onProgress?: (d: number, t: number) => void): Promise<T> {
    const reqId = this.nextReqId(kind);
    const full = { ...req, reqId } as WorkerRequest;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, {
        resolve: resolve as (v: never) => void,
        reject,
        onProgress,
      });
      if (this.worker) {
        this.worker.postMessage(full);
      } else {
        this.runFallback(full, reqId, onProgress)
          .then((v) => resolve(v as T))
          .catch(reject);
      }
    });
  }

  private async runFallback(
    msg: WorkerRequest,
    reqId: number,
    onProgress?: (d: number, t: number) => void,
  ): Promise<unknown> {
    await new Promise((r) => setTimeout(r, 0));
    const cancelled = () => this.fallbackCancelled.has(reqId);
    if (msg.type === 'reflections') {
      const seats = computeReflections(msg.scene, msg.seats, msg.maxOrder, cancelled, onProgress);
      this.fallbackCancelled.delete(reqId);
      if (cancelled()) throw new CancelledError();
      return { type: 'reflections:done', reqId, seats } as { seats: ReflectionSeatOutput[] };
    }
    if (msg.type === 'feedback') {
      const results: FeedbackResult[] = computeFeedback(
        msg.scene,
        msg.microphones,
        msg.systemGainDb ?? 0,
        cancelled,
      );
      this.fallbackCancelled.delete(reqId);
      if (cancelled()) throw new CancelledError();
      return { results };
    }
    if (msg.type === 'grid') {
      const grid: SplGrid | null = computeGrid(msg.scene, msg.seats, cancelled);
      this.fallbackCancelled.delete(reqId);
      if (cancelled() || !grid) throw new CancelledError();
      return { grid };
    }
    throw new Error('未知任务');
  }

  reflections(scene: SceneSnapshot, seats: Vec3[], maxOrder: 1 | 2, onProgress?: (d: number, t: number) => void) {
    return this.send<{ seats: ReflectionSeatOutput[] }>(
      'reflections',
      { type: 'reflections', scene, seats, maxOrder } as never,
      onProgress,
    );
  }

  feedback(scene: SceneSnapshot, microphones: Microphone[], systemGainDb?: number) {
    return this.send<{ results: FeedbackResult[] }>(
      'feedback',
      { type: 'feedback', scene, microphones, systemGainDb } as never,
    );
  }

  grid(scene: SceneSnapshot, seats: Vec3[]) {
    return this.send<{ grid: SplGrid }>('grid', { type: 'grid', scene, seats } as never);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.failAll('客户端已释放');
  }
}

export class CancelledError extends Error {
  constructor() {
    super('计算已取消');
    this.name = 'CancelledError';
  }
}

export function isCancelled(err: unknown): boolean {
  return err instanceof CancelledError;
}
