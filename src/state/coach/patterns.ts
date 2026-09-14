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

const SUITED_TRAP_CLASSES: HandClass[] = ['suited_gapper', 'suited_qj', 'suited_king', 'suited_connector', 'wheel_ace'];
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
    match: (m) => m.answer === 'threebet' && m.chosen === 'call',
    advice: [
      '3벳과 콜은 같은 패로 완전히 다른 판을 만듭니다.',
      '콜하면 주도권이 상대에게 넘어가요.',
      '들어가기로 정했으면 순서를 이렇게 보세요.',
      '첫째, 이 패가 내 오픈 레인지 위쪽인가.',
      '둘째, 상대가 4벳으로 올 때 접을 수 있나.',
      '둘 다 예면 3벳입니다.',
      '지금 콜하려는 이 패, 3벳으로 갔을 때 뭐가 무서운가요?',
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
      '콜은 가장 조용하게 돈이 새는 선택입니다.',
      '접을 패를 3벳으로 갈 일은 거의 없지만 콜로는 계속 들어가게 돼요.',
      '액션을 고르기 전에 순서를 바꿔 보세요.',
      '먼저 폴드인지 아닌지만 정하고, 폴드가 아닐 때만 콜과 3벳 중에 고르세요.',
      '이 패로 플랍에서 뭘 할 생각이었나요?',
    ],
    drillFor: deckDrill('vs_open', topHero),
  },
  {
    id: 'fold_to_3bet',
    family: 'pressure',
    koName: '3벳을 맞으면 거의 다 접습니다',
    minSample: 6,
    match: (m) => m.kind === 'vs_3bet' && m.chosen === 'fold' && m.answer !== 'fold',
    advice: [
      '상대도 블러프로 3벳합니다.',
      '다 접으면 그걸 그대로 내주는 거예요.',
      '3벳을 맞았을 때 이렇게 생각하세요.',
      '내가 이 자리에서 오픈하는 패들을 센 순서로 줄 세운다.',
      '맨 위 몇 개는 4벳, 그 아래 몇 개는 콜로 남긴다.',
      '나머지만 접는다.',
      '지금 접으려는 이 패는 그 줄에서 어디쯤인가요?',
    ],
    drillFor: deckDrill('vs_3bet', topHero),
  },
  {
    id: 'stubborn_vs_4bet',
    family: 'pressure',
    koName: '4벳을 맞고도 못 접습니다',
    minSample: 6,
    match: (m) => (m.kind === 'vs_4bet' || m.kind === 'vs_5bet') && m.answer === 'fold' && m.chosen !== 'fold',
    advice: [
      '4벳은 블러프가 훨씬 적습니다.',
      '여기서 한 번 잘못 가면 스택이 통째로 나가요.',
      '3벳을 누르기 전에 미리 정해 두세요.',
      '이 패는 4벳이 오면 접을 패인지, 올인까지 갈 패인지.',
      '미리 정하지 않고 4벳을 맞으면 거의 항상 잘못 갑니다.',
      '지금 이 패, 3벳할 때 이미 정해 뒀나요?',
    ],
    drillFor: deckDrill('vs_4bet_allin', topHero),
  },
  {
    id: 'early_seat_wide',
    family: 'seat',
    koName: '앞자리에서 손이 헐겁습니다',
    minSample: 6,
    match: (m) => (m.hero === 'UTG' || m.hero === 'HJ') && m.answer === 'fold' && m.chosen !== 'fold',
    advice: [
      'UTG에서는 뒤에 다섯 명이 남아 있습니다.',
      '그중 한 명만 더 센 패를 들면 됩니다.',
      '앞자리에서는 패를 보기 전에 기준을 먼저 세우세요.',
      '페어인가, 두 장 다 높은가, 수티드인가.',
      '셋 중 두 개는 되어야 엽니다.',
      '지금 이 패, 뒤에 다섯 명이 있어도 열 건가요?',
    ],
    drillFor: deckDrill('rfi', fixed(['UTG', 'HJ'])),
  },
  {
    id: 'late_seat_tight',
    family: 'seat',
    koName: '뒷자리에서 너무 좁게 칩니다',
    minSample: 6,
    match: (m) => (m.hero === 'CO' || m.hero === 'BTN') && m.answer !== 'fold' && m.chosen === 'fold',
    advice: [
      '버튼 뒤에는 블라인드 두 명뿐입니다.',
      '앞자리와 같은 기준을 쓰면 매번 손해예요.',
      '자리가 뒤로 갈수록 기준을 한 칸씩 내리세요.',
      '앞자리에서 접던 수티드 커넥터와 작은 페어부터 넣으면 됩니다.',
      '이 패를 UTG라고 생각하고 접은 건 아닌가요?',
    ],
    drillFor: deckDrill('rfi', fixed(['CO', 'BTN'])),
  },
  {
    id: 'bb_too_wide',
    family: 'seat',
    koName: 'BB를 너무 넓게 지킵니다',
    minSample: 6,
    match: (m) => m.hero === 'BB' && m.kind === 'vs_open' && m.answer === 'fold' && m.chosen !== 'fold',
    advice: [
      '이미 깐 블라인드는 팟에 살아 있는 돈이라 콜 가격은 원래 좋습니다.',
      'BB를 접어야 하는 이유는 가격이 아니라 포지션이에요.',
      '플랍부터 리버까지 내가 먼저 액션해야 하니 이겨도 다 못 받아냅니다.',
      '콜하기 전에 한 번 물어보세요.',
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
      'BB는 이미 낸 돈이 있어서 남들보다 싸게 볼 수 있습니다.',
      '전 좌석 중에 가장 넓게 지키는 자리예요.',
      '상대가 어느 자리에서 열었는지부터 보세요.',
      'BTN·CO 오픈은 넓으니 더 넓게 지키고, UTG 오픈에만 좁히면 됩니다.',
      '이 패, 상대가 BTN에서 열었어도 접을 건가요?',
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
      'A가 한 장 있으면 세 보이지만, 킥커가 약하면 A가 깔리는 순간이 가장 위험합니다.',
      '맞고도 지는 패예요.',
      'A를 봤을 때 킥커부터 보세요.',
      '킥커가 T 아래면 오프수트로는 앞자리에서 버리는 패입니다.',
      '이 A, 상대도 A를 들었을 때 이길 수 있나요?',
    ],
    drillFor: quizDrill,
  },
  {
    id: 'suited_trap',
    family: 'hand',
    koName: '수티드면 일단 들어갑니다',
    minSample: 6,
    match: (m) => SUITED_TRAP_CLASSES.includes(m.handClass) && m.answer === 'fold' && m.chosen !== 'fold',
    advice: [
      '같은 무늬는 플러시까지 아직 멉니다.',
      '무늬만으로 들어갈 만큼 크지 않아요.',
      '순서를 바꾸세요.',
      '두 장이 높은지, 이어져 있는지를 먼저 보고 무늬는 마지막에 더하는 보너스로 두세요.',
      '이 패, 무늬가 달랐어도 들어갔을까요?',
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
      const chosen = rankOf(m.kind, m.chosen);
      const answer = rankOf(m.kind, m.answer);
      return chosen >= 0 && answer >= 0 && chosen < answer;
    },
    advice: [
      '센 패로 조용히 가면 팟이 안 커집니다.',
      '이길 판에서 적게 버는 게 질 판에서 잃는 것만큼 아파요.',
      '센 패를 잡으면 먼저 물어보세요.',
      '이 패로 스택을 다 넣어도 되는 자리인가.',
      '답이 예면 지금부터 올려서 팟을 키우세요.',
      '지금 콜한 이 패, 뭘 기다리고 있었나요?',
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
      '방향이 정해지진 않았지만 여기부터 보면 됩니다.',
      '이 상황만 모아서 열 문제만 돌려 보세요.',
      // SPEC 의 마지막 문장은 평서문이지만 PLAIN_KO_STYLE §5 가 마지막 줄을 질문으로 못박습니다.
      '여기서는 주로 어느 쪽으로 틀리고 있나요?',
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
