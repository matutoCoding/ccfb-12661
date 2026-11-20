/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from './protocol';
import { computeFeedback, computeGrid, computeReflections } from './engine';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const cancelled = new Set<number>();

function post(msg: WorkerResponse): void {
  ctx.postMessage(msg);
}

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'ping') {
    post({ type: 'pong' });
    return;
  }
  if (msg.type === 'cancel') {
    cancelled.add(msg.reqId);
    return;
  }

  const reqId = msg.reqId;
  const isCancelled = () => cancelled.has(reqId);
  const t0 = performance.now();
  try {
    // 每个任务前让出一次事件循环，保证 cancel 能被处理
    await new Promise((r) => setTimeout(r, 0));
    if (isCancelled()) {
      post({ type: 'cancelled', reqId });
      cancelled.delete(reqId);
      return;
    }

    if (msg.type === 'reflections') {
      const seats = computeReflections(msg.scene, msg.seats, msg.maxOrder, isCancelled, (done, total) => {
        post({ type: 'progress', reqId, done, total });
      });
      if (isCancelled()) {
        post({ type: 'cancelled', reqId });
      } else {
        post({ type: 'reflections:done', reqId, seats, elapsedMs: performance.now() - t0 });
      }
    } else if (msg.type === 'feedback') {
      const results = computeFeedback(msg.scene, msg.microphones, msg.systemGainDb ?? 0, isCancelled);
      if (isCancelled()) post({ type: 'cancelled', reqId });
      else post({ type: 'feedback:done', reqId, results, elapsedMs: performance.now() - t0 });
    } else if (msg.type === 'grid') {
      const grid = computeGrid(msg.scene, msg.seats, isCancelled);
      if (isCancelled() || !grid) post({ type: 'cancelled', reqId });
      else post({ type: 'grid:done', reqId, grid, elapsedMs: performance.now() - t0 });
    }
  } catch (err) {
    post({ type: 'error', reqId, message: err instanceof Error ? err.message : String(err) });
  } finally {
    cancelled.delete(reqId);
  }
};
