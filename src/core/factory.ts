import {
  defaultDsp,
  newId,
  type Layout,
  type Project,
  type Venue,
} from './types';
import { defaultMaterials } from './defaults';
import { defaultSurfaces } from './roomAcoustics';
import type { AppDatabase } from '../state/storage';
import type { SceneSnapshot } from '../workers/protocol';

/** 新建默认场地（20×15×8m 剧场，含一个矩形观众区） */
export function createVenue(name: string): Venue {
  const mats = defaultMaterials();
  const floor = mats.find((m) => m.name.includes('观众席（满座）'))!;
  const wall = mats.find((m) => m.name.includes('混凝土'))!;
  const ceil = mats.find((m) => m.name.includes('石膏板'))!;
  const now = Date.now();
  return {
    id: newId('venue'),
    name,
    room: {
      length: 20,
      width: 15,
      height: 8,
      surfaces: defaultSurfaces(floor.id, wall.id, ceil.id),
    },
    audienceAreas: [
      {
        id: newId('area'),
        name: '池座',
        polygon: [
          { x: 4, y: 2 },
          { x: 18, y: 2 },
          { x: 18, y: 13 },
          { x: 4, y: 13 },
        ],
        earHeight: 1.2,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

/** 新建空白布置方案 */
export function createLayout(venueId: string, name: string): Layout {
  const now = Date.now();
  return {
    id: newId('lay'),
    venueId,
    name,
    speakers: [],
    lineArrays: [],
    microphones: [],
    signalNodes: [],
    signalEdges: [],
    levelChains: [],
    measurePoints: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createProject(name: string, description = ''): Project {
  const now = Date.now();
  return {
    id: newId('proj'),
    name,
    description,
    venueId: null,
    layoutIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** 组装 Worker 计算所需的不可变场景快照 */
export function buildSnapshot(
  db: AppDatabase,
  venue: Venue,
  layout: Layout,
): SceneSnapshot {
  return {
    venue,
    layout,
    room: venue.room,
    materials: Object.values(db.materials),
    speakerModels: Object.values(db.speakerModels),
  };
}

/** 观众区耳高平面上的网格座位点（间距米） */
export function audienceSeatGrid(venue: Venue, spacing = 1.5): import('./types').Vec3[] {
  const out: import('./types').Vec3[] = [];
  for (const area of venue.audienceAreas) {
    const xs = area.polygon.map((p) => p.x);
    const ys = area.polygon.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    for (let x = minX + spacing / 2; x <= maxX; x += spacing) {
      for (let y = minY + spacing / 2; y <= maxY; y += spacing) {
        if (pointInPoly({ x, y }, area.polygon)) {
          out.push({ x, y, z: area.earHeight });
        }
      }
    }
  }
  return out;
}

function pointInPoly(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const hit = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/** 给方案追加一条默认电平链路（调音台→处理器→功放） */
export function defaultLevelChain(targetSpeakerId: string, name: string) {
  return {
    id: newId('chain'),
    name,
    sourceLevelDbu: 4,
    stages: [
      { id: newId('st'), name: '调音台', kind: 'mixer' as const, maxOutputDbu: 22, gainDb: 0 },
      {
        id: newId('st'),
        name: '数字处理器',
        kind: 'processor' as const,
        maxOutputDbu: 20,
        gainDb: 0,
        dsp: defaultDsp(),
      },
      { id: newId('st'), name: '功放', kind: 'amp' as const, maxOutputDbu: 18, gainDb: 0 },
    ],
    targetSpeakerId,
  };
}
