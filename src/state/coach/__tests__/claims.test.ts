/**
 * 코치 문구가 (1) 앱의 말투 규칙을 지키고 (2) 차트에 대해 하는 말이 차트와 맞는지 확인합니다.
 *
 * 코치 문구는 해설 문자열과 따로 쓰여서, 해설 쪽 테스트(BANNED · 차트 대조)가 닿지 않았습니다. 그 사이에
 * 합니다체 · '~하세요' · '열어요' · '3벳을 맞으면'이 섞이고, 규칙이 두 자리를 잡는데 한 자리 숫자만 말하는
 * 문장(버튼 뒤 두 명 · UTG 뒤 다섯 명)이 남았습니다. 여기서 둘 다 막습니다.
 *
 * 차트 대조는 문장이 단정하는 것만 다시 계산합니다 — 문장을 고칠 때 이 테스트도 같이 고쳐야 합니다.
 */
import { describe, expect, it } from 'vitest';
import { ALL_CHART_DEFS, getChartCells, hasChart } from '../../../poker/data';
import { classifyHand } from '../../../poker/explain';
import { ALL_HANDS, combos } from '../../../poker/hands';
import { bannedHits } from '../../../poker/ko';
import { rangeShare } from '../../../poker/range';
import { heroInPosition } from '../../../poker/scenarios';
import { SCENARIO_KINDS, type Action, type Pos, type Scenario, type ScenarioKind } from '../../../poker/types';
import { ABOUT } from '../../../screens/coach/AxisSheet';
import { BASICS, BASICS_HEADING, BASICS_NOTE, FULL_GATE, coachEmptyCopy } from '../../../screens/coach/CoachEmpty';
import { computeAxes } from '../axes';
import { localCoach } from '../copy';
import { PATTERN_RULES } from '../patterns';
import type { AxisId, AxisView, CoachDigest, CoachMistake, PatternHit } from '../types';

/* ------------------------------------------------------------------ */
/* 재료                                                                */
/* ------------------------------------------------------------------ */

const AXES: AxisId[] = ['aggression', 'entry', 'seat', 'pressure'];

function digest(over: Partial<CoachDigest> = {}): CoachDigest {
  return {
    v: 1,
    at: 0,
    hash: 'claims',
    volume: { quizTotal: 300, quizCorrect: 220, trials: 420, mistakesStored: 60, mistakesUsed: 42, trainShare: 0.3, srsCards: 180, streak: 4, bestStreak: 11 },
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

function axisView(id: AxisId, t: number): AxisView {
  return { id, koLabel: id, poles: ['-', '+'], t, z: 3, sample: 30, need: 0, unlocked: true, level: 'confident', pole: '+', headline: true };
}

function hit(id: string): PatternHit {
  const rule = PATTERN_RULES.find((r) => r.id === id)!;
  return { id, koName: rule.koName, count: 12, recent7d: 3, distinctHands: 5, lift: 2, score: 20, examples: [], keys: [], drill: { target: 'quiz', onlyKeys: [] } };
}

/** 규칙 코치가 낼 수 있는 모든 카드(모든 축 × 부호, 모든 상황의 칭찬, 모든 규칙). */
function everyRuleCard() {
  const cards = [];
  for (const id of AXES) for (const t of [-0.8, 0.8]) cards.push(...localCoach(digest({ axes: [axisView(id, t)] })));
  for (const kind of SCENARIO_KINDS) cards.push(...localCoach(digest({ good: { kind, trials: 50, acc: 0.8 } })));
  for (const r of PATTERN_RULES) cards.push(...localCoach(digest({ patterns: [hit(r.id)] })));
  return cards;
}

/** 학습자가 코치 탭에서 읽는 규칙 문구 전부. */
function everyCoachString(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const c of everyRuleCard()) {
    out.push([`${c.id} title`, c.title], [`${c.id} evidence`, c.evidence]);
    c.steps.forEach((s, i) => out.push([`${c.id} step${i}`, s]));
  }
  for (const r of PATTERN_RULES) {
    out.push([`${r.id} koName`, r.koName]);
    r.advice.forEach((a, i) => out.push([`${r.id} advice${i}`, a]));
  }
  for (const a of computeAxes([], [])) a.poles.forEach((p, i) => out.push([`${a.id} pole${i}`, p]));
  for (const id of AXES) ABOUT[id].forEach((l, i) => out.push([`ABOUT ${id}${i}`, l]));
  for (const b of BASICS) out.push([`BASICS title`, b.title], [`BASICS line`, b.line], [`BASICS cta`, b.cta]);
  out.push(['BASICS_HEADING', BASICS_HEADING], ['BASICS_NOTE', BASICS_NOTE]);
  for (const [quizTotal, trials, mistakesStored] of [
    [0, 0, 0],
    [0, 10, 0],
    [10, 10, 0],
    [10, 10, 5],
  ]) {
    const { title, sub } = coachEmptyCopy({ quizTotal, trials, mistakesStored });
    out.push([`empty title ${quizTotal}/${trials}/${mistakesStored}`, title], [`empty sub ${quizTotal}/${trials}/${mistakesStored}`, sub]);
  }
  return out;
}

const scen = (kind: ScenarioKind, hero: Pos, villain?: Pos): Scenario => ({ kind, hero, ...(villain ? { villain } : {}) }) as Scenario;
const share = (s: Scenario, a: Action) => rangeShare(getChartCells(s), a);
const weight = (s: Scenario, hand: string, a: Action) => getChartCells(s)[hand]?.[a] ?? 0;
const ORDER: Pos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const defsOf = (kind: ScenarioKind) => ALL_CHART_DEFS.filter((d) => d.kind === kind).map((d) => scen(d.kind, d.hero, d.villain));

/* ------------------------------------------------------------------ */
/* 말투                                                                */
/* ------------------------------------------------------------------ */

describe('코치 문구의 말투 (THEORY_SPEC §8: 해요체 · 명령형 금지)', () => {
  it('규칙 코치 · 극 라벨 · 근거 시트 · 기본기 카드 · 빈 화면 문구가 BANNED(말투 + 숫자)에 걸리지 않는다', () => {
    const bad = everyCoachString().flatMap(([where, t]) => (bannedHits(t).length ? [`${where}: ${t} ← ${bannedHits(t).join(', ')}`] : []));
    expect(bad).toEqual([]);
  });

  it('코치 린터의 금지어(에퀴티 · 솔버 · 빈도 · 양극화 …)와 bb 금액도 없다', () => {
    const coachBanned = /솔버|에퀴티|빈도|폴라|양극화|리니어|밸런스|콤보|노드|시뮬|\d+(?:\.\d+)?bb/;
    const bad = everyCoachString().filter(([, t]) => coachBanned.test(t));
    expect(bad).toEqual([]);
  });

  it("'5벳 대응' 대신 앱 전체가 쓰는 '올인 대응'을 쓴다", () => {
    const cards = localCoach(digest({ good: { kind: 'vs_5bet', trials: 50, acc: 0.8 } }));
    expect(cards[0].title).toBe('올인 대응 판단은 좋아요');
  });
});

/* ------------------------------------------------------------------ */
/* 자리 수 — 규칙이 잡는 자리를 전부 덮는 말                              */
/* ------------------------------------------------------------------ */

describe('규칙이 잡는 자리와 문구의 자리 수가 맞다', () => {
  const behind = (p: Pos) => ORDER.length - 1 - ORDER.indexOf(p);
  const KO_COUNT: Record<string, number[]> = { '두세': [2, 3], '네다섯': [4, 5] };

  function heroesOf(id: string): Pos[] {
    const rule = PATTERN_RULES.find((r) => r.id === id)!;
    return ORDER.filter((hero) =>
      [
        { answer: 'fold', chosen: 'raise' },
        { answer: 'raise', chosen: 'fold' },
      ].some(({ answer, chosen }) =>
        rule.match({ hand: 'K9o', handClass: 'junk', kind: 'rfi', hero, ip: false, answer, chosen, daysAgo: 0, src: 'quiz', key: '' } as CoachMistake),
      ),
    );
  }

  it('early_seat_wide 는 UTG·HJ 를 잡고, 첫 줄이 그 두 자리의 뒷사람 수(5 · 4)를 다 말한다', () => {
    const heroes = heroesOf('early_seat_wide');
    expect(heroes).toEqual(['UTG', 'HJ']);
    const line = PATTERN_RULES.find((r) => r.id === 'early_seat_wide')!.advice[0];
    expect(line).toContain(heroes.join('·'));
    expect(KO_COUNT['네다섯']).toEqual(heroes.map(behind).sort());
    expect(line).toContain('네다섯');
  });

  it('late_seat_tight 는 CO·BTN 을 잡고, 첫 줄이 그 두 자리의 뒷사람 수(3 · 2)를 다 말한다', () => {
    const heroes = heroesOf('late_seat_tight');
    expect(heroes).toEqual(['CO', 'BTN']);
    const line = PATTERN_RULES.find((r) => r.id === 'late_seat_tight')!.advice[0];
    expect(line).toContain(heroes.join('·'));
    expect(KO_COUNT['두세']).toEqual(heroes.map(behind).sort());
    expect(line).toContain('두세');
  });

  it('여러 자리를 잡는 규칙 · 축이 한 자리의 숫자(다섯 명 · 두 명뿐)를 말하지 않는다', () => {
    const lines = [...PATTERN_RULES.flatMap((r) => r.advice), ...everyRuleCard().flatMap((c) => c.steps)];
    expect(lines.filter((l) => /(?<![가-힣])다섯 명|(?<![가-힣])두 명뿐|버튼 뒤/.test(l))).toEqual([]);
  });

  it("bb_too_wide 가 잡는 상대에게 BB 는 늘 포지션이 없다 — 'BB는 플랍부터 먼저 액션해요'", () => {
    const rule = PATTERN_RULES.find((r) => r.id === 'bb_too_wide')!;
    expect(rule.advice[0]).toBe('BB는 플랍부터 먼저 액션해요.');
    for (const villain of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as Pos[]) {
      const m = { hand: 'K5o', handClass: 'junk', kind: 'vs_open', hero: 'BB', villain, ip: heroInPosition('BB', villain), answer: 'fold', chosen: 'call', daysAgo: 0, src: 'quiz', key: '' } as CoachMistake;
      if (rule.match(m)) expect(heroInPosition('BB', villain), villain).toBe(false);
    }
  });

  it("기본기 카드의 BB 제목은 '플랍부터는 대개' — SB 오픈에만 BB 가 포지션을 가진다", () => {
    expect(BASICS[1].title).toContain('플랍부터는 대개');
    const ip = (['UTG', 'HJ', 'CO', 'BTN', 'SB'] as Pos[]).filter((v) => heroInPosition('BB', v));
    expect(ip).toEqual(['SB']);
  });
});

/* ------------------------------------------------------------------ */
/* 차트와의 대조                                                         */
/* ------------------------------------------------------------------ */

describe('코치 문구가 차트에 대해 하는 말', () => {
  const STRONG = ['AA', 'KK', 'QQ', 'AKs', 'AKo'];

  it("call_not_raise '3벳에는 센 패와 작은 수티드 A가 들어가요' — 모든 vs_open 에서 AA·KK·QQ·AK 와 A5s·A4s 는 늘 3벳", () => {
    expect(PATTERN_RULES.find((r) => r.id === 'call_not_raise')!.advice[1]).toBe('3벳에는 센 패와 작은 수티드 A가 들어가요.');
    const charts = defsOf('vs_open');
    expect(charts.length).toBeGreaterThan(0);
    for (const s of charts) {
      for (const h of [...STRONG, 'A5s', 'A4s']) expect(weight(s, h, 'threebet'), `${s.hero}:${s.villain} ${h}`).toBe(1);
    }
  });

  it("fold_to_3bet '4벳은 주로 센 패와 작은 수티드 A예요' — 모든 vs_3bet 에서 4벳 조합의 절반 넘게가 그 둘", () => {
    expect(PATTERN_RULES.find((r) => r.id === 'fold_to_3bet')!.advice[1]).toBe('4벳은 주로 센 패와 작은 수티드 A예요.');
    for (const s of defsOf('vs_3bet')) {
      let all = 0;
      let core = 0;
      for (const h of ALL_HANDS) {
        const w = weight(s, h, 'fourbet') * combos(h);
        all += w;
        if (STRONG.includes(h) || classifyHand(h) === 'wheel_ace') core += w;
      }
      expect(core / all, `${s.hero}:${s.villain}`).toBeGreaterThan(0.5);
      // 작은 수티드 A 가 실제로 4벳에 들어 있다(오프수트 A 가 아니라).
      expect(weight(s, 'A5s', 'fourbet'), `${s.hero}:${s.villain}`).toBeGreaterThan(0);
    }
  });

  it("stubborn_vs_4bet '상대가 앞자리일수록 4벳이 더 강해요' — 같은 3벳에 대한 4벳 폭은 4벳한 사람이 앞자리일수록 좁다", () => {
    let pairs = 0;
    for (const threebettor of ORDER) {
      const openers = ORDER.filter((o) => hasChart(scen('vs_3bet', o, threebettor)));
      for (let i = 1; i < openers.length; i += 1) {
        const early = share(scen('vs_3bet', openers[i - 1], threebettor), 'fourbet');
        const late = share(scen('vs_3bet', openers[i], threebettor), 'fourbet');
        expect(early, `${openers[i - 1]} vs ${openers[i]} (3벳 ${threebettor})`).toBeLessThanOrEqual(late + 1e-9);
        pairs += 1;
      }
    }
    expect(pairs).toBeGreaterThan(5);
  });

  it("성향 카드 '베팅이 커질수록 상대 범위는 좁아져요' — 오픈 > 3벳 > 4벳 > 올인, 4벳 대응 차트가 있는 줄마다", () => {
    const charts = defsOf('vs_4bet');
    expect(charts.length).toBeGreaterThan(0);
    for (const s of charts) {
      const threebettor = s.hero;
      const opener = s.villain!;
      const open = share(scen('rfi', opener), 'raise');
      const three = share(scen('vs_open', threebettor, opener), 'threebet');
      const four = share(scen('vs_3bet', opener, threebettor), 'fourbet');
      const allin = share(s, 'allin');
      expect(open, `${opener} → ${threebettor}`).toBeGreaterThan(three);
      expect(three, `${opener} → ${threebettor}`).toBeGreaterThan(four);
      expect(four, `${opener} → ${threebettor}`).toBeGreaterThan(allin);
    }
  });

  it("'자리가 뒤일수록 들어갈 패가 늘어요' · '3벳을 덜 받아 넓게 오픈해요' — 오픈 폭 UTG < HJ < CO < BTN", () => {
    const widths = (['UTG', 'HJ', 'CO', 'BTN'] as Pos[]).map((p) => share(scen('rfi', p), 'raise'));
    for (let i = 1; i < widths.length; i += 1) expect(widths[i]).toBeGreaterThan(widths[i - 1]);
  });

  it("late_seat_tight '오프수트 브로드웨이와 낮은 수티드가 늘어요' — CO·BTN 이 UTG 보다 둘 다 많이 오픈한다", () => {
    const opens = (p: Pos, pick: (h: string) => boolean) => ALL_HANDS.filter((h) => pick(h) && weight(scen('rfi', p), h, 'raise') > 0).length;
    const offBroadway = (h: string) => classifyHand(h) === 'offsuit_broadway';
    const lowSuited = (h: string) => h.endsWith('s') && h[0] !== 'A' && '8765432'.includes(h[1]);
    for (const p of ['CO', 'BTN'] as Pos[]) {
      expect(opens(p, offBroadway), p).toBeGreaterThan(opens('UTG', offBroadway));
      expect(opens(p, lowSuited), p).toBeGreaterThan(opens('UTG', lowSuited));
    }
  });

  it("offsuit_ace_trap '높은 카드가 A 하나뿐인 패예요' — 오프수트 A 클래스의 킥커는 전부 9 이하", () => {
    const hands = ALL_HANDS.filter((h) => classifyHand(h) === 'offsuit_ace');
    expect(hands.length).toBe(8);
    for (const h of hands) expect('98765432'.includes(h[1]), h).toBe(true);
  });

  it("기본기 카드의 '같은 패도 상대 자리에 따라 답이 바뀌어요' — BB 의 K8o 는 UTG 에게 폴드, BTN 에게 콜", () => {
    expect(weight(scen('vs_open', 'BB', 'UTG'), 'K8o', 'call') + weight(scen('vs_open', 'BB', 'UTG'), 'K8o', 'threebet')).toBe(0);
    expect(weight(scen('vs_open', 'BB', 'BTN'), 'K8o', 'call')).toBe(1);
  });

  it("기본기 카드의 UTG 문장은 범위 단위('지킬 수 있는 만큼만') — UTG 오픈에도 3벳을 받으면 늘 폴드하는 패가 있다", () => {
    expect(BASICS[0].line).toContain('지킬 수 있는 만큼만');
    const s = scen('vs_3bet', 'UTG', 'BTN');
    const opened = ALL_HANDS.filter((h) => weight(scen('rfi', 'UTG'), h, 'raise') === 1);
    const alwaysFold = opened.filter((h) => weight(s, h, 'call') + weight(s, h, 'fourbet') === 0);
    expect(alwaysFold.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* 빈 화면                                                              */
/* ------------------------------------------------------------------ */

describe('빈 화면 문구', () => {
  it('아무것도 안 했을 때의 목표치는 링과 같은 것(틀린 문제 FULL_GATE 개)을 센다', () => {
    const { sub } = coachEmptyCopy({ quizTotal: 0, trials: 0, mistakesStored: 0 });
    expect(sub).toBe(`틀린 문제가 ${FULL_GATE}개쯤 쌓이면 성향이 보여요`);
  });

  it('세 갈래가 서로 다른 문구를 낸다', () => {
    const subs = new Set([
      coachEmptyCopy({ quizTotal: 0, trials: 0, mistakesStored: 3 }).sub,
      coachEmptyCopy({ quizTotal: 0, trials: 5, mistakesStored: 0 }).sub,
      coachEmptyCopy({ quizTotal: 5, trials: 5, mistakesStored: 0 }).sub,
      coachEmptyCopy({ quizTotal: 0, trials: 0, mistakesStored: 0 }).sub,
    ]);
    expect(subs.size).toBe(4);
  });
});
