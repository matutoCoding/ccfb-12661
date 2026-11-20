import type {
  AmpModel,
  Layout,
  SpeakerModel,
} from './types';

export interface BomLine {
  category: '音箱' | '功放' | '线缆' | '吊挂件';
  model: string;
  manufacturer: string;
  quantity: number;
  unit: string;
  /** 所属区域/楼层（用于分组核对） */
  zone: string;
  /** 单台功耗 W（仅功放/有源音箱） */
  powerW: number;
  /** 单件重量 kg（音箱/吊挂件） */
  weightKg: number;
}

export interface BomReport {
  lines: BomLine[];
  totalPowerW: number;
  /** 建议配电功率（含 20% 余量） */
  recommendedPowerW: number;
  totalRiggingWeightKg: number;
  speakerCount: number;
}

/** 推断设备所属区域（按 x 坐标粗分舞台/观众厅） */
function zoneOf(x: number, roomLength: number): string {
  if (x < roomLength * 0.18) return '舞台区';
  if (x > roomLength * 0.75) return '后区';
  return '观众厅';
}

/**
 * 生成设备清单。
 * 线缆按每只音箱一条音箱线 + 每条功放链路一条信号线估算；
 * 吊挂件按线阵列逐串统计（含主吊梁与安全绳各 1 件/串）。
 * 同型号设备跨区域时合并为一行，区域字段合并展示，便于按区域核对。
 */
export function generateBom(
  layout: Layout,
  speakerModels: Map<string, SpeakerModel>,
  ampModels: Map<string, AmpModel>,
  roomLength: number,
): BomReport {
  const key = (l: BomLine) => `${l.category}|${l.model}`;
  const map = new Map<string, BomLine>();
  const add = (line: BomLine) => {
    const k = key(line);
    const exist = map.get(k);
    if (exist) {
      exist.quantity += line.quantity;
      exist.powerW += line.powerW;
      exist.weightKg += line.weightKg;
      if (!exist.zone.includes(line.zone)) {
        exist.zone = exist.zone === '全场' || line.zone === '全场'
          ? '全场'
          : [...new Set([...exist.zone.split('/'), ...line.zone.split('/')])].join('/');
      }
    } else {
      map.set(k, { ...line });
    }
  };

  const countSpeaker = (s: { speakerModelId: string; position: { x: number } }, qty: number) => {
    const m = speakerModels.get(s.speakerModelId);
    if (!m) return;
    add({
      category: '音箱',
      model: m.name,
      manufacturer: m.manufacturer,
      quantity: qty,
      unit: '只',
      zone: zoneOf(s.position.x, roomLength),
      powerW: m.powerConsumption * qty,
      weightKg: m.weight * qty,
    });
  };

  for (const s of layout.speakers) countSpeaker(s, 1);
  for (const a of layout.lineArrays) {
    countSpeaker({ speakerModelId: a.speakerModelId, position: a.hangPoint }, a.interAngles.length);
    add({
      category: '吊挂件',
      model: '线阵列主吊梁组件',
      manufacturer: 'StudioGen',
      quantity: 1,
      unit: '套',
      zone: zoneOf(a.hangPoint.x, roomLength),
      powerW: 0,
      weightKg: 12,
    });
    add({
      category: '吊挂件',
      model: '安全绳/卸扣组',
      manufacturer: 'StudioGen',
      quantity: a.interAngles.length,
      unit: '件',
      zone: zoneOf(a.hangPoint.x, roomLength),
      powerW: 0,
      weightKg: 0.8 * a.interAngles.length,
    });
  }

  // 功放：按绑定关系统计实际占用的物理机
  const ampUsage = new Map<string, { amp: AmpModel; zones: Set<string> }>();
  const consume = (binding: { ampId: string }, posX: number) => {
    const amp = ampModels.get(binding.ampId);
    if (!amp) return;
    let entry = ampUsage.get(amp.id);
    if (!entry) {
      entry = { amp, zones: new Set() };
      ampUsage.set(amp.id, entry);
    }
    entry.zones.add(zoneOf(posX, roomLength));
  };
  for (const s of layout.speakers) consume(s.amp, s.position.x);
  for (const a of layout.lineArrays) {
    const channelsNeeded = a.interAngles.length || 1;
    const amp = ampModels.get(a.ampBindings[0]?.ampId ?? '');
    if (amp) {
      const units = Math.ceil(channelsNeeded / amp.channels);
      add({
        category: '功放',
        model: amp.name,
        manufacturer: amp.manufacturer,
        quantity: units,
        unit: '台',
        zone: zoneOf(a.hangPoint.x, roomLength),
        powerW: amp.powerConsumption * units,
        weightKg: amp.weight * units,
      });
    }
  }
  for (const [, entry] of ampUsage) {
    // 点声源功放（线阵列已单独统计）：去重后按机数
    const usedByLineArrays = layout.lineArrays.some((a) =>
      a.ampBindings.some((b) => b.ampId === entry.amp.id),
    );
    if (usedByLineArrays) continue;
    add({
      category: '功放',
      model: entry.amp.name,
      manufacturer: entry.amp.manufacturer,
      quantity: 1,
      unit: '台',
      zone: [...entry.zones].join('/'),
      powerW: entry.amp.powerConsumption,
      weightKg: entry.amp.weight,
    });
  }

  // 线缆：每只发声单元一条音箱线，每台功放一条信号线
  const totalSpeakers =
    layout.speakers.length +
    layout.lineArrays.reduce((s, a) => s + a.interAngles.length, 0);
  const ampCount = [...map.values()]
    .filter((l) => l.category === '功放')
    .reduce((s, l) => s + l.quantity, 0);
  add({
    category: '线缆',
    model: '2×4mm² 音箱线缆（20m 成套）',
    manufacturer: 'StudioGen',
    quantity: totalSpeakers,
    unit: '条',
    zone: '全场',
    powerW: 0,
    weightKg: 0,
  });
  add({
    category: '线缆',
    model: '四芯模拟信号线（5m）',
    manufacturer: 'StudioGen',
    quantity: ampCount,
    unit: '条',
    zone: '机房',
    powerW: 0,
    weightKg: 0,
  });

  const lines = [...map.values()].sort((a, b) => a.category.localeCompare(b.category, 'zh'));
  const totalPowerW = lines.reduce((s, l) => s + l.powerW, 0);
  const totalRiggingWeightKg = lines
    .filter((l) => l.category === '音箱' || l.category === '吊挂件')
    .reduce((s, l) => s + l.weightKg, 0);
  return {
    lines,
    totalPowerW,
    recommendedPowerW: Math.ceil(totalPowerW * 1.2 / 100) * 100,
    totalRiggingWeightKg,
    speakerCount: totalSpeakers,
  };
}

/** 布局中全部音箱占用的功放通道数 */
export function occupiedAmpChannels(layout: Layout): number {
  return (
    layout.speakers.length +
    layout.lineArrays.reduce((s: number, a) => s + Math.max(1, a.interAngles.length), 0)
  );
}
