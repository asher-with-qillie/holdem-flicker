import { isReachable } from './atlas';
import { getChartCells, getChartDef } from './data';
import { classifyHand } from './explain';
import { gridHand, parseHandName } from './hands';
import { actWord, emWidth, josa, verb } from './ko';
import { AGGRESSION_ORDER, fullMix, restAction } from './range';
import { RANKS, type Action, type HandName, type Rank, type Scenario, type ScenarioKind } from './types';

/*
 * 줄 하나, 문장 하나 — docs/EXPLAIN_SPEC.md §3.
 *
 * 리빌 슬롯이 보여 주는 건 패가 아니라 "이 패가 속한 차트 줄"입니다. 문장은 (상황, 줄)의 속성이라
 * 같은 줄의 패는 전부 같은 문장을 받고 링만 움직입니다. 카드를 넘길 때마다 같은 덩어리를 한 번 더
 * 떠올리게 하는 것이 목적입니다.
 *
 * 문장은 "구조 먼저"입니다. 틀(frame)과 주장(claims)을 먼저 정하고 글자는 마지막에 렌더합니다.
 * 이름 규칙(LineClaim 위 주석)을 못 지키는 틀 문장은 쓰지 않고 '나머지 전부' 꼴이나 칸 나열 꼴로 갑니다.
 * tests/line.test.ts 가 1,089개 문장의 claims 를 차트에서 다시 계산해 이름 규칙까지 대조하고,
 * tests/line.golden.test.ts 가 글자를 한 자도 안 틀리게 고정합니다. 참고 구현 scripts/reference/line-gen.ts 와는
 * 이름 규칙 때문에 104개 문장이 다릅니다(docs/EXPLAIN_SPEC.md §9).
 */

export type MixItem = { action: Action; weight: number };

export type LineId = 'pair' | 'conn' | `s${Rank}` | `o${Rank}`;

export interface LineSlot {
  /** 13×13 그리드에서 이 칸 위치의 패. 커넥터 줄의 j=0 은 빈칸(null). */
  hand: HandName | null;
  /** 이 줄의 칸인가. false 면 유령 칸(다른 줄의 위치)이거나 빈칸입니다. */
  inLine: boolean;
  /** 스트립 라벨: 페어 'AA', 커넥터 'T9', 수티드·오프수트 줄은 킥커 랭크. 빈칸은 ''. */
  label: string;
}

export interface LineDef {
  id: LineId;
  /** '포켓페어' · '수티드 커넥터' · '수티드 K' · '오프수트 8' */
  label: string;
  /** 13칸 */
  slots: LineSlot[];
}

export type WeightWord = 'full' | '주로' | '절반만' | '반반' | '절반은';

export interface LineCell {
  hand: HandName;
  /** 13칸 중 위치 */
  slot: number;
  /** 1순위 액션(primaryAction 과 같은 동점 규칙: 공격적인 쪽) */
  p: Action;
  /** p 의 비중 */
  w: number;
  full: boolean;
  mixList: MixItem[];
  word: WeightWord;
}

export interface LineRun {
  action: Action;
  cells: LineCell[];
}

/*
 * 주장(claim). 문장 하나가 차트에 대해 말하는 것 전부입니다. tests/line.test.ts 가 차트에서 다시 계산해 대조합니다.
 *
 * 규칙 하나(§3.4 "이름 규칙"): 문장이 이름을 대지 않고 넘어가도 되는 칸은, 문장이 그 칸에 대해 말하는 액션이
 * 그 칸의 1순위이고 비중이 0.6 이상(full · 주로)인 칸뿐입니다. 비중이 0.5 이하인 칸(절반만 · 반반 · 절반은)은
 * 반드시 비중어와 함께 이름을 댑니다. '전부'는 덮는 칸이 전부 full 일 때만 씁니다(whole).
 * 문장이 아무 말도 하지 않는 칸은 "나머지(rest)"로 읽히므로 1순위가 rest 이고 비중이 0.6 이상이어야 합니다.
 */
export type LineClaim =
  | { t: 'all'; action: Action; whole: boolean } // 줄 전부 a. whole = '전부'(전부 full)
  | { t: 'upto'; from: HandName | null; to: HandName; action: Action } // (from부터) to까지 a. 다음 칸은 full-a 아님
  | { t: 'only'; hands: HandName[]; action: Action } // p = a 인 칸 = 정확히 hands
  | { t: 'toEnd'; from: HandName; action: Action; whole: boolean } // from부터 끝까지 a
  | { t: 'weight'; hand: HandName; action: Action; word: WeightWord } // 이름 + 비중어
  | { t: 'minor'; hands: HandName[]; actions: Action[] } // 모두 p = rest, 계속 비중 > 0 인 칸 = 정확히 hands, 그 액션들 = actions
  | { t: 'rest'; except: HandName[]; action: Action; whole: boolean }; // except 밖의 칸 전부 a

export type LineForm = 'frame' | 'except' | 'list';

export type LineFrame = 'P0' | 'P0h' | 'P1' | 'P2' | 'P2c' | 'P2m' | 'P2h' | 'P3' | 'P3h' | 'P4';

export interface LineSentence {
  text: string;
  frame: LineFrame;
  claims: LineClaim[];
  /**
   * 폭 폴백(§3.4): noLabel = 줄 이름을 뺌, noCtx = 줄 이름에 더해 주어를 'HJ:' 꼴 머리표로 줄임(상대 액션은 상황 줄이 말함).
   * 'HJ는 AKs…는 3벳'처럼 '는'이 두 번 이어지는 이중 주제가 원어민에게 걸려서 머리표로 바꿨습니다. 상대를 남기는 꼴
   * ('UTG 오픈에 AKs…')은 6건 중 5건이 42em 을 넘었습니다.
   * 옛 cut(둘째 절을 버림)은 섞인 칸의 이름을 버리게 되어 없앴습니다(§9).
   */
  fallback: null | 'noLabel' | 'noCtx';
  /** 'list' = 틀 문장이 이름 규칙을 못 지켜서 쓴 칸 나열 꼴(`〈줄〉 중 X는 A, Y는 B, Z까지는 C해요`). */
  form: LineForm;
}

export type StripRole = 'cell' | 'unreachable' | 'ghost' | 'empty';

export interface StripSlot {
  role: StripRole;
  hand: HandName | null;
  label: string;
  /** 도달 가능한 줄 칸이면 fullMix — 배경은 UI 가 RangeGrid.cellBackground 로 칠합니다. 나머지는 null. */
  mix: MixItem[] | null;
}

/** LineStrip 의 props. slots 13개, 이 패의 링, 경계 막대. */
export interface StripView {
  slots: StripSlot[];
  /** 이 패의 slot */
  ring: number;
  boundaryAfter: number | null;
}

/* ------------------------------------------------------------------ */
/* 줄 정의                                                               */
/* ------------------------------------------------------------------ */

const lineCache = new Map<HandName, LineDef>();

/**
 * 패 → 줄(§3.2). 페어는 대각선, classifyHand 가 suited_connector(T9s~32s)인 패는 커넥터 대각선,
 * 그 밖의 수티드는 높은 카드 행, 오프수트는 높은 카드 열을 가로로 눕힌 것. 같은 패는 모든 상황에서 같은 줄입니다.
 */
export function lineOf(hand: HandName): LineDef {
  const cached = lineCache.get(hand);
  if (cached) return cached;
  const info = parseHandName(hand);
  let def: LineDef;
  if (info.kind === 'pair') {
    def = { id: 'pair', label: '포켓페어', slots: RANKS.map((_, i) => ({ hand: gridHand(i, i), inLine: true, label: gridHand(i, i) })) };
  } else if (classifyHand(hand) === 'suited_connector') {
    // j=0 은 빈칸, j≥1 은 대각선 바로 위 칸. AKs·KQs·QJs·JTs 는 유령 칸 — "AKs도 커넥터"로 읽히지 않게.
    const slots: LineSlot[] = [{ hand: null, inLine: false, label: '' }];
    for (let i = 0; i < 12; i++) {
      const h = gridHand(i, i + 1);
      slots.push({ hand: h, inLine: i >= 4, label: h.slice(0, 2) });
    }
    def = { id: 'conn', label: '수티드 커넥터', slots };
  } else {
    const hi = RANKS.indexOf(info.high);
    const suited = info.kind === 'suited';
    def = {
      id: `${suited ? 's' : 'o'}${info.high}`,
      label: `${suited ? '수티드' : '오프수트'} ${info.high}`,
      slots: RANKS.map((r, j) => ({ hand: suited ? gridHand(hi, j) : gridHand(j, hi), inLine: j > hi, label: r })),
    };
  }
  lineCache.set(hand, def);
  return def;
}

/* ------------------------------------------------------------------ */
/* 칸 · run · 비중어                                                     */
/* ------------------------------------------------------------------ */

const agg = (a: Action) => AGGRESSION_ORDER.indexOf(a);
const restOf = (s: Scenario): Action => restAction(getChartDef(s));

/**
 * 비중어(§2.2). full(≥0.999) · 주로(1순위 ≥ 0.6) · 반반(1·2순위 동점이고 2순위가 rest 아님) ·
 * 절반만(그 밖이고 1순위가 계속하는 액션) · 절반은(그 밖이고 1순위가 rest).
 */
export function weightWord(mixList: MixItem[], rest: Action): WeightWord {
  const w = mixList[0]?.weight ?? 1;
  if (w >= 0.999) return 'full';
  if (w >= 0.6) return '주로';
  const s2 = mixList[1];
  if (s2 && Math.abs(s2.weight - w) < 0.01 && s2.action !== rest) return '반반';
  return (mixList[0]?.action ?? 'fold') === rest ? '절반은' : '절반만';
}

/** 캡슐 라벨(§3.5). 색은 1순위 액션, 글자는 비중어 + 버튼 단어. */
export function capsuleLabel(mixList: MixItem[], rest: Action, kind: ScenarioKind): string {
  const a = mixList[0]?.action ?? 'fold';
  const act = actWord(a, kind);
  switch (weightWord(mixList, rest)) {
    case 'full':
      return act;
    case '주로':
      return `주로 ${act}`;
    case '절반만':
      return `절반만 ${act}`;
    case '반반':
      return `${act}·${actWord(mixList[1].action, kind)} 반반`;
    case '절반은':
      return `절반은 ${act}`;
  }
}

/** 줄 칸 중 도달 가능한 칸만, 스트립 순서(위 킥커 → 아래)로. */
export function lineCells(s: Scenario, line: LineDef): LineCell[] {
  const cells = getChartCells(s);
  const rest = restOf(s);
  const out: LineCell[] = [];
  line.slots.forEach((slot, i) => {
    if (!slot.inLine || !slot.hand || !isReachable(s, slot.hand).ok) return;
    const mixList = fullMix(cells[slot.hand]);
    const p = mixList[0]?.action ?? 'fold';
    const w = mixList[0]?.weight ?? 1;
    out.push({ hand: slot.hand, slot: i, p, w, full: w >= 0.999, mixList, word: weightWord(mixList, rest) });
  });
  return out;
}

/** 1순위가 같은 칸이 이어진 구간. */
export function lineRuns(cells: LineCell[]): LineRun[] {
  const out: LineRun[] = [];
  for (const c of cells) {
    const last = out[out.length - 1];
    if (last && last.action === c.p) last.cells.push(c);
    else out.push({ action: c.p, cells: [c] });
  }
  return out;
}

/**
 * 1순위 공격성이 위에서 아래로 줄어들기만 하는가. 계속 비중만 보는 옛 rowBoundary.monotone 은
 * 1순위가 번갈아 나오는 9개 줄(수티드 A 의 3벳/콜 교대 등)을 단조로 잘못 봤습니다.
 */
export function isMonotone(cells: LineCell[]): boolean {
  return cells.every((c, i) => i === 0 || agg(c.p) <= agg(cells[i - 1].p));
}

/* ------------------------------------------------------------------ */
/* 문장                                                                  */
/* ------------------------------------------------------------------ */

/** 이름 없이 덮어도 되는 비중의 하한(§2.2 '주로'). 0.5 이하인 칸은 언제나 비중어와 함께 이름을 댑니다. */
const STRONG = 0.6 - 1e-9;
const isStrong = (c: LineCell) => c.w >= STRONG;

/** 주어 S(§3.4). 대응 상황에는 내 자리를 반드시 넣습니다 — 같은 상대·같은 줄이라도 SB 와 BB 의 답이 다릅니다. */
function subject(s: Scenario): string {
  const H = josa(s.hero, '은/는');
  const v = s.villain;
  switch (s.kind) {
    case 'rfi':
      return H;
    case 'vs_open':
      return `${H} ${v} 오픈에`;
    case 'vs_3bet':
      return `${H} ${v} 3벳에`;
    case 'vs_4bet':
      return `${H} ${v} 4벳에`;
    case 'vs_5bet':
      return `${H} ${v} 올인에`;
    case 'cold_4bet':
      return `${H} 앞에서 3벳이 나오면`;
    case 'vs_limp':
      return `${H} 림프에`;
  }
}

/** 패 목록: 줄 순서로 연속 3칸 이상이면 X~Y, 2칸은 X·Y, 묶음 사이는 ·. */
function handList(hands: HandName[], order: HandName[]): string {
  const idx = hands.map((h) => order.indexOf(h));
  const groups: HandName[][] = [];
  let cur: HandName[] = [];
  idx.forEach((i, k) => {
    if (k > 0 && i === idx[k - 1] + 1) cur.push(hands[k]);
    else {
      if (cur.length) groups.push(cur);
      cur = [hands[k]];
    }
  });
  if (cur.length) groups.push(cur);
  return groups.map((g) => (g.length >= 3 ? `${g[0]}~${g[g.length - 1]}` : g.join('·'))).join('·');
}

/**
 * 칸 묶음을 부르는 주제어: 'KJo는' · 'ATo·A9o는' · 'A3s부터 A2s까지는'(줄에서 이어진 3칸 이상) ·
 * 'A7s·A6s·A3s·A2s는' · 'T9s·76s~54s는'(떨어진 칸 — '부터 … 까지'로 부르면 사이의 다른 칸까지 덮습니다).
 */
function who(T: LineCell[], cs: LineCell[]): string {
  if (T.length === 1) return josa(T[0].hand, '은/는');
  const i0 = cs.indexOf(T[0]);
  if (T.length >= 3 && T.every((c, k) => cs[i0 + k] === c)) return `${T[0].hand}부터 ${T[T.length - 1].hand}까지는`;
  return josa(handList(T.map((c) => c.hand), cs.map((c) => c.hand)), '은/는');
}

type End = '해요' | '하고';

/** 같은 캡슐 라벨(1순위 · 비중어 · 반반의 2순위)인가 — 섞인 칸을 한 묶음으로 부를 수 있는가. */
const sameLabel = (a: LineCell, b: LineCell) => a.p === b.p && a.word === b.word && (a.word !== '반반' || a.mixList[1].action === b.mixList[1].action);

/** 연속된 같은 라벨끼리 묶습니다. */
function labelGroups(T: LineCell[]): LineCell[][] {
  const out: LineCell[][] = [];
  for (const c of T) {
    const g = out[out.length - 1];
    if (g && sameLabel(g[g.length - 1], c)) g.push(c);
    else out.push([c]);
  }
  return out;
}

/**
 * 섞인 칸 묶음의 서술(§3.4 〈T〉). 같은 캡슐 라벨끼리 묶습니다.
 *  - 한 묶음: `KJo는 절반만 오픈해요` · `QQ는 4벳과 콜을 반반 섞어요`
 *  - 같은 액션의 여러 비중어(반반 없음): `QQ는 주로, JJ는 절반만 콜해요` — 동사는 끝에 한 번만
 *  - 그 밖(mixed 일 때만): 앞 묶음은 캡슐 라벨 그대로, 끝 묶음만 동사 — `65s·54s는 3벳·콜 반반, 32s는 절반만 콜해요`
 */
function describeGroups(T: LineCell[], a: Action, end: End, cs: LineCell[], kind: ScenarioKind, rest: Action, mixed: boolean): string | null {
  const groups = labelGroups(T);
  const tieEnd = end === '해요' ? '섞어요' : '섞고';
  const verbal = (g: LineCell[]) => {
    const c = g[0];
    if (c.word === '반반') return `${who(g, cs)} ${josa(actWord(c.mixList[0].action, kind), '과/와')} ${josa(actWord(c.mixList[1].action, kind), '을/를')} 반반 ${tieEnd}`;
    return `${who(g, cs)} ${c.word} ${verb(c.p, kind, end)}`;
  };
  if (groups.length === 1) return verbal(T);
  if (!T.some((c) => c.word === '반반') && T.every((c) => c.p === a)) return `${groups.map((g) => `${who(g, cs)} ${g[0].word}`).join(', ')} ${verb(a, kind, end)}`;
  if (!mixed) return null;
  return `${groups
    .slice(0, -1)
    .map((g) => `${who(g, cs)} ${capsuleLabel(g[0].mixList, rest, kind)}`)
    .join(', ')}, ${verbal(groups[groups.length - 1])}`;
}

/** 폭 폴백 (1): 줄 이름(〈O〉/〈Q〉)을 뺍니다 — 손패 이름이 줄을 정해 줍니다. */
function dropLabel(text: string, line: LineDef): string {
  return text.replace(`${line.label} 중 `, '').replace(`${josa(line.label, '을/를')} `, '').replace(`${josa(line.label, '은/는')} `, '');
}

interface Built {
  text: string;
  claims: LineClaim[];
}

/**
 * 이름 규칙(§3.4)을 이 문장의 claims 로 확인합니다 — 생성기가 틀 문장을 쓸지 칸 나열 꼴로 갈지 고르는 데만 씁니다.
 * (테스트는 이 함수를 쓰지 않고 차트에서 따로 다시 계산합니다.)
 */
function obeysNamingRule(cs: LineCell[], rest: Action, text: string, claims: LineClaim[]): boolean {
  const at = (h: HandName) => cs.findIndex((x) => x.hand === h);
  const named = new Set<HandName>();
  const cover = new Map<HandName, Array<{ a: Action; whole: boolean }>>();
  const add = (i: number, a: Action, whole: boolean) => cover.set(cs[i].hand, [...(cover.get(cs[i].hand) ?? []), { a, whole }]);
  for (const c of claims) {
    if (c.t === 'all') cs.forEach((_, i) => add(i, c.action, c.whole));
    else if (c.t === 'rest') cs.forEach((x, i) => !c.except.includes(x.hand) && add(i, c.action, c.whole));
    else if (c.t === 'upto') {
      const i0 = c.from ? at(c.from) : 0;
      for (let i = i0; i <= at(c.to); i++) add(i, c.action, false);
    } else if (c.t === 'toEnd') for (let i = at(c.from); i < cs.length; i++) add(i, c.action, c.whole);
    else if (c.t === 'weight' || c.t === 'minor') (c.t === 'weight' ? [c.hand] : c.hands).forEach((h) => named.add(h));
    else if (c.t === 'only') for (const h of c.hands) if (isStrong(cs[at(h)])) named.add(h);
  }
  const whole = claims.some((c) => 'whole' in c && c.whole);
  if (text.includes('전부') !== whole) return false;
  return cs.every((x) => {
    if (named.has(x.hand)) return true;
    const cv = cover.get(x.hand);
    if (!cv) return x.p === rest && isStrong(x);
    return cv.every((k) => k.a === x.p && isStrong(x) && (!k.whole || x.full));
  });
}

function build(s: Scenario, line: LineDef, topic: boolean): { frame: LineFrame; cands: Array<Built & { form: LineForm }> } | null {
  const kind = s.kind;
  const rest = restOf(s);
  const cs = lineCells(s, line);
  if (!cs.length) return null;
  // 형제 줄(§4.2-②)은 주어를 빼고 목적어를 주제어로: '수티드 8은', '오프수트 A는'.
  const S = topic ? '' : subject(s);
  const O = topic ? josa(line.label, '은/는') : josa(line.label, '을/를');
  const Q = `${line.label} 중`;
  const V = (a: Action, end: End) => verb(a, kind, end);
  const runs = lineRuns(cs);
  const cont = runs.filter((r) => r.action !== rest);
  const mono = isMonotone(cs);
  // 틀(frame)은 줄의 모양입니다(§3.4 표). 틀 문장이 이름 규칙을 못 지켜 칸 나열 꼴로 써도 틀은 그대로입니다.
  let frame: LineFrame = 'P0';
  // 후보를 차례로 만들고, 이름 규칙을 지키면서 42em 안에 드는(줄 이름을 빼서라도) 첫 후보를 씁니다.
  // 틀 문장 → '나머지 전부' 꼴 → 칸 나열 꼴(줄 순서 · 액션별). 다 넘치면 제일 짧은 것.
  const cands: Array<Built & { form: LineForm }> = [];
  const push = (b: Built | null, form: LineForm) => {
    if (b && obeysNamingRule(cs, rest, b.text, b.claims)) cands.push({ ...b, form });
  };
  push(legacy(), 'frame');
  push(allBut(), 'except');
  push(listForm(cs, rest, kind, S, O, Q, 'strip'), 'list');
  if (!mono) push(listForm(cs, rest, kind, S, O, Q, 'action'), 'list');
  return cands.length ? { frame, cands } : null;

  /**
   * '나머지 전부' 꼴: 센 칸(비중 ≥ 0.6)이 전부 같은 계속 액션이면 그 액션을 줄 전체에 말하고 섞인 칸만 이름을 댑니다.
   * `BTN은 림프에 수티드 A를 레이즈하고, A7s·A6s·A3s·A2s는 절반만 레이즈해요.`
   */
  function allBut(): Built | null {
    const strong = cs.filter(isStrong);
    const weak = cs.filter((c) => !isStrong(c));
    if (!strong.length || !weak.length) return null;
    // 섞인 칸이 전부 센 칸 뒤에만 있으면 '…까지 a하고, 〈꼬리〉' 꼴(틀 문장 · 칸 나열)이 더 잘 읽힙니다 — 사이에 낀 섞인 칸이 있을 때만.
    if (cs.indexOf(weak[0]) > cs.indexOf(strong[strong.length - 1])) return null;
    const a = strong[0].p;
    if (a === rest || strong.some((c) => c.p !== a)) return null;
    const d = describeGroups(weak, a, '해요', cs, kind, rest, true);
    if (d === null) return null;
    return {
      text: `${S} ${O} ${V(a, '하고')}, ${d}.`,
      claims: [{ t: 'rest', except: weak.map((c) => c.hand), action: a, whole: false }, ...weak.map((c): LineClaim => ({ t: 'weight', hand: c.hand, action: c.p, word: c.word }))],
    };
  }

  /* -------- 틀 문장(§3.4 표) -------- */
  function legacy(): Built | null {
    const restCells = cs.filter((c) => c.p === rest);
    const names = cs.map((c) => c.hand);
    const weightClaims = (T: LineCell[]): LineClaim[] => T.map((c) => ({ t: 'weight', hand: c.hand, action: c.p, word: c.word }));

    /** 섞인 칸들의 서술 〈T〉/〈T'〉(§3.4). 반반과 다른 비중어가 한 묶음에 섞이면 두 절로 못 씁니다(null → 다른 꼴). */
    const mixedDesc = (a: Action, T: LineCell[], end: End): string | null => describeGroups(T, a, end, cs, kind, rest, false);

    // P0 · P0h: 계속 run 없음
    if (!cont.length) {
      const minor = cs.filter((c) => c.mixList.some((m) => m.action !== rest && m.weight > 0.001));
      // 칸 하나가 3벳과 콜을 같이 섞으면 둘 다 말합니다('가끔 3벳이나 콜하고').
      const acts = [...new Set(minor.flatMap((c) => c.mixList.filter((m) => m.action !== rest && m.weight > 0.001).map((m) => m.action)))].sort((x, y) => agg(y) - agg(x));
      if (minor.length && minor.length <= 3 && acts.length <= 2) {
        frame = 'P0h';
        const hs = minor.map((c) => c.hand);
        const v = acts.length === 1 ? V(acts[0], '하고') : `${josa(actWord(acts[0], kind), '이나/나')} ${V(acts[1], '하고')}`;
        return { text: `${S} ${O} ${handList(hs, names)}만 가끔 ${v}, 나머지는 ${V(rest, '해요')}.`, claims: [{ t: 'minor', hands: hs, actions: acts }] };
      }
      frame = 'P0';
      return { text: `${S} ${O} 전부 ${V(rest, '해요')}.`, claims: [{ t: 'all', action: rest, whole: true }] };
    }

    const parts = (r: LineRun) => {
      const li = r.cells.map((c) => c.full).lastIndexOf(true);
      return { lf: li >= 0 ? r.cells[li] : null, ff: r.cells.find((c) => c.full) ?? null, tail: li >= 0 ? r.cells.slice(li + 1) : r.cells };
    };
    // BB 림프 대응(rest = check): 계속 구간 뒤의 체크 칸을 이름으로 부릅니다.
    const checkTail = rest === 'check' && restCells.length ? `${restCells[0].hand}부터는 체크해요` : '';
    const checkClaims: LineClaim[] = checkTail ? [{ t: 'toEnd', from: restCells[0].hand, action: 'check', whole: false }] : [];
    const fromOf = (r: LineRun): HandName | null => (r.cells[0] === cs[0] ? null : r.cells[0].hand);

    if (mono && cont.length === 1) {
      const r = cont[0];
      const { lf, tail } = parts(r);
      if (lf) {
        if (!restCells.length && !tail.length) {
          frame = 'P1';
          // P1. '전부'는 줄 칸이 전부 full 일 때만. 섞인 칸(≤ 0.5)이 있으면 그 칸만 이름을 댑니다.
          if (r.cells.every((c) => c.full)) return { text: `${S} ${O} 전부 ${V(r.action, '해요')}.`, claims: [{ t: 'all', action: r.action, whole: true }] };
          const weak = r.cells.filter((c) => !isStrong(c));
          if (!weak.length) return { text: `${S} ${O} ${V(r.action, '해요')}.`, claims: [{ t: 'all', action: r.action, whole: false }] };
          const d = mixedDesc(r.action, weak, '해요');
          return d === null ? null : { text: `${S} ${O} ${V(r.action, '하고')}, ${d}.`, claims: [{ t: 'rest', except: weak.map((c) => c.hand), action: r.action, whole: false }, ...weightClaims(weak)] };
        }
        let head = lf;
        let T = tail;
        // 꼬리가 길고 비중어가 섞이면('76s부터 43s까지는 콜을 섞어요' — 주로 콜인 칸을 '섞는다'고 줄여 말함) 앞쪽 '주로' 칸을 '까지'에 넣습니다.
        if (T.length > 3 && labelGroups(T).length > 1) {
          while (T.length && isStrong(T[0])) {
            head = T[0];
            T = T.slice(1);
          }
        }
        // '까지'는 이름 없이 덮어도 되는 칸(full · 주로)에만 붙입니다. 첫 칸이면 '만'.
        const h = head.hand === cs[0].hand ? `${head.hand}만` : `${head.hand}까지`;
        const upto: LineClaim = { t: 'upto', from: null, to: head.hand, action: r.action };
        frame = tail.length ? 'P2m' : checkTail ? 'P2c' : 'P2';
        if (T.length) {
          const d = mixedDesc(r.action, T, '해요');
          return d === null ? null : { text: `${S} ${O} ${h} ${V(r.action, '하고')}, ${d}.`, claims: [upto, ...weightClaims(T)] };
        }
        if (checkTail) return { text: `${S} ${O} ${h} ${V(r.action, '하고')}, ${checkTail}.`, claims: [upto, ...checkClaims] };
        return { text: `${S} ${O} ${h} ${V(r.action, '해요')}.`, claims: [upto] };
      }
      frame = 'P2h';
      const d = mixedDesc(r.action, tail, '하고');
      if (d === null) return null;
      const claims: LineClaim[] = weightClaims(tail);
      if (restCells.length) claims.push({ t: 'rest', except: r.cells.map((c) => c.hand), action: rest, whole: false });
      return {
        text: restCells.length ? `${S} ${Q} ${d}, 나머지는 ${V(rest, '해요')}.` : `${S} ${Q} ${d.replace(/하고$/, '해요').replace(/섞고$/, '섞어요')}.`,
        claims,
      };
    }

    if (mono) {
      const [r1, r2] = cont;
      const p1 = parts(r1);
      const p2 = parts(r2);
      frame = p1.lf && p2.lf ? 'P3' : 'P3h';
      if (p1.lf && p2.lf) {
        const single1 = r1.cells.length === 1 && r1.cells[0].full;
        const h1 = single1 ? `${p1.lf.hand}만` : `${p1.lf.hand}까지`;
        const toEnd = !restCells.length && !p2.tail.length && r2.cells.every((c) => c.full) && cs[cs.length - 1] === r2.cells[r2.cells.length - 1];
        const h2 = toEnd ? `${p2.ff!.hand}부터는 전부` : `${p2.lf.hand}까지`;
        const claims: LineClaim[] = [
          { t: 'upto', from: fromOf(r1), to: p1.lf.hand, action: r1.action },
          toEnd ? { t: 'toEnd', from: p2.ff!.hand, action: r2.action, whole: true } : { t: 'upto', from: fromOf(r2), to: p2.lf.hand, action: r2.action },
          ...checkClaims,
        ];
        return {
          text: checkTail
            ? `${S} ${O} ${h1} ${V(r1.action, '하고')}, ${h2} ${V(r2.action, '하고')}, ${checkTail}.`
            : `${S} ${O} ${h1} ${V(r1.action, '하고')}, ${h2} ${V(r2.action, '해요')}.`,
          claims,
        };
      }
      const desc = (r: LineRun, pr: ReturnType<typeof parts>, end: End): Built | null => {
        if (pr.lf) {
          return {
            text: r.cells.length === 1 ? `${josa(pr.lf.hand, '은/는')} ${V(r.action, end)}` : `${pr.lf.hand}까지는 ${V(r.action, end)}`,
            claims: [{ t: 'upto', from: fromOf(r), to: pr.lf.hand, action: r.action }],
          };
        }
        const t = mixedDesc(r.action, r.cells, end);
        return t === null ? null : { text: t, claims: weightClaims(r.cells) };
      };
      const d1 = desc(r1, p1, '하고');
      const d2 = desc(r2, p2, '해요');
      return d1 && d2 && { text: `${S} ${Q} ${d1.text}, ${d2.text}.`, claims: [...d1.claims, ...d2.claims] };
    }

    frame = 'P4';
    // P4: 단조롭지 않은 줄(수티드 A 휠 섬, BB 커넥터). 제일 공격적인 1순위 칸을 이름으로 부릅니다.
    const top = cs.reduce((m, c) => (agg(c.p) > agg(m) ? c.p : m), cs[0].p);
    const topHands = cs.filter((c) => c.p === top).map((c) => c.hand);
    const head = `${S} ${O} ${handList(topHands, names)}만 ${actWord(top, kind)}`;
    const onlyTop: LineClaim = { t: 'only', hands: topHands, action: top };
    const others = [...new Set(cs.filter((c) => c.p !== top && c.p !== rest).map((c) => c.p))];
    if (others.length !== 1) return { text: `${head}해요.`, claims: [onlyTop] };
    const c = others[0];
    if (!restCells.length) {
      // '나머지는 전부'는 나머지 칸이 전부 full 일 때만.
      const whole = cs.every((x) => x.p === top || x.full);
      return { text: `${head}하고, 나머지는 ${whole ? '전부 ' : ''}${V(c, '해요')}.`, claims: [onlyTop, { t: 'rest', except: topHands, action: c, whole }] };
    }
    // '까지'는 이름 없이 덮어도 되는 칸(full · 주로)에 붙입니다 — 뒤따르는 '주로' 칸을 '까지'에 넣어야 그 칸이 '나머지(폴드)'로 읽히지 않습니다.
    let li = -1;
    let first = -1;
    for (let i = 0; i < cs.length; i++) {
      if (cs[i].p !== top && cs[i].p !== c) break;
      if (cs[i].p === c && first < 0) first = i;
      if (cs[i].p === c && isStrong(cs[i]) && (li < 0 || li === i - 1 || cs.slice(li + 1, i).every((x) => x.p === top))) li = i;
    }
    if (li >= 0) return { text: `${head}하고, ${cs[li].hand}까지 ${V(c, '해요')}.`, claims: [onlyTop, { t: 'upto', from: first === 0 ? null : cs[first].hand, to: cs[li].hand, action: c }] };
    const cHands = cs.filter((x) => x.p === c).map((x) => x.hand);
    return { text: `${head}하고, ${handList(cHands, names)}는 ${V(c, '해요')}.`, claims: [onlyTop, { t: 'only', hands: cHands, action: c }] };
  }
}

/** 칸 나열 꼴의 한 항목: 센 칸(같은 1순위, 비중 ≥ 0.6) 묶음, 또는 같은 캡슐 라벨의 섞인 칸 묶음. */
interface Item {
  cells: LineCell[];
  strong: boolean;
}

/**
 * 칸 나열 꼴(§3.4 이름 규칙의 마지막 수단).
 *  - order 'strip'(단조 줄): 줄을 위에서부터 훑어 같은 1순위의 센 칸(full · 주로)이 이어지면 한 항목('A9o까지는 콜',
 *    'AKo는 3벳', 'KQo는 주로 3벳', '88부터는 전부 콜'), 같은 캡슐 라벨의 섞인 칸이 이어지면 한 항목('AQo·AJo는 4벳·콜 반반').
 *  - order 'action'(단조롭지 않은 줄): 공격적인 액션부터, 그 액션의 센 칸 전부를 한 항목('AKs·A5s·A4s는 4벳')으로 부르고
 *    섞인 칸은 라벨별로 따로 부릅니다.
 *  - 1순위가 rest(폴드)인 센 칸은 말하지 않습니다(나머지). 체크(BB 림프)는 '55부터는 체크'로 말합니다.
 * 항목이 하나면 한 절, 둘이면 두 절('…하고, …해요'), 셋 이상이면 명사 나열에 끝 항목만 동사.
 * 첫 항목이 줄 첫 칸부터 센 칸이고 항목이 둘 이하면 틀 문장처럼 목적어 꼴('포켓페어를 JJ까지 3벳하고, …')로 씁니다.
 */
function listForm(cs: LineCell[], rest: Action, kind: ScenarioKind, S: string, O: string, Q: string, order: 'strip' | 'action'): Built | null {
  const items: Item[] = [];
  const silent = (c: LineCell) => isStrong(c) && c.p === rest && rest !== 'check';
  if (order === 'strip') {
    for (let i = 0; i < cs.length; ) {
      const c = cs[i];
      const strong = isStrong(c);
      if (silent(c)) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < cs.length && (strong ? cs[j].p === c.p && isStrong(cs[j]) : !isStrong(cs[j]) && sameLabel(c, cs[j]))) j++;
      items.push({ cells: cs.slice(i, j), strong });
      i = j;
    }
  } else {
    const acts = [...new Set(cs.map((c) => c.p))].sort((x, y) => agg(y) - agg(x));
    for (const a of acts) {
      const strong = cs.filter((c) => c.p === a && isStrong(c) && !silent(c));
      if (strong.length) items.push({ cells: strong, strong: true });
      const weak = cs.filter((c) => c.p === a && !isStrong(c));
      for (const g of weak) {
        const prev = items[items.length - 1];
        if (prev && !prev.strong && sameLabel(prev.cells[0], g)) prev.cells.push(g);
        else items.push({ cells: [g], strong: false });
      }
    }
  }
  if (!items.length) return null;
  const names = cs.map((c) => c.hand);
  const at = (c: LineCell) => cs.indexOf(c);
  const V = (a: Action, end: End) => verb(a, kind, end);
  const claims: LineClaim[] = [];
  /** 이름 묶음: 줄에서 이어진 3칸 이상은 X~Y, 떨어진 칸은 X·Y. */
  const listWho = (G: LineCell[]) => josa(handList(G.map((c) => c.hand), names), '은/는');
  /** 항목 하나의 주제어 · 명사 · 동사 꼴. objForm = 목적어 꼴의 둘째 절('88까지 콜해요' — '는' 없이). */
  const render = (k: number, objForm: boolean): { who: string; noun: string; verbal: (end: End) => string } => {
    const it = items[k];
    const G = it.cells;
    const c0 = G[0];
    const last = G[G.length - 1];
    const a = c0.p;
    if (!it.strong) {
      for (const c of G) claims.push({ t: 'weight', hand: c.hand, action: c.p, word: c.word });
      const tie = c0.word === '반반';
      return {
        who: listWho(G),
        noun: capsuleLabel(c0.mixList, rest, kind),
        verbal: (end) =>
          tie
            ? `${josa(actWord(c0.mixList[0].action, kind), '과/와')} ${josa(actWord(c0.mixList[1].action, kind), '을/를')} 반반 ${end === '해요' ? '섞어요' : '섞고'}`
            : `${c0.word} ${V(a, end)}`,
      };
    }
    const wordOf = (x: LineCell) => (x.full ? '' : `${x.word} `);
    if (G.length === 1) {
      claims.push({ t: 'weight', hand: c0.hand, action: a, word: c0.word });
      return { who: josa(c0.hand, '은/는'), noun: `${wordOf(c0)}${actWord(a, kind)}`, verbal: (end) => `${wordOf(c0)}${V(a, end)}` };
    }
    if (order === 'action') {
      // 이 액션의 칸 전부(섞인 칸은 따로 비중어로) — 'AKs·A5s·A4s는 4벳'. 마지막 항목이 남은 칸 전부면 '나머지는'.
      const named = new Set(items.slice(0, k).flatMap((x) => x.cells));
      if (k === items.length - 1 && k > 0 && cs.every((c) => named.has(c) || G.includes(c))) {
        claims.push({ t: 'rest', except: [...named].map((c) => c.hand), action: a, whole: false });
        return { who: '나머지는', noun: actWord(a, kind), verbal: (end) => V(a, end) };
      }
      claims.push({ t: 'only', hands: cs.filter((c) => c.p === a).map((c) => c.hand), action: a });
      return { who: listWho(G), noun: actWord(a, kind), verbal: (end) => V(a, end) };
    }
    const adjacent = k === 0 ? at(c0) === 0 : at(c0) === at(items[k - 1].cells[items[k - 1].cells.length - 1]) + 1;
    if (k > 0 && adjacent && last === cs[cs.length - 1]) {
      const whole = G.every((x) => x.full);
      claims.push({ t: 'toEnd', from: c0.hand, action: a, whole });
      return { who: `${c0.hand}부터는${whole ? ' 전부' : ''}`, noun: actWord(a, kind), verbal: (end) => V(a, end) };
    }
    claims.push({ t: 'upto', from: at(c0) === 0 ? null : c0.hand, to: last.hand, action: a });
    // 앞 항목에 바로 이어지면 '…까지는'(앞 항목 다음 칸부터), 떨어져 있으면 양 끝을 다 부릅니다.
    return { who: adjacent ? `${last.hand}까지${objForm ? '' : '는'}` : listWho(G), noun: actWord(a, kind), verbal: (end) => V(a, end) };
  };
  const n = items.length;
  const first = items[0];
  let text: string;
  if (order === 'strip' && n <= 2 && first.strong && at(first.cells[0]) === 0 && first.cells.length < cs.length) {
    // 목적어 꼴: 'BB는 UTG 오픈에 수티드 커넥터를 54s까지 콜하고, 43s는 절반만 콜해요.'
    const G = first.cells;
    const a = G[0].p;
    claims.push({ t: 'upto', from: null, to: G[G.length - 1].hand, action: a });
    const head = `${G[G.length - 1].hand}${G.length === 1 ? '만' : '까지'}`;
    if (n === 1) text = `${S} ${O} ${head} ${V(a, '해요')}.`;
    else {
      const r = render(1, true);
      text = `${S} ${O} ${head} ${V(a, '하고')}, ${r.who} ${r.verbal('해요')}.`;
    }
  } else {
    const rs = items.map((_, k) => render(k, false));
    if (n === 1) text = `${S} ${Q} ${rs[0].who} ${rs[0].verbal('해요')}.`;
    else if (n === 2) text = `${S} ${Q} ${rs[0].who} ${rs[0].verbal('하고')}, ${rs[1].who} ${rs[1].verbal('해요')}.`;
    else text = `${S} ${Q} ${rs.slice(0, -1).map((r) => `${r.who} ${r.noun}`).join(', ')}, ${rs[n - 1].who} ${rs[n - 1].verbal('해요')}.`;
  }
  return { text, claims };
}

/** 리빌 줄 문장 한도(§2.5). */
export const LINE_MAX_EM = 42;

/**
 * (상황, 줄)의 문장(§3.4). 줄에 도달 칸이 없으면 null.
 * build() 의 후보(이름 규칙을 지키는 것만, 틀 문장 → 나머지 전부 꼴 → 칸 나열 꼴 순서)마다 원문, (1) 줄 이름(〈O〉/〈Q〉)을
 * 뺀 꼴 순서로 42em 안에 드는 첫 문장을 씁니다. 다 넘치면 (2) 주어를 'HJ:' 머리표로 줄입니다 —
 * 리빌 바로 위 상황 줄이 상대를 말하고, 내 자리는 머리표로 남습니다. 결정적입니다.
 */
export function lineSentence(s: Scenario, line: LineDef, opts?: { topic?: boolean }): LineSentence | null {
  const topic = !!opts?.topic;
  const b = build(s, line, topic);
  if (!b) return null;
  const fits = (t: string) => emWidth(t) <= LINE_MAX_EM;
  const out = (c: Built & { form: LineForm }, text: string, fallback: LineSentence['fallback']): LineSentence => ({ text, frame: b.frame, claims: c.claims, form: c.form, fallback });
  for (const c of b.cands) {
    const text = c.text.replace(/^ /, '');
    if (fits(text)) return out(c, text, null);
    const noLabel = dropLabel(text, line);
    if (fits(noLabel)) return out(c, noLabel, 'noLabel');
  }
  const noCtx = (c: Built) => {
    const t = dropLabel(c.text.replace(/^ /, ''), line);
    return topic ? t : t.replace(`${subject(s)} `, `${s.hero}: `);
  };
  const pick = b.cands.find((c) => fits(noCtx(c))) ?? [...b.cands].sort((x, y) => emWidth(noCtx(x)) - emWidth(noCtx(y)))[0];
  return out(pick, noCtx(pick), 'noCtx');
}

/* ------------------------------------------------------------------ */
/* 스트립                                                                */
/* ------------------------------------------------------------------ */

/**
 * 경계 막대가 붙는 slot(§3.2). 단조 줄이고, 계속하는 칸(p ≠ rest)이 하나 이상 있고,
 * 마지막 계속 칸이 도달 가능한 마지막 줄 칸이 아닐 때만. 단조롭지 않은 줄(P4)에는 막대가 없습니다.
 */
export function boundaryAfter(s: Scenario, line: LineDef): number | null {
  const cs = lineCells(s, line);
  if (!cs.length || !isMonotone(cs)) return null;
  const rest = restOf(s);
  let last = -1;
  cs.forEach((c, i) => {
    if (c.p !== rest) last = i;
  });
  if (last < 0 || last === cs.length - 1) return null;
  return cs[last].slot;
}

/**
 * 경계까지의 거리 꼬리표(§3.1). 단조 줄에서만: 스트립에서 경계 막대 바로 다음 칸(slot)이면 '한 칸 밖',
 * 경계 칸(마지막 계속 칸) 자신이면 '마지막 칸'. 오답·부분 정답일 때만 보일지는 UI 가 정합니다.
 * 거리는 스트립 칸(slot)으로 잽니다 — 막대와 링 사이에 도달 불가(점선) 칸이 끼어 있으면 '한 칸 밖'이 아닙니다
 * (vs_5bet UTG:CO A5s: 막대는 AKs 뒤, 링은 7칸 건너 A5s).
 */
export function nearMiss(s: Scenario, hand: HandName): '한 칸 밖' | '마지막 칸' | null {
  const line = lineOf(hand);
  const b = boundaryAfter(s, line);
  if (b === null) return null;
  const cs = lineCells(s, line);
  const i = cs.findIndex((c) => c.hand === hand);
  if (i < 0) return null;
  if (cs[i].slot === b) return '마지막 칸';
  if (cs[i].slot === b + 1) return '한 칸 밖';
  return null;
}

/** LineStrip 한 줄의 그리기 재료. 배경색은 UI 가 mix 로 칠합니다(엔진은 React·CSS 를 모릅니다). */
export function stripView(s: Scenario, hand: HandName): StripView {
  const line = lineOf(hand);
  const reach = new Map(lineCells(s, line).map((c) => [c.slot, c] as const));
  const slots: StripSlot[] = line.slots.map((slot, i) => {
    if (!slot.hand) return { role: 'empty', hand: null, label: '', mix: null };
    if (!slot.inLine) return { role: 'ghost', hand: slot.hand, label: slot.label, mix: null };
    const c = reach.get(i);
    return c ? { role: 'cell', hand: slot.hand, label: slot.label, mix: c.mixList } : { role: 'unreachable', hand: slot.hand, label: slot.label, mix: null };
  });
  return { slots, ring: line.slots.findIndex((x) => x.hand === hand), boundaryAfter: boundaryAfter(s, line) };
}
