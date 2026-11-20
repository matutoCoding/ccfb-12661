import type {
  Layout,
  Material,
  Room,
  SpeakerModel,
  Vec3,
  Venue,
} from '../core/types';
import { roomFaces } from '../core/roomAcoustics';
import { lineArrayElementsWorld } from '../core/speakers';
import { OrbitCamera } from './mat4';
import { SceneRenderer, type BoxSpec, type HeatGrid, type LineSegment, type PointSpec } from './SceneRenderer';
import type { ReflectionSeatOutput } from '../workers/protocol';

export interface View3DOptions {
  showRoom?: boolean;
  showAudience?: boolean;
  showSpeakers?: boolean;
  showMicrophones?: boolean;
  heat?: HeatGrid | null;
  reflections?: ReflectionSeatOutput[];
  reflectionOrder?: 1 | 2;
  onPick?: (kind: 'speaker' | 'lineArray' | 'mic' | 'seat', id: string, point?: Vec3) => void;
}

const COLORS = {
  room: [0.65, 0.72, 0.82] as [number, number, number],
  audience: [0.3, 0.8, 0.55] as [number, number, number],
  speaker: [0.95, 0.6, 0.2] as [number, number, number],
  lineArray: [0.95, 0.35, 0.3] as [number, number, number],
  mic: [0.4, 0.7, 1] as [number, number, number],
  reflect1: [1, 0.85, 0.3] as [number, number, number],
  reflect2: [1, 0.45, 0.2] as [number, number, number],
  echo: [1, 0.15, 0.15] as [number, number, number],
  axis: [0.5, 0.5, 0.55] as [number, number, number],
};

/** 可复用的 WebGL2 三维视图，负责相机交互与场景图拼装 */
export class View3D {
  readonly canvas: HTMLCanvasElement;
  readonly camera = new OrbitCamera();
  private renderer: SceneRenderer;
  private opts: View3DOptions = {};
  private venue: Venue | null = null;
  private layout: Layout | null = null;
  private models = new Map<string, SpeakerModel>();
  private raf = 0;
  private pickables: Array<{ kind: 'speaker' | 'lineArray' | 'mic'; id: string; pos: Vec3; radius: number }> = [];
  private seatPickables: Array<{ id: string; pos: Vec3 }> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new SceneRenderer(canvas);
    this.bindControls();
    this.loop();
  }

  setData(venue: Venue, layout: Layout, models: SpeakerModel[], _materials: Material[]): void {
    this.venue = venue;
    this.layout = layout;
    this.models = new Map(models.map((m) => [m.id, m]));
    this.camera.target = { x: venue.room.length / 2, y: venue.room.width / 2, z: 1.5 };
    this.camera.distance = Math.max(venue.room.length, venue.room.width) * 1.3;
  }

  setOptions(opts: View3DOptions): void {
    this.opts = opts;
  }

  private bindControls(): void {
    const c = this.canvas;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    c.addEventListener('pointerdown', (e) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.camera.azimuth -= dx * 0.4;
      this.camera.elevation = Math.max(5, Math.min(85, this.camera.elevation + dy * 0.3));
    });
    c.addEventListener('pointerup', (e) => {
      const moved = Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
      dragging = false;
      if (moved < 4) this.handleClick(e);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camera.distance = Math.max(3, Math.min(120, this.camera.distance * (1 + e.deltaY * 0.001)));
    }, { passive: false });
  }

  private handleClick(e: PointerEvent): void {
    if (!this.opts.onPick) return;
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    // 射线求交：把相机射线与拾取球做最近距离判定
    const eye = this.camera.eye();
    const fwd = normalize(sub(this.camera.target, eye));
    const right = normalize(cross(fwd, { x: 0, y: 0, z: 1 }));
    const up = cross(right, fwd);
    const tan = Math.tan((25 * Math.PI) / 180);
    const rayDir = normalize({
      x: fwd.x + right.x * nx * tan * (rect.width / rect.height) + up.x * ny * tan,
      y: fwd.y + right.y * nx * tan * (rect.width / rect.height) + up.y * ny * tan,
      z: fwd.z + right.z * nx * tan * (rect.width / rect.height) + up.z * ny * tan,
    });
    let best: { kind: 'speaker' | 'lineArray' | 'mic'; id: string; t: number } | null = null;
    for (const pk of this.pickables) {
      const t = raySphere(eye, rayDir, pk.pos, pk.radius);
      if (t !== null && (!best || t < best.t)) best = { kind: pk.kind, id: pk.id, t };
    }
    if (best) {
      this.opts.onPick(best.kind, best.id);
      return;
    }
    // 座位拾取（热力/反射模式下）
    let bestSeat: { id: string; pos: Vec3; t: number } | null = null;
    for (const sp of this.seatPickables) {
      const t = raySphere(eye, rayDir, sp.pos, 0.4);
      if (t !== null && (!bestSeat || t < bestSeat.t)) bestSeat = { ...sp, t };
    }
    if (bestSeat) this.opts.onPick('seat', bestSeat.id, bestSeat.pos);
  }

  private loop = (): void => {
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(): void {
    if (!this.venue || !this.layout) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const boxes: BoxSpec[] = [];
    const lines: LineSegment[] = [];
    const points: PointSpec[] = [];
    this.pickables = [];

    if (this.opts.showRoom !== false) this.addRoom(this.venue.room, boxes, lines);
    if (this.opts.showAudience !== false) this.addAudience(this.venue, lines, points);
    if (this.opts.showSpeakers !== false) this.addSpeakers(boxes, lines, points);
    if (this.opts.showMicrophones !== false) this.addMics(points);
    this.addReflections(lines, points);

    this.renderer.render(this.camera, {
      boxes,
      lines,
      points,
      heat: this.opts.heat ?? null,
      width: w,
      height: h,
    });
  }

  private addRoom(room: Room, boxes: BoxSpec[], lines: LineSegment[]): void {
    const faces = roomFaces(room);
    for (const f of faces) {
      boxes.push({ min: f.min, max: f.max, color: COLORS.room, alpha: 0.1 });
    }
    // 12 条棱
    const { length: L, width: W, height: H } = room;
    const corners: Vec3[] = [
      { x: 0, y: 0, z: 0 }, { x: L, y: 0, z: 0 }, { x: L, y: W, z: 0 }, { x: 0, y: W, z: 0 },
      { x: 0, y: 0, z: H }, { x: L, y: 0, z: H }, { x: L, y: W, z: H }, { x: 0, y: W, z: H },
    ];
    const edges = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    for (const [i, j] of edges) {
      lines.push({ a: corners[i], b: corners[j], color: COLORS.room });
    }
  }

  private addAudience(venue: Venue, lines: LineSegment[], points: PointSpec[]): void {
    this.seatPickables = [];
    for (const area of venue.audienceAreas) {
      const poly = area.polygon.map((p) => ({ x: p.x, y: p.y, z: area.earHeight }));
      for (let i = 0; i < poly.length; i++) {
        lines.push({ a: poly[i], b: poly[(i + 1) % poly.length], color: COLORS.audience });
      }
      poly.forEach((p, i) => {
        points.push({ p, color: COLORS.audience, size: 4 });
        this.seatPickables.push({ id: `${area.id}:${i}`, pos: p });
      });
    }
  }

  private addSpeakers(boxes: BoxSpec[], lines: LineSegment[], points: PointSpec[]): void {
    if (!this.layout) return;
    for (const s of this.layout.speakers) {
      const m = this.models.get(s.speakerModelId);
      if (!m) continue;
      const h = m.size.h / 2;
      const d = m.size.d / 2;
      boxes.push({
        min: { x: s.position.x - d, y: s.position.y - h, z: s.position.z - h },
        max: { x: s.position.x + d, y: s.position.y + h, z: s.position.z + h },
        color: COLORS.speaker,
      });
      // 朝向指示线
      const az = (s.azimuth * Math.PI) / 180;
      const ti = (s.tilt * Math.PI) / 180;
      const dir: Vec3 = {
        x: Math.cos(ti) * Math.cos(az),
        y: Math.cos(ti) * Math.sin(az),
        z: Math.sin(ti),
      };
      lines.push({
        a: s.position,
        b: { x: s.position.x + dir.x * 1.2, y: s.position.y + dir.y * 1.2, z: s.position.z + dir.z * 1.2 },
        color: COLORS.speaker,
      });
      points.push({ p: s.position, color: COLORS.speaker });
      this.pickables.push({ kind: 'speaker', id: s.id, pos: s.position, radius: 0.6 });
    }
    for (const a of this.layout.lineArrays) {
      const m = this.models.get(a.speakerModelId);
      if (!m) continue;
      const elements = lineArrayElementsWorld(a, m);
      for (const el of elements) {
        const h = m.size.h / 2;
        const w = m.size.w / 2;
        const d = m.size.d / 2;
        boxes.push({
          min: { x: el.position.x - d, y: el.position.y - w, z: el.position.z - h },
          max: { x: el.position.x + d, y: el.position.y + w, z: el.position.z + h },
          color: COLORS.lineArray,
        });
        this.pickables.push({ kind: 'lineArray', id: a.id, pos: el.position, radius: 0.5 });
      }
      points.push({ p: a.hangPoint, color: COLORS.lineArray });
      // 吊挂钢缆
      lines.push({
        a: { x: a.hangPoint.x, y: a.hangPoint.y, z: a.hangPoint.z + 1 },
        b: elements[0].position,
        color: COLORS.lineArray,
      });
    }
  }

  private addMics(points: PointSpec[]): void {
    if (!this.layout) return;
    for (const mic of this.layout.microphones) {
      points.push({ p: mic.position, color: COLORS.mic });
      this.pickables.push({ kind: 'mic', id: mic.id, pos: mic.position, radius: 0.5 });
    }
  }

  private addReflections(lines: LineSegment[], points: PointSpec[]): void {
    if (!this.opts.reflections) return;
    const order = this.opts.reflectionOrder ?? 1;
    const echoKeys = new Set<string>();
    for (const seat of this.opts.reflections) {
      for (const risk of seat.echoes.risks) {
        echoKeys.add(risk.path.faces.map((f) => f.id).join('>') + risk.path.delayMs.toFixed(1));
      }
      for (const path of seat.paths) {
        if (path.order > order) continue;
        const isEcho = seat.echoes.risks.some((r) => r.path === path);
        const color = isEcho ? COLORS.echo : path.order === 1 ? COLORS.reflect1 : COLORS.reflect2;
        let prev: Vec3 | null = null;
        for (const pt of path.reflectionPoints) {
          if (prev) lines.push({ a: prev, b: pt, color });
          prev = pt;
          points.push({ p: pt, color });
        }
      }
    }
    void echoKeys;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.renderer.dispose();
  }
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

/** 射线与球求交，返回沿射线距离 t，不相交返回 null */
function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number | null {
  const oc = sub(o, c);
  const b = oc.x * d.x + oc.y * d.y + oc.z * d.z;
  const cc = oc.x * oc.x + oc.y * oc.y + oc.z * oc.z - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}
