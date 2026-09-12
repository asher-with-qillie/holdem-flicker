import { useCallback, useEffect, useState } from 'react';
import type { Action, ScenarioKind } from '../poker/types';

export interface Mistake {
  at: number;
  scenarioId: string;
  title: string;
  hand: string;
  answer: Action;
  chosen: Action;
}

export interface KindStat {
  attempts: number;
  correct: number;
}

export interface Stats {
  byKind: Partial<Record<ScenarioKind, KindStat>>;
  streak: number;
  bestStreak: number;
  mistakes: Mistake[];
  total: number;
  totalCorrect: number;
}

const EMPTY: Stats = { byKind: {}, streak: 0, bestStreak: 0, mistakes: [], total: 0, totalCorrect: 0 };
const KEY = 'holdem-flicker.stats.v1';

function load(): Stats {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Stats) } : EMPTY;
  } catch {
    return EMPTY;
  }
}

let current = load();
const listeners = new Set<(s: Stats) => void>();

function commit(next: Stats) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(current));
}

export function recordAnswer(kind: ScenarioKind, correct: boolean, mistake?: Omit<Mistake, 'at'>) {
  const k = current.byKind[kind] ?? { attempts: 0, correct: 0 };
  const streak = correct ? current.streak + 1 : 0;
  commit({
    ...current,
    byKind: { ...current.byKind, [kind]: { attempts: k.attempts + 1, correct: k.correct + (correct ? 1 : 0) } },
    streak,
    bestStreak: Math.max(current.bestStreak, streak),
    total: current.total + 1,
    totalCorrect: current.totalCorrect + (correct ? 1 : 0),
    mistakes: mistake ? [{ at: Date.now(), ...mistake }, ...current.mistakes].slice(0, 100) : current.mistakes,
  });
}

export function resetStats() {
  commit(EMPTY);
}

export function useStats(): Stats {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return s;
}

export function useResetStats() {
  return useCallback(() => resetStats(), []);
}
