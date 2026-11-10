/*
 * 가격표 — 콜 한 번에 더 내는 돈과, 그 돈으로 본전이 되는 필요 승률(콜 금액 ÷ 콜 뒤의 팟).
 * 책(Modern Poker Theory 1장 '팟 오즈', 5장 '권장 베팅 크기' — 노트 5장 1절)의 크기를 그대로 씁니다.
 *
 *   오픈 2.5bb(SB 레이즈 3bb) · 3벳 IP 약 8.5bb · 3벳 OOP(블라인드) 약 10bb · SB 3bb 레이즈에 BB 3벳 9bb ·
 *   4벳 약 23bb(SB 가 BB 의 9bb 3벳에 4벳하면 24bb) · 5벳 = 100bb 올인 · SB 림프에 BB 레이즈 3.5bb.
 *
 * 이 크기를 쓰는 곳은 전부 여기서 읽습니다(원리 카드의 숫자 줄, priceFacts.ts 의 '…만 더 내면 돼요', 자리 이유의 SPR).
 */
import { heroInPosition } from '../scenarios';
import type { Pos, Scenario } from '../types';

export interface Price {
  /** 더 내야 하는 돈(bb) */
  toCall: number;
  /** 콜하고 난 뒤의 팟(bb) */
  potAfter: number;
  /** toCall ÷ potAfter */
  need: number;
}

const OPEN = 2.5;
const SB_OPEN = 3;
const IP_3BET = 8.5;
const BLIND_3BET = 10;
const BVB_3BET = 9;
const FOURBET = 23;
const BVB_4BET = 24;
const STACK = 100;
/** SB 가 림프(1bb)한 뒤 BB 의 레이즈 크기(책 5장 1절). */
export const LIMP_RAISE = 3.5;

const blind = (p: Pos) => p === 'SB' || p === 'BB';
/** 접은 블라인드가 팟에 남긴 돈: 두 블라인드 1.5bb 중 행동하는 사람 몫을 뺀 나머지. */
function dead(players: Pos[]): number {
  let d = 0;
  if (!players.includes('SB')) d += 0.5;
  if (!players.includes('BB')) d += 1;
  return d;
}
const mk = (toCall: number, potBefore: number): Price => ({ toCall, potAfter: potBefore + toCall, need: toCall / (potBefore + toCall) });

/** 3벳 크기: 3벳하는 사람이 블라인드면 크게(OOP, 약 10bb), 아니면 작게(IP, 약 8.5bb). SB 의 3bb 레이즈에 BB 3벳은 9bb. */
export function threebetSize(opener: Pos, threebettor: Pos): number {
  if (opener === 'SB' && threebettor === 'BB') return BVB_3BET;
  return blind(threebettor) ? BLIND_3BET : IP_3BET;
}
/** 4벳 크기: 약 23bb. SB 가 BB 의 9bb 3벳에 4벳하면 24bb. */
export function fourbetSize(opener: Pos, threebettor: Pos): number {
  return opener === 'SB' && threebettor === 'BB' ? BVB_4BET : FOURBET;
}
export const openSize = (opener: Pos) => (opener === 'SB' ? SB_OPEN : OPEN);

/**
 * 상황별 가격. 콜이라는 선택이 없거나(rfi · vs_limp) 사람이 셋인 상황(cold_4bet)은 null.
 * (SB 의 림프 가격 — 0.5bb 를 더 내 1bb 까지 맞춤 — 과 BB 의 3.5bb 레이즈는 limpFacts 가 따로 냅니다.)
 */
export function priceOf(s: Scenario): Price | null {
  const h = s.hero;
  const v = s.villain;
  switch (s.kind) {
    case 'vs_open': {
      const o = openSize(v!);
      const heroIn = h === 'SB' ? 0.5 : h === 'BB' ? 1 : 0;
      return mk(o - heroIn, o + heroIn + dead([h, v!]));
    }
    case 'vs_3bet': {
      const o = openSize(h);
      const t = threebetSize(h, v!);
      return mk(t - o, t + o + dead([h, v!]));
    }
    case 'vs_4bet': {
      // 나 = 3벳한 사람, 상대 = 오픈하고 4벳한 사람
      const t = threebetSize(v!, h);
      const f = fourbetSize(v!, h);
      return mk(f - t, f + t + dead([h, v!]));
    }
    case 'vs_5bet': {
      // 나 = 오픈하고 4벳한 사람, 상대 = 3벳하고 5벳 올인한 사람
      const f = fourbetSize(h, v!);
      return mk(STACK - f, STACK + f + dead([h, v!]));
    }
    default:
      return null;
  }
}

/**
 * SB 림프 한 판의 숫자(책 5장 1절): SB 는 0.5bb 를 더 내 1bb 까지 맞추고(팟 2bb), BB 가 3.5bb 로 레이즈하면
 * SB 는 2.5bb 를 더 내고 콜해야 해요(콜 뒤 팟 7bb → 필요 승률 약 36%).
 */
export function limpFacts(): { complete: number; potAfterLimp: number; raiseTo: number; toCallRaise: number; potAfterCall: number; need: number } {
  const complete = 1 - 0.5;
  const potAfterLimp = 2;
  const toCallRaise = LIMP_RAISE - 1;
  const potAfterCall = potAfterLimp + (LIMP_RAISE - 1) + toCallRaise;
  return { complete, potAfterLimp, raiseTo: LIMP_RAISE, toCallRaise, potAfterCall, need: toCallRaise / potAfterCall };
}

/** 남은 스택 ÷ 팟(콜한 뒤). 책 1장 'SPR'. */
export function sprAfterCall(s: Scenario): number | null {
  const p = priceOf(s);
  if (!p || s.kind === 'vs_5bet') return null;
  const committed = s.kind === 'vs_open' ? openSize(s.villain!) : s.kind === 'vs_3bet' ? threebetSize(s.hero, s.villain!) : fourbetSize(s.villain!, s.hero);
  return (STACK - committed) / p.potAfter;
}

/** 책 4장 '3-bet을 당할 가능성'의 단순 모형: 뒤에 남은 사람이 한 명당 7%씩 3벳한다고 할 때 3벳을 맞을 확률. */
export function threebetRisk(seatsBehind: number, each = 0.07): number {
  return 1 - (1 - each) ** seatsBehind;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const bb = (x: number) => `${Number.isInteger(x) ? x : x.toFixed(1)}bb`;
export { heroInPosition };
