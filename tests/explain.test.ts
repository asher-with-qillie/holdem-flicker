import { describe, expect, it } from 'vitest';
import { classifyHand, explainStep } from '../src/poker/explain';
import { stepFor, buildSteps, DEFAULT_SESSION_OPTIONS, nextHandSequence, randomQuizStep } from '../src/poker/trainer';
import type { Pos, ScenarioKind } from '../src/poker/types';
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

describe('settings-respecting sequences', () => {
  it('never produces a scenario kind that the settings exclude', () => {
    seedRandom(11);
    const cases: Array<{ positions: Pos[]; kinds: ScenarioKind[] }> = [
      { positions: ['UTG'], kinds: ['vs_open'] },
      { positions: ['BB'], kinds: ['rfi'] },
      { positions: ['UTG', 'HJ'], kinds: ['cold_4bet'] },
      { positions: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'], kinds: ['vs_5bet'] },
      { positions: ['UTG', 'HJ'], kinds: ['cold_4bet', 'vs_4bet'] },
    ];
    for (const c of cases) {
      const opts = { ...DEFAULT_SESSION_OPTIONS, ...c };
      for (let i = 0; i < 100; i++) {
        const seq = nextHandSequence(opts);
        for (const s of seq.steps) expect(c.kinds, `${c.positions}/${c.kinds} produced ${s.scenario.kind}`).toContain(s.scenario.kind);
      }
    }
  });
  it('returns empty steps when nothing is feasible and throws for quiz', () => {
    const opts = { ...DEFAULT_SESSION_OPTIONS, positions: ['UTG'] as Pos[], kinds: ['vs_open'] as ScenarioKind[] };
    expect(nextHandSequence(opts).steps).toEqual([]);
    expect(() => randomQuizStep(opts)).toThrow();
  });
});
