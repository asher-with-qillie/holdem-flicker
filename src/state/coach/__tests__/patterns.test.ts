/**
 * patterns.ts 의 게이트 네 개(표본·서로 다른 손패·lift·중복 제거)와 보루 규칙을 고정합니다.
 *
 * 문구 자체는 거의 검사하지 않습니다 — 조언은 사람이 고치는 것이고, 코드가 지켜야 하는 건
 * "마지막 줄이 질문인가"와 "차트를 읽어 주는 말이 섞여 있지 않은가" 둘뿐입니다.
 */
import { describe, expect, it } from 'vitest';
import { classifyHand } from '../../../poker/explain';
import { POSITIONS, SCENARIO_ACTIONS, type Action, type Pos, type ScenarioKind } from '../../../poker/types';
import { PATTERN_RULES, findPatterns } from '../patterns';
import type { CoachMistake, SeenRow } from '../types';

const NOW = 1_700_000_000_000;

/** 어느 규칙에도 걸리지 않는 손패만 씁니다 — junk 는 클래스 규칙 세 개의 목록에 없습니다. */
const JUNK = ['72o', '82o', '92o', '32o', '42o', '52o', '62o', '73o', '83o', '93o', '43o', '53o', '63o', '74o'];

function mistake(p: {
  hand: string;
  kind: ScenarioKind;
  hero: Pos;
  answer: Action;
  chosen: Action;
  daysAgo?: number;
}): CoachMistake {
  return {
    hand: p.hand,
    handClass: classifyHand(p.hand),
    kind: p.kind,
    hero: p.hero,
    ip: false,
    answer: p.answer,
    chosen: p.chosen,
    daysAgo: p.daysAgo ?? 30, // 기본은 '오래된 실수' — w=1 이라 점수가 손으로 따라갈 수 있습니다
    src: 'quiz',
    key: `${p.kind}:${p.hero}|${p.hand}`,
  };
}

/** vs_open 에서 폴드할 자리를 콜한 실수 n건. hand 는 전부 다릅니다. */
function callInsteadOfFold(n: number, hero: Pos): CoachMistake[] {
  return Array.from({ length: n }, (_, i) =>
    mistake({ hand: JUNK[i % JUNK.length], kind: 'vs_open', hero, answer: 'fold', chosen: 'call' }),
  );
}

/** 어떤 규칙에도 걸리지 않는 채움용 실수 (rfi·SB·junk). */
function filler(n: number): CoachMistake[] {
  return Array.from({ length: n }, (_, i) =>
    mistake({ hand: JUNK[i % JUNK.length], kind: 'rfi', hero: 'SB', answer: 'raise', chosen: 'fold' }),
  );
}

/** 모든 (kind, hero, answer) 를 똑같이 받은 사람. 어떤 규칙도 기대 비중이 특별히 높지 않습니다. */
function seenSpread(weight = 10): SeenRow[] {
  const kinds: ScenarioKind[] = ['rfi', 'vs_open', 'vs_3bet', 'vs_4bet', 'vs_5bet'];
  const rows: SeenRow[] = [];
  for (const kind of kinds) {
    for (const hero of POSITIONS) {
      for (const answer of SCENARIO_ACTIONS[kind]) rows.push({ kind, hero, answer, weight });
    }
  }
  return rows;
}

const ids = (ms: CoachMistake[], seen: SeenRow[]): string[] => findPatterns(ms, seen, NOW).map((p) => p.id);

describe('findPatterns 게이트', () => {
  it('실수가 없으면 아무 카드도 만들지 않는다', () => {
    expect(findPatterns([], seenSpread(), NOW)).toEqual([]);
  });

  it('같은 패를 세 번 반복해 틀린 건 패턴이 아니다', () => {
    const repeated = ['72o', '72o', '72o', '82o', '82o', '82o'].map((hand) =>
      mistake({ hand, kind: 'vs_open', hero: 'CO', answer: 'fold', chosen: 'call' }),
    );
    expect(ids(repeated, seenSpread())).not.toContain('enter_by_calling');

    // 손패만 서로 다르게 하면 같은 개수로 통과합니다 — 막고 있는 게 표본 수가 아니라 다양성임을 고정합니다.
    expect(ids(callInsteadOfFold(6, 'CO'), seenSpread())).toContain('enter_by_calling');
  });

  it('그 문제가 많이 나왔을 뿐이면 lift 게이트에 걸린다', () => {
    // 받은 문제가 전부 "vs_open 에서 폴드가 정답" 이면, 무작위로 틀려도 절반은 콜로 틀립니다.
    const skewed: SeenRow[] = [{ kind: 'vs_open', hero: 'CO', answer: 'fold', weight: 1000 }];
    const ms = [...callInsteadOfFold(8, 'CO'), ...filler(8)];
    expect(ids(ms, skewed)).not.toContain('enter_by_calling');

    // 같은 실수라도 문제를 골고루 받았다면 이건 진짜 쏠림입니다.
    expect(ids(ms, seenSpread())).toContain('enter_by_calling');
  });

  it('기대 비중이 0이면(그 문제를 받은 적이 없으면) 그 규칙은 건너뛴다', () => {
    const onlyRfi: SeenRow[] = [{ kind: 'rfi', hero: 'SB', answer: 'fold', weight: 500 }];
    expect(ids(callInsteadOfFold(8, 'CO'), onlyRfi)).not.toContain('enter_by_calling');
  });

  it('표본이 minSample 에 못 미치면 내지 않는다', () => {
    expect(ids(callInsteadOfFold(5, 'CO'), seenSpread())).not.toContain('enter_by_calling');
  });
});

describe('findPatterns 중복 제거', () => {
  it('보고 있는 실수가 거의 같으면 각도가 달라도 한 장만 뜬다', () => {
    // BB 8건은 enter_by_calling(line) 과 bb_too_wide(seat) 에 동시에 걸리고, CO 4건은 앞쪽에만 걸립니다.
    // 각도는 다르지만 12건 중 8건이 같은 실수라 두 장이 되면 같은 말을 두 번 하는 셈입니다.
    const ms = [...callInsteadOfFold(8, 'BB'), ...callInsteadOfFold(4, 'CO')];
    const hits = findPatterns(ms, seenSpread(), NOW);
    const overlapping = hits.filter((h) => h.id === 'enter_by_calling' || h.id === 'bb_too_wide');
    expect(overlapping).toHaveLength(1);

    // 어느 쪽이 이기든 남은 실수로는 다른 쪽이 minSample 을 못 채웁니다.
    const counted = hits.reduce((s, h) => s + h.count, 0);
    expect(counted).toBeLessThanOrEqual(ms.length);
  });

  it('점수 내림차순, 최대 5장', () => {
    const ms = [
      ...callInsteadOfFold(8, 'BB'),
      ...Array.from({ length: 8 }, (_, i) =>
        mistake({ hand: JUNK[i], kind: 'vs_3bet', hero: 'CO', answer: 'call', chosen: 'fold' }),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        mistake({ hand: JUNK[i], kind: 'vs_4bet', hero: 'HJ', answer: 'fold', chosen: 'call' }),
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        mistake({ hand: `${'AKQJT98765'[i]}7o`, kind: 'rfi', hero: 'BTN', answer: 'raise', chosen: 'fold' }),
      ),
    ];
    const hits = findPatterns(ms, seenSpread(), NOW);
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < hits.length; i += 1) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
  });

  it('최근 7일 실수는 두 배로 세어 점수를 올린다', () => {
    const old = callInsteadOfFold(8, 'CO');
    const fresh = old.map((m) => ({ ...m, daysAgo: 1 }));
    const [a] = findPatterns(old, seenSpread(), NOW);
    const [b] = findPatterns(fresh, seenSpread(), NOW);
    expect(b.recent7d).toBe(8);
    expect(a.recent7d).toBe(0);
    expect(b.score).toBeCloseTo(a.score * 2, 6);
  });
});

describe('seat_hotspot 보루 규칙', () => {
  it('아무 규칙도 통과하지 못하면 몰려 있는 자리를 낸다', () => {
    const repeated = ['72o', '72o', '72o', '82o', '82o', '82o'].map((hand) =>
      mistake({ hand, kind: 'vs_open', hero: 'CO', answer: 'fold', chosen: 'call' }),
    );
    const hits = findPatterns(repeated, seenSpread(), NOW);
    expect(hits.map((h) => h.id)).toEqual(['seat_hotspot']);
    expect(hits[0].count).toBe(6);
    expect(hits[0].kind).toBe('vs_open');
    expect(hits[0].hero).toBe('CO');
    expect(hits[0].drill).toEqual({ target: 'train', deck: 'vs_open', positions: ['CO'] });
  });

  it('규칙이 하나라도 통과하면 내지 않는다', () => {
    expect(ids(callInsteadOfFold(8, 'CO'), seenSpread())).not.toContain('seat_hotspot');
  });

  it('한 자리에 몰려 있지 않으면 내지 않는다', () => {
    // 같은 패 반복이라 규칙은 전부 막히고, 좌석도 흩어져 있어 보루도 열리지 않습니다.
    const scattered = POSITIONS.flatMap((hero) =>
      ['72o', '72o'].map((hand) => mistake({ hand, kind: 'vs_open', hero, answer: 'fold', chosen: 'call' })),
    );
    expect(findPatterns(scattered, seenSpread(), NOW)).toEqual([]);
  });
});

describe('PatternHit 내용', () => {
  it('뭉치가 고정한 칸만 채우고 흩어진 칸은 비운다', () => {
    const ms = [...callInsteadOfFold(6, 'CO'), ...callInsteadOfFold(6, 'BTN')];
    const hit = findPatterns(ms, seenSpread(), NOW).find((h) => h.id === 'enter_by_calling');
    expect(hit).toBeDefined();
    expect(hit?.kind).toBe('vs_open');
    expect(hit?.from).toBe('fold');
    expect(hit?.to).toBe('call');
    expect(hit?.hero).toBeUndefined(); // CO 와 BTN 이 섞여 있습니다
    expect(hit?.examples.length).toBeLessThanOrEqual(3);
    expect(hit?.keys.length).toBeLessThanOrEqual(12);
    expect(hit?.count).toBe(12);
    expect(hit?.distinctHands).toBe(6); // 두 좌석이 같은 손패 목록을 씁니다
  });

  it('상황·자리 규칙은 개수와 상관없이 그 상황을 통째로 훈련시킨다', () => {
    // 고치려는 건 특정 패의 정답이 아니라 그 자리에서 패를 고르는 기준이라, 실수가 많이 모여도
    // '이 12장을 다시'가 아니라 '이 상황을 통째로'로 보냅니다.
    for (const n of [6, 12, 20]) {
      const hit = findPatterns(callInsteadOfFold(n, 'CO'), seenSpread(), NOW).find((h) => h.id === 'enter_by_calling');
      expect(hit?.drill, `${n}건`).toEqual({ target: 'train', deck: 'vs_open', positions: ['CO'] });
    }
  });

  it('클래스 규칙은 늘 그 카드들만 퀴즈로 보낸다', () => {
    const ms = ['A7o', 'A8o', 'A9o', 'A6o', 'A4o', 'A3o'].map((hand) =>
      mistake({ hand, kind: 'vs_open', hero: 'UTG', answer: 'fold', chosen: 'call' }),
    );
    const hit = findPatterns(ms, seenSpread(), NOW).find((h) => h.id === 'offsuit_ace_trap');
    expect(hit).toBeDefined();
    expect(hit?.handClass).toBe('offsuit_ace');
    expect(hit?.drill.target).toBe('quiz');
    expect(hit?.drill.onlyKeys).toHaveLength(6);
  });
});

describe('조언 문구', () => {
  const BANNED = /GTO|솔버|solver|EV|에퀴티|빈도|폴라|양극화|리니어|밸런스|MDF|콤보|노드|시뮬|레인지의?\s?\d/;
  const RANGE_NOTATION = /[AKQJT2-9][AKQJT2-9][so]?\+/;

  it('모든 규칙의 마지막 문장은 질문이다', () => {
    for (const rule of PATTERN_RULES) {
      expect(rule.advice.length).toBeGreaterThan(1);
      expect(rule.advice[rule.advice.length - 1].endsWith('?'), rule.id).toBe(true);
    }
  });

  it('마지막 문장 말고는 질문으로 끝나지 않는다', () => {
    for (const rule of PATTERN_RULES) {
      for (const line of rule.advice.slice(0, -1)) expect(line.endsWith('?'), `${rule.id}: ${line}`).toBe(false);
    }
  });

  it('차트를 읽어 주는 말이 섞여 있지 않다', () => {
    for (const rule of PATTERN_RULES) {
      for (const line of [rule.koName, ...rule.advice]) {
        expect(BANNED.test(line), `${rule.id}: ${line}`).toBe(false);
        expect(RANGE_NOTATION.test(line), `${rule.id}: ${line}`).toBe(false);
        expect(line.includes('%'), `${rule.id}: ${line}`).toBe(false);
        expect(line.includes('!'), `${rule.id}: ${line}`).toBe(false);
      }
    }
  });

  it('규칙 id 는 중복되지 않고 seat_hotspot 이 맨 뒤다', () => {
    const list = PATTERN_RULES.map((r) => r.id);
    expect(new Set(list).size).toBe(list.length);
    expect(list[list.length - 1]).toBe('seat_hotspot');
  });
});
