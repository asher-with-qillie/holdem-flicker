/*
 * 가격표 — 콜 한 번에 더 내는 돈과, 그 돈으로 본전이 되는 필요 승률(콜 금액 ÷ 콜 뒤의 팟).
 * 책(Modern Poker Theory 1장 '팟 오즈', 5장 '권장 베팅 크기')의 계산을 앱 차트의 크기 가정으로 다시 했습니다.
 *
 * 앱 크기 가정(src/poker/data/rfi.ts 머리말 · priceFacts.ts 와 같음): 100bb, 오픈 2.5bb(SB 3bb),
 * 뒷자리 3벳 7.5bb, 블라인드 3벳 10.5bb(SB 오픈에 BB 3벳은 11bb), 4벳 22bb, 5벳 = 100bb 올인.
 * 책의 크기(IP 3벳 약 8.5bb, OOP 약 10bb, 4벳 약 23bb)와 1bb 안팎으로 다를 뿐이라 필요 승률은 2~3%p 안에서 같습니다.
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
const IP_3BET = 7.5;
const BLIND_3BET = 10.5;
const BVB_3BET = 11;
const FOURBET = 22;
const STACK = 100;

const blind = (p: Pos) => p === 'SB' || p === 'BB';
/** 접은 블라인드가 팟에 남긴 돈: 두 블라인드 1.5bb 중 행동하는 사람 몫을 뺀 나머지. */
function dead(players: Pos[]): number {
  let d = 0;
  if (!players.includes('SB')) d += 0.5;
  if (!players.includes('BB')) d += 1;
  return d;
}
const mk = (toCall: number, potBefore: number): Price => ({ toCall, potAfter: potBefore + toCall, need: toCall / (potBefore + toCall) });

/** 3벳 크기: 3벳하는 사람이 블라인드면 크게(OOP), 아니면 작게(IP). SB 오픈에 BB 3벳은 11bb. */
export function threebetSize(opener: Pos, threebettor: Pos): number {
  if (opener === 'SB' && threebettor === 'BB') return BVB_3BET;
  return blind(threebettor) ? BLIND_3BET : IP_3BET;
}
const openSize = (opener: Pos) => (opener === 'SB' ? SB_OPEN : OPEN);

/** 상황별 가격. 콜이라는 선택이 없거나(rfi · vs_limp) 사람이 셋인 상황(cold_4bet)은 null. */
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
      return mk(FOURBET - t, FOURBET + t + dead([h, v!]));
    }
    case 'vs_5bet': {
      // 나 = 오픈하고 4벳한 사람, 상대 = 3벳하고 5벳 올인한 사람
      return mk(STACK - FOURBET, STACK + FOURBET + dead([h, v!]));
    }
    default:
      return null;
  }
}

/** 남은 스택 ÷ 팟(콜한 뒤). 책 1장 'SPR'. */
export function sprAfterCall(s: Scenario): number | null {
  const p = priceOf(s);
  if (!p || s.kind === 'vs_5bet') return null;
  const committed = s.kind === 'vs_open' ? openSize(s.villain!) : s.kind === 'vs_3bet' ? threebetSize(s.hero, s.villain!) : FOURBET;
  return (STACK - committed) / p.potAfter;
}

/** 책 4장 '3-bet을 당할 가능성'의 단순 모형: 뒤에 남은 사람이 한 명당 7%씩 3벳한다고 할 때 3벳을 맞을 확률. */
export function threebetRisk(seatsBehind: number, each = 0.07): number {
  return 1 - (1 - each) ** seatsBehind;
}

export const pct = (x: number) => `${Math.round(x * 100)}%`;
export const bb = (x: number) => `${Number.isInteger(x) ? x : x.toFixed(1)}bb`;
export { heroInPosition };
