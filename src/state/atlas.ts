/**
 * 자리별 보기(HandAtlas) 스토어 (docs/ATLAS_SPEC.md §2) — nav.ts 와 같은 모양의 모듈 스토어.
 *
 *   openAtlas({ hand, origin?, compare?, mode? })   루트의 <HandAtlasSheet/> 가 열립니다
 *   closeAtlas()                                    닫습니다
 *   useAtlas()                                      지금 열려 있는 intent (없으면 null)
 *
 * 훈련 세션이 running 이면 여는 쪽에서 togglePause() 하고 pausedByAtlas 를 기억해 둡니다.
 * 닫을 때는 **우리가 멈춘 것일 때만** 재개합니다 — 사용자가 먼저 ‖ 로 멈춘 세션은 닫아도 멈춘 채로 둡니다.
 *
 * 규칙: 아틀라스는 원래 열려 있던 시트를 대체합니다. 모든 진입점은 자기 시트를 먼저 닫고 openAtlas() 를 부릅니다
 * (화면 위에 시트는 항상 한 장).
 */
import { useSyncExternalStore } from 'react';
import type { HandName, Scenario } from '../poker/types';
import { getSession, togglePause } from '../screens/trainer/sessionStore';

export interface AtlasIntent {
  hand: HandName;
  /** 들어온 칸 — 민트 링 + 미리 선택 */
  origin?: Scenario;
  /** 오답에서 들어온 경우 — 하늘색 링 + 비교 자동 실행 */
  compare?: Scenario;
  /** 'pick' = 손패 고르기 화면부터 (기본 'atlas') */
  mode?: 'atlas' | 'pick';
}

let current: AtlasIntent | null = null;
let pausedByAtlas = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

const getSnapshot = () => current;

/** 훈련 세션이 running 이면 togglePause() 하고 pausedByAtlas = true. */
export function openAtlas(intent: AtlasIntent): void {
  if (!pausedByAtlas && getSession()?.status === 'running') {
    togglePause();
    pausedByAtlas = true;
  }
  // 새 객체로 — 같은 패로 다시 열어도 시트가 '새로 열림'으로 알아듣습니다.
  current = { ...intent };
  emit();
}

/**
 * pausedByAtlas && status === 'paused' 이면 togglePause() 로 재개.
 * `resume: false` 는 아틀라스에서 퀴즈로 넘어갈 때 — 훈련 탭을 떠나는데 세션 시계를 다시 돌리면 안 됩니다.
 */
export function closeAtlas(opts?: { resume?: boolean }): void {
  const wasPaused = pausedByAtlas;
  pausedByAtlas = false;
  if (wasPaused && opts?.resume !== false && getSession()?.status === 'paused') togglePause();
  if (!current) return;
  current = null;
  emit();
}

export function useAtlas(): AtlasIntent | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Non-hook read (event handlers). */
export function getAtlas(): AtlasIntent | null {
  return current;
}

/** Test hook. */
export function resetAtlasStore(): void {
  current = null;
  pausedByAtlas = false;
  emit();
}
