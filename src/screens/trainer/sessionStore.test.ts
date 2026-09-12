import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory localStorage before the stores load (settings.ts / srs.ts / progress.ts read it at import time).
vi.hoisted(() => {
  const map = new Map<string, string>();
  const mem = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: mem, configurable: true, writable: true });
});

import { seedRandom } from '../../poker/hands';
import { getProgress, resetProgress } from '../../state/progress';
import { resetSettings, updateSettings } from '../../state/settings';
import { getCard, resetSrs } from '../../state/srs';
import {
  choose,
  currentCard,
  discardSession,
  endSession,
  expire,
  expireThink,
  flagToggle,
  getSession,
  next,
  prev,
  rateCard,
  resetSessionStore,
  revealNow,
  setHolding,
  startSession,
  togglePause,
  type SessionConfig,
} from './sessionStore';

const BASE: SessionConfig = { deck: 'rfi', positions: ['UTG', 'HJ', 'CO'], size: 10, speed: 'normal', exposure: false, manual: false };
/** call 50 % / fold 50 % → answer call, fold = partial (≥ 0.4), fourbet = wrong. */
const MIXED_KEY = 'vs_3bet:UTG:HJ|ATs';

function start(over: Partial<SessionConfig> = {}) {
  const r = startSession({ ...BASE, ...over });
  expect(r.ok).toBe(true);
  return getSession()!;
}

describe('sessionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seedRandom(7);
    resetSettings();
    resetSrs();
    resetProgress();
    resetSessionStore();
    updateSettings({ coachSeen: 2, haptics: false });
  });
  afterEach(() => {
    resetSessionStore();
    vi.useRealTimers();
  });

  it('starts running with a dealt queue of the configured size and settles after the transition', () => {
    const s = start();
    expect(s.status).toBe('running');
    expect(s.queue).toHaveLength(10);
    expect(s.phase).toBe('think');
    expect(s.settling).toBe(true);
    expect(s.coachOpen).toBe(false);
    for (const c of s.queue) expect(c.cards).toHaveLength(2);
    vi.advanceTimersByTime(300);
    expect(getSession()!.settling).toBe(false);
  });

  it('shows the coach mark on a fresh install', () => {
    updateSettings({ coachSeen: 0 });
    expect(start().coachOpen).toBe(true);
  });

  it('fails without charts and leaves the store idle', () => {
    const r = startSession({ ...BASE, deck: 'rfi', positions: ['BB'] });
    expect(r).toEqual({ ok: false, reason: 'no_charts' });
    expect(getSession()).toBeNull();
  });

  it('choosing the correct action reveals, rates know, and the reveal expiry writes srs + progress once', () => {
    start();
    const card = currentCard()!;
    expect(choose(card.step.answer)).toBe(true);
    let s = getSession()!;
    expect(s.phase).toBe('reveal');
    expect(currentCard()).toMatchObject({ chosenAction: card.step.answer, grade: 'correct', rating: 'know', ratingSource: 'button' });
    expect(choose(card.step.answer)).toBe(false); // one choice per card
    expire(); // reveal → next
    s = getSession()!;
    expect(s.index).toBe(1);
    expect(s.phase).toBe('think');
    expect(s.queue[0].exposed).toBe(true);
    expect(s.queue[0].committedRating).toBe('know');
    expect(getCard(card.key)?.state).toBe('learning');
    expect(getProgress(20).today).toMatchObject({ cards: 1, rated: 1, known: 1 });
    expect(s.queue).toHaveLength(10); // no requeue
  });

  it('choosing a wrong action rates unsure and requeues', () => {
    const s0 = start({ onlyKeys: [MIXED_KEY], manual: true });
    const key = s0.queue[0].key;
    expect(choose('fourbet')).toBe(true);
    expect(currentCard()).toMatchObject({ chosenAction: 'fourbet', grade: 'wrong', rating: 'unsure' });
    next();
    const s = getSession()!;
    expect(s.queue[0].committedRating).toBe('unsure');
    expect(getCard(key)?.state).toBe('relearning');
    expect(s.queue).toHaveLength(2);
    expect(s.queue[1]).toMatchObject({ key, origin: 'requeue' });
    expect(getProgress(20).today).toMatchObject({ cards: 1, rated: 1, known: 0 });
  });

  it('a partial action counts as know with the partial srs write', () => {
    start({ onlyKeys: [MIXED_KEY], manual: true });
    const key = currentCard()!.key;
    expect(choose('fold')).toBe(true);
    expect(currentCard()).toMatchObject({ chosenAction: 'fold', grade: 'partial', rating: 'know' });
    next();
    const c = getCard(key)!;
    expect(c.state).toBe('learning');
    expect(c.lastRating).toBe('know');
    expect(getProgress(20).today).toMatchObject({ cards: 1, rated: 1, known: 1 });
  });

  it('think timeout → 시간 초과, rated unsure; buttons are then locked', () => {
    start();
    const key = currentCard()!.key;
    expire(); // think timer ran out
    const s = getSession()!;
    expect(s.phase).toBe('reveal');
    expect(currentCard()).toMatchObject({ timedOut: true, rating: 'unsure', ratingSource: 'button' });
    expect(currentCard()!.chosenAction).toBeUndefined();
    expect(choose(currentCard()!.step.answer)).toBe(false);
    expire(); // reveal → next
    expect(getSession()!.index).toBe(1);
    expect(getCard(key)?.state).toBe('relearning');
    expect(getProgress(20).today).toMatchObject({ cards: 1, rated: 1, known: 0 });
  });

  it('explicit rateCard is refused in think phase and advances at once in reveal', () => {
    start();
    expect(rateCard('know', 'button')).toBe(false);
    revealNow();
    expect(rateCard('know', 'button')).toBe(true);
    expect(getSession()!.index).toBe(1);
  });

  it('헷갈려요 requeues the card at min(i+6, end), at most twice', () => {
    const s0 = start();
    const key = s0.queue[0].key;
    revealNow();
    rateCard('unsure', 'button');
    let s = getSession()!;
    expect(s.queue).toHaveLength(11);
    expect(s.queue[6]).toMatchObject({ key, origin: 'requeue' });
    expect(s.queue[6].exposed).toBeFalsy();
    expect(getCard(key)?.state).toBe('relearning');
    // walk to the requeued copy, rate unsure again → second copy; a third 헷갈려요 does not requeue
    while (getSession()!.index < 6) {
      revealNow();
      next();
    }
    expect(currentCard()!.key).toBe(key);
    revealNow();
    rateCard('unsure', 'button');
    s = getSession()!;
    expect(s.queue).toHaveLength(12);
    expect(s.requeues[key]).toBe(2);
    while (getSession()!.status === 'running' && currentCard()!.key !== key) {
      revealNow();
      next();
    }
    expect(currentCard()!.origin).toBe('requeue');
    revealNow();
    rateCard('unsure', 'button');
    expect(getSession()!.queue).toHaveLength(12);
    expect(getSession()!.queue.filter((c) => c.key === key)).toHaveLength(3);
  });

  it('exposure-mode timeout counts as exposure only (no automatic unsure)', () => {
    start({ exposure: true });
    const key = currentCard()!.key;
    expect(getSession()!.phase).toBe('reveal');
    expect(choose(currentCard()!.step.answer)).toBe(false); // no choosing in 노출
    expire(); // expose dwell → next
    expect(getSession()!.index).toBe(1);
    expect(getCard(key)).toMatchObject({ state: 'new', exposures: 1 });
    expect(getProgress(20).today).toMatchObject({ cards: 1, rated: 0 });
  });

  it('순간기억 has no choosing: the think timer just reveals, exposure only', () => {
    start({ speed: 'flash' });
    const key = currentCard()!.key;
    expect(choose(currentCard()!.step.answer)).toBe(false);
    expireThink();
    expect(getSession()!.phase).toBe('reveal');
    expect(currentCard()!.timedOut).toBeUndefined();
    expect(currentCard()!.rating).toBeUndefined();
    expire();
    expect(getCard(key)).toMatchObject({ state: 'new', exposures: 1 });
  });

  it('holding in think phase keeps the phase, marks the card peeked, and a later choice counts as unsure', () => {
    start();
    const key = currentCard()!.key;
    setHolding(true);
    let s = getSession()!;
    expect(s.holding).toBe(true);
    expect(s.phase).toBe('think');
    expect(currentCard()!.peeked).toBe(true);
    setHolding(false);
    expect(choose(currentCard()!.step.answer)).toBe(true);
    expect(currentCard()).toMatchObject({ grade: 'correct', rating: 'unsure' });
    expect(rateCard('know', 'button')).toBe(false); // peeked rule
    expire();
    s = getSession()!;
    expect(s.index).toBe(1);
    expect(s.queue[0].committedRating).toBe('unsure');
    expect(getCard(key)?.state).toBe('relearning');
  });

  it('헷갈려요로 표시 on a correct card commits it as unsure', () => {
    start();
    const key = currentCard()!.key;
    choose(currentCard()!.step.answer);
    expect(currentCard()!.rating).toBe('know');
    flagToggle();
    expect(currentCard()!.flagged).toBe(true);
    expire();
    const s = getSession()!;
    expect(s.queue[0].committedRating).toBe('unsure');
    expect(getCard(key)?.state).toBe('relearning');
    expect(s.queue).toHaveLength(11); // requeued
    expect(getProgress(20).today).toMatchObject({ cards: 1, rated: 1, known: 0 });
  });

  it('◀ revisits the previous card in reveal phase and a changed rating is written as a delta', () => {
    start();
    choose(currentCard()!.step.answer);
    expire();
    expect(getProgress(20).today).toMatchObject({ cards: 1, rated: 1, known: 1 });
    prev();
    let s = getSession()!;
    expect(s.index).toBe(0);
    expect(s.phase).toBe('reveal');
    expect(currentCard()!.chosenAction).toBeDefined();
    rateCard('unsure', 'button');
    s = getSession()!;
    expect(s.index).toBe(1);
    expect(s.queue[0].committedRating).toBe('unsure');
    expect(getProgress(20).today).toMatchObject({ cards: 1, rated: 1, known: 0 });
  });

  it('pause toggles between running and paused', () => {
    start();
    togglePause();
    expect(getSession()!.status).toBe('paused');
    togglePause();
    expect(getSession()!.status).toBe('running');
  });

  it('노출 모드 starts in reveal and tap-flag marks 헷갈려요 on leave', () => {
    start({ exposure: true });
    expect(getSession()!.phase).toBe('reveal');
    const key = currentCard()!.key;
    flagToggle();
    expect(currentCard()!.flagged).toBe(true);
    expire();
    expect(getSession()!.index).toBe(1);
    expect(getCard(key)?.state).toBe('relearning');
    expect(getSession()!.queue).toHaveLength(11); // requeued
  });

  it('✕ writes a partial summary that counts a revealed current card', () => {
    start();
    choose(currentCard()!.step.answer);
    expire();
    revealNow(); // second card revealed but not rated
    const r = endSession()!;
    const s = getSession()!;
    expect(s.status).toBe('summary');
    expect(s.endedEarly).toBe(true);
    expect(r.seen).toBe(2);
    expect(r).toMatchObject({ rated: 1, known: 1, unsure: 0, mode: 'train', exposureOnly: false });
    expect(getProgress(20).lastResult?.id).toBe(s.id);
    expect(getProgress(20).today.sessions).toBe(1);
    expect(endSession()).toBe(r); // idempotent
  });

  it('finishes naturally after the last card with byOrigin / unsureKeys / goal fields', () => {
    updateSettings({ dailyGoal: 10 });
    start();
    const first = currentCard()!.key;
    expire(); // 시간 초과 → unsure
    expire();
    while (getSession()!.status === 'running') {
      choose(currentCard()!.step.answer);
      expire();
    }
    const s = getSession()!;
    expect(s.status).toBe('summary');
    expect(s.endedEarly).toBe(false);
    const r = s.result!;
    expect(r.seen).toBe(11);
    expect(r.byOrigin).toEqual({ new: 10, review: 0, unsure: 1 });
    expect(r.unsureKeys).toEqual([first]);
    expect(r.allKeys[0]).toBe(first);
    expect(r.allKeys).toHaveLength(10);
    expect(r.goalReachedNow).toBe(true);
    expect(r.weakest).toMatchObject({ unsure: 1 });
    expect(getProgress(10).today.cards).toBe(11);
  });

  it('onlyKeys sessions replay the given keys in order', () => {
    const s0 = start();
    const keys = s0.queue.slice(0, 3).map((c) => c.key);
    discardSession();
    expect(getSession()).toBeNull();
    const s = start({ onlyKeys: keys, manual: true });
    expect(s.queue.map((c) => c.key)).toEqual(keys);
    expect(s.config.manual).toBe(true);
  });
});
