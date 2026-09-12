import { describe, expect, it } from 'vitest';
import { hasChart } from '../src/poker/data';
import { classifyHand, dominatedBy, dominatorOf, explainStep, type Explanation } from '../src/poker/explain';
import { parseHandName, ALL_HANDS } from '../src/poker/hands';
import { GLOSSARY, glossaryLookup } from '../src/poker/glossary';
import { stepFor, buildSteps, DEFAULT_SESSION_OPTIONS, nextHandSequence, randomQuizStep, type Step } from '../src/poker/trainer';
import type { Pos, Scenario, ScenarioKind } from '../src/poker/types';
import { seedRandom } from '../src/poker/hands';

describe('hand classes', () => {
  it('classifies representative hands', () => {
    expect(classifyHand('AA')).toBe('premium_pair');
    expect(classifyHand('JJ')).toBe('big_pair');
    expect(classifyHand('88')).toBe('mid_pair');
    expect(classifyHand('22')).toBe('small_pair');
    expect(classifyHand('AKo')).toBe('ak');
    expect(classifyHand('AJs')).toBe('big_ace');
    expect(classifyHand('A8s')).toBe('suited_ace');
    expect(classifyHand('A4s')).toBe('wheel_ace');
    expect(classifyHand('A9o')).toBe('offsuit_ace');
    expect(classifyHand('KJs')).toBe('suited_broadway');
    expect(classifyHand('QTo')).toBe('offsuit_broadway');
    expect(classifyHand('K6s')).toBe('suited_king');
    expect(classifyHand('Q5s')).toBe('suited_qj');
    expect(classifyHand('76s')).toBe('suited_connector');
    expect(classifyHand('97s')).toBe('suited_gapper');
    expect(classifyHand('98o')).toBe('offsuit_connector');
    expect(classifyHand('72o')).toBe('junk');
  });
});

describe('explanations (technical block)', () => {
  it('fold has no postflop plan; open has one', () => {
    const fold = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, '72o'));
    expect(fold.postflop).toBeUndefined();
    expect(fold.reasoning.length).toBeGreaterThan(1);
    const open = explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, 'A5s'));
    expect(open.postflop).toBeDefined();
    expect(open.postflop!.checklist.length).toBeGreaterThanOrEqual(5);
    expect(open.postflop!.plan.length).toBeGreaterThan(0);
    expect(open.headline).toContain('A5s');
  });
  it('mixed hands get a frequency note in the plain register', () => {
    const e = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'ATo'));
    expect(e.mixNote).toContain('50%');
    expect(e.mixNote).toMatch(/요\.$/);
    expect(e.mixNote).not.toMatch(/습니다/);
  });
  it('technical prose uses the 해요 register, not 합니다', () => {
    const e = explainStep(stepFor({ kind: 'vs_3bet', hero: 'BTN', villain: 'BB' }, 'T9s'));
    const all = [e.situation, e.handProfile, ...e.reasoning, e.rangeContext, e.mixNote ?? '', ...(e.postflop?.checklist ?? []), ...(e.postflop?.plan ?? [])].join('\n');
    expect(all).not.toMatch(/습니다|입니다/);
  });
});

/* ------------------------------------------------------------------ */
/* Easy block                                                           */
/* ------------------------------------------------------------------ */

const CASES: Array<[Scenario, string]> = [
  // rfi
  [{ kind: 'rfi', hero: 'UTG' }, '72o'],
  [{ kind: 'rfi', hero: 'UTG' }, 'AA'],
  [{ kind: 'rfi', hero: 'UTG' }, '55'],
  [{ kind: 'rfi', hero: 'UTG' }, 'ATo'], // mixed open/fold
  [{ kind: 'rfi', hero: 'UTG' }, '65s'],
  [{ kind: 'rfi', hero: 'HJ' }, 'J8s'],
  [{ kind: 'rfi', hero: 'CO' }, 'K9s'],
  [{ kind: 'rfi', hero: 'BTN' }, 'A5s'],
  [{ kind: 'rfi', hero: 'BTN' }, 'Q5s'],
  [{ kind: 'rfi', hero: 'BTN' }, '98o'],
  [{ kind: 'rfi', hero: 'SB' }, 'KQo'],
  [{ kind: 'rfi', hero: 'SB' }, 'T8s'],
  // vs_open
  [{ kind: 'vs_open', hero: 'BB', villain: 'UTG' }, 'KQo'],
  [{ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, 'A5s'],
  [{ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, '76s'],
  [{ kind: 'vs_open', hero: 'BB', villain: 'SB' }, '72o'],
  [{ kind: 'vs_open', hero: 'BB', villain: 'CO' }, '22'],
  [{ kind: 'vs_open', hero: 'SB', villain: 'BTN' }, 'AJo'],
  [{ kind: 'vs_open', hero: 'BTN', villain: 'UTG' }, 'AQo'],
  [{ kind: 'vs_open', hero: 'BTN', villain: 'CO' }, 'KJs'],
  [{ kind: 'vs_open', hero: 'BTN', villain: 'HJ' }, '88'],
  [{ kind: 'vs_open', hero: 'CO', villain: 'UTG' }, 'QQ'],
  [{ kind: 'vs_open', hero: 'HJ', villain: 'UTG' }, 'A9o'],
  [{ kind: 'vs_open', hero: 'HJ', villain: 'UTG' }, 'K6s'],
  // vs_3bet
  [{ kind: 'vs_3bet', hero: 'UTG', villain: 'BTN' }, 'AKs'],
  [{ kind: 'vs_3bet', hero: 'UTG', villain: 'BB' }, '77'],
  [{ kind: 'vs_3bet', hero: 'CO', villain: 'BTN' }, 'A5s'],
  [{ kind: 'vs_3bet', hero: 'BTN', villain: 'SB' }, 'KK'],
  [{ kind: 'vs_3bet', hero: 'BTN', villain: 'BB' }, 'T9s'],
  [{ kind: 'vs_3bet', hero: 'BTN', villain: 'BB' }, 'K7s'],
  [{ kind: 'vs_3bet', hero: 'HJ', villain: 'CO' }, 'AJs'],
  [{ kind: 'vs_3bet', hero: 'HJ', villain: 'CO' }, 'A2s'],
  // vs_4bet
  [{ kind: 'vs_4bet', hero: 'BTN', villain: 'CO' }, 'AA'],
  [{ kind: 'vs_4bet', hero: 'BTN', villain: 'CO' }, 'A5s'],
  [{ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'QQ'],
  [{ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'AQs'],
  [{ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'A4s'],
  [{ kind: 'vs_4bet', hero: 'SB', villain: 'BTN' }, 'JJ'],
  [{ kind: 'vs_4bet', hero: 'SB', villain: 'BTN' }, 'KQs'],
  // vs_5bet
  [{ kind: 'vs_5bet', hero: 'UTG', villain: 'BTN' }, 'AA'],
  [{ kind: 'vs_5bet', hero: 'UTG', villain: 'BTN' }, 'AKo'],
  [{ kind: 'vs_5bet', hero: 'CO', villain: 'BB' }, 'QQ'],
  [{ kind: 'vs_5bet', hero: 'CO', villain: 'BB' }, 'A5s'],
  [{ kind: 'vs_5bet', hero: 'BTN', villain: 'SB' }, 'JJ'],
  [{ kind: 'vs_5bet', hero: 'BTN', villain: 'SB' }, 'KK'],
  // cold_4bet
  [{ kind: 'cold_4bet', hero: 'BTN', extras: { opener: 'UTG', threeBettor: 'CO' } }, 'KK'],
  [{ kind: 'cold_4bet', hero: 'BTN', extras: { opener: 'UTG', threeBettor: 'CO' } }, 'AQs'],
  [{ kind: 'cold_4bet', hero: 'BB', extras: { opener: 'HJ', threeBettor: 'BTN' } }, 'JJ'],
  [{ kind: 'cold_4bet', hero: 'CO', extras: { opener: 'UTG', threeBettor: 'HJ' } }, 'A5s'],
  [{ kind: 'cold_4bet', hero: 'CO', extras: { opener: 'UTG', threeBettor: 'HJ' } }, '98s'],
];

/** Raw jargon that must never appear in the easy block without a "(" gloss right after its first occurrence. */
const JARGON = ['SPR', 'GTO', 'EV', 'c-bet', '폴드 에퀴티', '에퀴티', '리니어', '폴라', '양극화', '스퀴즈', '콤보', '실현'];

function easyText(e: Explanation): string {
  return [e.easy.oneLiner, ...e.easy.why, ...e.easy.example, ...(e.easy.flop ?? [])].join('\n');
}

function jargonViolations(text: string): string[] {
  const out: string[] = [];
  for (const j of JARGON) {
    const i = text.indexOf(j);
    if (i < 0) continue;
    // "EV" only counts as a standalone token (not inside e.g. "LEVEL")
    if (j === 'EV' && !/(^|[^A-Za-z])EV([^A-Za-z]|$)/.test(text)) continue;
    const after = text.slice(i + j.length).replace(/^\s+/, '');
    if (!after.startsWith('(')) out.push(j);
  }
  return out;
}

/**
 * Table terms the one-liner (the first thing a learner reads) may use only in a gloss form: right after a "(" as in
 * "옆 카드(킥커)" / "돈(블라인드)을", or right before one as in "셋(같은 숫자 3장)".
 */
const ONE_LINER_TERMS = ['킥커', '셋', '블로커', '탑페어', '블라인드'];

function oneLinerGlossViolations(text: string): string[] {
  const out: string[] = [];
  for (const t of ONE_LINER_TERMS) {
    for (let i = text.indexOf(t); i >= 0; i = text.indexOf(t, i + t.length)) {
      const glossedBefore = text[i - 1] === '(';
      const glossedAfter = text.slice(i + t.length).replace(/^\s+/, '').startsWith('(');
      if (!glossedBefore && !glossedAfter) out.push(`${t}@${i}`);
    }
  }
  return out;
}

const allSteps: Step[] = CASES.map(([sc, hand]) => stepFor(sc, hand));

describe('easy block', () => {
  it('covers every scenario kind and a spread of answers', () => {
    const kinds = new Set(allSteps.map((s) => s.scenario.kind));
    for (const k of ['rfi', 'vs_open', 'vs_3bet', 'vs_4bet', 'vs_5bet', 'cold_4bet'] as ScenarioKind[]) expect(kinds.has(k), k).toBe(true);
    const answers = new Set(allSteps.map((s) => s.answer));
    for (const a of ['fold', 'call', 'raise', 'threebet', 'fourbet', 'allin'] as const) expect(answers.has(a), a).toBe(true);
    expect(allSteps.some((s) => s.mixList.length >= 2)).toBe(true);
    expect(allSteps.length).toBeGreaterThanOrEqual(40);
  });

  for (const step of allSteps) {
    const label = `${step.scenario.kind} ${step.scenario.hero}${step.scenario.villain ? ' vs ' + step.scenario.villain : ''} ${step.hand} → ${step.answer}`;
    it(label, () => {
      const e = explainStep(step);
      const { easy } = e;
      expect(easy.oneLiner.length).toBeGreaterThan(0);
      expect(easy.oneLiner.length, easy.oneLiner).toBeLessThanOrEqual(60);
      expect(easy.why.length).toBeGreaterThanOrEqual(2);
      expect(easy.why.length).toBeLessThanOrEqual(3);
      for (const w of easy.why) expect(w.length, w).toBeLessThanOrEqual(60);
      expect(easy.example.length).toBeGreaterThanOrEqual(1);
      expect(easy.example.length).toBeLessThanOrEqual(3);
      expect(easy.example.join('\n'), easy.example.join(' | ')).toMatch(/[♠♦]/);
      // suits: only spades / diamonds in examples
      expect(easyText(e)).not.toMatch(/[♥♣]/);
      const expectFlop = step.answer !== 'fold' && step.answer !== 'allin' && step.scenario.kind !== 'vs_5bet';
      if (expectFlop) {
        expect(easy.flop, 'flop present').toBeDefined();
        expect(easy.flop!.length).toBeGreaterThanOrEqual(3);
        expect(easy.flop!.length).toBeLessThanOrEqual(4);
        expect(easy.flop!.join('\n')).toMatch(/[♠♦]/);
      } else {
        expect(easy.flop, 'no flop').toBeUndefined();
      }
      expect(jargonViolations(easyText(e)), easyText(e)).toEqual([]);
      expect(oneLinerGlossViolations(easy.oneLiner), easy.oneLiner).toEqual([]);
      // no broken cards: a bare rank never sits between suited cards in a board like "K♠72♠"
      expect(easyText(e)).not.toMatch(/[♠♦][2-9TJQKA]{2}[♠♦]/);
      expect(easyText(e)).not.toMatch(/습니다|입니다/);
    });
  }

  it('example cards come from the hand (hero cards are shown)', () => {
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, 'A5s')).easy.example.join(' ')).toContain('A♠5♠');
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'SB' }, 'KQo')).easy.example.join(' ')).toContain('K♠Q♦');
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, '55')).easy.example.join(' ')).toContain('5♠5♦');
    expect(explainStep(stepFor({ kind: 'vs_open', hero: 'BTN', villain: 'HJ' }, '88')).easy.example.join(' ')).toMatch(/8분의 1/);
  });
  it('bluff 4-bet with a wheel ace mentions the blocker', () => {
    const e = explainStep(stepFor({ kind: 'vs_3bet', hero: 'CO', villain: 'BTN' }, 'A5s'));
    expect(e.easy.example.join(' ')).toMatch(/블로커/);
  });
  it('mixed hands mention the alternative in 왜; a 50/50 spot says 반반, never "더 자주 하는 쪽"', () => {
    const tie = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'ATo')); // open/fold 50/50
    const tieWhy = tie.easy.why.join(' ');
    expect(tieWhy).toMatch(/접기도 반반이에요\. 빈도가 같으면 더 공격적인 쪽이 정답이에요\./);
    expect(tieWhy).not.toMatch(/가끔은|더 자주 하는 쪽/);
    for (const w of tie.easy.why) expect(w.length, w).toBeLessThanOrEqual(45);
    // every 50/50 step in the case list gets the tie wording; every uneven mix gets the 가끔 wording
    for (const step of allSteps) {
      const alt = step.mixList[1];
      if (!alt) continue;
      const why = explainStep(step).easy.why.join(' ');
      if (alt.weight >= 0.5) expect(why, step.hand).toMatch(/반반이에요/);
      else expect(why, step.hand).toMatch(/가끔은 .*10번 중 \d번쯤/);
    }
  });
  it('wheel-ace straight example never reuses the hero low card on the board', () => {
    for (const [sc, hand] of [
      [{ kind: 'rfi', hero: 'BTN' }, 'A2s'],
      [{ kind: 'rfi', hero: 'BTN' }, 'A3s'],
      [{ kind: 'rfi', hero: 'BTN' }, 'A4s'],
      [{ kind: 'rfi', hero: 'BTN' }, 'A5s'],
      [{ kind: 'vs_3bet', hero: 'BTN', villain: 'BB' }, 'A3s'],
      [{ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, 'A2s'],
    ] as Array<[Scenario, string]>) {
      const lines = explainStep(stepFor(sc, hand)).easy.example.filter((l) => /스트레이트/.test(l));
      expect(lines.length, `${hand} has a wheel example`).toBeGreaterThan(0);
      for (const l of lines) {
        const m = /플랍 ((?:[2-9TJQKA]|10)[♠♦](?:[2-9TJQKA]|10)[♠♦](?:[2-9TJQKA]|10)[♠♦])면/.exec(l);
        expect(m, l).not.toBeNull();
        const ranks = m![1].replace(/[♠♦]/g, '');
        expect(ranks, `${hand}: ${l}`).not.toContain(hand[1]);
        // the three board ranks + A + my low card form 2-3-4-5
        expect([...ranks, hand[1]].sort().join(''), l).toBe('2345');
      }
    }
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, 'A2s')).easy.example.join(' ')).toContain('3♦4♠5♦');
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, 'A4s')).easy.example.join(' ')).toContain('2♦3♠5♦');
  });
  it('dominator / dominated hands are never pocket pairs and the kicker really decides', () => {
    const V = (r: string) => '23456789TJQKA'.indexOf(r);
    let seen = 0;
    for (const name of ALL_HANDS) {
      const info = parseHandName(name);
      for (const [label, opp, dir] of [
        ['dominatorOf', dominatorOf(info), +1],
        ['dominatedBy', dominatedBy(info), -1],
      ] as Array<[string, string | null, number]>) {
        if (!opp) continue;
        seen++;
        expect(opp[0] !== opp[1], `${label}(${name}) = ${opp} is a pair`).toBe(true);
        // shares exactly one rank with me; the other card (the kicker) is higher for a dominator, lower for a dominated hand
        const mine: string[] = [info.high, info.low];
        const shared = [opp[0], opp[1]].filter((r) => mine.includes(r));
        expect(shared.length, `${label}(${name}) = ${opp}`).toBe(1);
        const oppKicker = opp[0] === shared[0] ? opp[1] : opp[0];
        const myKicker = info.high === shared[0] ? info.low : info.high;
        expect(Math.sign(V(oppKicker) - V(myKicker)), `${label}(${name}) = ${opp}`).toBe(dir);
      }
    }
    expect(seen).toBeGreaterThan(40);
    expect(dominatedBy(parseHandName('KQs'))).toBe('QJo');
    expect(dominatedBy(parseHandName('KQo'))).toBe('QJo');
    expect(dominatedBy(parseHandName('KJs'))).toBe('QJo');
    expect(dominatedBy(parseHandName('AQo'))).toBe('KQo');
    const kq = explainStep(stepFor({ kind: 'rfi', hero: 'CO' }, 'KQo')).easy.example.join(' ');
    expect(kq).not.toMatch(/상대 QQ/);
    expect(kq).toMatch(/상대 Q[♠♦]J[♠♦] → 둘 다 Q를 맞추면 킥커 K로 내가 이겨요/);
  });
  it('junk examples explain the loss from the hero high card', () => {
    const q9 = explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, 'Q9o')).easy.example.join(' ');
    expect(q9).toMatch(/내 Q♠9♦, 상대 K[♠♦]Q[♠♦] → 둘 다 Q를 맞추면 킥커 K에 져요/);
    expect(q9).not.toMatch(/K 한 쌍에 져요/);
    const k9 = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'K9o')).easy.example.join(' ');
    expect(k9).toMatch(/내 K♠9♦, 상대 A[♠♦]K[♠♦] → 둘 다 K를 맞추면 킥커 A에 져요/);
    const j7 = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'J7o')).easy.example.join(' ');
    expect(j7).toMatch(/플랍에 K와 J가 뜨면 상대 K[♠♦]Q[♠♦]는 K 한 쌍, 나는 J 한 쌍이라 져요/);
    const t4 = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'T4o')).easy.example.join(' ');
    expect(t4).toMatch(/K와 10이 뜨면 .* 나는 10 한 쌍이라 져요/);
  });
  it('pairs keep the chart name with the spoken particle (TT는, never 1010 or T10)', () => {
    for (const [sc, hand] of [
      [{ kind: 'rfi', hero: 'UTG' }, 'TT'],
      [{ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, 'TT'],
      [{ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'TT'],
      [{ kind: 'vs_5bet', hero: 'UTG', villain: 'BTN' }, 'TT'],
      [{ kind: 'cold_4bet', hero: 'BB', extras: { opener: 'HJ', threeBettor: 'BTN' } }, 'TT'],
    ] as Array<[Scenario, string]>) {
      const e = explainStep(stepFor(sc, hand));
      expect(e.easy.why.join(' '), hand).toMatch(/TT는 /);
      expect(e.easy.why[0].startsWith('1010'), hand).toBe(false);
      expect(easyText(e), hand).not.toMatch(/1010/);
      expect(e.handProfile, hand).toContain('TT는 중간 포켓페어');
      expect(easyText(e)).not.toMatch(/T10|T\d(?![so])/);
    }
    const text = allSteps.map((s) => easyText(explainStep(s))).join('\n');
    expect(text).not.toMatch(/T10|T\d(?![so])/);
    expect(text).not.toMatch(/1010/);
  });
  it('pair particles follow the spoken hand name in 손패 설명 and 왜 (JJ는·QQ는·99는 / 88은·77은·66은·33은)', () => {
    const profile = (hand: string) => explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, hand)).handProfile;
    expect(profile('JJ')).toContain('JJ는 큰 포켓페어');
    expect(profile('QQ')).toContain('QQ는 큰 포켓페어');
    expect(profile('99')).toContain('99는 중간 포켓페어');
    expect(profile('88')).toContain('88은 중간 포켓페어');
    expect(profile('77')).toContain('77은 작은 포켓페어');
    expect(profile('66')).toContain('66은 작은 포켓페어');
    expect(profile('33')).toContain('33은 작은 포켓페어');
    for (const hand of ['JJ', 'QQ', 'TT', '99', '88', '77', '66', '55', '33', '22']) {
      const e = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, hand));
      expect(e.handProfile, hand).not.toMatch(/(?:JJ|QQ|TT|99|55|44|22)은|(?:88|77|66|33)는/);
      expect(e.easy.why.join(' '), hand).not.toMatch(/(?:JJ|QQ|TT|99|55|44|22)은|(?:88|77|66|33)는/);
    }
  });
  it('equity examples are poker-correct: a big ace flips with a pair under its kicker, a broadway loses to an overpair', () => {
    const aq = explainStep(stepFor({ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'AQs'));
    const aqEx = aq.easy.example.join(' ');
    expect(aqEx).not.toMatch(/QQ면 10번 중 4~5번/);
    expect(aqEx).not.toMatch(/QQ면/);
    expect(aqEx).toMatch(/상대 J[♠♦]J[♠♦]면 반반에 가까워요\(10번 중 4~5번\)/);
    const aj = explainStep(stepFor({ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'AJs')).easy.example.join(' ');
    expect(aj).toMatch(/상대 10[♠♦]10[♠♦]면 반반에 가까워요/);
    for (const [sc, hand] of [
      [{ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'QJs'],
      [{ kind: 'cold_4bet', hero: 'BTN', extras: { opener: 'UTG', threeBettor: 'CO' } }, 'QJs'],
    ] as Array<[Scenario, string]>) {
      const step = stepFor(sc, hand);
      expect(step.answer, `${sc.kind} ${hand}`).toBe('fold');
      const ex = explainStep(step).easy.example.join(' ');
      expect(ex, `${sc.kind} ${hand}`).not.toMatch(/QQ처럼/);
      expect(ex, `${sc.kind} ${hand}`).not.toMatch(/10번 중 3번/);
      expect(ex, `${sc.kind} ${hand}`).toMatch(/K[♠♦]K[♠♦]처럼 큰 페어면 10번 중 2번쯤만 이겨요/);
    }
    // an opponent pair is never rendered bare ("QQ") because it collides with my cards
    for (const step of allSteps) expect(explainStep(step).easy.example.join(' '), step.hand).not.toMatch(/상대 [2-9TJQKA]{2}[면처]/);
  });
  it('fold verdicts never get a 왜 bullet that argues for raising or calling', () => {
    const folds = [
      ...allSteps,
      stepFor({ kind: 'rfi', hero: 'CO' }, 'K9o'),
      stepFor({ kind: 'rfi', hero: 'BTN' }, 'T7o'),
      stepFor({ kind: 'vs_open', hero: 'BB', villain: 'SB' }, 'K3o'),
      stepFor({ kind: 'vs_open', hero: 'BB', villain: 'UTG' }, '72o'),
      stepFor({ kind: 'vs_open', hero: 'BTN', villain: 'CO' }, 'J4o'),
      stepFor({ kind: 'vs_3bet', hero: 'CO', villain: 'BTN' }, '65s'),
    ].filter((s) => s.answer === 'fold');
    expect(folds.length).toBeGreaterThanOrEqual(8);
    for (const step of folds) {
      const why = explainStep(step).easy.why.join(' ');
      expect(why, `${step.scenario.kind} ${step.scenario.hero} ${step.hand}`).not.toMatch(/넓게 올(려도|릴 수)|난 싸게 봐요|자주 올려요\.$/);
    }
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, 'T7o')).easy.why).toContain('넓게 올리는 자리지만, 이 패는 그래도 못 들어가요.');
    expect(explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'SB' }, '72o')).easy.why).toContain('SB는 약한 패로도 올리지만, 이 패는 그보다 더 약해요.');
  });
  it('the 드라이 보드 flop example never hands a ♠♠ hero a flush draw', () => {
    let seen = 0;
    for (const step of allSteps) {
      const e = explainStep(step);
      if (!e.easy.flop) continue;
      const dry = e.easy.flop.filter((l) => /드라이/.test(l));
      expect(dry.length, step.hand).toBe(1);
      if (!step.hand.endsWith('s')) continue;
      seen++;
      expect((dry[0].match(/♠/g) ?? []).length, `${step.hand}: ${dry[0]}`).toBeLessThanOrEqual(1);
    }
    expect(seen).toBeGreaterThan(5);
    // junk "nothing hits" boards likewise
    const j = explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'UTG' }, 'J4s')).easy.example.join(' ');
    const m = /→ ((?:[2-9TJQKA]|10)[♠♦](?:[2-9TJQKA]|10)[♠♦](?:[2-9TJQKA]|10)[♠♦]) 같은 플랍에서 아무것도 안 맞아요/.exec(j);
    if (m) expect((m[1].match(/♠/g) ?? []).length, j).toBeLessThanOrEqual(1);
  });
  it('the one-liner glosses 킥커·셋·블로커·탑페어·블라인드 on first use, for every hand in every charted spot', () => {
    const POS: Pos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    const scenarios: Scenario[] = POS.map((hero) => ({ kind: 'rfi', hero }));
    for (const kind of ['vs_open', 'vs_3bet', 'vs_4bet', 'vs_5bet'] as ScenarioKind[]) {
      for (const hero of POS) for (const villain of POS) if (hero !== villain) scenarios.push({ kind, hero, villain });
    }
    scenarios.push(
      { kind: 'cold_4bet', hero: 'BTN', extras: { opener: 'UTG', threeBettor: 'CO' } },
      { kind: 'cold_4bet', hero: 'BB', extras: { opener: 'HJ', threeBettor: 'BTN' } },
      { kind: 'cold_4bet', hero: 'CO', extras: { opener: 'UTG', threeBettor: 'HJ' } },
    );
    let seen = 0;
    for (const sc of scenarios.filter(hasChart)) {
      for (const hand of ALL_HANDS) {
        const { easy } = explainStep(stepFor(sc, hand));
        seen++;
        expect(oneLinerGlossViolations(easy.oneLiner), `${sc.kind} ${sc.hero} ${hand}: ${easy.oneLiner}`).toEqual([]);
        expect(easy.oneLiner.length, easy.oneLiner).toBeLessThanOrEqual(60);
      }
    }
    expect(seen).toBeGreaterThan(1000);
    // the exact gloss forms
    expect(explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, '55')).easy.reason).toBe('플랍에서 셋(같은 숫자 3장)을 맞추면 크게 딸 수 있거든요.');
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, 'A9o')).easy.reason).toBe('미리 낸 돈(블라인드)을 먹기 좋거든요.');
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'K3o')).easy.reason).toMatch(/옆 카드\(킥커\)|큰 카드가 하나뿐/);
    expect(explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'UTG' }, 'QTo')).easy.reason).toMatch(/옆 카드\(킥커\)|한 쌍\(탑페어\)/);
    // the helper itself: the old unglossed wordings are flagged, the gloss forms are not
    const terms = (text: string) => oneLinerGlossViolations(text).map((v) => v.split('@')[0]);
    expect(terms('이 패는 접는 게 맞아요. 셋을 못 맞추면 거의 못 이기거든요.')).toEqual(['셋']);
    expect(terms('A·K 블로커로 상대가 AA·KK일 확률이 줄거든요.')).toEqual(['블로커']);
    expect(terms('큰 카드 두 장이라 탑페어를 자주 만들거든요. 블라인드를 먹기 좋거든요.')).toEqual(['탑페어', '블라인드']);
    expect(terms('A·K를 들어 상대가 AA·KK일 확률이 줄거든요(블로커).')).toEqual([]);
    expect(terms('셋(같은 숫자 3장)을 못 맞추면 옆 카드(킥커)에서 져요. 한 쌍(탑페어)을 만들고 돈(블라인드)을 먹어요.')).toEqual([]);
  });
  it('5-bet jam examples in vs_4bet talk about the 4-bet range (A5s bluffs · KK · AK · AA), never AQ or TT', () => {
    const POS: Pos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    let seen = 0;
    for (const hero of POS) {
      for (const villain of POS) {
        if (hero === villain) continue;
        const sc: Scenario = { kind: 'vs_4bet', hero, villain };
        if (!hasChart(sc)) continue;
        for (const hand of ALL_HANDS) {
          const step = stepFor(sc, hand);
          if (step.answer !== 'allin') continue;
          seen++;
          const ex = explainStep(step).easy.example.join(' ');
          const label = `${hero} vs ${villain} ${hand}: ${ex}`;
          expect(ex, label).not.toMatch(/A[♠♦]Q[♠♦]|AQ/);
          expect(ex, label).not.toMatch(/10[♠♦]10|TT|1010/);
          expect(ex, label).toMatch(/K[♠♦]?K|A[♠♦]?K|A[♠♦]?A|A[♠♦]?5/);
        }
      }
    }
    expect(seen).toBeGreaterThanOrEqual(5);
    const ak = explainStep(stepFor({ kind: 'vs_4bet', hero: 'BTN', villain: 'CO' }, 'AKs')).easy.example;
    expect(ak).toEqual(['내 A♠K♠ → 상대 A♦5♦ 같은 뻥(블러프)은 올인에 접어요.', '상대가 KK면 10번 중 3번, Q♠Q♦면 반반이에요.']);
    const qq = explainStep(stepFor({ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'QQ')).easy.example;
    expect(qq).toEqual(['내 Q♠Q♦, 상대 A♦K♠ → 반반 싸움이에요(10번 중 5번쯤).', '상대 A♦5♦ 같은 뻥(블러프)은 접어 줘요.', '상대 K♠K♦·A♠A♦면 10번 중 2번만 이겨요.']);
    const kk = explainStep(stepFor({ kind: 'vs_4bet', hero: 'BTN', villain: 'UTG' }, 'KK')).easy.example.join(' ');
    expect(kk).toContain('상대 Q♠Q♦ → 10번 중 8번');
    expect(kk).toContain('상대 A♦5♦ 같은 뻥(블러프)은 접어 주고, AK는 10번 중 7번 이겨요.');
    const aa = explainStep(stepFor({ kind: 'vs_4bet', hero: 'BTN', villain: 'CO' }, 'AA')).easy.example.join(' ');
    expect(aa).toContain('상대가 뭘 들었든 앞서요. 뻥은 접고 센 패는 콜해 주니 이득이에요.');
  });
  it('a pair never sees a rank above itself in the 드라이 보드 flop line (QQ → 10♠7♦2♠); other hands keep K♠7♦2♠', () => {
    const V = (r: string) => '23456789TJQKA'.indexOf(r === '10' ? 'T' : r);
    const cases: Array<[Scenario, string]> = [];
    for (const hand of ['QQ', 'JJ', 'TT', '99', '88']) {
      cases.push([{ kind: 'rfi', hero: 'UTG' }, hand], [{ kind: 'rfi', hero: 'BTN' }, hand]);
      cases.push([{ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, hand], [{ kind: 'vs_open', hero: 'CO', villain: 'UTG' }, hand]);
      cases.push([{ kind: 'vs_3bet', hero: 'CO', villain: 'BB' }, hand], [{ kind: 'vs_3bet', hero: 'BTN', villain: 'BB' }, hand]);
      cases.push([{ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, hand], [{ kind: 'vs_4bet', hero: 'SB', villain: 'BTN' }, hand]);
    }
    let seen = 0;
    for (const [sc, hand] of cases) {
      const e = explainStep(stepFor(sc, hand));
      if (!e.easy.flop) continue;
      seen++;
      const dry = e.easy.flop.filter((l) => /드라이/.test(l));
      expect(dry.length, `${sc.kind} ${hand}`).toBe(1);
      const m = /^((?:10|[2-9TJQKA])[♠♦](?:10|[2-9TJQKA])[♠♦](?:10|[2-9TJQKA])[♠♦])처럼 드라이/.exec(dry[0]);
      expect(m, `${sc.kind} ${hand}: ${dry[0]}`).not.toBeNull();
      for (const r of m![1].match(/10|[2-9TJQKA]/g)!) expect(V(r), `${sc.kind} ${hand}: ${dry[0]}`).toBeLessThan(V(hand[0]));
    }
    expect(seen).toBeGreaterThanOrEqual(10);
    const flopOf = (sc: Scenario, hand: string) => explainStep(stepFor(sc, hand)).easy.flop!.join(' ');
    expect(flopOf({ kind: 'rfi', hero: 'UTG' }, 'QQ')).toContain('10♠7♦2♠처럼 드라이한 보드');
    expect(flopOf({ kind: 'rfi', hero: 'UTG' }, 'JJ')).toContain('9♠6♦2♠처럼 드라이한 보드');
    expect(flopOf({ kind: 'rfi', hero: 'UTG' }, 'TT')).toContain('8♠5♦2♠처럼 드라이한 보드');
    expect(flopOf({ kind: 'rfi', hero: 'CO' }, '88')).toContain('7♠4♦2♠처럼 드라이한 보드');
    expect(flopOf({ kind: 'rfi', hero: 'UTG' }, 'AA')).toContain('Q♠9♦2♠처럼 드라이한 보드');
    // non-pair hands (and small pairs) keep the K-high dry board from the style guide
    expect(flopOf({ kind: 'rfi', hero: 'BTN' }, 'A9o')).toContain('K♠7♦2♠처럼 드라이한 보드');
    expect(flopOf({ kind: 'vs_open', hero: 'HJ', villain: 'UTG' }, 'AJs')).toContain('K♦7♠2♦처럼 드라이한 보드');
    expect(flopOf({ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, '55')).toContain('K♠7♦2♠처럼 드라이한 보드');
  });
  it('easy.reason is the one-liner minus the verdict, and never starts with the verdict', () => {
    for (const step of allSteps) {
      const { easy } = explainStep(step);
      expect(easy.reason.length).toBeGreaterThan(0);
      expect(easy.oneLiner.endsWith(easy.reason), step.hand).toBe(true);
      expect(easy.reason, step.hand).not.toMatch(/^(이 패는 .*게 맞아요|상대 올인(을 받아도|에는 접는))/);
      expect(easy.reason.length, easy.reason).toBeLessThanOrEqual(40);
    }
  });
  it('weak-ace kicker example uses the dominator kicker (킥커 K에 져요), not 킥커 2는', () => {
    for (const [sc, hand] of [
      [{ kind: 'rfi', hero: 'CO' }, 'A2s'],
      [{ kind: 'rfi', hero: 'BTN' }, 'A5s'],
      [{ kind: 'vs_3bet', hero: 'BTN', villain: 'BB' }, 'A9s'],
    ] as Array<[Scenario, string]>) {
      const ex = explainStep(stepFor(sc, hand)).easy.example.join(' ');
      expect(ex, hand).not.toMatch(/킥커 (?:10|[2-9]|[AKQJ])[는은] 져요/);
      if (/둘 다 A를 맞추면/.test(ex)) expect(ex, hand).toMatch(/킥커 K에 져요/);
    }
  });
  it('never produces particle glitches for numeric ranks', () => {
    const text = allSteps.map((s) => easyText(explainStep(s))).join('\n');
    // 10·8·7·6·3 end in a consonant (십·팔·칠·육·삼) → 이/을; A·K·Q·J·9·5·4·2 end in a vowel → 가/를
    expect(text).not.toMatch(/(?:10|[3678])[가를는]\s/);
    expect(text).not.toMatch(/(?:[2459]|[AKQJ])[이을은]\s/);
    expect(text).not.toMatch(/BTN[가는를와]/);
  });
});

describe('glossary', () => {
  it('has every row of the style-guide table', () => {
    for (const t of ['레인지', '오픈', '3벳', '4벳', '5벳', '콜', '폴드', '포지션', '아웃오브포지션', '블로커', '도미네이트', '킥커', '팟 오즈', '임플라이드 오즈', '셋마이닝', '에퀴티', '폴드 에퀴티', '밸류', '블러프', '세미 블러프', '넛', '드로우', '백도어', '수티드', '오프수트', '커넥터', '갭퍼', '브로드웨이', '휠 에이스', '포켓페어', '오버페어', '탑페어', '셋', '보드', '플랍', '드라이 보드', '웻 보드', 'c-bet', '체크', '체크-레이즈', '스퀴즈', 'SPR', '어그레서', '콜러', '헤즈업', '리버스 임플라이드 오즈', '솔버', '혼합', '블라인드']) {
      expect(glossaryLookup(t), t).toBeDefined();
    }
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(49);
  });
  it('every non-table word the easy block leans on is tappable (블라인드 via SB/BB too)', () => {
    expect(glossaryLookup('블라인드')?.def).toMatch(/미리 내는 돈/);
    expect(glossaryLookup('SB')?.term).toBe('블라인드');
    expect(glossaryLookup('BB')?.term).toBe('블라인드');
    const text = allSteps.map((s) => easyText(explainStep(s))).join('\n');
    expect(text).toMatch(/블라인드/);
  });
  it('resolves aliases case-insensitively', () => {
    expect(glossaryLookup('gto')?.term).toBe('솔버');
    expect(glossaryLookup('올인')?.term).toBe('5벳');
    expect(glossaryLookup('뻥')?.term).toBe('블러프');
    expect(glossaryLookup('없는 말')).toBeUndefined();
  });
});

describe('trainer sequences', () => {
  it('builds an RFI step and never crashes over many deals', () => {
    seedRandom(7);
    for (let i = 0; i < 200; i++) {
      const seq = nextHandSequence(DEFAULT_SESSION_OPTIONS);
      expect(seq.steps.length).toBeGreaterThan(0);
      for (const s of seq.steps) {
        const e = explainStep(s);
        expect(e.easy.oneLiner.length).toBeLessThanOrEqual(60);
        expect(jargonViolations(easyText(e))).toEqual([]);
        expect(oneLinerGlossViolations(e.easy.oneLiner), e.easy.oneLiner).toEqual([]);
      }
    }
  });
  it('BB never gets an rfi step; UTG never gets a vs_open step', () => {
    for (let i = 0; i < 30; i++) {
      expect(buildSteps('BB', 'AKs', DEFAULT_SESSION_OPTIONS).some((s) => s.scenario.kind === 'rfi')).toBe(false);
      expect(buildSteps('UTG', 'AKs', DEFAULT_SESSION_OPTIONS).some((s) => s.scenario.kind === 'vs_open')).toBe(false);
    }
  });
});

describe('settings-respecting sequences', () => {
  it('never produces a scenario kind that the settings exclude', () => {
    seedRandom(11);
    const cases: Array<{ positions: Pos[]; kinds: ScenarioKind[] }> = [
      { positions: ['UTG'], kinds: ['vs_open'] },
      { positions: ['BB'], kinds: ['rfi'] },
      { positions: ['UTG', 'HJ'], kinds: ['cold_4bet'] },
      { positions: ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'], kinds: ['vs_5bet'] },
      { positions: ['UTG', 'HJ'], kinds: ['cold_4bet', 'vs_4bet'] },
    ];
    for (const c of cases) {
      const opts = { ...DEFAULT_SESSION_OPTIONS, ...c };
      for (let i = 0; i < 100; i++) {
        const seq = nextHandSequence(opts);
        for (const s of seq.steps) expect(c.kinds, `${c.positions}/${c.kinds} produced ${s.scenario.kind}`).toContain(s.scenario.kind);
      }
    }
  });
  it('returns empty steps when nothing is feasible and throws for quiz', () => {
    const opts = { ...DEFAULT_SESSION_OPTIONS, positions: ['UTG'] as Pos[], kinds: ['vs_open'] as ScenarioKind[] };
    expect(nextHandSequence(opts).steps).toEqual([]);
    expect(() => randomQuizStep(opts)).toThrow();
  });
});
