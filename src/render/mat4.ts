// 列主序 mat4（与 WebGL 一致）
export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Perspective(fovyRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovyRad / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function mat4LookAt(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Mat4 {
  const zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / zl, zy / zl, zz / zl];
  const xx = up[1] * z[2] - up[2] * z[1];
  const xy = up[2] * z[0] - up[0] * z[2];
  const xz = up[0] * z[1] - up[1] * z[0];
  const xl = Math.hypot(xx, xy, xz) || 1;
  const x = [xx / xl, xy / xl, xz / xl];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const m = mat4Identity();
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
  m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
  m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
  m[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  m[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  m[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  void zl;
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function mat4Translate(x: number, y: number, z: number): Mat4 {
  const m = mat4Identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

/** 绕 Z(yaw)、Y(pitch)、X(roll) 欧拉旋转（度） */
export function mat4FromEuler(yawDeg: number, pitchDeg: number, rollDeg: number): Mat4 {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const r = (rollDeg * Math.PI) / 180;
  const cy = Math.cos(y), sy = Math.sin(y);
  const cp = Math.cos(p), sp = Math.sin(p);
  const cr = Math.cos(r), sr = Math.sin(r);
  const m = mat4Identity();
  // Rz * Ry * Rx
  m[0] = cy * cp;
  m[1] = sy * cp;
  m[2] = -sp;
  m[4] = cy * sp * sr - sy * cr;
  m[5] = sy * sp * sr + cy * cr;
  m[6] = cp * sr;
  m[8] = cy * sp * cr + sy * sr;
  m[9] = sy * sp * cr - cy * sr;
  m[10] = cp * cr;
  return m;
}

export function mat4Scale(s: number): Mat4 {
  const m = mat4Identity();
  m[0] = m[5] = m[10] = s;
  return m;
}

export interface OrbitCamera {
  target: [number, number, number];
  distance: number;
  yaw: number;
  pitch: number;
}

export function cameraEye(cam: OrbitCamera): [number, number, number] {
  const cp = Math.cos((cam.pitch * Math.PI) / 180);
  return [
    cam.target[0] + cam.distance * cp * Math.sin((cam.yaw * Math.PI) / 180),
    cam.target[1] + cam.distance * cp * Math.cos((cam.yaw * Math.PI) / 180),
    cam.target[2] + cam.distance * Math.sin((cam.pitch * Math.PI) / 180)
  ];
}

export function viewProj(cam: OrbitCamera, aspect: number): Mat4 {
  const proj = mat4Perspective((50 * Math.PI) / 180, aspect, 0.1, 500);
  const view = mat4LookAt(cameraEye(cam), cam.target, [0, 0, 1]);
  return mat4Multiply(proj, view);
}

/** 屏幕坐标 → 世界射线（用于拾取） */
export function screenToRay(
  ndcX: number,
  ndcY: number,
  cam: OrbitCamera
): { origin: [number, number, number]; dir: [number, number, number] } {
  const eye = cameraEye(cam);
  const forward: [number, number, number] = [
    cam.target[0] - eye[0],
    cam.target[1] - eye[1],
    cam.target[2] - eye[2]
  ];
  const fl = Math.hypot(...forward);
  const f = forward.map((v) => v / fl) as [number, number, number];
  const right: [number, number, number] = [
    f[1] * 0 - f[2] * 0 + (f[1] * 1 - 0 * f[1]) * 0 + (0 * f[2] - 1 * f[2]) * -1,
    0, 0
  ];
  // 用叉积求 right/up
  const up0: [number, number, number] = [0, 0, 1];
  const r: [number, number, number] = [
    f[1] * up0[2] - f[2] * up0[1],
    f[2] * up0[0] - f[0] * up0[2],
    f[0] * up0[1] - f[1] * up0[0]
  ];
  const rl = Math.hypot(...r);
  const rightV = r.map((v) => v / rl) as [number, number, number];
  const up: [number, number, number] = [
    rightV[1] * f[2] - rightV[2] * f[1],
    rightV[2] * f[0] - rightV[0] * f[2],
    rightV[0] * f[1] - rightV[1] * f[0]
  ];
  const tanHalf = Math.tan((25 * Math.PI) / 180);
  const dx = ndcX * tanHalf * cam.distance * 1.2;
  const dy = ndcY * tanHalf * cam.distance * 1.2;
  const target: [number, number, number] = [
    eye[0] + f[0] * fl + rightV[0] * dx + up[0] * dy,
    eye[1] + f[1] * fl + rightV[1] * dx + up[1] * dy,
    eye[2] + f[2] * fl + rightV[2] * dx + up[2] * dy
  ];
  const dir: [number, number, number] = [
    target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]
  ];
  const dl = Math.hypot(...dir);
  void right;
  return { origin: eye, dir: dir.map((v) => v / dl) as [number, number, number] };
}

/** 射线与球（拾取音箱/话筒） */
export function raySphere(
  origin: number[],
  dir: number[],
  center: number[],
  radius: number
): number | null {
  const ox = origin[0] - center[0], oy = origin[1] - center[1], oz = origin[2] - center[2];
  const b = ox * dir[0] + oy * dir[1] + oz * dir[2];
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}
