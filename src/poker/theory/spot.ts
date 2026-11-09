/*
 * 자리 이유 — 이 상황(차트)에서 책이 드는 가장 큰 이유 한두 문장, 숫자 한 줄, 책과 다른 점. docs/THEORY_SPEC.md §4.
 *
 * 문장 속 숫자(폭 · 지키는 비율 · 가격)는 전부 이 차트에서 계산합니다. 문장이 차트를 두고 단정하는 말
 * ('콜은 거의 하지 않고', '콜이 4벳보다 많아요', '처음 들어갈 때보다 좁게')은 tests/theory.test.ts 가
 * 74개 차트 전부에서 다시 계산해 확인합니다.
 */
import { ALL_CHART_DEFS, getChartCells, hasChart } from '../data';
import { fullMix, rangeShare } from '../range';
import { ALL_HANDS, parseHandName } from '../hands';
import { heroInPosition } from '../scenarios';
import { josa } from '../ko';
import type { Action, Pos, Scenario } from '../types';
import { PRINCIPLES, type PrincipleId } from './principles';
import { pct, sprAfterCall } from './price';

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
const p1 = (x: number) => `${Math.round(x * 1000) / 10}%`.replace('.0%', '%');

/** 플랍 이후 이 자리보다 나중에 행동하는 사람 수(블라인드는 플랍 이후 먼저 행동합니다). */
const LATER: Record<Pos, number> = { UTG: 3, HJ: 2, CO: 1, BTN: 0, SB: 0, BB: 0 };
const BEHIND: Record<Pos, number> = { UTG: 5, HJ: 4, CO: 3, BTN: 2, SB: 1, BB: 0 };

/** 이 상황에서 계속 가는 비율: vs_open 은 전체 패 기준, 그 밖은 바로 앞 단계 범위 기준. */
export function defendShare(s: Scenario): number | null {
  const v = s.villain;
  switch (s.kind) {
    case 'vs_open':
      return share(s, 'call') + share(s, 'threebet');
    case 'vs_3bet': {
      const before = share({ kind: 'rfi', hero: s.hero }, 'raise');
      return before ? (share(s, 'call') + share(s, 'fourbet')) / before : null;
    }
    case 'vs_4bet': {
      const before = share({ kind: 'vs_open', hero: s.hero, villain: v }, 'threebet');
      return before ? (share(s, 'call') + share(s, 'allin')) / before : null;
    }
    case 'vs_5bet': {
      const before = share({ kind: 'vs_3bet', hero: s.hero, villain: v }, 'fourbet');
      return before ? share(s, 'call') / before : null;
    }
    default:
      return null;
  }
}

/** 이 차트에서 1순위가 그 액션인 패 이름(차트 순서). 책과 다른 점에 손으로 적지 않고 계산해서 씁니다. */
function primaryHands(s: Scenario, a: Action): string[] {
  const cells = getChartCells(s);
  return ALL_HANDS.filter((h) => fullMix(cells[h])[0]?.action === a && fullMix(cells[h])[0].weight >= 0.5);
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

/**
 * 그 액션을 하는 패를 강한 순서로: 'AA·KK·AKs·QQ(주로)·AKo(절반)'. rare 이면 절반 미만도 '(가끔)'으로 넣어요 —
 * "…만 콜해요"처럼 목록이 전부라고 말할 때 빠진 패가 있으면 그 패의 시트(줄 문장 '콜도 25% 섞어요')와 어긋나요.
 */
function weightedList(s: Scenario, a: Action, rare = false): string {
  const cells = getChartCells(s);
  return [...ALL_HANDS]
    .sort(byStrength)
    .map((h) => ({ h, w: fullMix(cells[h]).find((m) => m.action === a)?.weight ?? 0 }))
    .filter((x) => x.w >= 0.5 || (rare && x.w > 0))
    .map((x) => (x.w >= 0.999 ? x.h : x.w >= 0.6 ? `${x.h}(주로)` : x.w >= 0.5 ? `${x.h}(절반)` : `${x.h}(가끔)`))
    .join('·');
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
  const A = share(s, 'allin');
  const D = defendShare(s);

  switch (s.kind) {
    case 'rfi': {
      const W = share(s, 'raise');
      if (h === 'BTN') {
        lines.push('BTN 뒤에는 블라인드 둘만 남고, 플랍 이후에는 늘 포지션을 가져요.');
        lines.push(`3벳을 받을 위험이 작고 에퀴티를 잘 실현하니 ${pct(W)}까지 넓게 오픈해요.`);
        ids = ['steal-breakeven', 'seats-behind', 'raise-or-fold'];
        diff = `책의 균형 전략은 BTN이 약 43%를 오픈해요. 이 차트는 ${pct(W)}로 조금 더 넓어요.`;
      } else if (h === 'SB') {
        lines.push('SB 뒤에는 BB 한 명뿐이지만, 플랍 이후에는 늘 포지션이 없어요.');
        lines.push(`그래서 3bb로 크게 레이즈해 BB가 싸게 따라오지 못하게 하고, ${pct(W)}를 오픈해요.`);
        ids = ['sb-first-in', 'seats-behind'];
        diff = '책의 균형 전략은 SB가 반값 할인 덕분에 림프를 약 38% 섞고, 레이즈는 약 24%예요. 이 차트는 림프 없이 레이즈 아니면 폴드로 단순하게 만들었어요.';
      } else {
        lines.push(`${josa(h, '은/는')} 뒤에 ${BEHIND[h]}명이 남고, 그중 ${LATER[h]}명은 플랍 이후 ${h}보다 나중에 행동해요.`);
        lines.push(`그만큼 3벳을 받을 위험이 있어서, 3벳을 받아도 버틸 수 있을 만큼인 ${pct(W)}만 오픈해요.`);
        ids = h === 'CO' ? ['seats-behind', 'raise-or-fold'] : ['seats-behind', 'early-high-cards'];
      }
      break;
    }
    case 'vs_open': {
      const Vw = share({ kind: 'rfi', hero: v! }, 'raise');
      if (h === 'BB' && v === 'SB') {
        lines.push('SB의 3bb 오픈에 BB는 2bb만 더 내면 되고, 플랍 이후 내내 BB가 나중에 행동해요.');
        lines.push(`그래서 BB가 가장 넓게, 전체 패의 ${pct(D!)}를 지켜요(콜 ${pct(C)} · 3벳 ${pct(T)}).`);
        ids = ['blind-vs-blind', 'bb-price', 'realization'];
      } else if (h === 'BB') {
        lines.push('BB는 이미 1bb를 냈으니 1.5bb만 더 내면 돼요.');
        lines.push(`${v!}의 오픈이 ${pct(Vw)}일 때 BB는 ${pct(D!)}를 지켜요(콜 ${pct(C)} · 3벳 ${pct(T)}). 상대 범위가 넓을수록 BB도 넓게 지켜요.`);
        ids = ['bb-price', 'bb-vs-opener', 'realization'];
        if (v === 'BTN') diff = '책은 BB가 BTN에게 강한 패부터 차례로(선형) 3벳한다고 해요. 이 차트의 BB 3벳은 강한 패와 작은 수티드 A 같은 블러프로 나뉘어 있어요.';
      } else if (h === 'SB') {
        lines.push('SB가 콜하면 뒤의 BB가 스퀴즈할 수 있고, 플랍 이후 두 명을 상대로 포지션이 없어요.');
        lines.push(`그래서 콜은 거의 하지 않고 3벳(${pct(T)}) 아니면 폴드로 대응해요.`);
        ids = ['sb-3bet-or-fold', 'tighter-after-raise'];
      } else if (h === 'BTN') {
        lines.push('BTN은 플랍 이후 늘 마지막에 행동해서, 콜로도 에퀴티를 잘 실현해요.');
        lines.push(`그래서 콜 범위(${pct(C)})를 두고, 3벳(${pct(T)})은 최강 패와 블러프로 나눠요.`);
        ids = ['btn-call', 'polar-linear', 'tighter-after-raise'];
        diff = `책은 BTN의 콜을 약 5~7%로 좁게 두고, 3벳은 상대에 따라 약 7·9·12%로 늘려요. CO처럼 넓게 여는 상대에게는 블라인드의 스퀴즈 때문에 오히려 콜을 줄여요. 이 차트는 콜이 ${pct(C)}로 더 넓고, 상대가 넓을수록 콜도 늘어요.`;
      } else {
        lines.push(`${josa(h, '은/는')} 뒤에 아직 ${BEHIND[h]}명이 남아, 콜하면 스퀴즈를 맞기 쉬워요.`);
        lines.push(`${josa(v!, '이/가')} 먼저 오픈한 만큼 처음 들어갈 때보다 훨씬 좁게, 3벳 ${pct(T)} · 콜 ${pct(C)}만 써요.`);
        ids = ['squeeze-risk', 'tighter-after-raise', 'polar-linear'];
        // 노트 5장 5절: HJ 는 LJ(UTG) 오픈에 최대 약 8% 3벳, CO 는 LJ 상대로 HJ 보다 약 0.5%p 넓게, HJ 상대로는 HJ 가 더 넓게 열어서 더 넓게.
        const width =
          h === 'HJ'
            ? '3벳은 강한 패부터 차례로(선형) 최대 약 8%까지 해요'
            : v === 'UTG'
              ? '3벳은 강한 패부터 차례로(선형) 하되, UTG 상대로는 HJ의 3벳(최대 약 8%)보다 조금만 넓게 해요'
              : '3벳은 강한 패부터 차례로(선형) 하고, HJ가 UTG보다 넓게 오픈하는 만큼 UTG를 상대할 때보다 넓게 해요';
        diff = `책의 균형 전략은 ${josa(h, '이/가')} 앞자리 오픈에 콜 없이 3벳 아니면 폴드로 대응하고, ${width}. 이 차트는 콜을 ${pct(C)} 섞어요.`;
      }
      break;
    }
    case 'vs_3bet': {
      const ip = heroInPosition(h, v!);
      if (ip) {
        lines.push(`${josa(h, '은/는')} ${v}보다 포지션이 있어서, 콜해도 에퀴티를 잘 실현해요.`);
        const before = share({ kind: 'rfi', hero: h }, 'raise');
        const [c, f] = [Math.round((C / before) * 100), Math.round((F / before) * 100)];
        // 합계는 반올림한 두 부분의 합으로 — 따로 반올림하면 '46%(올인 24% · 콜 23%)'처럼 더해지지 않아요.
        lines.push(`그래서 오픈한 패의 ${c + f}%를 지키는데, 콜(${c}%)이 4벳(${f}%)보다 많아요.`);
        ids = ['vs3bet-position', 'threebet-shape', 'offsuit-3bet-pot'];
      } else {
        lines.push(`${josa(h, '은/는')} ${v}보다 포지션이 없어서, 콜하면 플랍 이후 내내 불리해요.`);
        const ipRef: Scenario = { kind: 'vs_3bet', hero: h, villain: 'BB' };
        const ipD = h !== 'SB' && hasChart(ipRef) ? defendShare(ipRef) : null;
        lines.push(
          ipD != null
            ? `그래서 오픈한 패의 ${pct(D!)}만 지키고 나머지는 폴드해요(BB의 3벳에는 ${pct(ipD)}를 지켜요).`
            : `그래서 오픈한 패의 ${pct(D!)}만 지키고 나머지는 폴드해요.`,
        );
        ids = h === 'SB' ? ['blind-vs-blind', 'vs3bet-position', 'offsuit-3bet-pot'] : ['vs3bet-position', 'offsuit-3bet-pot', 'threebet-shape'];
        if (ipD != null) {
          const before = share({ kind: 'rfi', hero: h }, 'raise');
          const fOop = F / before;
          const fIp = share(ipRef, 'fourbet') / before;
          diff =
            fOop > fIp
              ? null
              : `책은 포지션이 없을 때 4벳을 늘린다고 해요(HJ가 오픈한 패 중 CO의 3벳에는 약 22%, BB의 3벳에는 약 10%를 4벳). 이 차트는 지키는 폭을 줄이지만 4벳을 늘리지는 않아요(오픈한 패의 ${pct(fOop)}, BB 상대는 ${pct(fIp)}).`;
        }
      }
      break;
    }
    case 'vs_4bet': {
      const spr = sprAfterCall(s);
      lines.push(`4벳 팟은 이미 팟이 커서, 콜하면 남은 스택이 팟의 두 배도 안 돼요(SPR 약 ${spr ? spr.toFixed(1) : '1.7'}).`);
      const before = share({ kind: 'vs_open', hero: h, villain: v }, 'threebet');
      const [a, c] = [Math.round((A / before) * 100), Math.round((C / before) * 100)];
      lines.push(`그래서 3벳한 패 중 ${a + c}%만 계속 가요(올인 ${a}% · 콜 ${c}%).`);
      ids = ['vs-4bet', 'fourbet-polar'];
      if (primaryHands(s, 'allin').some((x) => /^A[2-5]s$/.test(x)) || fullMix(getChartCells(s)['A5s'])?.some((m) => m.action === 'allin')) ids.push('fivebet-bluff');
      const ip = heroInPosition(h, v!);
      diff =
        ip && A > C
          ? `책은 4벳을 받은 쪽이 포지션이 있으면 대부분 콜하고, AA도 절반쯤은 콜로 숨긴다고 해요. 이 차트는 포지션이 있어도 올인이 콜보다 많고, AA는 늘 올인해요.`
          : '책은 4벳을 받으면 포지션과 상대 4벳의 모양에 따라 올인과 콜을 나누고, 상대 4벳이 양극화될수록 AA도 콜로 숨긴다고 해요. 이 차트는 AA를 콜로 섞지 않고 늘 올인해요.';
      break;
    }
    case 'vs_5bet': {
      lines.push('올인(5벳)에 콜하면 남은 스택을 전부 걸게 돼서, 상대 올인 범위를 상대로 높은 승률이 필요해요.');
      lines.push('그래서 그만큼 에퀴티가 있는 패만 콜하고, 블러프로 4벳한 패는 폴드해요.');
      ids = ['vs-5bet', 'fourbet-polar'];
      diff = `책은 올인(5벳)에 일반적으로 TT 이상과 AK가 콜하고, BTN은 66 이상까지 콜한다고 해요. 이 차트는 그보다 좁게 ${weightedList(s, 'call', true)}만 콜해요.`;
      break;
    }
    case 'cold_4bet': {
      lines.push(`${h} 앞에서 이미 오픈과 3벳이 나왔어요. 콜하면 내 패 정보가 새고, 뒤 사람들이 싸게 들어올 수 있어요.`);
      lines.push(`그래서 콜은 거의 하지 않고 4벳(${p1(F)}) 아니면 폴드로 정리해요.`);
      ids = ['cold-4bet', 'fourbet-polar', 'blockers'];
      diff = `책은 콜드 4벳을 상대가 타이트하면 약 3%, 넓으면 약 6%로 둬요. 이 차트는 약 ${p1(F)}로 더 좁아요.`;
      break;
    }
    case 'vs_limp': {
      const W = share(s, 'raise');
      if (h === 'BB') {
        lines.push('BB는 림프에 체크하면 돈을 더 내지 않고 플랍을 봐요.');
        lines.push(`그래서 폴드하는 패는 없고, 강한 패 ${pct(W)}만 레이즈해요.`);
        ids = ['free-check', 'vs-limper'];
      } else {
        const rfiW = share({ kind: 'rfi', hero: h }, 'raise');
        lines.push('앞에서 한 명이 림프했어요. SB 말고 림프하는 사람은 약한 경우가 많아, 레이즈로 아이솔레이트해 혼자 상대해요.');
        lines.push(`누가 먼저 들어온 만큼 처음 들어갈 때(${pct(rfiW)})보다 좁게, ${pct(W)}만 레이즈해요.`);
        ids = ['vs-limper', 'tighter-after-raise'];
      }
      diff = '책은 림퍼가 수동적이면 아주 넓게, 공격적이면 강한 패 위주로 아이솔레이트하라고 해요. 이 차트는 상대 유형을 모를 때 쓰는 기본값이에요.';
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
