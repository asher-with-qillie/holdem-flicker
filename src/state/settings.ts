import { useCallback, useEffect, useState } from 'react';
import { POSITIONS, type Pos, type ScenarioKind } from '../poker/types';

export interface Settings {
  positions: Pos[];
  kinds: ScenarioKind[];
  /** Seconds to think before the answer is revealed. */
  thinkSeconds: number;
  /** Seconds the answer stays before auto-advancing. */
  revealSeconds: number;
  autoAdvance: boolean;
  /** 0..1 probability of dealing a hand that is playable somewhere for the seat. */
  interestingBias: number;
  showMixFrequencies: boolean;
  haptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  positions: [...POSITIONS],
  kinds: ['rfi', 'vs_open', 'vs_3bet', 'vs_4bet', 'vs_5bet'],
  thinkSeconds: 4,
  revealSeconds: 3.5,
  autoAdvance: true,
  interestingBias: 0.6,
  showMixFrequencies: true,
  haptics: true,
};

const KEY = 'holdem-flicker.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
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
