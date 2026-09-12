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
  currentCard,
  discardSession,
  endSession,
  expire,
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
    updateSettings({ coachSeen: 1, haptics: false });
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

  it('think → reveal → rate writes srs + progress once and advances', () => {
    start();
    const card = currentCard()!;
    revealNow();
    expect(getSession()!.phase).toBe('reveal');
    expect(rateCard('know', 'swipe', 0)).toBe(true);
    const s = getSession()!;
    expect(s.index).toBe(1);
    expect(s.phase).toBe('think');
    expect(s.queue[0].exposed).toBe(true);
    expect(s.queue[0].committedRating).toBe('know');
    expect(getCard(card.key)?.state).toBe('learning');
    const today = getProgress(20).today;
    expect(today).toMatchObject({ cards: 1, rated: 1, known: 1 });
  });

  it('rating is refused in think phase and the fly-out delay defers the advance', () => {
    start();
    expect(rateCard('know', 'button')).toBe(false);
    revealNow();
    expect(rateCard('know', 'button', 240)).toBe(true);
    expect(getSession()!.exiting).toBe('know');
    expect(getSession()!.index).toBe(0);
    vi.advanceTimersByTime(240);
    expect(getSession()!.index).toBe(1);
    expect(getSession()!.exiting).toBeNull();
  });

  it('헷갈려요 requeues the card at min(i+6, end), at most twice', () => {
    const s0 = start();
    const key = s0.queue[0].key;
    revealNow();
    rateCard('unsure', 'button', 0);
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
    rateCard('unsure', 'button', 0);
    s = getSession()!;
    expect(s.queue).toHaveLength(12);
    expect(s.requeues[key]).toBe(2);
    while (getSession()!.status === 'running' && currentCard()!.key !== key) {
      revealNow();
      next();
    }
    expect(currentCard()!.origin).toBe('requeue');
    revealNow();
    rateCard('unsure', 'button', 0);
    expect(getSession()!.queue).toHaveLength(12);
    expect(getSession()!.queue.filter((c) => c.key === key)).toHaveLength(3);
  });

  it('unrated timeout counts as exposure only', () => {
    start();
    const key = currentCard()!.key;
    expire(); // think → reveal
    expect(getSession()!.phase).toBe('reveal');
    expire(); // reveal → next (unrated)
    expect(getSession()!.index).toBe(1);
    expect(getCard(key)).toMatchObject({ state: 'new', exposures: 1 });
    expect(getProgress(20).today).toMatchObject({ cards: 1, rated: 0 });
  });

  it('holding in think phase reveals and marks the card peeked; 알아요 is then refused, 헷갈려요 allowed', () => {
    start();
    setHolding(true);
    let s = getSession()!;
    expect(s.holding).toBe(true);
    expect(s.phase).toBe('reveal');
    expect(currentCard()!.peeked).toBe(true);
    setHolding(false);
    expect(rateCard('know', 'swipe', 0)).toBe(false);
    expect(rateCard('unsure', 'swipe', 0)).toBe(true);
    s = getSession()!;
    expect(s.index).toBe(1);
  });

  it('◀ revisits the previous card in reveal phase and a changed rating is written as a delta', () => {
    start();
    revealNow();
    rateCard('know', 'button', 0);
    expect(getProgress(20).today).toMatchObject({ cards: 1, rated: 1, known: 1 });
    prev();
    let s = getSession()!;
    expect(s.index).toBe(0);
    expect(s.phase).toBe('reveal');
    rateCard('unsure', 'button', 0);
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
    revealNow();
    rateCard('know', 'button', 0);
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
    revealNow();
    rateCard('unsure', 'swipe', 0);
    while (getSession()!.status === 'running') {
      revealNow();
      rateCard('know', 'swipe', 0);
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
