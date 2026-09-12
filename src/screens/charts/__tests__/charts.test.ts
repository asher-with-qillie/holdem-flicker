import { describe, expect, it, vi } from 'vitest';

// srs.ts guards every storage access, but give it a real in-memory localStorage so flushes are exercised too.
vi.hoisted(() => {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => void map.set(k, String(v)),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: (i: number) => [...map.keys()][i] ?? null,
      get length() {
        return map.size;
      },
    },
    configurable: true,
    writable: true,
  });
});

import { stepFor } from '../../../poker/trainer';
import type { Scenario } from '../../../poker/types';
import { rate, resetSrs, type SrsCard } from '../../../state/srs';
import { masteryFor, masteryOf } from '../mastery';
import { heroesFor, normalizeSelection, toScenario, villainsFor } from '../selection';

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

const card = (p: Partial<SrsCard>): SrsCard => ({
  key: 'rfi:UTG|AKs',
  kind: 'rfi',
  hero: 'UTG',
  hand: 'AKs',
  answer: 'raise',
  state: 'review',
  ease: 2.3,
  intervalDays: 3,
  due: NOW,
  reps: 1,
  lapses: 0,
  exposures: 1,
  quizWrong: 0,
  lastSeen: NOW,
  ...p,
});

describe('masteryOf (내 기록 overlay)', () => {
  it('is unseen without a record or before the first rating', () => {
    expect(masteryOf(undefined, NOW)).toBe('unseen');
    expect(masteryOf(card({ state: 'new', exposures: 4 }), NOW)).toBe('unseen');
  });

  it('is mastered for review cards with a 7-day interval, even after earlier lapses', () => {
    expect(masteryOf(card({ intervalDays: 7 }), NOW)).toBe('mastered');
    expect(masteryOf(card({ intervalDays: 12, lapses: 3, ease: 1.5 }), NOW)).toBe('mastered');
    expect(masteryOf(card({ intervalDays: 6 }), NOW)).not.toBe('mastered');
  });

  it('is weak on any lapse, low ease, or a quiz miss within 30 days (the §6.4 weak set)', () => {
    expect(masteryOf(card({ lapses: 1 }), NOW)).toBe('weak');
    expect(masteryOf(card({ state: 'relearning', lapses: 2 }), NOW)).toBe('weak');
    expect(masteryOf(card({ ease: 1.7 }), NOW)).toBe('weak');
    expect(masteryOf(card({ quizWrong: 1, quizWrongAt: NOW - 29 * DAY }), NOW)).toBe('weak');
    expect(masteryOf(card({ quizWrong: 1, quizWrongAt: NOW - 31 * DAY }), NOW)).toBe('learning');
  });

  it('is learning for every other rated card', () => {
    expect(masteryOf(card({ state: 'learning', intervalDays: 1 }), NOW)).toBe('learning');
    expect(masteryOf(card({ state: 'review', intervalDays: 3 }), NOW)).toBe('learning');
  });
});

describe('masteryFor', () => {
  it('maps all 169 hands and counts unseen only inside the learnable set', () => {
    resetSrs();
    const s: Scenario = { kind: 'rfi', hero: 'UTG' };
    rate(stepFor(s, 'AKs'), 'unsure', 'chart', { now: NOW });
    rate(stepFor(s, 'QQ'), 'know', 'chart', { now: NOW });
    const m = masteryFor(s, NOW);
    expect(Object.keys(m.overlay)).toHaveLength(169);
    expect(m.overlay.AKs).toBe('weak');
    expect(m.overlay.QQ).toBe('learning');
    expect(m.overlay['72o']).toBe('unseen');
    expect(m.counts).toEqual({ mastered: 0, learning: 1, weak: 1, unseen: m.learnable - 2 });
    expect(m.learnable).toBeGreaterThan(20);
    resetSrs();
  });
});

describe('chart selection', () => {
  it('coerces stale or partial selections into a valid kind × hero × villain', () => {
    expect(normalizeSelection(null)).toEqual({ kind: 'rfi', hero: 'UTG' });
    expect(normalizeSelection({ kind: 'rfi', hero: 'BB' }).hero).toBe('UTG'); // BB never opens
    expect(normalizeSelection({ kind: 'vs_open', hero: 'BB' })).toEqual({ kind: 'vs_open', hero: 'BB', villain: 'UTG' });
    expect(normalizeSelection({ kind: 'vs_open', hero: 'BB', villain: 'BB' }).villain).toBe('UTG');
    expect(normalizeSelection({ kind: 'cold_4bet', hero: 'UTG' }).hero).toBe('CO'); // needs two seats in front
    expect(normalizeSelection({ kind: 'nope' as never, hero: 'SB' })).toEqual({ kind: 'rfi', hero: 'SB' });
  });

  it('lists seats in preflop order and gives cold_4bet its display seats', () => {
    expect(heroesFor('rfi')).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB']);
    expect(villainsFor('vs_3bet', 'CO')).toEqual(['BTN', 'SB', 'BB']);
    expect(villainsFor('rfi', 'UTG')).toEqual([]);
    expect(toScenario({ kind: 'cold_4bet', hero: 'BTN' }).extras).toEqual({ opener: 'UTG', threeBettor: 'CO' });
    expect(toScenario({ kind: 'vs_open', hero: 'BB', villain: 'BTN' })).toEqual({ kind: 'vs_open', hero: 'BB', villain: 'BTN' });
  });
});
