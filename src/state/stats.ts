import { useCallback, useEffect, useState } from 'react';
import type { Action, ScenarioKind } from '../poker/types';

export interface Mistake {
  at: number;
  scenarioId: string;
  title: string;
  hand: string;
  answer: Action;
  chosen: Action;
  /** 어느 탭에서 낸 실수인가. 예전에 저장된 항목에는 없어서 읽을 때 'quiz'로 봅니다. */
  src?: 'quiz' | 'train';
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
/** 보관하는 실수 개수. 코치 탭의 성향 축이 '옛날엔 이랬는데 고쳤다'를 보려면 과거가 남아 있어야 합니다. */
const MISTAKE_CAP = 300;

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
    mistakes: mistake ? [{ at: Date.now(), ...mistake }, ...current.mistakes].slice(0, MISTAKE_CAP) : current.mistakes,
  });
}

/**
 * 실수만 기록합니다 — 정답률·연속 기록은 건드리지 않습니다.
 *
 * 훈련 탭은 퀴즈가 아니라서 `recordAnswer`의 정답률 통계에 섞이면 안 되지만,
 * 코치 탭은 훈련에서 낸 실수도 성향의 재료로 써야 합니다. 그 둘을 나누는 입구입니다.
 */
export function recordMistake(mistake: Omit<Mistake, 'at'>) {
  commit({ ...current, mistakes: [{ at: Date.now(), ...mistake }, ...current.mistakes].slice(0, MISTAKE_CAP) });
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
