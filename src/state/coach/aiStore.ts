/**
 * L2 경로의 작은 스토어 — API 키·모델·응답 캐시. COACH_SPEC §4.
 *
 * **키는 평문으로 저장됩니다.** 이 앱에는 서버가 없어서 브라우저 저장소 말고 둘 곳이 없습니다.
 * 그래서 화면(ApiKeySheet)이 "공용 PC에서는 넣지 마세요"를 --coral 로 고정 노출하고 [키 지우기]를
 * 옆에 둡니다. 화면에 키를 그릴 때는 `maskKey` 만 씁니다 — 전체 문자열은 어디에도 그리지 않습니다.
 *
 * 캐시는 `digest.hash` 로 겁니다. 탭을 열 때마다 새로 물으면 사용자 돈이 나갑니다. 답은 최근
 * 세 개만 남깁니다 — 다이제스트가 바뀌면 옛 답은 이미 자기 기록이 아닙니다.
 *
 * 저장소를 읽는 코치 모듈은 digest.ts 와 여기 둘뿐이고, 겹치지 않습니다(다이제스트 재료는
 * digest.ts, 키와 캐시는 여기). import 만으로는 저장소를 건드리지 않습니다 — 첫 `read()` 때
 * 게으르게 읽습니다(테스트가 plain node 에서 돕니다).
 */
import { useCallback, useEffect, useState } from 'react';

import type { CoachCard } from './types';

export interface CoachAnswer {
  at: number;
  cards: CoachCard[];
}

export interface CoachAiState {
  /** 없으면 L2 가 꺼진 상태입니다. 기본 꺼짐. */
  key?: string;
  model: string;
  /** digest.hash → 그 다이제스트로 받은 답. */
  answers: Record<string, CoachAnswer>;
}

const KEY = 'holdem-flicker.coach.v1';

/** 기본은 Opus. 값싼 모델은 설정에서 고릅니다 — 돈 쓰는 쪽을 정하는 건 사용자입니다(SPEC §8). */
export const DEFAULT_COACH_MODEL = 'claude-opus-5';

/** 설정 화면이 고르는 목록. 라벨에 모델 이름을 그대로 두는 건 사용자가 요금표를 찾아볼 수 있어야 해서입니다. */
export const COACH_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'claude-opus-5', label: '정확한 쪽 · Opus' },
  { id: 'claude-haiku-4-5', label: '값싼 쪽 · Haiku' },
];

/** 남겨 두는 답의 개수. */
const MAX_ANSWERS = 3;

const EMPTY: CoachAiState = { model: DEFAULT_COACH_MODEL, answers: {} };

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readCard(v: unknown): CoachCard | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const { id, tone, title, evidence, steps, src } = r;
  if (typeof id !== 'string' || typeof title !== 'string' || typeof evidence !== 'string') return null;
  if (tone !== 'good' && tone !== 'tendency' && tone !== 'focus') return null;
  if (src !== 'rule' && src !== 'ai') return null;
  if (!Array.isArray(steps) || !steps.every((s) => typeof s === 'string')) return null;
  return { id, tone, title, evidence, steps: steps as string[], src };
}

/** 한 건이라도 모양이 어긋나면 그 건만 버립니다 — 옛 판 캐시 하나 때문에 키까지 날아가면 안 됩니다. */
function normalize(parsed: unknown): CoachAiState {
  if (!parsed || typeof parsed !== 'object') return EMPTY;
  const r = parsed as Record<string, unknown>;
  const answers: Record<string, CoachAnswer> = {};
  if (r.answers && typeof r.answers === 'object') {
    for (const [hash, v] of Object.entries(r.answers as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const a = v as Record<string, unknown>;
      if (typeof a.at !== 'number' || !Number.isFinite(a.at) || !Array.isArray(a.cards)) continue;
      const cards = a.cards.map(readCard).filter((c): c is CoachCard => c !== null);
      if (cards.length > 0) answers[hash] = { at: a.at, cards };
    }
  }
  return {
    key: typeof r.key === 'string' && r.key !== '' ? r.key : undefined,
    model: typeof r.model === 'string' && r.model !== '' ? r.model : DEFAULT_COACH_MODEL,
    answers: prune(answers),
  };
}

/** 최근 것부터 MAX_ANSWERS 개만 남깁니다. */
function prune(answers: Record<string, CoachAnswer>): Record<string, CoachAnswer> {
  const entries = Object.entries(answers).sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(entries.slice(0, MAX_ANSWERS));
}

let current: CoachAiState | null = null;
const listeners = new Set<(s: CoachAiState) => void>();

function read(): CoachAiState {
  if (current) return current;
  const s = storage();
  if (!s) {
    current = EMPTY;
    return current;
  }
  try {
    const raw = s.getItem(KEY);
    current = raw ? normalize(JSON.parse(raw) as unknown) : EMPTY;
  } catch {
    current = EMPTY;
  }
  return current;
}

function write(next: CoachAiState): void {
  current = next;
  const s = storage();
  if (s) {
    try {
      s.setItem(KEY, JSON.stringify(next));
    } catch {
      /* 저장소가 꽉 찼거나 막혀 있어도 이번 세션은 그대로 굴러갑니다. */
    }
  }
  listeners.forEach((l) => l(next));
}

export function getCoachAi(): CoachAiState {
  return read();
}

export function setKey(key: string): void {
  const trimmed = key.trim();
  write({ ...read(), key: trimmed === '' ? undefined : trimmed });
}

export function clearKey(): void {
  write({ ...read(), key: undefined });
}

export function setModel(model: string): void {
  write({ ...read(), model });
}

/** 같은 다이제스트로 이미 받아 둔 답. 없으면 null — 탭을 열 때마다 과금되지 않게 하는 장치입니다. */
export function cached(hash: string): CoachCard[] | null {
  return read().answers[hash]?.cards ?? null;
}

export function remember(hash: string, cards: CoachCard[], now: number = Date.now()): void {
  const s = read();
  write({ ...s, answers: prune({ ...s.answers, [hash]: { at: now, cards } }) });
}

/** 화면에 그려도 되는 형태 — 끝 4자만 남깁니다. 키 전체는 어디에도 그리지 않습니다. */
export function maskKey(key: string | undefined): string {
  if (!key) return '';
  return `····${key.slice(-4)}`;
}

export interface CoachAiHandle {
  key: string | undefined;
  model: string;
  setKey: (key: string) => void;
  clearKey: () => void;
  setModel: (model: string) => void;
  cached: (hash: string) => CoachCard[] | null;
  remember: (hash: string, cards: CoachCard[]) => void;
}

export function useCoachAi(): CoachAiHandle {
  const [s, setS] = useState<CoachAiState>(read);
  useEffect(() => {
    listeners.add(setS);
    return () => {
      listeners.delete(setS);
    };
  }, []);
  return {
    key: s.key,
    model: s.model,
    setKey: useCallback((k: string) => setKey(k), []),
    clearKey: useCallback(() => clearKey(), []),
    setModel: useCallback((m: string) => setModel(m), []),
    cached: useCallback((hash: string) => cached(hash), []),
    remember: useCallback((hash: string, cards: CoachCard[]) => remember(hash, cards), []),
  };
}
