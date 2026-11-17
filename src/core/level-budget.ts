import type {
  AmpModel, Layout, SignalNode, SpeakerBudget, SpeakerInstance, SpeakerModel, LevelBudgetStage
} from './types';
import { applyLimiter } from './dsp';
import { dbuToVolts, voltsToDbu } from './acoustics/bands';

/** 在信号图中找到某节点的全部上游节点（按边方向） */
export function upstreamNodes(nodeId: string, edges: { from: string; to: string }[]): string[] {
  return edges.filter((e) => e.to === nodeId).map((e) => e.from);
}

export function downstreamNodes(nodeId: string, edges: { from: string; to: string }[]): string[] {
  return edges.filter((e) => e.from === nodeId).map((e) => e.to);
}

/** 从每只音箱反向追溯到调音台的路径（取第一条可达路径） */
export function traceSignalPath(speakerNodeId: string, edges: { from: string; to: string }[]): string[] {
  const path: string[] = [speakerNodeId];
  const visited = new Set<string>([speakerNodeId]);
  let cur = speakerNodeId;
  for (;;) {
    const ups = upstreamNodes(cur, edges).filter((id) => !visited.has(id));
    if (ups.length === 0) break;
    cur = ups[0];
    path.push(cur);
    visited.add(cur);
  }
  return path.reverse();
}

interface DeviceResolver {
  amp(id: string): AmpModel | undefined;
  speaker(id: string): SpeakerModel | undefined;
}

/**
 * 单只音箱的电平预算：从节目源电平开始逐级推算。
 * mixer → processor(DSP) → amp(DSP+电压增益) → speaker（功率/声压）
 */
export function computeSpeakerBudget(
  layout: Layout,
  speaker: SpeakerInstance,
  resolver: DeviceResolver
): SpeakerBudget {
  const stages: LevelBudgetStage[] = [];
  const edges = layout.graph.edges;
  const nodeById = new Map(layout.graph.nodes.map((n) => [n.id, n]));
  const speakerNode = layout.graph.nodes.find((n) => n.kind === 'speaker');
  // 音箱实例绑定的是功放通道节点；信号终点为该功放节点（音箱级单独算）
  const terminalId = speaker.ampNodeId ?? speakerNode?.id;
  const path = terminalId ? traceSignalPath(terminalId, edges) : [];

  let level = layout.sourceLevel;
  let firstOverload = -1;
  let stageIdx = 0;

  for (const id of path) {
    const node = nodeById.get(id);
    if (!node) continue;
    const input = level;
    let gain = 0;
    let clip = 24;
    let limited = false;
    if (node.kind === 'mixer') {
      clip = 22; // 调音台母线典型削波
    } else if (node.kind === 'processor') {
      const chain = node.dsp;
      if (chain) {
        gain = chain.gain;
        const r = applyLimiter(chain, input + gain);
        level = r.out;
        limited = r.limited;
        clip = chain.limiter.enabled ? chain.limiter.threshold : 21;
      }
    } else if (node.kind === 'amp') {
      const amp = node.deviceModelId ? resolver.amp(node.deviceModelId) : undefined;
      const chain = node.dsp;
      if (chain) {
        gain += chain.gain;
        const r = applyLimiter(chain, input + gain);
        level = r.out;
        limited = r.limited;
      }
      if (amp) {
        gain += amp.gain;
        clip = amp.clipLevel;
      } else {
        clip = 26;
      }
    }
    if (!limited) level = input + gain;
    if (node.kind !== 'speaker') {
      const headroom = clip - level;
      const overload = level > clip;
      if (overload && firstOverload < 0) firstOverload = stageIdx;
      stages.push({
        stage: nodeLabel(node),
        nodeId: node.id,
        inputDbu: round1(input),
        gainDb: round1(gain),
        outputDbu: round1(level),
        clipDbu: clip,
        headroomDb: round1(headroom),
        overload,
        limited
      });
      stageIdx++;
    }
  }

  // 音箱端：输出电压 → 功率 → 1m SPL
  const spkModel = resolver.speaker(speaker.modelId);
  let powerW = 0;
  let spl1m = 0;
  if (spkModel) {
    const volts = dbuToVolts(level);
    powerW = (volts * volts) / spkModel.nominalImpedance;
    const safePower = Math.max(powerW, 1e-9);
    const powerDb = 10 * Math.log10(safePower);
    spl1m = spkModel.sensitivity + powerDb + speaker.gainOffset;
    const overload = powerW > spkModel.powerHandling * 1.05;
    if (overload && firstOverload < 0) firstOverload = stages.length;
    stages.push({
      stage: `音箱 ${speaker.name}`,
      nodeId: speaker.id,
      inputDbu: round1(level),
      gainDb: 0,
      outputDbu: round1(voltsToDbu(volts)),
      clipDbu: round1(voltsToDbu(Math.sqrt(spkModel.powerHandling * spkModel.nominalImpedance))),
      headroomDb: round1(10 * Math.log10(spkModel.powerHandling / safePower)),
      overload,
      limited: false
    });
  }

  return {
    speakerId: speaker.id,
    speakerName: speaker.name,
    stages,
    powerW: round1(powerW),
    spl1m: round1(spl1m),
    firstOverload
  };
}

/** 由音箱端实际驱动功率反推 driveDb（相对额定节目功率），供声场引擎使用 */
export function driveDbFromBudget(budget: SpeakerBudget): number {
  const spkStage = budget.stages[budget.stages.length - 1];
  if (!spkStage) return -20;
  return -Math.max(0, spkStage.headroomDb);
}

function nodeLabel(n: SignalNode): string {
  const kind = { mixer: '调音台', processor: '处理器', amp: '功放', speaker: '音箱' }[n.kind];
  return `${kind} · ${n.name}`;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
