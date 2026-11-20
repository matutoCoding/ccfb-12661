import type {
  BandValues,
  Layout,
  Material,
  Microphone,
  Room,
  SpeakerModel,
  Vec3,
  Venue,
} from '../core/types';
import type { ReflectionPath, SeatEchoResult } from '../core/reflection';
import type { FeedbackResult } from '../core/feedback';
import type { SplGrid } from '../core/analysis';
import type { RiggingReport } from '../core/rigging';

/** Worker 计算所需的完整场景快照（结构化克隆传输） */
export interface SceneSnapshot {
  venue: Venue;
  layout: Layout;
  room: Room;
  materials: Material[];
  speakerModels: SpeakerModel[];
}

export type WorkerRequest =
  | {
      type: 'reflections';
      reqId: number;
      scene: SceneSnapshot;
      seats: Vec3[];
      maxOrder: 1 | 2;
    }
  | {
      type: 'feedback';
      reqId: number;
      scene: SceneSnapshot;
      microphones: Microphone[];
      systemGainDb?: number;
    }
  | {
      type: 'grid';
      reqId: number;
      scene: SceneSnapshot;
      seats: Vec3[];
    }
  | { type: 'cancel'; reqId: number }
  | { type: 'ping' };

export interface ReflectionSeatOutput {
  position: Vec3;
  paths: ReflectionPath[];
  echoes: SeatEchoResult;
}

export type WorkerResponse =
  | {
      type: 'reflections:done';
      reqId: number;
      seats: ReflectionSeatOutput[];
      elapsedMs: number;
    }
  | {
      type: 'feedback:done';
      reqId: number;
      results: FeedbackResult[];
      elapsedMs: number;
    }
  | {
      type: 'grid:done';
      reqId: number;
      grid: SplGrid;
      elapsedMs: number;
    }
  | {
      type: 'progress';
      reqId: number;
      done: number;
      total: number;
    }
  | { type: 'cancelled'; reqId: number }
  | { type: 'error'; reqId: number; message: string }
  | { type: 'pong' };

/** 主线程侧汇总：把场景里的常量（RT60 等）也一并返回给 UI */
export interface SceneConstants {
  rt60: BandValues;
  rigging: RiggingReport[];
}
