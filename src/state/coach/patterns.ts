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
import { RANKS, scenarioActions, type Action, type Pos, type ScenarioKind } from '../../poker/types';
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

/** scenarioActions 는 공격성 오름차순입니다 — 그래서 인덱스가 곧 공격성 순위입니다(rfi:SB 는 폴드 < 림프 < 레이즈). */
function rankOf(kind: ScenarioKind, hero: Pos, a: Action): number {
  return scenarioActions(kind, hero).indexOf(a);
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
    case 'vs_limp':
      return 'vs_limp';
    default:
      return 'vs_4bet_allin';
  }
}

/**
 * '무늬 때문에 들어간' 패. wheel_ace(A5s~A2s)는 넣지 않습니다 — 차트에서 그 패들이 들어갈 때는 무늬보다 A 블로커 때문에
 * 3벳 · 4벳 블러프로 가는 일이 많아서(BTN 의 양극화 3벳, 3벳 대응의 4벳), '무늬만 보고 들어간' 경우와 이유가 달라요.
 * (BB 는 BTN · SB 오픈에 A5s~A2s 를 3벳 절반 · 콜 절반으로 섞어요.)
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
    koName: '3벳할 자리에서 콜해요',
    minSample: 6,
    /**
     * 3벳 범위의 모양은 자리마다 달라요. 책(5장 4절): 콜 범위가 있으면(BTN · BB) 3벳은 최강 패와 블러프로 양극화되고,
     * 콜 범위가 없으면(HJ · CO · SB) 3벳 아니면 폴드라 강한 패부터 차례로 3벳하는 선형이에요(BB 는 BTN 에게도 선형 — 책이 짚은 예외).
     * 차트를 책에 맞춰 다시 만들면서 HJ · CO · SB 의 3벳에는 작은 수티드 A 가 A5s · A4s 정도만 남아(HJ vs UTG 는 A4s 절반,
     * SB vs UTG · HJ 는 A4s 폴드, SB vs BTN 만 A3s · A2s 절반까지),
     * 예전 문장 '3벳에는 센 패와 작은 수티드 A가 들어가요'(모든 vs_open 에서 AA·KK·QQ·AK 와 A5s·A4s 를 늘 3벳)는 거짓이 됐어요.
     *
     * 그래서 모든 자리에 참인 조건문으로 말합니다: '콜 범위가 없으면 센 패부터 3벳해요' — 차트에서 콜이 0인 vs_open
     * (HJ · CO · SB 7장)은 모두 선형이고 AA·KK·QQ·AK 를 늘 3벳해요(claims.test.ts 가 승률 순서로 다시 계산). 콜이 정답인
     * 칸이 있는 BTN · BB 의 실수에는 '거기는 콜 범위가 있다'는 대비로 읽혀요. '양극화'·'선형'은 코치 금지어라 풀어 씁니다.
     */
    match: (m) => m.answer === 'threebet' && m.chosen === 'call',
    advice: [
      '콜하면 상대가 접을 기회가 없어요.',
      '콜 범위가 없으면 센 패부터 3벳해요.',
      '이 패, 애매해서 콜한 건 아닌가요?',
    ],
    drillFor: deckDrill('vs_open', topHero),
  },
  {
    id: 'enter_by_calling',
    family: 'line',
    koName: '폴드할 자리에 콜로 들어가요',
    minSample: 6,
    /**
     * 애매한 콜이 돈을 잃는 이유는 책이 든 것만 씁니다 — 레이크(4장 6절 변수 5: 콜은 플랍 이후까지 쳐야 해서
     * 레이크를 낼 가능성이 높고, 레이크는 얇은 이득을 손해로 바꿈)와 스퀴즈(5장 5절). BB 는 뒤에 아무도 없어
     * 스퀴즈를 받지 않으므로 둘째 줄은 조건('뒤에 사람이 남았으면')으로 씁니다.
     */
    match: (m) => m.kind === 'vs_open' && m.answer === 'fold' && m.chosen === 'call',
    advice: [
      '애매한 콜은 레이크에 이득이 사라져요.',
      '뒤에 사람이 남았으면 스퀴즈도 받기 쉬워요.',
      '이 패로 플랍에서 뭘 할 생각이었나요?',
    ],
    drillFor: deckDrill('vs_open', topHero),
  },
  {
    id: 'fold_to_3bet',
    family: 'pressure',
    koName: '3벳을 받으면 너무 많이 폴드해요',
    minSample: 6,
    /**
     * vs_3bet 차트의 4벳은 양극화돼 있습니다(책 5장 2절 '4-bet은 블로커가 좋은 핸드를 섞은 양극화 범위') — 4벳의 중심이 AA·KK·QQ·AK 와
     * 작은 수티드 A 이고, JJ·TT·AQs 는 대개 콜 쪽입니다(예외: SB vs BB 는 JJ 를 늘, CO vs BTN 은 JJ 를 주로 4벳하고 TT · AQs 를
     * 절반 섞어요. 그 밖에는 JJ · TT 를 일부 섞는 정도).
     * 그래서 '센 순서로 줄 세워 맨 위가 4벳'이라는 선형 모델을 가르치면 차트와 어긋납니다.
     * '약한 A'라고 하면 A9o 같은 오프수트로 읽히는데, 차트의 4벳 블러프는 작은 수티드 A(휠 에이스)입니다
     * (오프수트 A 는 AQo~ATo 가 일부 섞일 뿐 — A9o 이하는 4벳하지 않아요). 조합 수로도 4벳의 절반 넘게가 센 패와 작은 수티드 A 라
     * '주로'를 붙입니다(claims.test.ts).
     */
    match: (m) => m.kind === 'vs_3bet' && m.chosen === 'fold' && m.answer !== 'fold',
    advice: [
      '상대도 블러프로 3벳해요.',
      '4벳은 주로 센 패와 작은 수티드 A예요.',
      '이 패, 콜로 볼 수는 없었나요?',
    ],
    drillFor: deckDrill('vs_3bet', topHero),
  },
  {
    id: 'stubborn_vs_4bet',
    family: 'pressure',
    koName: '4벳을 받고도 폴드를 못 해요',
    minSample: 6,
    /**
     * vs_5bet 은 히어로가 이미 4벳을 한 노드라 '3벳하기 전에'가 성립하지 않습니다 — stubborn_vs_5bet 이 맡습니다.
     *
     * 이 규칙은 UTG 의 4벳뿐 아니라 CO·BTN·SB 의 4벳도 잡으므로 '앞자리 4벳은 아주 강하다'로 한 자리만 말하지 않고
     * 비교로 씁니다 — 책 5장 5절 '앞·중간 자리의 4-bet 범위는 너무 강하고', 차트도 4벳한 사람이 앞자리일수록
     * 4벳 폭이 좁습니다(claims.test.ts). 3벳 전에 다음 대응을 정해 두는 것은 책 4장 10절 원칙 6.
     */
    match: (m) => m.kind === 'vs_4bet' && m.answer === 'fold' && m.chosen !== 'fold',
    advice: [
      '상대가 앞자리일수록 4벳이 더 강해요.',
      '3벳하기 전에 끝을 정해 둬요.',
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
    koName: '올인을 받고도 폴드를 못 해요',
    minSample: 6,
    match: (m) => m.kind === 'vs_5bet' && m.answer === 'fold' && m.chosen !== 'fold',
    advice: [
      '여기까지 오는 범위는 아주 좁아요.',
      '4벳하기 전에 끝을 정해 둬요.',
      '이 패, 올인까지 갈 생각이었나요?',
    ],
    drillFor: deckDrill('vs_4bet_allin', topHero),
  },
  {
    id: 'early_seat_wide',
    family: 'seat',
    koName: '앞자리에서 너무 넓게 오픈해요',
    minSample: 6,
    /**
     * 오픈 판단으로 한정합니다. kind 를 안 걸면 '3벳을 맞고 못 접은' 실수까지 끌어와 오픈 레인지 탓으로 오진하고
     * 훈련도 엉뚱한 덱으로 보냅니다. 기억용 기준(페어·둘 다 높음·수티드 중 둘)은 UTG 오픈 45칸 중 30칸을
     * 접으라고 해서 쓰지 않습니다 — 차트는 55+ 와 A2s+ 와 AJo+ 를 늘 열고, 44~22 · ATo · KJo 도 절반 섞습니다.
     *
     * 사람 수는 규칙이 잡는 두 자리를 다 덮게 씁니다(UTG 뒤 다섯 명, HJ 뒤 네 명). '한 명만 세도 밀린다'는
     * 글자 그대로는 거짓이라(무작위 한 패를 상대로는 UTG 오픈이 다 앞섭니다) 책의 이유 — 뒤에 사람이 많을수록
     * 누군가 3벳할 확률이 커진다(4장 6절 변수 4: 한 명당 7%면 UTG 약 30%, HJ 약 25%) — 로 바꿨습니다.
     */
    match: (m) => m.kind === 'rfi' && (m.hero === 'UTG' || m.hero === 'HJ') && m.answer === 'fold' && m.chosen !== 'fold',
    advice: [
      'UTG·HJ 뒤에는 네다섯 명이 남아요.',
      '그만큼 누군가 3벳할 확률이 커요.',
      '이 패, 뒤에 사람이 많아도 오픈할까요?',
    ],
    drillFor: deckDrill('rfi', fixed(['UTG', 'HJ'])),
  },
  {
    id: 'late_seat_tight',
    family: 'seat',
    koName: '뒷자리에서 너무 좁게 오픈해요',
    minSample: 6,
    /**
     * CO−UTG 로 늘어나는 것: 오프수트 브로드웨이(QJo·KTo·QTo·JTo, UTG 에서 절반인 KJo), 낮은 수티드 K·Q(K8s~K5s · Q8s · Q7s),
     * 수티드 커넥터 · 갭퍼(65s · 54s · 97s · 86s · 75s · J8s · T8s, UTG 에서 절반인 87s · 76s), 작은 페어(UTG 에서 절반인 44~22),
     * 오프수트 A(A8o, UTG 에서 절반 · 가끔인 ATo · A9o). 책 5장 2절도 HJ 가 CO 보다 줄이는 패로
     * 작은 페어 · 약한 오프수트 브로드웨이 · 수티드 커넥터 · 약한 수티드 Kx·Qx 를 들어요. 문구는 claims.test.ts 가 확인하는
     * 두 무리(오프수트 브로드웨이 · 낮은 수티드)만 말합니다.
     */
    match: (m) => m.kind === 'rfi' && (m.hero === 'CO' || m.hero === 'BTN') && m.answer !== 'fold' && m.chosen === 'fold',
    advice: [
      'CO·BTN 뒤에는 두세 명뿐이에요.',
      '오프수트 브로드웨이와 낮은 수티드가 늘어요.',
      '이 패를 UTG처럼 보고 접었나요?',
    ],
    drillFor: deckDrill('rfi', fixed(['CO', 'BTN'])),
  },
  {
    id: 'bb_too_wide',
    family: 'seat',
    koName: 'BB를 너무 넓게 지켜요',
    minSample: 6,
    /**
     * SB 오픈은 뺍니다 — 그 노드에서는 BB 가 포지션을 가져서(heroInPosition('BB','SB') === true) 조언의 전제가 반대입니다.
     */
    match: (m) => m.hero === 'BB' && m.kind === 'vs_open' && m.villain !== 'SB' && m.answer === 'fold' && m.chosen !== 'fold',
    // 에퀴티 실현(책 1장 10절)의 큰 손실은 '이긴 뒤 덜 받는 것'보다 '상대 베팅에 밀려 폴드하는 것'입니다.
    // 코치 린터가 '에퀴티'를 막으므로 그 뜻을 풀어 씁니다.
    advice: [
      'BB는 플랍부터 먼저 액션해요.',
      '상대 베팅에 밀려 폴드하는 일이 많아요.',
      '이 패로 플랍에서 뭘 할 건가요?',
    ],
    drillFor: deckDrill('vs_open', fixed(['BB'])),
  },
  {
    id: 'bb_too_tight',
    family: 'seat',
    koName: 'BB를 너무 쉽게 버려요',
    minSample: 6,
    /**
     * 이 규칙은 SB 오픈도 잡습니다. 질문에 'BTN에서 열었어도'처럼 한 자리를 박으면 상대가 이미 BTN 이었던
     * 실수에는 말이 안 되므로, 상대 오픈의 폭으로 묻습니다(책 5장 5절: 상대 범위가 넓을수록 넓게 지켜요).
     * '넓었어도 폴드했을까요?' 같은 반사실 질문도 같은 이유로 쓰지 않습니다 — 상대가 BTN·SB 면 오픈이 실제로 넓었습니다.
     */
    match: (m) => m.hero === 'BB' && m.kind === 'vs_open' && m.answer !== 'fold' && m.chosen === 'fold',
    advice: [
      'BB는 이미 낸 돈이 있어 싸게 봐요.',
      '상대가 어느 자리에서 오픈했는지 봐요.',
      '상대 오픈 폭까지 보고 폴드했나요?',
    ],
    drillFor: deckDrill('vs_open', fixed(['BB'])),
  },
  {
    id: 'offsuit_ace_trap',
    family: 'hand',
    koName: '오프수트 A를 너무 믿어요',
    minSample: 6,
    /**
     * offsuit_ace 는 A9o~A2o 입니다(ATo 이상은 big_ace). 책 5장 5절 A9o: 높은 카드가 하나뿐이고 수티드도 연결성도
     * 없어, 탑페어를 만들어도 더 좋은 에이스에게 지는 일이 많아요.
     */
    match: (m) => m.handClass === 'offsuit_ace' && m.answer === 'fold' && m.chosen !== 'fold',
    advice: [
      '높은 카드가 A 하나뿐인 패예요.',
      'A를 맞춰도 킥커에서 지는 일이 많아요.',
      '상대도 A를 들었을 때 이기나요?',
    ],
    drillFor: quizDrill,
  },
  {
    id: 'suited_trap',
    family: 'hand',
    koName: '수티드면 일단 들어가요',
    minSample: 6,
    /**
     * '무늬가 달랐어도 들어갔을까요?'는 묻지 않습니다 — 차트대로 답하면 '아니요'가 맞는 판단이라
     * 옳은 사고를 실수로 되돌려 버립니다. 무늬가 아니라 자리를 묻습니다.
     *
     * 이 규칙은 모든 상황(BB 수비 · 3벳 대응 포함)의 실수를 잡으므로 '다섯 명을 지나갈'처럼 UTG 오픈만의 말을
     * 쓰지 않습니다. '네 가지 힘 중 하나가 더 있어야'(책 4장 6절 변수 1)도 쓰지 않습니다 — 이 규칙의 클래스
     * (수티드 K · Q·J · 커넥터 · 갭퍼)는 모두 이미 높은 카드나 연결성을 하나 더 갖고 있습니다.
     * 책 5장 5절: 같은 핸드도 상대의 자리와 내 포지션에 따라 정답이 달라져요.
     */
    match: (m) => SUITED_TRAP_CLASSES.includes(m.handClass) && m.answer === 'fold' && m.chosen !== 'fold',
    advice: [
      '수티드는 플러시 가능성이 있어 좋아요.',
      '그래도 자리와 상대에 따라 답이 달라요.',
      '한 자리 앞이었어도 들어갔을까요?',
    ],
    drillFor: quizDrill,
  },
  {
    id: 'premium_underplay',
    family: 'line',
    koName: '센 패를 너무 얌전하게 써요',
    minSample: 6,
    match: (m) => {
      if (!PREMIUM_CLASSES.includes(m.handClass)) return false;
      // 폴드는 premium_overfold 가 맡습니다 — 여기 문구는 '콜한 것'을 전제로 씁니다.
      if (m.chosen === 'fold') return false;
      // SB 의 림프(rfi:SB)는 이 규칙이 잡지 않습니다. 문구가 '콜한 이 패'를 전제로 쓰였고, 책의 균형 전략은 SB 림프 범위에
      // AA·KK·QQ·AK 를 일부러 조금 섞어요(5장 2절 — 림프를 지키는 함정). 그래서 '센 패로 림프 = 얌전하게 쓴 실수'라고 단정할 수 없습니다.
      // 그 실수는 성향 축(공격 쪽 부호 검정 · 진입 축)과 자리 뭉치(seat_hotspot)가 그대로 셉니다.
      if (m.chosen === 'limp') return false;
      const chosen = rankOf(m.kind, m.hero, m.chosen);
      const answer = rankOf(m.kind, m.hero, m.answer);
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
    koName: '센 패를 그냥 폴드해요',
    minSample: 6,
    match: (m) => PREMIUM_CLASSES.includes(m.handClass) && m.answer !== 'fold' && m.chosen === 'fold',
    advice: [
      '센 패를 접을 땐 이유가 있어야 해요.',
      '상대도 블러프를 섞어요.',
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
    koName: '이 자리에서 유독 많이 틀려요',
    minSample: 5,
    match: () => true,
    advice: [
      '실수가 한 자리에 몰려 있어요.',
      '이 상황만 모아서 열 문제쯤 풀어 봐요.',
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
    const wrong = scenarioActions(b.kind, b.hero).filter((a: Action) => a !== b.answer);
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
