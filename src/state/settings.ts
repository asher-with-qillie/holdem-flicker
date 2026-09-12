import { useCallback, useEffect, useState } from 'react';
import { POSITIONS, type Pos, type ScenarioKind } from '../poker/types';

export type SpeedPreset = 'slow' | 'normal' | 'fast' | 'flash' | 'custom';
export type DeckId = 'all' | 'rfi' | 'vs_open' | 'vs_3bet' | 'vs_4bet_allin' | 'weak' | 'scenario';

export interface Settings {
  positions: Pos[];
  kinds: ScenarioKind[];
  /** Seconds to think before the answer is revealed (written by `applySpeedPreset`; edited directly only by 고급 → 'custom'). */
  thinkSeconds: number;
  /** Seconds the answer stays before auto-advancing. */
  revealSeconds: number;
  autoAdvance: boolean;
  /** 0..1 probability of dealing a hand that is playable somewhere for the seat. */
  interestingBias: number;
  showMixFrequencies: boolean;
  haptics: boolean;
  /** v2 (spec §7.0) */
  speedPreset: SpeedPreset; // 'normal'
  exposureMode: boolean; // false — hand + answer shown together, no think phase
  sessionSize: 10 | 20 | 40; // 20
  dailyGoal: 10 | 20 | 40 | 80; // 20
  coachSeen: number; // 0 (bump the required value to re-show after a gesture change)
  lastDeck: DeckId; // 'all' (never 'scenario')
  lastPositions: Pos[] | null; // null = all of settings.positions
}

/** Exact per-preset timings in ms (spec §6.2). `custom` reads `thinkSeconds` / `revealSeconds` instead. */
export const SPEED_PRESETS: Record<Exclude<SpeedPreset, 'custom'>, { label: string; think: number; reveal: number; expose: number; transition: number }> = {
  slow: { label: '천천히', think: 6000, reveal: 4000, expose: 4000, transition: 300 },
  normal: { label: '보통', think: 3500, reveal: 2500, expose: 2500, transition: 300 },
  fast: { label: '빠르게', think: 1800, reveal: 1500, expose: 1500, transition: 220 },
  flash: { label: '순간기억', think: 250, reveal: 550, expose: 800, transition: 120 },
};

export const SPEED_PRESET_ORDER: ReadonlyArray<Exclude<SpeedPreset, 'custom'>> = ['slow', 'normal', 'fast', 'flash'];

/** Scenario kinds behind each focus deck (spec §6.4). 'all' uses `settings.kinds`; 'weak'/'scenario' are computed by srs.ts. */
export const DECK_KINDS: Record<Exclude<DeckId, 'weak' | 'scenario' | 'all'>, ScenarioKind[]> = {
  rfi: ['rfi'],
  vs_open: ['vs_open'],
  vs_3bet: ['vs_3bet'],
  vs_4bet_allin: ['vs_4bet', 'vs_5bet', 'cold_4bet'],
};

export const DEFAULT_SETTINGS: Settings = {
  positions: [...POSITIONS],
  kinds: ['rfi', 'vs_open', 'vs_3bet', 'vs_4bet', 'vs_5bet'],
  thinkSeconds: 3.5,
  revealSeconds: 2.5,
  autoAdvance: true,
  interestingBias: 0.6,
  showMixFrequencies: true,
  haptics: true,
  speedPreset: 'normal',
  exposureMode: false,
  sessionSize: 20,
  dailyGoal: 20,
  coachSeen: 0,
  lastDeck: 'all',
  lastPositions: null,
};

const KEY = 'holdem-flicker.settings.v1';

const SPEED_PRESET_IDS: readonly SpeedPreset[] = ['slow', 'normal', 'fast', 'flash', 'custom'];
const DECK_IDS: readonly DeckId[] = ['all', 'rfi', 'vs_open', 'vs_3bet', 'vs_4bet_allin', 'weak', 'scenario'];
const SESSION_SIZES: ReadonlyArray<Settings['sessionSize']> = [10, 20, 40];
const DAILY_GOALS: ReadonlyArray<Settings['dailyGoal']> = [10, 20, 40, 80];

function isPos(x: unknown): x is Pos {
  return typeof x === 'string' && (POSITIONS as readonly string[]).includes(x);
}

/** Merge partial storage over the defaults and coerce the v2 fields; v1 storage (no `speedPreset`) is migrated. */
function normalize(parsed: Partial<Settings>): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, ...parsed };
  if (!('speedPreset' in parsed)) {
    // v1 storage: seconds equal to the v1 defaults (4 / 3.5) or absent → the new 보통 preset; otherwise keep them as 사용자.
    const v1Default = (parsed.thinkSeconds ?? 4) === 4 && (parsed.revealSeconds ?? 3.5) === 3.5;
    if (v1Default) {
      s.speedPreset = 'normal';
      s.thinkSeconds = SPEED_PRESETS.normal.think / 1000;
      s.revealSeconds = SPEED_PRESETS.normal.reveal / 1000;
    } else {
      s.speedPreset = 'custom';
    }
  }
  if (!SPEED_PRESET_IDS.includes(s.speedPreset)) s.speedPreset = DEFAULT_SETTINGS.speedPreset;
  if (!SESSION_SIZES.includes(s.sessionSize)) s.sessionSize = DEFAULT_SETTINGS.sessionSize;
  if (!DAILY_GOALS.includes(s.dailyGoal)) s.dailyGoal = DEFAULT_SETTINGS.dailyGoal;
  if (!DECK_IDS.includes(s.lastDeck) || s.lastDeck === 'scenario') s.lastDeck = 'all';
  if (typeof s.coachSeen !== 'number' || !Number.isFinite(s.coachSeen)) s.coachSeen = 0;
  s.exposureMode = Boolean(s.exposureMode);
  if (s.lastPositions !== null) {
    const valid = Array.isArray(s.lastPositions) ? POSITIONS.filter((p) => (s.lastPositions as unknown[]).includes(p)) : [];
    s.lastPositions = valid.length ? valid : null;
  }
  if (!Array.isArray(s.positions) || !s.positions.every(isPos) || s.positions.length === 0) s.positions = [...POSITIONS];
  return s;
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return normalize(JSON.parse(raw) as Partial<Settings>);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function save(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  save(current);
  listeners.forEach((l) => l(current));
}

export function resetSettings() {
  current = DEFAULT_SETTINGS;
  save(current);
  listeners.forEach((l) => l(current));
}

/**
 * Select a speed preset. Writes `thinkSeconds` / `revealSeconds` too, so `useRafTimer` and the engine stay
 * untouched. `custom` only flips the preset (no timing change — the 고급 sliders own the seconds).
 */
export function applySpeedPreset(p: SpeedPreset): void {
  if (p === 'custom') {
    updateSettings({ speedPreset: 'custom' });
    return;
  }
  const t = SPEED_PRESETS[p];
  updateSettings({ speedPreset: p, thinkSeconds: t.think / 1000, revealSeconds: t.reveal / 1000 });
}

/** Effective timings (ms) for the current preset; `custom` → the seconds sliders (expose = reveal). */
export function presetTiming(s: Settings): { think: number; reveal: number; expose: number; transition: number } {
  if (s.speedPreset === 'custom') {
    const think = Math.round(s.thinkSeconds * 1000);
    const reveal = Math.round(s.revealSeconds * 1000);
    return { think, reveal, expose: reveal, transition: 300 };
  }
  const { think, reveal, expose, transition } = SPEED_PRESETS[s.speedPreset];
  return { think, reveal, expose, transition };
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  const update = useCallback((patch: Partial<Settings>) => updateSettings(patch), []);
  return [s, update];
}

export function vibrate(ms: number | number[]) {
  try {
    if (current.haptics && 'vibrate' in navigator) navigator.vibrate(ms);
  } catch {
    /* ignore */
  }
}
