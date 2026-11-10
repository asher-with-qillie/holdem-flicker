/*
 * 이 패 이유 — 키(상황 | 자리 쪽 | 패 가족 | 버킷) 하나에 문장 하나. docs/THEORY_SPEC.md §6.
 * 문장은 handReasons.data.ts 에 있고(책 원리로 쓰고 키의 모든 칸에서 참인지 검증한 것), 여기서는 자리표시만 채웁니다.
 *   {hand} {hero} {villain} · 조사가 붙는 꼴 {hand|은/는} {hero|이/가} {villain|을/를} …
 *   {주로} — 이 칸의 1순위 비중이 100% 아래면 '주로 ', 100% 면 빈 문자열. 한 키가 늘 하는 칸(캡슐 '3벳')과 주로 하는 칸
 *   (캡슐 '주로 3벳')을 함께 덮을 때, 비중어가 칸마다 캡슐과 같게 붙어요(THEORY_SPEC §6.2).
 */
import { josa, type Josa } from '../ko';
import { fullMix } from '../range';
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

/** {주로}: 1순위 비중이 100% 아래인 칸에만 '주로 '(섞인 칸 키 mix:… 에는 쓰지 않아요 — 그 칸들은 1순위가 60% 아래예요). */
const MOSTLY = /\{주로\}/g;

export function fillSlots(text: string, s: Scenario, hand: HandName, mix?: ActionMix): string {
  const top = fullMix(mix)[0]?.weight ?? 1;
  return text.replace(MOSTLY, top < 0.999 ? '주로 ' : '').replace(SLOT, (_m, name: 'hand' | 'hero' | 'villain', j?: string) => {
    const word = name === 'hand' ? hand : name === 'hero' ? s.hero : (s.villain ?? '');
    if (!j) return word;
    return j.includes('/') ? josa(word, j as Josa) : `${word}${j}`; // '의'처럼 받침과 상관없는 조사는 그대로 붙여요
  });
}

export function handReason(s: Scenario, hand: HandName, mix: ActionMix | undefined): { key: ReasonKey; text: string; principles: PrincipleId[]; bookDiff: string | null } | null {
  const key = reasonKey(s, hand, mix);
  const e = (HAND_REASONS as Record<string, HandReasonEntry | undefined>)[key];
  if (!e) return null;
  return { key, text: fillSlots(e.text, s, hand, mix), principles: e.principles, bookDiff: e.bookDiff ? fillSlots(e.bookDiff, s, hand, mix) : null };
}
