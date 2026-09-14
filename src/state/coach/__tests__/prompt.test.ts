/**
 * 프롬프트와 응답 파싱의 계약을 고정합니다. 네트워크를 타는 것은 하나도 없습니다
 * (`askClaude` 는 SDK 를 동적 import 하므로 여기서 부르지 않습니다).
 *
 * 금지어·레인지 표기 검사는 **요약문 쪽에만** 겁니다. 시스템 규칙 전문에는 "GTO, 솔버, EV,
 * 에퀴티" 목록과 "레인지 표기(ATo+, KJs+ 같은 것)" 예시가 금지 목록으로 그대로 들어 있어서,
 * 프롬프트 전체에 같은 검사를 걸면 규칙문 자체가 걸립니다. 데이터로 만들어지는 부분,
 * 즉 "# 이 사람의 기록" 뒤쪽이 이 검사가 실제로 지켜야 하는 자리입니다.
 */
import { describe, expect, it } from 'vitest';

import { classifyHand } from '../../../poker/explain';
import type { Action, Pos, ScenarioKind } from '../../../poker/types';
import { parseCoachCards } from '../claude';
import { COACH_COPY_PROMPT, COACH_SYSTEM_PROMPT, buildDigestSummary, buildPrompt } from '../prompt';
import type { AxisView, CoachDigest, CoachMistake } from '../types';

const RECORD_HEADING = '# 이 사람의 기록';

/** SPEC §4 린터와 같은 금지어. 여기서 한 번 더 적는 건 프롬프트 쪽이 따로 지켜야 할 계약이기 때문입니다. */
const BANNED_KO = /솔버|에퀴티|빈도|폴라|양극화|리니어|밸런스|콤보|노드|시뮬/;
const BANNED_EN = /\b(?:gto|solver|ev|mdf)\b/i;
const RANGE_NOTATION = /[AKQJT2-9][AKQJT2-9][so]?\+/;

function recordPart(prompt: string): string {
  const at = prompt.indexOf(RECORD_HEADING);
  expect(at).toBeGreaterThan(0);
  return prompt.slice(at + RECORD_HEADING.length);
}

function axis(p: Partial<AxisView> & Pick<AxisView, 'id' | 'koLabel' | 'poles'>): AxisView {
  return {
    t: null,
    z: null,
    sample: 0,
    need: 12,
    unlocked: false,
    level: 'locked',
    pole: null,
    headline: false,
    ...p,
  };
}

function mistake(p: { hand: string; kind: ScenarioKind; hero: Pos; answer: Action; chosen: Action; daysAgo: number }): CoachMistake {
  return {
    hand: p.hand,
    handClass: classifyHand(p.hand),
    kind: p.kind,
    hero: p.hero,
    ip: false,
    answer: p.answer,
    chosen: p.chosen,
    daysAgo: p.daysAgo,
    src: 'quiz',
    key: `${p.kind}:${p.hero}|${p.hand}`,
  };
}

function digest(mistakesUsed: number): CoachDigest {
  return {
    v: 1,
    at: 1_700_000_000_000,
    hash: 'h1',
    volume: {
      quizTotal: 320,
      quizCorrect: 231,
      trials: 480,
      mistakesStored: mistakesUsed,
      mistakesUsed,
      trainShare: 0.4,
      srsCards: 180,
      streak: 6,
      bestStreak: 19,
    },
    byKind: [
      { kind: 'rfi', trials: 180, mistakes: 12, foldAnswerShare: 0.7 },
      { kind: 'vs_3bet', trials: 90, mistakes: 30, foldAnswerShare: 0.5 },
    ],
    byHero: [
      { hero: 'UTG', trials: 120, mistakes: 10, foldAnswerShare: 0.8 },
      { hero: 'BB', trials: 80, mistakes: 24, foldAnswerShare: 0.36 },
    ],
    axes: [
      axis({
        id: 'aggression',
        koLabel: '수동 ↔ 공격',
        poles: ['콜·폴드 쪽으로 샌다', '레이즈·3벳 쪽으로 샌다'],
        t: 0.62,
        z: 3.1,
        sample: 26,
        need: 0,
        unlocked: true,
        level: 'confident',
        pole: '레이즈·3벳 쪽으로 샌다',
        headline: true,
      }),
      axis({ id: 'entry', koLabel: '타이트 ↔ 루즈', poles: ['접어야 할 자리는 잘 접는다', '접어야 할 자리에 들어간다'], need: 8 }),
    ],
    patterns: [
      {
        id: 'call_not_raise',
        koName: '3벳할 자리에서 콜합니다',
        count: 22,
        recent7d: 5,
        distinctHands: 9,
        lift: 2.1,
        score: 40,
        kind: 'vs_open',
        examples: ['AJo', 'KTs', 'A8o'],
        keys: ['vs_open:BB:BTN|AJo'],
        drill: { target: 'train', deck: 'vs_open', positions: ['BB'] },
      },
    ],
    good: { kind: 'vs_4bet', trials: 24, acc: 0.78 },
    weakSpots: [{ kind: 'vs_open', hero: 'BB', unsureRate: 0.62, rated: 20 }],
    recentMistakes: [
      mistake({ hand: 'AJo', kind: 'vs_open', hero: 'BB', answer: 'fold', chosen: 'call', daysAgo: 0 }),
      mistake({ hand: 'KTs', kind: 'vs_3bet', hero: 'CO', answer: 'fourbet', chosen: 'fold', daysAgo: 1 }),
      mistake({ hand: '77', kind: 'rfi', hero: 'UTG', answer: 'fold', chosen: 'raise', daysAgo: 4 }),
    ],
  };
}

describe('buildPrompt', () => {
  it('시스템 규칙 전문과 기록을 이어 붙인다', () => {
    const out = buildPrompt(digest(42));
    expect(out.startsWith(COACH_COPY_PROMPT)).toBe(true);
    expect(out).toContain(RECORD_HEADING);
    expect(out).toContain(buildDigestSummary(digest(42)));
  });

  it('기록 쪽에는 금지어도 레인지 표기도 없다', () => {
    const record = recordPart(buildPrompt(digest(42)));
    expect(BANNED_KO.test(record)).toBe(false);
    expect(BANNED_EN.test(record)).toBe(false);
    expect(RANGE_NOTATION.test(record)).toBe(false);
  });

  it('기록에 JSON 덩어리를 붙이지 않는다', () => {
    const record = recordPart(buildPrompt(digest(42)));
    expect(record).not.toContain('"volume"');
    expect(record).not.toContain('{"');
  });

  it('해금된 축의 방향을 한국어로 적는다', () => {
    const record = recordPart(buildPrompt(digest(42)));
    expect(record).toContain('수동 ↔ 공격');
    expect(record).toContain('레이즈·3벳 쪽으로 샌다');
    // 잠긴 축은 지우지 않고 "몇 개 더 필요한지"로 적습니다.
    expect(record).toContain('타이트 ↔ 루즈');
    expect(record).toContain('실수 8개');
  });

  it('사람이 읽는 표로 최근 실수를 적는다', () => {
    const record = recordPart(buildPrompt(digest(42)));
    expect(record).toContain('| 손패 | 상황 | 내 자리 | 정답 | 내 선택 | 언제 |');
    expect(record).toContain('| AJo |');
    expect(record).toContain('오늘');
    expect(record).toContain('어제');
  });

  it('표본이 적으면 단정하지 말라고 지시한다', () => {
    expect(buildPrompt(digest(12))).toContain('단정하지 말고');
  });

  it('표본이 넉넉하면 그 지시를 넣지 않는다', () => {
    expect(buildPrompt(digest(42))).not.toContain('단정하지 말고');
  });
});

/* ------------------------------------------------------------------------------------------------
 * parseCoachCards
 * ---------------------------------------------------------------------------------------------- */

interface RawCard {
  tone: string;
  title: string;
  evidence: string;
  steps: string[];
}

const GOOD_A: RawCard = {
  tone: 'focus',
  title: '뒷자리에서 너무 좁게 칩니다',
  evidence: '뒷자리 실수 22개가 폴드였어요',
  steps: ['버튼 뒤에는 두 명뿐이에요', '자리가 뒤면 기준을 내리세요', '앞자리로 착각한 건 아닌가요?'],
};

const GOOD_B: RawCard = {
  tone: 'good',
  title: '4벳 대응은 잘하고 있어요',
  evidence: '4벳 대응 24번 중 78% 정답',
  steps: ['센 패만 남기고 다 접었어요', '이 습관을 다른 자리에도 쓸까요?'],
};

const json = (cards: RawCard[]): string => JSON.stringify(cards, null, 2);

describe('parseCoachCards', () => {
  it('코드 펜스가 붙어 와도 카드가 나온다', () => {
    const cards = parseCoachCards(`\`\`\`json\n${json([GOOD_A, GOOD_B])}\n\`\`\``);
    expect(cards).toHaveLength(2);
    expect(cards[0].src).toBe('ai');
    expect(cards[0].title).toBe(GOOD_A.title);
  });

  it('앞뒤 인사말이 붙어 와도 카드가 나온다', () => {
    const cards = parseCoachCards(`알겠습니다. 아래가 카드예요.\n\n${json([GOOD_A, GOOD_B])}\n\n도움이 되길 바라요.`);
    expect(cards).toHaveLength(2);
  });

  it('tone 이 없거나 낯설면 focus 로 둔다', () => {
    const cards = parseCoachCards(json([{ ...GOOD_A, tone: 'nonsense' }, GOOD_B]));
    expect(cards[0].tone).toBe('focus');
  });

  it('린터에 걸리는 카드는 버리고 나머지만 남긴다', () => {
    const rangeCard: RawCard = {
      tone: 'focus',
      title: '앞자리를 넓게 엽니다',
      evidence: '앞자리 실수 14개예요',
      steps: ['ATo+ 부터만 여세요', '뒤에 다섯 명이 남았나요?'],
    };
    const cards = parseCoachCards(json([GOOD_A, rangeCard, GOOD_B]));
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.title)).not.toContain(rangeCard.title);
  });

  it('통과가 2장 미만이면 통째로 버린다', () => {
    const gtoCard: RawCard = {
      tone: 'focus',
      title: '3벳을 다 접습니다',
      evidence: '3벳 대응 실수 30개예요',
      steps: ['GTO 기준으로 보세요', '이 패는 그 줄 어디쯤인가요?'],
    };
    const longTitle: RawCard = { ...GOOD_B, title: '아주 길어서 스무 자를 확실하게 넘겨 버리는 제목입니다' };
    expect(parseCoachCards(json([GOOD_A, gtoCard, longTitle]))).toEqual([]);
  });

  it('깨진 JSON 이면 던지지 않고 빈 배열', () => {
    expect(parseCoachCards('[{ "tone": "focus", "title": ')).toEqual([]);
    expect(parseCoachCards('미안하지만 답을 못 만들겠어요.')).toEqual([]);
    expect(parseCoachCards('')).toEqual([]);
  });

  it('배열이 아니면 빈 배열', () => {
    expect(parseCoachCards('{ "cards": [] }')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* 경로마다 출력 형식이 달라야 한다                                       */
/* ------------------------------------------------------------------ */

describe('출력 형식은 경로마다 다르다', () => {
  it('복사 경로는 평문을 시킨다 — 그 답을 파싱하는 코드가 없다', () => {
    // 사용자가 Claude·ChatGPT 화면에서 눈으로 읽는 답이다. 앱으로 돌아오는 길이 없으므로
    // JSON 을 시킬 이유가 없고, 시키면 읽기만 나빠진다.
    expect(COACH_COPY_PROMPT).toContain('한국어 글로 답해라');
    expect(COACH_COPY_PROMPT).toContain('눈으로 읽는다');
    expect(COACH_COPY_PROMPT).not.toContain('JSON 배열');
    expect(COACH_COPY_PROMPT).not.toContain('"tone"');
    // 카드 상자가 없으니 길이 제한도 뜻이 없다.
    expect(COACH_COPY_PROMPT).not.toContain('20자 이내');
    expect(COACH_COPY_PROMPT).not.toContain('25자 이내');
    // 채팅이라 이어서 물어볼 수 있다는 점을 알려 준다 — 이 경로의 장점이다.
    expect(COACH_COPY_PROMPT).toContain('물어보라고');
  });

  it('내 키 경로는 JSON 을 시킨다 — parseCoachCards 가 그걸 먹는다', () => {
    expect(COACH_SYSTEM_PROMPT).toContain('JSON 배열');
    expect(COACH_SYSTEM_PROMPT).toContain('"tone"');
    expect(COACH_SYSTEM_PROMPT).toContain('20자 이내');
  });

  it('두 경로가 규칙은 똑같이 나눠 쓴다 — 개념적 조언이라는 제약은 형식과 무관하다', () => {
    for (const rule of [
      '차트를 다시 읽어 주지 마라',
      'GTO, 솔버, EV, 에퀴티',
      '레인지 표기(ATo+, KJs+ 같은 것)',
      '사람을 평가하지 마라',
      '데이터에 없는 건 지어내지 마라',
    ]) {
      expect(COACH_COPY_PROMPT, rule).toContain(rule);
      expect(COACH_SYSTEM_PROMPT, rule).toContain(rule);
    }
    // 마지막을 질문으로 끝내라는 요구도 양쪽에 있다.
    expect(COACH_COPY_PROMPT).toContain('질문');
    expect(COACH_SYSTEM_PROMPT).toContain('질문');
  });

  it('복사 경로의 지시에도 금지어가 새어 나오지 않는다', () => {
    // 금지어 목록 자체에는 그 말들이 나오지만, 그건 "쓰지 마라"는 줄이다.
    const body = COACH_COPY_PROMPT.split('## 출력 형식')[1] ?? '';
    for (const bad of ['GTO', '솔버', '에퀴티', 'MDF']) expect(body).not.toContain(bad);
  });
});
