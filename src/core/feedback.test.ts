import { describe, expect, it } from 'vitest';
import { defaultSpeakerModels } from './defaults';
import { analyzeFeedback, micPolarDb } from './feedback';
import type { Microphone } from './types';
import type { SpeakerInstance } from './speakers';

const model = defaultSpeakerModels().find((m) => m.id === 'spk_ps15')!;

function speaker(over: Partial<SpeakerInstance> = {}): SpeakerInstance {
  return {
    uid: 's1',
    model,
    position: { x: 2, y: 6, z: 5 },
    azimuth: 0,
    tilt: -10,
    dsp: undefined,
    amp: { ampId: 'a', channel: 1 },
    lineArrayId: null,
    name: '主扩',
    ...over,
  };
}

const mic: Microphone = {
  id: 'm1',
  name: '主持话筒',
  position: { x: 1, y: 6, z: 1.5 },
  azimuth: 0,
  tilt: 0,
};

describe('啸叫余量', () => {
  it('话筒正对音箱时拾取最强，背对时衰减', () => {
    const front = micPolarDb(mic, { x: 0, y: 6, z: 1.5 }); // 主轴 -x 方向
    const back = micPolarDb(mic, { x: 8, y: 6, z: 1.5 }); // 正后方 +x
    expect(front).toBeCloseTo(0, 1);
    expect(back).toBeLessThan(-15);
  });

  it('拉高系统增益会压缩啸叫余量', () => {
    const spk = speaker();
    const low = analyzeFeedback(mic, [spk], { systemGainDb: -20 });
    const high = analyzeFeedback(mic, [spk], { systemGainDb: 0 });
    expect(high.minMarginDb).toBeLessThan(low.minMarginDb);
    expect(high.worstFreqs).toHaveLength(3);
    expect(high.bands).toHaveLength(8);
  });

  it('哑音音箱不参与回路', () => {
    const muted = speaker({
      uid: 's2',
      dsp: {
        highpass: null,
        lowpass: null,
        eq: [],
        limiterThresholdDbu: 18,
        limiterRatio: 10,
        gainDb: 0,
        delayMs: 0,
        muted: true,
      },
    });
    const r = analyzeFeedback(mic, [muted]);
    expect(r.minMarginDb).toBeGreaterThan(30);
  });

  it('话筒离音箱越近余量越小', () => {
    const spk = speaker();
    const near = analyzeFeedback({ ...mic, position: { x: 1.9, y: 6, z: 4.5 } }, [spk]);
    const far = analyzeFeedback({ ...mic, position: { x: 0.5, y: 6, z: 1.5 } }, [spk]);
    expect(near.minMarginDb).toBeLessThan(far.minMarginDb);
  });
});
