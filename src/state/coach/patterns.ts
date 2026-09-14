/**
 * 실수 패턴 규칙 — COACH_SPEC §2.
 *
 * 실수를 세는 것만으로는 성향을 말할 수 없습니다. 출제 풀이 이미 기울어 있어서
 * "vs_open 폴드 문제를 많이 틀렸다"는 대개 그 문제가 많이 나왔다는 뜻이기 때문입니다.
 * 그래서 규칙마다 **기대 비중**을 `seen`(내가 실제로 답을 낸 문제들)에서 따로 구하고,
 * 관측 비중이 그보다 1.5배 이상일 때만 카드로 올립니다.
 *
 * 기대 비중은 규칙별 공식을 손으로 적지 않고 `match()` 를 그대로 재사용해 구합니다 —
 * 내가 받은 문제 한 줄마다 "무작위로 틀렸다면 이 규칙에 걸렸을 확률"을 세는 방식이라,
 * 분자와 분모가 같은 판정을 쓰게 되고 규칙을 고칠 때 분모가 따라오지 않는 사고가 없습니다.
 *
 * 순수 모듈입니다. localStorage·window 를 건드리지 않고 `Date.now()` 도 읽지 않습니다
 * (최신성은 호출부가 계산해 넣어 준 `CoachMistake.daysAgo` 로만 봅니다).
 */
import { HAND_CLASS_KO, classifyHand, type HandClass } from '../../poker/explain';
import { RANKS, SCENARIO_ACTIONS, type Action, type Pos, type ScenarioKind } from '../../poker/types';
import type { DeckId } from '../settings';
import type { CoachDrill, CoachMistake, PatternHit, SeenRow } from './types';

/**
 * 규칙이 말하는 각도. 같은 각도끼리는 하나만 뜨고 실수를 서로 뺏어 가지만,
 * 각도가 다르면 같은 실수를 두 번 봐도 됩니다 — 하나는 *어디서* 새는지를,
 * 다른 하나는 *어떤 패에서* 새는지를 말하니까 고치는 방법이 다릅니다.
 */
export type PatternFamily = 'line' | 'pressure' | 'seat' | 'hand';

export interface PatternRule {
  id: string;
  family: PatternFamily;
  koName: string;
  /** 이 개수를 넘지 못하면 뭉치로 보지 않습니다. */
  minSample: number;
  match(m: CoachMistake): boolean;
  /** SPEC §2 의 조언을 문장 단위로 쪼갠 것. copy.ts 가 카드의 steps 로 씁니다. 마지막 문장은 항상 질문입니다. */
  advice: string[];
  drillFor(hits: CoachMistake[]): CoachDrill;
}

/** 같은 패 한 장을 세 번 틀린 건 패턴이 아닙니다. */
const MIN_DISTINCT_HANDS = 3;
/** 관측 비중 ÷ 기대 비중. 이 밑은 "그냥 그 문제가 많이 나왔다"입니다. */
const MIN_LIFT = 1.5;
/** 한 화면에 올릴 수 있는 뭉치 수. 화면은 3장만 쓰지만 copy.ts 가 고를 여유를 둡니다. */
const MAX_PATTERNS = 5;
/**
 * 각도가 달라도 두 카드가 이만큼 같은 실수를 보고 있으면 말만 바꾼 같은 카드입니다.
 * 겹침은 자카드(교집합 ÷ 합집합)로 잽니다 — 한쪽 기준으로 재면 넓은 규칙이 좁은 규칙을
 * 통째로 품고 있어도(부분집합) 비율이 낮게 나와 통과해 버립니다.
 */
const MAX_OVERLAP = 0.5;
/** 최근 실수 가중치 경계. */
const RECENT_DAYS = 7;
/** 퀴즈로 보낼 때 담는 카드키 수. 이 수를 채우지 못하면 상황 훈련이 낫습니다. */
const DRILL_KEYS = 12;
/** 보루 규칙이 켜지는 쏠림 정도. */
const HOTSPOT_SHARE = 0.25;

const SEAT_HOTSPOT_ID = 'seat_hotspot';

/* ------------------------------------------------------------------ */
/* 손패 클래스 사전 확률                                                */
/* ------------------------------------------------------------------ */

/**
 * 169칸을 조합 수(페어 6 · 수티드 4 · 오프수트 12)로 가중한 클래스 분포.
 *
 * `SeenRow` 에는 손패가 없습니다(types.ts 는 손대지 않습니다). 그래서 클래스 규칙
 * (오프수트 A · 수티드 · 센 패)의 기대 비중만은 "내가 받은 문제의 클래스 분포"를 알 수 없어
 * 이 균등 사전 확률로 대신합니다. 클래스와 폴드-정답이 독립이라고 보는 근사라 정확하지는
 * 않지만, 기대 비중을 0으로 두거나 전체 폴드 비중을 그대로 쓰는 것(둘 다 게이트가 항상
 * 열리거나 항상 닫힘)보다는 훨씬 낫습니다.
 */
const CLASS_PRIOR: ReadonlyArray<{ cls: HandClass; hand: string; p: number }> = buildClassPrior();

function buildClassPrior(): Array<{ cls: HandClass; hand: string; p: number }> {
  const combos = new Map<HandClass, number>();
  const sample = new Map<HandClass, string>();
  let total = 0;
  for (let i = 0; i < RANKS.length; i += 1) {
    for (let j = i; j < RANKS.length; j += 1) {
      const names: Array<[string, number]> =
        i === j
          ? [[`${RANKS[i]}${RANKS[i]}`, 6]]
          : [
              [`${RANKS[i]}${RANKS[j]}s`, 4],
              [`${RANKS[i]}${RANKS[j]}o`, 12],
            ];
      for (const [hand, c] of names) {
        const cls = classifyHand(hand);
        combos.set(cls, (combos.get(cls) ?? 0) + c);
        if (!sample.has(cls)) sample.set(cls, hand);
        total += c;
      }
    }
  }
  // 한 클래스도 빠지지 않게: HAND_CLASS_KO 에 있는데 격자에 없는 클래스는 확률 0으로 둡니다.
  for (const cls of Object.keys(HAND_CLASS_KO)) {
    if (!combos.has(cls as HandClass)) combos.set(cls as HandClass, 0);
  }
  return [...combos.entries()].map(([cls, c]) => ({ cls, hand: sample.get(cls) ?? 'AA', p: total > 0 ? c / total : 0 }));
}

/* ------------------------------------------------------------------ */
/* 작은 도구                                                            */
/* ------------------------------------------------------------------ */

/** SCENARIO_ACTIONS 는 공격성 오름차순입니다 — 그래서 인덱스가 곧 공격성 순위입니다. */
function rankOf(kind: ScenarioKind, a: Action): number {
  return SCENARIO_ACTIONS[kind].indexOf(a);
}

/** 많이 나온 순. Map 이 삽입 순서를 지키고 sort 가 안정 정렬이라 동점은 처음 본 순서로 남습니다. */
function byFrequency<T>(values: T[]): T[] {
  const n = new Map<T, number>();
  for (const v of values) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n.keys()].sort((a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0));
}

/** 뭉치 전체가 같은 값일 때만 그 값. 규칙이 고정한 칸(kind·hero·chosen 등)이 자연히 채워집니다. */
function unanimous<T>(values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  const first = values[0];
  return values.every((v) => v === first) ? first : undefined;
}

function topHero(hits: CoachMistake[]): Pos[] {
  const [hero] = byFrequency(hits.map((h) => h.hero));
  return hero ? [hero] : [];
}

function topKeys(hits: CoachMistake[]): string[] {
  return byFrequency(hits.map((h) => h.key)).slice(0, DRILL_KEYS);
}

/** 최근 7일 실수는 두 배로 셉니다. 고친 버릇보다 지금 새는 곳이 먼저 와야 합니다. */
function weightSum(hits: CoachMistake[]): number {
  return hits.reduce((s, h) => s + (h.daysAgo <= RECENT_DAYS ? 2 : 1), 0);
}

function quizDrill(hits: CoachMistake[]): CoachDrill {
  return { target: 'quiz', onlyKeys: topKeys(hits) };
}

/**
 * 카드키가 12개 모이면 그 카드들만 퀴즈로 돌리는 게 가장 빠릅니다.
 * 그만큼 안 모였으면 표본이 얇다는 뜻이라 같은 상황 덱을 통째로 훈련시킵니다.
 */
function deckDrill(deck: DeckId, positions: (hits: CoachMistake[]) => Pos[]): (hits: CoachMistake[]) => CoachDrill {
  // 상황·자리 규칙은 '이 12장을 다시'가 아니라 '이 상황을 통째로'가 맞습니다 — 고치려는 건
  // 특정 패의 정답이 아니라 그 자리에서 패를 고르는 기준이기 때문입니다.
  return (hits) => ({ target: 'train', deck, positions: positions(hits) });
}

function fixed(positions: Pos[]): (hits: CoachMistake[]) => Pos[] {
  return () => positions;
}

function deckForKind(kind: ScenarioKind): DeckId {
  switch (kind) {
    case 'rfi':
      return 'rfi';
    case 'vs_open':
      return 'vs_open';
    case 'vs_3bet':
      return 'vs_3bet';
    default:
      return 'vs_4bet_allin';
  }
}

/**
 * '무늬 때문에 들어간' 패. wheel_ace(A5s~A2s)는 넣지 않습니다 — 차트에서 그 패들은 무늬가 아니라
 * A 블로커 때문에 3벳으로 가고 콜 빈도가 0이라, '무늬만 보고 들어간' 경우가 아닙니다.
 */
const SUITED_TRAP_CLASSES: HandClass[] = ['suited_gapper', 'suited_qj', 'suited_king', 'suited_connector'];
const PREMIUM_CLASSES: HandClass[] = ['premium_pair', 'big_pair', 'ak'];

/* ------------------------------------------------------------------ */
/* 규칙                                                                */
/* ------------------------------------------------------------------ */

export const PATTERN_RULES: PatternRule[] = [
  {
    id: 'call_not_raise',
    family: 'line',
    koName: '3벳할 자리에서 콜합니다',
    minSample: 6,
    /**
     * 차트의 3벳 레인지는 두 덩어리입니다 — 제일 센 패, 그리고 콜 빈도가 0이라 3벳 아니면 접는 약한 패.
     * '레인지 위쪽이면서 4벳에 접을 수 있어야 3벳'이라는 AND 조건은 그 둘이 배타적이라 성립하지 않습니다.
     */
    match: (m) => m.answer === 'threebet' && m.chosen === 'call',
    advice: [
      '콜하면 주도권이 상대에게 넘어가요.',
      '3벳은 센 패와 접을 패로 갑니다.',
      '이 패, 애매해서 콜한 건 아닌가요?',
    ],
    drillFor: deckDrill('vs_open', topHero),
  },
  {
    id: 'enter_by_calling',
    family: 'line',
    koName: '접어야 할 자리에 콜로 들어갑니다',
    minSample: 6,
    match: (m) => m.kind === 'vs_open' && m.answer === 'fold' && m.chosen === 'call',
    advice: [
      '콜이 가장 조용하게 돈이 샙니다.',
      '들어갈지부터 정하고 액션을 고르세요.',
      '이 패로 플랍에서 뭘 할 생각이었나요?',
    ],
    drillFor: deckDrill('vs_open', topHero),
  },
  {
    id: 'fold_to_3bet',
    family: 'pressure',
    koName: '3벳을 맞으면 거의 다 접습니다',
    minSample: 6,
    /**
     * vs_3bet 차트는 폴라라이즈드입니다 — 4벳 칸이 AA·KK·QQ·AK 와 A5s·A4s 이고 AQs·JJ·TT 는 그보다 아래인 콜 칸입니다.
     * 그래서 '센 순서로 줄 세워 맨 위가 4벳'이라는 선형 모델을 가르치면 차트와 어긋납니다.
     */
    match: (m) => m.kind === 'vs_3bet' && m.chosen === 'fold' && m.answer !== 'fold',
    advice: [
      '상대도 블러프로 3벳합니다.',
      '4벳은 제일 센 패와 약한 A입니다.',
      '이 패, 콜로 볼 수는 없었나요?',
    ],
    drillFor: deckDrill('vs_3bet', topHero),
  },
  {
    id: 'stubborn_vs_4bet',
    family: 'pressure',
    koName: '4벳을 맞고도 못 접습니다',
    minSample: 6,
    /**
     * vs_5bet 은 히어로가 이미 4벳을 한 노드라 '3벳하기 전에'가 성립하지 않습니다 — stubborn_vs_5bet 이 맡습니다.
     */
    match: (m) => m.kind === 'vs_4bet' && m.answer === 'fold' && m.chosen !== 'fold',
    advice: [
      '4벳은 블러프가 훨씬 적습니다.',
      '3벳하기 전에 끝을 정해 두세요.',
      '이 패, 3벳할 때 이미 정해 뒀나요?',
    ],
    drillFor: deckDrill('vs_4bet_allin', topHero),
  },
  {
    /**
     * vs_5bet 은 히어로가 오픈 → 상대 3벳 → 히어로 4벳 → 상대 올인까지 온 노드입니다.
     * 히어로는 3벳을 한 적이 없으므로 4벳 규칙의 문구("3벳하기 전에")를 그대로 쓸 수 없습니다.
     */
    id: 'stubborn_vs_5bet',
    family: 'pressure',
    koName: '올인을 맞고도 못 접습니다',
    minSample: 6,
    match: (m) => m.kind === 'vs_5bet' && m.answer === 'fold' && m.chosen !== 'fold',
    advice: [
      '여기까지 오는 레인지는 아주 좁아요.',
      '4벳하기 전에 끝을 정해 두세요.',
      '이 패, 올인까지 갈 생각이었나요?',
    ],
    drillFor: deckDrill('vs_4bet_allin', topHero),
  },
  {
    id: 'early_seat_wide',
    family: 'seat',
    koName: '앞자리에서 손이 헐겁습니다',
    minSample: 6,
    /**
     * 오픈 판단으로 한정합니다. kind 를 안 걸면 '3벳을 맞고 못 접은' 실수까지 끌어와 오픈 레인지 탓으로 오진하고
     * 훈련도 엉뚱한 덱으로 보냅니다. 기억용 기준(페어·둘 다 높음·수티드 중 둘)은 UTG 오픈 45칸 중 30칸을
     * 접으라고 해서 쓰지 않습니다 — 차트는 22+ 와 A2s+ 와 ATo+ 를 전부 엽니다.
     */
    match: (m) => m.kind === 'rfi' && (m.hero === 'UTG' || m.hero === 'HJ') && m.answer === 'fold' && m.chosen !== 'fold',
    advice: [
      'UTG 뒤에는 다섯 명이 남습니다.',
      '그중 한 명만 세도 내 패는 밀려요.',
      '이 패, 뒤에 다섯 명이 있어도 열까요?',
    ],
    drillFor: deckDrill('rfi', fixed(['UTG', 'HJ'])),
  },
  {
    id: 'late_seat_tight',
    family: 'seat',
    koName: '뒷자리에서 너무 좁게 칩니다',
    minSample: 6,
    /**
     * CO−UTG 로 실제로 늘어나는 건 오프수트 브로드웨이(QJo·KTo·QTo·JTo), 낮은 수티드 K(K8s~K4s), 수티드 갭퍼입니다.
     * 작은 페어는 UTG 부터 이미 22+ 로 전부 열고 수티드 커넥터는 54s 한 칸만 늘어나므로 그 둘을 지목하면 안 됩니다.
     */
    match: (m) => m.kind === 'rfi' && (m.hero === 'CO' || m.hero === 'BTN') && m.answer !== 'fold' && m.chosen === 'fold',
    advice: [
      '버튼 뒤에는 두 명뿐입니다.',
      '오프수트 그림패와 낮은 수티드가 늘어요.',
      '이 패를 UTG처럼 보고 접었나요?',
    ],
    drillFor: deckDrill('rfi', fixed(['CO', 'BTN'])),
  },
  {
    id: 'bb_too_wide',
    family: 'seat',
    koName: 'BB를 너무 넓게 지킵니다',
    minSample: 6,
    /**
     * SB 오픈은 뺍니다 — 그 노드에서는 BB 가 포지션을 가져서(heroInPosition('BB','SB') === true) 조언의 전제가 반대입니다.
     */
    match: (m) => m.hero === 'BB' && m.kind === 'vs_open' && m.villain !== 'SB' && m.answer === 'fold' && m.chosen !== 'fold',
    advice: [
      'BB는 플랍부터 먼저 액션합니다.',
      '이겨도 다 못 받아냅니다.',
      '이 패로 플랍에서 뭘 할 건가요?',
    ],
    drillFor: deckDrill('vs_open', fixed(['BB'])),
  },
  {
    id: 'bb_too_tight',
    family: 'seat',
    koName: 'BB를 너무 쉽게 버립니다',
    minSample: 6,
    match: (m) => m.hero === 'BB' && m.kind === 'vs_open' && m.answer !== 'fold' && m.chosen === 'fold',
    advice: [
      'BB는 이미 낸 돈이 있어 싸게 봅니다.',
      '상대가 어느 자리에서 열었는지 보세요.',
      '상대가 BTN에서 열었어도 접나요?',
    ],
    drillFor: deckDrill('vs_open', fixed(['BB'])),
  },
  {
    id: 'offsuit_ace_trap',
    family: 'hand',
    koName: '오프수트 A를 너무 믿습니다',
    minSample: 6,
    match: (m) => m.handClass === 'offsuit_ace' && m.answer === 'fold' && m.chosen !== 'fold',
    advice: [
      'A만 보면 킥커에서 밀립니다.',
      '맞고도 지는 게 제일 아픈 패예요.',
      '상대도 A를 들었을 때 이기나요?',
    ],
    drillFor: quizDrill,
  },
  {
    id: 'suited_trap',
    family: 'hand',
    koName: '수티드면 일단 들어갑니다',
    minSample: 6,
    /**
     * '무늬가 달랐어도 들어갔을까요?'는 묻지 않습니다 — 차트대로 답하면 '아니요'가 맞는 판단이라
     * 옳은 사고를 실수로 되돌려 버립니다. 무늬가 아니라 자리를 묻습니다.
     */
    match: (m) => SUITED_TRAP_CLASSES.includes(m.handClass) && m.answer === 'fold' && m.chosen !== 'fold',
    advice: [
      '무늬는 계속 갈 이유는 됩니다.',
      '다섯 명을 지나갈 이유는 아니에요.',
      '한 자리 앞이었어도 들어갔을까요?',
    ],
    drillFor: quizDrill,
  },
  {
    id: 'premium_underplay',
    family: 'line',
    koName: '센 패를 너무 얌전하게 씁니다',
    minSample: 6,
    match: (m) => {
      if (!PREMIUM_CLASSES.includes(m.handClass)) return false;
      // 폴드는 premium_overfold 가 맡습니다 — 여기 문구는 '콜한 것'을 전제로 씁니다.
      if (m.chosen === 'fold') return false;
      const chosen = rankOf(m.kind, m.chosen);
      const answer = rankOf(m.kind, m.answer);
      return chosen >= 0 && answer >= 0 && chosen < answer;
    },
    advice: [
      '센 패로 조용히 가면 팟이 안 커져요.',
      '이길 판에서 적게 버는 것도 손해예요.',
      '지금 콜한 이 패, 뭘 기다렸나요?',
    ],
    drillFor: quizDrill,
  },
  {
    /**
     * 같은 센 패라도 '콜로 얌전하게 간 것'과 '그냥 접은 것'은 고치는 방법이 반대라 규칙을 나눕니다.
     * 한 규칙으로 묶으면 접은 사람에게 "지금 콜한 이 패"라고 하지도 않은 행동을 지적하게 됩니다.
     */
    id: 'premium_overfold',
    family: 'line',
    koName: '센 패를 그냥 접습니다',
    minSample: 6,
    match: (m) => PREMIUM_CLASSES.includes(m.handClass) && m.answer !== 'fold' && m.chosen === 'fold',
    advice: [
      '센 패를 접을 땐 이유가 있어야 해요.',
      '상대도 블러프를 섞습니다.',
      '이 패보다 센 패가 그렇게 많나요?',
    ],
    drillFor: quizDrill,
  },
  {
    /**
     * 보루 규칙. 방향을 주장하지 않고 "여기에 몰려 있다"는 셀 수 있는 사실만 말하므로
     * lift 게이트를 걸지 않습니다. 뭉치를 고르는 일은 findPatterns 가 (kind, hero) 버킷으로
     * 하고, 여기 match 는 "모든 실수가 후보"라는 뜻입니다.
     */
    id: SEAT_HOTSPOT_ID,
    family: 'seat',
    koName: '이 자리에서 유독 많이 틀립니다',
    minSample: 5,
    match: () => true,
    advice: [
      '실수가 한 자리에 몰려 있습니다.',
      '이 상황만 모아서 열 문제만 풀어 보세요.',
      // SPEC 의 마지막 문장은 평서문이지만 PLAIN_KO_STYLE §5 가 마지막 줄을 질문으로 못박습니다.
      '여기서는 주로 어느 쪽으로 틀리나요?',
    ],
    drillFor: (hits) => {
      const kind = hits[0]?.kind ?? 'vs_open';
      return { target: 'train', deck: deckForKind(kind), positions: topHero(hits) };
    },
  },
];

/* ------------------------------------------------------------------ */
/* 기대 비중                                                            */
/* ------------------------------------------------------------------ */

interface SeenBucket {
  kind: ScenarioKind;
  hero: Pos;
  answer: Action;
  weight: number;
}

/** (kind, hero, answer) 는 최대 216가지뿐입니다 — 묶어 두면 규칙 × 클래스 × 선택지 곱이 작아집니다. */
function bucketize(seen: SeenRow[]): { buckets: SeenBucket[]; total: number } {
  const map = new Map<string, SeenBucket>();
  let total = 0;
  for (const row of seen) {
    if (row.weight <= 0) continue;
    const id = `${row.kind}|${row.hero}|${row.answer}`;
    const b = map.get(id);
    if (b) b.weight += row.weight;
    else map.set(id, { kind: row.kind, hero: row.hero, answer: row.answer, weight: row.weight });
    total += row.weight;
  }
  return { buckets: [...map.values()], total };
}

function probe(b: SeenBucket, cls: HandClass, hand: string, chosen: Action): CoachMistake {
  return {
    hand,
    handClass: cls,
    kind: b.kind,
    hero: b.hero,
    ip: false,
    answer: b.answer,
    chosen,
    daysAgo: 0,
    src: 'quiz',
    key: '',
  };
}

/**
 * "이 규칙에 걸릴 실수가 원래 얼마나 나올 문제였나".
 *
 * 내가 받은 문제 한 줄마다, 그 문제를 무작위로 틀렸다면(오답 선택지 중 하나를 균등하게 골랐다면)
 * 이 규칙의 match 가 참이 될 확률을 재서 가중평균합니다. 규칙별 분모 공식을 따로 적지 않는 이유는
 * 분자(실제 실수)와 분모가 **같은 판정 함수**를 쓰게 만들기 위해서입니다.
 */
function expectedShare(rule: PatternRule, buckets: SeenBucket[], total: number): number {
  if (total <= 0) return 0;
  let acc = 0;
  for (const b of buckets) {
    const wrong = SCENARIO_ACTIONS[b.kind].filter((a) => a !== b.answer);
    if (wrong.length === 0) continue;
    let p = 0;
    for (const { cls, hand, p: prior } of CLASS_PRIOR) {
      if (prior <= 0) continue;
      let hit = 0;
      for (const a of wrong) if (rule.match(probe(b, cls, hand, a))) hit += 1;
      p += prior * (hit / wrong.length);
    }
    acc += (b.weight / total) * p;
  }
  return acc;
}

/* ------------------------------------------------------------------ */
/* 뭉치 찾기                                                            */
/* ------------------------------------------------------------------ */

function toHit(rule: PatternRule, hits: CoachMistake[], lift: number): PatternHit {
  return {
    id: rule.id,
    koName: rule.koName,
    count: hits.length,
    recent7d: hits.filter((h) => h.daysAgo <= RECENT_DAYS).length,
    distinctHands: new Set(hits.map((h) => h.hand)).size,
    lift,
    score: weightSum(hits) * lift,
    kind: unanimous(hits.map((h) => h.kind)),
    hero: unanimous(hits.map((h) => h.hero)),
    handClass: unanimous(hits.map((h) => h.handClass)),
    from: unanimous(hits.map((h) => h.answer)),
    to: unanimous(hits.map((h) => h.chosen)),
    examples: byFrequency(hits.map((h) => h.hand)).slice(0, 3),
    keys: topKeys(hits),
    drill: rule.drillFor(hits),
  };
}

/** 한 (kind, hero) 에 실수의 1/4 이상이 몰려 있으면 방향 주장 없이 그 자리만 짚어 줍니다. */
function seatHotspot(mistakes: CoachMistake[]): PatternHit | null {
  const rule = PATTERN_RULES.find((r) => r.id === SEAT_HOTSPOT_ID);
  if (!rule || mistakes.length === 0) return null;
  const buckets = new Map<string, CoachMistake[]>();
  for (const m of mistakes) {
    const id = `${m.kind}|${m.hero}`;
    const b = buckets.get(id);
    if (b) b.push(m);
    else buckets.set(id, [m]);
  }
  let best: CoachMistake[] = [];
  for (const b of buckets.values()) if (b.length > best.length) best = b;
  if (best.length < rule.minSample) return null;
  if (best.length / mistakes.length < HOTSPOT_SHARE) return null;
  // lift 게이트를 걸지 않는 규칙이라 lift 는 중립값 1로 둡니다(점수는 Σw 그대로).
  return toHit(rule, best, 1);
}

/**
 * 실수 뭉치를 점수 내림차순으로 최대 5개.
 *
 * 한 실수는 여러 규칙에 동시에 걸립니다(예: BB 오픈 대응에서 폴드를 콜한 실수는
 * enter_by_calling 이기도 하고 bb_too_wide 이기도 합니다). 그래서 한 번에 한 규칙씩
 * 가장 점수가 높은 것을 고르고, **그 규칙이 가져간 실수를 빼고 나머지를 다시 세는** 방식을 씁니다.
 * 안 그러면 같은 이야기가 말만 바꿔 세 장 뜹니다.
 *
 * `_now` 는 쓰지 않습니다 — 최신성은 digest.ts 가 now 기준으로 채워 넣은 daysAgo 가 이미 담고 있고,
 * 여기서 시계를 한 번 더 읽으면 같은 입력이 호출 시각마다 다른 답을 냅니다. 서명만 맞춰 둡니다.
 */
/** 두 실수 묶음이 얼마나 같은 것을 보고 있는가. 교집합 ÷ 합집합이라 크기 차이에 속지 않습니다. */
function jaccard(a: CoachMistake[], b: Set<CoachMistake>): number {
  let inter = 0;
  for (const m of a) if (b.has(m)) inter += 1;
  const union = a.length + b.size - inter;
  return union > 0 ? inter / union : 0;
}

export function findPatterns(mistakes: CoachMistake[], seen: SeenRow[], _now: number): PatternHit[] {
  const total = mistakes.length;
  if (total === 0) return [];

  const { buckets, total: seenWeight } = bucketize(seen);
  const rules = PATTERN_RULES.filter((r) => r.id !== SEAT_HOTSPOT_ID);
  const expected = new Map<string, number>();
  for (const r of rules) expected.set(r.id, expectedShare(r, buckets, seenWeight));

  const out: PatternHit[] = [];
  /** 같은 각도(family) 안에서만 실수를 뺏어 갑니다 — 각도별로 따로 셉니다. */
  const takenBy = new Map<PatternFamily, Set<CoachMistake>>();
  /** 이미 카드가 된 각도. 한 각도에서 두 장이 뜨면 같은 이야기를 두 번 하는 것입니다. */
  const usedFamilies = new Set<PatternFamily>();
  /** 다른 각도라도 실수가 거의 그대로 겹치면 말만 바꾼 같은 카드입니다. */
  const shown: Array<Set<CoachMistake>> = [];

  while (out.length < MAX_PATTERNS) {
    let best: { rule: PatternRule; hits: CoachMistake[]; lift: number; score: number } | null = null;
    for (const rule of rules) {
      if (usedFamilies.has(rule.family)) continue;
      const exp = expected.get(rule.id) ?? 0;
      // 기대 비중이 0이면 비교할 기준이 없습니다. 0으로 나누는 대신 그 규칙을 건너뜁니다.
      if (exp <= 0) continue;
      const taken = takenBy.get(rule.family);
      const hits = mistakes.filter((m) => !taken?.has(m) && rule.match(m));
      if (hits.length < rule.minSample) continue;
      if (new Set(hits.map((h) => h.hand)).size < MIN_DISTINCT_HANDS) continue;
      const lift = hits.length / total / exp;
      if (lift < MIN_LIFT) continue;
      // 앞 카드와 보고 있는 실수가 거의 같으면 각도가 달라도 새 이야기가 아닙니다.
      if (shown.some((prev) => jaccard(hits, prev) > MAX_OVERLAP)) continue;
      const score = weightSum(hits) * lift;
      if (!best || score > best.score) best = { rule, hits, lift, score };
    }
    if (!best) break;

    out.push(toHit(best.rule, best.hits, best.lift));
    usedFamilies.add(best.rule.family);
    const taken = takenBy.get(best.rule.family) ?? new Set<CoachMistake>();
    for (const m of best.hits) taken.add(m);
    takenBy.set(best.rule.family, taken);
    shown.push(new Set(best.hits));
  }

  // 매번 남은 실수 중 최고점을 고르므로 out 은 이미 점수 내림차순입니다.
  if (out.length > 0) return out;

  const fallback = seatHotspot(mistakes);
  return fallback ? [fallback] : [];
}
