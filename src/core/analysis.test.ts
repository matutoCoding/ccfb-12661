import { describe, expect, it } from 'vitest';
import { analyzeLevelBudget, theoreticalMaxSpl } from './analysis';
import { defaultDsp, type LevelBudgetChain } from './types';
import { defaultSpeakerModels } from './defaults';
import type { SpeakerInstance } from './speakers';

const model = defaultSpeakerModels().find((m) => m.id === 'spk_ps15')!;
const target: SpeakerInstance = {
  uid: 's1',
  model,
  position: { x: 2, y: 6, z: 5 },
  azimuth: 0,
  tilt: 0,
  dsp: undefined,
  amp: { ampId: 'a', channel: 1 },
  lineArrayId: null,
  name: '主扩',
};

function chain(over: Partial<LevelBudgetChain> = {}): LevelBudgetChain {
  return {
    id: 'c1',
    name: '主扩左',
    sourceLevelDbu: 4,
    stages: [
      { id: '1', name: '调音台输出', kind: 'mixer', maxOutputDbu: 22, gainDb: 0 },
      { id: '2', name: '处理器', kind: 'processor', maxOutputDbu: 20, gainDb: 0, dsp: defaultDsp() },
      { id: '3', name: '功放输入', kind: 'amp', maxOutputDbu: 18, gainDb: 0 },
    ],
    targetSpeakerId: 's1',
    ...over,
  };
}

describe('电平预算', () => {
  it('额定电平下各级均不过载且有余量', () => {
    const r = analyzeLevelBudget(chain(), target);
    expect(r.firstOverloadIndex).toBe(-1);
    expect(r.stages.every((s) => !s.overloaded)).toBe(true);
    expect(r.stages[0].headroomDb).toBeCloseTo(18, 1);
    expect(r.speakerMaxAchievableSpl).toBe(model.maxSPL);
  });

  it('增益过大时第一过载级被标红', () => {
    const c = chain();
    c.stages[0] = { ...c.stages[0], gainDb: 26 };
    const r = analyzeLevelBudget(c, target);
    expect(r.firstOverloadIndex).toBe(0);
    expect(r.stages[0].overloaded).toBe(true);
  });

  it('限幅器把超阈值电平压回阈值附近', () => {
    const c = chain();
    c.stages[1] = {
      ...c.stages[1],
      dsp: { ...defaultDsp(), limiterThresholdDbu: 10, limiterRatio: 20 },
      gainDb: 12,
    };
    const r = analyzeLevelBudget(c, target);
    const proc = r.stages[1];
    expect(proc.limiting).toBe(true);
    // 输入 16dBu，阈值 10dBu，超出 6dB 按 20:1 压缩 → 输出 10.3dBu
    expect(proc.outputDbu).toBeLessThanOrEqual(10.4);
    expect(proc.outputDbu).toBeGreaterThan(10);
  });

  it('理论最大 SPL = 灵敏度 + 10log(功率)', () => {
    expect(theoreticalMaxSpl(99, 500)).toBeCloseTo(99 + 10 * Math.log10(500), 2);
  });
});
