/**
 * 린터와 규칙 코치 템플릿 테스트.
 *
 * 여기서 가장 중요한 건 마지막 묶음입니다 — **localCoach 가 만든 카드가 전부 자기 린터를
 * 통과하는가**. 템플릿과 린터는 같은 사람이 같은 날 쓰기 때문에 서로 어긋나도 아무도
 * 모르고, 그 순간 화면에서 카드가 조용히 사라집니다. 12개 규칙 전부를 합성 다이제스트로 돌립니다.
 */
import { describe, expect, it } from 'vitest';
import { localCoach } from '../copy';
import { lintCards, lintCoachText } from '../lint';
import { PATTERN_RULES } from '../patterns';
import type { AxisId, AxisView, CoachCard, CoachDigest, CoachDrill, PatternHit } from '../types';

/* ------------------------------------------------------------------ */
/* 합성 재료                                                            */
/* ------------------------------------------------------------------ */

function card(over: Partial<CoachCard> = {}): CoachCard {
  return {
    id: 'test',
    tone: 'focus',
    title: '뒷자리에서 너무 좁게 칩니다',
    evidence: 'CO·BTN에서 접은 실수 12번',
    steps: ['버튼 뒤에는 블라인드 두 명뿐입니다.', '자리가 뒤로 갈수록 기준을 내리세요.', '이 패를 UTG처럼 보고 접었나요?'],
    src: 'rule',
    ...over,
  };
}

function axis(id: AxisId, over: Partial<AxisView> = {}): AxisView {
  return {
    id,
    koLabel: '수동 ↔ 공격',
    poles: ['콜·폴드 쪽으로 샌다', '레이즈·3벳 쪽으로 샌다'],
    t: 0.4,
    z: 2.6,
    sample: 26,
    need: 0,
    unlocked: true,
    level: 'confident',
    pole: '레이즈·3벳 쪽으로 샌다',
    headline: false,
    ...over,
  };
}

function hit(id: string, over: Partial<PatternHit> = {}): PatternHit {
  const rule = PATTERN_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`규칙이 없습니다: ${id}`);
  return {
    id,
    koName: rule.koName,
    count: 12,
    recent7d: 4,
    distinctHands: 5,
    lift: 2.1,
    score: 25,
    examples: ['AJo', 'KTs', 'A8o'],
    keys: [],
    drill: { target: 'train', deck: 'rfi', positions: ['UTG'] },
    ...over,
  };
}

function digest(over: Partial<CoachDigest> = {}): CoachDigest {
  return {
    v: 1,
    at: 1_700_000_000_000,
    hash: 'test-hash',
    volume: {
      quizTotal: 300,
      quizCorrect: 220,
      trials: 420,
      mistakesStored: 60,
      mistakesUsed: 42,
      trainShare: 0.3,
      srsCards: 180,
      streak: 4,
      bestStreak: 11,
    },
    byKind: [],
    byHero: [],
    axes: [],
    patterns: [],
    good: null,
    weakSpots: [],
    recentMistakes: [],
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* 린터 — 걸러야 하는 것                                                */
/* ------------------------------------------------------------------ */

describe('lintCoachText 가 버리는 카드', () => {
  const rejects: Array<[string, CoachCard]> = [
    ['금지어(GTO)', card({ steps: ['GTO 기준으로 보세요.', '이 패, 다음엔 어떻게 할까요?'] })],
    ['금지어(솔버)', card({ steps: ['솔버는 여기서 콜을 많이 씁니다.', '이 패, 다음엔 어떻게 할까요?'] })],
    ['금지어(에퀴티)', card({ steps: ['에퀴티가 모자랍니다.', '이 패, 다음엔 어떻게 할까요?'] })],
    ['금지어(빈도)', card({ steps: ['빈도를 섞어서 가세요.', '이 패, 다음엔 어떻게 할까요?'] })],
    ['금지어(제목)', card({ title: 'EV가 새고 있습니다' })],
    ['레인지 표기', card({ steps: ['ATo+ 부터 열면 됩니다.', '이 패, 다음엔 어떻게 할까요?'] })],
    ['레인지 퍼센트', card({ evidence: '상위 18% 만 열고 있어요' })],
    [
      '손패 이름 3개',
      card({ steps: ['AKs, QQ, T9s 를 보세요.', '이 패, 다음엔 어떻게 할까요?'] }),
    ],
    ['스택 깊이', card({ steps: ['스택이 깊으면 다르게 갑니다.', '이 패, 다음엔 어떻게 할까요?'] })],
    ['핸드 단위 단정', card({ steps: ['AJo는 UTG에서 폴드입니다.', '이 패, 다음엔 어떻게 할까요?'] })],
    ['제목 21자', card({ title: '뒷자리에서 너무 좁게 치고 있는 것 같아요' })],
    ['내 기록 31자', card({ evidence: '오픈 대응에서 접은 실수가 열두 번이고 그중 절반이 뒷자리예요' })],
    [
      '생각 절차 26자',
      card({ steps: ['버튼 뒤에는 블라인드가 두 명밖에 남아 있지 않습니다.', '이 패, 다음엔 어떻게 할까요?'] }),
    ],
    ['생각 절차 1줄', card({ steps: ['이 패, 다음엔 어떻게 할까요?'] })],
    [
      '생각 절차 4줄',
      card({ steps: ['한 줄.', '두 줄.', '세 줄.', '이 패, 다음엔 어떻게 할까요?'] }),
    ],
    ['마지막 줄이 질문이 아님', card({ steps: ['버튼 뒤에는 두 명뿐입니다.', 'BTN에서는 더 넓게 여세요.'] })],
    ['느낌표', card({ steps: ['자리를 먼저 보세요!', '이 패, 다음엔 어떻게 할까요?'] })],
    ['이모지', card({ title: '뒷자리에서 좁습니다 🙂' })],
    ['퍼센트(생각 절차)', card({ steps: ['상황의 34% 에서 새고 있어요.', '이 패, 다음엔 어떻게 할까요?'] })],
    ['빈 제목', card({ title: '   ' })],
  ];

  for (const [name, bad] of rejects) {
    it(`${name} 은 버린다`, () => {
      expect(lintCoachText(bad)).not.toBeNull();
    });
  }

  it('버려진 카드는 lintCards 결과에 남지 않는다', () => {
    const kept = lintCards([card(), card({ id: 'bad', title: 'GTO 기준으로 보세요' })]);
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe('test');
  });
});

/* ------------------------------------------------------------------ */
/* 린터 — 통과해야 하는 것                                              */
/* ------------------------------------------------------------------ */

describe('lintCoachText 가 통과시키는 카드', () => {
  it('정상 카드는 통과한다', () => {
    expect(lintCoachText(card())).toBeNull();
  });

  it('내 기록 줄의 퍼센트는 허용한다', () => {
    expect(lintCoachText(card({ evidence: '오픈 대응 정답률 78% · 42문제' }))).toBeNull();
  });

  it('스타일 가이드가 못박은 확률은 생각 절차에서도 허용한다', () => {
    const ok = card({ steps: ['작은 페어가 셋이 될 확률은 12% 입니다.', '이 패, 셋이 안 나오면 어쩌죠?'] });
    expect(lintCoachText(ok)).toBeNull();
  });

  it('손패 이름 두 개까지는 통과한다', () => {
    const ok = card({ steps: ['AK 는 KK 를 만나면 밀립니다.', '이 패, 상대가 더 셀 수도 있나요?'] });
    expect(lintCoachText(ok)).toBeNull();
  });

  it('내 기록 줄의 횟수는 손패 이름으로 세지 않는다', () => {
    expect(lintCoachText(card({ evidence: '실수 42번 중 22번이 여기예요' }))).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* localCoach                                                          */
/* ------------------------------------------------------------------ */

describe('localCoach', () => {
  it('재료가 없으면 빈 배열을 낸다', () => {
    expect(localCoach(digest())).toEqual([]);
  });

  it('칭찬 카드가 맨 앞에 온다', () => {
    const cards = localCoach(
      digest({
        good: { kind: 'vs_4bet', trials: 40, acc: 0.78 },
        patterns: [hit('late_seat_tight')],
      }),
    );
    expect(cards[0].tone).toBe('good');
    expect(cards[0].evidence).toContain('78%');
    expect(cards.map((c) => c.tone)).toEqual(['good', 'focus']);
  });

  it('headline 축이 없으면 성향 카드를 만들지 않는다', () => {
    const cards = localCoach(digest({ axes: [axis('aggression'), axis('entry')] }));
    expect(cards).toEqual([]);
  });

  it('headline 축이 있으면 성향 카드를 한 장 만든다', () => {
    const cards = localCoach(digest({ axes: [axis('entry', { headline: true, t: -0.5 })] }));
    expect(cards).toHaveLength(1);
    expect(cards[0].tone).toBe('tendency');
    expect(cards[0].id).toBe('tendency:entry');
    expect(cards[0].evidence).toContain('26');
  });

  it('t 의 부호에 따라 반대쪽 제목이 나온다', () => {
    const neg = localCoach(digest({ axes: [axis('seat', { headline: true, t: -0.6 })] }));
    const pos = localCoach(digest({ axes: [axis('seat', { headline: true, t: 0.6 })] }));
    expect(neg[0].title).not.toBe(pos[0].title);
  });

  it('집중 포인트는 최대 3장이다', () => {
    const cards = localCoach(
      digest({
        patterns: [
          hit('call_not_raise'),
          hit('enter_by_calling'),
          hit('fold_to_3bet'),
          hit('bb_too_wide'),
        ],
      }),
    );
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.id)).toEqual(['focus:call_not_raise', 'focus:enter_by_calling', 'focus:fold_to_3bet']);
  });

  it('집중 포인트는 훈련 버튼 정보를 그대로 들고 간다', () => {
    const drill: CoachDrill = { target: 'quiz', onlyKeys: ['vs_open:BB:BTN|KTo'] };
    const cards = localCoach(digest({ patterns: [hit('suited_trap', { drill })] }));
    expect(cards[0].drill).toEqual(drill);
  });

  it('같은 다이제스트는 같은 카드를 낸다', () => {
    const d = digest({
      good: { kind: 'vs_open', trials: 60, acc: 0.71 },
      axes: [axis('aggression', { headline: true })],
      patterns: [hit('offsuit_ace_trap'), hit('premium_underplay')],
    });
    expect(localCoach(d)).toEqual(localCoach(d));
  });

  it('모든 규칙이 카드를 만들고, 그 카드가 자기 린터를 통과한다', () => {
    for (const rule of PATTERN_RULES) {
      const cards = localCoach(digest({ patterns: [hit(rule.id)] }));
      expect(cards, `${rule.id} 카드가 만들어지지 않았습니다`).toHaveLength(1);
      expect(lintCoachText(cards[0]), `${rule.id} 카드가 린터에 걸렸습니다`).toBeNull();
      expect(cards[0].steps[cards[0].steps.length - 1].endsWith('?')).toBe(true);
    }
  });

  it('모든 축·모든 부호의 성향 카드가 린터를 통과한다', () => {
    const ids: AxisId[] = ['aggression', 'entry', 'seat', 'pressure'];
    for (const id of ids) {
      for (const t of [-0.8, 0.8]) {
        const cards = localCoach(digest({ axes: [axis(id, { headline: true, t })] }));
        expect(cards, `${id} ${t}`).toHaveLength(1);
        expect(lintCoachText(cards[0]), `${id} ${t} 카드가 린터에 걸렸습니다`).toBeNull();
      }
    }
  });

  it('모든 상황의 칭찬 카드가 린터를 통과한다', () => {
    const kinds = ['rfi', 'vs_open', 'vs_3bet', 'vs_4bet', 'vs_5bet', 'cold_4bet'] as const;
    for (const kind of kinds) {
      const cards = localCoach(digest({ good: { kind, trials: 999, acc: 1 } }));
      expect(cards, kind).toHaveLength(1);
      expect(lintCoachText(cards[0]), `${kind} 칭찬 카드가 린터에 걸렸습니다`).toBeNull();
    }
  });

  it('실수 횟수가 커져도 내 기록 줄이 한도를 넘지 않는다', () => {
    const big = digest({
      volume: { ...digest().volume, mistakesUsed: 300 },
      patterns: PATTERN_RULES.map((r) => hit(r.id, { count: 299, distinctHands: 99 })),
    });
    for (const rule of PATTERN_RULES) {
      const cards = localCoach(digest({ ...big, patterns: [hit(rule.id, { count: 299, distinctHands: 99 })] }));
      expect(lintCoachText(cards[0]), `${rule.id} 내 기록 줄이 길어졌습니다`).toBeNull();
    }
  });
});
