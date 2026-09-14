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
import type { AxisId, AxisLevel, AxisView, CoachMistake, SeenRow } from './types';

/** SB·BB 는 seat 축에서 완전히 제외합니다 — BB 는 rfi 자체가 없고 수비 자리라 BTN 과 성격이 정반대입니다. */
const EARLY: readonly Pos[] = ['UTG', 'HJ'];
const LATE: readonly Pos[] = ['CO', 'BTN'];

const OPEN: readonly ScenarioKind[] = ['rfi', 'vs_open'];
const HEAT: readonly ScenarioKind[] = ['vs_3bet', 'vs_4bet', 'vs_5bet', 'cold_4bet'];

/** seat·pressure 의 t 는 편차 차이를 이 폭으로 나눠 −1..+1 에 눕힙니다(SPEC §1). */
const DIFF_SCALE = 0.5;

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

/** 축 하나의 계산 결과. 해금 전이면 t·z 가 null 이고 need 만 의미가 있습니다. */
interface Raw {
  sample: number;
  need: number;
  t: number | null;
  z: number | null;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function locked(need: number, sample: number): Raw {
  return { sample, need, t: null, z: null };
}

/** 기준선 b — 내가 받은 문제 중 정답이 폴드인 비중. 받은 게 없으면 잴 수 없으므로 null. */
function baseline(rows: SeenRow[]): number | null {
  let total = 0;
  let fold = 0;
  for (const r of rows) {
    total += r.weight;
    if (r.answer === 'fold') fold += r.weight;
  }
  return total > 0 ? fold / total : null;
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
function aggressionAxis(ms: CoachMistake[], minSample: number): Raw {
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
  if (need > 0) return locked(need, n);
  const used = ms.filter((m) => SCENARIO_ACTIONS[m.kind].length === 3);
  return { sample: n, need: 0, t: s / n, z: s / Math.sqrt(n) / designEffect(used) };
}

/** 기준선 대비 편차 하나. 비율 검정이라 분산은 b(1−b)/n 입니다. */
function entryAxis(ms: CoachMistake[], seen: SeenRow[], minSample: number): Raw {
  const b = baseline(seen);
  const n = b === null ? 0 : ms.length;
  const need = Math.max(0, minSample - n);
  if (b === null || need > 0) return locked(need, n);
  const q = foldShare(ms);
  const varQ = (b * (1 - b)) / n;
  return {
    sample: n,
    need: 0,
    t: clamp((q - b) / Math.max(b, 1 - b), -1, 1),
    // b 가 0 이나 1 이면(그 모집단에 폴드-정답만, 혹은 하나도 없으면) 편차가 생길 수 없어 신호도 0입니다.
    z: varQ > 0 ? (q - b) / Math.sqrt(varQ) / designEffect(ms) : 0,
  };
}

interface Group {
  ms: CoachMistake[];
  seen: SeenRow[];
}

/**
 * seat·pressure 공통. 두 그룹의 편차 Δ 를 따로 구해 그 차이를 봅니다.
 * Δ 각각의 귀무값이 0 이므로 차이의 귀무값도 0 — 좌석·상황별 차트 난이도 차이를 성향으로 오독하지 않습니다.
 * 그룹 각각이 minSample 을 넘어야 해금입니다(한쪽만 많이 푼 사람에게 차이를 주장할 수 없습니다).
 */
function diffAxis(pos: Group, neg: Group, minSample: number): Raw {
  const bp = baseline(pos.seen);
  const bn = baseline(neg.seen);
  const np = bp === null ? 0 : pos.ms.length;
  const nn = bn === null ? 0 : neg.ms.length;
  const need = Math.max(0, minSample - np) + Math.max(0, minSample - nn);
  const sample = np + nn;
  if (bp === null || bn === null || need > 0) return locked(need, sample);
  const d = foldShare(pos.ms) - bp - (foldShare(neg.ms) - bn);
  const varD = (bp * (1 - bp)) / np + (bn * (1 - bn)) / nn;
  return {
    sample,
    need: 0,
    t: clamp(d / DIFF_SCALE, -1, 1),
    z: varD > 0 ? d / Math.sqrt(varD) / designEffect([...pos.ms, ...neg.ms]) : 0,
  };
}

function levelOf(raw: Raw): AxisLevel {
  if (raw.need > 0 || raw.t === null || raw.z === null) return 'locked';
  const az = Math.abs(raw.z);
  if (az >= 2.2 && Math.abs(raw.t) >= 0.25) return 'confident';
  if (az >= 1.2) return 'leaning';
  return 'flat';
}

/**
 * 성향 축 네 개를 항상 같은 순서로 돌려줍니다. 표본이 모자란 축도 배열에서 빼지 않습니다 —
 * 화면은 잠긴 줄을 회색 트랙으로 그리고 "실수 N개 더"를 적어, 무엇을 얼마나 더 하면 열리는지를 보여 줍니다.
 */
export function computeAxes(m: CoachMistake[], seen: SeenRow[]): AxisView[] {
  const inGroup = <T extends string>(g: readonly T[], v: T): boolean => g.indexOf(v) >= 0;

  const raws: Record<AxisId, Raw> = {
    aggression: aggressionAxis(m, 12),
    entry: entryAxis(m, seen, 20),
    seat: diffAxis(
      { ms: m.filter((x) => inGroup(EARLY, x.hero)), seen: seen.filter((c) => inGroup(EARLY, c.hero)) },
      { ms: m.filter((x) => inGroup(LATE, x.hero)), seen: seen.filter((c) => inGroup(LATE, c.hero)) },
      12,
    ),
    pressure: diffAxis(
      { ms: m.filter((x) => inGroup(HEAT, x.kind)), seen: seen.filter((c) => inGroup(HEAT, c.kind)) },
      { ms: m.filter((x) => inGroup(OPEN, x.kind)), seen: seen.filter((c) => inGroup(OPEN, c.kind)) },
      12,
    ),
  };

  const views: AxisView[] = META.map((meta) => {
    const raw = raws[meta.id];
    const level = levelOf(raw);
    const unlocked = level !== 'locked';
    return {
      id: meta.id,
      koLabel: meta.koLabel,
      poles: meta.poles,
      t: raw.t,
      z: raw.z,
      sample: raw.sample,
      need: raw.need,
      unlocked,
      level,
      pole: unlocked && raw.t !== null ? (raw.t < 0 ? meta.poles[0] : meta.poles[1]) : null,
      headline: false,
    };
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
