import { gateText, handAtlas, rfiThesis, type AtlasCell, type Claim, type LeverId, type Line } from './atlas';
import { getChartCells, getChartDef } from './data';
import { classifyHand, dominatorOf, duel, exampleCtx, heroIsIP, seatsBehind, show, villainChart, type HandClass } from './explain';
import { parseHandName } from './hands';
import { actWord, josa } from './ko';
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
 */
type SeatNumbers = { text: string; ladder: Array<{ pos: Pos; pct: number; me: boolean }> | null; nums: number[] };
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
    const ladder = RFI_SEATS.map((pos) => ({ pos, pct: pct(rangeShare(getChartCells({ kind: 'rfi', hero: pos }), 'raise')), me: pos === s.hero }));
    return { text: ladder.map((x) => `${x.pos} ${x.pct}%`).join(' · '), ladder, nums: ladder.map((x) => x.pct) };
  }
  const cells = getChartCells(s);
  const rest = restAction(getChartDef(s));
  const mine = (['call', 'raise', 'threebet', 'fourbet', 'allin'] as Action[])
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

/** 자리 사실 한 문장 — 위에서부터 처음 맞는 하나만(§4.2-⑤). 전부 데이터로 판단합니다. */
export function seatLever(s: Scenario): { text: string; id: LeverId } | null {
  const { kind, hero } = s;
  const v = s.villain;
  if (kind === 'rfi') {
    const W = pct(rangeShare(getChartCells(s), 'raise'));
    if (hero === 'SB') return { id: 'sbOpen', text: `SB는 뒤에 BB 한 명만 남아 ${W}%를 오픈해요.` };
    if (hero === 'BTN') return { id: 'behind', text: `BTN은 뒤에 블라인드 둘만 남아 ${W}%를 오픈해요.` };
    return { id: 'behind', text: `${josa(hero, '은/는')} 뒤에 ${seatsBehind(hero)}명이 남아 ${W}%만 오픈해요.` };
  }
  if (kind === 'vs_open' && hero === 'SB' && rangeShare(getChartCells(s), 'call') < SB_CALL_RARE) {
    return { id: 'sbRaiseOrFold', text: 'SB는 콜을 거의 안 하고, 3벳 아니면 폴드해요.' };
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
      return '앞에서 3벳이 나오면';
    default:
      return '림프에';
  }
}

/** 자리 문장(S-a · S-b · S-b′ · S-c). live = 도달 칸만, axis = 행 전체의 자리 순서. */
function seatAxisText(s: Scenario, hand: HandName, live: AtlasCell[], axis: Pos[]): string {
  const kind = s.kind;
  const H = `${josa(hand, '은/는')} ${ctxOf(s)}`;
  const V = (a: Action, end: '해요' | '하고') => `${actWord(a, kind)}${end}`;
  const byPrimary = new Map<Action, AtlasCell[]>();
  for (const c of live) byPrimary.set(c.primary, [...(byPrimary.get(c.primary) ?? []), c]);
  const groups = [...byPrimary.entries()];
  const words = (cs: AtlasCell[]) => cs.map(wordOf);
  const sameWord = (cs: AtlasCell[]) => words(cs).every((w) => w === wordOf(cs[0]));
  const seats = (cs: AtlasCell[]) => seatList(cs.map(seatOf), axis);

  // S-a: 1순위가 하나
  if (groups.length === 1) {
    const [a, cs] = groups[0];
    const w = wordOf(cs[0]);
    if (sameWord(cs)) {
      // 도달 칸이 한 자리뿐이면 '어느 자리에서나'가 거짓말이 됩니다 — 그 자리 이름을 씁니다.
      const where = cs.length === 1 ? `${seats(cs)}에서` : '어느 자리에서나';
      return w === '반반' ? `${H} ${where} ${tiePair(cs[0])} 반반 섞어요.` : `${H} ${where} ${wPrefix(w)}${V(a, '해요')}.`;
    }
    if (!words(cs).includes('반반')) {
      const ws = new Map<WeightWord, AtlasCell[]>();
      for (const c of cs) ws.set(wordOf(c), [...(ws.get(wordOf(c)) ?? []), c]);
      const parts = [...ws.entries()].map(([ww, g]) => `${seats(g)}에서 ${ww === 'full' ? '항상' : ww}`);
      return `${H} ${parts.join(', ')} ${V(a, '해요')}.`;
    }
    // 반반과 다른 비중이 섞이면 S-c 의 라벨 꼴로 씁니다(아래).
  }

  // S-b: 1순위가 두 가지, 소수 ≤ 2자리, 다수 ≥ 2자리(동수면 더 공격적인 쪽을 소수로 부릅니다)
  if (groups.length === 2) {
    const [x, y] = groups;
    const [minor, major] = x[1].length < y[1].length || (x[1].length === y[1].length && agg(x[0]) > agg(y[0])) ? [x, y] : [y, x];
    if (minor[1].length <= 2 && major[1].length >= 2) {
      const [ma, mcs] = minor;
      if (mcs.every((c) => wordOf(c) === 'full')) return `${H} ${seats(mcs)}에서만 ${V(ma, '해요')}.`;
      if (sameWord(mcs)) {
        const w = wordOf(mcs[0]);
        const head = w === '반반' ? `${tiePair(mcs[0])} 반반 섞고` : `${wPrefix(w)}${V(ma, '하고')}`;
        return `${H} ${seats(mcs)}에서는 ${head}, 나머지는 ${V(major[0], '해요')}.`;
      }
    }
  }

  // S-b′: 계속하는 1순위 그룹이 하나이고 ≤ 2자리, 나머지가 전부 폴드나 체크이고 ≥ 2자리
  const isRest = (c: AtlasCell) => c.primary === cellRest(c) || c.primary === 'fold' || c.primary === 'check';
  const contGroups = groups.filter(([, cs]) => !cs.every(isRest));
  const restCells = live.filter(isRest);
  if (contGroups.length === 1 && contGroups[0][1].length <= 2 && restCells.length >= 2 && contGroups[0][1].every((c) => !isRest(c)) && sameWord(contGroups[0][1])) {
    const [a, cs] = contGroups[0];
    const w = wordOf(cs[0]);
    const restActs = new Set(restCells.map((c) => c.primary));
    const restWord = restActs.size === 2 ? '폴드나 체크' : restActs.has('check') ? '체크' : '폴드';
    const head = w === '반반' ? `${tiePair(cs[0])} 반반 섞고` : `${wPrefix(w)}${V(a, '하고')}`;
    return `${H} ${seats(cs)}에서 ${head}, 나머지는 ${josa(restWord, '이에요/예요')}.`;
  }

  // S-c: 1순위별로 자리를 묶어 라벨로. 반반 칸만 모인 묶음은 '3벳·콜 반반'.
  const label = (cs: AtlasCell[]) => {
    const c = cs[0];
    return cs.every((x) => wordOf(x) === '반반') ? `${actWord(c.mixList[0].action, kind)}·${actWord(c.mixList[1].action, kind)} 반반` : actWord(c.primary, kind);
  };
  const parts = groups.map(([, cs]) => `${seats(cs)}에서 ${label(cs)}`);
  const last = parts.pop()!;
  return `${H} ${[...parts, josa(last, '이에요/예요')].join(', ')}.`;
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
 */
export function mixBlock(step: Step): { chips: Array<{ action: Action; pct: number }>; partial: string | null } | null {
  const list = step.mixList;
  if (list.length < 2 || list[0].weight >= 0.999) return null;
  const kind = step.scenario.kind;
  const chips = list.map((m) => ({ action: m.action, pct: pct(m.weight) }));
  const [a1, a2] = list;
  let partial: string | null = null;
  if (a2.weight >= PARTIAL_THRESHOLD) {
    const second = `${actWord(a2.action, kind)}도 부분 정답이에요.`;
    partial = Math.abs(a1.weight - a2.weight) < 0.01 ? `반반이라 더 공격적인 ${josa(actWord(a1.action, kind), '을/를')} 정답으로 쳐요. ${second}` : second;
  }
  return { chips, partial };
}

/* ------------------------------------------------------------------ */
/* ⑦ 예시 한 줄                                                          */
/* ------------------------------------------------------------------ */

/** 킥커 대결 줄을 쓰는 계열(§4.2-⑦). wheel_ace 는 블로커 줄을 따로 씁니다. */
const KICKER_CLASSES = new Set<HandClass>(['big_ace', 'suited_ace', 'offsuit_ace', 'suited_broadway', 'offsuit_broadway', 'suited_king', 'suited_qj']);

/**
 * 예시 한 줄 — 세 모양만(§4.2-⑦). 해당하지 않으면 null.
 *  - 중간·작은 페어: `내 2♠2♦ → 플랍에서 셋이 될 확률 12%예요.`
 *  - 킥커 대결: `내 K♠10♠ vs 상대 A♦K♦ → K를 맞춰도 킥커에서 밀려요.` — 상대는 내 높은 카드에 더 큰 킥커(A)를 붙인 패,
 *    수티드니스는 내 패와 같게(수티드면 AKs, 오프수트면 AKo). 내 높은 카드가 A 면 AK.
 *  - 휠 A: `내 A♠5♠ → A를 쥐고 있어 상대 AA·AK 조합이 줄어요.`
 * 무늬는 늘 ♠ 쪽으로 만들고, explainStep 이 화면 카드에 맞춰 뒤집습니다.
 */
export function oneExample(step: Step): string | null {
  const info = parseHandName(step.hand);
  const cls = classifyHand(step.hand);
  const ctx = exampleCtx(info);
  if (cls === 'mid_pair' || cls === 'small_pair') return `내 ${ctx.me} → 플랍에서 셋이 될 확률 12%예요.`;
  if (cls === 'wheel_ace') return `내 ${ctx.me} → A를 쥐고 있어 상대 AA·AK 조합이 줄어요.`;
  if (KICKER_CLASSES.has(cls) && dominatorOf(info)) {
    const opp = info.high === 'A' ? 'AK' : `A${info.high}`;
    return duel(ctx, `${opp}${info.kind === 'suited' ? 's' : 'o'}`, `${josa(show(info.high), '을/를')} 맞춰도 킥커에서 밀려요.`);
  }
  return null;
}
