/*
 * 자리 이유 — 이 상황(차트)에서 책이 드는 가장 큰 이유 한두 문장, 숫자 한 줄, 책과 다른 점. docs/THEORY_SPEC.md §4.
 *
 * 문장 속 숫자(폭 · 지키는 비율 · 가격)는 전부 이 차트에서 계산합니다. 문장이 차트를 두고 단정하는 말
 * ('콜 없이', '콜이 4벳보다 많아요', '콜을 줄이고 4벳을 늘려', '처음 들어갈 때보다 좁게', '평소 오픈 범위 그대로',
 * 'AA도 절반은 콜로')은 tests/theory.test.ts 가 74개 차트 전부에서 다시 계산해 확인합니다.
 *
 * 책과 다른 점(bookDiff): 차트를 책(MPT 5장)에 맞춰 다시 만들어서(docs/BOOK_CHART_SPEC.md) 지금은 상황 단위로 다른 곳이
 * 없어요. 아래의 bookDiff 는 책이 숫자나 규칙을 밝힌 곳마다 차트를 그 기준과 견주는 장치라, 차트가 책에서 벗어나면 그때만
 * 차트의 실제 숫자로 한 줄을 만들어요(기본은 null).
 */
import { ALL_CHART_DEFS, getChartCells, hasChart } from '../data';
import { fullMix, rangeShare } from '../range';
import { ALL_HANDS, combos, parseHandName } from '../hands';
import { heroInPosition } from '../scenarios';
import { josa } from '../ko';
import type { Action, Pos, Scenario } from '../types';
import { PRINCIPLES, type PrincipleId } from './principles';
import { bb, LIMP_RAISE, pct, sprAfterCall } from './price';

export interface SpotReason {
  /** 해요체 1~2문장 */
  lines: string[];
  /** 원리 칩(앞에서부터 중요한 순) */
  principles: PrincipleId[];
  /** 숫자 한 줄(가격 · 3벳 위험) */
  numbers: string | null;
  /** 책의 균형 전략과 다른 점(없으면 null) */
  bookDiff: string | null;
}

const share = (s: Scenario, a: Action) => (hasChart(s) ? rangeShare(getChartCells(s), a) : 0);
const weightOf = (s: Scenario, h: string, a: Action) => (hasChart(s) ? (getChartCells(s)[h]?.[a] ?? 0) : 0);

/** 책 5장 2절의 RFI 폭(LJ = UTG). 차트가 이 안(±2%p)이면 '책과 다른 점'을 말하지 않아요. */
const BOOK_RFI: Partial<Record<Pos, number>> = { UTG: 0.17, HJ: 0.21, CO: 0.28, BTN: 0.43 };
/** 책 5장 2절의 SB 첫 진입: 림프 약 38% · 레이즈 약 24%. */
const BOOK_SB_LIMP = 0.38;
const BOOK_SB_RAISE = 0.24;
const BOOK_TOL = 0.02;
/** 책 5장 3절의 콜드 4벳: 상대가 타이트하면 약 3%, 넓으면 약 6%. */
const BOOK_COLD4 = [0.03, 0.06] as const;
/** 책 5장 2·3절: 올인(5벳)에 일반적으로 TT+ · AK 가 콜하고, BN 은 66+ · AK+ 까지. */
const BOOK_5BET_CALL = ['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs', 'AKo'];
const BOOK_5BET_CALL_BTN = [...BOOK_5BET_CALL, '99', '88', '77', '66'];

/** 플랍 이후 이 자리보다 나중에 행동하는 사람 수(블라인드는 플랍 이후 먼저 행동합니다). */
const LATER: Record<Pos, number> = { UTG: 3, HJ: 2, CO: 1, BTN: 0, SB: 0, BB: 0 };
const BEHIND: Record<Pos, number> = { UTG: 5, HJ: 4, CO: 3, BTN: 2, SB: 1, BB: 0 };

/**
 * 이 상황까지 오는 앞 단계(내 액션): 3벳 대응 · 5벳 대응은 오픈(레이즈), 5벳 대응은 거기에 4벳, 4벳 대응은 3벳.
 * atlas.isReachable 의 경로와 같아요.
 */
function pathOf(s: Scenario): Array<{ at: Scenario; a: Action }> {
  const v = s.villain;
  const out: Array<{ at: Scenario; a: Action }> = [];
  if (s.kind === 'vs_3bet' || s.kind === 'vs_5bet') out.push({ at: { kind: 'rfi', hero: s.hero }, a: 'raise' });
  if (s.kind === 'vs_5bet') out.push({ at: { kind: 'vs_3bet', hero: s.hero, villain: v }, a: 'fourbet' });
  if (s.kind === 'vs_4bet') out.push({ at: { kind: 'vs_open', hero: s.hero, villain: v }, a: 'threebet' });
  return out;
}

/**
 * 앞 단계 범위 중 이 액션의 비율('오픈한 패 중' · '3벳한 패 중' · '4벳한 패 중'). 패마다 앞 단계에서 실제로 그 액션을 한 만큼
 * 가중해요: 3벳을 25%만 하는 66 은 4벳 대응에서도 25%만 세고, SB 가 림프를 섞는 AA(레이즈 75%)는 75%만 세요.
 * (차트의 비중을 그대로 나누면 — 4벳 대응 콜 비중 ÷ 3벳 비중 — 가끔 3벳하는 패가 다 센 것처럼 들어가 부풀어요.)
 */
function pathParts(s: Scenario, acts: Action[]): number[] | null {
  const steps = pathOf(s);
  if (!hasChart(s) || !steps.length || !steps.every((p) => hasChart(p.at))) return null;
  const cur = getChartCells(s);
  const prev = steps.map((p) => ({ cells: getChartCells(p.at), a: p.a }));
  let den = 0;
  const num = acts.map(() => 0);
  for (const h of ALL_HANDS) {
    const w = prev.reduce((acc, p) => acc * (p.cells[h]?.[p.a] ?? 0), combos(h));
    if (!w) continue;
    den += w;
    acts.forEach((a, i) => (num[i] += w * (cur[h]?.[a] ?? 0)));
  }
  return den ? num.map((n) => n / den) : null;
}

/** 이 상황에서 계속 가는 비율: vs_open 은 전체 패 기준, 그 밖은 앞 단계에서 실제로 온 범위 기준(pathParts). */
export function defendShare(s: Scenario): number | null {
  switch (s.kind) {
    case 'vs_open':
      return share(s, 'call') + share(s, 'threebet');
    case 'vs_3bet':
      return pathParts(s, ['call', 'fourbet'])?.reduce((x, y) => x + y, 0) ?? null;
    case 'vs_4bet':
      return pathParts(s, ['call', 'allin'])?.reduce((x, y) => x + y, 0) ?? null;
    case 'vs_5bet':
      return pathParts(s, ['call'])?.[0] ?? null;
    default:
      return null;
  }
}

/** 사람이 읽는 순서: 포켓페어(높은 것부터) → 높은 카드 순, 같으면 수티드 먼저. AA·KK·QQ·AKs·AKo. */
function byStrength(a: string, b: string): number {
  const k = (h: string) => {
    const i = parseHandName(h);
    return i.kind === 'pair' ? [0, -i.highV, 0, 0] : [1, -i.highV, -i.lowV, i.kind === 'suited' ? 0 : 1];
  };
  const ka = k(a);
  const kb = k(b);
  for (let i = 0; i < 4; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

/** 두 액션을 함께 섞는 패를 강한 순서로: rfi:SB 의 림프 트랩(레이즈 + 림프) 'AA·KK·QQ·JJ·AKo·AQo'. */
function mixedHands(s: Scenario, a: Action, b: Action): string[] {
  return [...ALL_HANDS].sort(byStrength).filter((h) => weightOf(s, h, a) > 0 && weightOf(s, h, b) > 0);
}

/** 비중어(THEORY_SPEC · PLAIN_KO_STYLE): 늘 = 100%, 주로 ≥ 60%, 절반은 = 50%, 가끔 ≤ 25%. 그 밖(26~49%)은 말하지 않아요. */
function weightWord(w: number): string | null {
  if (w >= 0.999) return '늘';
  if (w >= 0.6) return '주로';
  if (Math.abs(w - 0.5) < 1e-6) return '절반은';
  if (w > 0 && w <= 0.25 + 1e-9) return '가끔';
  return null;
}

const ACT_KO: Partial<Record<Action, string>> = { fold: '폴드', call: '콜', raise: '레이즈', threebet: '3벳', fourbet: '4벳', allin: '올인', check: '체크', limp: '림프' };

/** 칸의 1순위를 비중어와 함께: 'QQ를 폴드' · '99를 절반만 콜'(100%는 비중어 없이). 책과 다른 점 문장 끝에 '해요'를 붙여 써요. */
function cellPhrase(s: Scenario, h: string): string {
  const top = fullMix(getChartCells(s)[h])[0];
  const w = top?.weight ?? 1;
  const word = w >= 0.999 ? '' : w >= 0.6 ? '주로 ' : Math.abs(w - 0.5) < 1e-6 ? '절반만 ' : w <= 0.25 + 1e-9 ? '가끔 ' : '';
  return `${josa(h, '을/를')} ${word}${ACT_KO[top?.action ?? 'fold'] ?? ''}`;
}

/** 반올림한 두 부분(앞 단계에서 실제로 온 범위 중 %, pathParts). 합계는 이 둘의 합으로 써요 — 따로 반올림하면 더해지지 않아요. */
function relParts(s: Scenario, a: Action, b: Action): [number, number] {
  const [x, y] = pathParts(s, [a, b]) ?? [0, 0];
  return [Math.round(x * 100), Math.round(y * 100)];
}

function numbersFor(s: Scenario, ids: PrincipleId[]): string | null {
  for (const id of ids) {
    const n = PRINCIPLES[id].numbers?.(s);
    if (n) return n;
  }
  return null;
}

export function spotReason(s: Scenario): SpotReason {
  const { hero: h, villain: v } = s;
  const lines: string[] = [];
  let ids: PrincipleId[] = [];
  let diff: string | null = null;
  const C = share(s, 'call');
  const T = share(s, 'threebet');
  const F = share(s, 'fourbet');

  switch (s.kind) {
    case 'rfi': {
      const W = share(s, 'raise');
      const book = BOOK_RFI[h];
      if (book != null && Math.abs(W - book) > BOOK_TOL) diff = `책의 균형 전략은 ${josa(h, '이/가')} 약 ${pct(book)}를 오픈해요. 이 차트는 ${pct(W)}예요.`;
      if (h === 'BTN') {
        lines.push('BTN 뒤에는 블라인드 둘만 남고, 플랍 이후에는 늘 포지션을 가져요.');
        lines.push(`3벳을 받을 위험이 작고 에퀴티를 잘 실현하니 ${pct(W)}까지 넓게 오픈해요.`);
        ids = ['steal-breakeven', 'seats-behind', 'raise-or-fold'];
      } else if (h === 'SB') {
        // 책 5장 2절: SB 는 할인 덕분에 림프 약 38% · 레이즈 약 24% · 폴드 약 38%. 림프 범위에 센 패를 섞는 이유는 책 4장 7절
        // (중간 패만 림프하면 재레이즈할 강한 패가 없다는 게 드러나 상대가 마음껏 레이즈해요)과 5장 2절(림프 뒤 BB 가 레이즈하면
        // SB 는 다시 올려요 — AA 는 슬로우플레이, KK·QQ·AK 는 올인). 트랩 패 이름은 차트에서 계산해요(레이즈와 림프를 함께 섞는 칸).
        // 이유의 순서는 책 그대로예요: '포지션이 없는 어려운 자리지만, 반값만 내는 할인이 있어 이 자리에서만 림프가 의미 있다'.
        // ('할인이 있지만 포지션이 없어서 셋으로 나눠요'처럼 뒤집으면 림프의 이유가 포지션 없음이 돼요.)
        const L = share(s, 'limp');
        const fold = 1 - W - L;
        lines.push(
          `SB는 플랍 이후 늘 포지션이 없지만 반값으로 들어가는 할인이 있어서, 림프(${pct(L)}) · 레이즈(${pct(W)}) · 폴드(${pct(fold)})로 나눠요.`,
        );
        const traps = mixedHands(s, 'raise', 'limp');
        if (traps.length) lines.push(`림프에도 ${josa(traps.join('·'), '을/를')} 일부 섞어, BB가 림프에 레이즈하면 다시 올릴 센 패를 남겨요.`);
        ids = ['sb-first-in', 'sb-limp', 'seats-behind'];
        diff =
          Math.abs(L - BOOK_SB_LIMP) <= BOOK_TOL && Math.abs(W - BOOK_SB_RAISE) <= BOOK_TOL
            ? null
            : `책의 균형 전략은 SB가 림프를 약 38%, 레이즈를 약 24% 해요. 이 차트는 림프 ${pct(L)} · 레이즈 ${pct(W)}예요.`;
      } else {
        lines.push(`${josa(h, '은/는')} 뒤에 ${BEHIND[h]}명이 남고, 그중 ${LATER[h]}명은 플랍 이후 ${h}보다 나중에 행동해요.`);
        lines.push(`그만큼 3벳을 받을 위험이 있어서, 3벳을 받아도 버틸 수 있을 만큼인 ${pct(W)}만 오픈해요.`);
        ids = h === 'CO' ? ['seats-behind', 'raise-or-fold'] : ['seats-behind', 'early-high-cards'];
      }
      break;
    }
    case 'vs_open': {
      const Vw = share({ kind: 'rfi', hero: v! }, 'raise');
      // 합계는 반올림한 두 부분의 합이에요(THEORY_SPEC §4) — pct(D) 로 따로 반올림하면 BB vs HJ '33%(콜 25% · 3벳 7%)',
      // BB vs BTN '45%(콜 32% · 3벳 14%)'처럼 더해지지 않아요.
      const [cP, tP] = [Math.round(C * 100), Math.round(T * 100)];
      const parts = `(콜 ${cP}% · 3벳 ${tP}%)`;
      if (h === 'BB' && v === 'SB') {
        lines.push('SB의 3bb 오픈에 BB는 2bb만 더 내면 되고, 플랍 이후 내내 BB가 나중에 행동해요.');
        // 책 5장 5절: SB 를 상대로는 아주 넓게 방어하고, 3벳은 양극화해요.
        lines.push(`그래서 BB가 가장 넓게 전체 패의 ${cP + tP}%를 지키고${parts}, 3벳은 최강 패와 블러프로 나눠요.`);
        ids = ['blind-vs-blind', 'bb-price', 'realization'];
      } else if (h === 'BB') {
        lines.push('BB는 이미 1bb를 냈으니 1.5bb만 더 내면 돼요.');
        lines.push(
          v === 'BTN'
            ? // 책 5장 4·5절: BB 는 BN 의 오픈에 콜 범위가 있는데도 선형으로 3벳해요(책이 짚은 예외).
              `${v}의 오픈이 ${pct(Vw)}일 때 BB는 ${cP + tP}%를 지키고${parts}, 콜 범위가 있어도 3벳은 강한 패부터 차례로(선형) 해요.`
            : `${v!}의 오픈이 ${pct(Vw)}일 때 BB는 ${cP + tP}%를 지켜요${parts}. 상대 범위가 넓을수록 BB도 넓게 지켜요.`,
        );
        ids = ['bb-price', 'bb-vs-opener', 'realization'];
      } else if (h === 'SB') {
        lines.push('SB가 콜하면 뒤의 BB가 스퀴즈할 수 있고, 플랍 이후 두 명을 상대로 포지션이 없어요.');
        // 책 5장 4·5절: 앞자리 오픈에 콜 없이 3벳 아니면 폴드(선형), BN 의 오픈에는 약 15%까지.
        lines.push(
          C === 0
            ? v === 'BTN'
              ? `그래서 콜 없이 3벳 아니면 폴드인데, 넓게 오픈하는 BTN에게는 강한 패부터 차례로(선형) ${pct(T)}까지 3벳해요.`
              : `그래서 콜 없이 강한 패부터 차례로(선형) ${pct(T)}만 3벳하고, 나머지는 폴드해요.`
            : `그래서 3벳(${pct(T)})을 주로 쓰고, 콜은 ${pct(C)}만 섞어요.`,
        );
        ids = ['sb-3bet-or-fold', 'tighter-after-raise'];
        // 책이 '콜 없이'를 밝힌 것은 앞자리(UTG · HJ · CO) 오픈이에요 — BTN 오픈에는 3벳 폭(약 15%)만 말해요.
        if (C > 0 && v !== 'BTN') diff = `책은 SB가 앞자리 오픈에 콜 없이 3벳 아니면 폴드로 대응한다고 해요. 이 차트는 콜을 ${pct(C)} 섞어요.`;
      } else if (h === 'BTN') {
        lines.push('BTN은 플랍 이후 늘 마지막에 행동해서, 콜로도 에퀴티를 잘 실현해요.');
        // 책 5장 5절: 오픈하는 쪽이 넓어질수록(LJ · HJ · CO) BN 의 3벳은 약 7 · 9 · 12%로 늘고, 콜 범위(약 5~7%)는 줄어요.
        lines.push(`그래서 콜 범위(${pct(C)})를 두고 3벳(${pct(T)})은 최강 패와 블러프로 나누는데, 상대가 넓게 오픈할수록 3벳은 늘리고 콜은 줄여요.`);
        ids = ['btn-call', 'polar-linear', 'tighter-after-raise'];
      } else {
        const rfiW = share({ kind: 'rfi', hero: h }, 'raise');
        lines.push(`${josa(h, '은/는')} 뒤에 아직 ${BEHIND[h]}명이 남아, 콜하면 스퀴즈를 맞기 쉬워요.`);
        // 책 5장 4·5절: HJ · CO 는 앞자리 오픈에 콜 없이 3벳 아니면 폴드, 3벳은 선형(HJ 는 UTG 상대 최대 약 8%).
        lines.push(
          C === 0
            ? `${josa(v!, '이/가')} 먼저 오픈한 만큼 처음 들어갈 때(${pct(rfiW)})보다 훨씬 좁게, 콜 없이 강한 패부터 차례로(선형) ${pct(T)}만 3벳해요.`
            : `${josa(v!, '이/가')} 먼저 오픈한 만큼 처음 들어갈 때(${pct(rfiW)})보다 훨씬 좁게, 3벳 ${pct(T)} · 콜 ${pct(C)}만 써요.`,
        );
        ids = ['squeeze-risk', 'tighter-after-raise', 'polar-linear'];
        if (C > 0) diff = `책의 균형 전략에서 ${josa(h, '은/는')} 앞자리 오픈에 콜 없이 3벳 아니면 폴드로 대응해요. 이 차트는 콜을 ${pct(C)} 섞어요.`;
      }
      break;
    }
    case 'vs_3bet': {
      const ip = heroInPosition(h, v!);
      const [c, f] = relParts(s, 'call', 'fourbet');
      if (ip) {
        lines.push(`${josa(h, '은/는')} ${v}보다 포지션이 있어서, 콜해도 에퀴티를 잘 실현해요.`);
        lines.push(`그래서 오픈한 패의 ${c + f}%를 지키는데, 콜(${c}%)이 4벳(${f}%)보다 많아요.`);
        ids = ['vs3bet-position', 'threebet-shape', 'offsuit-3bet-pot'];
      } else if (h === 'SB') {
        // 첫 문장을 '콜하면 플랍 이후 내내 불리해요'로 두면 다음 문장 '그래서 중간 강도 패는 콜로'와 이어지지 않아요.
        // 책이 드는 이유는 포지션이 아니라 '4벳했다가 올인에 폴드하는 상황'을 가장 싫어한다는 것이에요.
        lines.push(`${josa(h, '은/는')} ${v}보다 포지션이 없지만, 중간 강도 패에는 4벳했다가 올인을 받고 폴드하는 쪽이 더 나빠요.`);
        // 책 5장 2절 SB: BB 의 3벳을 맞으면 중간 강도 패는 '4벳했다가 올인에 폴드'를 피해 콜로 플랍을 보고,
        // 4벳에는 올인에도 콜할 최강 패와 블로커가 좋은 패가 남아 양극화돼요(tests/book-charts.test.ts 가 확인).
        lines.push(`그래서 중간 강도 패는 콜로 플랍을 보고 4벳은 최강 패와 블로커 패로 나눠, 레이즈한 패 중 4벳 ${f}% · 콜 ${c}%로 지켜요.`);
        ids = ['blind-vs-blind', 'fourbet-polar', 'vs3bet-position'];
      } else {
        lines.push(`${josa(h, '은/는')} ${v}보다 포지션이 없어서, 콜하면 플랍 이후 내내 불리해요.`);
        // 책 5장 3절: 포지션이 없으면 4벳이 늘어요(HJ 는 CO 의 3벳에 약 22%, BB 의 3벳에 약 10%를 4벳). 같은 오프너의 BB 3벳 대응과 견줘요.
        const ipRef: Scenario = { kind: 'vs_3bet', hero: h, villain: 'BB' };
        const [ci, fi] = relParts(ipRef, 'call', 'fourbet');
        const shaped = share(s, 'fourbet') > share(ipRef, 'fourbet') && share(s, 'call') < share(ipRef, 'call');
        lines.push(
          shaped
            ? `그래서 콜을 줄이고 4벳을 늘려, 오픈한 패 중 4벳 ${f}% · 콜 ${c}%로 지켜요(BB의 3벳에는 4벳 ${fi}% · 콜 ${ci}%).`
            : `그래서 오픈한 패 중 4벳 ${f}% · 콜 ${c}%로 지켜요(BB의 3벳에는 4벳 ${fi}% · 콜 ${ci}%).`,
        );
        ids = ['vs3bet-position', 'offsuit-3bet-pot', 'threebet-shape'];
        if (share(s, 'fourbet') <= share(ipRef, 'fourbet'))
          diff = `책은 포지션이 없을 때 4벳을 늘린다고 해요(HJ가 오픈한 패 중 CO의 3벳에는 약 22%, BB의 3벳에는 약 10%를 4벳). 이 차트는 오픈한 패 중 4벳 ${f}%로, BB의 3벳(${fi}%)보다 많지 않아요.`;
      }
      break;
    }
    case 'vs_4bet': {
      const spr = sprAfterCall(s);
      lines.push(`4벳 팟은 이미 팟이 커서, 콜하면 남은 스택이 팟의 두 배도 안 돼요(SPR 약 ${spr ? spr.toFixed(1) : '1.7'}).`);
      const [a, c] = relParts(s, 'allin', 'call');
      const ip = heroInPosition(h, v!);
      // 책 5장 5절: 포지션이 있으면(4벳을 받은 IP) 약 18%만 올인하고 대부분 콜, AA 도 절반쯤 콜로 슬로우플레이.
      // 블라인드는 포지션과 상대 4벳의 모양에 따라 올인과 콜을 나누고, 상대 4벳이 양극화될수록 콜과 AA 슬로우플레이가 늘어요.
      const aaCall = weightOf(s, 'AA', 'call');
      const aaWord = weightWord(aaCall);
      const aa = aaCall === 0 ? (weightOf(s, 'AA', 'allin') === 1 ? ', AA는 늘 올인해요' : '') : aaWord ? `, AA도 ${aaWord} 콜로 숨겨요` : '';
      lines.push(
        ip && c > a
          ? `포지션이 있어 3벳한 패 중 ${a + c}%를 지키는데 콜(${c}%)이 올인(${a}%)보다 많${aa ? `고${aa}` : '아요'}.`
          : `포지션이 ${ip ? '있어도' : '없으면'} 3벳한 패 중 ${a + c}%를 지키며 올인(${a}%)과 콜(${c}%)을 ${aa ? `나누고${aa}` : '나눠요'}.`,
      );
      ids = ['vs-4bet', 'fourbet-polar'];
      if (ALL_HANDS.some((x) => /^A[2-5]s$/.test(x) && weightOf(s, x, 'allin') > 0)) ids.push('fivebet-bluff');
      if (ip && (c <= a || aaCall === 0))
        diff = `책은 4벳을 받은 쪽이 포지션이 있으면 대부분 콜하고, AA도 절반쯤은 콜로 숨긴다고 해요. 이 차트는 3벳한 패 중 올인 ${a}% · 콜 ${c}%이고, AA를 ${aaCall === 0 ? '콜하지 않아요' : `${aaWord ?? '일부'} 콜해요`}.`;
      break;
    }
    case 'vs_5bet': {
      lines.push('올인(5벳)에 콜하면 남은 스택을 전부 걸게 돼서, 상대 올인 범위를 상대로 높은 승률이 필요해요.');
      // 콜하는 패 중에는 필요 승률에 조금 모자라는 패도 있어요(UTG의 QQ · AKo 는 BTN 올인에 약 36% — 메모가 말해요).
      // '그만큼 에퀴티가 있는 패만'은 그 칸들에서 거짓이라 '그 언저리 이상'으로 써요(교차 검토).
      lines.push('그래서 승률이 그 언저리 이상인 패만 콜하고, 블러프로 4벳한 패는 폴드해요.');
      ids = ['vs-5bet', 'fourbet-polar'];
      // 책 5장 2·3절과 견줘요: 이 자리에 오는 패(4벳한 패) 중 책이 콜하는 패와 1순위가 다르면 그 패를 이름으로 적어요.
      const gate: Scenario = { kind: 'vs_3bet', hero: h, villain: v };
      const callers = h === 'BTN' ? BOOK_5BET_CALL_BTN : BOOK_5BET_CALL;
      const off = [...ALL_HANDS]
        .sort(byStrength)
        .filter((x) => weightOf(gate, x, 'fourbet') > 0 && (fullMix(getChartCells(s)[x])[0]?.action === 'call') !== callers.includes(x));
      if (off.length)
        diff = `책은 올인(5벳)에 일반적으로 TT 이상과 AK가 콜하고, BTN은 66 이상까지 콜한다고 해요. 이 차트는 ${off.map((x) => cellPhrase(s, x)).join(', ')}해요.`;
      break;
    }
    case 'cold_4bet': {
      // BB 뒤에는 아무도 없어요 — 싸게 따라올 수 있는 건 오픈한 사람뿐이에요(교차 검토).
      const followers = h === 'BB' ? '오픈한 사람이' : '다른 사람들이';
      lines.push(`${h} 앞에서 이미 오픈과 3벳이 나왔어요. 콜하면 내 패 정보가 새고, 4벳이었다면 폴드했을 ${followers} 싸게 따라올 수 있어요.`);
      lines.push(C === 0 ? `그래서 콜 없이 4벳(약 ${pct(F)}) 아니면 폴드로 정리해요.` : `그래서 대부분 4벳(약 ${pct(F)}) 아니면 폴드로 정리하고, 콜은 ${pct(C)}만 섞어요.`);
      // '4벳은 양 끝으로'(최강 패 + 블로커 블러프)는 블러프가 있는 자리에만 — CO 의 콜드 4벳은 QQ+ · AK · JJ · AQs 뿐인 순수 밸류예요(교차 검토).
      const hasBluff = ALL_HANDS.some((x) => /^A[2-5]s$/.test(x) && weightOf(s, x, 'fourbet') > 0);
      ids = hasBluff ? ['cold-4bet', 'fourbet-polar', 'blockers'] : ['cold-4bet', 'hand-strength', 'blockers'];
      if (C > 0 || F < BOOK_COLD4[0] - BOOK_TOL / 2 || F > BOOK_COLD4[1] + BOOK_TOL / 2)
        diff = `책은 콜드 4벳을 4벳 아니면 폴드로 두고, 상대가 타이트하면 약 3%, 넓으면 약 6%로 둬요. 이 차트는 4벳 ${pct(F)}${C > 0 ? ` · 콜 ${pct(C)}` : ''}예요.`;
      break;
    }
    case 'vs_limp': {
      const W = share(s, 'raise');
      if (h === 'BB') {
        // BB 의 림프 대응 = SB 가 림프했고 BB 차례(책의 균형 전략에서 림프하는 자리는 SB 뿐). BB 는 3.5bb 레이즈 아니면 체크.
        lines.push('SB가 림프하면 BB는 체크만 해도 돈을 더 내지 않고 플랍을 봐요.');
        // SB 의 림프에는 센 패가 섞여 있어요(책 5장 2절). 함정이 있는 림프에는 강한 패와 레이즈했다 폴드해도 아깝지 않은 패로
        // 양극화해 레이즈해요(책 4장 7절 '함정을 놓는 림퍼'). 강한 쪽은 'SB의 림프 범위를 상대로' 강한 패라고만 해요 — 레이즈하는
        // A5o · K8o · 55 까지 SB 의 다시 올림을 '버틴다'고 하면 차트에서 확인할 수 없어요. 승률 순서로 위 · 가운데 · 아래와
        // 블러프가 아주 약한 오프수트 패라는 것은 tests/theory.test.ts 가 확인해요. 아주 약한 오프수트 패가 전부 레이즈하지는 않아서
        // (54o · 65o · 75o · 94o 는 체크) '일부'를 붙여요.
        lines.push(
          `그래서 폴드 없이 중간 패는 체크하고, SB의 림프 범위를 상대로 강한 패와 레이즈했다 폴드해도 아깝지 않은 아주 약한 오프수트 패 일부(합쳐 ${pct(W)})는 ${josa(bb(LIMP_RAISE), '으로/로')} 레이즈해요.`,
        );
        ids = ['free-check', 'sb-limp'];
      } else {
        // 책 4장 7절: SB 말고 림프하는 사람은 약한 플레이어일 가능성이 높아 아이솔레이트해요. 수동적인 림퍼면 아주 넓게도 되지만,
        // 뒤에 공격적인 사람이 있으면 평소 오픈 범위 수준으로 조절해요 — 차트는 림퍼의 유형을 모를 때의 이 기본값이에요.
        // ('유형을 모를 때는 뒤에 공격적인 사람이 있을 수 있어'처럼 쓰면 두 사실이 인과로 묶여요 — 둘은 따로인 이유예요.)
        const rfi: Scenario = { kind: 'rfi', hero: h };
        const rfiW = share(rfi, 'raise');
        const same = ALL_HANDS.every((x) => weightOf(s, x, 'raise') === weightOf(rfi, x, 'raise'));
        // SB 의 첫 진입에는 림프가 있어서, 견주는 것은 '평소 레이즈 범위'예요.
        const usual = h === 'SB' ? '평소 레이즈 범위' : '평소 오픈 범위';
        lines.push('앞에서 한 명이 림프했어요. SB 말고 림프하는 사람은 약한 경우가 많아, 레이즈로 아이솔레이트해 혼자 상대해요.');
        lines.push(
          same
            ? `림퍼의 유형을 모르고 뒤에 공격적인 사람이 있을 수도 있어서, ${usual} 그대로(${pct(W)}) 레이즈해요.`
            : Math.abs(W - rfiW) <= BOOK_TOL
              ? `림퍼의 유형을 모르고 뒤에 공격적인 사람이 있을 수도 있어서, ${usual} 수준(${pct(W)})으로 레이즈해요.`
              : `림퍼의 유형을 모를 때는 ${pct(W)}를 레이즈해요(${usual}는 ${pct(rfiW)}).`,
        );
        ids = ['vs-limper', 'seats-behind'];
      }
      break;
    }
  }
  return { lines, principles: ids, numbers: numbersFor(s, ids), bookDiff: diff };
}

/** 74개 차트 전부의 자리 이유(테스트 · 덤프용). */
export function allSpotReasons(): Array<{ id: string; reason: SpotReason }> {
  return ALL_CHART_DEFS.map((d) => {
    const s = { kind: d.kind, hero: d.hero, ...(d.villain ? { villain: d.villain } : {}) } as Scenario;
    return { id: d.id, reason: spotReason(s) };
  });
}
