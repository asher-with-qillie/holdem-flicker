import { getChartCells, getChartDef, hasChart } from './data';
import { ALL_HANDS, dealRandomHand, dealWeightedHand, gridHand, pick, random } from './hands';
import { continueWeights, fullMix, primaryAction } from './range';
import { allScenarios, positionsAfter, positionsBefore } from './scenarios';
import { POSITIONS, POS_INDEX, type Action, type ActionMix, type ChartCells, type ChartDef, type HandName, type Pos, type Scenario, type ScenarioKind } from './types';

export interface Step {
  scenario: Scenario;
  hand: HandName;
  chart: ChartDef;
  cells: ChartCells;
  mix: ActionMix | undefined;
  /** The action to memorize. */
  answer: Action;
  /** Full mix incl. fold, sorted by weight. */
  mixList: Array<{ action: Action; weight: number }>;
  /** Index of this step within its hand sequence and the total count. */
  index: number;
  total: number;
}

export interface SessionOptions {
  positions: Pos[];
  kinds: ScenarioKind[];
  /** Include the cold 4-bet line (opener + 3-bettor in front). */
  /** 0..1: probability of dealing a hand from hero's "interesting" (non-fold somewhere) set; the rest is boundary-weighted (`boundaryTable`). */
  interestingBias: number;
}

export const DEFAULT_SESSION_OPTIONS: SessionOptions = {
  positions: [...POSITIONS],
  kinds: ['rfi', 'vs_open', 'vs_3bet', 'vs_4bet', 'vs_5bet'],
  interestingBias: 0.6,
};

function makeStep(scenario: Scenario, hand: HandName): Step | null {
  if (!hasChart(scenario)) return null;
  const chart = getChartDef(scenario);
  const cells = getChartCells(scenario);
  const mix = cells[hand];
  return { scenario, hand, chart, cells, mix, answer: primaryAction(mix), mixList: fullMix(mix), index: 0, total: 0 };
}

/** Union of non-fold weights across every chart where `hero` acts. */
export function interestingWeights(hero: Pos): Record<HandName, number> {
  const out: Record<HandName, number> = {};
  const scenarios: Scenario[] = [];
  if (hero !== 'BB') scenarios.push({ kind: 'rfi', hero });
  for (const v of positionsBefore(hero)) scenarios.push({ kind: 'vs_open', hero, villain: v });
  // 림프 대응도 넣습니다. BB 는 rfi 차트가 없어서 이게 없으면 표본이 vs_open 수비 레인지(아주 넓고
  // 콜 위주)만으로 뽑혀, 림프만 연습하는 세션이 정작 올리는 쪽 패를 잘 안 내보냅니다.
  if (hero !== 'UTG') scenarios.push({ kind: 'vs_limp', hero });
  for (const s of scenarios) {
    if (!hasChart(s)) continue;
    const w = continueWeights(getChartCells(s));
    for (const h of ALL_HANDS) if (w[h]) out[h] = Math.max(out[h] ?? 0, w[h]);
  }
  return out;
}

/**
 * Build the ordered list of decision steps for one dealt hand:
 *  Line A (hero opens): rfi → vs_3bet (random later villain) → vs_5bet
 *  Line B (hero faces an open): vs_open (random earlier villain) → vs_4bet
 *  Line C: cold_4bet (random opener + 3-bettor in front)
 *  Line D: vs_limp (한 명이 림프한 뒤 hero 차례) — 다른 줄기와 이어지지 않는 별개의 손패입니다.
 * Later steps in a line only appear when the memorized answer of the previous step continues aggressively.
 */
export function buildSteps(hero: Pos, hand: HandName, opts: SessionOptions, rng: () => number = random): Step[] {
  const kinds = new Set(opts.kinds);
  const steps: Step[] = [];
  const pickFrom = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

  // Line A
  if (hero !== 'BB') {
    let opened = false;
    if (kinds.has('rfi')) {
      const s = makeStep({ kind: 'rfi', hero }, hand);
      if (s) {
        steps.push(s);
        opened = s.answer === 'raise';
      }
    } else {
      const rfi = hasChart({ kind: 'rfi', hero }) ? getChartCells({ kind: 'rfi', hero })[hand] : undefined;
      opened = !!rfi?.raise;
    }
    const after = positionsAfter(hero);
    if (opened && after.length && (kinds.has('vs_3bet') || kinds.has('vs_5bet'))) {
      const villain = pickFrom(after);
      let fourBet = false;
      if (kinds.has('vs_3bet')) {
        const s = makeStep({ kind: 'vs_3bet', hero, villain }, hand);
        if (s) {
          steps.push(s);
          fourBet = s.answer === 'fourbet';
        }
      } else if (hasChart({ kind: 'vs_3bet', hero, villain })) {
        fourBet = !!getChartCells({ kind: 'vs_3bet', hero, villain })[hand]?.fourbet;
      }
      if (fourBet && kinds.has('vs_5bet')) {
        const s = makeStep({ kind: 'vs_5bet', hero, villain }, hand);
        if (s) steps.push(s);
      }
    }
  }

  // Line B
  const before = positionsBefore(hero);
  if (before.length && (kinds.has('vs_open') || kinds.has('vs_4bet'))) {
    const villain = pickFrom(before);
    let threeBet = false;
    if (kinds.has('vs_open')) {
      const s = makeStep({ kind: 'vs_open', hero, villain }, hand);
      if (s) {
        steps.push(s);
        threeBet = s.answer === 'threebet';
      }
    } else if (hasChart({ kind: 'vs_open', hero, villain })) {
      threeBet = !!getChartCells({ kind: 'vs_open', hero, villain })[hand]?.threebet;
    }
    if (threeBet && kinds.has('vs_4bet')) {
      const s = makeStep({ kind: 'vs_4bet', hero, villain }, hand);
      if (s) steps.push(s);
    }
  }

  // Line C
  if (kinds.has('cold_4bet') && POS_INDEX[hero] >= 2) {
    const opener = pickFrom(before.slice(0, -1));
    const threeBettor = pickFrom(before.filter((p) => POS_INDEX[p] > POS_INDEX[opener]));
    const s = makeStep({ kind: 'cold_4bet', hero, extras: { opener, threeBettor } }, hand);
    if (s) steps.push(s);
  }

  // Line D — 림프는 앞의 어떤 줄기와도 이어지지 않습니다(오픈이 없었으니 3벳도 없습니다).
  // 림퍼 자리는 화면에만 쓰고 차트는 hero 만 봅니다. SB 는 림퍼로 뽑지 않습니다 — 이 앱의
  // rfi:SB 차트가 'SB 는 레이즈 아니면 폴드'라고 말하고 있어서, SB 가 림프하는 문제를 내면
  // 앱이 스스로와 모순됩니다.
  if (kinds.has('vs_limp') && hero !== 'UTG') {
    const limpers = before.filter((p) => p !== 'SB');
    if (limpers.length) {
      const limper = pickFrom(limpers);
      const s = makeStep({ kind: 'vs_limp', hero, extras: { limper } }, hand);
      if (s) steps.push(s);
    }
  }

  steps.forEach((s, i) => {
    s.index = i;
    s.total = steps.length;
  });
  return steps;
}

/** Can `hero` ever produce a step of `kind`? */
export function heroCanPlay(hero: Pos, kind: ScenarioKind): boolean {
  switch (kind) {
    case 'rfi':
    case 'vs_3bet':
    case 'vs_5bet':
      return hero !== 'BB';
    case 'vs_open':
    case 'vs_4bet':
      return hero !== 'UTG';
    case 'cold_4bet':
      return POS_INDEX[hero] >= 2;
    case 'vs_limp':
      return hero !== 'UTG';
  }
}

/** Positions from `opts` that can produce at least one enabled kind. */
export function feasiblePositions(opts: SessionOptions): Pos[] {
  const positions = opts.positions.length ? opts.positions : [...POSITIONS];
  return positions.filter((p) => opts.kinds.some((k) => heroCanPlay(p, k)));
}

/*
 * 경계 가중치 — 균등 딜을 대신합니다(학습효과 보고서 §3-9).
 *
 * 예전에는 interestingBias 의 나머지(기본 40%)를 1,326콤보에서 균등하게 뽑았습니다. 그 몫의 78%가
 * 폴드라서 첫 세션 카드의 절반 넘게(약 55%)가 '폴드·체크가 정답'이었고, 64o·94o 같은 패가 rfi→오픈 대응→림프
 * 대응 체인으로 두세 장씩 나왔습니다. 외울 것이 없는 카드입니다. 표를 외운다는 건 결국 '어디서 액션이
 * 바뀌는지'를 외우는 것이므로, 그 자리(경계)를 자주 내고 안쪽은 덜 냅니다.
 *
 *   · 경계 칸   ×3 — 13×13 표에서 위·아래·왼쪽·오른쪽(페어는 대각선의 이웃 페어도) 칸과 주 액션이 다른 칸.
 *                    경계 바로 바깥의 폴드 칸도 여기 들어갑니다 — 진짜 쓸모 있는 '폴드' 예시입니다.
 *   · 혼합 칸   ×1 — 1순위 비중이 0.6 미만(반반·절반만). 경계에 있어도 ×3 을 주지 않습니다. 두 답이 거의
 *                    같은 값어치라, 자주 내면 동전 던지기에 연습 시간을 씁니다.
 *   · 안쪽 비폴드 ×1 — 이웃이 모두 같은 액션인 레이즈·콜 칸.
 *   · 안쪽 폴드  0 — 대신 딜의 NEGATIVE_FLOOR(10%)만 이 칸들에서 뽑아 '이건 그냥 버린다'는 예시가 사라지지
 *                    않게 합니다. 보고서는 '첫 주만 10%, 그 뒤 0'을 권하지만 SessionOptions 에는 첫 주 신호가
 *                    없어서(그건 srs 의 activeDays) 고정 바닥값으로 둡니다.
 *
 * 패 하나의 가중치는 hero 가 첫 결정을 내리는 차트(rfi·오픈 대응·림프 대응·콜드 4벳 중 켜진 종류) 전부에서
 * 본 값의 최댓값입니다 — interestingWeights 와 같은 방식입니다. 체크(빅블라인드가 림프를 받은 경우)는 폴드와
 * 같은 '안 들어가는' 쪽으로 셉니다. 차트는 고정 데이터라 hero × 종류 조합마다 한 번만 계산해 둡니다.
 */

/** 경계 칸에 주는 배수. */
export const BOUNDARY_WEIGHT = 3;
/** 경계 가중 딜 중 '안쪽 폴드' 칸에서 뽑는 몫. 음성 예시용 바닥값. */
export const NEGATIVE_FLOOR = 0.1;
/** 1순위 비중이 이보다 낮으면 혼합 칸(§2.2 의 '주로' 기준과 같음). */
const MIXED_BELOW = 0.6;
/** hero 의 첫 결정이 되는 종류 — 뒤 스텝(3벳·4벳·5벳 대응)은 buildSteps 가 도달할 때만 붙입니다. */
const ROOT_KINDS: readonly ScenarioKind[] = ['rfi', 'vs_open', 'vs_limp', 'cold_4bet'];

const isPassive = (a: Action) => a === 'fold' || a === 'check';

/** 13×13 표에서 (row, col) 의 이웃 칸 — 상하좌우, 페어는 대각선의 이웃 페어까지. */
function neighbours(row: number, col: number): HandName[] {
  const out: HandName[] = [];
  const at = (r: number, c: number) => {
    if (r >= 0 && r < 13 && c >= 0 && c < 13) out.push(gridHand(r, c));
  };
  at(row - 1, col);
  at(row + 1, col);
  at(row, col - 1);
  at(row, col + 1);
  if (row === col) {
    at(row - 1, col - 1);
    at(row + 1, col + 1);
  }
  return out;
}

/** 한 차트 안에서 칸 하나의 딜 가중치: 경계 ×3, 혼합·안쪽 비폴드 ×1, 안쪽 폴드·체크 0. */
export function cellDealWeight(cells: ChartCells, row: number, col: number): number {
  const mix = cells[gridHand(row, col)];
  const list = fullMix(mix);
  const top = list[0] ?? { action: 'fold' as Action, weight: 1 };
  if (top.weight < MIXED_BELOW) return 1;
  const boundary = neighbours(row, col).some((h) => primaryAction(cells[h]) !== top.action);
  if (boundary) return BOUNDARY_WEIGHT;
  return isPassive(top.action) ? 0 : 1;
}

export interface BoundaryTable {
  /** 경계·혼합·비폴드 칸의 가중치(0 인 패는 빠짐). */
  weights: Record<HandName, number>;
  /** 켜진 모든 첫 결정 차트에서 안쪽 폴드·체크인 패 — NEGATIVE_FLOOR 몫을 여기서 뽑습니다. */
  negatives: Record<HandName, number>;
}

const boundaryMemo = new Map<string, BoundaryTable>();

/**
 * hero 의 경계 가중치 표. `kinds` 중 첫 결정 종류의 차트만 봅니다(rfi 만 켜면 오픈 표의 경계만).
 * 켜진 첫 결정 종류가 없으면(3벳 대응만 켠 경우 등) hero 의 모든 첫 결정 차트로 계산합니다.
 */
export function boundaryTable(hero: Pos, kinds: readonly ScenarioKind[]): BoundaryTable {
  const roots = ROOT_KINDS.filter((k) => kinds.includes(k));
  const use = roots.length ? roots : ROOT_KINDS;
  const memoKey = `${hero}|${use.join(',')}`;
  const memo = boundaryMemo.get(memoKey);
  if (memo) return memo;
  const charts = allScenarios()
    .filter((s) => s.hero === hero && use.includes(s.kind) && hasChart(s))
    .map((s) => getChartCells(s));
  const weights: Record<HandName, number> = {};
  const negatives: Record<HandName, number> = {};
  if (charts.length) {
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        let w = 0;
        for (const cells of charts) w = Math.max(w, cellDealWeight(cells, r, c));
        if (w > 0) weights[gridHand(r, c)] = w;
        else negatives[gridHand(r, c)] = 1;
      }
    }
  }
  const table = { weights, negatives };
  boundaryMemo.set(memoKey, table);
  return table;
}

/** Deal a hand for `hero`: `interestingBias` → playable-somewhere weighted, else boundary-weighted (`boundaryTable`). */
export function dealForHero(hero: Pos, opts: SessionOptions, rng: () => number = random): HandName {
  const kinds = new Set(opts.kinds);
  // If only "later" scenarios are trained, sample from the range that reaches them.
  const onlyLater = !kinds.has('rfi') && !kinds.has('vs_open') && !kinds.has('cold_4bet');
  if (onlyLater) {
    if ((kinds.has('vs_3bet') || kinds.has('vs_5bet')) && hero !== 'BB' && hasChart({ kind: 'rfi', hero })) {
      const h = dealWeightedHand(continueWeights(getChartCells({ kind: 'rfi', hero })), rng);
      if (h) return h;
    }
    if (kinds.has('vs_4bet') && hero !== 'UTG') {
      const villain = pick(positionsBefore(hero), rng);
      if (hasChart({ kind: 'vs_open', hero, villain })) {
        const h = dealWeightedHand(continueWeights(getChartCells({ kind: 'vs_open', hero, villain }), ['threebet']), rng);
        if (h) return h;
      }
    }
  }
  if (rng() < opts.interestingBias) {
    const h = dealWeightedHand(interestingWeights(hero), rng);
    if (h) return h;
  }
  const table = boundaryTable(hero, opts.kinds);
  if (rng() < NEGATIVE_FLOOR) {
    const h = dealWeightedHand(table.negatives, rng);
    if (h) return h;
  }
  return dealWeightedHand(table.weights, rng) ?? dealRandomHand(rng);
}

/** 그 스텝의 칸이 자기 차트에서 받는 딜 가중치(`cellDealWeight`). 0 = 안쪽 폴드·체크. */
function stepDealWeight(s: Step): number {
  const i = ALL_HANDS.indexOf(s.hand);
  return cellDealWeight(s.cells, Math.floor(i / 13), i % 13);
}

/**
 * 한 손패의 스텝 목록을 다듬습니다(§3-9 제안 2). buildSteps 의 줄기(A·B·C·D)와 '앞 답이 이어질 때만 뒤 스텝'
 * 규칙은 그대로이고, 빼기만 합니다.
 *
 *   · 모든 답이 폴드·체크 → 한 장만. 64o 를 rfi·오픈 대응·림프 대응으로 세 번 물어도 배우는 건 '아무 데서나
 *     폴드' 하나뿐입니다. 남기는 한 장은 자기 차트에서 경계인 스텝(액션이 바뀌기 직전의 폴드라 가장 쓸모 있는
 *     음성 예시), 없으면 첫 스텝입니다.
 *   · 그 밖에는 뿌리 스텝(rfi·오픈 대응·림프 대응·콜드 4벳)이 자기 차트의 안쪽 폴드·체크인 줄기만 뺍니다. 그런
 *     뿌리는 뒤 스텝이 없으니 한 장짜리 줄기입니다. 실제로 도달하는 뒤 스텝('오픈했다가 3벳에 폴드')은
 *     남깁니다 — 상황이 바뀌며 답이 갈리는 대조가 체인의 쓸모입니다.
 */
export function pruneSteps(steps: Step[]): Step[] {
  if (steps.length < 2) return steps;
  let out: Step[];
  if (steps.every((s) => isPassive(s.answer))) out = [steps.find((s) => stepDealWeight(s) === BOUNDARY_WEIGHT) ?? steps[0]];
  else out = steps.filter((s) => !(ROOT_KINDS.includes(s.scenario.kind) && stepDealWeight(s) === 0));
  if (out.length === steps.length) return steps;
  return out.map((s, index) => ({ ...s, index, total: out.length }));
}

/**
 * Produce the next hand sequence (hero + hand + steps) honouring `opts.kinds` and `opts.positions`.
 * The hand is boundary-weighted (`dealForHero`) and the steps are `buildSteps` trimmed by `pruneSteps`.
 * `steps` is empty only when the settings cannot produce any step at all (e.g. positions=[BB], kinds=[rfi]).
 */
export function nextHandSequence(opts: SessionOptions, rng: () => number = random): { hero: Pos; hand: HandName; steps: Step[] } {
  const positions = feasiblePositions(opts);
  if (!positions.length) {
    const hero = opts.positions[0] ?? 'BTN';
    return { hero, hand: dealRandomHand(rng), steps: [] };
  }
  let last: { hero: Pos; hand: HandName; steps: Step[] } | null = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    const hero = pick(positions, rng);
    const hand = dealForHero(hero, opts, rng);
    const steps = pruneSteps(buildSteps(hero, hand, opts, rng));
    last = { hero, hand, steps };
    if (steps.length) return last;
  }
  return last!;
}

/** Produce a single random step for quiz mode (only enabled scenario kinds). Throws if the settings allow none. */
export function randomQuizStep(opts: SessionOptions, rng: () => number = random): Step {
  for (let attempt = 0; attempt < 20; attempt++) {
    const seq = nextHandSequence(opts, rng);
    if (seq.steps.length) return pick(seq.steps, rng);
  }
  throw new Error('No scenario matches the current settings');
}

/** Build a standalone step for any scenario + hand (used by the chart browser and quiz). Throws if no chart. */
export function stepFor(scenario: Scenario, hand: HandName): Step {
  const s = makeStep(scenario, hand);
  if (!s) throw new Error(`No chart for ${scenario.kind} ${scenario.hero} ${scenario.villain ?? ''}`);
  s.total = 1;
  return s;
}
