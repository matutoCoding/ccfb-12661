import {
  BAND_FREQS,
  type AmpModel,
  type BandValues,
  type DrySample,
  type Material,
  type SpeakerModel,
  newId,
} from './types';

const bv = (v: number[]): BandValues => {
  const out = {} as BandValues;
  BAND_FREQS.forEach((f, i) => (out[f] = v[i] ?? 0.1));
  return out;
};

/** 常用剧场/会议厅堂材料（吸声系数参考建筑声学手册典型值） */
export function defaultMaterials(): Material[] {
  const defs: Array<[string, number[], string]> = [
    ['混凝土/抹灰墙面', [0.01, 0.01, 0.02, 0.02, 0.03, 0.04, 0.05, 0.06], '硬反射面'],
    ['厚重窗帘（打褶）', [0.05, 0.15, 0.35, 0.55, 0.7, 0.75, 0.7, 0.6], '可调吸声构件'],
    ['50mm 玻璃棉板', [0.2, 0.55, 0.85, 0.95, 0.95, 0.95, 0.9, 0.85], '墙面吸声'],
    ['木质饰面板（留腔）', [0.15, 0.25, 0.3, 0.25, 0.2, 0.18, 0.15, 0.12], '木装修共振吸声'],
    ['观众席（满座）', [0.25, 0.4, 0.55, 0.7, 0.8, 0.85, 0.85, 0.8], '人员吸声'],
    ['观众席（空座）', [0.15, 0.25, 0.35, 0.45, 0.5, 0.5, 0.45, 0.4], '软包座椅'],
    ['木地板（架空）', [0.1, 0.12, 0.1, 0.08, 0.08, 0.07, 0.07, 0.07], '舞台地板'],
    ['石膏板吊顶', [0.15, 0.2, 0.15, 0.1, 0.08, 0.07, 0.06, 0.06], '反射顶'],
    ['空间吸声体', [0.3, 0.6, 0.9, 1.0, 1.0, 1.0, 0.95, 0.9], '悬吊高效吸声'],
    ['穿孔板（共振腔）', [0.4, 0.6, 0.55, 0.35, 0.2, 0.15, 0.12, 0.1], '亥姆霍兹共振'],
  ];
  return defs.map(([name, absorption, note]) => ({
    id: `mat_${name}`,
    name,
    absorption: bv(absorption),
    builtin: true,
    note,
  }));
}

/** 自造测试用音箱型号（参数覆盖点声源与线阵列单元） */
export function defaultSpeakerModels(): SpeakerModel[] {
  const defs: SpeakerModel[] = [
    {
      id: 'spk_la12',
      name: 'LA-12 线阵列单元',
      manufacturer: 'StudioGen',
      maxSPL: 134,
      sensitivity: 102,
      powerRMS: 600,
      weight: 21,
      size: { h: 0.35, w: 0.68, d: 0.42 },
      coverageH: 90,
      coverageV: 12,
      fLow: 55,
      lineSourceRollOff: 3,
      powerConsumption: 90,
      isLineArrayElement: true,
      builtin: true,
    },
    {
      id: 'spk_ps15',
      name: 'PS-15 全频点声源',
      manufacturer: 'StudioGen',
      maxSPL: 129,
      sensitivity: 99,
      powerRMS: 500,
      weight: 19,
      size: { h: 0.7, w: 0.45, d: 0.42 },
      coverageH: 80,
      coverageV: 60,
      fLow: 60,
      lineSourceRollOff: 6,
      powerConsumption: 75,
      isLineArrayElement: false,
      builtin: true,
    },
    {
      id: 'spk_coax8',
      name: 'CX-8 同轴补声',
      manufacturer: 'StudioGen',
      maxSPL: 121,
      sensitivity: 95,
      powerRMS: 250,
      weight: 9,
      size: { h: 0.42, w: 0.28, d: 0.26 },
      coverageH: 100,
      coverageV: 90,
      fLow: 80,
      lineSourceRollOff: 6,
      powerConsumption: 40,
      isLineArrayElement: false,
      builtin: true,
    },
    {
      id: 'spk_sub21',
      name: 'SUB-21 次低频',
      manufacturer: 'StudioGen',
      maxSPL: 138,
      sensitivity: 105,
      powerRMS: 1200,
      weight: 48,
      size: { h: 0.62, w: 0.62, d: 0.75 },
      coverageH: 360,
      coverageV: 360,
      fLow: 32,
      lineSourceRollOff: 6,
      powerConsumption: 160,
      isLineArrayElement: false,
      builtin: true,
    },
    {
      id: 'spk_mon12',
      name: 'MN-12 舞台返听',
      manufacturer: 'StudioGen',
      maxSPL: 126,
      sensitivity: 97,
      powerRMS: 400,
      weight: 14,
      size: { h: 0.36, w: 0.54, d: 0.38 },
      coverageH: 90,
      coverageV: 50,
      fLow: 65,
      lineSourceRollOff: 6,
      powerConsumption: 60,
      isLineArrayElement: false,
      builtin: true,
    },
  ];
  return defs;
}

export function defaultAmpModels(): AmpModel[] {
  return [
    {
      id: 'amp_d4',
      name: 'D-4 四通道功放',
      manufacturer: 'StudioGen',
      powerPerChannel: 800,
      channels: 4,
      maxOutputDbu: 22,
      powerConsumption: 1200,
      weight: 12,
      builtin: true,
    },
    {
      id: 'amp_d2',
      name: 'D-2 两通道功放',
      manufacturer: 'StudioGen',
      powerPerChannel: 1500,
      channels: 2,
      maxOutputDbu: 24,
      powerConsumption: 1600,
      weight: 14,
      builtin: true,
    },
    {
      id: 'amp_d8',
      name: 'D-8 八通道网络功放',
      manufacturer: 'StudioGen',
      powerPerChannel: 400,
      channels: 8,
      maxOutputDbu: 20,
      powerConsumption: 1400,
      weight: 16,
      builtin: true,
    },
  ];
}

/**
 * 程序化生成几秒干声样本（不依赖外部服务）。
 * voice：基频谐波 + 颤音的模拟语音短句；
 * percussion：衰减正弦脉冲串；
 * noise：粉噪（用于系统测试）。
 */
export function generateDrySample(
  kind: DrySample['kind'],
  durationSec = 3,
  sampleRate = 48000,
): DrySample {
  const n = Math.floor(durationSec * sampleRate);
  const data = new Float32Array(n);
  const seedBase = kind === 'voice' ? 11 : kind === 'percussion' ? 23 : 37;
  let rngState = seedBase;
  const rng = () => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  };

  if (kind === 'voice') {
    // 三个"音节"，每个 0.7s，基频在 120~160Hz 间跳变，加 5Hz 颤音与谐波包络
    const syllables = [125, 148, 132];
    for (let s = 0; s < syllables.length; s++) {
      const f0 = syllables[s];
      const start = Math.floor((0.15 + s * 0.85) * sampleRate);
      const len = Math.floor(0.7 * sampleRate);
      for (let i = 0; i < len && start + i < n; i++) {
        const t = i / sampleRate;
        const env = Math.min(1, i / (0.05 * sampleRate)) * Math.exp(-2.2 * (i / len));
        const vibrato = 1 + 0.012 * Math.sin(2 * Math.PI * 5 * t);
        const phase = 2 * Math.PI * f0 * vibrato * t;
        let sample =
          0.6 * Math.sin(phase) +
          0.25 * Math.sin(2 * phase) +
          0.12 * Math.sin(3 * phase + 0.4) +
          0.06 * Math.sin(4 * phase);
        // 简单共振峰强调（500Hz/1.5kHz）
        sample += 0.08 * Math.sin(2 * Math.PI * 750 * t) * env;
        data[start + i] += sample * env * 0.5;
      }
    }
  } else if (kind === 'percussion') {
    // 每 0.5s 一个 180Hz 指数衰减脉冲，模拟打击
    for (let hit = 0; hit < durationSec / 0.5; hit++) {
      const start = Math.floor((0.1 + hit * 0.5) * sampleRate);
      const len = Math.floor(0.35 * sampleRate);
      for (let i = 0; i < len && start + i < n; i++) {
        const t = i / sampleRate;
        const env = Math.exp(-14 * t);
        data[start + i] +=
          (Math.sin(2 * Math.PI * 180 * t) + 0.4 * Math.sin(2 * Math.PI * 360 * t)) * env * 0.55;
      }
    }
  } else {
    // 粉噪：Voss 风格一阶低通白噪
    let last = 0;
    for (let i = 0; i < n; i++) {
      const white = rng() * 2 - 1;
      last = last * 0.96 + white * 0.04;
      data[i] = last * 3.2;
    }
  }

  // 整体归一
  let peak = 1e-9;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  const k = 0.85 / peak;
  for (let i = 0; i < n; i++) data[i] *= k;

  const nameMap = { voice: '模拟人声（干声）', percussion: '模拟打击（干声）', noise: '粉红噪声（测试）' };
  return {
    id: newId('dry'),
    name: nameMap[kind],
    sampleRate,
    channelData: data,
    durationSec,
    kind,
    createdAt: Date.now(),
  };
}
