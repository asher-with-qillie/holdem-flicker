/*
 * 이 패 이유 — 키(상황 | 자리 쪽 | 패 가족 | 버킷) 하나에 문장 하나. docs/THEORY_SPEC.md §6.
 * 문장은 handReasons.data.ts 에 있고(책 원리로 쓰고 키의 모든 칸에서 참인지 검증한 것), 여기서는 자리표시만 채웁니다.
 *   {hand} {hero} {villain} · 조사가 붙는 꼴 {hand|은/는} {hero|이/가} {villain|을/를} …
 */
import { josa, type Josa } from '../ko';
import type { ActionMix, HandName, Scenario } from '../types';
import { HAND_REASONS } from './handReasons.data';
import { reasonKey, type ReasonKey } from './keys';
import type { PrincipleId } from './principles';

export interface HandReasonEntry {
  text: string;
  principles: PrincipleId[];
  /** 이 키의 결정이 책과 다를 때 한 문장(없으면 빈 문자열) */
  bookDiff: string;
}

const SLOT = /\{(hand|hero|villain)(?:\|([^}]+))?\}/g;

export function fillSlots(text: string, s: Scenario, hand: HandName): string {
  return text.replace(SLOT, (_m, name: 'hand' | 'hero' | 'villain', j?: string) => {
    const word = name === 'hand' ? hand : name === 'hero' ? s.hero : (s.villain ?? '');
    if (!j) return word;
    return j.includes('/') ? josa(word, j as Josa) : `${word}${j}`; // '의'처럼 받침과 상관없는 조사는 그대로 붙여요
  });
}

export function handReason(s: Scenario, hand: HandName, mix: ActionMix | undefined): { key: ReasonKey; text: string; principles: PrincipleId[]; bookDiff: string | null } | null {
  const key = reasonKey(s, hand, mix);
  const e = (HAND_REASONS as Record<string, HandReasonEntry | undefined>)[key];
  if (!e) return null;
  return { key, text: fillSlots(e.text, s, hand), principles: e.principles, bookDiff: e.bookDiff ? fillSlots(e.bookDiff, s, hand) : null };
}
