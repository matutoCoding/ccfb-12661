// 扩声设计工具核心数据模型
// 所有数据均保存在浏览器 IndexedDB 中，不依赖任何外部服务。

export type ID = string;

/** 三维向量（单位：米） */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 二维多边形顶点（x = 长度方向, y = 宽度方向，单位：米） */
export interface Point2 {
  x: number;
  y: number;
}

/** 倍频程中心频率（Hz），吸声系数与 RT60 均按此 8 个频段存储 */
export const BAND_FREQS = [63, 125, 250, 500, 1000, 2000, 4000, 8000] as const;
export type BandFreq = (typeof BAND_FREQS)[number];
export type BandValues = Record<BandFreq, number>;

/** 声学材料 */
export interface Material {
  id: ID;
  name: string;
  /** 8 个倍频程吸声系数 α (0~1) */
  absorption: BandValues;
  /** 是否为系统内置材料（内置不可删除） */
  builtin?: boolean;
  note?: string;
}

/** 房间墙面类型 */
export type SurfaceType = 'floor' | 'ceiling' | 'wall';

export interface RoomSurface {
  id: ID;
  type: SurfaceType;
  materialId: ID;
}

/** 房间：轴对齐长方体（剧场/会议厅的通用简化） */
export interface Room {
  /** 长（x 方向，舞台在 x=0 一侧） */
  length: number;
  /** 宽（y 方向，居中） */
  width: number;
  /** 高（z 方向） */
  height: number;
  surfaces: RoomSurface[];
}

/** 观众区（地面上的多边形，z 为默认耳高 1.2m 测点平面） */
export interface AudienceArea {
  id: ID;
  name: string;
  polygon: Point2[];
  /** 测点耳高，米 */
  earHeight: number;
}

/** 场地 */
export interface Venue {
  id: ID;
  name: string;
  room: Room;
  audienceAreas: AudienceArea[];
  createdAt: number;
  updatedAt: number;
}

/** 音箱型号库条目（参数化指向性模型） */
export interface SpeakerModel {
  id: ID;
  name: string;
  manufacturer: string;
  /** 单只/单单元最大声压级（1m, 全功率）dB SPL */
  maxSPL: number;
  /** 灵敏度 dB (1W/1m) */
  sensitivity: number;
  /** 额定/节目功率 W */
  powerRMS: number;
  /** 单元重量 kg */
  weight: number;
  /** 箱体尺寸（高/宽/深）米 */
  size: { h: number; w: number; d: number };
  /** 水平指向性 Q 模型参考角（度），-6dB 覆盖角 */
  coverageH: number;
  coverageV: number;
  /** 最低重放频率 Hz */
  fLow: number;
  /** 高频轴上滚降（每倍频程 dB，正值表示高频衰减，线声源≈3，点声源≈0） */
  lineSourceRollOff: number;
  /** 单台功耗 W（用于设备清单功耗估算） */
  powerConsumption: number;
  /** 是否为线阵列单元 */
  isLineArrayElement: boolean;
  builtin?: boolean;
}

/** 功放型号 */
export interface AmpModel {
  id: ID;
  name: string;
  manufacturer: string;
  /** 每通道额定输出功率 W（8Ω） */
  powerPerChannel: number;
  /** 通道数 */
  channels: number;
  /** 最大输出电平 dBu */
  maxOutputDbu: number;
  /** 整机功耗 W */
  powerConsumption: number;
  weight: number;
  builtin?: boolean;
}

/** 参量均衡段 */
export interface EqBand {
  id: ID;
  enabled: boolean;
  freq: number;
  /** 增益 dB */
  gain: number;
  /** Q 值 */
  q: number;
  /** 滤波器类型 */
  type: 'peaking' | 'lowshelf' | 'highshelf';
}

/** 通道 DSP 参数 */
export interface ChannelDsp {
  /** 高切频率 Hz，null 表示旁路 */
  highpass: number | null;
  lowpass: number | null;
  eq: EqBand[];
  /** 限幅器阈值 dBu（功放输入侧等效） */
  limiterThresholdDbu: number;
  /** 限幅器压缩比 */
  limiterRatio: number;
  /** 通道增益 dB（含处理器内部增益） */
  gainDb: number;
  /** 延时 ms */
  delayMs: number;
  /** 哑音 */
  muted: boolean;
}

/** 功放通道绑定 */
export interface AmpChannelBinding {
  ampId: ID;
  /** 功放物理通道序号（从 1 开始） */
  channel: number;
}

/** 信号流节点类型 */
export type SignalNodeType = 'mixer' | 'processor' | 'amp' | 'speaker';

export interface SignalNode {
  id: ID;
  type: SignalNodeType;
  name: string;
  /** 处理器/调音台通道名（amp/speaker 节点用绑定关系） */
}

export interface SignalEdge {
  id: ID;
  from: ID;
  to: ID;
  /** 边上的通道 DSP（处理器输出通道） */
  dsp?: ChannelDsp;
}

/** 线阵列吊挂定义 */
export interface LineArray {
  id: ID;
  name: string;
  /** 顶部吊挂点 */
  hangPoint: Vec3;
  /** 整串朝向基准角：水平方位角（度，绕 z，0 = 朝 +x 即朝向观众） */
  azimuth: number;
  /** 第一只箱体顶部的俯仰角（度，负值=向下俯） */
  startTilt: number;
  /** 逐只箱体夹角（度，正值表示相邻箱体向下张开），长度 = 箱体数 */
  interAngles: number[];
  speakerModelId: ID;
  ampBindings: AmpChannelBinding[];
  /** 吊具额定载荷 kg（单吊点） */
  riggingRatedLoadKg: number;
  /** 吊点数量 */
  hangPointCount: number;
  dsp?: ChannelDsp;
}

/** 单只布置音箱（点声源/返听/补声） */
export interface PlacedSpeaker {
  id: ID;
  name: string;
  speakerModelId: ID;
  position: Vec3;
  /** 方位角 度（绕 z） */
  azimuth: number;
  /** 俯仰角 度（负=向下） */
  tilt: number;
  amp: AmpChannelBinding;
  dsp?: ChannelDsp;
}

/** 啸叫分析用话筒 */
export interface Microphone {
  id: ID;
  name: string;
  position: Vec3;
  /** 心形指向主轴方位角（度），0 = 朝舞台 -x */
  azimuth: number;
  /** 心形指向主轴俯仰角 */
  tilt: number;
}

/** 电平预算链路中的一级设备 */
export interface LevelStage {
  id: ID;
  name: string;
  kind: SignalNodeType;
  /** 额定最大输出电平 dBu（调音台/处理器输出、功放输出按等效输入折算） */
  maxOutputDbu: number;
  /** 本机增益 dB */
  gainDb: number;
  dsp?: ChannelDsp;
}

/** 电平预算链路 */
export interface LevelBudgetChain {
  id: ID;
  name: string;
  /** 节目源输出电平 dBu（典型 +4dBu 额定，峰值 +20 等） */
  sourceLevelDbu: number;
  stages: LevelStage[];
  /** 末端绑定的音箱实例 id（线阵列 id 或单只音箱 id） */
  targetSpeakerId: ID;
}

/** DSP 通道预设（可套用到其他通道） */
export interface ChannelPreset {
  id: ID;
  name: string;
  dsp: ChannelDsp;
  createdAt: number;
}

/** 测点（方案对比表用） */
export interface MeasurePoint {
  id: ID;
  name: string;
  position: Vec3;
}

/** 布置方案：同一场地下可挂多套 */
export interface Layout {
  id: ID;
  venueId: ID;
  name: string;
  speakers: PlacedSpeaker[];
  lineArrays: LineArray[];
  microphones: Microphone[];
  signalNodes: SignalNode[];
  signalEdges: SignalEdge[];
  levelChains: LevelBudgetChain[];
  measurePoints: MeasurePoint[];
  createdAt: number;
  updatedAt: number;
}

/** 项目 */
export interface Project {
  id: ID;
  name: string;
  description: string;
  venueId: ID | null;
  layoutIds: ID[];
  createdAt: number;
  updatedAt: number;
}

/** IndexedDB 顶层存储结构 */
export interface AppDatabase {
  projects: Record<ID, Project>;
  venues: Record<ID, Venue>;
  layouts: Record<ID, Layout>;
  materials: Record<ID, Material>;
  speakerModels: Record<ID, SpeakerModel>;
  ampModels: Record<ID, AmpModel>;
  presets: Record<ID, ChannelPreset>;
  /** 干声样本（AudioBuffer 序列化数据） */
  drySamples: Record<ID, DrySample>;
  schemaVersion: number;
}

/** 自生成的干声样本 */
export interface DrySample {
  id: ID;
  name: string;
  sampleRate: number;
  /** 单声道 PCM，-1~1 */
  channelData: Float32Array;
  durationSec: number;
  kind: 'voice' | 'percussion' | 'noise';
  createdAt: number;
}

export function newId(prefix = 'id'): ID {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export function defaultDsp(): ChannelDsp {
  return {
    highpass: null,
    lowpass: null,
    eq: [],
    limiterThresholdDbu: 18,
    limiterRatio: 10,
    gainDb: 0,
    delayMs: 0,
    muted: false,
  };
}
