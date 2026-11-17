import type {
  AmpModel, DSPPreset, Layout, Library, Material, Project, SpeakerModel, Surface, Venue
} from './types';
import { defaultDSPChain, defaultPEQBand } from './dsp';
import { uid } from './math/vec3';

// ---------- 材料库（吸声系数 63..8kHz，工程手册典型值） ----------
export const SEED_MATERIALS: Material[] = [
  { id: 'mat-concrete', name: '混凝土/抹灰墙面', category: '硬质结构', builtin: true, absorption: [0.01, 0.01, 0.02, 0.02, 0.03, 0.03, 0.04, 0.05], note: '反射强，常见于多功能厅毛坯' },
  { id: 'mat-brick', name: '清水砖墙', category: '硬质结构', builtin: true, absorption: [0.02, 0.02, 0.03, 0.03, 0.04, 0.05, 0.07, 0.08] },
  { id: 'mat-wood', name: '木饰面板（空腔）', category: '木作', builtin: true, absorption: [0.15, 0.2, 0.25, 0.2, 0.15, 0.12, 0.1, 0.1] },
  { id: 'mat-carpet', name: '满铺厚地毯', category: '地面', builtin: true, absorption: [0.05, 0.1, 0.2, 0.35, 0.5, 0.6, 0.65, 0.65] },
  { id: 'mat-tile', name: '瓷砖/水磨石地面', category: '地面', builtin: true, absorption: [0.01, 0.01, 0.01, 0.02, 0.02, 0.03, 0.04, 0.05] },
  { id: 'mat-fabric', name: '阻燃布艺软包（50mm）', category: '吸声材料', builtin: true, absorption: [0.25, 0.45, 0.7, 0.9, 0.95, 0.9, 0.85, 0.8], note: '剧场常用宽频吸声' },
  { id: 'mat-minwool', name: '矿棉板吊顶', category: '吊顶', builtin: true, absorption: [0.2, 0.35, 0.55, 0.75, 0.85, 0.9, 0.9, 0.85] },
  { id: 'mat-glass', name: '单层玻璃幕墙', category: '玻璃', builtin: true, absorption: [0.05, 0.04, 0.03, 0.03, 0.02, 0.02, 0.03, 0.04] },
  { id: 'mat-seat', name: '织物软包座椅（每座当量）', category: '座椅', builtin: true, absorption: [0.1, 0.2, 0.3, 0.4, 0.45, 0.45, 0.4, 0.35] },
  { id: 'mat-diffuser', name: 'MLS 扩散体（木质）', category: '扩散构件', builtin: true, absorption: [0.1, 0.15, 0.2, 0.25, 0.2, 0.18, 0.15, 0.12] },
  { id: 'mat-curtain', name: '厚重打褶舞台幕布', category: '吸声材料', builtin: true, absorption: [0.1, 0.2, 0.4, 0.6, 0.75, 0.8, 0.8, 0.75] }
];

// ---------- 音箱库 ----------
const bandResp = (low = -3, high = -2): number[] => [low, -1, 0, 0, 0, 0, -1, high];
const di = (base: number): number[] => [base - 4, base - 3, base - 1, base, base + 1, base + 2, base + 3, base + 3];

export const SEED_SPEAKERS: SpeakerModel[] = [
  {
    id: 'spk-la12', manufacturer: 'Aurora', model: 'LA-12i 线阵列单元', builtin: true, kind: 'line-element',
    sensitivity: 104, powerHandling: 500, maxSPL: 131, nominalImpedance: 8, weight: 18.5,
    dimensions: { w: 0.36, h: 0.34, d: 0.42 }, coverageH: 90, coverageV: 12,
    freqLow: 60, freqHigh: 18000, bandResponse: bandResp(-4, -2), directivityIndex: di(8),
    note: '三分频频线阵，吊挂使用'
  },
  {
    id: 'spk-point12', manufacturer: 'Aurora', model: 'PS-12 全频点声源', builtin: true, kind: 'point',
    sensitivity: 98, powerHandling: 400, maxSPL: 124, nominalImpedance: 8, weight: 14.2,
    dimensions: { w: 0.38, h: 0.58, d: 0.36 }, coverageH: 80, coverageV: 60,
    freqLow: 55, freqHigh: 18000, bandResponse: bandResp(-3, -2), directivityIndex: di(6)
  },
  {
    id: 'spk-point8', manufacturer: 'Aurora', model: 'PS-8 补声音箱', builtin: true, kind: 'point',
    sensitivity: 94, powerHandling: 200, maxSPL: 117, nominalImpedance: 8, weight: 7.8,
    dimensions: { w: 0.26, h: 0.4, d: 0.25 }, coverageH: 90, coverageV: 90,
    freqLow: 70, freqHigh: 18000, bandResponse: bandResp(-4, -2), directivityIndex: di(5)
  },
  {
    id: 'spk-sub218', manufacturer: 'Aurora', model: 'SW-218 双18超低频', builtin: true, kind: 'sub',
    sensitivity: 102, powerHandling: 1600, maxSPL: 134, nominalImpedance: 4, weight: 68,
    dimensions: { w: 1.1, h: 0.6, d: 0.8 }, coverageH: 360, coverageV: 360,
    freqLow: 30, freqHigh: 120, bandResponse: [0, 0, -2, -10, -25, -40, -50, -60], directivityIndex: [0, 0, 0, 0, 0, 0, 0, 0]
  },
  {
    id: 'spk-mon15', manufacturer: 'Aurora', model: 'MN-15 舞台返听', builtin: true, kind: 'monitor',
    sensitivity: 97, powerHandling: 300, maxSPL: 122, nominalImpedance: 8, weight: 16,
    dimensions: { w: 0.42, h: 0.32, d: 0.52 }, coverageH: 60, coverageV: 40,
    freqLow: 60, freqHigh: 16000, bandResponse: bandResp(-3, -3), directivityIndex: di(5)
  },
  {
    id: 'spk-col4', manufacturer: 'Aurora', model: 'CL-4 音柱', builtin: true, kind: 'point',
    sensitivity: 92, powerHandling: 160, maxSPL: 114, nominalImpedance: 8, weight: 6.5,
    dimensions: { w: 0.12, h: 0.9, d: 0.14 }, coverageH: 120, coverageV: 25,
    freqLow: 90, freqHigh: 18000, bandResponse: bandResp(-5, -2), directivityIndex: di(7)
  }
];

// ---------- 功放库 ----------
export const SEED_AMPS: AmpModel[] = [
  { id: 'amp-d4800', manufacturer: 'Aurora', model: 'D-4800 四通道功放', builtin: true, channels: 4, power8R: 800, power4R: 1200, gain: 32, clipLevel: 21, weight: 12, note: 'D 类，带 DSP 选件' },
  { id: 'amp-d2200', manufacturer: 'Aurora', model: 'D-2200 两通道功放', builtin: true, channels: 2, power8R: 500, power4R: 800, gain: 30, clipLevel: 20, weight: 9 },
  { id: 'amp-sub10k', manufacturer: 'Aurora', model: 'S-10K 超低频功放', builtin: true, channels: 2, power8R: 2000, power4R: 3200, gain: 34, clipLevel: 22, weight: 18 }
];

// ---------- DSP 预设 ----------
export function seedPresets(): DSPPreset[] {
  const vocal = defaultDSPChain();
  vocal.gain = 0;
  vocal.highpass = { enabled: true, freq: 100, slope: 24 };
  vocal.peq = [
    { ...defaultPEQBand(), freq: 250, gain: -3, q: 1.6 },
    { ...defaultPEQBand(), freq: 3500, gain: 2.5, q: 1.2 }
  ];
  vocal.limiter = { enabled: true, threshold: 16, attackMs: 5, releaseMs: 200 };

  const fullRange = defaultDSPChain();
  fullRange.highpass = { enabled: true, freq: 60, slope: 12 };
  fullRange.lowpass = { enabled: true, freq: 16000, slope: 12 };
  fullRange.limiter = { enabled: true, threshold: 18, attackMs: 3, releaseMs: 150 };

  return [
    { id: 'preset-vocal', name: '人声通道预设（HPF100 + 250Hz 陷波 + 限幅）', builtin: true, chain: vocal, createdAt: Date.now() },
    { id: 'preset-fullrange', name: '全频音箱预设（60Hz 高切 + 限幅）', builtin: true, chain: fullRange, createdAt: Date.now() }
  ];
}

export function seedLibrary(): Library {
  return {
    materials: SEED_MATERIALS,
    speakers: SEED_SPEAKERS,
    amps: SEED_AMPS,
    presets: seedPresets()
  };
}

// ---------- 默认房间六面 ----------
export function defaultSurfaces(w: number, l: number, h: number): Surface[] {
  const face = (id: string, name: string, boxFace: Surface['boxFace'], materialId: string): Surface =>
    ({ id, name, type: 'box-face', boxFace, materialId });
  return [
    face('surf-floor', '地面', 'floor', 'mat-tile'),
    face('surf-ceiling', '顶棚', 'ceiling', 'mat-minwool'),
    face('surf-wall-s', '侧墙 A（x=0）', 'wall-s', 'mat-fabric'),
    face('surf-wall-n', '侧墙 B（x=W）', 'wall-n', 'mat-fabric'),
    face('surf-wall-w', '后墙（舞台侧 y=0）', 'wall-w', 'mat-concrete'),
    face('surf-wall-e', '后墙（观众厅 y=L）', 'wall-e', 'mat-curtain')
  ];
}

export function defaultVenue(w = 24, l = 30, h = 10): Venue {
  return {
    name: '新建剧场',
    width: w,
    length: l,
    height: h,
    surfaces: defaultSurfaces(w, l, h),
    audienceZones: [
      {
        id: uid('zone'),
        name: '池座',
        earHeight: 1.2,
        polygon: [
          { x: 3, y: 8 }, { x: w - 3, y: 8 }, { x: w - 2, y: l - 2 }, { x: 2, y: l - 2 }
        ]
      }
    ]
  };
}

/** 生成一个可直接分析的演示项目（含线阵列、补声、超低、话筒、完整信号链） */
export function createDemoProject(): { project: Project; layouts: Layout[] } {
  const venue = defaultVenue(24, 30, 10);
  const now = Date.now();
  const projectId = 'proj-demo';
  const layoutId = 'layout-demo-a';
  const layoutBId = 'layout-demo-b';

  const mixerId = 'node-mixer';
  const procId = 'node-proc';
  const ampMainId = 'node-amp-main';
  const ampSubId = 'node-amp-sub';
  const ampFillId = 'node-amp-fill';

  const dspVocal = seedPresets()[0].chain;
  const dspFull = seedPresets()[1].chain;

  const layoutA: Layout = {
    id: layoutId,
    name: '方案A：L/R 主扩线阵列',
    note: '左右各 8 只线阵列 + 台口补声 + 中央超低',
    updatedAt: now,
    sourceLevel: 4,
    openMicCount: 4,
    speakers: [
      { id: 'sp-fill-l', name: '左台口补声 PS-8', modelId: 'spk-point8', position: { x: 2.5, y: 1.5, z: 3 }, orientation: { yaw: -25, pitch: -10, roll: 0 }, ampNodeId: ampFillId, gainOffset: 0 },
      { id: 'sp-fill-r', name: '右台口补声 PS-8', modelId: 'spk-point8', position: { x: 21.5, y: 1.5, z: 3 }, orientation: { yaw: 25, pitch: -10, roll: 0 }, ampNodeId: ampFillId, gainOffset: 0 },
      { id: 'sp-sub-c', name: '中央超低频 SW-218', modelId: 'spk-sub218', position: { x: 12, y: 1.2, z: 0.8 }, orientation: { yaw: 0, pitch: 0, roll: 0 }, ampNodeId: ampSubId, gainOffset: 0 },
      { id: 'sp-mon-1', name: '返听 MN-15', modelId: 'spk-mon15', position: { x: 8, y: 3, z: 0.4 }, orientation: { yaw: 180, pitch: 20, roll: 0 }, ampNodeId: ampFillId, gainOffset: -3 }
    ],
    arrays: [
      {
        id: 'arr-l', name: '左主扩线阵列', elementModelId: 'spk-la12',
        framePosition: { x: 3, y: 1.2, z: 9.2 }, yaw: -18, count: 8,
        interAngles: [0.5, 0.8, 1.1, 1.4, 1.7, 2.0, 2.4],
        ratedPickLoad: 120, pickPointCount: 2, ampNodeId: ampMainId
      },
      {
        id: 'arr-r', name: '右主扩线阵列', elementModelId: 'spk-la12',
        framePosition: { x: 21, y: 1.2, z: 9.2 }, yaw: 18, count: 8,
        interAngles: [0.5, 0.8, 1.1, 1.4, 1.7, 2.0, 2.4],
        ratedPickLoad: 120, pickPointCount: 2, ampNodeId: ampMainId
      }
    ],
    mics: [
      { id: 'mic-1', name: '主持话筒', position: { x: 12, y: 2.5, z: 1.5 }, pattern: 'cardioid', orientation: { yaw: 0, pitch: 0, roll: 0 } },
      { id: 'mic-2', name: '演唱话筒', position: { x: 9, y: 3.5, z: 1.5 }, pattern: 'cardioid', orientation: { yaw: -20, pitch: 0, roll: 0 } }
    ],
    graph: {
      nodes: [
        { id: mixerId, kind: 'mixer', name: '主调音台 M32' },
        { id: procId, kind: 'processor', name: '4×8 数字处理器', deviceModelId: 'dsp-48', dsp: JSON.parse(JSON.stringify(dspVocal)) },
        { id: ampMainId, kind: 'amp', name: '主扩功放 D-4800', deviceModelId: 'amp-d4800', channelIndex: 0, dsp: JSON.parse(JSON.stringify(dspFull)) },
        { id: ampSubId, kind: 'amp', name: '超低功放 S-10K', deviceModelId: 'amp-sub10k', channelIndex: 0, dsp: (() => { const c = JSON.parse(JSON.stringify(dspFull)); c.lowpass = { enabled: true, freq: 100, slope: 24 }; return c; })() },
        { id: ampFillId, kind: 'amp', name: '补声功放 D-2200', deviceModelId: 'amp-d2200', channelIndex: 0, dsp: JSON.parse(JSON.stringify(dspFull)) }
      ],
      edges: [
        { from: mixerId, to: procId },
        { from: procId, to: ampMainId },
        { from: procId, to: ampSubId },
        { from: procId, to: ampFillId }
      ]
    }
  };

  const layoutB: Layout = JSON.parse(JSON.stringify(layoutA));
  layoutB.id = layoutBId;
  layoutB.name = '方案B：中央线阵列 + 分布式补声';
  layoutB.note = '中央 12 只线阵列，侧墙 6 只补声音柱';
  layoutB.updatedAt = now;
  layoutB.arrays = [
    {
      id: 'arr-c', name: '中央主扩线阵列', elementModelId: 'spk-la12',
      framePosition: { x: 12, y: 1.2, z: 9.4 }, yaw: 0, count: 12,
      interAngles: [0.4, 0.6, 0.8, 1.0, 1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3.0],
      ratedPickLoad: 150, pickPointCount: 2, ampNodeId: ampMainId
    }
  ];
  layoutB.speakers = layoutA.speakers.filter((s) => !s.arrayId).concat([
    { id: 'sp-col-l', name: '左侧墙音柱', modelId: 'spk-col4', position: { x: 1, y: 15, z: 4 }, orientation: { yaw: -60, pitch: 0, roll: 0 }, ampNodeId: ampFillId, gainOffset: -2 },
    { id: 'sp-col-r', name: '右侧墙音柱', modelId: 'spk-col4', position: { x: 23, y: 15, z: 4 }, orientation: { yaw: 60, pitch: 0, roll: 0 }, ampNodeId: ampFillId, gainOffset: -2 }
  ]);

  const project: Project = {
    id: projectId,
    name: '示例剧场（800 座）',
    description: '内置演示工程：24m×30m×10m 剧场，含两套可对比布置方案',
    createdAt: now,
    updatedAt: now,
    venue,
    layoutIds: [layoutId, layoutBId]
  };
  return { project, layouts: [layoutA, layoutB] };
}
