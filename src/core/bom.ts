import type {
  AmpModel, BOMItem, BOMResult, Layout, LineArray, SpeakerInstance, SpeakerModel
} from './types';

interface BOMCtx {
  speakers: Map<string, SpeakerModel>;
  amps: Map<string, AmpModel>;
}

/** 线缆估算：每只独立音箱一条喇叭线（按 25m 标准轴），每功放一条电源线，每阵列一组吊挂钢缆 */
export function computeBOM(layout: Layout, ctx: BOMCtx): BOMResult {
  const items = new Map<string, BOMItem>();
  const groups = new Set<string>();
  let totalPowerW = 0;
  let totalWeightKg = 0;

  const add = (item: Omit<BOMItem, 'quantity'> & { quantity?: number }) => {
    const key = `${item.category}|${item.modelId}|${item.group}`;
    const existing = items.get(key);
    if (existing) existing.quantity += item.quantity ?? 1;
    else items.set(key, { ...item, quantity: item.quantity ?? 1 });
    groups.add(item.group);
  };

  const standalone = layout.speakers.filter((s) => !s.arrayId);
  const arrayElements: SpeakerInstance[] = [];

  // 独立音箱
  for (const sp of standalone) {
    const model = ctx.speakers.get(sp.modelId);
    if (!model) continue;
    const group = zoneGroupOf(sp);
    add({ category: '音箱', modelId: model.id, name: `${model.manufacturer} ${model.model}`, unit: '只', group, weightEach: model.weight });
    totalWeightKg += model.weight;
    // 功放通道占用 → 功放统计在下方统一处理
    add({ category: '线缆', modelId: 'cable-spk', name: '喇叭线缆 2×2.5mm²（25m/条）', unit: '条', group });
  }

  // 线阵列（整串统计箱体 + 吊挂件）
  for (const arr of layout.arrays) {
    const model = ctx.speakers.get(arr.elementModelId);
    if (!model) continue;
    const group = `阵列·${arr.name}`;
    groups.add(group);
    add({
      category: '音箱',
      modelId: model.id,
      name: `${model.manufacturer} ${model.model}（线阵列单元）`,
      unit: '只',
      group,
      quantity: arr.count,
      weightEach: model.weight
    });
    totalWeightKg += model.weight * arr.count * 1.08;
    add({ category: '吊挂件', modelId: 'rigging-frame', name: `${arr.name} 吊挂框架 + 钢缆组件`, unit: '套', group });
    add({ category: '吊挂件', modelId: 'rigging-pick', name: `额定 ${arr.ratedPickLoad}kg 吊点卸扣`, unit: '个', group, quantity: Math.max(arr.pickPointCount, 1) });
    add({ category: '线缆', modelId: 'cable-array', name: '阵列多芯喇叭线缆（25m/条）', unit: '条', group });
    arrayElements.push(...layout.speakers.filter((s) => s.arrayId === arr.id));
  }

  // 功放：按信号图中的 amp 节点统计设备台数（通道数由型号决定）
  const ampNodes = layout.graph.nodes.filter((n) => n.kind === 'amp');
  for (const node of ampNodes) {
    const amp = node.deviceModelId ? ctx.amps.get(node.deviceModelId) : undefined;
    if (!amp) continue;
    const group = '机房/功放柜';
    add({
      category: '功放',
      modelId: amp.id,
      name: `${amp.manufacturer} ${amp.model}`,
      unit: '台',
      group,
      weightEach: amp.weight,
      powerEach: amp.power4R
    });
    // 功耗按 4Ω 额定 ×1/3 工程效率系数估算
    totalPowerW += amp.power4R * amp.channels * 0.33;
    totalWeightKg += amp.weight;
    add({ category: '线缆', modelId: 'cable-power', name: '功放电源专线（16A）', unit: '条', group });
  }

  // 处理器/调音台节点
  for (const node of layout.graph.nodes) {
    if (node.kind === 'processor') {
      add({ category: '处理器', modelId: node.deviceModelId ?? 'dsp', name: `数字音频处理器 · ${node.name}`, unit: '台', group: '机房/功放柜', powerEach: 60 });
      totalPowerW += 60;
    }
    if (node.kind === 'mixer') {
      add({ category: '调音台', modelId: node.deviceModelId ?? 'mixer', name: `数字调音台 · ${node.name}`, unit: '台', group: '机房/功放柜', powerEach: 120 });
      totalPowerW += 120;
    }
  }

  // 话筒
  for (const mic of layout.mics) {
    add({ category: '话筒', modelId: mic.pattern, name: `${mic.pattern === 'omni' ? '全指向' : '心形指向'}话筒 · ${mic.name}`, unit: '支', group: '舞台区' });
    add({ category: '线缆', modelId: 'cable-mic', name: '话筒线（10m/条）', unit: '条', group: '舞台区' });
  }

  const list = [...items.values()].sort((a, b) => a.group.localeCompare(b.group) || a.category.localeCompare(b.category));
  return {
    items: list,
    totalPowerW: Math.round(totalPowerW),
    totalWeightKg: Math.round(totalWeightKg * 10) / 10,
    groups: [...groups]
  };
}

function zoneGroupOf(sp: SpeakerInstance): string {
  // 按高度粗分楼座/池座，便于分区核对
  return sp.position.z > 6 ? '楼座/高位区' : '池座/主观众区';
}

export function arrayElementCount(arrays: LineArray[]): number {
  return arrays.reduce((n, a) => n + a.count, 0);
}
