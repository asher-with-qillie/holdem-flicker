import { getChartCells, getChartDef } from './data';
import { classifyHand, heroIsIP, seatsBehind, type HandClass } from './explain';
import { ALL_HANDS, parseHandName } from './hands';
import { priceFacts } from './priceFacts';
import { AGGRESSION_ORDER, fullMix, primaryAction, rangeShare } from './range';
import { positionsAfter, positionsBefore, scenarioKey } from './scenarios';
import { actWord, josa, splitOf, splitPhrase } from './ko';
import { POS_INDEX, type Action, type ActionMix, type HandName, type Pos, type Scenario, type ScenarioKind } from './types';
import type { CardKey } from '../state/srs'; // 타입만 — srs.ts 는 react 를 import 하므로 값은 가져오지 않습니다.

/*
 * 자리별 보기(HandAtlas)의 데이터 쪽. docs/ATLAS_SPEC.md §4·§5.
 *
 * 순수 모듈입니다 — React·storage·시계 없음. 패 하나를 넣으면 그 패가 앉을 수 있는 74칸과,
 * 차트에서 계산한 숫자로만 만든 문장(Line)을 돌려줍니다.
 *
 * 문장은 전부 "구조 먼저"입니다: Line { text, claims, nums, source } 에서 claims(어느 칸이 무슨 액션인가)와
 * nums(문장에 찍힌 숫자)를 먼저 만들고 text 는 맨 마지막에 렌더합니다. tests/atlas.test.ts 가 모든 claim 과
 * 숫자를 차트에서 다시 유도해 대조하므로, 차트와 어긋나는 문장은 만들어질 길이 없습니다.
 *
 * 손패×자리 인과("KJo는 AK·KQ에 도미네이트되니까…") 템플릿은 일부러 없습니다. 엔진에 그런 모델이 없습니다.
 * "왜"는 숫자(뒤에 남은 사람·오픈 폭·3벳 폭·포지션)와 이미 검수된 자리 문장, 그 칸의 기존 해설로만 답합니다.
 */

/* ------------------------------------------------------------------ */
/* 타입                                                                 */
/* ------------------------------------------------------------------ */

/** '…부터' 문법이 성립하는 축. SB 는 뒤에 BB 한 명뿐이라 항상 따로 봅니다. */
export const CORE_SEATS: readonly Pos[] = ['UTG', 'HJ', 'CO', 'BTN'];

export type WeightClass = 'always' | 'most' | 'half' | 'some';

/**
 * 이 칸까지 오려면 앞 차트에서 해야 하는 액션. weight = 그 액션의 비중.
 * weight 가 0 이면 이 패로는 절대 안 오는 칸, 0보다 크면 1순위가 아니라 문제로는 안 나오지만 그 비중만큼은 오는 칸(드문 칸)입니다.
 */
export interface Gate {
  kind: ScenarioKind;
  needed: Action;
  weight: number;
}

export interface AtlasCell {
  /** cold_4bet 은 extras 없이 둡니다 — 차트는 hero 만 봅니다. */
  scenario: Scenario;
  /** `${scenarioKey(scenario)}|${hand}` — srs.cardKeyOf 와 같은 식. 테스트가 동일성을 잡습니다. */
  key: CardKey;
  mix: ActionMix | undefined;
  mixList: Array<{ action: Action; weight: number }>;
  /** primaryAction — trainer.ts 와 같은 동점 규칙(더 공격적인 쪽). */
  primary: Action;
  weightClass: WeightClass;
  reachable: boolean;
  gate?: Gate;
  note?: string;
  /** vs_limp 차트는 솔버 출력이 아니라 사람이 쓴 것이라 'human'. */
  evidence: 'solver' | 'human';
}

export interface AtlasSection {
  kind: ScenarioKind;
  layout: 'strip' | 'tri-lower' | 'tri-upper';
  /** hero 축 */
  rows: Pos[];
  /** villain 축 (삼각형만) */
  cols?: Pos[];
  /** 5 / 15 / 15 / 15 / 15 / 4 / 5 */
  cells: AtlasCell[];
}

export interface RfiProfile {
  pattern: 'always' | 'never' | 'sbOnly' | 'entry' | 'half' | 'partial' | 'irregular';
  /** CORE_SEATS 중 raise 비중 > 0 인 첫 자리 */
  firstAny: Pos | null;
  /** CORE_SEATS 중 raise 비중 ≥ 1 인 첫 자리 */
  firstAlways: Pos | null;
  /** CORE_SEATS 순서로 raise 비중 비감소 */
  monotone: boolean;
  /** primary(SB) !== primary(BTN) */
  sbDiffers: boolean;
  seats: Array<{ pos: Pos; behind: number; share: number; raise: number; primary: Action }>;
}

export interface HandAtlas {
  hand: HandName;
  cls: HandClass;
  rfi: RfiProfile;
  sections: Record<ScenarioKind, AtlasSection>;
}

export type LeverId =
  | 'behind'
  | 'openWidth'
  | 'threebetWidth'
  | 'position'
  | 'bbPrice'
  | 'sbRaiseOrFold'
  | 'bbFree'
  | 'blind3bet'
  | 'lateOpener'
  | 'earlyOpener'
  | 'sbOpen';

/** 한 칸의 자리 사실. constant = 숫자 없는 고정 문장(docs/EXPLAIN_SPEC.md §5.4 표의 문구와 글자가 같음). */
export interface Lever {
  id: LeverId;
  text: string;
  nums: number[];
  constant: boolean;
}

export interface Claim {
  scenario: Scenario;
  action: Action;
  weight: WeightClass;
}

export interface Line {
  text: string;
  claims: Claim[];
  nums: number[];
  source: 'computed' | 'constant' | 'verbatim';
}

/* ------------------------------------------------------------------ */
/* 한국어 조사 · 액션 이름 — src/poker/ko.ts 한 곳에서                       */
/* ------------------------------------------------------------------ */

/** villain 축 결론의 머리말: "BTN 오픈에는" / "SB 3벳에는" / "CO 4벳에는" / "HJ 올인에는". */
const VILLAIN_WORD: Partial<Record<ScenarioKind, string>> = { vs_open: '오픈', vs_3bet: '3벳', vs_4bet: '4벳', vs_5bet: '올인' };

const isBlind = (p?: Pos) => p === 'SB' || p === 'BB';
const isEarly = (p?: Pos) => p === 'UTG' || p === 'HJ';
const EPS = 1e-6;
const pctInt = (x: number) => Math.round(x * 100);
/** 한 문장의 한글 음절 수 한도(tests/atlas.test.ts style lint 와 같은 30). */
const SENTENCE_MAX_HANGUL = 30;
const hangulLen = (t: string) => (t.match(/[가-힣]/g) ?? []).length;
const aggression = (a: Action) => AGGRESSION_ORDER.indexOf(a);

/* ------------------------------------------------------------------ */
/* 칸 · 섹션                                                             */
/* ------------------------------------------------------------------ */

/**
 * 비중 등급. p = 1순위 비중.
 *  always ⇔ p ≥ 0.999 · half ⇔ 2순위가 있고 (동점 또는 p ≤ 0.5) · most ⇔ 0.5 < p < 0.999 · some ⇔ 그 외(안전망)
 */
function weightClassOf(mixList: AtlasCell['mixList']): WeightClass {
  const p = mixList[0]?.weight ?? 1;
  if (p >= 0.999) return 'always';
  const p2 = mixList[1]?.weight;
  if (p2 !== undefined && (Math.abs(p - p2) < 0.01 || p <= 0.5)) return 'half';
  if (p > 0.5) return 'most';
  return 'some';
}

/** 동점 반반(콜·3벳 50/50 같은 것). 2순위가 폴드·체크면 "절반만 {act}"가 맞고, 아니면 "{act}과 {act2}를 반반". */
function isTieMix(cell: AtlasCell): boolean {
  const [a, b] = cell.mixList;
  return !!b && Math.abs(a.weight - b.weight) < 0.01 && b.action !== 'fold' && b.action !== 'check';
}

const prim = (s: Scenario, hand: HandName): Action => primaryAction(getChartCells(s)[hand]);
const weightIn = (s: Scenario, hand: HandName, a: Action): number => fullMix(getChartCells(s)[hand]).find((m) => m.action === a)?.weight ?? 0;

/**
 * buildSteps 의 게이트를 그대로 복제합니다(ok = 앞 단계마다 1순위가 그 액션). 앱이 가르치는 답은 primary 이므로,
 * buildSteps 가 rfi 를 세션에서 뺐을 때 쓰는 "비중 > 0" 게이트는 쓰지 않습니다 — 트레이너 · 퀴즈 · 다이제스트는 ok 만 봅니다.
 *
 * 다만 1순위가 아니어도 그 액션을 섞는 패(UTG 오픈에 콜 75 · 3벳 25 인 TT)는 3벳한 25%만큼은 4벳을 받습니다. 그런 칸에
 * '3벳하지 않으니 4벳을 받을 일이 없어요'라고 하면 거짓이라(감사: 121칸), gate 에 앞 단계 액션의 비중(weight)을 담습니다.
 * 앞 단계 중 비중이 0인 게이트가 하나라도 있으면 그 게이트(절대 안 옴), 아니면 1순위가 아닌 첫 게이트(드물게 옴)를 돌려줍니다.
 */
export function isReachable(s: Scenario, hand: HandName): { ok: boolean; gate?: Gate } {
  const path: Array<{ kind: ScenarioKind; needed: Action; at: Scenario }> = [];
  if (s.kind === 'vs_3bet' || s.kind === 'vs_5bet') path.push({ kind: 'rfi', needed: 'raise', at: { kind: 'rfi', hero: s.hero } });
  if (s.kind === 'vs_5bet') path.push({ kind: 'vs_3bet', needed: 'fourbet', at: { kind: 'vs_3bet', hero: s.hero, villain: s.villain } });
  if (s.kind === 'vs_4bet') path.push({ kind: 'vs_open', needed: 'threebet', at: { kind: 'vs_open', hero: s.hero, villain: s.villain } });
  const failing: Gate[] = path.filter((g) => prim(g.at, hand) !== g.needed).map((g) => ({ kind: g.kind, needed: g.needed, weight: weightIn(g.at, hand, g.needed) }));
  if (!failing.length) return { ok: true };
  const never = failing.find((g) => g.weight <= EPS);
  return { ok: false, gate: never ? { ...never, weight: 0 } : failing[0] };
}

/** 문제로는 안 나오지만(1순위가 아님) 앞 단계 액션을 섞는 만큼은 오는 칸. */
export const isRare = (c: AtlasCell): boolean => !c.reachable && !!c.gate && c.gate.weight > EPS;

function makeCell(scenario: Scenario, hand: HandName): AtlasCell {
  const cells = getChartCells(scenario);
  const mix = cells[hand];
  const mixList = fullMix(mix);
  const reach = isReachable(scenario, hand);
  const cell: AtlasCell = {
    scenario,
    key: `${scenarioKey(scenario)}|${hand}`,
    mix,
    mixList,
    primary: mixList[0]?.action ?? 'fold',
    weightClass: weightClassOf(mixList),
    reachable: reach.ok,
    evidence: scenario.kind === 'vs_limp' ? 'human' : 'solver',
  };
  if (reach.gate) cell.gate = reach.gate;
  const note = getChartDef(scenario).notes?.[hand];
  if (note) cell.note = note;
  return cell;
}

const RFI_ROWS: Pos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB'];
const LATE_ROWS: Pos[] = ['HJ', 'CO', 'BTN', 'SB', 'BB'];
const EARLY_ROWS: Pos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB'];
const COLD_ROWS: Pos[] = ['CO', 'BTN', 'SB', 'BB'];

function buildSection(kind: ScenarioKind, hand: HandName): AtlasSection {
  switch (kind) {
    case 'rfi':
      return { kind, layout: 'strip', rows: RFI_ROWS, cells: RFI_ROWS.map((hero) => makeCell({ kind, hero }, hand)) };
    case 'vs_open':
    case 'vs_4bet': {
      // 왼쪽 아래 삼각형: 상대가 나보다 앞일 때만 칸이 있습니다.
      const cells: AtlasCell[] = [];
      for (const hero of LATE_ROWS) for (const villain of positionsBefore(hero)) cells.push(makeCell({ kind, hero, villain }, hand));
      return { kind, layout: 'tri-lower', rows: LATE_ROWS, cols: EARLY_ROWS, cells };
    }
    case 'vs_3bet':
    case 'vs_5bet': {
      // 오른쪽 위 삼각형: 3벳한 상대는 나보다 뒤입니다.
      const cells: AtlasCell[] = [];
      for (const hero of EARLY_ROWS) for (const villain of positionsAfter(hero)) cells.push(makeCell({ kind, hero, villain }, hand));
      return { kind, layout: 'tri-upper', rows: EARLY_ROWS, cols: LATE_ROWS, cells };
    }
    case 'cold_4bet':
      return { kind, layout: 'strip', rows: COLD_ROWS, cells: COLD_ROWS.map((hero) => makeCell({ kind, hero }, hand)) };
    case 'vs_limp':
      return { kind, layout: 'strip', rows: LATE_ROWS, cells: LATE_ROWS.map((hero) => makeCell({ kind, hero }, hand)) };
  }
}

const SECTION_ORDER: ScenarioKind[] = ['rfi', 'vs_open', 'vs_3bet', 'vs_4bet', 'vs_5bet', 'cold_4bet', 'vs_limp'];

const atlasCache = new Map<HandName, HandAtlas>();

/** 74번의 getChartCells 조회(캐시됨). 패별로 memo. */
export function handAtlas(hand: HandName): HandAtlas {
  let atlas = atlasCache.get(hand);
  if (atlas) return atlas;
  const sections = {} as Record<ScenarioKind, AtlasSection>;
  for (const kind of SECTION_ORDER) sections[kind] = buildSection(kind, hand);
  atlas = { hand, cls: classifyHand(hand), rfi: rfiProfile(hand), sections };
  atlasCache.set(hand, atlas);
  return atlas;
}

function cellAt(sec: AtlasSection, hero: Pos, villain?: Pos): AtlasCell | undefined {
  return sec.cells.find((c) => c.scenario.hero === hero && c.scenario.villain === villain);
}

/* ------------------------------------------------------------------ */
/* 차트에서 계산하는 숫자                                                  */
/* ------------------------------------------------------------------ */

const shareCache = new Map<string, number>();
/** rangeShare 를 정수 %로. 169패를 훑는 계산이라 (차트, 액션)별로 캐시합니다. */
function sharePct(s: Scenario, action: Action): number {
  const key = `${scenarioKey(s)}|${action}`;
  let v = shareCache.get(key);
  if (v === undefined) {
    v = pctInt(rangeShare(getChartCells(s), action));
    shareCache.set(key, v);
  }
  return v;
}
/** share(seat) = 그 자리의 오픈 폭. */
const openPct = (seat: Pos): number => sharePct({ kind: 'rfi', hero: seat }, 'raise');
/** tb(v, h) = v 가 h 의 오픈에 3벳하는 폭. */
const threebetPct = (villain: Pos, hero: Pos): number => sharePct({ kind: 'vs_open', hero: villain, villain: hero }, 'threebet');

export function rfiProfile(hand: HandName): RfiProfile {
  const seats = RFI_ROWS.map((pos) => {
    const s: Scenario = { kind: 'rfi', hero: pos };
    const mix = getChartCells(s)[hand];
    return { pos, behind: seatsBehind(pos), share: openPct(pos), raise: mix?.raise ?? 0, primary: primaryAction(mix) };
  });
  const core = seats.slice(0, 4);
  const sb = seats[4];
  const btn = seats[3];
  const firstAny = core.find((c) => c.raise > EPS)?.pos ?? null;
  const firstAlways = core.find((c) => c.raise >= 0.999)?.pos ?? null;
  const monotone = core.every((c, i) => i === 0 || c.raise >= core[i - 1].raise - EPS);
  // 1순위만 보면 동점(오픈 50 / 폴드 50 → 오픈)이 BTN 의 항상 오픈과 같아 보여, 'BTN부터 오픈해요'가 SB 의 절반을
  // 덮어 버립니다(Q2s·53s). 항상인지 아닌지가 다르면 SB 절을 붙입니다.
  const sbDiffers = sb.primary !== btn.primary || (sb.raise >= 0.999) !== (btn.raise >= 0.999);
  let pattern: RfiProfile['pattern'];
  if (core.every((c) => c.raise >= 0.999)) pattern = 'always';
  else if (core.every((c) => c.raise <= EPS)) pattern = sb.raise > EPS ? 'sbOnly' : 'never';
  else if (!monotone) pattern = 'irregular';
  else if (!firstAlways) pattern = 'partial';
  else if (firstAny === firstAlways) pattern = 'entry';
  else pattern = 'half';
  return { pattern, firstAny, firstAlways, monotone, sbDiffers, seats };
}

/** 같은 줄 = 페어 줄 / 같은 높은 카드·같은 수티드 여부. */
function rowId(hand: HandName): string {
  const info = parseHandName(hand);
  return info.kind === 'pair' ? 'pair' : `${info.high}${info.kind === 'suited' ? 's' : 'o'}`;
}

/**
 * firstAny === seat 인 패. 정렬: prefer 와 같은 줄 → 같은 클래스 → ALL_HANDS 순. prefer 자신은 제외.
 * 네 자리의 결과는 서로소이고 합치면 '어딘가에서 오픈하는 패' 전부입니다.
 */
export function newcomersAt(seat: Pos, prefer?: HandName): HandName[] {
  const out = ALL_HANDS.filter((h) => h !== prefer && rfiProfile(h).firstAny === seat);
  if (!prefer) return out;
  const row = rowId(prefer);
  const cls = classifyHand(prefer);
  const rank = (h: HandName) => (rowId(h) === row ? 0 : classifyHand(h) === cls ? 1 : 2);
  return out
    .map((h, i) => ({ h, i, r: rank(h) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.h);
}

/** 손패 고르기 색칠용: firstAny, 없으면 SB 에서 raise > 0 이면 'SB', 아니면 null. */
export function entrySeat(hand: HandName): Pos | 'SB' | null {
  const p = rfiProfile(hand);
  if (p.firstAny) return p.firstAny;
  return p.seats[4].raise > EPS ? 'SB' : null;
}

/* ------------------------------------------------------------------ */
/* 레버 (자리 사실)                                                      */
/* ------------------------------------------------------------------ */

/**
 * 한 칸의 레버. predicate 를 통과한 것만, 우선순위 순서로.
 * 'behind' 는 블라인드가 아닌 자리에서만 — SB 가 BTN 보다 좁은 건 뒤에 남은 사람 수가 아니라 값과 포지션 때문이라,
 * 블라인드를 가로질러 "뒤에 남은 사람"으로 설명하면 틀린 포커를 가르칩니다.
 */
/*
 * 레버는 사실만 말하지 않고 결과까지 말합니다(THEORY_SPEC §2 — 감사에서 결과 없는 레버 2,249줄).
 * 결과 절은 차트로 확인한 것만 씁니다: 블라인드 3벳에는 모든 오프너가 더 넓게 지키고(49~59% 대 41~52%),
 * 오픈에 맞서는 비중은 오프너가 뒷자리일수록 늘고, SB 오픈(46.2%)은 BTN(46.3%)보다 넓지 않습니다.
 * BB 는 어느 오프너에게나 다른 자리보다 넓게 콜하고(UTG 상대 25.8% 대 BTN 9.6%), SB 의 콜은 2% 아래이며(0.7~1.5%),
 * 블라인드는 같은 오프너에게 블라인드가 아닌 자리보다 넓게 3벳합니다(UTG 상대 6~8% 대 5.1%).
 * tests/atlas.test.ts 가 이것들을 모든 칸에서 다시 셉니다.
 *
 * 블라인드 3벳의 이유는 3벳 범위의 폭입니다. 예전 문장('블러프도 섞여 있어' · '밸류 위주라')은 차트와 책 둘 다와 맞지 않았습니다 —
 * 차트에서는 HJ · CO · BTN 의 3벳에도 A5s · A4s 블러프가 있고, 책은 BTN 3벳을 양극화, SB 3벳을 선형으로 봅니다(5장 4절).
 */
export const POSITION_IP = '포지션이 있어 플랍 이후 내내 유리해요.';
export const POSITION_OOP = '포지션이 없어 플랍 이후 내내 불리해요.';
export const SB_OPEN = 'SB는 뒤에 BB 한 명뿐이지만 포지션이 없어, BTN보다 넓게 오픈하지는 않아요.';
/** SB 의 오픈 대응(책 5장 5절: BB 의 스퀴즈 · 두 명을 상대로 포지션 없음 · 레이크). 차트는 콜을 0.7~1.5% 섞어서 '대부분'. */
export const SB_RAISE_OR_FOLD = ['SB는 콜하면 BB에게 스퀴즈당하기 쉽고, 플랍 이후 포지션도 없어요.', '그래서 콜은 드물고, 대부분 3벳 아니면 폴드예요.'] as const;
/**
 * BB 의 오픈 대응 꼬리. 가격은 책 5장 5절(이미 낸 1bb 덕분에 더 낼 돈이 작음 — 앞 문장)이고, 스퀴즈는 책이 콜을 줄이는
 * 이유로 드는 것(5장 5절의 SB · BTN, 8장의 'CO가 콜하면 뒤에 BN이 남아 스퀴즈')을 BB 에 맞춘 것입니다 — BB 는 뒤에 아무도 없어
 * 그 위험이 없습니다. '마지막 차례라 제일 넓게'는 책 1장 1절이 짚는 오해('마지막에 행동하는 BB가 가장 유리하다')로 읽혀서
 * 바꿨습니다 — BB 는 플랍 이후 포지션이 없습니다.
 */
export const BB_PRICE_TAIL = ['뒤에 아무도 없어 스퀴즈를 받지 않아요.', '그래서 포지션이 없어도 가장 넓게 콜해요.'] as const;
export const BB_PRICE_TAIL_SB = 'SB 상대로는 포지션도 있어요.';
/** 3벳한 쪽(v)이 블라인드냐에 따라. 블라인드는 같은 오프너에게 더 넓게 3벳합니다(차트, 테스트가 셉니다). */
export const blind3betText = (v: Pos): string => (isBlind(v) ? `${v} 3벳은 범위가 넓어 더 넓게 지켜요.` : `${v} 3벳은 범위가 좁아 더 좁게 지켜요.`);
/** 뒤에 남은 사람이 많을수록 생기는 일(책 4장 「뒤에 남은 사람」). '…기 쉬워요' 앞에 붙습니다. */
const BEHIND_RISK: Partial<Record<ScenarioKind, string>> = {
  rfi: '3벳을 받',
  vs_open: '콜했을 때 스퀴즈를 받',
  vs_limp: '뒤에서 강한 패가 나오',
  cold_4bet: '뒤에서 강한 패가 나오',
};

export function seatLevers(s: Scenario): Lever[] {
  const out: Lever[] = [];
  const { kind, hero } = s;
  const v = s.villain;
  if (v && kind !== 'vs_5bet') {
    out.push({ id: 'position', text: heroIsIP(s) ? POSITION_IP : POSITION_OOP, nums: [], constant: true });
  }
  if ((kind === 'rfi' || kind === 'vs_open' || kind === 'vs_limp' || kind === 'cold_4bet') && !isBlind(hero)) {
    const n = seatsBehind(hero);
    out.push({ id: 'behind', text: `뒤에 ${n}명이 남아 있어 ${BEHIND_RISK[kind]}기 쉬워요.`, nums: [n], constant: false });
  }
  if (kind === 'vs_open' && hero === 'BB') {
    const price = priceFacts(s)!;
    const tail = v === 'SB' ? BB_PRICE_TAIL_SB : BB_PRICE_TAIL.join(' ');
    out.push({ id: 'bbPrice', text: `BB는 이미 1bb를 냈으니 ${price.toCall}만 더 내면 돼요. ${tail}`, nums: [], constant: false });
  }
  if (kind === 'vs_open' && hero === 'SB') {
    out.push({ id: 'sbRaiseOrFold', text: SB_RAISE_OR_FOLD.join(' '), nums: [], constant: true });
  }
  if (kind === 'vs_limp' && hero === 'BB') out.push({ id: 'bbFree', text: 'BB는 이미 1bb를 냈으니 체크하면 공짜로 플랍을 봐요.', nums: [], constant: true });
  // 3벳 레인지의 폭은 vs_3bet 에서만 — vs_5bet 해설은 올인 레인지를 말하지 3벳 레인지를 말하지 않습니다.
  if (kind === 'vs_3bet' && v) out.push({ id: 'blind3bet', text: blind3betText(v), nums: [], constant: true });
  if ((kind === 'vs_open' || kind === 'vs_4bet') && v) {
    const p = openPct(v);
    out.push({ id: 'openWidth', text: `${josa(v, '은/는')} ${p}%를 오픈해요.`, nums: [p], constant: false });
  }
  if (kind === 'rfi') {
    const p = openPct(hero);
    out.push({ id: 'openWidth', text: `${josa(hero, '은/는')} ${p}%를 오픈해요.`, nums: [p], constant: false });
  }
  if ((kind === 'vs_3bet' || kind === 'vs_5bet') && v) {
    const p = threebetPct(v, hero);
    out.push({ id: 'threebetWidth', text: `${josa(v, '은/는')} ${p}%를 3벳해요.`, nums: [p], constant: false });
  }
  if (kind === 'vs_open' && v) {
    if (isEarly(v)) out.push({ id: 'earlyOpener', text: '앞자리 오픈은 강한 패 위주라 좁게 맞서요.', nums: [], constant: true });
    else out.push({ id: 'lateOpener', text: '뒷자리 오픈엔 약한 패도 많이 섞여 있어 넓게 맞서요.', nums: [], constant: true });
  }
  if (kind === 'rfi' && hero === 'SB') out.push({ id: 'sbOpen', text: SB_OPEN, nums: [], constant: true });
  return out;
}

/** 같은 kind 이고 hero 또는 villain 중 하나만 다를 때. */
export function compareAxis(a: Scenario, b: Scenario): 'hero' | 'villain' | 'none' {
  if (a.kind !== b.kind) return 'none';
  const heroDiff = a.hero !== b.hero;
  const villainDiff = a.villain !== b.villain;
  if (heroDiff && !villainDiff) return 'hero';
  if (villainDiff && !heroDiff) return 'villain';
  return 'none';
}

/** 결론에서 먼저 말하는 쪽: 더 공격적인 primary → 같으면 비중이 큰 쪽 → 같으면 더 뒷자리(다른 축의 자리). */
function orderPair(a: AtlasCell, b: AtlasCell, axis: 'hero' | 'villain'): [AtlasCell, AtlasCell] {
  const seatOf = (c: AtlasCell) => (axis === 'hero' ? c.scenario.hero : c.scenario.villain!);
  const score = (c: AtlasCell) => aggression(c.primary) * 1000 + Math.round(c.mixList[0].weight * 100);
  if (score(b) > score(a)) return [b, a];
  if (score(b) < score(a)) return [a, b];
  return POS_INDEX[seatOf(b)] > POS_INDEX[seatOf(a)] ? [b, a] : [a, b];
}

/** 첫 문장만 (레버 문장 둘을 나란히 붙일 때 씁니다). */
const firstSentence = (text: string): string => text.split(/(?<=\.)\s+/)[0];

/**
 * 두 칸에서 값이 다른 레버만, 숫자 두 개를 한 문장에 (≤ 2개). 같은 값인 레버는 절대 나오지 않습니다 —
 * "둘 다 인포지션"인데 포지션 이유를 붙이는 일이 없게. 차이 나는 레버가 0개면 빈 배열(이유를 지어내지 않습니다).
 */
export function differingLevers(a: AtlasCell, b: AtlasCell): Lever[] {
  const axis = compareAxis(a.scenario, b.scenario);
  if (axis === 'none') return [];
  const la = new Map(seatLevers(a.scenario).map((l) => [l.id, l] as const));
  const lb = new Map(seatLevers(b.scenario).map((l) => [l.id, l] as const));
  const sa = a.scenario;
  // 축 위에서 앞자리인 칸을 A, 뒷자리를 B 로 — 숫자 문장은 앞자리부터 읽습니다(스트립의 왼→오).
  const seatOf = (c: AtlasCell) => (axis === 'hero' ? c.scenario.hero : c.scenario.villain!);
  const [A, B] = POS_INDEX[seatOf(a)] <= POS_INDEX[seatOf(b)] ? [a, b] : [b, a];
  const lA = A === a ? la : lb;
  const lB = A === a ? lb : la;
  const out: Lever[] = [];

  // 1. position
  let position: Lever | null = null;
  const pa = la.get('position');
  const pb = lb.get('position');
  if (pa && pb && pa.text !== pb.text) {
    const ip = heroIsIP(sa) ? a : b;
    const oop = ip === a ? b : a;
    const text =
      axis === 'villain'
        ? `${seatOf(ip)} 상대로는 포지션이 있어 플랍 이후 유리하고, ${seatOf(oop)} 상대로는 불리해요.`
        : `${seatOf(ip)}에서는 포지션이 있어 플랍 이후 유리하고, ${seatOf(oop)}에서는 불리해요.`;
    position = { id: 'position', text, nums: [], constant: false };
  }
  // 2. behind — 양쪽 다 블라인드가 아닐 때만 후보입니다.
  let behind: Lever | null = null;
  const ba = lA.get('behind');
  const bb = lB.get('behind');
  if (ba && bb && ba.nums[0] !== bb.nums[0]) {
    behind = {
      id: 'behind',
      text: `${josa(A.scenario.hero, '은/는')} 뒤에 ${ba.nums[0]}명, ${josa(B.scenario.hero, '은/는')} ${bb.nums[0]}명이 남아 ${josa(A.scenario.hero, '이/가')} ${BEHIND_RISK[sa.kind]}기 더 쉬워요.`,
      nums: [ba.nums[0], bb.nums[0]],
      constant: false,
    };
  }
  // 3. bbPrice / sbRaiseOrFold / bbFree — 한쪽에만 있는 자리 문장을 결론 순서(더 공격적인 쪽 먼저)로 나란히.
  const [first, second] = orderPair(a, b, axis);
  const roleIds: LeverId[] = ['bbPrice', 'sbRaiseOrFold', 'bbFree'];
  const roles: Lever[] = [];
  for (const c of [first, second]) {
    const mine = c === a ? la : lb;
    const other = c === a ? lb : la;
    for (const id of roleIds) {
      const l = mine.get(id);
      if (l && !other.has(id)) roles.push(l);
    }
  }
  const role: Lever | null = roles.length ? { id: roles[0].id, text: roles.map((l) => firstSentence(l.text)).join(' '), nums: [], constant: roles.every((l) => l.constant) } : null;
  // 블라인드와 비블라인드를 같은 축에서 견줄 때(BB 콜 ↔ BTN 폴드)는 자리 역할(값·마지막 차례·스퀴즈)이 결론을 받치는
  // 이유입니다. 포지션은 사실이지만 접는 쪽(BTN)이 유리하다고 먼저 말하면 결론과 반대로 읽힙니다 — 역할 문장을 앞에 둡니다.
  if (role && axis === 'hero') out.push(role);
  if (position) out.push(position);
  if (behind) out.push(behind);
  if (role && axis !== 'hero') out.push(role);
  // 4. blind3bet — 한쪽만 블라인드일 때 두 문장(블라인드 먼저).
  // 값은 "블라인드냐 아니냐"입니다 — 자리 이름만 다른 두 문장은 같은 값입니다.
  const ta = la.get('blind3bet');
  const tb = lb.get('blind3bet');
  if (ta && tb && isBlind(sa.villain) !== isBlind(b.scenario.villain)) {
    const blindFirst = isBlind(sa.villain) ? [ta, tb] : [tb, ta];
    out.push({ id: 'blind3bet', text: blindFirst.map((l) => l.text).join(' '), nums: [], constant: true });
  }
  // 5. openWidth / threebetWidth — 2pt 이상 차이 날 때만.
  const oa = lA.get('openWidth');
  const ob = lB.get('openWidth');
  if (oa && ob && Math.abs(oa.nums[0] - ob.nums[0]) >= 2) {
    const text =
      sa.kind === 'rfi'
        ? `오픈 레인지는 ${A.scenario.hero} ${oa.nums[0]}%, ${B.scenario.hero} ${ob.nums[0]}%예요.`
        : `${josa(A.scenario.villain!, '은/는')} ${oa.nums[0]}%, ${josa(B.scenario.villain!, '은/는')} ${ob.nums[0]}%를 오픈해요.`;
    out.push({ id: 'openWidth', text, nums: [oa.nums[0], ob.nums[0]], constant: false });
  }
  const wa = lA.get('threebetWidth');
  const wb = lB.get('threebetWidth');
  if (wa && wb && Math.abs(wa.nums[0] - wb.nums[0]) >= 2) {
    const text =
      axis === 'villain'
        ? `${josa(A.scenario.villain!, '은/는')} ${wa.nums[0]}%, ${josa(B.scenario.villain!, '은/는')} ${wb.nums[0]}%를 3벳해요.`
        : `${josa(sa.villain!, '은/는')} ${A.scenario.hero} 오픈에 ${wa.nums[0]}%, ${B.scenario.hero} 오픈에 ${wb.nums[0]}%를 3벳해요.`;
    out.push({ id: 'threebetWidth', text, nums: [wa.nums[0], wb.nums[0]], constant: false });
  }
  // 6. early / late — 한쪽만 뒷자리 오프너면 두 상수를 나란히(앞자리 먼저).
  const ea = la.get('earlyOpener') ?? lb.get('earlyOpener');
  const lt = la.get('lateOpener') ?? lb.get('lateOpener');
  if (ea && lt && la.has('earlyOpener') !== lb.has('earlyOpener')) {
    out.push({ id: 'earlyOpener', text: `${ea.text} ${lt.text}`, nums: [], constant: true });
  }
  return out.slice(0, 2);
}

/* ------------------------------------------------------------------ */
/* 문장: 구조 먼저, 텍스트는 마지막                                        */
/* ------------------------------------------------------------------ */

const claimOf = (c: AtlasCell): Claim => ({ scenario: c.scenario, action: c.primary, weight: c.weightClass });

/** 비중 수식어. 결론 프레임(마침표 없음): "{act}해요" / "주로 {act}해요" / "절반만 {act}해요" / "{act}과 {act2}를 반반 섞어요". */
function weightPhrase(cell: AtlasCell): string {
  const kind = cell.scenario.kind;
  const act = actWord(cell.primary, kind);
  switch (cell.weightClass) {
    case 'always':
      return `${act}해요`;
    case 'most':
      return `주로 ${act}해요`;
    case 'half': {
      if (isTieMix(cell)) return `${josa(act, '과/와')} ${josa(actWord(cell.mixList[1].action, kind), '을/를')} 반반 섞어요`;
      // 세 액션 칸(콜 50 / 3벳 25 / 폴드 25, 폴드 50 / 4벳 25 / 콜 25)은 '절반만 콜'로 줄이지 않고 나눔을 부릅니다
      // (THEORY_SPEC §5) — 줄 문장과 같은 말: '절반은 콜하고, 나머지를 3벳과 폴드로 나눠요'.
      const sp = splitOf(cell.mixList);
      if (sp) return splitPhrase(sp, kind, 'solo');
      // 1순위가 폴드·체크인 반반: "절반만 폴드합니다"는 폴드를 말리는 말로 읽힙니다. 나머지 절반이 뭘 하는지까지 말합니다.
      if (cell.primary === 'fold' || cell.primary === 'check') return `절반은 ${act}, 절반은 ${josa(restWords(cell), '이에요/예요')}`;
      return `절반만 ${act}해요`;
    }
    case 'some':
      return `${pctInt(cell.mixList[0].weight)}%만 ${act}해요`;
  }
}

/** 1순위 뒤의 액션들을 '이나'로 — "4벳이나 콜". 비중 0 은 뺍니다. */
function restWords(cell: AtlasCell): string {
  return cell.mixList
    .slice(1)
    .filter((m) => m.weight > EPS)
    .map((m) => actWord(m.action, cell.scenario.kind))
    .join('이나 ');
}

/** 열거용 수식어("UTG에서 절반만, …"). always 는 빈 문자열. */
function weightWord(cell: AtlasCell): { word: string; nums: number[] } {
  switch (cell.weightClass) {
    case 'always':
      return { word: '', nums: [] };
    case 'most':
      return { word: '주로', nums: [] };
    case 'half':
      return { word: '절반만', nums: [] };
    case 'some': {
      const p = pctInt(cell.mixList[0].weight);
      return { word: `${p}%만`, nums: [p] };
    }
  }
}

interface Digest {
  text: string;
  claims: Claim[];
  nums: number[];
  /** 모든 reachable 칸의 primary 가 같을 때 그 액션 */
  uniform: Action | null;
  /** 이름을 붙일 소수 그룹(≤ 3곳) */
  named: { action: Action; cells: AtlasCell[] } | null;
}

/**
 * 섞인 칸 하나의 명사형 라벨(다이제스트용, THEORY_SPEC §5 — 캡슐과 같은 비중어):
 *  - 주로(1순위 > 50%): 섞는 쪽을 비중과 함께 '올인 25% 섞음'(섞는 액션이 둘 이상이면 비중 없이 '콜·폴드 섞음')
 *  - 계속하는 두 액션의 동점: '3벳·콜 반반'
 *  - 세 액션 칸: '절반은 4벳, 절반은 콜·폴드'
 *  - 그 밖의 절반(나머지가 폴드·체크): '절반만 콜'
 * 1순위가 폴드·체크인 절반 칸은 세 액션 칸뿐입니다(폴드 50 · 콜 50 은 동점이라 콜이 1순위).
 */
function mixLabel(c: AtlasCell): { text: string; nums: number[] } {
  const kind = c.scenario.kind;
  const act = actWord(c.primary, kind);
  const others = c.mixList.slice(1).filter((m) => m.weight > EPS);
  switch (c.weightClass) {
    case 'always':
      return { text: act, nums: [] };
    case 'most':
      if (others.length === 1) return { text: `${actWord(others[0].action, kind)} ${pctInt(others[0].weight)}% 섞음`, nums: [pctInt(others[0].weight)] };
      return { text: `${others.map((m) => actWord(m.action, kind)).join('·')} 섞음`, nums: [] };
    case 'half': {
      if (isTieMix(c)) return { text: `${act}·${actWord(c.mixList[1].action, kind)} 반반`, nums: [] };
      const sp = splitOf(c.mixList);
      if (sp) return { text: splitPhrase(sp, kind, 'noun'), nums: [] };
      return { text: `절반만 ${act}`, nums: [] };
    }
    case 'some':
      return { text: `${pctInt(c.mixList[0].weight)}%만 ${act}`, nums: [pctInt(c.mixList[0].weight)] };
  }
}

/** 칸이 하나뿐일 때의 라벨: '폴드' · '주로 폴드' · '절반만 콜' · '3벳·콜 반반' · '절반은 4벳, 절반은 콜·폴드'. */
function soloLabel(c: AtlasCell): { text: string; nums: number[] } {
  if (c.weightClass === 'most') return { text: `주로 ${actWord(c.primary, c.scenario.kind)}`, nums: [] };
  return mixLabel(c);
}

/**
 * D(sec): reachable 칸의 primary 별 개수, 혼합 개수. 텍스트와 함께 claims 를 만듭니다.
 * '전부'는 모든 칸이 그 액션 100%일 때만 씁니다 — '15곳 전부 폴드 · 그중 6곳은 올인도 섞음'은 앞뒤가 어긋났습니다(감사).
 * 섞인 칸은 무엇을 섞는지까지 말하고('그중 6곳은 올인 25% 섞음'), 칸이 하나면 '폴드 1곳'(여러 액션일 때의 '콜 3곳 · 폴드 12곳'과 같은 꼴 — 섹션 아래 '올인까지 가면: …'에 그대로 붙습니다).
 * 이 패로 오는 칸이 없으면 '이 패로는 안 오는 상황', 그래도 앞 단계 액션을 섞어 드물게 오는 칸이 있으면 '드물게만 오는 상황'.
 */
function digest(sec: AtlasSection): Digest {
  const live = sec.cells.filter((c) => c.reachable);
  const claims = live.map(claimOf);
  if (!live.length) return { text: sec.cells.some(isRare) ? '이 패로는 드물게만 오는 상황' : '이 패로는 안 오는 상황', claims, nums: [], uniform: null, named: null };
  const kind = sec.kind;
  const groups = new Map<Action, AtlasCell[]>();
  for (const c of live) groups.set(c.primary, [...(groups.get(c.primary) ?? []), c]);

  if (groups.size === 1) {
    const act = live[0].primary;
    const mixed = live.filter((c) => c.weightClass !== 'always');
    if (live.length === 1) {
      const l = soloLabel(live[0]);
      // 세 액션 칸의 라벨('절반은 4벳, 절반은 콜·폴드')은 뒤에 '1곳'을 붙이면 끝 액션에 걸려 읽혀서 머리를 따로 둡니다.
      const text = l.text.includes(',') ? `${actWord(act, kind)} 1곳 · ${l.text}` : `${l.text} 1곳`;
      return { text, claims, nums: [1, ...l.nums], uniform: act, named: null };
    }
    if (!mixed.length) return { text: `${live.length}곳 전부 ${actWord(act, kind)}`, claims, nums: [live.length], uniform: act, named: null };
    // 섞인 칸을 라벨별로 묶어(많은 쪽부터) 이름을 댑니다 — 세 묶음까지, 30자(한글) 안일 때만. 넘치면 섞는 액션만.
    // (JJ 의 4벳 대응은 '절반만 콜' 5 · '올인 25% 섞음' 5 · '폴드 25% 섞음' 4 — 섞는 액션만 말하면 절반 칸이 가려집니다.)
    const byLabel = new Map<string, { cells: AtlasCell[]; nums: number[] }>();
    for (const c of mixed) {
      const l = mixLabel(c);
      const g = byLabel.get(l.text) ?? { cells: [], nums: l.nums };
      g.cells.push(c);
      byLabel.set(l.text, g);
    }
    const labels = [...byLabel.entries()].sort((x, y) => y[1].cells.length - x[1].cells.length);
    const nums = [live.length];
    let tail = labels.map(([text, g]) => `${g.cells.length}곳은 ${text}`).join(' · ');
    if (labels.length <= 3 && hangulLen(`${actWord(act, kind)} ${live.length}곳 · 그중 ${tail}`) <= SENTENCE_MAX_HANGUL) {
      for (const [, g] of labels) nums.push(g.cells.length, ...g.nums);
    } else {
      const alts = [...new Set(mixed.flatMap((c) => c.mixList.slice(1).filter((m) => m.weight > EPS).map((m) => m.action)))].sort((x, y) => aggression(y) - aggression(x));
      tail = `${mixed.length}곳은 ${alts.map((x) => actWord(x, kind)).join('·')}도 섞음`;
      nums.push(mixed.length);
    }
    return { text: `${actWord(act, kind)} ${live.length}곳 · 그중 ${tail}`, claims, nums, uniform: act, named: null };
  }

  // 여러 primary: 개수 내림차순, 폴드는 맨 뒤, 3개까지. vs_limp 의 BB 체크는 개수가 아니라 문장으로.
  const bbCheck = kind === 'vs_limp' ? live.find((c) => c.scenario.hero === 'BB' && c.primary === 'check') : undefined;
  const entries = [...groups.entries()]
    .filter(([act]) => !(bbCheck && act === 'check'))
    .sort((x, y) => (x[0] === 'fold' ? 1 : y[0] === 'fold' ? -1 : y[1].length - x[1].length || aggression(y[0]) - aggression(x[0])));
  const parts: string[] = [];
  const nums: number[] = [];
  const raises = groups.get('raise') ?? [];
  const btnOnlyHalf = kind === 'vs_limp' && raises.length === 1 && raises[0].scenario.hero === 'BTN' && raises[0].weightClass === 'half' && !splitOf(raises[0].mixList);
  if (btnOnlyHalf) {
    // 캡슐과 같은 비중어('절반만 레이즈')로. 다른 자리의 폴드는 개수로 붙입니다('BTN에서만 절반' — '만'이 어디에 걸리는지 흐렸습니다).
    parts.push('BTN에서 절반만 레이즈');
    const folds = groups.get('fold') ?? [];
    if (folds.length) {
      parts.push(`폴드 ${folds.length}곳`);
      nums.push(folds.length);
    }
  } else {
    for (const [act, cells] of entries.slice(0, 3)) {
      parts.push(`${actWord(act, kind)} ${cells.length}곳`);
      nums.push(cells.length);
    }
  }
  if (bbCheck) parts.push('BB는 체크');
  // 이름을 붙일 소수 그룹: 가장 작은 non-check 그룹이 3곳 이하일 때 (BTN만 … 은 이미 이름이 들어 있습니다).
  let named: Digest['named'] = null;
  if (!btnOnlyHalf) {
    const smallest = [...entries].sort((x, y) => x[1].length - y[1].length)[0];
    if (smallest && smallest[1].length <= 3) named = { action: smallest[0], cells: smallest[1] };
  }
  return { text: parts.join(' · '), claims, nums, uniform: null, named };
}

/** 섹션의 reachable 칸이 전부 같은 답일 때의 한 줄. 비교 상대가 없는 칸 아래에 결론 대신 이것만 둡니다. */
export function uniformLine(sec: AtlasSection): Line | null {
  const d = digest(sec);
  if (!d.uniform) return null;
  const kind = sec.kind;
  const act = actWord(d.uniform, kind);
  const live = sec.cells.filter((c) => c.reachable);
  const n = live.length;
  const weak = live.filter((c) => c.weightClass === 'half' || c.weightClass === 'some');
  if (!weak.length) {
    // 섹션에 이 패로는 못 오는 칸이 있으면 '어느 자리에서나'가 그 칸까지 덮습니다(THEORY_SPEC §5) — 오는 칸의 수로 말합니다.
    // 앞 단계 액션을 섞어 드물게 오는 칸이 있으면 '오는'이 그 칸을 빼먹으니 '보통 오는'.
    if (n < sec.cells.length) return { text: `이 패가 ${sec.cells.some(isRare) ? '보통 ' : ''}오는 ${n}곳에서는 ${act}해요.`, claims: d.claims, nums: [n], source: 'computed' };
    return { text: `어느 자리에서나 ${act}해요.`, claims: d.claims, nums: [], source: 'computed' };
  }
  // 1순위는 다 같아도 절반만 하는 칸이 있으면 '어느 자리에서나 3벳해요'가 그 칸을 덮습니다(A3s 는 15곳 중 6곳이 절반).
  // 비중별로 칸 수를 댑니다: '9곳은 3벳하고, 5곳은 절반만 3벳하고, 1곳은 3벳과 콜을 반반 섞어요.' 세 마디를 넘으면 말하지 않습니다.
  type Clause = { k: number; mid: string | null; end: string; nums: number[] };
  const clauses: Clause[] = [];
  const strong = live.filter((c) => !weak.includes(c));
  if (strong.length) clauses.push({ k: strong.length, mid: `${act}하고`, end: `${act}해요`, nums: [] });
  const byKey = new Map<string, Clause>();
  const weakClause = (c: AtlasCell): { key: string; mid: string | null; end: string; nums: number[] } => {
    const sp = splitOf(c.mixList);
    if (sp) return { key: `split:${sp.join()}`, mid: null, end: splitPhrase(sp, kind, 'solo'), nums: [] };
    const p = pctInt(c.mixList[0].weight);
    if (c.weightClass === 'some') return { key: `some:${p}`, mid: `${p}%만 ${act}하고`, end: `${p}%만 ${act}해요`, nums: [p] };
    if (isTieMix(c)) {
      const pair = `${josa(act, '과/와')} ${josa(actWord(c.mixList[1].action, kind), '을/를')} 반반`;
      return { key: `tie:${c.mixList[1].action}`, mid: `${pair} 섞고`, end: `${pair} 섞어요`, nums: [] };
    }
    return { key: 'only', mid: `절반만 ${act}하고`, end: `절반만 ${act}해요`, nums: [] };
  };
  for (const c of weak) {
    const w = weakClause(c);
    const cl = byKey.get(w.key) ?? { k: 0, mid: w.mid, end: w.end, nums: w.nums };
    cl.k++;
    byKey.set(w.key, cl);
  }
  const weakClauses = [...byKey.values()].sort((x, y) => (x.mid === null ? 1 : y.mid === null ? -1 : y.k - x.k));
  if (weakClauses.filter((c) => c.mid === null).length > 1) return null;
  clauses.push(...weakClauses);
  if (clauses.length > 3) return null;
  const text = clauses.map((c, i) => `${c.k}곳은 ${i === clauses.length - 1 ? c.end : c.mid}`).join(', ');
  return { text: `${text}.`, claims: d.claims, nums: clauses.flatMap((c) => [c.k, ...c.nums]), source: 'computed' };
}

/** D. 섹션 한 줄 요약 (≤ 30자). */
export function sectionDigest(sec: AtlasSection): Line {
  const d = digest(sec);
  return { text: d.text, claims: d.claims, nums: d.nums, source: 'computed' };
}

/** D 의 두 번째 줄: 소수 그룹(≤ 3곳)의 칸 이름 — `콜 3곳: BTN vs SB · BTN vs BB · SB vs BB` (스트립이면 자리 이름만). */
export function sectionDigestDetail(sec: AtlasSection): Line | null {
  const d = digest(sec);
  if (!d.named) return null;
  const names = d.named.cells.map((c) => (c.scenario.villain ? `${c.scenario.hero} vs ${c.scenario.villain}` : c.scenario.hero));
  return {
    text: `${actWord(d.named.action, sec.kind)} ${d.named.cells.length}곳: ${names.join(' · ')}`,
    claims: d.named.cells.map(claimOf),
    nums: [d.named.cells.length],
    source: 'computed',
  };
}

/** T. rfi thesis — 1문장 + (always·never 면) 오픈 대응 한 문장. 각 문장이 Line 하나입니다. */
export function rfiThesis(atlas: HandAtlas): Line[] {
  const { hand, rfi } = atlas;
  const strip = atlas.sections.rfi;
  const cell = (pos: Pos) => cellAt(strip, pos)!;
  const subject = josa(hand, '은/는');
  const out: Line[] = [];
  const sbCell = cell('SB');
  // SB 절: primary(SB) ≠ primary(BTN) 일 때만 덧붙입니다.
  const sbClause = rfi.sbDiffers ? ` 단, SB에서는 ${weightPhrase(sbCell)}.` : '';
  const sbClaims = rfi.sbDiffers ? [claimOf(sbCell)] : [];

  switch (rfi.pattern) {
    case 'always': {
      if (!rfi.sbDiffers) {
        out.push({ text: `${subject} 어느 자리에서나 오픈해요.`, claims: strip.cells.map(claimOf), nums: [], source: 'computed' });
      } else {
        // 지금 데이터에는 없지만, SB 가 항상이 아니면 "어느 자리에서나"는 거짓입니다 — UTG~BTN 과 SB 를 나눠 말합니다.
        out.push({ text: `${subject} UTG부터 오픈해요.${sbClause}`, claims: [...CORE_SEATS.map((p) => claimOf(cell(p))), ...sbClaims], nums: [], source: 'computed' });
      }
      break;
    }
    case 'never':
      out.push({ text: `${subject} 어느 자리에서도 오픈하지 않아요.`, claims: strip.cells.map(claimOf), nums: [], source: 'computed' });
      break;
    case 'sbOnly': {
      // "SB에서만 절반만" 은 '만'이 겹칩니다. 두 절로 — 어디서 오픈하는지, 나머지는 폴드.
      const w = weightWord(sbCell);
      // '나머지는 폴드예요'는 비중어 바로 뒤라 "SB 의 나머지 절반"으로도 읽힙니다(THEORY_SPEC §5) — 자리라고 못 박습니다.
      out.push({ text: `${subject} SB에서 ${w.word ? `${w.word} ` : ''}오픈하고, 다른 자리에서는 폴드해요.`, claims: strip.cells.map(claimOf), nums: w.nums, source: 'computed' });
      break;
    }
    case 'entry': {
      const first = rfi.firstAny!;
      const before = CORE_SEATS.slice(0, CORE_SEATS.indexOf(first));
      const after = CORE_SEATS.slice(CORE_SEATS.indexOf(first));
      // 앞자리 폴드는 '부터'가 이미 말합니다 — 문장으로 되풀이하지 않습니다(claims 에는 남깁니다).
      out.push({
        text: `${subject} ${first}부터 오픈해요.${sbClause}`,
        claims: [...after.map((p) => claimOf(cell(p))), ...before.map((p) => claimOf(cell(p))), ...sbClaims],
        nums: [],
        source: 'computed',
      });
      break;
    }
    case 'half': {
      const start = CORE_SEATS.indexOf(rfi.firstAny!);
      const end = CORE_SEATS.indexOf(rfi.firstAlways!);
      const nums: number[] = [];
      const parts = CORE_SEATS.slice(start, end).map((p) => {
        const w = weightWord(cell(p));
        nums.push(...w.nums);
        return `${p}에서 ${w.word}`;
      });
      out.push({
        text: `${subject} ${parts.join(', ')}, ${rfi.firstAlways}부터는 항상 오픈해요.${sbClause}`,
        claims: [...CORE_SEATS.slice(start).map((p) => claimOf(cell(p))), ...sbClaims],
        nums,
        source: 'computed',
      });
      break;
    }
    case 'partial':
    case 'irregular': {
      // 전부 열거. '부터'·'어디서나' 금지.
      const opens = (p: Pos) => cell(p).mixList.some((m) => m.action === 'raise' && m.weight > EPS);
      const seats = CORE_SEATS.filter(opens);
      const nums: number[] = [];
      if (rfi.pattern === 'partial') {
        // SB 도 같이 — Q8o 는 BTN 과 SB 에서 절반씩 엽니다. SB 를 빼고 말하면 "SB 에서는 안 연다"로 읽힙니다.
        // (sbClause 는 SB·BTN 의 1순위가 다를 때만 붙으므로, SB 가 여기 들어오면 sbClause 는 비어 있습니다.)
        const all = opens('SB') ? [...seats, 'SB' as Pos] : seats;
        const words = all.map((p) => weightWord(cell(p)));
        words.forEach((w) => nums.push(...w.nums));
        // 같은 수식어끼리 묶습니다: "BTN과 SB에서 절반만" / "CO에서 주로, BTN과 SB에서 절반만".
        const groups: Array<{ word: string; seats: Pos[] }> = [];
        all.forEach((p, i) => {
          const last = groups[groups.length - 1];
          if (last && last.word === words[i].word) last.seats.push(p);
          else groups.push({ word: words[i].word, seats: [p] });
        });
        const parts = groups.map((g) => `${[...g.seats.slice(0, -1).map((p) => josa(p, '과/와')), g.seats[g.seats.length - 1]].join(' ')}에서 ${g.word}`);
        out.push({ text: `${subject} ${parts.join(', ')} 오픈하고, 다른 자리에서는 폴드해요.${sbClause}`, claims: [...all.map((p) => claimOf(cell(p))), ...sbClaims], nums, source: 'computed' });
      } else {
        out.push({ text: `${subject} ${seats.join('·')}에서만 오픈해요.${sbClause}`, claims: [...seats.map((p) => claimOf(cell(p))), ...sbClaims], nums, source: 'computed' });
      }
      break;
    }
  }

  if (rfi.pattern === 'always' || rfi.pattern === 'never') out.push(openResponseLine(atlas.sections.vs_open));
  return out;
}

const strongCell = (c: AtlasCell) => c.weightClass === 'always' || c.weightClass === 'most';

/**
 * rfiThesis 의 둘째 문장(오픈 대응). 감사: '앞에서 오픈하면 콜 2곳 · 폴드 13곳이에요'는 어느 칸인지 안 보였습니다.
 *  - 모든 칸이 같은 1순위이고 센 칸(> 50%)이면 '어디서나 X해요'. 절반 칸이 끼면 비교 없는 결론(uniformLine)과 같은 문장
 *    '앞에서 오픈하면 8곳은 3벳하고, 7곳은 3벳과 콜을 반반 섞어요.'(30자 안일 때), 넘치면 다이제스트로(비중까지 이름을 댑니다).
 *    다이제스트에 '이에요'를 붙이면 '…콜 25% 섞음이에요'처럼 명사형 '섞음'에 서술격이 붙어 어색했습니다.
 *  - 1순위가 두 가지이고 소수 쪽이 3곳 이하이며 한 자리(또는 한 오프너)에 모여 있으면 그 칸을 이름으로:
 *    '앞에서 오픈하면 BB에서 BTN·SB 오픈에 콜하고, 다른 곳은 폴드해요.' 다른 곳은 전부 센 칸이어야 합니다.
 *  - 그 밖은 다이제스트의 개수('콜 9곳 · 3벳 5곳 · 폴드 1곳') — 소수 칸 이름은 섹션 아래 줄이 댑니다.
 */
function openResponseLine(sec: AtlasSection): Line {
  const d = digest(sec);
  const live = sec.cells.filter((c) => c.reachable);
  if (d.uniform && live.every(strongCell)) return { text: `앞에서 오픈하면 어디서나 ${actWord(d.uniform, 'vs_open')}해요.`, claims: d.claims, nums: [], source: 'computed' };
  if (d.uniform) {
    const u = uniformLine(sec);
    const text = u ? `앞에서 오픈하면 ${u.text}` : '';
    if (u && hangulLen(text) <= SENTENCE_MAX_HANGUL) return { text, claims: u.claims, nums: u.nums, source: 'computed' };
  }
  const groups = new Map<Action, AtlasCell[]>();
  for (const c of live) groups.set(c.primary, [...(groups.get(c.primary) ?? []), c]);
  if (groups.size === 2) {
    const [minor, major] = [...groups.values()].sort((x, y) => x.length - y.length);
    const w0 = minor[0].weightClass;
    const plain = minor.every((c) => c.weightClass === w0 && !isTieMix(c) && !splitOf(c.mixList));
    if (minor.length <= 3 && minor.length < major.length && major.every(strongCell) && plain && w0 !== 'some') {
      const bySeat = (x: Pos, y: Pos) => POS_INDEX[x] - POS_INDEX[y];
      const heroes = [...new Set(minor.map((c) => c.scenario.hero))].sort(bySeat);
      const villains = [...new Set(minor.map((c) => c.scenario.villain!))].sort(bySeat);
      const where = heroes.length === 1 ? `${heroes[0]}에서 ${villains.join('·')} 오픈에` : villains.length === 1 ? `${villains[0]} 오픈에 ${heroes.join('·')}에서` : null;
      if (where) {
        const word = w0 === 'most' ? '주로 ' : w0 === 'half' ? '절반만 ' : '';
        const text = `앞에서 오픈하면 ${where} ${word}${actWord(minor[0].primary, 'vs_open')}하고, 다른 곳은 ${actWord(major[0].primary, 'vs_open')}해요.`;
        return { text, claims: d.claims, nums: [], source: 'computed' };
      }
    }
  }
  // 자리(행)마다 답이 하나이고 전부 센 칸이면 자리로 묶어서: '앞에서 오픈하면 CO·BTN·BB에서 콜하고, HJ·SB에서 폴드해요.'
  if (live.every(strongCell) && groups.size <= 3) {
    const rows = new Map<Pos, Action>();
    let uniformRows = true;
    for (const c of live) {
      const had = rows.get(c.scenario.hero);
      if (had && had !== c.primary) uniformRows = false;
      rows.set(c.scenario.hero, c.primary);
    }
    if (uniformRows) {
      const byAct = new Map<Action, Pos[]>();
      for (const [hero, a] of rows) byAct.set(a, [...(byAct.get(a) ?? []), hero]);
      const parts = [...byAct.entries()]
        .sort((x, y) => (x[0] === 'fold' ? 1 : y[0] === 'fold' ? -1 : aggression(y[0]) - aggression(x[0])))
        .map(([a, seats]) => ({ seats: seats.sort((x, y) => POS_INDEX[x] - POS_INDEX[y]).join('·'), act: actWord(a, 'vs_open') }));
      const text = `앞에서 오픈하면 ${parts.map((p, i) => `${p.seats}에서 ${p.act}${i === parts.length - 1 ? '해요' : '하고'}`).join(', ')}.`;
      return { text, claims: d.claims, nums: [], source: 'computed' };
    }
  }
  // 다이제스트가 명사형 '섞음'으로 끝나면 서술격('섞음이에요') 대신 동사로 맺습니다: '…3곳은 콜 25% 섞어요.'
  const end = d.text.endsWith('섞음') ? `${d.text.slice(0, -1)}어요` : josa(d.text, '이에요/예요');
  return { text: `앞에서 오픈하면 ${end}.`, claims: d.claims, nums: d.nums, source: 'computed' };
}

/**
 * C. 두 칸 비교. [결론 1~2문장] + differingLevers 텍스트(≤ 2). 줄 경계는 lineSentence 가 따로 말합니다(§5.3).
 * 같은 primary 면 결론 = "둘 다 {act}예요." + 혼합 차이 1줄. 축이 다르거나 미도달 칸이 끼면 빈 배열.
 */
export function compareCells(a: AtlasCell, b: AtlasCell): Line[] {
  const axis = compareAxis(a.scenario, b.scenario);
  if (axis === 'none' || !a.reachable || !b.reachable) return [];
  const kind = a.scenario.kind;
    const out: Line[] = [];
  const head = (c: AtlasCell) => (axis === 'hero' ? `${c.scenario.hero}에서는` : `${c.scenario.villain} ${VILLAIN_WORD[kind]}에는`);
  const where = (c: AtlasCell) => (axis === 'hero' ? `${c.scenario.hero}에서는` : `${c.scenario.villain} 상대로는`);
  const [B, A] = orderPair(a, b, axis);
  // 같은 primary 라도 한쪽은 '절반만', 한쪽은 항상이면 그 대비가 배울 점입니다("UTG에서 절반, HJ부터 항상") — 두 문장으로 말합니다.
  const halfContrast = A.primary === B.primary && [A.weightClass, B.weightClass].sort().join() === 'always,half';

  if (A.primary !== B.primary || halfContrast) {
    out.push({ text: `${head(B)} ${weightPhrase(B)}. ${head(A)} ${weightPhrase(A)}.`, claims: [claimOf(B), claimOf(A)], nums: [], source: 'computed' });
  } else {
    out.push({ text: `둘 다 ${josa(actWord(A.primary, kind), '이에요/예요')}.`, claims: [claimOf(B), claimOf(A)], nums: [], source: 'computed' });
    // 혼합이 다르면: 2순위 비중이 더 큰 쪽을 집어 말합니다.
    const altA = A.mixList[1];
    const altB = B.mixList[1];
    const wA = altA?.weight ?? 0;
    const wB = altB?.weight ?? 0;
    // 세 액션 칸(콜 50 / 3벳 25 / 폴드 25)이 끼면 2순위가 같아도(BB 콜 75 / 3벳 25) 섞는 모양이 다릅니다 — 그 칸을 집어 말합니다.
    const sig = (c: AtlasCell) => c.mixList.map((m) => `${m.action}${pctInt(m.weight)}`).join();
    const splitX = sig(A) !== sig(B) ? [B, A].find((c) => splitOf(c.mixList)) : undefined;
    const differ = Math.abs(wA - wB) >= 0.01 || altA?.action !== altB?.action || !!splitX;
    if (differ && (altA || altB)) {
      const X = splitX ?? (wB > wA || (wB === wA && B === a) ? B : A);
      const alt = X.mixList[1];
      const p = pctInt(alt.weight);
      // 세 액션 칸이면 2순위 하나만 말하면 3순위가 사라집니다 — 'CO에서는 3벳도 폴드도 25%씩 섞어요.'
      const alt2 = X.mixList[2];
      const both = splitOf(X.mixList) && alt2 && pctInt(alt2.weight) === p;
      out.push({
        text: both ? `${where(X)} ${actWord(alt.action, kind)}도 ${actWord(alt2.action, kind)}도 ${p}%씩 섞어요.` : `${where(X)} ${actWord(alt.action, kind)}도 ${p}% 섞어요.`,
        claims: [claimOf(X)],
        nums: [p],
        source: 'computed',
      });
    }
  }

  for (const lever of differingLevers(a, b)) {
    out.push({ text: lever.text, claims: [claimOf(a), claimOf(b)], nums: lever.nums, source: lever.constant ? 'constant' : 'computed' });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 탐색: 가까운 칸 · anchor · 퀴즈 키 · 미도달 문장                         */
/* ------------------------------------------------------------------ */

const dist = (x: Pos, y: Pos) => Math.abs(POS_INDEX[x] - POS_INDEX[y]);

/** 후보 중 가장 가까운 칸(동률이면 앞자리). */
function nearest(cands: AtlasCell[], seatOf: (c: AtlasCell) => Pos, from: Pos): AtlasCell | null {
  let best: AtlasCell | null = null;
  for (const c of cands) {
    if (!best) best = c;
    else {
      const d = dist(seatOf(c), from) - dist(seatOf(best), from);
      if (d < 0 || (d === 0 && POS_INDEX[seatOf(c)] < POS_INDEX[seatOf(best)])) best = c;
    }
  }
  return best;
}

/**
 * 같은 kind 안에서 primary === action 인 가장 가까운 reachable 칸.
 * 우선순위: hero 축(같은 villain, |POS_INDEX 차| 최소, 동률이면 앞자리) → villain 축(같은 hero). 없으면 null.
 */
export function nearestCellWithAction(from: Scenario, hand: HandName, action: Action): Scenario | null {
  const sec = handAtlas(hand).sections[from.kind];
  const live = sec.cells.filter((c) => c.reachable && c.primary === action);
  const heroAxis = live.filter((c) => c.scenario.villain === from.villain && c.scenario.hero !== from.hero);
  const h = nearest(heroAxis, (c) => c.scenario.hero, from.hero);
  if (h) return h.scenario;
  if (!from.villain) return null;
  const villainAxis = live.filter((c) => c.scenario.hero === from.hero && c.scenario.villain !== from.villain);
  const v = nearest(villainAxis, (c) => c.scenario.villain!, from.villain);
  return v ? v.scenario : null;
}

/**
 * 비교 상대 자동 규칙(§5.3). rfi 스트립 → `firstAlways ?? firstAny` 의 타일, 선택이 그 타일이면 바로 앞 자리(UTG 면 HJ).
 * 삼각형 → ① 같은 열(hero 축)에서 primary 가 다른 가장 가까운 reachable 칸(동률이면 앞자리) ② 없으면 같은 행(villain 축)
 * ③ 없으면 null. 림프·콜드 스트립 → ① 과 같음. 미도달 칸은 후보가 아닙니다.
 */
export function anchorCell(atlas: HandAtlas, cell: AtlasCell): AtlasCell | null {
  if (!cell.reachable) return null;
  const sec = atlas.sections[cell.scenario.kind];
  const hero = cell.scenario.hero;
  if (sec.kind === 'rfi') {
    const target = atlas.rfi.firstAlways ?? atlas.rfi.firstAny;
    const prev = (p: Pos): Pos => (p === 'UTG' ? 'HJ' : sec.rows[sec.rows.indexOf(p) - 1]);
    const pick = target && target !== hero ? target : prev(hero);
    return cellAt(sec, pick) ?? null;
  }
  const live = sec.cells.filter((c) => c.reachable && c !== cell && c.primary !== cell.primary);
  const column = live.filter((c) => c.scenario.villain === cell.scenario.villain);
  const byHero = nearest(column, (c) => c.scenario.hero, hero);
  if (byHero) return byHero;
  if (!cell.scenario.villain) return null;
  const row = live.filter((c) => c.scenario.hero === hero);
  return nearest(row, (c) => c.scenario.villain!, cell.scenario.villain);
}

/**
 * 퀴즈 키. 후보 = reachable 칸 ∩ (그 섹션에 primary 가 2종 이상, 또는 그 칸 자체가 혼합). vs_limp BB 는 제외(체크 답은 12문제 묶음에서 혼란).
 * 섹션이 전부 같은 답이라도 절반만 하는 칸(KJo 의 rfi:UTG)은 배울 게 있어서 남깁니다 — 스펙 §5.6 ①의 12문제가 그걸 첫 문제로 듭니다.
 * 우선순위: weightClass !== 'always' → 섹션 안 소수 primary → 나머지. 기본 max 12.
 */
export function atlasQuizKeys(atlas: HandAtlas, opts?: { max?: number }): CardKey[] {
  const max = opts?.max ?? 12;
  const ranked: Array<{ key: CardKey; tier: number; order: number }> = [];
  let order = 0;
  for (const kind of SECTION_ORDER) {
    const sec = atlas.sections[kind];
    const live = sec.cells.filter((c) => c.reachable && !(kind === 'vs_limp' && c.scenario.hero === 'BB'));
    const counts = new Map<Action, number>();
    for (const c of live) counts.set(c.primary, (counts.get(c.primary) ?? 0) + 1);
    const top = Math.max(...counts.values());
    for (const c of live) {
      if (counts.size < 2 && c.weightClass === 'always') continue;
      const tier = c.weightClass !== 'always' ? 0 : (counts.get(c.primary) ?? 0) < top ? 1 : 2;
      ranked.push({ key: c.key, tier, order: order++ });
    }
  }
  return ranked
    .sort((x, y) => x.tier - y.tier || x.order - y.order)
    .slice(0, max)
    .map((x) => x.key);
}

/**
 * G. 미도달 칸을 눌렀을 때의 한 줄. 화면 전용 문자열(Line 이 아닙니다 — 이 칸의 차트 답은 말하지 않습니다).
 * 앞 단계 액션의 비중이 0이면 '…하지 않으니 … 일이 없어요', 0보다 크면(1순위가 아니라 문제로는 안 나오는 드문 칸) 그 비중을 댑니다:
 * 'UTG 오픈에 3벳은 25%만 하니, 4벳은 그때만 받아요.'
 */
export function gateText(cell: AtlasCell): string | null {
  const g = cell.gate;
  if (!g) return null;
  const { hero, villain } = cell.scenario;
  if (g.weight > EPS) {
    const p = pctInt(g.weight);
    if (g.kind === 'rfi') return `${hero}에서 오픈은 ${p}%만 하니, 이 상황은 그때만 생겨요.`;
    if (g.kind === 'vs_3bet') return `${hero}에서 ${villain} 3벳에 4벳은 ${p}%만 하니, 올인은 그때만 받아요.`;
    return `${villain} 오픈에 3벳은 ${p}%만 하니, 4벳은 그때만 받아요.`;
  }
  if (g.kind === 'rfi') return `${hero}에서 오픈하지 않으니 이 상황은 안 생겨요.`;
  if (g.kind === 'vs_3bet') return `${hero}에서 4벳하지 않으니 올인을 받을 일이 없어요.`;
  return `${villain} 오픈에 3벳하지 않으니 4벳을 받을 일이 없어요.`;
}

/** 범례의 게이트 말: [안 함, 비중 p 만 함, 둘 다]. */
const GATE_WORDS: Partial<Record<ScenarioKind, { never: string; rare: (p: string) => string; both: (p: string) => string }>> = {
  rfi: { never: '오픈하지 않는', rare: (p) => `오픈을 ${p}만 하는`, both: (p) => `오픈하지 않거나 ${p}만 하는` },
  vs_open: { never: '그 오픈에 3벳하지 않는', rare: (p) => `그 오픈에 3벳을 ${p}만 하는`, both: (p) => `그 오픈에 3벳하지 않거나 ${p}만 하는` },
  vs_3bet: { never: '4벳하지 않는', rare: (p) => `4벳을 ${p}만 하는`, both: (p) => `4벳하지 않거나 ${p}만 하는` },
};

/**
 * 섹션 아래 범례 한 줄('—' 칸이 왜 '—'인지). 드문 칸(앞 단계 액션을 섞는 칸)이 있으면 '안 생기는 칸'이라고 하지 않고 비중을 댑니다:
 * '— 표시: 그 오픈에 3벳하지 않거나 25%만 하는 자리라서 안 생기거나 드물게만 생기는 칸'. 미도달 칸이 없으면 null.
 */
export function gateLegend(sec: AtlasSection): string | null {
  const byKind = new Map<ScenarioKind, AtlasCell[]>();
  for (const c of sec.cells) if (!c.reachable && c.gate) byKind.set(c.gate.kind, [...(byKind.get(c.gate.kind) ?? []), c]);
  if (!byKind.size) return null;
  let anyNever = false;
  let anyRare = false;
  const reasons: string[] = [];
  for (const [kind, cells] of byKind) {
    const words = GATE_WORDS[kind];
    if (!words) continue;
    const rare = cells.filter(isRare);
    const never = rare.length < cells.length;
    const ps = [...new Set(rare.map((c) => pctInt(c.gate!.weight)))];
    const p = ps.length === 1 ? `${ps[0]}%` : '일부';
    anyNever ||= never;
    anyRare ||= rare.length > 0;
    reasons.push(`${!rare.length ? words.never : never ? words.both(p) : words.rare(p)} 자리`);
  }
  if (!reasons.length) return null;
  const tail = anyNever && anyRare ? '안 생기거나 드물게만 생기는 칸' : anyRare ? '드물게만 생기는 칸' : '안 생기는 칸';
  return `— 표시: ${reasons.join('거나 ')}라서 ${tail}`;
}

/* ------------------------------------------------------------------ */
/* 책과 다른 점(패 단위) — 올인 대응 · 콜드 4벳                              */
/* ------------------------------------------------------------------ */

/** 책 5장 3절: 5벳 올인을 받으면 TT 이상과 AK 가 콜하고, BTN 은 66 이상과 AK 까지. */
const BOOK_5BET_CALL = new Set<HandName>(['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs', 'AKo']);
const BOOK_5BET_CALL_BTN = new Set<HandName>([...BOOK_5BET_CALL, '99', '88', '77', '66']);

/**
 * 자리별 보기의 올인 대응 · 콜드 4벳 섹션 아래 '책과 다른 점' 한 줄(THEORY_SPEC §7). 이 패의 도달 칸에서 차트가 책과 다를 때만:
 *  - vs_5bet: 책이 콜하는 패(TT 이상 · AK, BTN 은 66 이상)인데 차트가 늘 콜하지는 않는 칸 —
 *    '책은 올인에 TT 이상과 AK가 콜한다고 해요. 이 차트는 QQ를 4곳에서 폴드, 4곳에서 절반만 콜, 2곳에서 주로 콜해요.'
 *  - cold_4bet: 책은 대부분 4벳 아니면 폴드(콜하면 내 패 정보가 새고 뒷사람이 싸게 들어와요) — 차트가 콜을 섞는 칸이 있을 때만
 *    '책은 오픈과 3벳 사이에 끼면 대부분 4벳 아니면 폴드라고 해요. 이 차트는 4곳에서 JJ를 콜하기도 해요.'
 * 그 밖의 섹션 · 다른 점이 없는 패는 null.
 */
export function bookDiffLine(atlas: HandAtlas, kind: ScenarioKind): string | null {
  const { hand } = atlas;
  const sec = atlas.sections[kind];
  const live = sec.cells.filter((c) => c.reachable);
  if (kind === 'vs_5bet') {
    const bookCalls = (c: AtlasCell) => (c.scenario.hero === 'BTN' ? BOOK_5BET_CALL_BTN : BOOK_5BET_CALL).has(hand);
    const differ = live.filter((c) => bookCalls(c) && !(c.primary === 'call' && c.weightClass === 'always'));
    if (!differ.length) return null;
    const btnOnly = differ.every((c) => c.scenario.hero === 'BTN') && !BOOK_5BET_CALL.has(hand);
    const head = btnOnly ? '책은 BTN이 올인에 66 이상과 AK로 콜한다고 해요.' : '책은 올인에 TT 이상과 AK가 콜한다고 해요.';
    const byLabel = new Map<string, number>();
    for (const c of differ) {
      const l = soloLabel(c).text;
      byLabel.set(l, (byLabel.get(l) ?? 0) + 1);
    }
    const order = (l: string) => (l.endsWith('폴드') ? 0 : 1);
    const parts = [...byLabel.entries()].sort((x, y) => order(x[0]) - order(y[0]) || y[1] - x[1]).map(([l, n]) => `${n}곳에서 ${l}`);
    return `${head} 이 차트는 ${josa(hand, '을/를')} ${parts.join(', ')}해요.`;
  }
  if (kind === 'cold_4bet') {
    const calls = live.filter((c) => c.mixList.some((m) => m.action === 'call' && m.weight > EPS));
    if (!calls.length) return null;
    return `책은 오픈과 3벳 사이에 끼면 대부분 4벳 아니면 폴드라고 해요. 이 차트는 ${calls.length}곳에서 ${josa(hand, '을/를')} 콜하기도 해요.`;
  }
  return null;
}
