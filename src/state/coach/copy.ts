/**
 * 규칙 코치(L0) — CoachDigest 를 한국어 카드로 옮기는 템플릿. COACH_SPEC §4 의 L0 경로입니다.
 *
 * 여기서 하는 일은 "판단"이 아니라 "말로 푸는 것"뿐입니다. 무엇이 새는지는 axes.ts 와
 * patterns.ts 가 이미 정했고, copy.ts 는 그 결과에 문장을 입혀 `CoachCard[]` 로 내보냅니다.
 * 네트워크도 시계도 난수도 쓰지 않습니다 — 같은 다이제스트면 언제 불러도 같은 카드가
 * 나와야 합니다. 스크롤할 때마다 조언이 바뀌면 그 순간 신뢰를 잃습니다.
 *
 * 카드 순서는 칭찬 → 성향 → 집중 포인트입니다. 지적이 먼저 오면 읽다가 닫습니다.
 *
 * 만든 카드는 예외 없이 lintCards 를 지나갑니다. 자기 템플릿이 자기 린터에 걸리면
 * 그건 문구 문제가 아니라 버그이고, copy.test.ts 가 12개 규칙 전부에 대해 그걸 지킵니다.
 */
import type { ScenarioKind } from '../../poker/types';
import { lintCards } from './lint';
import { PATTERN_RULES } from './patterns';
import type { AxisId, AxisView, CoachCard, CoachDigest, PatternHit } from './types';

/**
 * 화면용 짧은 상황 이름. SCENARIO_LABEL_KO 는 괄호 설명이 붙어 있어 20·30자 한도에 안 맞습니다.
 * vs_5bet 은 앱 전체(차트 탭 · 훈련 · 홈)가 쓰는 '올인 대응'과 같은 이름을 씁니다.
 */
const KIND_SHORT_KO: Record<ScenarioKind, string> = {
  rfi: '오픈',
  vs_open: '오픈 대응',
  vs_3bet: '3벳 대응',
  vs_4bet: '4벳 대응',
  vs_5bet: '올인 대응',
  cold_4bet: '콜드 4벳',
  vs_limp: '림프 대응',
};

/* ------------------------------------------------------------------ */
/* 성향 카드                                                            */
/* ------------------------------------------------------------------ */

/**
 * 축 이름 대신 **행동**으로 제목을 답니다.
 *
 * 코치 문구는 앱의 다른 화면처럼 해요체입니다(docs/THEORY_SPEC.md §8 — 명령형 '~하세요'와 합니다체는 쓰지 않습니다).
 * axes.ts 의 `poles` 를 그대로 쓰지 않는 이유는 축 라벨에 든 `↔` 짝과 괄호(CO·BTN)가 카드 제목에 맞지 않기 때문입니다.
 * [t < 0 쪽, t > 0 쪽] 순서는 poles 와 같습니다.
 */
const AXIS_TITLE: Record<AxisId, [string, string]> = {
  aggression: ['콜과 폴드 쪽으로 기울어요', '레이즈 쪽으로 기울어요'],
  entry: ['들어갈 자리에서도 폴드해요', '폴드할 자리에 들어가요'],
  seat: ['뒷자리에서 좁게 쳐요', '앞자리에서 넓게 쳐요'],
  pressure: ['큰 팟에서 너무 폴드해요', '큰 팟에서 폴드를 못 해요'],
};

/**
 * 성향 카드의 생각 절차. 사람을 평가하지 않고 다음 판에 볼 순서만 말합니다.
 *
 * 문장마다 차트와 책(Modern Poker Theory 노트)으로 확인한 것만 씁니다.
 *  - aggression[0] '콜 범위가 있는지': 책 5장 4절 — 콜 범위가 있으면 3벳이 양극화되고, 없으면 3벳 아니면 폴드.
 *    "올릴 이유를 찾으라"는 말은 BB·BTN 처럼 콜이 정답인 칸이 많은 자리에서 맞는 콜을 밀어냅니다.
 *  - entry[0] 'UTG에서 BTN으로': entry 축은 모든 상황 · 모든 자리의 실수를 세므로 '자리가 뒤일수록 들어갈 패가 늘어요'처럼
 *    자리 전체를 말하면 SB 에서 거짓입니다(SB 의 레이즈 24% < BTN 오픈 43% — 림프 38%를 더하면 오히려 넓고, 오픈 대응도 같은
 *    오프너에게 SB 3벳 7 · 9 · 11% < BTN 콜 + 3벳 14 · 16 · 18%). 참인 구간만 말합니다.
 *  - seat: 축이 CO·BTN / UTG·HJ 를 묶어 세므로 한 자리 숫자(버튼 뒤 두 명, UTG 뒤 다섯 명)를 쓰지 않습니다.
 *    뒤에 남은 사람이 적을수록 3벳을 덜 받는다는 것은 책 4장 6절 변수 4 · 5장 2절.
 *    '지킬 수 있는 만큼만'은 책 5장 2절의 범위 단위 말입니다 — UTG 차트에도 3벳을 받으면 폴드하는 패(ATo 등)가 있습니다.
 *  - pressure[1] '베팅이 커질수록 좁아져요': 같은 줄에서 3벳 > 4벳 > 올인 폭(claims.test.ts 가 확인).
 *    3벳 전에 다음 대응을 정해 두는 것은 책 4장 10절 원칙 6.
 */
const AXIS_STEPS: Record<AxisId, [string[], string[]]> = {
  aggression: [
    ['콜하면 상대가 접을 기회가 없어요.', '먼저 이 자리에 콜 범위가 있는지 봐요.', '이 패, 올려서 갈 수는 없었나요?'],
    ['올릴 패와 접을 패를 먼저 나눠요.', '올리기 전에 접을 자리인지 봐요.', '이 패, 안 올렸으면 접었을까요?'],
  ],
  entry: [
    ['폴드는 언제나 안전해 보여요.', 'UTG에서 BTN으로 갈수록 오픈이 넓어져요.', '이 패, 자리가 뒤였어도 접었을까요?'],
    ['들어갈지부터 정해요.', '폴드가 아닐 때만 액션을 골라요.', '이 패로 플랍에서 뭘 할 생각인가요?'],
  ],
  seat: [
    ['뒷자리는 뒤에 남은 사람이 적어요.', '그만큼 3벳을 덜 받아 넓게 오픈해요.', '이 패를 UTG처럼 보고 접지 않았나요?'],
    ['앞자리는 뒤에 남은 사람이 많아요.', '3벳을 받아도 지킬 수 있는 만큼만 오픈해요.', '이 패를 BTN처럼 보고 오픈하지 않았나요?'],
  ],
  pressure: [
    ['상대도 블러프로 3벳해요.', '4벳과 콜로 갈 패를 미리 정해 둬요.', '지금 접는 이 패, 줄에서 어디쯤인가요?'],
    ['베팅이 커질수록 상대 범위는 좁아져요.', '3벳 전에 4벳이 오면 어쩔지 정해 둬요.', '이 패, 3벳할 때 이미 정해 뒀나요?'],
  ],
};

function tendencyCard(axis: AxisView): CoachCard | null {
  if (axis.t === null) return null;
  const side = axis.t < 0 ? 0 : 1;
  return {
    id: `tendency:${axis.id}`,
    tone: 'tendency',
    title: AXIS_TITLE[axis.id][side],
    evidence: `실수 ${axis.sample}개에서 나온 방향이에요`,
    steps: AXIS_STEPS[axis.id][side],
    src: 'rule',
  };
}

/* ------------------------------------------------------------------ */
/* 칭찬 카드                                                            */
/* ------------------------------------------------------------------ */

function goodCard(good: NonNullable<CoachDigest['good']>): CoachCard {
  const short = KIND_SHORT_KO[good.kind];
  // acc 가 0..1 인지 0..100 인지는 호출부마다 헷갈리기 쉬운 값입니다. 어느 쪽으로 와도
  // "정답률 7800%" 같은 카드가 나가지 않도록 여기서 한 번 접습니다.
  const pct = Math.max(0, Math.min(100, Math.round(good.acc <= 1 ? good.acc * 100 : good.acc)));
  return {
    id: `good:${good.kind}`,
    tone: 'good',
    title: `${short} 판단은 좋아요`,
    evidence: `${short} 정답률 ${pct}% · ${good.trials}문제`,
    // '순서'를 말하려면 그 순서가 무엇인지 적어야 합니다 — 책 5장 2절 · 6절: 뒤에 남은 사람과 그들의 포지션부터 봐요.
    // good 은 정답률이 가장 높은 상황일 뿐(절대 기준 없음)이라, 첫 줄은 그 사실만 말합니다.
    steps: ['가장 잘 맞히는 상황이에요.', '책은 뒤에 남은 사람과 포지션부터 봐요.', '정답률이 낮은 상황도 그 순서로 보나요?'],
    src: 'rule',
  };
}

/* ------------------------------------------------------------------ */
/* 집중 포인트 카드                                                     */
/* ------------------------------------------------------------------ */

/**
 * 내 기록 한 줄. 반드시 **내 숫자**여야 하므로 규칙 id 마다 어느 숫자를 쓸지 정해 둡니다.
 *
 * 뭉치에 속한 손패 이름(`examples`)은 일부러 넣지 않습니다. 나열이 시작되는 순간
 * 카드가 차트가 되고, 린터의 손패 두 개 한도에도 바로 걸립니다.
 */
function evidenceFor(p: PatternHit, mistakesUsed: number): string {
  switch (p.id) {
    case 'call_not_raise':
      return `3벳 자리 실수 ${p.count}번이 콜이었어요`;
    case 'enter_by_calling':
      return `오픈 대응에서 콜 실수 ${p.count}번이에요`;
    case 'fold_to_3bet':
      return `3벳을 받고 폴드한 실수 ${p.count}번이에요`;
    case 'stubborn_vs_4bet':
      return `4벳에 폴드하지 않은 실수 ${p.count}번이에요`;
    case 'early_seat_wide':
      return `UTG·HJ에서 오픈한 실수 ${p.count}번`;
    case 'late_seat_tight':
      return `CO·BTN에서 폴드한 실수 ${p.count}번`;
    case 'bb_too_wide':
      return `BB에서 들어간 실수 ${p.count}번이에요`;
    case 'bb_too_tight':
      return `BB에서 폴드한 실수 ${p.count}번이에요`;
    case 'offsuit_ace_trap':
      return `오프수트 A 실수 ${p.count}번 · 손패 ${p.distinctHands}종류`;
    case 'suited_trap':
      return `수티드 실수 ${p.count}번 · 손패 ${p.distinctHands}종류`;
    case 'premium_underplay':
      return `센 패를 약하게 간 실수 ${p.count}번`;
    default:
      // seat_hotspot 과 앞으로 늘어날 규칙. 뭉치가 전체에서 얼마나 되는지만 셉니다.
      return `실수 ${mistakesUsed}번 중 ${p.count}번이 여기예요`;
  }
}

const MAX_STEP_CHARS = 25;
const MAX_BODY_STEPS = 2;

const fits = (s: string): boolean => Array.from(s).length <= MAX_STEP_CHARS;

/**
 * 조언 문장들에서 카드의 생각 절차를 뽑습니다: 앞부분 두 줄 + 질문 한 줄.
 *
 * patterns.ts 의 advice 는 **처음부터 이 예산 안에서** 쓰여 있습니다(줄마다 25자 이하, 마지막 줄이 질문).
 * 예전에는 긴 산문을 쓰고 여기서 걸렀는데, 그러면 규칙마다 살아남는 문장이 달라져 어떤 카드는 결론만,
 * 어떤 카드는 전제만 남았습니다 — 뜻을 정하는 곳과 자르는 곳이 달라서 생긴 일이라 쓰는 쪽으로 옮겼습니다.
 * 여기 남은 필터는 그 약속이 깨졌을 때 이상한 카드를 내보내지 않기 위한 안전장치입니다.
 */
function stepsFor(advice: string[]): string[] | null {
  const question = [...advice].reverse().find((s) => s.endsWith('?') && fits(s));
  if (question === undefined) return null;

  const body = advice.filter((s) => !s.endsWith('?') && fits(s)).slice(0, MAX_BODY_STEPS);
  if (body.length === 0) return null;
  return [...body, question];
}

function focusCard(p: PatternHit, mistakesUsed: number): CoachCard | null {
  const rule = PATTERN_RULES.find((r) => r.id === p.id);
  if (!rule) return null;
  const steps = stepsFor(rule.advice);
  if (!steps) return null;
  return {
    id: `focus:${p.id}`,
    tone: 'focus',
    title: p.koName,
    evidence: evidenceFor(p, mistakesUsed),
    steps,
    drill: p.drill,
    src: 'rule',
  };
}

/* ------------------------------------------------------------------ */
/* 진입점                                                              */
/* ------------------------------------------------------------------ */

/** 화면이 세로로 쌓는 카드 수. 넘치면 읽지 않고 넘깁니다. */
const MAX_FOCUS = 3;

/**
 * 규칙 코치의 유일한 진입점. 카드가 한 장도 안 나오면 빈 배열을 돌려주고,
 * 그때 화면은 콜드 스타트(SPEC §7)를 그립니다 — 여기서 빈자리를 메우려고
 * 일반론을 지어내면 "내 기록"이라는 카드의 전제가 깨집니다.
 */
export function localCoach(d: CoachDigest): CoachCard[] {
  const cards: CoachCard[] = [];

  if (d.good) cards.push(goodCard(d.good));

  // headline 은 화면 전체에서 최대 하나입니다(SPEC §1). 없으면 성향 카드를 만들지 않습니다 —
  // 표본이 애매한 축까지 카드로 만들면 단정이 쌓입니다.
  const headline = d.axes.find((a) => a.headline);
  if (headline) {
    const card = tendencyCard(headline);
    if (card) cards.push(card);
  }

  for (const p of d.patterns.slice(0, MAX_FOCUS)) {
    const card = focusCard(p, d.volume.mistakesUsed);
    if (card) cards.push(card);
  }

  return lintCards(cards);
}
