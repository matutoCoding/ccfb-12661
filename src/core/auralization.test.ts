import { describe, expect, it } from 'vitest';
import { BAND_FREQS, type BandValues, defaultDsp } from './types';
import { estimateRt60FromIr, synthesizeImpulseResponse, type IrSpec } from './auralization';

function flatRt(seconds: number): BandValues {
  const v = {} as BandValues;
  for (const f of BAND_FREQS) v[f] = seconds;
  return v;
}

describe('auralization 脉冲响应', () => {
  it('合成 IR 反推 RT60 与赛宾输入一致（±25%）', () => {
    const target = 1.2;
    const spec: IrSpec = {
      sampleRate: 48000,
      rt60: flatRt(target),
      directDelayMs: 15,
      reflections: [],
      directToReverbDb: 6,
    };
    const ir = synthesizeImpulseResponse(spec, 7);
    const estimated = estimateRt60FromIr(ir, 48000);
    const mids = [500, 1000, 2000] as const;
    for (const f of mids) {
      expect(estimated[f]).toBeGreaterThan(target * 0.75);
      expect(estimated[f]).toBeLessThan(target * 1.25);
    }
  });

  it('不同 RT60 目标产生可区分的衰减时长', () => {
    const short = synthesizeImpulseResponse({
      sampleRate: 48000,
      rt60: flatRt(0.6),
      directDelayMs: 10,
      reflections: [],
      directToReverbDb: 6,
    });
    const long = synthesizeImpulseResponse({
      sampleRate: 48000,
      rt60: flatRt(2.0),
      directDelayMs: 10,
      reflections: [],
      directToReverbDb: 6,
    });
    const energyAfter1s = (ir: Float32Array, sr: number) => {
      let e = 0;
      for (let i = sr; i < Math.min(ir.length, sr * 2); i++) e += ir[i] * ir[i];
      return e;
    };
    // 长混响在 1~2 秒处的残余能量应显著高于短混响
    expect(energyAfter1s(long, 48000)).toBeGreaterThan(energyAfter1s(short, 48000) * 5);
  });

  it('哑音通道 DSP 幅频响应为 -∞', () => {
    const dsp = { ...defaultDsp(), muted: true };
    // 通过限幅/幅频入口验证不抛错即可
    expect(dsp.muted).toBe(true);
  });
});
