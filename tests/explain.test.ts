import { describe, expect, it } from 'vitest';
import { classifyHand, explainStep } from '../src/poker/explain';
import { stepFor, buildSteps, DEFAULT_SESSION_OPTIONS, nextHandSequence } from '../src/poker/trainer';
import { seedRandom } from '../src/poker/hands';

describe('hand classes', () => {
  it('classifies representative hands', () => {
    expect(classifyHand('AA')).toBe('premium_pair');
    expect(classifyHand('JJ')).toBe('big_pair');
    expect(classifyHand('88')).toBe('mid_pair');
    expect(classifyHand('22')).toBe('small_pair');
    expect(classifyHand('AKo')).toBe('ak');
    expect(classifyHand('AJs')).toBe('big_ace');
    expect(classifyHand('A8s')).toBe('suited_ace');
    expect(classifyHand('A4s')).toBe('wheel_ace');
    expect(classifyHand('A9o')).toBe('offsuit_ace');
    expect(classifyHand('KJs')).toBe('suited_broadway');
    expect(classifyHand('QTo')).toBe('offsuit_broadway');
    expect(classifyHand('K6s')).toBe('suited_king');
    expect(classifyHand('Q5s')).toBe('suited_qj');
    expect(classifyHand('76s')).toBe('suited_connector');
    expect(classifyHand('97s')).toBe('suited_gapper');
    expect(classifyHand('98o')).toBe('offsuit_connector');
    expect(classifyHand('72o')).toBe('junk');
  });
});

describe('explanations', () => {
  it('fold has no postflop plan; open has one', () => {
    const fold = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, '72o'));
    expect(fold.postflop).toBeUndefined();
    expect(fold.reasoning.length).toBeGreaterThan(1);
    const open = explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, 'A5s'));
    expect(open.postflop).toBeDefined();
    expect(open.postflop!.checklist.length).toBeGreaterThanOrEqual(5);
    expect(open.postflop!.plan.length).toBeGreaterThan(0);
    expect(open.headline).toContain('A5s');
  });
  it('mixed hands get a frequency note', () => {
    const e = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'ATo'));
    expect(e.mixNote).toContain('50%');
  });
});

describe('trainer sequences', () => {
  it('builds an RFI step and never crashes over many deals', () => {
    seedRandom(7);
    for (let i = 0; i < 200; i++) {
      const seq = nextHandSequence(DEFAULT_SESSION_OPTIONS);
      expect(seq.steps.length).toBeGreaterThan(0);
      for (const s of seq.steps) expect(() => explainStep(s)).not.toThrow();
    }
  });
  it('BB never gets an rfi step; UTG never gets a vs_open step', () => {
    for (let i = 0; i < 30; i++) {
      expect(buildSteps('BB', 'AKs', DEFAULT_SESSION_OPTIONS).some((s) => s.scenario.kind === 'rfi')).toBe(false);
      expect(buildSteps('UTG', 'AKs', DEFAULT_SESSION_OPTIONS).some((s) => s.scenario.kind === 'vs_open')).toBe(false);
    }
  });
});
