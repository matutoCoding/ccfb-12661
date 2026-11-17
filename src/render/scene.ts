import type {
  AnalysisSnapshot, Layout, Library, Project, ReflectionPath, Vec3, Venue
} from '../core/types';
import {
  VS_BASIC, FS_FLAT, VS_HEAT, FS_HEAT, arrowLines, compileShader, createProgram, cubeLines,
  makeMesh, sphereLines
} from './gl-utils';
import type { GLMesh } from './gl-utils';
import {
  OrbitCamera, mat4FromEuler, mat4Multiply, mat4Scale, mat4Translate, raySphere, screenToRay, viewProj
} from './mat4';
import { arrayGeometry } from '../core/array';
import { boxFacePolygons, surfacePolygon } from '../core/math/geometry';
import { eulerToDir, pointInPolygon as pointInPolygon2D } from '../core/math/vec3';

export interface ScenePick {
  kind: 'speaker' | 'mic' | 'array' | 'seat';
  id: string;
  point: Vec3;
}

export interface SceneOptions {
  showHeatmap: boolean;
  showReflections: boolean;
  showEcho: boolean;
  showCoverage: boolean;
  heatmapRange: [number, number];
}

export class SceneRenderer {
  private gl: WebGL2RenderingContext;
  private progFlat: WebGLProgram;
  private progHeat: WebGLProgram;
  private meshes = new Map<string, GLMesh>();
  camera: OrbitCamera = { target: [12, 15, 3], distance: 42, yaw: 35, pitch: 38 };
  private canvas: HTMLCanvasElement;
  private pickables: { kind: ScenePick['kind']; id: string; center: Vec3; radius: number }[] = [];
  private zones: import('../core/types').AudienceZone[] = [];
  private onPick?: (p: ScenePick | null) => void;
  private dragMode: 'orbit' | 'pan' | null = null;
  private lastMouse = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, onPick?: (p: ScenePick | null) => void) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.onPick = onPick;
    this.progFlat = createProgram(gl, VS_BASIC, FS_FLAT);
    this.progHeat = createProgram(gl, VS_HEAT, FS_HEAT);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.07, 0.09, 0.12, 1);
    this.bindControls();
  }

  private bindControls(): void {
    const c = this.canvas;
    c.addEventListener('mousedown', (e) => {
      this.dragMode = e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('mouseup', () => { this.dragMode = null; });
    c.addEventListener('mousemove', (e) => {
      if (!this.dragMode) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      if (this.dragMode === 'orbit') {
        this.camera.yaw += dx * 0.4;
        this.camera.pitch = Math.min(85, Math.max(5, this.camera.pitch + dy * 0.3));
      } else {
        const s = this.camera.distance * 0.002;
        this.camera.target[0] -= dx * s;
        this.camera.target[1] -= dy * s;
      }
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.camera.distance = Math.min(150, Math.max(5, this.camera.distance * (1 + e.deltaY * 0.001)));
    }, { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('click', (e) => {
      const rect = c.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      const { origin, dir } = screenToRay(ndcX, ndcY, this.camera);
      let best: ScenePick | null = null;
      let bestT = Infinity;
      for (const p of this.pickables) {
        const t = raySphere(origin, dir, [p.center.x, p.center.y, p.center.z], p.radius);
        if (t !== null && t < bestT) {
          bestT = t;
          best = { kind: p.kind, id: p.id, point: { x: origin[0] + dir[0] * t, y: origin[1] + dir[1] * t, z: origin[2] + dir[2] * t } };
        }
      }
      // 未命中设备时，回退到地面（z=0）射线求交；落在观众区内则作为座位探测
      if (!best && Math.abs(dir[2]) > 1e-4) {
        const t = -origin[2] / dir[2];
        if (t > 0) {
          const point = { x: origin[0] + dir[0] * t, y: origin[1] + dir[1] * t, z: 0 };
          const zone = this.zones.find((z) => pointInPolygon2D({ x: point.x, y: point.y }, z.polygon));
          if (zone) best = { kind: 'seat', id: `seat@${point.x.toFixed(2)},${point.y.toFixed(2)}`, point: { x: point.x, y: point.y, z: zone.earHeight } };
        }
      }
      this.onPick?.(best);
    });
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  }

  private mesh(key: string, build: () => GLMesh): GLMesh {
    let m = this.meshes.get(key);
    if (!m) { m = build(); this.meshes.set(key, m); }
    return m;
  }

  private drawLines(m: GLMesh, color: [number, number, number, number], model?: Float32Array): void {
    const gl = this.gl;
    gl.useProgram(this.progFlat);
    const mvp = model
      ? mat4Multiply(viewProj(this.camera, this.canvas.width / this.canvas.height), model)
      : viewProj(this.camera, this.canvas.width / this.canvas.height);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.progFlat, 'uMVP'), false, mvp);
    gl.uniform4fv(gl.getUniformLocation(this.progFlat, 'uColor'), color);
    gl.bindVertexArray(m.vao);
    gl.drawArrays(gl.LINES, 0, m.vertexCount);
  }

  private drawTris(m: GLMesh, color: [number, number, number, number], model?: Float32Array): void {
    const gl = this.gl;
    gl.useProgram(this.progFlat);
    const mvp = model
      ? mat4Multiply(viewProj(this.camera, this.canvas.width / this.canvas.height), model)
      : viewProj(this.camera, this.canvas.width / this.canvas.height);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.progFlat, 'uMVP'), false, mvp);
    gl.uniform4fv(gl.getUniformLocation(this.progFlat, 'uColor'), color);
    gl.bindVertexArray(m.vao);
    if (m.mode === gl.TRIANGLES) gl.drawArrays(gl.TRIANGLES, 0, m.vertexCount);
    else gl.drawElements(gl.TRIANGLES, m.vertexCount, gl.UNSIGNED_SHORT, 0);
  }

  private polygonMesh(points: Vec3[]): GLMesh {
    const verts: number[] = [];
    for (let i = 1; i < points.length - 1; i++) {
      verts.push(...Object.values(points[0]), ...Object.values(points[i]), ...Object.values(points[i + 1]));
    }
    return makeMesh(this.gl, new Float32Array(verts), this.gl.TRIANGLES);
  }

  private polygonLineMesh(points: Vec3[]): GLMesh {
    const verts: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    return makeMesh(this.gl, new Float32Array(verts), this.gl.LINES);
  }

  render(
    project: Project,
    layout: Layout | null,
    library: Library,
    snapshot: AnalysisSnapshot | null,
    opts: SceneOptions
  ): void {
    const gl = this.gl;
    this.resize();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.pickables = [];
    const venue = project.venue;
    this.zones = venue.audienceZones;
    // 房间盒体线框
    const room = this.mesh(`room:${venue.width}x${venue.length}x${venue.height}`, () =>
      makeMesh(gl, cubeLines(venue.width, venue.length, venue.height), gl.LINES)
    );
    this.drawLines(room, [0.55, 0.65, 0.75, 0.9]);

    // 墙面（半透明填充，区分材料色调）
    const faces = boxFacePolygons(venue);
    for (const s of venue.surfaces) {
      const poly = s.type === 'polygon' && s.polygon ? s.polygon : faces[s.boxFace!];
      const mat = library.materials.find((m) => m.id === s.materialId);
      const alpha = mat ? 0.05 + Math.min(mat.absorption[4], 0.9) * 0.18 : 0.08;
      const key = `surf:${s.id}:${poly.length}:${s.materialId}`;
      this.drawTris(this.mesh(key, () => this.polygonMesh(poly)), [0.5, 0.6, 0.7, alpha]);
      this.drawLines(this.mesh(`${key}-l`, () => this.polygonLineMesh(poly)), [0.4, 0.5, 0.6, 0.5]);
    }

    // 观众区
    for (const zone of venue.audienceZones) {
      const pts = zone.polygon.map((p) => ({ x: p.x, y: p.y, z: 0.02 }));
      const key = `zone:${zone.id}:${pts.length}`;
      this.drawTris(this.mesh(key, () => this.polygonMesh(pts)), [0.2, 0.55, 0.85, 0.22]);
      this.drawLines(this.mesh(`${key}-l`, () => this.polygonLineMesh(pts)), [0.35, 0.7, 1, 0.9]);
    }

    // 热力图
    if (opts.showHeatmap && snapshot) this.drawHeatmap(snapshot, opts.heatmapRange);
    if (opts.showEcho && snapshot) this.drawEcho(snapshot);

    // 音箱/阵列/话筒
    if (layout) {
      this.drawLayout(layout, library, opts.showCoverage);
      this.drawReflections(snapshot, opts.showReflections);
    }
    gl.bindVertexArray(null);
  }

  private drawHeatmap(snapshot: AnalysisSnapshot, range: [number, number]): void {
    const gl = this.gl;
    const grid = snapshot.splGrid;
    const verts: number[] = [];
    const values: number[] = [];
    const idx: number[] = [];
    for (let iy = 0; iy < grid.ny; iy++) {
      for (let ix = 0; ix < grid.nx; ix++) {
        const x = grid.min.x + ((grid.max.x - grid.min.x) * ix) / Math.max(grid.nx - 1, 1);
        const y = grid.min.y + ((grid.max.y - grid.min.y) * iy) / Math.max(grid.ny - 1, 1);
        const dba = grid.dba[iy * grid.nx + ix];
        if (dba < -900) continue;
        verts.push(x, y, 0.05);
        values.push(dba);
      }
    }
    if (verts.length / 3 < 4) return;
    // 点精灵替代栅格面片：用 gl.POINTS + 大点尺寸
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const interleaved = new Float32Array(verts.length / 3 * 4);
    for (let i = 0; i < verts.length / 3; i++) {
      interleaved[i * 4] = verts[i * 3];
      interleaved[i * 4 + 1] = verts[i * 3 + 1];
      interleaved[i * 4 + 2] = verts[i * 3 + 2];
      interleaved[i * 4 + 3] = values[i];
    }
    gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
    gl.useProgram(this.progHeat);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.progHeat, 'uMVP'), false, viewProj(this.camera, this.canvas.width / this.canvas.height));
    gl.uniform1f(gl.getUniformLocation(this.progHeat, 'uMin'), range[0]);
    gl.uniform1f(gl.getUniformLocation(this.progHeat, 'uMax'), range[1]);
    gl.drawArrays(gl.POINTS, 0, interleaved.length / 4);
    gl.bindVertexArray(null);
    gl.deleteVertexArray(vao);
    gl.deleteBuffer(vbo);
    void idx;
  }

  private drawEcho(snapshot: AnalysisSnapshot): void {
    for (const p of snapshot.echoMap.points) {
      const color: [number, number, number, number] = p.echo ? [1, 0.3, 0.2, 0.95] : [0.25, 0.85, 0.45, 0.7];
      const key = `echo:${p.position.x.toFixed(1)}:${p.position.y.toFixed(1)}`;
      const m = this.mesh(key, () => makeMesh(this.gl, sphereLines(0.28, 6), this.gl.LINES));
      this.drawLines(m, color, mat4Translate(p.position.x, p.position.y, p.position.z));
    }
  }

  private drawLayout(layout: Layout, library: Library, showCoverage: boolean): void {
    const gl = this.gl;
    const spkSphere = this.mesh('spk-sphere', () => makeMesh(gl, sphereLines(0.32, 8), gl.LINES));
    const micSphere = this.mesh('mic-sphere', () => makeMesh(gl, sphereLines(0.18, 8), gl.LINES));
    const arrow = this.mesh('arrow', () => makeMesh(gl, arrowLines(0.9), gl.LINES));

    for (const sp of layout.speakers) {
      const model = mat4Multiply(
        mat4Translate(sp.position.x, sp.position.y, sp.position.z),
        mat4FromEuler(sp.orientation.yaw, sp.orientation.pitch, sp.orientation.roll)
      );
      this.drawLines(spkSphere, [1, 0.75, 0.2, 1], model);
      this.drawLines(arrow, [1, 0.6, 0.15, 1], model);
      this.pickables.push({ kind: 'speaker', id: sp.id, center: sp.position, radius: 0.7 });
      if (showCoverage) this.drawCoverageCone(sp.modelId, sp, library);
    }

    // 线阵列：箱体 + 吊挂线
    for (const arr of layout.arrays) {
      const model = library.speakers.find((m) => m.id === arr.elementModelId);
      if (!model) continue;
      const geo = arrayGeometry(arr, model);
      const box = this.mesh(`arrbox:${model.id}`, () => {
        const { w, h, d } = model.dimensions;
        return makeMesh(gl, cubeLines(w, d, h), gl.LINES);
      });
      geo.positions.forEach((pos, i) => {
        const m = mat4Multiply(
          mat4Translate(pos.x, pos.y, pos.z),
          mat4FromEuler(arr.yaw, geo.pitches[i], 0)
        );
        this.drawLines(box, [0.4, 0.9, 1, 1], m);
        this.pickables.push({ kind: 'array', id: `${arr.id}@${i}`, center: pos, radius: 0.6 });
      });
      // 框架到顶部的吊挂钢缆
      const cable: number[] = [];
      for (let k = 0; k < Math.max(arr.pickPointCount, 1); k++) {
        const off = arr.pickPointCount === 1 ? 0 : (k - 0.5) * 0.6;
        cable.push(arr.framePosition.x + off, arr.framePosition.y, arr.framePosition.z + 0.02);
        cable.push(arr.framePosition.x + off, arr.framePosition.y, arr.framePosition.z + 1.2);
      }
      this.drawLines(makeMesh(gl, new Float32Array(cable), gl.LINES), [0.8, 0.8, 0.85, 0.9]);
    }

    for (const mic of layout.mics) {
      const model = mat4Multiply(
        mat4Translate(mic.position.x, mic.position.y, mic.position.z),
        mat4FromEuler(mic.orientation.yaw, mic.orientation.pitch, mic.orientation.roll)
      );
      this.drawLines(micSphere, [1, 0.35, 0.4, 1], model);
      this.pickables.push({ kind: 'mic', id: mic.id, center: mic.position, radius: 0.5 });
    }
  }

  private drawCoverageCone(modelId: string, sp: { position: Vec3; orientation: import('../core/types').Euler }, library: Library): void {
    const model = library.speakers.find((m) => m.id === modelId);
    if (!model) return;
    const dir = eulerToDir(sp.orientation);
    const reach = 12;
    const halfAngle = (Math.max(model.coverageH, model.coverageV) / 2) * (Math.PI / 180);
    const r = Math.tan(halfAngle) * reach;
    const end = {
      x: sp.position.x + dir.x * reach,
      y: sp.position.y + dir.y * reach,
      z: sp.position.z + dir.z * reach
    };
    const verts: number[] = [];
    for (let i = 0; i < 12; i++) {
      const a1 = (2 * Math.PI * i) / 12;
      const a2 = (2 * Math.PI * (i + 1)) / 12;
      // 简化：在垂直于主轴平面取两个圆周点
      const ref = Math.abs(dir.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
      const u = {
        x: dir.y * ref.z - dir.z * ref.y,
        y: dir.z * ref.x - dir.x * ref.z,
        z: dir.x * ref.y - dir.y * ref.x
      };
      const v = {
        x: u.y * dir.z - u.z * dir.y,
        y: u.z * dir.x - u.x * dir.z,
        z: u.x * dir.y - u.y * dir.x
      };
      const p1 = {
        x: end.x + (u.x * Math.cos(a1) + v.x * Math.sin(a1)) * r,
        y: end.y + (u.y * Math.cos(a1) + v.y * Math.sin(a1)) * r,
        z: end.z + (u.z * Math.cos(a1) + v.z * Math.sin(a1)) * r
      };
      const p2 = {
        x: end.x + (u.x * Math.cos(a2) + v.x * Math.sin(a2)) * r,
        y: end.y + (u.y * Math.cos(a2) + v.y * Math.sin(a2)) * r,
        z: end.z + (u.z * Math.cos(a2) + v.z * Math.sin(a2)) * r
      };
      verts.push(sp.position.x, sp.position.y, sp.position.z, p1.x, p1.y, p1.z);
      verts.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    }
    this.drawLines(makeMesh(this.gl, new Float32Array(verts), this.gl.LINES), [1, 0.7, 0.2, 0.35]);
  }

  private drawReflections(snapshot: AnalysisSnapshot | null, show: boolean): void {
    if (!show || !snapshot) return;
    for (const path of snapshot.reflections) {
      const color: [number, number, number, number] = path.isEcho
        ? [1, 0.3, 0.2, 0.95]
        : path.order === 1 ? [0.4, 0.85, 1, 0.8] : [0.5, 0.6, 1, 0.6];
      const verts: number[] = [];
      for (let i = 0; i < path.points.length - 1; i++) {
        verts.push(...Object.values(path.points[i]), ...Object.values(path.points[i + 1]));
      }
      this.drawLines(makeMesh(this.gl, new Float32Array(verts), this.gl.LINES), color);
    }
  }

  /** 聚焦到房间 */
  frameVenue(venue: Venue): void {
    this.camera.target = [venue.width / 2, venue.length / 2, venue.height * 0.3];
    this.camera.distance = Math.max(venue.width, venue.length) * 1.4;
  }
}
