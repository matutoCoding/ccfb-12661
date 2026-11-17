// 全局领域模型 —— 所有数据均为可序列化的普通 JSON，便于 IndexedDB 存储与 Worker 传输

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Euler = {
  /** 偏航（绕 Z），度 */
  yaw: number;
  /** 俯仰（绕 Y），度 */
  pitch: number;
  /** 翻滚（绕 X），度 */
  roll: number;
};

// ---------- 材料与设备库 ----------

export interface Material {
  id: string;
  name: string;
  category: string;
  builtin: boolean;
  /** 8 个倍频程带吸声系数 63Hz..8kHz */
  absorption: number[];
  note?: string;
}

export type SpeakerKind = 'point' | 'line-element' | 'sub' | 'monitor';

export interface SpeakerModel {
  id: string;
  manufacturer: string;
  model: string;
  builtin: boolean;
  kind: SpeakerKind;
  /** 灵敏度 dB SPL @1m @1W */
  sensitivity: number;
  /** 节目功率 W */
  powerHandling: number;
  /** 最大声压级 dB SPL @1m（节目） */
  maxSPL: number;
  nominalImpedance: number;
  weight: number;
  dimensions: { w: number; h: number; d: number };
  /** 水平覆盖角 -6dB，度 */
  coverageH: number;
  /** 垂直覆盖角 -6dB，度 */
  coverageV: number;
  freqLow: number;
  freqHigh: number;
  /** 各频带轴向相对响应 dB（0 为参考） */
  bandResponse: number[];
  /** 各频带指向性指数 DI dB */
  directivityIndex: number[];
  note?: string;
}

export interface AmpModel {
  id: string;
  manufacturer: string;
  model: string;
  builtin: boolean;
  channels: number;
  /** 8Ω 每通道额定功率 W */
  power8R: number;
  /** 4Ω 每通道额定功率 W */
  power4R: number;
  /** 电压增益 dB */
  gain: number;
  /** 限幅/削波输出电平 dBu */
  clipLevel: number;
  weight: number;
  note?: string;
}

// ---------- DSP 信号链 ----------

export interface PEQBand {
  id: string;
  enabled: boolean;
  type: 'bell' | 'lowshelf' | 'highshelf';
  freq: number;
  gain: number;
  q: number;
}

export interface XOverFilter {
  enabled: boolean;
  freq: number;
  /** 斜率 dB/oct */
  slope: 12 | 24;
}

export interface Limiter {
  enabled: boolean;
  /** 阈值 dBu */
  threshold: number;
  attackMs: number;
  releaseMs: number;
}

export interface DSPChain {
  gain: number;
  delayMs: number;
  mute: boolean;
  peq: PEQBand[];
  highpass: XOverFilter;
  lowpass: XOverFilter;
  limiter: Limiter;
}

export interface DSPPreset {
  id: string;
  name: string;
  builtin: boolean;
  chain: DSPChain;
  createdAt: number;
}

export type SignalNodeKind = 'mixer' | 'processor' | 'amp' | 'speaker';

export interface SignalNode {
  id: string;
  kind: SignalNodeKind;
  name: string;
  /** amp / processor 设备型号 id */
  deviceModelId?: string;
  /** 功放通道序号（0 起） */
  channelIndex?: number;
  dsp?: DSPChain;
}

export interface SignalEdge {
  from: string;
  to: string;
}

// ---------- 场地 ----------

export type BoxFaceName = 'floor' | 'ceiling' | 'wall-n' | 'wall-s' | 'wall-e' | 'wall-w';

export interface Surface {
  id: string;
  name: string;
  type: 'box-face' | 'polygon';
  boxFace?: BoxFaceName;
  /** 自定义多边形面（共面顶点） */
  polygon?: Vec3[];
  materialId: string;
}

export interface AudienceZone {
  id: string;
  name: string;
  /** 地面平面多边形（x,y），z 默认 0 */
  polygon: Vec2[];
  /** 人耳高度 m */
  earHeight: number;
}

export interface Venue {
  name: string;
  /** 房间内净尺寸 m */
  width: number;  // x
  length: number; // y
  height: number; // z
  surfaces: Surface[];
  audienceZones: AudienceZone[];
}

// ---------- 布置方案 ----------

export interface SpeakerInstance {
  id: string;
  name: string;
  modelId: string;
  position: Vec3;
  orientation: Euler;
  /** 绑定的功放通道节点 id */
  ampNodeId?: string;
  /** 所属线阵列 id（由阵列派生的箱体带此标记） */
  arrayId?: string;
  gainOffset: number;
}

export interface LineArray {
  id: string;
  name: string;
  elementModelId: string;
  /** 吊挂框架（最上沿）位置 */
  framePosition: Vec3;
  /** 整体朝向 yaw，度 */
  yaw: number;
  count: number;
  /** 相邻箱体张角，度，长度 = count-1 */
  interAngles: number[];
  /** 吊具额定载荷 kg（单吊点） */
  ratedPickLoad: number;
  pickPointCount: number;
  ampNodeId?: string;
}

export interface MicInstance {
  id: string;
  name: string;
  position: Vec3;
  /** 指向性 */
  pattern: 'omni' | 'cardioid';
  /** 话筒主轴朝向（心形指向时使用） */
  orientation: Euler;
}

export interface Layout {
  id: string;
  name: string;
  note: string;
  updatedAt: number;
  speakers: SpeakerInstance[];
  arrays: LineArray[];
  mics: MicInstance[];
  graph: { nodes: SignalNode[]; edges: SignalEdge[] };
  /** 节目源（调音台输出）电平 dBu */
  sourceLevel: number;
  /** 同时开启话筒数（NOM） */
  openMicCount: number;
}

// ---------- 项目 ----------

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  venue: Venue;
  layoutIds: string[];
}

/** 全局库（跨项目共享，IndexedDB 单独存储） */
export interface Library {
  materials: Material[];
  speakers: SpeakerModel[];
  amps: AmpModel[];
  presets: DSPPreset[];
}

// ---------- 分析结果 ----------

export interface RT60Result {
  sabine: number[];
  eyring: number[];
  volume: number;
  totalAbsorption: number[];
  surfaceArea: number;
}

export interface SeatMetric {
  position: Vec3;
  /** 各带直达声压级 */
  directBands: number[];
  /** 各带混响声压级 */
  reverbBands: number[];
  /** 各带总声压级 */
  splBands: number[];
  splDBA: number;
  /** 相对该音箱最大可输出的余量 dB（各带最小值汇总） */
  headroom: number;
}

export interface LevelBudgetStage {
  stage: string;
  nodeId?: string;
  inputDbu: number;
  gainDb: number;
  outputDbu: number;
  clipDbu: number;
  headroomDb: number;
  overload: boolean;
  limited: boolean;
}

export interface SpeakerBudget {
  speakerId: string;
  speakerName: string;
  stages: LevelBudgetStage[];
  /** 音箱端实际功率 W */
  powerW: number;
  /** 1m 处实际最大声压 */
  spl1m: number;
  /** 最先过载的级序号，-1 无 */
  firstOverload: number;
}

export interface FeedbackPoint {
  freq: number;
  marginDb: number;
}

export interface FeedbackResult {
  micId: string;
  micName: string;
  /** 细粒度频率点上的啸叫余量 dB */
  curve: FeedbackPoint[];
  /** 8 带余量 */
  bandMargins: number[];
  worst: FeedbackPoint[];
  /** 话筒到最远听众距离 m */
  dListener: number;
  /** 话筒到最近音箱距离 m */
  dSpeaker: number;
}

export interface ReflectionPath {
  order: 1 | 2;
  surfaceIds: string[];
  /** 完整折线点（源->反射点->...->接收点） */
  points: Vec3[];
  lengthM: number;
  delayMs: number;
  /** 相对直达声的级差 dB（各带，取 500/1k/2k 均值给总览） */
  levelDeltaBands: number[];
  levelDelta: number;
  isEcho: boolean;
}

export interface EchoSeatMap {
  /** 观众区采样点及回声标记 */
  points: { position: Vec3; echo: boolean; worstDelayMs: number; worstLevelDelta: number }[];
}

export interface RiggingPickLoad {
  name: string;
  loadKg: number;
  ratedKg: number;
  ok: boolean;
}

export interface RiggingResult {
  arrayId: string;
  totalWeight: number;
  /** 重心相对框架点的偏移（纵向 m, 竖向 m） */
  comOffset: { along: number; down: number };
  picks: RiggingPickLoad[];
  warnings: string[];
  /** 每只箱体的累计位置（用于渲染） */
  elementPositions: Vec3[];
  elementPitches: number[];
}

export interface RIRResult {
  sampleRate: number;
  samples: Float32Array;
  rt60Bands: number[];
  directSample: number;
  durationSec: number;
}

export interface SeatProbe {
  position: Vec3;
  splBands: number[];
  splDBA: number;
  /** 频率响应曲线（细粒度，dB） */
  response: { freq: number; db: number }[];
  rir: RIRResult;
}

export interface BOMItem {
  category: string;
  modelId: string;
  name: string;
  unit: string;
  quantity: number;
  group: string;
  weightEach?: number;
  powerEach?: number;
}

export interface BOMResult {
  items: BOMItem[];
  totalPowerW: number;
  totalWeightKg: number;
  groups: string[];
}

export interface AnalysisSnapshot {
  layoutId: string;
  rt60: RT60Result;
  budgets: SpeakerBudget[];
  feedback: FeedbackResult[];
  /** 观众区 SPL 网格（供 WebGL 热力图） */
  splGrid: { min: Vec2; max: Vec2; nx: number; ny: number; values: Float32Array; dba: Float32Array };
  seats: SeatMetric[];
  reflections: ReflectionPath[];
  echoMap: EchoSeatMap;
  rigging: RiggingResult[];
  bom: BOMResult;
  computedAt: number;
}
