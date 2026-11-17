// 极简 WebGL2 封装：着色器编译、网格绘制、相机、颜色映射
export interface GLMesh {
  vao: WebGLVertexArrayObject;
  vertexCount: number;
  mode: number;
}

export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('着色器编译失败: ' + log);
  }
  return shader;
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('程序链接失败: ' + gl.getProgramInfoLog(program));
  }
  return program;
}

export function makeMesh(gl: WebGL2RenderingContext, vertices: Float32Array, mode: number): GLMesh {
  const vao = gl.createVertexArray()!;
  const vbo = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return { vao, vertexCount: vertices.length / 3, mode };
}

export function makeIndexedMesh(gl: WebGL2RenderingContext, vertices: Float32Array, indices: Uint16Array): GLMesh {
  const vao = gl.createVertexArray()!;
  const vbo = gl.createBuffer()!;
  const ebo = gl.createBuffer()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, vertexCount: indices.length, mode: gl.TRIANGLES };
}

/** 立方体线框 8 顶点 × 线段 */
export function cubeLines(w: number, l: number, h: number): Float32Array {
  const c = [
    [0, 0, 0], [w, 0, 0], [w, l, 0], [0, l, 0],
    [0, 0, h], [w, 0, h], [w, l, h], [0, l, h]
  ];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  const out: number[] = [];
  for (const [a, b] of edges) out.push(...c[a], ...c[b]);
  return new Float32Array(out);
}

export function lineSegments(points: number[][]): Float32Array {
  return new Float32Array(points.flat());
}

/** 球体经纬线（低模，用于音箱/话筒标记） */
export function sphereLines(radius: number, seg = 10): Float32Array {
  const out: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const phi = (Math.PI * i) / seg;
    for (let j = 0; j < seg; j++) {
      const theta1 = (2 * Math.PI * j) / seg;
      const theta2 = (2 * Math.PI * (j + 1)) / seg;
      out.push(
        radius * Math.sin(phi) * Math.cos(theta1), radius * Math.sin(phi) * Math.sin(theta1), radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta2), radius * Math.sin(phi) * Math.sin(theta2), radius * Math.cos(phi)
      );
    }
  }
  return new Float32Array(out);
}

/** 箭头（音箱朝向指示），沿 +Y */
export function arrowLines(length: number): Float32Array {
  const tip = [0, length, 0];
  return new Float32Array([
    0, 0, 0, ...tip,
    ...tip, 0.15, length - 0.2, 0,
    ...tip, -0.15, length - 0.2, 0,
    ...tip, 0, length - 0.2, 0.15,
    ...tip, 0, length - 0.2, -0.15
  ]);
}

/** SPL 热力色带：蓝(低) → 青 → 绿 → 黄 → 红(高) */
export function splColorMap(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  const stops: [number, [number, number, number]][] = [
    [0, [0.15, 0.25, 0.75]],
    [0.35, [0.1, 0.7, 0.8]],
    [0.6, [0.25, 0.8, 0.35]],
    [0.8, [0.95, 0.85, 0.2]],
    [1, [0.9, 0.15, 0.15]]
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (x >= t0 && x <= t1) {
      const k = (x - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

export function echoColor(echo: boolean): [number, number, number] {
  return echo ? [0.95, 0.25, 0.15] : [0.2, 0.75, 0.4];
}

export const VS_BASIC = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uMVP;
void main(){ gl_Position = uMVP * vec4(aPos, 1.0); }`;

export const FS_FLAT = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 frag;
void main(){ frag = uColor; }`;

export const VS_HEAT = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in float aValue;
uniform mat4 uMVP;
uniform float uMin;
uniform float uMax;
out float vT;
void main(){
  vT = clamp((aValue - uMin) / max(uMax - uMin, 0.001), 0.0, 1.0);
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

export const FS_HEAT = `#version 300 es
precision mediump float;
in float vT;
out vec4 frag;
vec3 cmap(float t){
  vec3 c0 = vec3(0.15,0.25,0.75);
  vec3 c1 = vec3(0.1,0.7,0.8);
  vec3 c2 = vec3(0.25,0.8,0.35);
  vec3 c3 = vec3(0.95,0.85,0.2);
  vec3 c4 = vec3(0.9,0.15,0.15);
  if(t<0.35) return mix(c0,c1,t/0.35);
  if(t<0.6) return mix(c1,c2,(t-0.35)/0.25);
  if(t<0.8) return mix(c2,c3,(t-0.6)/0.2);
  return mix(c3,c4,(t-0.8)/0.2);
}
void main(){ frag = vec4(cmap(vT), 0.78); }`;
