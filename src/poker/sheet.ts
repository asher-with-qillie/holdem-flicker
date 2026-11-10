import { gateText, handAtlas, rfiThesis, type AtlasCell, type Claim, type LeverId, type Line } from './atlas';
import { getChartCells, getChartDef } from './data';
import { classifyHand, dominatorOf, duel, exampleCtx, heroIsIP, seatsBehind, show, villainChart, type HandClass } from './explain';
import { parseHandName } from './hands';
import { actWord, emWidth, josa, splitOf, splitPhrase } from './ko';
import { lineOf, lineSentence, weightWord, type LineDef, type LineSentence, type WeightWord } from './line';
import { priceFacts } from './priceFacts';
import { AGGRESSION_ORDER, rangeShare, restAction } from './range';
import { scenarioKey } from './scenarios';
import type { Step } from './trainer';
import { POSITIONS, type Action, type HandName, type Pos, type Scenario } from './types';
import { PARTIAL_THRESHOLD } from '../screens/quiz/grade'; // 순수 상수 — 채점과 부분 정답 문장이 같은 기준을 씁니다.

/*
 * 해설 시트의 ②~⑦ — docs/EXPLAIN_SPEC.md §4.2.
 *
 * 시트는 리빌과 같은 덩어리(줄)를 한 번 더 보여 주고 두 축을 덧붙입니다:
 * 줄 축(같은 높은 카드의 반대 수티드 줄)과 자리 축(이 패의 자리별 칩 한 줄 + 자리 문장 한 줄).
 * 모든 문장은 차트에서 계산하고, 자리 문장은 atlas 의 Line { claims }로 만들어 tests/atlas.test.ts 가 다시 계산합니다.
 */

const pct = (x: number) => Math.round(x * 100);
const agg = (a: Action) => AGGRESSION_ORDER.indexOf(a);

/* ------------------------------------------------------------------ */
/* ② 형제 줄                                                             */
/* ------------------------------------------------------------------ */

/**
 * 같은 높은 카드, 반대 수티드니스의 줄. 패가 수티드나 오프수트이고 커넥터 줄이 아닐 때만, 그리고 그 줄에
 * 도달 칸이 있을 때만. 주어를 빼고 목적어를 주제어로 씁니다('수티드 8은 85s까지 오픈해요.').
 */
export function siblingLine(s: Scenario, hand: HandName): LineSentence | null {
  const info = parseHandName(hand);
  if (info.kind === 'pair' || lineOf(hand).id === 'conn') return null;
  const def = rowLine(info.high, info.kind === 'suited' ? 'o' : 's');
  return def ? lineSentence(s, def, { topic: true }) : null;
}

/**
 * 높은 카드 hi 의 수티드(s)/오프수트(o) 행 줄. 그 행에서 커넥터가 아닌 패 하나로 lineOf 를 부릅니다 —
 * 수티드 3 행은 32s(커넥터)뿐이라 줄이 없습니다(null).
 */
function rowLine(hi: string, suf: 's' | 'o'): LineDef | null {
  const ranks = 'AKQJT98765432';
  for (const lo of ranks.slice(ranks.indexOf(hi) + 1)) {
    const def = lineOf(`${hi}${lo}${suf}`);
    if (def.id === `${suf}${hi}`) return def;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* ④ 숫자 줄                                                             */
/* ------------------------------------------------------------------ */

/** 정수 %. 0보다 크고 0.5% 미만이면 '1% 미만'(§4.2-④). */
function pctLabel(share: number): string {
  const n = pct(share);
  return n === 0 && share > 0 ? '1% 미만' : `${n}%`;
}

const RFI_SEATS: Pos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB'];
const VILLAIN_WORD: Partial<Record<Scenario['kind'], string>> = { vs_open: '오픈', vs_3bet: '3벳', vs_4bet: '4벳', vs_5bet: '올인' };

/**
 * 숫자 줄. 모든 %는 rangeShare(1,326조합 가중)를 반올림한 정수 하나뿐입니다.
 * 내 액션은 비중이 큰 순서로, 0인 액션과 나머지(폴드·체크)는 뺍니다.
 * rfi 사다리의 SB 는 차트에 림프가 있으면 레이즈와 림프를 따로 적습니다('SB 레이즈 24% · 림프 38%') — 둘을 더해
 * 'SB 62%'라고 하면 BTN 보다 넓게 '오픈'한다고 읽히고, 레이즈만 적으면 림프가 사라집니다.
 */
export type LadderRung = { pos: Pos; pct: number; me: boolean; limp?: number };
type SeatNumbers = { text: string; ladder: LadderRung[] | null; nums: number[] };

/** 사다리 한 칸의 글자: 'BTN 46%' · 림프가 있으면 'SB 레이즈 24% · 림프 38%'. 화면(ExplanationSheet)도 이 글자를 씁니다. */
export function rungText(x: LadderRung): string {
  return x.limp ? `${x.pos} 레이즈 ${x.pct}% · 림프 ${x.limp}%` : `${x.pos} ${x.pct}%`;
}
const numbersCache = new Map<string, SeatNumbers>();

export function seatNumbers(s: Scenario): SeatNumbers {
  // 169패를 훑는 rangeShare 를 여러 번 부르므로 (상황, 자리)별로 한 번만 계산합니다.
  const k = scenarioKey(s);
  let v = numbersCache.get(k);
  if (!v) {
    v = computeSeatNumbers(s);
    numbersCache.set(k, v);
  }
  return v;
}

function computeSeatNumbers(s: Scenario): SeatNumbers {
  if (s.kind === 'rfi') {
    const ladder = RFI_SEATS.map((pos): LadderRung => {
      const cells = getChartCells({ kind: 'rfi', hero: pos });
      const limp = rangeShare(cells, 'limp');
      const rung: LadderRung = { pos, pct: pct(rangeShare(cells, 'raise')), me: pos === s.hero };
      if (limp > 0) rung.limp = pct(limp);
      return rung;
    });
    return { text: ladder.map(rungText).join(' · '), ladder, nums: ladder.flatMap((x) => (x.limp ? [x.pct, x.limp] : [x.pct])) };
  }
  const cells = getChartCells(s);
  const rest = restAction(getChartDef(s));
  const mine = (['call', 'limp', 'raise', 'threebet', 'fourbet', 'allin'] as Action[])
    .filter((a) => a !== rest)
    .map((a) => ({ a, share: rangeShare(cells, a) }))
    .filter((x) => x.share > 0)
    .sort((x, y) => y.share - x.share || agg(y.a) - agg(x.a));
  const nums = mine.map((x) => pct(x.share));
  const my = mine.map((x) => `${actWord(x.a, s.kind)} ${pctLabel(x.share)}`).join(' · ');
  if (s.kind === 'cold_4bet') return { text: `내 ${my}`, ladder: null, nums };
  if (s.kind === 'vs_limp') return { text: s.hero === 'BB' ? `내 ${my} · 나머지 체크` : `내 ${my}`, ladder: null, nums };
  const vc = villainChart(s);
  const W = vc ? rangeShare(vc.cells, vc.action) : 0;
  return { text: `${s.villain} ${VILLAIN_WORD[s.kind]} ${pctLabel(W)} → 내 ${my}`, ladder: null, nums: [pct(W), ...nums] };
}

/* ------------------------------------------------------------------ */
/* ⑤ 레버                                                                */
/* ------------------------------------------------------------------ */

/** SB 가 콜을 '거의 안 한다'고 말해도 되는 상한(콜 비중, 전체 패 기준). */
const SB_CALL_RARE = 0.02;
/** 책 5장 2절의 BTN 오픈 폭(약 43%). */
const BOOK_BTN_OPEN = 43;

/**
 * 자리 사실 한 문장 — 위에서부터 처음 맞는 하나만(§4.2-⑤). 전부 데이터로 판단합니다.
 * 지금은 시트에 그리지 않지만(자리 이유 theory/spot.ts 가 대신합니다) Explanation.seat.lever 로 남아 있어 참인 말만 둡니다:
 *  - SB 오픈: 뒤에 한 명뿐이라서 넓은 게 아닙니다 — SB(46.2%)는 BTN(46.3%)보다 넓지 않고, 포지션이 없어서예요(atlas.SB_OPEN).
 *  - BTN 오픈: 책은 약 43%(5장 2절) — 차트 폭과 함께 책의 숫자를 밝힙니다.
 *  - SB 의 오픈 대응: 차트는 콜을 0.7~1.5% 섞어서 '대부분' 3벳 아니면 폴드.
 *  - HJ · CO · BTN 의 오픈 대응: '포지션이 있어요'만 말하면 콜의 이유처럼 읽힙니다. 책은 뒤에 남은 사람의 스퀴즈 때문에
 *    HJ · CO 는 콜 없이 3벳 아니면 폴드, BTN 도 넓게 여는 상대에게는 콜을 줄인다고 해요(5장 5절) — 그 위험을 함께 말합니다.
 */
export function seatLever(s: Scenario): { text: string; id: LeverId } | null {
  const { kind, hero } = s;
  const v = s.villain;
  if (kind === 'rfi') {
    const W = pct(rangeShare(getChartCells(s), 'raise'));
    // 레버는 30자(공백 뺀 글자) 안 — tests/line.test.ts.
    if (hero === 'SB') {
      // 림프가 있는 차트는 레이즈와 림프를 따로(책 5장 2절 — 레이즈 약 24% · 림프 약 38%).
      const L = pct(rangeShare(getChartCells(s), 'limp'));
      if (L > 0) return { id: 'sbOpen', text: `SB는 포지션이 없어 레이즈 ${W}%에 림프 ${L}%를 섞어요.` };
      const btn = pct(rangeShare(getChartCells({ kind: 'rfi', hero: 'BTN' }), 'raise'));
      if (W === btn) return { id: 'sbOpen', text: `SB는 BB만 남아도 포지션이 없어 BTN만큼인 ${W}%를 오픈해요.` };
      if (W < btn) return { id: 'sbOpen', text: `SB는 포지션이 없어서 BTN보다 좁은 ${W}%를 오픈해요.` };
      return { id: 'sbOpen', text: `SB는 뒤에 BB만 남아 ${W}%를 오픈해요.` };
    }
    if (hero === 'BTN') {
      const cmp = W > BOOK_BTN_OPEN ? '보다 넓은' : W < BOOK_BTN_OPEN ? '보다 좁은' : '와 같은';
      return { id: 'behind', text: `BTN은 블라인드만 남아 책의 약 ${BOOK_BTN_OPEN}%${cmp} ${W}%를 오픈해요.` };
    }
    return { id: 'behind', text: `${josa(hero, '은/는')} 뒤에 ${seatsBehind(hero)}명이 남아 ${W}%만 오픈해요.` };
  }
  if (kind === 'vs_open' && hero === 'SB' && rangeShare(getChartCells(s), 'call') < SB_CALL_RARE) {
    return { id: 'sbRaiseOrFold', text: 'SB는 콜을 거의 안 하고, 대부분 3벳 아니면 폴드해요.' };
  }
  if (kind === 'vs_open' && v && (hero === 'HJ' || hero === 'CO' || hero === 'BTN')) {
    return { id: 'behind', text: `${josa(hero, '은/는')} 포지션이 있어도 콜하면 뒤에서 스퀴즈를 받기 쉬워요.` };
  }
  if (kind === 'vs_open' && hero === 'BB') {
    const price = priceFacts(s);
    if (price) return { id: 'bbPrice', text: `BB는 이미 1bb를 냈으니 ${price.toCall}만 더 내면 돼요.` };
  }
  if (kind === 'vs_limp' && hero === 'BB') return { id: 'bbFree', text: 'BB는 이미 1bb를 냈으니 체크하면 공짜로 플랍을 봐요.' };
  if ((kind === 'vs_open' || kind === 'vs_3bet' || kind === 'vs_4bet') && v) {
    return { id: 'position', text: `${josa(hero, '은/는')} ${v}보다 포지션이 ${heroIsIP(s) ? '있어요' : '없어요'}.` };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* ⑥ 자리 칩 줄과 자리 문장                                              */
/* ------------------------------------------------------------------ */

const claimOf = (c: AtlasCell): Claim => ({ scenario: c.scenario, action: c.primary, weight: c.weightClass });
const cellRest = (c: AtlasCell): Action => restAction(getChartDef(c.scenario));
const wordOf = (c: AtlasCell): WeightWord => weightWord(c.mixList, cellRest(c));
const seatOf = (c: AtlasCell): Pos => c.scenario.hero;

/** 자리 묶음: 축 순서로 연속 3자리 이상이면 X~Y, 그 밖은 X·Y. axis 는 행 전체(도달 불가 칸 포함)의 순서. */
function seatList(seats: Pos[], axis: Pos[]): string {
  const sorted = [...seats].sort((a, b) => axis.indexOf(a) - axis.indexOf(b));
  const groups: Pos[][] = [];
  for (const p of sorted) {
    const g = groups[groups.length - 1];
    if (g && axis.indexOf(p) === axis.indexOf(g[g.length - 1]) + 1) g.push(p);
    else groups.push([p]);
  }
  return groups.map((g) => (g.length >= 3 ? `${g[0]}~${g[g.length - 1]}` : g.join('·'))).join('·');
}

/** 반반 칸의 두 액션: '4벳과 콜을'. */
const tiePair = (c: AtlasCell): string => `${josa(actWord(c.mixList[0].action, c.scenario.kind), '과/와')} ${josa(actWord(c.mixList[1].action, c.scenario.kind), '을/를')}`;
/** 비중어 + 공백(full 이면 빈 문자열). '반반'은 tiePair 로 따로 씁니다. */
const wPrefix = (w: WeightWord): string => (w === 'full' ? '' : `${w} `);

/** 문장 앞머리 ctx(§4.2-⑥). */
function ctxOf(s: Scenario): string {
  switch (s.kind) {
    case 'vs_open':
      return `${s.villain} 오픈에`;
    case 'vs_3bet':
      return `${s.villain} 3벳에`;
    case 'vs_4bet':
      return `${s.villain} 4벳에`;
    case 'vs_5bet':
      return `${s.villain} 올인에`;
    case 'cold_4bet':
      // 콜드 상황은 앞에서 오픈과 3벳이 둘 다 나온 자리입니다(책 5장 3절) — 3벳만 말하면 그 앞의 오픈이 빠집니다.
      return '오픈과 3벳 뒤에';
    default:
      return '림프에';
  }
}

/** 자리 문장 한도(§2.5). */
export const ACROSS_MAX_EM = 46;

/** 1순위 비중이 이 값 이상이면 비중어 없이 액션만 말해도 됩니다(§3.4 이름 규칙 — 줄 문장과 같은 기준, '주로'). */
const STRONG = 0.6 - 1e-9;
const strongCell = (c: AtlasCell) => (c.mixList[0]?.weight ?? 1) >= STRONG;

/**
 * 자리 문장(S-0 · S-a · S-b · S-b′ · S-c). live = 도달 칸만, axis = 행 전체의 자리 순서.
 * 줄 문장과 같은 이름 규칙을 따릅니다: 비중 0.5 이하인 자리는 비중어와 함께 부르고, 묶어서 말하는 자리들은
 * 그 액션이 1순위이고 비중이 0.6 이상이어야 합니다. 그리고 THEORY_SPEC §5:
 *  - 다른 자리는 '다른 자리에서는'으로 부릅니다(비중어 바로 뒤의 '나머지는'은 "나머지 절반은"으로 읽힙니다).
 *    열에 도달할 수 없는 자리가 있으면 '어느 자리에서나' · '다른 자리에서는' 대신 자리 이름을 댑니다 — 못 오는 자리까지 덮지 않게.
 *  - 'X에서만 폴드해요'는 다른 자리가 콜인지 3벳인지 안 보여서, 다른 자리가 rest(폴드·체크)가 아니면 그 액션까지 말합니다.
 *  - 세 액션 자리(콜 50 · 4벳 25 · 폴드 25)는 비중어 하나로 줄이지 않고 나눔을 부릅니다.
 */
function seatAxisText(s: Scenario, hand: HandName, live: AtlasCell[], axis: Pos[]): string {
  const kind = s.kind;
  const H = `${josa(hand, '은/는')} ${ctxOf(s)}`;
  const V = (a: Action, end: '해요' | '하고') => `${actWord(a, kind)}${end}`;
  const byPrimary = new Map<Action, AtlasCell[]>();
  for (const c of live) byPrimary.set(c.primary, [...(byPrimary.get(c.primary) ?? []), c]);
  const groups = [...byPrimary.entries()];
  const splitOfCell = (c: AtlasCell) => splitOf(c.mixList);
  /** 같은 라벨인가: 비중어 · 반반의 2순위 · 세 액션의 나눔까지 같아야 한 묶음으로 부릅니다. */
  const key = (c: AtlasCell) => `${wordOf(c)}|${wordOf(c) === '반반' ? c.mixList[1].action : ''}|${(splitOfCell(c) ?? []).join()}`;
  const sameWord = (cs: AtlasCell[]) => cs.every((c) => key(c) === key(cs[0]));
  const seats = (cs: AtlasCell[]) => seatList(cs.map(seatOf), axis);
  /** 열의 모든 자리가 도달 가능한가 — 아니면 '어느 자리에서나' · '다른 자리에서는'이 못 오는 자리까지 덮습니다. */
  const allLive = live.length === axis.length;
  const others = (cs: AtlasCell[]) => (allLive ? '다른 자리에서는' : `${seats(cs)}에서는`);
  /** 비중어 + 동사: '절반만 콜하고' · '콜해요' · '4벳과 콜을 반반 섞고' · '절반은 콜하고, 나머지를 4벳과 폴드로 나눠요'(끝 절만). */
  const wv = (c: AtlasCell, end: '해요' | '하고'): string | null => {
    const sp = splitOfCell(c);
    if (sp) return end === '해요' ? splitPhrase(sp, kind, 'solo') : null;
    const w = wordOf(c);
    return w === '반반' ? `${tiePair(c)} 반반 ${end === '해요' ? '섞어요' : '섞고'}` : `${wPrefix(w)}${V(c.primary, end)}`;
  };
  const anySplit = live.some((c) => splitOfCell(c));
  const words = (cs: AtlasCell[]) => cs.map(wordOf);

  // S-0(림프): 어느 자리도 레이즈를 섞지 않으면 '어느 자리에서도 레이즈하지 않아요' — 'BB에서만 체크해요'는 BB 만
  // 체크할 수 있다는 당연한 말이라 아무것도 가르치지 않습니다(rfiThesis 의 '오픈하지 않아요'와 같은 꼴).
  if (kind === 'vs_limp' && live.length >= 2 && live.every((c) => c.mixList.every((m) => m.action === 'fold' || m.action === 'check' || m.weight < 0.001))) {
    return `${H} 어느 자리에서도 ${actWord('raise', kind)}하지 않아요.`;
  }

  // S-a: 1순위가 하나
  if (groups.length === 1) {
    const [a, cs] = groups[0];
    const w = wordOf(cs[0]);
    if (sameWord(cs)) {
      // 도달 칸이 한 자리뿐이거나 열에 못 오는 자리가 있으면 '어느 자리에서나'가 거짓말이 됩니다 — 자리 이름을 씁니다.
      const where = cs.length === 1 || !allLive ? `${seats(cs)}에서` : '어느 자리에서나';
      return w === '반반' ? `${H} ${where} ${tiePair(cs[0])} 반반 섞어요.` : `${H} ${where} ${wv(cs[0], '해요')}.`;
    }
    const ws = new Map<WeightWord, AtlasCell[]>();
    for (const c of cs) ws.set(wordOf(c), [...(ws.get(wordOf(c)) ?? []), c]);
    if (!anySplit && !words(cs).includes('반반')) {
      const parts = [...ws.entries()].map(([ww, g]) => `${seats(g)}에서 ${ww === 'full' ? '항상' : ww}`);
      return `${H} ${parts.join(', ')} ${V(a, '해요')}.`;
    }
    // 반반이 섞이면 비중어별로 자리를 묶어 두 절로: 'HJ~BTN에서 주로 올인하고, SB·BB에서는 올인과 콜을 반반 섞어요.'
    if (!anySplit && ws.size === 2) {
      const [[, g1], [, g2]] = [...ws.entries()];
      return `${H} ${seats(g1)}에서 ${wv(g1[0], '하고')}, ${seats(g2)}에서는 ${wv(g2[0], '해요')}.`;
    }
  }

  // S-b: 1순위가 두 가지, 소수 ≤ 2자리, 다수 ≥ 2자리(동수면 더 공격적인 쪽을 소수로 부릅니다)
  if (groups.length === 2) {
    const [x, y] = groups;
    const [minor, major] = x[1].length < y[1].length || (x[1].length === y[1].length && agg(x[0]) > agg(y[0])) ? [x, y] : [y, x];
    if (minor[1].length <= 2 && major[1].length >= 2) {
      const [ma, mcs] = minor;
      const [mj, jcs] = major;
      // 다수의 말: 비중어가 같으면 그 말, 다르지만 전부 센 칸(full · 주로)이면 비중어 없이, 섞인 칸(≤ 0.5)이 끼면 하나로 못 묶으니 S-c.
      const majorWord = sameWord(jcs) ? wv(jcs[0], '해요') : jcs.every(strongCell) ? V(mj, '해요') : null;
      if (mcs.every((c) => wordOf(c) === 'full') && jcs.every(strongCell)) {
        // '…에서만 X해요'는 다른 자리를 다수 액션으로 덮습니다. 다수가 rest(폴드)면 그 말로 충분하지만('KTs는 BB에서만 콜해요'),
        // 아니면 다른 자리가 무엇을 하는지 안 보입니다 — 'KTs는 UTG 오픈에 SB에서만 폴드하고, 다른 자리에서는 콜해요.'
        if (jcs.every((c) => c.primary === cellRest(c))) return `${H} ${seats(mcs)}에서만 ${V(ma, '해요')}.`;
        // 림프의 BB 체크는 BB 만 할 수 있어서 'BB에서만 체크해요'는 당연한 말입니다 — 레이즈하는 자리를 먼저 부릅니다.
        if (kind === 'vs_limp' && ma === 'check') return `${H} ${seats(jcs)}에서 ${V(mj, '하고')}, BB에서는 체크해요.`;
        if (majorWord) return `${H} ${seats(mcs)}에서만 ${V(ma, '하고')}, ${others(jcs)} ${majorWord}.`;
      }
      const minorWord = sameWord(mcs) ? wv(mcs[0], '하고') : null;
      if (minorWord && majorWord) return `${H} ${seats(mcs)}에서는 ${minorWord}, ${others(jcs)} ${majorWord}.`;
    }
  }

  // S-b′: 계속하는 1순위 그룹이 하나이고 ≤ 2자리, 나머지가 전부 폴드나 체크이고 ≥ 2자리
  const isRest = (c: AtlasCell) => c.primary === cellRest(c) || c.primary === 'fold' || c.primary === 'check';
  const contGroups = groups.filter(([, cs]) => !cs.every(isRest));
  const restCells = live.filter(isRest);
  if (contGroups.length === 1 && contGroups[0][1].length <= 2 && restCells.length >= 2 && contGroups[0][1].every((c) => !isRest(c)) && sameWord(contGroups[0][1]) && (sameWord(restCells) || restCells.every(strongCell))) {
    const [, cs] = contGroups[0];
    const lead = wv(cs[0], '하고');
    if (lead) {
      const restActs = new Set(restCells.map((c) => c.primary));
      const restWord = restActs.size === 2 ? '폴드나 체크' : restActs.has('check') ? '체크' : '폴드';
      const w = sameWord(restCells) ? wPrefix(wordOf(restCells[0])) : '';
      return `${H} ${seats(cs)}에서 ${lead}, ${others(restCells)} ${w}${josa(restWord, '이에요/예요')}.`;
    }
  }

  // S-c: 자리를 라벨로 묶어 나열. 센 칸(≥ 0.6)은 1순위 액션으로, 섞인 칸(≤ 0.5)은 캡슐 라벨('절반만 레이즈',
  // '3벳·콜 반반')로 따로 묶습니다 — 섞인 자리를 같은 액션의 다른 자리 속에 숨기지 않습니다.
  // 세 액션 자리는 '절반은 콜, 절반은 4벳·폴드'로 부르고, 그러면 46em 을 넘는 문장은 '콜 반·4벳·폴드'로,
  // 그래도 넘치면 '절반은 콜'로 줄입니다('절반만 콜'은 나머지 절반이 폴드라는 말이라 세 액션 자리에는 쓰지 않습니다).
  // 마지막 단계에서는 같은 1순위의 '절반만' 자리도 '절반은'으로 같이 묶습니다(참인 말: 절반은 콜).
  const sc = (level: 0 | 1 | 2 | 3) => {
    const label = (c: AtlasCell) => {
      const sp = splitOfCell(c);
      if (sp) {
        const [a1, ...rest] = sp.map((x) => actWord(x, kind));
        return level === 0 ? splitPhrase(sp, kind, 'noun') : level === 1 ? `${a1} 반·${rest.join('·')}` : `절반은 ${a1}`;
      }
      if (level === 3 && wordOf(c) === '절반만' && live.some((x) => splitOfCell(x) && x.primary === c.primary)) return `절반은 ${actWord(c.primary, kind)}`;
      return strongCell(c) ? actWord(c.primary, kind) : wordOf(c) === '반반' ? `${actWord(c.mixList[0].action, kind)}·${actWord(c.mixList[1].action, kind)} 반반` : `${wordOf(c)} ${actWord(c.primary, kind)}`;
    };
    const byLabel = new Map<string, AtlasCell[]>();
    for (const c of live) byLabel.set(label(c), [...(byLabel.get(label(c)) ?? []), c]);
    const parts = [...byLabel.entries()].map(([l, cs]) => `${seats(cs)}에서 ${l}`);
    const last = parts.pop()!;
    return `${H} ${[...parts, josa(last, '이에요/예요')].join(', ')}.`;
  };
  if (!anySplit) return sc(0);
  return ([0, 1, 2, 3] as const).map(sc).find((t) => emWidth(t) <= ACROSS_MAX_EM) ?? sc(3);
}

/**
 * ⑥ 이 패, 다른 자리에서는: 자리 칩 줄과 자리 문장 한 줄.
 * rfi·cold_4bet·vs_limp 는 스트립 전체, 대응 상황은 같은 상대 열(hero 축)의 칸들입니다.
 */
export function acrossRow(s: Scenario, hand: HandName): { cells: AtlasCell[]; line: Line } {
  const atlas = handAtlas(hand);
  const sec = atlas.sections[s.kind];
  const cells = sec.layout === 'strip' ? sec.cells : sec.cells.filter((c) => c.scenario.villain === s.villain);
  const live = cells.filter((c) => c.reachable);
  if (s.kind === 'rfi') return { cells, line: rfiThesis(atlas)[0] };
  if (!live.length) {
    // 차트 탭에서 이 상황까지 올 수 없는 패를 눌렀을 때: 열 전체가 도달 불가입니다. 미도달 문장(gateText)을 그대로 씁니다.
    const own = cells.find((c) => c.scenario.hero === s.hero) ?? cells[0];
    return { cells, line: { text: (own && gateText(own)) ?? '', claims: [], nums: [], source: 'computed' } };
  }
  const axis = cells.map(seatOf);
  const text = seatAxisText(s, hand, live, axis.length ? axis : [...POSITIONS]);
  return { cells, line: { text, claims: live.map(claimOf), nums: [], source: 'computed' } };
}

/* ------------------------------------------------------------------ */
/* ③ 섞인 칸                                                             */
/* ------------------------------------------------------------------ */

/**
 * 섞는 비율 칩과 부분 정답 문장. 단색 칸이면 null. 부분 정답 문장은 2순위 비중이 PARTIAL_THRESHOLD 이상일 때만 —
 * 채점이 부분 정답을 주는 칸과 정확히 같습니다.
 *
 * 책 2장 4절(무차별): 한 패를 두 액션으로 나눠 쓰면 두 액션의 가치(EV)는 같습니다. 그래서 '정답'은 앱의 채점일 뿐,
 * 한쪽이 더 낫다는 말이 아니라는 것을 먼저 말합니다: '3벳과 콜은 가치가 비슷해요. 채점은 더 공격적인 3벳이 정답이에요.'
 * (2순위를 고르면 부분 정답이라는 것은 채점 결과가 보여 줍니다 — 문장은 40자 안, tests/explain.test.ts.)
 * '더 공격적인'은 두 계속 액션이 같은 비중일 때만(§2.2) — 콜/폴드 50-50 은 캡슐이 '절반만 콜'이고, 콜을 '공격적'이라 부르지 않습니다.
 */
export function mixBlock(step: Step): { chips: Array<{ action: Action; pct: number }>; partial: string | null } | null {
  const list = step.mixList;
  if (list.length < 2 || list[0].weight >= 0.999) return null;
  const kind = step.scenario.kind;
  const chips = list.map((m) => ({ action: m.action, pct: pct(m.weight) }));
  const [a1, a2] = list;
  let partial: string | null = null;
  if (a2.weight >= PARTIAL_THRESHOLD) {
    const w1 = actWord(a1.action, kind);
    const w2 = actWord(a2.action, kind);
    const tie = Math.abs(a1.weight - a2.weight) < 0.01;
    const aggressive = tie && a2.action !== restAction(step.chart) ? '더 공격적인 ' : '';
    partial = `${josa(w1, '과/와')} ${josa(w2, '은/는')} 가치가 비슷해요. 채점은 ${aggressive}${josa(w1, '이/가')} 정답이에요.`;
  }
  return { chips, partial };
}

/* ------------------------------------------------------------------ */
/* ⑦ 예시 한 줄                                                          */
/* ------------------------------------------------------------------ */

/** 킥커 대결 줄을 쓰는 계열(§4.2-⑦). wheel_ace 는 블로커 줄을 따로 씁니다. */
const KICKER_CLASSES = new Set<HandClass>(['big_ace', 'suited_ace', 'offsuit_ace', 'suited_broadway', 'offsuit_broadway', 'suited_king', 'suited_qj']);
/** 블러프로 쓰는 액션 — 블로커 줄은 이 액션이 1순위인 칸에만 붙습니다. */
const BLUFF_ACTIONS = new Set<Action>(['threebet', 'fourbet', 'allin']);
/** 셋 확률 줄이 맞는 결정 — 플랍을 보러 들어가는 콜 · 오픈(레이즈) · SB 림프 · BB 체크. 3벳 이상은 셋 확률이 이유가 아닙니다. */
const SET_ACTIONS = new Set<Action>(['call', 'raise', 'limp', 'check']);
/** 섞인 칸(1순위 < 60%, THEORY_SPEC §6.1). */
const MIXED = 0.6 - 1e-9;

/**
 * 패 하나의 예시 모양(결정과 상관없이) — 카드 그림 검사에 씁니다. 해당하지 않으면 null.
 *  - 중간·작은 페어(set): `내 2♠2♦ → 플랍에서 셋이 될 확률은 약 12%예요.` — 책은 작은 페어를 셋이 될 확률(약 12%)과
 *    보드 커버리지로 설명합니다(THEORY_SPEC §1-2).
 *  - 킥커 대결(domination): `내 K♠10♠ vs 상대 A♦K♦ → K를 맞춰도 킥커에서 밀려요.` — 상대는 내 높은 카드에 더 큰 킥커(A)를 붙인 패,
 *    수티드니스는 내 패와 같게(수티드면 AKs, 오프수트면 AKo). 내 높은 카드가 A 면 AK.
 *  - 휠 A(blocker): `내 A♠5♠ → A를 쥐고 있어 상대 AA·AK 조합이 줄어요.`
 * 무늬는 늘 ♠ 쪽으로 만들고, explainStep 이 화면 카드에 맞춰 뒤집습니다.
 */
export function exampleShape(hand: HandName): { kind: 'set' | 'domination' | 'blocker'; text: string } | null {
  const info = parseHandName(hand);
  const cls = classifyHand(hand);
  const ctx = exampleCtx(info);
  // 정확히는 11.8% — 용어집('셋')과 원리 카드처럼 '약 12%'.
  if (cls === 'mid_pair' || cls === 'small_pair') return { kind: 'set', text: `내 ${ctx.me} → 플랍에서 셋이 될 확률은 약 12%예요.` };
  if (cls === 'wheel_ace') return { kind: 'blocker', text: `내 ${ctx.me} → A를 쥐고 있어 상대 AA·AK 조합이 줄어요.` };
  if (KICKER_CLASSES.has(cls) && dominatorOf(info)) {
    const opp = info.high === 'A' ? 'AK' : `A${info.high}`;
    return { kind: 'domination', text: duel(ctx, `${opp}${info.kind === 'suited' ? 's' : 'o'}`, `${josa(show(info.high), '을/를')} 맞춰도 킥커에서 밀려요.`) };
  }
  return null;
}

/**
 * 예시 한 줄(§4.2-⑦) — **결정과 맞을 때만**(THEORY_SPEC §6.4). 해당하지 않으면 null.
 *  - 지배 예시('킥커에서 밀려요')는 폴드 · 섞기 칸에만: 1순위가 폴드이거나, 섞인 칸(1순위 < 60%)에 폴드가 섞여 있을 때
 *    ('절반만 오픈'하는 KJo — 나머지 절반을 접는 이유). 오픈·콜·3벳만 하는 패에 '밀려요'를 붙이면 그 결정의 이유처럼
 *    읽히지만 거꾸로입니다(오픈하는 AQs, 체크하는 BB).
 *  - 블로커 예시('AA·AK 조합이 줄어요')는 블러프 칸, 곧 1순위가 3벳·4벳·올인인 칸에만.
 *  - 셋 확률 예시는 플랍을 보러 들어가는 칸(1순위가 콜·오픈·체크이거나, 섞인 칸에 콜·오픈이 섞임)에만 — 폴드하는 44,
 *    3벳하는 99 에는 붙지 않습니다(감사: 폴드 칸 118줄).
 */
export function oneExample(step: Step): string | null {
  const shape = exampleShape(step.hand);
  if (!shape) return null;
  const mix = step.mixList;
  const p = mix[0]?.action ?? step.answer;
  const mixed = (mix[0]?.weight ?? 1) < MIXED;
  const has = (as: Action[]) => mix.some((m) => as.includes(m.action) && m.weight > 0.001);
  switch (shape.kind) {
    case 'domination':
      return p === 'fold' || (mixed && has(['fold'])) ? shape.text : null;
    case 'blocker':
      return BLUFF_ACTIONS.has(p) ? shape.text : null;
    case 'set':
      return SET_ACTIONS.has(p) || (mixed && has(['call', 'raise', 'limp'])) ? shape.text : null;
  }
}
