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

/** 화면용 짧은 상황 이름. SCENARIO_LABEL_KO 는 괄호 설명이 붙어 있어 20·30자 한도에 안 맞습니다. */
const KIND_SHORT_KO: Record<ScenarioKind, string> = {
  rfi: '오픈',
  vs_open: '오픈 대응',
  vs_3bet: '3벳 대응',
  vs_4bet: '4벳 대응',
  vs_5bet: '5벳 대응',
  cold_4bet: '콜드 4벳',
};

/* ------------------------------------------------------------------ */
/* 성향 카드                                                            */
/* ------------------------------------------------------------------ */

/**
 * 축 이름 대신 **행동**으로 제목을 답니다.
 *
 * axes.ts 의 `poles` 를 그대로 쓰지 않는 이유는 둘입니다. 거기 문장은 "~다" 로 끝나 앱의
 * 말투(~합니다/~예요)와 어긋나고, 축 라벨에 든 `↔` 는 카드 문구에 들어갈 기호가 아닙니다.
 * [t < 0 쪽, t > 0 쪽] 순서는 poles 와 같습니다.
 */
const AXIS_TITLE: Record<AxisId, [string, string]> = {
  aggression: ['콜과 폴드로 기웁니다', '레이즈 쪽으로 기웁니다'],
  entry: ['들어갈 자리도 접습니다', '접을 자리에 들어갑니다'],
  seat: ['뒷자리에서 좁게 칩니다', '앞자리에서 헐겁습니다'],
  pressure: ['큰 팟에서 너무 접습니다', '큰 팟에서 못 접습니다'],
};

/** 성향 카드의 생각 절차. 사람을 평가하지 않고 다음 판에 볼 순서만 말합니다. */
const AXIS_STEPS: Record<AxisId, [string[], string[]]> = {
  aggression: [
    ['콜은 주도권을 상대에게 넘깁니다.', '들어가기로 정했으면 올릴 이유를 찾으세요.', '이 패, 올려서 갈 수는 없었나요?'],
    ['올릴 패와 접을 패를 먼저 나눕니다.', '올리기 전에 접을 자리인지 보세요.', '이 패, 안 올렸으면 접었을까요?'],
  ],
  entry: [
    ['접는 건 언제나 안전해 보입니다.', '자리가 뒤로 갈수록 기준을 내리세요.', '이 패, 자리가 뒤였어도 접었을까요?'],
    ['들어갈지부터 먼저 정하세요.', '폴드가 아닐 때만 액션을 고릅니다.', '이 패로 플랍에서 뭘 할 생각인가요?'],
  ],
  seat: [
    ['버튼 뒤에는 블라인드 두 명뿐입니다.', '자리가 뒤로 갈수록 기준을 한 칸 내리세요.', '이 패를 UTG처럼 보고 접지 않았나요?'],
    ['앞자리는 뒤에 남은 사람이 많습니다.', '앞자리에서는 기준을 한 칸 올리세요.', '이 패, 뒤에 다섯 명이 있어도 열까요?'],
  ],
  pressure: [
    ['상대도 블러프로 3벳을 합니다.', '4벳과 콜로 남길 패를 미리 정하세요.', '지금 접는 이 패, 줄에서 어디쯤인가요?'],
    ['4벳은 블러프가 훨씬 적습니다.', '3벳 전에 4벳이 오면 어쩔지 정하세요.', '이 패, 3벳할 때 이미 정해 뒀나요?'],
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
    steps: ['여기서 보는 순서는 이미 잡혔어요.', '같은 순서를 약한 자리에도 써 보세요.', '다른 자리에서도 같은 순서로 보고 있나요?'],
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
      return `3벳을 맞고 접은 실수 ${p.count}번이에요`;
    case 'stubborn_vs_4bet':
      return `4벳에 안 접은 실수 ${p.count}번이에요`;
    case 'early_seat_wide':
      return `UTG·HJ에서 들어간 실수 ${p.count}번`;
    case 'late_seat_tight':
      return `CO·BTN에서 접은 실수 ${p.count}번`;
    case 'bb_too_wide':
      return `BB에서 들어간 실수 ${p.count}번이에요`;
    case 'bb_too_tight':
      return `BB에서 접은 실수 ${p.count}번이에요`;
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
