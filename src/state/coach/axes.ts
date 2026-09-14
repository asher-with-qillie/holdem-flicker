/**
 * 성향 축 네 개의 계산. 계산식과 근거는 docs/COACH_SPEC.md §1.
 *
 * 이 파일이 하는 일은 사실상 하나입니다 — **귀무값을 0으로 만드는 것**. 출제 풀은 정답의 절반
 * 이상이 폴드이고 비폴드 패가 더 자주 뽑힙니다. 그래서 실수를 그냥 세서 비율을 내면 성향이 없는
 * 사람에게도 "루즈합니다"가 나옵니다. 그건 잡음이 아니라 계산 가능한 거짓말이라 축마다 기준선을
 * 따로 잡았습니다.
 *   - `aggression` : 오답 선택지 둘 중 어느 쪽을 골랐는지만 보는 부호 검정. 정답이 무엇이었든
 *     무작위로 틀리는 사람은 E[u]=0 이라 출제 분포가 통째로 상쇄됩니다. 기준선이 필요 없는 유일한 축.
 *   - 나머지 셋 : 내가 실제로 받은 문제(`seen`)의 폴드-정답 비중을 기준선으로 깔고 편차만 봅니다.
 *     `seat` · `pressure` 는 그 편차의 **차이**라 좌석·상황별 차트 난이도 차이에도 오염되지 않습니다.
 *
 * 순수 함수입니다. 저장소도 시계도 읽지 않습니다 — 재료는 digest.ts 가 모아서 넘깁니다.
 * `pure()` 필터(부분 정답이 가능한 문제 제외)도 digest.ts 가 이미 양쪽에 걸어서 넘깁니다.
 */
import { SCENARIO_ACTIONS, type Pos, type ScenarioKind } from '../../poker/types';
import type { AxisId, AxisLevel, AxisLock, AxisView, CoachMistake, SeenRow } from './types';

/** SB·BB 는 seat 축에서 완전히 제외합니다 — BB 는 rfi 자체가 없고 수비 자리라 BTN 과 성격이 정반대입니다. */
const EARLY: readonly Pos[] = ['UTG', 'HJ'];
const LATE: readonly Pos[] = ['CO', 'BTN'];

const OPEN: readonly ScenarioKind[] = ['rfi', 'vs_open'];
const HEAT: readonly ScenarioKind[] = ['vs_3bet', 'vs_4bet', 'vs_5bet', 'cold_4bet'];

/** seat·pressure 의 t 는 편차 차이를 이 폭으로 나눠 −1..+1 에 눕힙니다(SPEC §1). */
const DIFF_SCALE = 0.5;

/**
 * 기준선 표본 하한 = 그 축의 `minSample` × 이 값.
 *
 * 기준선 b 도 **추정값**입니다. 그런데 z 는 b 를 아는 값으로 놓고 실수 쪽 분산만 셉니다
 * (Var(q̂−b) = b(1−b)/|M|). 실제로는 Var(q̂−b̂) = b(1−b)·(1/|M| + 1/N) 이라, N 이 |M| 만 하면
 * 분산을 절반만 세고 z 를 √2 배로 부풀리는 셈입니다. N ≥ 4·minSample 이면 빼먹은 항이 1/4 아래라
 * 과장이 12% 안에 듭니다.
 *
 * 눈으로 읽는 쪽도 같은 숫자로 풀립니다. b 의 표준오차는 최대 0.5/√N 이고 t 는 그걸
 * max(b,1−b) ≥ 0.5 로 나누므로, **기준선의 잡음만으로 마커가 움직이는 폭이 1/√N** 입니다.
 * entry 의 하한 80 이면 0.11 — 트랙 폭(−1..+1)의 5% 남짓입니다.
 *
 * 하한을 안 두면 seen 이 한 줄(N=1)이어도 축이 열립니다. 그때 b 는 0 이나 1 이라 varQ=0 → z=0 →
 * level 은 'flat' 이 되지만, t 는 그대로 q 라 **마커가 트랙 끝까지 갑니다**. 색 하나로는
 * '표본이 사실상 없다'가 전달되지 않습니다.
 */
const BASELINE_FACTOR = 4;

interface AxisMeta {
  id: AxisId;
  koLabel: string;
  /** [음수 쪽, 양수 쪽]. SPEC §1 의 '양극' 문구 그대로. */
  poles: [string, string];
  /** 축별 표본 기준. 전역 실수 개수가 아니라 이 축이 실제로 쓴 표본으로 판정합니다. */
  minSample: number;
}

/**
 * 축 순서는 화면 순서이자 해금 순서입니다(aggression 12 → entry 20 → seat·pressure 그룹별 12).
 *
 * `koLabel` 은 축 이름이자 방향 안내라 반드시 `poles` 와 좌우가 같아야 합니다 — 머리말은 왼쪽이
 * 음수 쪽인데 아래 라벨은 반대면 화면을 잘못 읽게 됩니다. SPEC §1 의 제목은 seat·pressure 두 줄이
 * 그 규칙과 어긋나 있어(그리고 pressure 제목은 두 극이 다 큰 팟 이야기인데 왼쪽만 첫 결정이라고
 * 적혀 있어) 여기서 좌우와 뜻을 맞춰 고쳤습니다.
 */
const META: AxisMeta[] = [
  {
    id: 'aggression',
    koLabel: '수동 ↔ 공격',
    poles: ['콜·폴드 쪽으로 샌다', '레이즈·3벳 쪽으로 샌다'],
    minSample: 12,
  },
  {
    id: 'entry',
    koLabel: '타이트 ↔ 루즈',
    poles: ['접어야 할 자리는 잘 접는다', '접어야 할 자리에 들어간다'],
    minSample: 20,
  },
  {
    id: 'seat',
    koLabel: '뒷자리에서 좁다 ↔ 앞자리에서 넓다',
    poles: ['뒷자리(CO·BTN)에서 좁다', '앞자리(UTG·HJ)에서 넓다'],
    minSample: 12,
  },
  {
    id: 'pressure',
    koLabel: '압박에 접는다 ↔ 압박에 못 접는다',
    poles: ['3벳·4벳을 맞으면 너무 접는다', '3벳·4벳을 맞고도 못 접는다'],
    minSample: 12,
  },
];

/**
 * 축 하나의 계산 결과. 해금 전이면 t·z 가 null 이고 need·lock 만 의미가 있습니다.
 *
 * `need` 는 '실수 몇 개 더'인데 그 실수가 **아무 데서나** 나면 되는 축은 entry 뿐입니다.
 * 그래서 `needWhere` 를 같이 싣습니다 — 이걸 빼면 BB 수비만 푸는 사람에게 화면이
 * "실수 12개 더"라고 적어 놓고 실수를 아무리 쌓아도 그 숫자를 1도 줄여 주지 않습니다.
 */
interface Raw {
  sample: number;
  need: number;
  t: number | null;
  z: number | null;
  needWhere?: string;
  baselineTrials?: number;
  baselineNeed?: number;
  lock?: AxisLock;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function locked(need: number, sample: number): Raw {
  return { sample, need, t: null, z: null };
}

/** 기준선 한 그룹. */
interface Base {
  /** Σ weight — 그 자리에서 내가 실제로 답을 낸 횟수. */
  trials: number;
  /**
   * 받은 문제 중 정답이 폴드인 비중. 답을 낸 적이 아예 없으면 **null** 입니다 —
   * 재 보지 않은 것을 0 으로 적으면 '재 봤더니 폴드가 하나도 없더라'와 구별되지 않습니다.
   */
  b: number | null;
}

function baseline(rows: SeenRow[]): Base {
  let total = 0;
  let fold = 0;
  for (const r of rows) {
    total += r.weight;
    if (r.answer === 'fold') fold += r.weight;
  }
  return { trials: total, b: total > 0 ? fold / total : null };
}

/**
 * 설계효과 보정. 실수는 서로 독립이 아닙니다 — 카드키 하나의 정답은 차트가 정해 놓아 고정이고,
 * srs 는 틀린 카드를 10분 뒤로 되돌려 다시 내보내며, '내 약점' 덱은 아예 그 카드들만 모읍니다.
 * 그래서 같은 카드를 세 번 틀리면 같은 이야기를 세 번 센 것인데, z 는 서로 다른 관측 세 개로 읽습니다.
 *
 * 보정은 표본 하나가 평균 몇 번 되풀이됐는지(= 실수 수 ÷ 서로 다른 카드 수)의 제곱근으로 z 를 나누는 것입니다.
 * 되풀이가 없으면 1 이라 아무 일도 일어나지 않고, 되풀이가 심할수록 단정이 어려워집니다.
 * 이걸 빼면 성향이 전혀 없는 사람의 1/3이 '뚜렷하다'는 말을 듣습니다.
 */
function designEffect(ms: CoachMistake[]): number {
  if (ms.length === 0) return 1;
  const keys = new Set<string>();
  for (const m of ms) keys.add(m.key);
  return Math.sqrt(ms.length / keys.size);
}

/** q — 내 실수가 '접었어야 할 문제'에 몰린 비중. */
function foldShare(ms: CoachMistake[]): number {
  let fold = 0;
  for (const m of ms) if (m.answer === 'fold') fold += 1;
  return fold / ms.length;
}

/**
 * 부호 검정. L=3 시나리오에서 오답 선택지는 정확히 둘이고, 그중 '더 공격적인 쪽'이면 +1, 아니면 −1.
 * L=2(rfi, vs_5bet)는 오답이 하나뿐이라 방향 정보가 없어 자동으로 빠집니다 — 이게 옳습니다.
 */
function aggressionAxis(ms: CoachMistake[], minSample: number, where: string): Raw {
  let n = 0;
  let s = 0;
  for (const m of ms) {
    const acts = SCENARIO_ACTIONS[m.kind];
    if (acts.length !== 3) continue;
    const chosen = acts.indexOf(m.chosen);
    const answer = acts.indexOf(m.answer);
    if (chosen < 0 || answer < 0 || chosen === answer) continue;
    // 오답 두 개 중 더 공격적인 쪽(= 인덱스가 큰 쪽)의 인덱스.
    let topWrong = -1;
    for (let i = 0; i < acts.length; i += 1) if (i !== answer && i > topWrong) topWrong = i;
    n += 1;
    s += chosen === topWrong ? 1 : -1;
  }
  const need = Math.max(0, minSample - n);
  // rfi·vs_5bet 은 오답이 하나뿐이라 이 축에 안 들어갑니다. 그 둘만 푸는 사람에게 "실수 N개 더"만
  // 적으면 영영 안 줄어드는 숫자를 보여 주는 셈이라, 어디서 필요한지를 같이 싣습니다.
  if (need > 0) return { ...locked(need, n), needWhere: where, lock: 'mistakes' };
  const used = ms.filter((m) => SCENARIO_ACTIONS[m.kind].length === 3);
  return { sample: n, need: 0, t: s / n, z: s / Math.sqrt(n) / designEffect(used), needWhere: where };
}

/**
 * 기준선 대비 편차 하나. 비율 검정이라 분산은 b(1−b)/n 입니다.
 * 잠금은 두 갈래입니다 — 기준선을 못 잡았거나(못 잼), 실수가 모자라거나(덜 잼). 둘은 다른 말이고
 * 사용자가 할 일도 다릅니다.
 */
function entryAxis(ms: CoachMistake[], seen: SeenRow[], minSample: number): Raw {
  const { trials, b } = baseline(seen);
  const baselineNeed = Math.max(0, minSample * BASELINE_FACTOR - trials);
  const n = b === null ? 0 : ms.length;
  const need = Math.max(0, minSample - n);
  const meta = { baselineTrials: trials, baselineNeed };
  if (b === null) return { ...locked(need, n), ...meta, lock: 'no-baseline' };
  if (baselineNeed > 0) return { ...locked(need, n), ...meta, lock: 'baseline' };
  if (need > 0) return { ...locked(need, n), ...meta, lock: 'mistakes' };
  const q = foldShare(ms);
  const varQ = (b * (1 - b)) / n;
  return {
    sample: n,
    need: 0,
    ...meta,
    t: clamp((q - b) / Math.max(b, 1 - b), -1, 1),
    // b 가 0 이나 1 이면(하한을 넘긴 표본이 전부 폴드-정답이거나 전부 아니면) 편차가 생길 수 없어 신호도 0입니다.
    z: varQ > 0 ? (q - b) / Math.sqrt(varQ) / designEffect(ms) : 0,
  };
}

interface Group {
  ms: CoachMistake[];
  seen: SeenRow[];
  /** 이 그룹만 모자랄 때 화면에 붙일 말. "{label} 실수 N개 더"로 읽힙니다. */
  label: string;
}

/**
 * seat·pressure 공통. 두 그룹의 편차 Δ 를 따로 구해 그 차이를 봅니다.
 * Δ 각각의 귀무값이 0 이므로 차이의 귀무값도 0 — 좌석·상황별 차트 난이도 차이를 성향으로 오독하지 않습니다.
 * 그룹 각각이 minSample 을 넘어야 해금입니다(한쪽만 많이 푼 사람에게 차이를 주장할 수 없습니다).
 */
function diffAxis(pos: Group, neg: Group, minSample: number, bothLabel: string): Raw {
  const bp = baseline(pos.seen);
  const bn = baseline(neg.seen);
  const floor = minSample * BASELINE_FACTOR;

  const np = bp.b === null ? 0 : pos.ms.length;
  const nn = bn.b === null ? 0 : neg.ms.length;
  const needP = Math.max(0, minSample - np);
  const needN = Math.max(0, minSample - nn);
  const baseNeedP = Math.max(0, floor - bp.trials);
  const baseNeedN = Math.max(0, floor - bn.trials);

  // 모자란 쪽만 짚어 줍니다. 한쪽만 비어 있는데 양쪽 이름을 다 적으면 이미 채운 자리를
  // 또 요구하는 것처럼 읽힙니다.
  const shortP = needP > 0 || baseNeedP > 0;
  const shortN = needN > 0 || baseNeedN > 0;
  const meta = {
    needWhere: shortP !== shortN ? (shortP ? pos.label : neg.label) : bothLabel,
    // 잠금을 쥔 쪽이 더 적은 쪽이라, 진행도는 그쪽 숫자를 보여 줘야 말이 됩니다.
    baselineTrials: Math.min(bp.trials, bn.trials),
    baselineNeed: baseNeedP + baseNeedN,
  };

  const need = needP + needN;
  const sample = np + nn;
  if (bp.b === null || bn.b === null) return { ...locked(need, sample), ...meta, lock: 'no-baseline' };
  if (meta.baselineNeed > 0) return { ...locked(need, sample), ...meta, lock: 'baseline' };
  if (need > 0) return { ...locked(need, sample), ...meta, lock: 'mistakes' };

  const d = foldShare(pos.ms) - bp.b - (foldShare(neg.ms) - bn.b);
  const varD = (bp.b * (1 - bp.b)) / np + (bn.b * (1 - bn.b)) / nn;
  return {
    sample,
    need: 0,
    ...meta,
    t: clamp(d / DIFF_SCALE, -1, 1),
    z: varD > 0 ? d / Math.sqrt(varD) / designEffect([...pos.ms, ...neg.ms]) : 0,
  };
}

function levelOf(raw: Raw): AxisLevel {
  // `need` 만 보면 안 됩니다 — 기준선이 얇아서 잠긴 축은 실수가 넉넉해 need 가 0 입니다.
  // 잠금은 t·z 가 null 인지로 판정하고(계산을 아예 안 한 것), lock 은 그 이유를 말합니다.
  if (raw.lock !== undefined || raw.t === null || raw.z === null) return 'locked';
  const az = Math.abs(raw.z);
  if (az >= 2.2 && Math.abs(raw.t) >= 0.25) return 'confident';
  if (az >= 1.2) return 'leaning';
  return 'flat';
}

/**
 * 성향 축 네 개를 항상 같은 순서로 돌려줍니다. 표본이 모자란 축도 배열에서 빼지 않습니다 —
 * 화면은 잠긴 줄을 회색 트랙으로 그리고 무엇을 얼마나 더 하면 열리는지를 적습니다.
 *
 * 잠긴 줄에 적을 말은 `lockedBy` 가 가릅니다. 셋을 한 문장("실수 N개 더")으로 뭉치면 화면이
 * 셀 수 없는 것을 센 척하게 됩니다.
 *   - `mistakes`    → "{needWhere} 실수 {need}개 더"
 *   - `baseline`    → "{needWhere} 문제를 {baselineNeed}개 더 풀면 기준이 잡혀요"
 *   - `no-baseline` → "{needWhere}에서 답을 낸 기록이 없어 기준을 못 잡았어요"
 */
export function computeAxes(m: CoachMistake[], seen: SeenRow[]): AxisView[] {
  const inGroup = <T extends string>(g: readonly T[], v: T): boolean => g.indexOf(v) >= 0;

  const raws: Record<AxisId, Raw> = {
    // 오답이 둘인 상황만 방향을 말해 줍니다 — rfi·vs_5bet 은 선택지가 둘이라 빠집니다.
    aggression: aggressionAxis(m, 12, '답이 셋인 자리'),
    entry: entryAxis(m, seen, 20),
    seat: diffAxis(
      { ms: m.filter((x) => inGroup(EARLY, x.hero)), seen: seen.filter((c) => inGroup(EARLY, c.hero)), label: '앞자리' },
      { ms: m.filter((x) => inGroup(LATE, x.hero)), seen: seen.filter((c) => inGroup(LATE, c.hero)), label: '뒷자리' },
      12,
      '앞자리·뒷자리',
    ),
    pressure: diffAxis(
      { ms: m.filter((x) => inGroup(HEAT, x.kind)), seen: seen.filter((c) => inGroup(HEAT, c.kind)), label: '3벳·4벳 자리' },
      { ms: m.filter((x) => inGroup(OPEN, x.kind)), seen: seen.filter((c) => inGroup(OPEN, c.kind)), label: '오픈 자리' },
      12,
      '오픈과 3벳·4벳 자리',
    ),
  };

  const views: AxisView[] = META.map((meta) => {
    const raw = raws[meta.id];
    const level = levelOf(raw);
    const unlocked = level !== 'locked';
    const view: AxisView = {
      id: meta.id,
      koLabel: meta.koLabel,
      poles: meta.poles,
      // flat 은 '재 봤지만 신호가 없다'입니다. 잰 값을 그대로 두면 마커가 극단에 붙은 채 색만
      // 회색이 되는데, 사람이 읽는 건 위치라 그 회색 하나로는 전달되지 않습니다. 가운데로 눕힙니다.
      t: level === 'flat' ? 0 : raw.t,
      tRaw: raw.t,
      z: raw.z,
      sample: raw.sample,
      need: raw.need,
      unlocked,
      level,
      // 극 라벨은 눕히기 전 값으로 고릅니다 — 눕힌 0 으로 고르면 전부 오른쪽 극이 됩니다.
      pole: unlocked && raw.t !== null ? (raw.t < 0 ? meta.poles[0] : meta.poles[1]) : null,
      headline: false,
    };
    if (raw.needWhere !== undefined) view.needWhere = raw.needWhere;
    if (raw.baselineTrials !== undefined) view.baselineTrials = raw.baselineTrials;
    if (raw.baselineNeed !== undefined) view.baselineNeed = raw.baselineNeed;
    if (!unlocked && raw.lock !== undefined) view.lockedBy = raw.lock;
    return view;
  });

  // 단정은 화면 전체에서 하나만. 다중비교로 거짓 단정이 쌓이는 걸 개수 제한으로 막습니다.
  let best = -1;
  for (let i = 0; i < views.length; i += 1) {
    const v = views[i];
    if (v.level !== 'confident' || v.z === null) continue;
    const bestZ = best < 0 ? -1 : Math.abs(views[best].z ?? 0);
    if (Math.abs(v.z) > bestZ) best = i;
  }
  if (best >= 0) views[best].headline = true;

  return views;
}
