/**
 * 코치 탭의 자료형. 자세한 근거는 docs/COACH_SPEC.md.
 *
 * 규칙 코치(localCoach) · 프롬프트 복사(buildPrompt) · 내 키 직접 호출(askClaude) 세 경로가
 * 모두 `CoachDigest` 하나만 먹고 `CoachCard[]` 하나만 뱉습니다. 그래서 키가 없어도 첫날부터
 * 화면이 완성돼 있고, AI가 붙어도 렌더러가 하나뿐입니다.
 */
import type { HandClass } from '../../poker/explain';
import type { Action, Pos, ScenarioKind } from '../../poker/types';
import type { DeckId } from '../settings';

export type AxisId = 'aggression' | 'entry' | 'seat' | 'pressure';

/** 표본과 신호 세기에 따른 단계. `flat`은 "재 봤지만 한쪽으로 치우치지 않았다"이고 `locked`와 다릅니다. */
export type AxisLevel = 'confident' | 'leaning' | 'flat' | 'locked';

/**
 * 축이 잠긴 **이유**. 셋은 사용자가 할 일이 서로 달라서 화면 문구도 달라야 합니다.
 *  - `mistakes`    : 기준선은 잡혔는데 실수가 모자람 → "실수 N개 더" (`need`·`needWhere`)
 *  - `baseline`    : 실수는 있는데 기준선 표본이 얇음 → "문제를 더 풀어야 기준이 잡혀요" (`baselineNeed`)
 *  - `no-baseline` : 기준선을 아예 못 잡음(그 자리에서 답을 낸 기록이 0) → 잴 수 있는 것 자체가 없음
 *
 * `baseline` 과 `no-baseline` 을 한 칸으로 뭉치지 않은 이유가 이 기능의 원칙입니다 — 재 보지 않은
 * 것을 "재 봤더니 부족"이라고 말하면 안 됩니다. 옛 저장 형식(13칸)처럼 분모가 통째로 빈 경우가
 * 실제로 `no-baseline` 입니다.
 */
export type AxisLock = 'mistakes' | 'baseline' | 'no-baseline';

export interface AxisView {
  id: AxisId;
  /** 화면에 뜨는 축 이름. */
  koLabel: string;
  /** [음수 쪽, 양수 쪽] 한국어 극 라벨. */
  poles: [string, string];
  /**
   * −1..+1 **마커 위치**. 표본 미달이면 null.
   *
   * `level === 'flat'` 이면 잰 값 대신 0 입니다. flat 은 "재 봤지만 신호가 없다"는 뜻인데,
   * 사람이 읽는 건 마커 위치이고 색은 회색 하나뿐이라 마커를 끝에 둔 채 색만 바꾸면
   * '신호 없음'이 전달되지 않습니다. 잰 값 그대로가 필요하면 `tRaw` 를 보세요.
   */
  t: number | null;
  /** 눕히기 전의 t — 화면 마커에 쓰지 마세요. 귀무 편향 검증과 근거 시트용입니다. */
  tRaw?: number | null;
  /** 부호 검정 / 비율 검정의 z. 표본 미달이면 null. */
  z: number | null;
  /** 이 축이 실제로 쓴 표본 수. */
  sample: number;
  /**
   * 해금까지 남은 실수 수 (0 이하면 해금).
   *
   * **어디서** 난 실수여야 하는지는 `needWhere` 에 있습니다. 이 숫자만 찍으면 거짓말이 됩니다 —
   * seat 는 앞자리·뒷자리 실수만 세므로 BB 수비만 푸는 사람은 실수를 아무리 쌓아도 이 값이
   * 1도 줄지 않습니다.
   */
  need: number;
  /**
   * 이 축의 재료가 나오는 자리. 없으면 전체(entry)입니다. 잠겨 있을 때는 **모자란 쪽**으로 좁혀집니다.
   * 화면은 "{needWhere} 실수 N개 더"처럼 앞에 붙여 읽을 수 있는 명사구로 옵니다.
   */
  needWhere?: string;
  /** 기준선이 지금 쓴 시도 수. 그룹이 둘인 축(seat·pressure)은 **적은 쪽** — 잠금을 쥔 쪽입니다. 기준선이 없는 축(aggression)은 없음. */
  baselineTrials?: number;
  /** 기준선이 잡히기까지 더 풀어야 할 문제 수. 0 이면 충분. 그룹이 둘이면 두 그룹 부족분의 합입니다. */
  baselineNeed?: number;
  /** 잠겨 있을 때만. 왜 잠겼는지 — 화면 문구가 이 값으로 갈립니다. */
  lockedBy?: AxisLock;
  unlocked: boolean;
  level: AxisLevel;
  /** 해금됐을 때만. t 부호에 해당하는 극 라벨. */
  pole: string | null;
  /** 화면 전체에서 단 하나만 true — 다중비교로 거짓 단정이 쌓이는 걸 구조로 막습니다. */
  headline: boolean;
}

/**
 * 내가 실제로 받아 본 문제 한 줄. 성향 축의 **기준선**입니다.
 *
 * 출제 풀은 정답의 절반 이상이 폴드이고 `interestingBias` 가 비폴드 패를 더 자주 뽑습니다.
 * 그래서 실수만 세면 성향이 없는 사람도 "루즈합니다"가 나옵니다 — 내가 받은 문제의
 * 폴드-정답 비중을 분모로 깔아야 그 거짓말이 사라집니다.
 */
export interface SeenRow {
  kind: ScenarioKind;
  hero: Pos;
  answer: Action;
  /** quizSeen + pickSeen — 그 카드로 실제로 답을 낸 횟수. */
  weight: number;
}

/** 어디로 훈련을 보낼지. nav.launch 의 LaunchIntent 로 그대로 옮겨집니다. */
export interface CoachDrill {
  target: 'train' | 'quiz';
  deck?: DeckId;
  positions?: Pos[];
  scenarioId?: string;
  onlyKeys?: string[];
}

export interface PatternHit {
  /** patterns.ts 의 규칙 id. */
  id: string;
  koName: string;
  /** 이 뭉치에 속한 실수 개수 — 카드 문구에 그대로 씁니다(가중 없는 실제 횟수). */
  count: number;
  recent7d: number;
  /** 서로 다른 손패 수. 같은 패 한 장을 세 번 틀린 건 패턴이 아닙니다. */
  distinctHands: number;
  /** 관측 비중 ÷ 기대 비중. 1.5 미만이면 그냥 그 문제가 많이 나온 것뿐입니다. */
  lift: number;
  /** 정렬용 점수. */
  score: number;
  kind?: ScenarioKind;
  hero?: Pos;
  handClass?: HandClass;
  /** 정답이었던 액션. */
  from?: Action;
  /** 내가 고른 액션. */
  to?: Action;
  /** 손패 이름 최대 3개. */
  examples: string[];
  /** CardKey 최대 12개. */
  keys: string[];
  drill: CoachDrill;
}

/** 분석에 실제로 쓰인 실수 한 건 (pure 필터를 통과한 것). */
export interface CoachMistake {
  hand: string;
  handClass: HandClass;
  kind: ScenarioKind;
  hero: Pos;
  villain?: Pos;
  /** 내가 포지션을 가지는가. villain 이 없으면 false. */
  ip: boolean;
  answer: Action;
  chosen: Action;
  daysAgo: number;
  src: 'quiz' | 'train';
  key: string;
}

/**
 * 세 경로가 공유하는 단 하나의 입력. 개인을 식별할 수 있는 것은 들어가지 않습니다 — 손패와 액션뿐입니다.
 */
export interface CoachDigest {
  v: 1;
  at: number;
  /** 재료의 지문. AI 응답 캐시 키이자 규칙 코치 메모 키입니다. */
  hash: string;

  volume: {
    /** 퀴즈 누적 (stats.total / totalCorrect). */
    quizTotal: number;
    quizCorrect: number;
    /** Σ(quizSeen + pickSeen) — 실제로 답을 낸 총 횟수. 성향 축의 분모. */
    trials: number;
    /** 저장된 실수 전체 수. */
    mistakesStored: number;
    /** 분석에 실제로 쓰인 실수 수 = |M|. 화면의 모든 게이트가 이 값을 봅니다. */
    mistakesUsed: number;
    /** M 중 훈련 탭에서 온 비율 0..1. */
    trainShare: number;
    srsCards: number;
    streak: number;
    bestStreak: number;
  };

  byKind: Array<{ kind: ScenarioKind; trials: number; mistakes: number; foldAnswerShare: number }>;
  byHero: Array<{ hero: Pos; trials: number; mistakes: number; foldAnswerShare: number }>;

  axes: AxisView[];
  patterns: PatternHit[];

  /** 칭찬 한 줄의 재료. trials ≥ 15 인 kind 중 정답률 최고. 없으면 null. */
  good: { kind: ScenarioKind; trials: number; acc: number } | null;

  /**
   * srs.weakSpots(3) 그대로. 스와이프 자가평가라 실수와 다른 모집단이므로
   * 성향 축에는 쓰지 않고 목록으로만 보여 줍니다.
   */
  weakSpots: Array<{ kind: ScenarioKind; hero: Pos; unsureRate: number; rated: number; quizAcc?: number }>;

  /** 최근 실수 최대 20건. 프롬프트와 화면 목록이 같이 씁니다. */
  recentMistakes: CoachMistake[];
}

/**
 * 세 경로가 모두 뱉는 유일한 출력. 규칙 카드든 AI 카드든 같은 렌더러와 같은 린터를 탑니다.
 *
 * 길이 제한이 이 기능의 핵심 장치입니다 — 짧게 강제하면 차트 수치를 나열할 자리가 없어지고,
 * 마지막 줄을 질문으로 끝내게 하면 "이 패는 폴드입니다"로 흐르지 않습니다.
 */
export interface CoachCard {
  id: string;
  tone: 'good' | 'tendency' | 'focus';
  /** 결론 한 줄. 20자 이내. */
  title: string;
  /** 내 기록 한 줄. 반드시 내 통계여야 합니다. 30자 이내. */
  evidence: string;
  /** 생각 절차 2~3줄, 각 25자 이내. 마지막 줄은 질문으로 끝냅니다. */
  steps: string[];
  drill?: CoachDrill;
  src: 'rule' | 'ai';
}
