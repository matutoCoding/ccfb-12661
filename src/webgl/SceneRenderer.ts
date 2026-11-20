import type { Vec3 } from '../core/types';
import { mat4Multiply, mat4Perspective, type Mat4, OrbitCamera } from './mat4';

const VERT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
uniform mat4 uMVP;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec3 vColor;
uniform float uAlpha;
out vec4 outColor;
void main() { outColor = vec4(vColor, uAlpha); }`;

export interface LineSegment {
  a: Vec3;
  b: Vec3;
  color: [number, number, number];
}

export interface BoxSpec {
  min: Vec3;
  max: Vec3;
  color: [number, number, number];
  alpha?: number;
}

export interface PointSpec {
  p: Vec3;
  color: [number, number, number];
  size?: number;
}

export interface HeatGrid {
  positions: Vec3[];
  /** 归一化 0~1 的值 */
  values: number[];
  cellMeters: number;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('Shader 编译失败: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

/** SPL dB → 蓝-青-绿-黄-红 热力色 */
export function heatColor(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  const stops: Array<[number, [number, number, number]]> = [
    [0, [0.15, 0.25, 0.85]],
    [0.25, [0.1, 0.75, 0.9]],
    [0.5, [0.2, 0.85, 0.35]],
    [0.75, [0.95, 0.85, 0.2]],
    [1, [0.95, 0.2, 0.15]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (x - t0) / (t1 - t0);
      return [
        c0[0] + (c1[0] - c0[0]) * k,
        c0[1] + (c1[1] - c0[1]) * k,
        c0[2] + (c1[2] - c0[2]) * k,
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * WebGL2 场景渲染器。每帧重建顶点缓冲（场景规模在万级顶点内，
 * 配合 Worker 计算足以保持流畅），避免维护复杂的增量 VAO。
 */
export class SceneRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer;
  private uMVP: WebGLUniformLocation;
  private uAlpha: WebGLUniformLocation;
  private vertexCount = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Program 链接失败: ' + gl.getProgramInfoLog(prog));
    }
    this.program = prog;
    this.vao = gl.createVertexArray()!;
    this.vbo = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    this.uMVP = gl.getUniformLocation(prog, 'uMVP')!;
    this.uAlpha = gl.getUniformLocation(prog, 'uAlpha')!;
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.07, 0.08, 0.1, 1);
  }

  private upload(vertices: Float32Array): void {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    this.vertexCount = vertices.length / 6;
  }

  render(camera: OrbitCamera, opts: {
    boxes: BoxSpec[];
    lines: LineSegment[];
    points: PointSpec[];
    heat?: HeatGrid | null;
    width: number;
    height: number;
  }): void {
    const gl = this.gl;
    gl.viewport(0, 0, opts.width, opts.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    const proj = mat4Perspective((50 * Math.PI) / 180, opts.width / opts.height, 0.05, 500);
    const mvp: Mat4 = mat4Multiply(proj, camera.view());
    gl.uniformMatrix4fv(this.uMVP, false, mvp);

    // 1) 半透明盒体（墙面/音箱）
    if (opts.boxes.length) {
      const verts = new Float32Array(opts.boxes.length * 36 * 6);
      let o = 0;
      for (const box of opts.boxes) {
        o = writeBox(verts, o, box);
      }
      this.upload(verts);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(this.uAlpha, 0.16);
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
      gl.disable(gl.BLEND);
    }

    // 2) 热力网格（地面四边形）
    if (opts.heat && opts.heat.positions.length) {
      const h = opts.heat;
      const half = h.cellMeters / 2;
      const verts = new Float32Array(h.positions.length * 6 * 6);
      let o = 0;
      for (let i = 0; i < h.positions.length; i++) {
        const p = h.positions[i];
        const c = heatColor(h.values[i]);
        const corners = [
          { x: p.x - half, y: p.y - half, z: p.z + 0.02 },
          { x: p.x + half, y: p.y - half, z: p.z + 0.02 },
          { x: p.x + half, y: p.y + half, z: p.z + 0.02 },
          { x: p.x - half, y: p.y + half, z: p.z + 0.02 },
        ];
        o = writeQuad(verts, o, corners, c);
      }
      this.upload(verts);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(this.uAlpha, 0.55);
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
      gl.disable(gl.BLEND);
    }

    // 3) 线段（房间边框、声线、信号示意）
    if (opts.lines.length) {
      const verts = new Float32Array(opts.lines.length * 2 * 6);
      let o = 0;
      for (const l of opts.lines) {
        o = writeVertex(verts, o, l.a, l.color);
        o = writeVertex(verts, o, l.b, l.color);
      }
      this.upload(verts);
      gl.uniform1f(this.uAlpha, 1);
      gl.drawArrays(gl.LINES, 0, this.vertexCount);
    }

    // 4) 点（话筒/测点，用小十字线表达，兼容线框管线）
    if (opts.points.length) {
      const s = 0.18;
      const verts = new Float32Array(opts.points.length * 3 * 2 * 6);
      let o = 0;
      for (const pt of opts.points) {
        const c = pt.color;
        o = writeVertex(verts, o, { x: pt.p.x - s, y: pt.p.y, z: pt.p.z }, c);
        o = writeVertex(verts, o, { x: pt.p.x + s, y: pt.p.y, z: pt.p.z }, c);
        o = writeVertex(verts, o, { x: pt.p.x, y: pt.p.y - s, z: pt.p.z }, c);
        o = writeVertex(verts, o, { x: pt.p.x, y: pt.p.y + s, z: pt.p.z }, c);
        o = writeVertex(verts, o, { x: pt.p.x, y: pt.p.y, z: pt.p.z - s }, c);
        o = writeVertex(verts, o, { x: pt.p.x, y: pt.p.y, z: pt.p.z + s }, c);
      }
      this.upload(verts);
      gl.uniform1f(this.uAlpha, 1);
      gl.drawArrays(gl.LINES, 0, this.vertexCount);
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }
}

function writeVertex(
  buf: Float32Array,
  o: number,
  p: Vec3,
  c: [number, number, number],
): number {
  buf[o++] = p.x;
  buf[o++] = p.y;
  buf[o++] = p.z;
  buf[o++] = c[0];
  buf[o++] = c[1];
  buf[o++] = c[2];
  return o;
}

function writeQuad(
  buf: Float32Array,
  o: number,
  corners: Vec3[],
  c: [number, number, number],
): number {
  const idx = [0, 1, 2, 0, 2, 3];
  for (const i of idx) o = writeVertex(buf, o, corners[i], c);
  return o;
}

function writeBox(buf: Float32Array, start: number, box: BoxSpec): number {
  const { min, max, color } = box;
  const c: [number, number, number] = color;
  const p = [
    { x: min.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: min.z },
    { x: max.x, y: max.y, z: min.z },
    { x: min.x, y: max.y, z: min.z },
    { x: min.x, y: min.y, z: max.z },
    { x: max.x, y: min.y, z: max.z },
    { x: max.x, y: max.y, z: max.z },
    { x: min.x, y: max.y, z: max.z },
  ];
  const faces = [
    [0, 1, 2, 0, 2, 3],
    [4, 6, 5, 4, 7, 6],
    [0, 4, 5, 0, 5, 1],
    [2, 6, 7, 2, 7, 3],
    [1, 5, 6, 1, 6, 2],
    [0, 3, 7, 0, 7, 4],
  ];
  let o = start;
  for (const face of faces) {
    for (const i of face) o = writeVertex(buf, o, p[i], c);
  }
  return o;
}
