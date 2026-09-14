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
  /** 이 답을 받았을 때의 실수 개수. 다시 물어봐도 되는지는 hash 가 아니라 이 값으로 판단합니다. */
  mistakesUsed: number;
  /** 어떤 재료로 받은 답인지 화면에 적기 위해서만 씁니다. */
  hash: string;
}

export interface CoachAiState {
  /** 없으면 L2 가 꺼진 상태입니다. 기본 꺼짐. */
  key?: string;
  model: string;
  /**
   * 마지막으로 받은 답 하나.
   *
   * 예전에는 digest.hash 로 캐시했는데, 문제를 하나만 더 풀어도 hash 가 바뀌어 받아 둔 답이
   * 사라지고 유료 버튼이 다시 열렸습니다. 캐시가 과금을 막지 못한 것입니다. 그래서 hash 일치가
   * 아니라 '받은 뒤로 실수가 얼마나 늘었는가'로 다시 물어볼 때를 정합니다.
   */
  answer?: CoachAnswer;
}

const KEY = 'holdem-flicker.coach.v1';

/** 기본은 Opus. 값싼 모델은 설정에서 고릅니다 — 돈 쓰는 쪽을 정하는 건 사용자입니다(SPEC §8). */
export const DEFAULT_COACH_MODEL = 'claude-opus-5';

/** 설정 화면이 고르는 목록. 라벨에 모델 이름을 그대로 두는 건 사용자가 요금표를 찾아볼 수 있어야 해서입니다. */
export const COACH_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'claude-opus-5', label: '정확한 쪽 · Opus' },
  { id: 'claude-haiku-4-5', label: '값싼 쪽 · Haiku' },
];

/** 다시 물어봐도 되는 기준: 받은 뒤로 새 실수가 이만큼 쌓였거나, 하루가 지났을 때(SPEC §4). */
const ASK_AGAIN_MISTAKES = 10;
const ASK_AGAIN_MS = 24 * 60 * 60 * 1000;

const EMPTY: CoachAiState = { model: DEFAULT_COACH_MODEL };

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
  const out: CoachAiState = {
    key: typeof r.key === 'string' && r.key !== '' ? r.key : undefined,
    model: typeof r.model === 'string' && r.model !== '' ? r.model : DEFAULT_COACH_MODEL,
  };
  const a = r.answer;
  if (a && typeof a === 'object') {
    const v = a as Record<string, unknown>;
    if (typeof v.at === 'number' && Number.isFinite(v.at) && Array.isArray(v.cards)) {
      const cards = v.cards.map(readCard).filter((c): c is CoachCard => c !== null);
      if (cards.length > 0) {
        out.answer = {
          at: v.at,
          cards,
          mistakesUsed: typeof v.mistakesUsed === 'number' && Number.isFinite(v.mistakesUsed) ? v.mistakesUsed : 0,
          hash: typeof v.hash === 'string' ? v.hash : '',
        };
      }
    }
  }
  return out;
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
/** 마지막으로 받아 둔 답. 재료가 조금 바뀌었어도 그대로 보여 줍니다 — 돈은 이미 냈습니다. */
export function lastAnswer(): CoachAnswer | null {
  return read().answer ?? null;
}

export function remember(hash: string, cards: CoachCard[], mistakesUsed: number, now: number = Date.now()): void {
  write({ ...read(), answer: { at: now, cards, mistakesUsed, hash } });
}

/**
 * 다시 물어봐도 되는가. hash 가 아니라 '받은 뒤로 실수가 얼마나 늘었는가'로 봅니다 —
 * 문제 하나 더 풀었다고 같은 답을 돈 내고 다시 받게 하면 안 됩니다.
 */
export function canAskAgain(mistakesUsed: number, now: number = Date.now()): boolean {
  const a = read().answer;
  if (!a) return true;
  return mistakesUsed - a.mistakesUsed >= ASK_AGAIN_MISTAKES || now - a.at >= ASK_AGAIN_MS;
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
  /** 마지막으로 받아 둔 답 (없으면 null). */
  answer: CoachAnswer | null;
  canAskAgain: (mistakesUsed: number) => boolean;
  remember: (hash: string, cards: CoachCard[], mistakesUsed: number) => void;
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
    answer: s.answer ?? null,
    canAskAgain: useCallback((used: number) => canAskAgain(used), []),
    remember: useCallback((hash: string, cards: CoachCard[], used: number) => remember(hash, cards, used), []),
  };
}
