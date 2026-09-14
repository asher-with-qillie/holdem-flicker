import { beforeAll, describe, expect, it } from 'vitest';
import { hasChart } from '../src/poker/data';
import { classifyHand, dominatedBy, dominatorOf, explainStep, glossSentence, suitOrientation, type Explanation } from '../src/poker/explain';
import { parseHandName, ALL_HANDS, dealCardsFor } from '../src/poker/hands';
import { GLOSSARY, glossaryLookup, GLOSSARY_WORDS } from '../src/poker/glossary';
import { splitTerms } from '../src/components/Term';
import { readFileSync } from 'node:fs';
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

/* ------------------------------------------------------------------ */
/* docs/PLAIN_KO_STYLE.md (v2) — 용어 정책                               */
/* ------------------------------------------------------------------ */

/** C단계: 어디에도 나오면 안 되는 말 (표준 용어를 억지로 푼 표현 + 옛 정책의 잔재). */
const BANNED = [
  '뻥',
  '옆 카드',
  '같은 숫자 3장',
  '미리 낸 돈',
  '제일 높은 한 쌍',
  '폴드 에퀴티',
  '에퀴티',
  '리니어',
  '폴라',
  '양극화',
  '실현',
  '콤보',
  '10번 중',
];

/** A단계: 그대로 쓰는 표준 용어. 뒤에 "(…)" 풀이가 붙으면 안 됩니다. */
const TIER_A = [
  '폴드', '콜', '레이즈', '오픈', '3벳', '4벳', '5벳', '올인', '블러프', '밸류', '킥커', '셋', '탑페어', '오버페어',
  '포켓페어', '플러시', '스트레이트', '드로우', '보드', '플랍', '포지션', '블라인드', '팟', '레인지', '수티드',
  '오프수트', '커넥터', '브로드웨이',
];

/** B단계: 해설 하나에서 딱 한 번만 풀어 주는 개념. */
const TIER_B = ['블로커', '도미네이트', '셋마이닝', '팟 오즈', '임플라이드 오즈', '스퀴즈', 'c-bet', 'SPR', '세미 블러프', '백도어'];

const explainCss = readFileSync(new URL('../src/styles/explain.css', import.meta.url), 'utf8');

const easyStrings = (e: Explanation) => [e.easy.oneLiner, ...e.easy.why, ...e.easy.example, ...(e.easy.flop ?? [])];
/** explain.ts가 직접 만드는 기술 블록 문자열(차트 메모는 src/poker/data 소유라 여기서 빠집니다). */
const generatedTech = (e: Explanation) => [
  e.situation,
  e.handProfile,
  ...e.reasoning,
  e.rangeContext,
  e.mixNote ?? '',
  ...(e.postflop ? [e.postflop.spr, e.postflop.goodBoards, e.postflop.badBoards, ...e.postflop.checklist, ...e.postflop.plan] : []),
];
/** "자세히" 블록이 실제로 렌더하는 전부 — 차트 메모도 같은 시트에 그대로 찍히므로 용어 정책이 같이 적용됩니다. */
const techStrings = (e: Explanation) => [...generatedTech(e), e.chartNote ?? ''];
const allStrings = (e: Explanation) => [...easyStrings(e), ...techStrings(e)];
const easyText = (e: Explanation) => easyStrings(e).join('\n');

/** Tier-C wording anywhere in the explanation. */
function bannedWords(e: Explanation): string[] {
  const text = allStrings(e).join('\n');
  return BANNED.filter((b) => text.includes(b));
}

/**
 * A tier-A term followed by "(" — the gloss the v2 guide removes ("셋(같은 숫자 3장)", "3벳(상대…)").
 * "세미 블러프(…)" is a tier-B gloss that merely ends in a tier-A word, so it does not count.
 */
function tierAGlosses(e: Explanation): string[] {
  const out: string[] = [];
  for (const s of allStrings(e)) {
    for (const t of TIER_A) {
      for (let i = s.indexOf(`${t}(`); i >= 0; i = s.indexOf(`${t}(`, i + 1)) {
        const tailOfB = TIER_B.some((b) => b !== t && b.endsWith(t) && s.slice(Math.max(0, i - (b.length - t.length)), i + t.length) === b);
        if (!tailOfB) out.push(`${t}( @ ${s}`);
      }
    }
  }
  return out;
}

/**
 * A tier-B concept is explained at most once per explanation, and never in the easy block.
 * 풀이는 두 꼴로 나옵니다: 차트 메모의 괄호("블로커(…)")와 explain.ts가 붙이는 한 문장("블로커는 … 효과입니다.").
 */
function glossHits(text: string, t: string): number {
  const sentence = glossSentence(t);
  const paren = text.split(`${t}(`).length - 1;
  return paren + (sentence ? text.split(sentence).length - 1 : 0);
}
function tierBGlossCounts(e: Explanation): Record<string, number> {
  const text = allStrings(e).join('\n');
  const out: Record<string, number> = {};
  for (const t of TIER_B) {
    const n = glossHits(text, t);
    if (n) out[t] = n;
  }
  return out;
}

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

const allSteps: Step[] = CASES.map(([sc, hand]) => stepFor(sc, hand));

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
  it('mixed hands get a frequency note with plain percentages', () => {
    const e = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'ATo'));
    expect(e.mixNote).toContain('50%');
    expect(e.mixNote).toMatch(/다\.$/);
    expect(e.mixNote).not.toMatch(/GTO|솔버/);
  });
  it('technical prose keeps one plain register (~합니다 / ~입니다), never ~해요', () => {
    const e = explainStep(stepFor({ kind: 'vs_3bet', hero: 'BTN', villain: 'BB' }, 'T9s'));
    const all = generatedTech(e).join('\n');
    expect(all).not.toMatch(/거든요|해요\.|예요\.|이에요\./);
    expect(all).toMatch(/니다\./);
  });
  it('percentages are written as numbers, never "10번 중 N번"', () => {
    for (const step of allSteps) {
      const e = explainStep(step);
      expect(allStrings(e).join('\n'), step.hand).not.toMatch(/10번 중/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Easy block                                                           */
/* ------------------------------------------------------------------ */

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
      // 길이 (가이드 §4)
      expect(easy.oneLiner.length).toBeGreaterThan(0);
      expect(easy.oneLiner.length, easy.oneLiner).toBeLessThanOrEqual(60);
      expect(easy.why.length).toBeGreaterThanOrEqual(2);
      expect(easy.why.length).toBeLessThanOrEqual(3);
      for (const w of easy.why) expect(w.length, w).toBeLessThanOrEqual(30);
      expect(easy.example.length).toBeGreaterThanOrEqual(1);
      expect(easy.example.length).toBeLessThanOrEqual(3);
      for (const x of easy.example) expect(x.length, x).toBeLessThanOrEqual(40);
      expect(easy.example.join('\n'), easy.example.join(' | ')).toMatch(/[♠♦]/);
      // 결론은 액션 한 단어로 시작 (가이드 §2.2)
      expect(easy.oneLiner, easy.oneLiner).toMatch(/^(폴드하세요|오픈하세요|콜하세요|3벳하세요|4벳하세요|올인하세요|올인을 콜하세요|올인에는 폴드하세요)\. /);
      // suits: only spades / diamonds in examples
      expect(easyText(e)).not.toMatch(/[♥♣]/);
      const expectFlop = step.answer !== 'fold' && step.answer !== 'allin' && step.scenario.kind !== 'vs_5bet';
      if (expectFlop) {
        expect(easy.flop, 'flop present').toBeDefined();
        expect(easy.flop!.length).toBeGreaterThanOrEqual(3);
        expect(easy.flop!.length).toBeLessThanOrEqual(4);
        expect(easy.flop!.join('\n')).toMatch(/[♠♦]/);
        for (const f of easy.flop!) expect(f.length, f).toBeLessThanOrEqual(35);
      } else {
        expect(easy.flop, 'no flop').toBeUndefined();
      }
      // 용어 정책
      expect(bannedWords(e), allStrings(e).join(' | ')).toEqual([]);
      expect(tierAGlosses(e)).toEqual([]);
      for (const [t, n] of Object.entries(tierBGlossCounts(e))) expect(n, `${t} 풀이 ${n}회`).toBeLessThanOrEqual(1);
      for (const s of easyStrings(e)) for (const t of TIER_B) expect(glossHits(s, t), `easy에 ${t} 풀이: ${s}`).toBe(0);
      // no broken cards: a bare rank never sits between suited cards in a board like "K♠72♠"
      expect(easyText(e)).not.toMatch(/[♠♦][2-9TJQKA]{2}[♠♦]/);
      // the same card never appears twice in one example / flop line
      for (const line of easyStrings(e)) {
        const cards = line.match(/(?:10|[2-9TJQKA])[♠♦]/g) ?? [];
        expect(new Set(cards).size, `중복 카드: ${line}`).toBe(cards.length);
      }
    });
  }

  it('the terminology policy holds for every hand in every charted spot', () => {
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
        const e = explainStep(stepFor(sc, hand));
        const where = `${sc.kind} ${sc.hero} ${hand}`;
        seen++;
        expect(bannedWords(e), where).toEqual([]);
        expect(tierAGlosses(e), where).toEqual([]);
        for (const [t, n] of Object.entries(tierBGlossCounts(e))) expect(n, `${where}: ${t} 풀이 ${n}회`).toBeLessThanOrEqual(1);
        expect(e.easy.oneLiner.length, `${where}: ${e.easy.oneLiner}`).toBeLessThanOrEqual(60);
        for (const w of e.easy.why) expect(w.length, `${where}: ${w}`).toBeLessThanOrEqual(30);
        for (const x of e.easy.example) expect(x.length, `${where}: ${x}`).toBeLessThanOrEqual(40);
        for (const f of e.easy.flop ?? []) expect(f.length, `${where}: ${f}`).toBeLessThanOrEqual(35);
      }
    }
    expect(seen).toBeGreaterThan(1000);
  });

  it('the tier-C words the v2 guide bans are nowhere to be found', () => {
    const text = allSteps.map((s) => allStrings(explainStep(s)).join('\n')).join('\n');
    for (const b of BANNED) expect(text.includes(b), b).toBe(false);
    // and the standard terms ARE used, bare
    for (const t of ['폴드', '콜', '킥커', '셋', '탑페어', '블러프', '레인지', '수티드', '오프수트']) expect(text, t).toContain(t);
  });

  it('tier-B concepts are explained once, in the 자세히 block only', () => {
    const e = explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, 'A5s'));
    // 풀이는 문장 가운데 괄호가 아니라 그 문장 뒤에 한 문장으로 붙습니다 (가이드 §2.1).
    expect(e.handProfile).toContain('블로커는 내가 그 카드를 들어 상대 조합이 줄어드는 효과입니다.');
    expect(e.handProfile).not.toContain('블로커(');
    expect(glossHits(allStrings(e).join('\n'), '블로커')).toBe(1);
    // the easy block uses the bare term (tappable in the glossary), never a gloss
    const bluff = explainStep(stepFor({ kind: 'vs_3bet', hero: 'CO', villain: 'BTN' }, 'A5s'));
    expect(bluff.easy.example.join(' ')).toMatch(/블로커/);
    expect(bluff.easy.example.join(' ')).not.toMatch(/블로커\(/);
    const spr = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'AA'));
    expect(spr.postflop!.spr).toContain('SPR은 팟 대비 남은 스택 비율입니다.');
    expect(glossHits(allStrings(spr).join('\n'), 'SPR')).toBe(1);
  });

  it('example cards come from the hand (hero cards are shown)', () => {
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, 'A5s')).easy.example.join(' ')).toContain('A♠5♠');
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'SB' }, 'KQo')).easy.example.join(' ')).toContain('K♠Q♦');
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, '55')).easy.example.join(' ')).toContain('5♠5♦');
    expect(explainStep(stepFor({ kind: 'vs_open', hero: 'BTN', villain: 'HJ' }, '88')).easy.example.join(' ')).toMatch(/셋이 될 확률 12%/);
  });

  it('examples follow the fixed "내 X vs 상대 Y → …" shape of the guide', () => {
    const a9 = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'A9o')).easy.example;
    expect(a9[0]).toBe('내 A♠9♦ vs 상대 A♦K♠ → A가 깔려도 킥커 K에 집니다.');
    // 작은 페어 오픈은 결론이 이미 "셋 12%"를 말합니다 — 예시는 그 대신 셋이 됐을 때의 보상을 보여 줍니다.
    const p55 = explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, '55')).easy.example;
    expect(p55[0]).toBe('내 5♠5♦ vs 상대 A♦K♠ → 거의 반반입니다.');
    expect(p55).toContain('셋이 되면 상대 스택을 다 받습니다.');
    const call22 = explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'CO' }, '22')).easy.example;
    expect(call22[0]).toBe('내 2♠2♦ → 플랍에서 셋이 될 확률 12%.');
  });

  it('an offsuit opponent hand never renders with two cards of the same suit', () => {
    for (const step of allSteps) {
      for (const line of explainStep(step).easy.example) {
        for (const m of line.matchAll(/((?:10|[2-9TJQKA]))([♠♦])((?:10|[2-9TJQKA]))([♠♦])/g)) {
          // a pair rendered as X♠X♦ is fine; only same-rank pairs may share a rank
          if (m[1] === m[3]) expect(m[2] === m[4], line).toBe(false);
        }
      }
    }
    // KQo vs AQo: 무늬가 붙으면 오프수트로 읽혀야 하고, 남은 무늬가 없으면 차트 이름 그대로 씁니다.
    const kq = explainStep(stepFor({ kind: 'rfi', hero: 'CO' }, 'KQo')).easy.example.join(' ');
    expect(kq).toMatch(/상대 (?:A[♠♦]Q[♠♦]|AQo)/);
    expect(kq).not.toMatch(/상대 A♦Q♦|상대 A♠Q♠/);
    const q9 = explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, 'Q9s')).easy.example.join(' ');
    expect(q9).not.toMatch(/상대 A♦Q♦|상대 A♠Q♠/);
  });

  it('bluff 4-bet with a wheel ace mentions the blocker', () => {
    const e = explainStep(stepFor({ kind: 'vs_3bet', hero: 'CO', villain: 'BTN' }, 'A5s'));
    expect(e.easy.example.join(' ')).toMatch(/블로커/);
  });

  it('mixed hands mention the alternative in 왜, with a percentage', () => {
    const tie = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'ATo')); // open/fold 50/50
    const tieWhy = tie.easy.why.join(' ');
    expect(tieWhy).toMatch(/절반은 폴드합니다\./);
    expect(tieWhy).not.toMatch(/가끔/);
    // 불릿은 사실 하나만 — 암기용 타이브레이크는 자세히 · 혼합 빈도에만 있습니다 (가이드 §2.1·§4.2)
    expect(tieWhy).not.toMatch(/정답/);
    expect(tie.mixNote, 'mixNote keeps the tie-break rule').toMatch(/공격적인 쪽/);
    for (const w of tie.easy.why) expect(w.split('.').filter((x) => x.trim()).length, w).toBe(1);
    for (const step of allSteps) {
      const alt = step.mixList[1];
      if (!alt) continue;
      const why = explainStep(step).easy.why.join(' ');
      if (alt.weight >= 0.5) expect(why, step.hand).toMatch(/절반은 (폴드|콜|오픈|3벳|4벳|올인)합니다\./);
      else expect(why, step.hand).toMatch(/(폴드|콜|오픈|3벳|4벳|올인)도 \d+% 섞습니다\./);
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
        const m = /플랍 ((?:[2-9TJQKA]|10)[♠♦](?:[2-9TJQKA]|10)[♠♦](?:[2-9TJQKA]|10)[♠♦]) →/.exec(l);
        expect(m, l).not.toBeNull();
        const ranks = m![1].replace(/[♠♦]/g, '');
        expect(ranks, `${hand}: ${l}`).not.toContain(hand[1]);
        // the three board ranks + A + my low card form 2-3-4-5
        expect([...ranks, hand[1]].sort().join(''), l).toBe('2345');
      }
    }
    // 보드는 앱 어디서나 높은 카드부터 찍습니다 (휠도 A♠3♦2♠ 순서)
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, 'A2s')).easy.example.join(' ')).toContain('5♦4♠3♦');
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, 'A4s')).easy.example.join(' ')).toContain('5♦3♠2♦');
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
    expect(kq).toMatch(/내 K♠Q♦ vs 상대 Q[♠♦]J[♠♦] → 킥커 K로 이깁니다\./);
  });

  it('junk examples explain the loss from the hero high card', () => {
    const q9 = explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, 'Q9o')).easy.example.join(' ');
    expect(q9).toMatch(/내 Q♠9♦ vs 상대 K[♠♦]Q[♠♦] → Q가 깔려도 킥커 K에 집니다\./);
    const k9 = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'K9o')).easy.example.join(' ');
    expect(k9).toMatch(/내 K♠9♦ vs 상대 A[♠♦]K[♠♦] → K가 깔려도 킥커 A에 집니다\./);
    // 화살표 없는 줄이 화살표 있는 줄 옆에 서지 않게 같은 꼴로 씁니다 (가이드 §3).
    const j7 = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'J7o')).easy.example.join(' ');
    expect(j7).toMatch(/내 J♠7♦ vs 상대 K[♠♦]Q[♠♦] → K와 J가 깔리면 집니다\./);
    const t4 = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'T4o')).easy.example.join(' ');
    expect(t4).toMatch(/내 10♠4♦ vs 상대 K[♠♦]Q[♠♦] → K와 10이 깔리면 집니다\./);
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

  it('pair particles follow the spoken hand name in 손패 and 왜 (JJ는·QQ는·99는 / 88은·77은·66은·33은)', () => {
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

  it('equity examples are poker-correct (AK vs KK 30%, AK vs QQ 43%, QQ vs AK 57%, 셋 12%, 오버페어 80%)', () => {
    // AK는 무늬에 따라 갈립니다: AKs vs QQ 46 / KK 34, AKo vs QQ 43 / KK 30 (work/review/eq.ts)
    const ak = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'AKs')).easy.example.join(' ');
    expect(ak).toMatch(/상대 (?:Q[♠♦]Q[♠♦]|QQ)에는 승률 46%입니다\./);
    const ako = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'AKo')).easy.example.join(' ');
    expect(ako).toMatch(/상대 (?:Q[♠♦]Q[♠♦]|QQ)에는 승률 43%입니다\./);
    const akFold = explainStep(stepFor({ kind: 'vs_5bet', hero: 'UTG', villain: 'BTN' }, 'AKo')).easy.example.join(' ');
    expect(akFold).toMatch(/승률 30%|43%/);
    const qq = explainStep(stepFor({ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'QQ')).easy.example.join(' ');
    expect(qq).toContain('승률 57%');
    const p55 = explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, '55'));
    expect(p55.easy.oneLiner).toContain('셋이 될 확률이 12%');
    expect(explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'CO' }, '22')).easy.example.join(' ')).toContain('셋이 될 확률 12%');
    const aq = explainStep(stepFor({ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'AQs')).easy.example.join(' ');
    expect(aq).not.toMatch(/Q[♠♦]Q[♠♦]면 반반/);
    for (const [sc, hand] of [
      [{ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'QJs'],
      [{ kind: 'cold_4bet', hero: 'BTN', extras: { opener: 'UTG', threeBettor: 'CO' } }, 'QJs'],
    ] as Array<[Scenario, string]>) {
      const step = stepFor(sc, hand);
      expect(step.answer, `${sc.kind} ${hand}`).toBe('fold');
      const ex = explainStep(step).easy.example.join(' ');
      // 오버페어 승률은 한 값이 아닙니다: KQs/AA 18, KQo/AA 16, QJs/KK 20, JTs/QQ 23
      expect(ex, `${sc.kind} ${hand}`).toMatch(/(?:K[♠♦]K[♠♦]|KK) 같은 오버페어에는 20%입니다\./);
    }
    // 무늬가 다 쓰였으면 상대 패는 차트 이름으로 찍힙니다("상대 KK"). 다만 내가 든 랭크의 페어를 이름만으로
    // 찍으면 내 패인지 상대 패인지 헷갈립니다 — 그 경우만 금지합니다.
    // ("상대 AA가 줄어듭니다"처럼 레인지를 가리키는 말은 한 패가 아니므로 뺍니다.)
    for (const step of allSteps) {
      for (const m of explainStep(step).easy.example.join(' ').matchAll(/상대 ([2-9TJQKA])\1(?=[면처에·]|\s같은)/g)) {
        expect([step.hand[0], step.hand[1]].includes(m[1]), `${step.hand}: ${m[0]}`).toBe(false);
      }
    }
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
    expect(ak).toEqual(['내 A♠K♠ → 상대 A♦5♦ 블러프는 올인에 폴드합니다.', '상대가 KK면 34%, QQ면 46%입니다.']);
    const qq = explainStep(stepFor({ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'QQ')).easy.example;
    // 한 해설의 예시 줄들은 한 판으로 읽힙니다 — A♦를 이미 쓴 줄 뒤에서는 A5s가 ♠로, KK·AA는 차트 이름으로 나옵니다.
    expect(qq).toEqual(['내 Q♠Q♦ vs 상대 A♦K♠ → 승률 57%입니다.', '상대 A♠5♠ 블러프는 폴드해 줍니다.', '상대 KK·AA면 승률 18%입니다.']);
    const kk = explainStep(stepFor({ kind: 'vs_4bet', hero: 'BTN', villain: 'UTG' }, 'KK')).easy.example.join(' ');
    expect(kk).toContain('내 K♠K♦ vs 상대 Q♠Q♦ → 승률 80%입니다.');
    expect(kk).toContain('상대 A5s 블러프는 폴드하고 AK에는 70%입니다.');
    const aa = explainStep(stepFor({ kind: 'vs_4bet', hero: 'BTN', villain: 'CO' }, 'AA')).easy.example.join(' ');
    expect(aa).toContain('상대 블러프는 폴드하고 강한 패는 콜합니다.');
  });

  it('the 드라이 보드 flop example never hands a ♠♠ hero a flush draw, and a pair never sees a higher rank', () => {
    const V = (r: string) => '23456789TJQKA'.indexOf(r === '10' ? 'T' : r);
    let seen = 0;
    for (const step of allSteps) {
      const e = explainStep(step);
      if (!e.easy.flop) continue;
      const dry = e.easy.flop.filter((l) => /드라이/.test(l));
      // 4벳 팟에는 드라이 보드 불릿이 없습니다(얕은 SPR 쪽을 씁니다) — 그 밖에는 정확히 한 줄
      expect(dry.length, step.hand).toBeLessThanOrEqual(1);
      if (!dry.length || !step.hand.endsWith('s')) continue;
      seen++;
      expect((dry[0].match(/♠/g) ?? []).length, `${step.hand}: ${dry[0]}`).toBeLessThanOrEqual(1);
    }
    expect(seen).toBeGreaterThan(5);
    const pairCases: Array<[Scenario, string]> = [];
    for (const hand of ['QQ', 'JJ', 'TT', '99', '88']) {
      pairCases.push([{ kind: 'rfi', hero: 'UTG' }, hand], [{ kind: 'rfi', hero: 'BTN' }, hand]);
      pairCases.push([{ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, hand], [{ kind: 'vs_3bet', hero: 'BTN', villain: 'BB' }, hand]);
    }
    let pairSeen = 0;
    for (const [sc, hand] of pairCases) {
      const e = explainStep(stepFor(sc, hand));
      if (!e.easy.flop) continue;
      const dry = e.easy.flop.filter((l) => /드라이/.test(l))[0];
      if (!dry) continue; // 4벳 팟
      pairSeen++;
      const m = /^((?:10|[2-9TJQKA])[♠♦](?:10|[2-9TJQKA])[♠♦](?:10|[2-9TJQKA])[♠♦])/.exec(dry);
      expect(m, `${sc.kind} ${hand}: ${dry}`).not.toBeNull();
      for (const r of m![1].match(/10|[2-9TJQKA]/g)!) expect(V(r), `${sc.kind} ${hand}: ${dry}`).toBeLessThan(V(hand[0]));
    }
    expect(pairSeen).toBeGreaterThanOrEqual(10);
    const flopOf = (sc: Scenario, hand: string) => explainStep(stepFor(sc, hand)).easy.flop!.join(' ');
    expect(flopOf({ kind: 'rfi', hero: 'UTG' }, 'AA')).toContain('J♠8♦2♠ 같은 드라이 보드');
    expect(flopOf({ kind: 'rfi', hero: 'UTG' }, 'QQ')).toContain('9♠6♦2♠ 같은 드라이 보드');
    // non-pair hands keep the K-high dry board from the style guide
    expect(flopOf({ kind: 'rfi', hero: 'BTN' }, 'A9o')).toContain('K♠7♦2♠ 같은 드라이 보드');
    expect(flopOf({ kind: 'vs_open', hero: 'HJ', villain: 'UTG' }, 'AJs')).toContain('K♦7♠2♦ 같은 드라이 보드');
  });

  it('easy.reason is the one-liner minus the action word, and never starts with it', () => {
    for (const step of allSteps) {
      const { easy } = explainStep(step);
      expect(easy.reason.length).toBeGreaterThan(0);
      expect(easy.oneLiner.endsWith(easy.reason), step.hand).toBe(true);
      expect(easy.reason, step.hand).not.toMatch(/^(폴드|오픈|콜|3벳|4벳|올인)하세요/);
      expect(easy.reason.length, easy.reason).toBeLessThanOrEqual(48);
    }
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
      expect(why, `${step.scenario.kind} ${step.scenario.hero} ${step.hand}`).not.toMatch(/넓게 오픈합니다\.$|강하지만 싸게 봅니다/);
    }
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, 'T7o')).easy.why).toContain('넓게 오픈하는 자리지만 이 패는 빠집니다.');
    expect(explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'SB' }, '72o')).easy.why).toContain('SB는 약한 패도 오픈하지만 이건 더 약합니다.');
  });

  it('the 4벳 팟 flop list talks about the shallow stack, not a single-raised-pot board bullet', () => {
    for (const [sc, hand] of [
      [{ kind: 'vs_3bet', hero: 'BTN', villain: 'SB' }, 'KK'],
      [{ kind: 'vs_3bet', hero: 'UTG', villain: 'HJ' }, 'AA'],
      [{ kind: 'vs_4bet', hero: 'HJ', villain: 'UTG' }, 'QQ'],
    ] as Array<[Scenario, string]>) {
      const step = stepFor(sc, hand);
      const e = explainStep(step);
      if (!e.easy.flop) continue;
      const flop = e.easy.flop.join(' | ');
      const label = `${sc.kind} ${sc.hero} ${hand}: ${flop}`;
      if (!/올인까지/.test(flop)) continue; // 4벳 팟이 아닌 경우는 건너뜁니다
      expect(flop, label).not.toMatch(/드라이 보드/);
      expect(flop, label).toMatch(/작게 c-bet|첫 벳에 폴드|오버페어면/); // 포켓페어는 '미스'가 없어 오버페어로 말합니다
      // 낮은 보드 예시가 한 리스트에 두 번 나오지 않습니다
      expect((flop.match(/(?:10|[2-9TJQKA])[♠♦](?:10|[2-9TJQKA])[♠♦](?:10|[2-9TJQKA])[♠♦]/g) ?? []).length, label).toBeLessThanOrEqual(1);
    }
  });

  it('a 체크-레이즈를 맞는 쪽은 플랍에서 벳하는 쪽뿐 — 포지션 없는 콜러에게는 그 불릿이 가지 않는다', () => {
    const POS: Pos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    const scenarios: Scenario[] = [];
    for (const hero of POS) scenarios.push({ kind: 'rfi', hero });
    for (const kind of ['vs_open', 'vs_3bet', 'vs_4bet'] as ScenarioKind[]) {
      for (const hero of POS) for (const villain of POS) if (hero !== villain) scenarios.push({ kind, hero, villain });
    }
    let callers = 0;
    for (const sc of scenarios.filter(hasChart)) {
      for (const hand of ALL_HANDS) {
        const step = stepFor(sc, hand);
        const e = explainStep(step);
        if (!e.easy.flop || !e.postflop) continue;
        const where = `${sc.kind} ${sc.hero} ${hand}`;
        const line = e.easy.flop.find((f) => f.includes('체크-레이즈'));
        if (!line) continue;
        if (e.postflop.role.includes('콜러') && e.postflop.position.includes('없음')) {
          callers++;
          expect(line, where).toBe('체크-레이즈할 패도 준비');
        }
      }
    }
    expect(callers).toBeGreaterThan(50);
    // BB 콜러(포지션 없음)의 대표 예
    const bb = explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'CO' }, 'K4s')).easy.flop ?? [];
    expect(bb.join(' | ')).not.toContain('체크-레이즈가 오면 폴드도 고려');
    // SB 오픈(포지션 없는 레이저)은 그대로 유지
    const sb = explainStep(stepFor({ kind: 'rfi', hero: 'SB' }, 'KQo')).easy.flop ?? [];
    expect(sb).toContain('체크-레이즈가 오면 폴드도 고려');
  });

  it('보드는 어디서나 높은 카드부터 (휠은 A가 맨 앞)', () => {
    const V = (r: string) => '23456789TJQKA'.indexOf(r === '10' ? 'T' : r);
    const CARD = '(?:10|[2-9TJQKA])[♠♦]';
    const re = new RegExp(`${CARD}${CARD}${CARD}`, 'g');
    let seen = 0;
    for (const step of allSteps) {
      const e = explainStep(step);
      for (const line of [...e.easy.example, ...(e.easy.flop ?? [])]) {
        for (const m of line.match(re) ?? []) {
          seen++;
          const ranks = m.match(/10|[2-9TJQKA]/g)!;
          for (let i = 1; i < ranks.length; i++) expect(V(ranks[i - 1]), `${line} (${m})`).toBeGreaterThan(V(ranks[i]));
        }
      }
    }
    expect(seen).toBeGreaterThan(20);
    const wheel = explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, '54s')).easy.example.join(' ');
    expect(wheel, wheel).toMatch(/A[♠♦]3[♠♦]2[♠♦]/);
  });

  it('작은 페어 폴드는 20%를 "셋이 아니면"에 붙이지 않는다', () => {
    let seen = 0;
    for (const [sc, hand] of [
      [{ kind: 'vs_4bet', hero: 'SB', villain: 'UTG' }, '77'],
      [{ kind: 'vs_open', hero: 'BB', villain: 'UTG' }, '44'],
      [{ kind: 'vs_3bet', hero: 'UTG', villain: 'BB' }, '77'],
      [{ kind: 'cold_4bet', hero: 'BB', extras: { opener: 'HJ', threeBettor: 'BTN' } }, '66'],
    ] as Array<[Scenario, string]>) {
      const step = stepFor(sc, hand);
      if (step.answer !== 'fold') continue;
      seen++;
      const ex = explainStep(step).easy.example;
      const where = `${sc.kind} ${sc.hero} ${hand}: ${ex.join(' | ')}`;
      expect(ex.join(' '), where).not.toMatch(/셋이 아니면 승률/);
      expect(ex.join(' '), where).toMatch(/→ 승률 20%입니다\./);
      expect(ex, where).toContain('그 20%도 대부분 셋을 맞출 때입니다.');
      // 왜? 첫 불릿과 같은 문장이 한 시트에 두 번 나오지 않습니다
      const why = explainStep(step).easy.why;
      for (const line of ex) expect(why, `${where}: ${line}`).not.toContain(line);
    }
    expect(seen).toBeGreaterThanOrEqual(2);
  });

  it('AK 승률은 한 해설 안에서 무늬에 맞는 같은 값을 쓴다 (AKs 46/34/12, AKo 43/30/8)', () => {
    const profile = (sc: Scenario, hand: string) => explainStep(stepFor(sc, hand)).handProfile;
    expect(profile({ kind: 'rfi', hero: 'UTG' }, 'AKs')).toContain('QQ에는 46%, KK에는 34%, AA에는 12%');
    expect(profile({ kind: 'rfi', hero: 'UTG' }, 'AKo')).toContain('QQ에는 43%, KK에는 30%, AA에는 8%');
    expect(profile({ kind: 'rfi', hero: 'UTG' }, 'AKo')).not.toContain('AA에는 12%');
    // 손패·왜?·예시가 한 화면에서 서로 다른 수치를 말하지 않습니다
    for (const hand of ['AKs', 'AKo']) {
      const suited = hand.endsWith('s');
      for (const sc of [
        { kind: 'rfi', hero: 'UTG' },
        { kind: 'vs_open', hero: 'BTN', villain: 'UTG' },
        { kind: 'vs_3bet', hero: 'UTG', villain: 'BTN' },
        { kind: 'vs_5bet', hero: 'UTG', villain: 'BTN' },
      ] as Scenario[]) {
        const text = allStrings(explainStep(stepFor(sc, hand))).join('\n');
        const wrong = suited
          ? ['AA에는 8%', 'QQ에 43%', 'KK에 30%', '승률 43%', 'KK면 30%', 'QQ면 43%']
          : ['AA에는 12%', 'QQ에 46%', 'KK에 34%', '승률 46%', 'KK면 34%', 'QQ면 46%'];
        for (const w of wrong) expect(text.includes(w), `${hand} ${sc.kind}: ${w}`).toBe(false);
      }
    }
    const aa = explainStep(stepFor({ kind: 'vs_5bet', hero: 'UTG', villain: 'BTN' }, 'AA')).easy.example.join(' ');
    expect(aa).toContain('승률 90%');
    expect(aa).not.toContain('87%');
  });

  it('차트 메모가 이미 푼 용어는 본문에서 다시 풀지 않는다 (한 시트에 풀이 1회)', () => {
    const e = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'A2s'));
    expect(e.chartNote, 'chart note glosses 블로커').toMatch(/블로커\(/);
    expect(glossHits(allStrings(e).join('\n'), '블로커'), allStrings(e).join('\n')).toBe(1);
    expect(e.handProfile).toContain('블로커');
    expect(e.handProfile).not.toContain('블로커(');
    expect(e.handProfile).not.toContain(glossSentence('블로커'));
    // 차트 메모까지 포함해 모든 시나리오에서 풀이는 용어당 1회
    const POS: Pos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
    const scenarios: Scenario[] = POS.map((hero) => ({ kind: 'rfi', hero }) as Scenario);
    for (const kind of ['vs_open', 'vs_3bet', 'vs_4bet', 'vs_5bet'] as ScenarioKind[]) {
      for (const hero of POS) for (const villain of POS) if (hero !== villain) scenarios.push({ kind, hero, villain });
    }
    for (const sc of scenarios.filter(hasChart)) {
      for (const hand of ALL_HANDS) {
        const exp = explainStep(stepFor(sc, hand));
        for (const [t, n] of Object.entries(tierBGlossCounts(exp))) expect(n, `${sc.kind} ${sc.hero} ${hand}: ${t} 풀이 ${n}회`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never produces particle glitches for numeric ranks', () => {
    const text = allSteps.map((s) => allStrings(explainStep(s)).join('\n')).join('\n');
    // 10·8·7·6·3 end in a consonant (십·팔·칠·육·삼) → 이/을; A·K·Q·J·9·5·4·2 end in a vowel → 가/를
    expect(text).not.toMatch(/(?:10|[3678])[가를는]\s/);
    expect(text).not.toMatch(/(?:[2459]|[AKQJ])[이을은]\s/);
    expect(text).not.toMatch(/BTN[가는를와]/);
  });
});

/* ------------------------------------------------------------------ */
/* 읽기 쉬운 문장 (가이드 §2) — 전 차트 감사                                */
/* ------------------------------------------------------------------ */

/** 티어-B 괄호 풀이는 길이 계산에서 뺍니다 (가이드가 요구하는 설명이라 문장이 길어 보이는 것뿐). */
const GLOSS_SENTENCE_RE = new RegExp(
  `\\s?(?:${TIER_B.map((t) => glossSentence(t))
    .filter((x): x is string => x != null)
    .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})`,
  'g',
);
const bare = (s: string) => s.replace(/\([^)]*\)/g, '').replace(GLOSS_SENTENCE_RE, '').trim();
const sentencesOf = (s: string) => bare(s).split(/(?<=[.?])\s+/).filter((x) => x.trim());
/** "자세히" 블록에서 불릿으로 렌더되는 문자열 (ExplanationSheet: 자세한 이유 · 체크리스트 · 플레이 계획). */
const techBullets = (e: Explanation) => [...e.reasoning, ...(e.postflop ? [...e.postflop.checklist, ...e.postflop.plan] : [])];
/** 문단으로 렌더되는 문자열. */
const techParagraphs = (e: Explanation) => [e.situation, e.handProfile, e.rangeContext, e.mixNote ?? '', ...(e.postflop ? [e.postflop.spr, e.postflop.goodBoards, e.postflop.badBoards] : [])];

/** 결론의 액션 단어 → 이유 절에서 되풀이하면 안 되는 말 (가이드 §4.1: 액션 + 이유이지 액션 + 액션이 아닙니다). */
const VERDICT_WORD: Record<string, string> = {
  '폴드하세요.': '폴드',
  '오픈하세요.': '오픈',
  '콜하세요.': '콜',
  '3벳하세요.': '3벳',
  '4벳하세요.': '4벳',
  '올인하세요.': '올인',
  '올인을 콜하세요.': '콜',
  '올인에는 폴드하세요.': '폴드',
};

const ALL_SPOTS: Scenario[] = (() => {
  const POS: Pos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  const out: Scenario[] = POS.map((hero) => ({ kind: 'rfi', hero }) as Scenario);
  for (const kind of ['vs_open', 'vs_3bet', 'vs_4bet', 'vs_5bet'] as ScenarioKind[]) {
    for (const hero of POS) for (const villain of POS) if (hero !== villain) out.push({ kind, hero, villain });
  }
  out.push(
    { kind: 'cold_4bet', hero: 'BTN', extras: { opener: 'UTG', threeBettor: 'CO' } },
    { kind: 'cold_4bet', hero: 'BB', extras: { opener: 'HJ', threeBettor: 'BTN' } },
    { kind: 'cold_4bet', hero: 'CO', extras: { opener: 'UTG', threeBettor: 'HJ' } },
  );
  return out.filter(hasChart);
})();

describe('readability (가이드 §2)', () => {
  it('자세히 블록도 앞 블록과 같은 기준으로 끊어 쓴다 (불릿 70자·문장 2개 이내)', () => {
    let seen = 0;
    for (const sc of ALL_SPOTS) {
      for (const hand of ALL_HANDS) {
        const e = explainStep(stepFor(sc, hand));
        seen++;
        for (const b of techBullets(e)) {
          const where = `${sc.kind} ${sc.hero} ${hand}: ${b}`;
          expect(bare(b).length, where).toBeLessThanOrEqual(70);
          expect(sentencesOf(b).length, where).toBeLessThanOrEqual(2);
        }
        for (const para of techParagraphs(e)) {
          for (const sent of sentencesOf(para)) expect(sent.length, `${sc.kind} ${sc.hero} ${hand}: ${sent}`).toBeLessThanOrEqual(50);
        }
      }
    }
    expect(seen).toBeGreaterThan(1000);
  });

  it('결론은 액션 한 단어 + 이유이지, 이유에서 액션을 되풀이하지 않는다', () => {
    const bad: string[] = [];
    for (const sc of ALL_SPOTS) {
      for (const hand of ALL_HANDS) {
        const { easy } = explainStep(stepFor(sc, hand));
        const verdict = Object.keys(VERDICT_WORD).find((v) => easy.oneLiner.startsWith(v));
        expect(verdict, easy.oneLiner).toBeDefined();
        if (easy.reason.includes(VERDICT_WORD[verdict!])) bad.push(easy.oneLiner);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it('예시는 카드 예시이지 결론을 옮겨 적은 줄이 아니다', () => {
    const bad: string[] = [];
    for (const sc of ALL_SPOTS) {
      for (const hand of ALL_HANDS) {
        const { easy } = explainStep(stepFor(sc, hand));
        const reason = easy.reason.replace(/\.$/, '');
        for (const x of easy.example) if (x.includes(reason)) bad.push(`${easy.oneLiner} || ${x}`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it('손패가 이미 말한 문장을 자세한 이유가 되풀이하지 않는다', () => {
    const norm = (x: string) => bare(x).replace(/[\s.·]/g, '');
    const bad: string[] = [];
    for (const sc of ALL_SPOTS) {
      for (const hand of ALL_HANDS) {
        const e = explainStep(stepFor(sc, hand));
        const profile = sentencesOf(e.handProfile).map(norm);
        for (const b of techBullets(e)) {
          const key = norm(b);
          for (const ps of profile) {
            const [short, long] = key.length < ps.length ? [key, ps] : [ps, key];
            if (short.length >= 14 && long.includes(short.slice(0, 18))) bad.push(`${ps} || ${key}`);
          }
        }
      }
    }
    expect([...new Set(bad)].slice(0, 5)).toEqual([]);
  });

  it('조사와 주어가 맞는다 ("폴드도 반반" · "UTG는 …싸게 봅니다" 금지)', () => {
    for (const sc of ALL_SPOTS.slice(0, 20)) {
      for (const hand of ALL_HANDS) {
        const text = allStrings(explainStep(stepFor(sc, hand))).join('\n');
        expect(text, `${sc.kind} ${sc.hero} ${hand}`).not.toMatch(/도 반반입니다/);
        expect(text, `${sc.kind} ${sc.hero} ${hand}`).not.toMatch(/앞자리라 강하지만 싸게 봅니다/);
      }
    }
    const bb = explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'UTG' }, 'KQo'));
    expect(bb.easy.why).toContain('앞자리 오픈이라 강하지만 값이 쌉니다.');
  });

  it('UTG·HJ 폴드도 "오픈합니다"가 아니라 폴드 이유를 말한다', () => {
    let folds = 0;
    for (const [hero, hand] of [
      ['UTG', '72o'],
      ['UTG', 'K9o'],
      ['HJ', 'J8o'],
      ['HJ', '54o'],
    ] as Array<[Pos, string]>) {
      const step = stepFor({ kind: 'rfi', hero }, hand);
      expect(step.answer, `${hero} ${hand}`).toBe('fold');
      folds++;
      const why = explainStep(step).easy.why;
      expect(why.join(' '), `${hero} ${hand}`).not.toMatch(/좁게 오픈합니다/);
      expect(why, `${hero} ${hand}`).toContain(`뒤에 ${hero === 'UTG' ? 5 : 4}명이라 레인지가 좁고 이 패는 빠집니다.`);
    }
    expect(folds).toBe(4);
    // 오픈일 때는 그대로 오픈 이야기를 합니다
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'AA')).easy.why).toContain('뒤에 5명이 남아 좁게 오픈합니다.');
  });

  it('4벳 팟의 플랍 불릿 두 개가 서로 반대를 가리키지 않는다', () => {
    let seen = 0;
    for (const sc of ALL_SPOTS) {
      for (const hand of ALL_HANDS) {
        const e = explainStep(stepFor(sc, hand));
        const flop = e.easy.flop;
        if (!flop || !e.postflop || e.postflop.potType !== '4벳 팟') continue;
        seen++;
        const joined = flop.join(' | ');
        expect(joined, `${sc.kind} ${sc.hero} ${hand}`).not.toContain('보드와 상관없이');
        expect(joined, `${sc.kind} ${sc.hero} ${hand}`).not.toContain('팟 컨트롤');
      }
    }
    expect(seen).toBeGreaterThan(20);
  });
});

/* ------------------------------------------------------------------ */
/* 검수 지적사항 회귀 (work/review/findings-ko.md)                        */
/* ------------------------------------------------------------------ */

/** 그 노드에서 내가 지금 할 수 있는 "더 올리는" 액션. 결론은 이것 말고 다른 액션을 부르면 안 됩니다. */
const NODE_RAISE: Record<ScenarioKind, string> = {
  rfi: '오픈',
  vs_open: '3벳',
  vs_3bet: '4벳',
  vs_4bet: '올인',
  vs_5bet: '올인',
  cold_4bet: '4벳',
};

/**
 * 폴드가 아닌 해설에서만 써야 하는 "이 패는 강하다" 문장들 (handStrength).
 * WEAKNESS_FACTS의 반대쪽입니다 — 폴드 결론 밑 첫 왜? 불릿이 갈 이유를 대면 결론과 부딪힙니다.
 * (premium_pair·suited_broadway처럼 두 갈래가 일부러 같은 중립 서술을 쓰는 문장은 넣지 않습니다.)
 */
const STRENGTH_FACTS = [
  '대부분의 레인지보다 앞섭니다',
  '낮은 보드에서 오버페어가 됩니다',
  '셋이 되면 큰 팟을 이깁니다',
  'A·K 둘 다 톱 킥커가 됩니다',
  'A 탑페어를 자주 만듭니다',
  '넛 플러시를 노리는 수티드 A입니다',
  'A 블로커에 넛 플러시까지 됩니다',
  'A 한 장으로 약한 패를 이깁니다',
  '탑페어를 자주 만드는 브로드웨이입니다',
  'K 하이 플러시를 노립니다',
  '수티드라 플러시를 노립니다',
  '스트레이트와 플러시를 다 노립니다',
  '수티드라 플러시가 붙습니다',
  '이어진 두 장이라 스트레이트가 됩니다',
  '수티드라 플러시는 노려 볼 만합니다',
  '이 자리에서만 쓰는 아래쪽 패입니다',
];

/** 폴드 해설에서만 써야 하는 "이 패는 약하다" 문장들 (handFact). */
const WEAKNESS_FACTS = [
  '셋이 아니면 거의 못 이깁니다',
  'A·K가 깔리면 불안합니다',
  '오버페어가 되기 어렵습니다',
  'A가 강하지만 킥커가 약합니다',
  'A가 있지만 킥커가 약합니다',
  '브로드웨이지만 오프수트입니다',
  'K가 높고 킥커가 작습니다',
  '큰 카드 하나에 킥커가 작습니다',
  '갭이 있는 수티드입니다',
  '커넥터지만 오프수트입니다',
  '수티드지만 숫자가 너무 작습니다',
  '둘 다 작아 도움이 안 됩니다',
];

/** 조사·어미·빈칸을 지운 비교용 열쇠 — "셋이 될 확률이 12%입니다"와 "셋이 될 확률 12%"를 같은 사실로 봅니다. */
const factKey = (s: string) =>
  s
    .replace(/[\s.·,]/g, '')
    .replace(/(입니다|합니다|됩니다)\.?$/, '')
    .replace(/[이가은는을를]/g, '');

/** 전 차트 × 169 핸드를 한 번만 만들어 재사용합니다 (해설 하나를 열두 번 다시 만들 이유가 없습니다). */
interface Sweep {
  sc: Scenario;
  hand: string;
  step: Step;
  e: Explanation;
}
let sweepCache: Sweep[] | null = null;
function everyExplanation(): Sweep[] {
  if (!sweepCache) {
    const out: Sweep[] = [];
    for (const sc of ALL_SPOTS) {
      for (const hand of ALL_HANDS) {
        const step = stepFor(sc, hand);
        out.push({ sc, hand, step, e: explainStep(step) });
      }
    }
    sweepCache = out;
  }
  return sweepCache;
}

describe('검수 지적사항 회귀 (work/review/findings-ko.md)', () => {
  beforeAll(() => {
    expect(everyExplanation().length).toBeGreaterThan(1000);
  }, 60000);

  it('#1 결론은 그 노드에 없는 액션을 부르지 않는다 (4벳 받은 자리에 "3벳하면"은 없다)', () => {
    const bad: string[] = [];
    let seen = 0;
    for (const { sc, e } of everyExplanation()) {
      {
        const { easy } = e;
        seen++;
        for (const m of easy.oneLiner.matchAll(/(오픈|3벳|4벳|5벳|올인)하/g)) {
          if (m[1] !== NODE_RAISE[sc.kind]) bad.push(`${sc.kind}: ${easy.oneLiner}`);
        }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
    expect(seen).toBeGreaterThan(1000);
    // 같은 JJ 콜이라도 자리마다 부르는 액션이 다릅니다
    expect(explainStep(stepFor({ kind: 'vs_3bet', hero: 'BTN', villain: 'BB' }, 'JJ')).easy.oneLiner).toBe('콜하세요. 4벳하면 AA·KK만 남습니다.');
    expect(explainStep(stepFor({ kind: 'cold_4bet', hero: 'BB', extras: { opener: 'HJ', threeBettor: 'BTN' } }, 'JJ')).easy.oneLiner).toBe(
      '콜하세요. 4벳하면 AA·KK만 남습니다.',
    );
    const vs4 = explainStep(stepFor({ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'JJ'));
    expect(vs4.easy.oneLiner).toBe('콜하세요. 올인하면 더 강한 패만 남습니다.');
    // 바로 아래 왜? 불릿이 말하는 대안과 같은 액션이어야 합니다
    expect(vs4.easy.why.join(' ')).toContain('올인도 25% 섞습니다.');
  });

  it('#2 AA와 KK는 다른 문장을 받는다 (KK는 4벳 레인지 전부를 이기지 않고, KK끼리는 찹이다)', () => {
    let aa = 0;
    let kk = 0;
    for (const { sc, hand, e } of everyExplanation()) {
      if (hand !== 'AA' && hand !== 'KK') continue;
      {
        const text = [e.easy.oneLiner, ...e.easy.why, ...e.reasoning].join('\n');
        const where = `${sc.kind} ${sc.hero} ${hand}: ${e.easy.oneLiner}`;
        if (hand === 'AA') {
          aa++;
          continue;
        }
        kk++;
        // KK는 AA에 18%입니다 — "전부보다 앞선다"는 말은 어디에도 없어야 합니다.
        expect(text, where).not.toContain('레인지 전부보다 앞섭니다');
        expect(text, where).not.toContain('그 전부보다 앞섭니다');
        expect(text, where).not.toContain('그보다도 크게 앞서니');
        // 내가 KK인데 상대 KK를 "이긴다"고 말하지 않습니다.
        expect(text, where).not.toContain('상대가 KK·AK여도 대부분 이깁니다');
      }
    }
    expect(aa).toBeGreaterThan(20);
    expect(kk).toBeGreaterThan(20);
    const kkJam = explainStep(stepFor({ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'KK'));
    expect(kkJam.easy.oneLiner).toBe('올인하세요. AA만 아니면 다 앞섭니다.');
    expect(kkJam.reasoning).toContain('그중 AA에만 지고 나머지에는 앞섭니다.');
    const kkCall = explainStep(stepFor({ kind: 'vs_5bet', hero: 'SB', villain: 'BB' }, 'KK'));
    expect(kkCall.easy.oneLiner).toBe('올인을 콜하세요. AA만 아니면 다 앞서 승률이 충분합니다.');
    // 바로 밑 이유가 '올인 레인지는 AA·KK·AK'라 QQ를 근거로 삼으면 서로 어긋납니다
    expect(kkCall.easy.oneLiner).not.toContain('QQ');
    expect(kkCall.reasoning).toContain('AA에만 지고 KK와는 찹, 나머지에는 크게 앞섭니다.');
    // 상대 올인 레인지에 KK가 들어 있는데 "나머지에 크게 앞선다"로만 끝내지 않습니다
    expect(kkCall.reasoning.join(' ')).not.toContain('AA에만 지고 나머지에는');
    // AA는 그대로입니다
    expect(explainStep(stepFor({ kind: 'vs_4bet', hero: 'BTN', villain: 'CO' }, 'AA')).easy.oneLiner).toBe('올인하세요. 상대의 4벳 레인지 전부보다 앞섭니다.');
    expect(explainStep(stepFor({ kind: 'vs_5bet', hero: 'UTG', villain: 'BTN' }, 'AA')).easy.oneLiner).toBe('올인을 콜하세요. 상대가 KK·AK여도 대부분 이깁니다.');
    // 손패가 말하는 18%와 부딪히지 않습니다
    expect(kkJam.handProfile).toContain('AA에는 18%입니다');
  });

  it('#3 폴드가 아닌 결론 밑의 왜? 불릿은 약점이 아니라 그 액션의 근거다', () => {
    let nonFold = 0;
    let folds = 0;
    for (const { sc, hand, step, e } of everyExplanation()) {
      {
        const why = e.easy.why.join(' ');
        const where = `${sc.kind} ${sc.hero} ${hand}: ${why}`;
        if (step.answer === 'fold') {
          folds++;
          // 반대 방향도 같은 defect입니다: 폴드 결론 밑 첫 불릿이 강점이면 그대로 갈 이유가 됩니다.
          for (const g of STRENGTH_FACTS) expect(e.easy.why[0].includes(g), `${where} ← "${g}"`).toBe(false);
          continue;
        }
        nonFold++;
        for (const w of WEAKNESS_FACTS) expect(why.includes(w), `${where} ← "${w}"`).toBe(false);
      }
    }
    expect(nonFold).toBeGreaterThan(1000);
    expect(folds).toBeGreaterThan(1000);
    // 화면에서 확인된 자리
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'SB' }, '44')).easy.why).toEqual(['44는 셋이 되면 큰 팟을 이깁니다.', 'BB 한 명만 남아 넓게 오픈합니다.']);
    expect(explainStep(stepFor({ kind: 'vs_open', hero: 'CO', villain: 'UTG' }, 'QQ')).easy.why[0]).toBe('QQ는 대부분의 레인지보다 앞섭니다.');
    // 폴드에서는 약점 문장이 그대로 남습니다
    expect(explainStep(stepFor({ kind: 'vs_5bet', hero: 'BTN', villain: 'SB' }, 'JJ')).easy.why[0]).toBe('JJ는 큰 포켓페어라 A·K가 깔리면 불안합니다.');
    // 큰 킥커 A: 폴드 결론('킥커에서 밀립니다') 밑에 "A 탑페어를 자주 만듭니다"가 오면 안 됩니다
    const ajo = explainStep(stepFor({ kind: 'vs_open', hero: 'HJ', villain: 'UTG' }, 'AJo'));
    expect(ajo.easy.oneLiner).toBe('폴드하세요. A를 맞춰도 킥커에서 밀립니다.');
    expect(ajo.easy.why[0]).toBe('AJo는 상대 레인지가 좁을수록 가치가 떨어집니다.');
    // 폴드가 아닌 결론에서는 같은 클래스가 강점 문장을 그대로 씁니다
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, 'AJo')).easy.why[0]).toBe('AJo는 A 탑페어를 자주 만듭니다.');
  });

  it('#4 "승률이 없다"가 예시의 30%와 부딪히지 않는다', () => {
    let seen = 0;
    for (const { sc, hand, e } of everyExplanation()) {
      {
        expect(e.easy.oneLiner, `${sc.kind} ${sc.hero} ${hand}`).not.toContain('승률이 없습니다');
        if (e.easy.oneLiner.includes('4벳은 블러프였고')) {
          seen++;
          expect(e.easy.oneLiner).toContain('콜에 필요한 38%에 못 미칩니다');
          expect(e.easy.example.join(' ')).toMatch(/승률 30%입니다\./);
        }
      }
    }
    expect(seen).toBeGreaterThan(5);
  });

  it('#5 한 해설의 예시 줄들 사이에 같은 카드가 두 번 나오지 않는다', () => {
    let seen = 0;
    for (const { sc, hand, e } of everyExplanation()) {
      {
        seen++;
        // 내 두 장은 모든 줄에서 같은 두 장입니다(한 판이니까). 그 밖의 카드는 해설 하나에 한 번만 나옵니다.
        const mineCards = new Set([`${hand[0] === 'T' ? '10' : hand[0]}♠`, `${hand[1] === 'T' ? '10' : hand[1]}${hand[2] === 's' ? '♠' : '♦'}`]);
        const others: string[] = [];
        for (const line of e.easy.example) {
          for (const c of new Set(line.match(/(?:10|[2-9TJQKA])[♠♦]/g) ?? [])) if (!mineCards.has(c)) others.push(c);
        }
        const where = `${sc.kind} ${sc.hero} ${hand}: ${e.easy.example.join(' | ')}`;
        expect(new Set(others).size, where).toBe(others.length);
        // 무늬가 다 쓰인 카드는 이름으로 물러설 뿐, 무늬 없는 카드가 카드 옆에 붙지 않습니다
        for (const line of e.easy.example) expect(/[♠♦](?:10|[2-9TJQKA])(?![♠♦])/.test(line), where).toBe(false);
      }
    }
    expect(seen).toBeGreaterThan(1000);
    // 검수에서 나온 자리: 상대 A♦K♠ 뒤의 보드는 A♦를 다시 깔지 않습니다
    const qq = explainStep(stepFor({ kind: 'vs_open', hero: 'CO', villain: 'UTG' }, 'QQ')).easy.example;
    expect(qq.join(' ')).toContain('A♦K♠');
    expect(qq.join(' ').match(/A♦/g)!.length).toBe(1);
  });

  it('#6 3벳 팟 플랍 불릿 두 개가 서로 반대를 가리키지 않는다', () => {
    let seen = 0;
    for (const { sc, hand, e } of everyExplanation()) {
      {
        if (!e.easy.flop || !e.postflop || e.postflop.potType !== '3벳 팟') continue;
        seen++;
        const joined = e.easy.flop.join(' | ');
        const where = `${sc.kind} ${sc.hero} ${hand}: ${joined}`;
        expect(joined, where).not.toContain('무방');
        // "드라이 보드는 팟의 30%로 c-bet"과 "체크로 시작해도 된다"가 같은 목록에 함께 있지 않습니다
        if (/드라이 보드는 팟의 30%/.test(joined)) expect(joined, where).not.toMatch(/큰 팟이니 체크로 시작/);
      }
    }
    expect(seen).toBeGreaterThan(100);
    const a8s = explainStep(stepFor({ kind: 'vs_open', hero: 'SB', villain: 'CO' }, 'A8s')).easy.flop!;
    expect(a8s).toContain('낮고 이어진 보드에서는 체크로 시작');
    const kqo = explainStep(stepFor({ kind: 'vs_3bet', hero: 'SB', villain: 'BB' }, 'KQo')).easy.flop!;
    expect(kqo).toContain('먼저 액션하니 체크-콜부터 준비');
  });

  it('#7 BB의 "가장 넓게 콜"과 "강한 패 위주로만 콜"이 한 목록에 같이 있지 않다', () => {
    let seen = 0;
    for (const { sc, hand, step, e } of everyExplanation()) {
      if (sc.kind !== 'vs_open' || sc.hero !== 'BB') continue;
      {
        if (step.answer !== 'call') continue;
        seen++;
        const reasons = e.reasoning.join(' | ');
        const where = `${sc.hero} vs ${sc.villain} ${hand}: ${reasons}`;
        if (/가장 넓게 (콜|방어)/.test(reasons)) expect(reasons, where).not.toContain('강한 패 위주로만 콜합니다');
      }
    }
    expect(seen).toBeGreaterThan(50);
    const bb = explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, '86s')).reasoning;
    expect(bb).toContain('마지막 차례라 스퀴즈 걱정 없이 가장 넓게 콜합니다. 스퀴즈는 오픈과 콜 뒤에 크게 올리는 것입니다.');
    expect(bb.join(' ')).not.toContain('포지션 없이 콜하니');
    // 포지션 없는 3벳 팟 콜러에게는 그대로 남습니다
    expect(explainStep(stepFor({ kind: 'vs_3bet', hero: 'SB', villain: 'BB' }, 'KQo')).reasoning.join(' ')).toContain('강한 패 위주로만 콜합니다');
  });

  it('#8 용어 풀이는 문장 가운데가 아니라 그 문장 뒤에 한 문장으로 붙는다', () => {
    let seen = 0;
    for (const { sc, hand, e } of everyExplanation()) {
      {
        seen++;
        for (const s of generatedTech(e)) {
          for (const t of TIER_B) {
            if (!s.includes(t)) continue;
            const where = `${sc.kind} ${sc.hero} ${hand}: ${s}`;
            // 괄호를 문장 가운데 끼워 넣지 않습니다
            expect(s.includes(`${t}(`), where).toBe(false);
            const sentence = glossSentence(t);
            if (!sentence || !s.includes(sentence)) continue;
            // 풀이는 앞 문장을 끝내고 시작하는 독립된 한 문장입니다
            expect(s.startsWith(sentence) || s.includes(`. ${sentence}`), where).toBe(true);
            expect(sentence.length, sentence).toBeLessThanOrEqual(45);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(1000);
    const a5s = explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, 'A5s'));
    expect(a5s.handProfile).toContain('A 블로커까지 있어 3벳·4벳 블러프 재료로 가장 좋습니다. 블로커는 내가 그 카드를 들어 상대 조합이 줄어드는 효과입니다.');
    const cbet = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'AKs')).postflop!.plan.join(' | ');
    expect(cbet).toContain('작게 넓게 c-bet합니다. c-bet은 프리플랍 레이저가 플랍에서 잇는 벳입니다.');
    // 소수점(SPR 1~1.5)을 문장 끝으로 잘못 읽지 않습니다
    const spr = explainStep(stepFor({ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'AQs')).postflop!.spr;
    expect(spr).toContain('SPR이 1~1.5로 얕습니다.');
  });

  it('#9 프리플랍 레이즈를 "세미 블러프"라고 부르지 않는다 (드로우가 없으니까)', () => {
    let seen = 0;
    for (const { sc, hand, e } of everyExplanation()) {
      {
        seen++;
        const where = `${sc.kind} ${sc.hero} ${hand}`;
        // 프리플랍 이야기(자세한 이유)에는 세미 블러프가 없고, 플랍 계획에만 있습니다
        for (const r of e.reasoning) expect(r.includes('세미 블러프'), `${where}: ${r}`).toBe(false);
      }
    }
    expect(seen).toBeGreaterThan(1000);
    const a8s = explainStep(stepFor({ kind: 'vs_open', hero: 'SB', villain: 'CO' }, 'A8s'));
    expect(a8s.reasoning).toContain('A 블로커로 상대의 최상위 레인지를 줄이는 블러프 레이즈입니다.');
    expect(a8s.postflop!.plan.join(' ')).toContain('세미 블러프는 드로우를 들고 하는 블러프입니다.');
  });

  it('#10 cold_4bet 콜 이유의 셋 이야기는 포켓페어에게만 간다', () => {
    let pairs = 0;
    let others = 0;
    for (const { sc, hand, step, e } of everyExplanation()) {
      if (sc.kind !== 'cold_4bet') continue;
      {
        if (step.answer !== 'call') continue;
        const reasons = e.reasoning.join(' | ');
        const where = `${sc.hero} ${hand}: ${reasons}`;
        if (parseHandName(hand).kind === 'pair') {
          pairs++;
          expect(reasons, where).toContain('셋 같은 강한 패를 노리고 3벳 팟을 봅니다.');
        } else {
          others++;
          expect(reasons, where).not.toContain('셋 같은 강한 패를 노리고');
          expect(reasons, where).toContain('포지션과 팟 오즈를 보고 플랍을 봅니다.');
          expect(e.postflop!.plan.join(' '), where).not.toContain('셋을 노릴 값이');
        }
      }
    }
    expect(pairs).toBeGreaterThan(0);
    expect(others).toBeGreaterThan(0);
  });

  it('#11 오픈은 "패를 열다"가 아니라 "오픈하다"', () => {
    for (const { sc, hand, e } of everyExplanation()) {
      for (const s of [...easyStrings(e), ...generatedTech(e)]) expect(s, `${sc.kind} ${sc.hero} ${hand}`).not.toMatch(/패도 열지만|패를 엽니다|열지만/);
    }
    expect(explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'SB' }, 'T5o')).easy.why).toContain('SB는 약한 패도 오픈하지만 이건 더 약합니다.');
  });

  it('#12 왜? 불릿에는 괄호가 없고, 결론과 예시가 같은 사실을 두 번 말하지 않는다', () => {
    const parens: string[] = [];
    const repeats: string[] = [];
    let seen = 0;
    for (const { sc, hand, e } of everyExplanation()) {
      {
        const { easy } = e;
        seen++;
        for (const w of easy.why) if (/[()]/.test(w)) parens.push(`${sc.kind} ${sc.hero} ${hand}: ${w}`);
        const key = factKey(easy.reason);
        if (key.length >= 8) for (const x of easy.example) if (factKey(x).includes(key)) repeats.push(`${easy.oneLiner} || ${x}`);
      }
    }
    expect(parens).toEqual([]);
    expect([...new Set(repeats)]).toEqual([]);
    expect(seen).toBeGreaterThan(1000);
    // 혼합 빈도는 자세히 블록과 같은 꼴로 적습니다
    expect(explainStep(stepFor({ kind: 'vs_3bet', hero: 'BTN', villain: 'BB' }, 'JJ')).easy.why).toContain('4벳도 25% 섞습니다.');
    // 작은 페어 오픈: 결론이 12%를 말했으니 예시는 그 대신 보상을 보여 줍니다
    const p44 = explainStep(stepFor({ kind: 'rfi', hero: 'SB' }, '44'));
    expect(p44.easy.oneLiner).toContain('셋이 될 확률이 12%입니다');
    expect(p44.easy.example).toEqual(['내 4♠4♦ vs 상대 A♦K♠ → 거의 반반입니다.', '셋이 되면 상대 스택을 다 받습니다.']);
  });

  it('#13 문체가 한 가지다 (무방·번역투 없음, 예시 줄 꼴이 일정함)', () => {
    let arrows = 0;
    for (const { sc, hand, e } of everyExplanation()) {
      {
        const where = `${sc.kind} ${sc.hero} ${hand}`;
        for (const s of [...easyStrings(e), ...generatedTech(e)]) {
          expect(s, where).not.toContain('무방');
          expect(s, where).not.toContain('킥커보다 얕은 스택');
        }
        // 화살표가 있는 예시 줄은 "내 …" 아니면 "플랍 …"으로 시작합니다 (가이드 §3)
        for (const x of e.easy.example) {
          if (!x.includes('→')) continue;
          arrows++;
          expect(x.startsWith('내 ') || x.startsWith('플랍 '), `${where}: ${x}`).toBe(true);
        }
      }
    }
    expect(arrows).toBeGreaterThan(1000);
    expect(explainStep(stepFor({ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'A4s')).easy.flop ?? []).not.toContain('A가 깔리면 킥커보다 얕은 스택이 먼저');
    expect(explainStep(stepFor({ kind: 'vs_4bet', hero: 'SB', villain: 'UTG' }, '77')).easy.example.join(' ')).toMatch(/내 7♠7♦ vs 상대 [JQ][♠♦][JQ][♠♦] → 승률 20%입니다\./);
  });

  it('#14 체크리스트는 혼자 읽히는 불릿만 담는다', () => {
    let seen = 0;
    for (const { sc, hand, e } of everyExplanation()) {
      {
        if (!e.postflop) continue;
        seen++;
        const where = `${sc.kind} ${sc.hero} ${hand}`;
        expect(e.postflop.checklist.length, where).toBeLessThanOrEqual(8);
        expect(e.postflop.checklist.length, where).toBeGreaterThanOrEqual(5);
        for (const c of e.postflop.checklist) {
          // "주제 — 답" 한 줄. 앞 불릿에 기대는 뒷줄("그쪽이 더 크게 벳할 수 있습니다.")은 없습니다.
          expect(c, `${where}: ${c}`).toMatch(/^[^—]+ — .+다\.$/);
          expect(c.length, `${where}: ${c}`).toBeLessThanOrEqual(70);
        }
      }
    }
    expect(seen).toBeGreaterThan(500);
    const list = explainStep(stepFor({ kind: 'rfi', hero: 'BTN' }, 'A5s')).postflop!.checklist;
    expect(list).toContain('보드 주도권 — A·K 하이와 브로드웨이 보드는 레이즈한 쪽 것입니다.');
    expect(list).toContain('포지션 — 나는 나중에 액션하니 상대 체크를 보고 정합니다.');
    expect(list.join(' ')).not.toContain('누구 레인지에 맞나요');
  });

  it('재검수 왜? 불릿과 자세한 이유가 같은 문장을 두 번 말하지 않는다', () => {
    const dupes: string[] = [];
    for (const { sc, hand, e } of everyExplanation()) {
      for (const w of e.easy.why) {
        const k = factKey(w);
        if (k.length < 6) continue;
        for (const r of e.reasoning) if (factKey(r) === k) dupes.push(`${sc.kind} ${sc.hero} ${hand}: ${w} || ${r}`);
      }
    }
    expect([...new Set(dupes.map((d) => d.split(': ')[1]))]).toEqual([]);
    // 혼합 빈도는 왜? 불릿과 자세히 · 혼합 빈도가 말합니다 — 자세한 이유에서는 빠집니다
    const jj = explainStep(stepFor({ kind: 'vs_open', hero: 'HJ', villain: 'UTG' }, 'JJ'));
    expect(jj.easy.why).toContain('콜도 25% 섞습니다.');
    expect(jj.reasoning).not.toContain('콜도 25% 섞습니다.');
    expect(jj.mixNote).toContain('25%');
  });

  it('재검수 결론의 이유 절이 자세한 이유에 그대로 다시 나오지 않는다', () => {
    const repeats: string[] = [];
    for (const { sc, hand, e } of everyExplanation()) {
      const k = factKey(e.easy.reason);
      if (k.length < 8) continue;
      for (const r of e.reasoning) if (factKey(r) === k) repeats.push(`${sc.kind} ${sc.hero} ${hand}: ${e.easy.oneLiner} || ${r}`);
    }
    expect([...new Set(repeats.map((d) => d.split(': ')[1]))]).toEqual([]);
    const kts = explainStep(stepFor({ kind: 'vs_open', hero: 'SB', villain: 'UTG' }, 'KTs'));
    expect(kts.easy.oneLiner).toBe('폴드하세요. 상대 레인지가 강해 킥커에서 밀립니다.');
    expect(kts.reasoning[0]).toBe('같은 브로드웨이라도 상대 레인지에는 더 좋은 킥커가 많습니다.');
  });

  it('재검수 4벳 팟 플랍 불릿은 얕은 스택을 한 번만 말한다', () => {
    let seen = 0;
    for (const { sc, hand, e } of everyExplanation()) {
      const flop = e.easy.flop ?? [];
      if (!flop.length) continue;
      seen++;
      const shallow = flop.filter((f) => f.includes('얕'));
      expect(shallow.length, `${sc.kind} ${sc.hero} ${hand}: ${flop.join(' | ')}`).toBeLessThanOrEqual(1);
    }
    expect(seen).toBeGreaterThan(500);
    expect(explainStep(stepFor({ kind: 'vs_3bet', hero: 'UTG', villain: 'HJ' }, 'A5s')).easy.flop).toEqual([
      '♠ 2장이면 넛 플러시 드로우, 벳이나 레이즈',
      'A가 깔리면 킥커가 약해도 그대로 올인',
      '못 맞춰도 한 번은 작게 c-bet',
      '스택이 얕아 탑페어만 맞아도 올인까지',
    ]);
  });

  it('재검수 cold_4bet 콜 계획에 주어 없는 "값이 사라지니"가 없다', () => {
    let others = 0;
    for (const { sc, hand, step, e } of everyExplanation()) {
      if (sc.kind !== 'cold_4bet' || step.answer !== 'call' || !e.postflop) continue;
      const plan = e.postflop.plan.join(' | ');
      expect(plan, `${sc.hero} ${hand}`).not.toContain('4벳하면 값이 사라지니');
      if (parseHandName(hand).kind !== 'pair') {
        others++;
        expect(plan, `${sc.hero} ${hand}`).toContain('그 사람이 4벳하면 팟 오즈가 사라지니 폴드합니다.');
      }
    }
    expect(others).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/* Glossary                                                             */
/* ------------------------------------------------------------------ */

describe('glossary', () => {
  it('괄호 풀이가 붙은 자리에는 밑줄을 긋지 않는다 (설명은 한 번만 · 가이드 §2.4)', () => {
    // applyGlosses가 붙인 "백도어(두 장을 더 맞아야 완성되는 드로우)"는 그 자리에서 이미 설명을 합니다.
    const glossed = splitTerms('백도어(두 장을 더 맞아야 완성되는 드로우)가 두 개 겹치면 따라갑니다.');
    const back = glossed.find((p) => p.text === '백도어')!;
    expect(back.entry).toBeDefined();
    expect(back.glossed, '괄호 풀이가 붙은 등장').toBe(true);
    expect(back.defines).toBe(true);
    // 괄호 안의 용어(여기서는 "드로우"가 아니라 도미네이트 풀이 속 "킥커")도 밑줄 대상이 아닙니다
    const inner = splitTerms('AK·AQ에 도미네이트(같은 카드를 맞춰도 킥커에서 지는 상태)됩니다.').find((p) => p.text === '킥커')!;
    expect(inner.glossed, '괄호 안의 용어').toBe(true);
    // 풀이가 없는 보통 등장은 그대로 밑줄(팝오버) 대상입니다
    const plain = splitTerms('넛 플러시 드로우면 세미 블러프로 갑니다.').find((p) => p.text === '세미 블러프')!;
    expect(plain.entry).toBeDefined();
    expect(plain.glossed).toBeFalsy();
  });

  it('c-bet은 하이픈에서 줄바꿈되지 않는다 (밑줄이 없는 등장도 감싸서 nowrap)', () => {
    const pieces = splitTerms('작게 넓게 c-bet(프리플랍 레이저가 플랍에서 잇는 벳)합니다.');
    const cbet = pieces.find((p) => p.text === 'c-bet')!;
    expect(cbet.entry?.term).toBe('c-bet');
    // glossed 조각도 entry를 들고 오므로 PlainText가 <span class="term-plain">으로 감쌉니다
    expect(cbet.glossed).toBe(true);
    expect(explainCss).toMatch(/\.term-plain\s*\{[^}]*white-space:\s*nowrap/);
  });

  it('holds every tier-B concept and the tier-A terms worth explaining', () => {
    for (const t of TIER_B) expect(glossaryLookup(t), t).toBeDefined();
    for (const t of ['수티드', '오프수트', '커넥터', '브로드웨이', '킥커', '셋', '오버페어', '탑페어', '레인지', '포지션', '블라인드']) {
      expect(glossaryLookup(t), t).toBeDefined();
    }
    // seat labels stay plain: SB/BB name a chair all over the app, not the money
    expect(glossaryLookup('SB')).toBeUndefined();
    expect(glossaryLookup('BB')).toBeUndefined();
  });

  it('leaves ultra-common words alone — too much underlining is its own readability problem', () => {
    for (const t of ['폴드', '콜', '벳', '팟', '보드', '플랍', '페어', '레이즈', '체크', '오픈', '3벳', '4벳', '올인', '블러프', '밸류']) {
      expect(glossaryLookup(t), t).toBeUndefined();
    }
    expect(GLOSSARY.length).toBeLessThanOrEqual(32);
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(20);
  });

  it('definitions are short and in the new register', () => {
    for (const e of GLOSSARY) {
      expect(e.def.length, `${e.term}: ${e.def}`).toBeLessThanOrEqual(45);
      expect(e.def, e.term).not.toMatch(/거든요|해요|예요/);
      for (const b of BANNED) expect(e.def.includes(b), `${e.term}: ${b}`).toBe(false);
    }
  });

  it('longest spellings match first so 셋마이닝 never splits into 셋', () => {
    expect(GLOSSARY_WORDS[0].length).toBeGreaterThanOrEqual(GLOSSARY_WORDS[GLOSSARY_WORDS.length - 1].length);
    expect(GLOSSARY_WORDS.indexOf('셋마이닝')).toBeLessThan(GLOSSARY_WORDS.indexOf('셋'));
    expect(GLOSSARY_WORDS.indexOf('임플라이드 오즈')).toBeLessThan(GLOSSARY_WORDS.indexOf('팟 오즈'));
  });

  it('resolves aliases case-insensitively', () => {
    expect(glossaryLookup('세미블러프')?.term).toBe('세미 블러프');
    expect(glossaryLookup('C-BET')?.term).toBe('c-bet');
    expect(glossaryLookup('없는 말')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */

describe('trainer sequences', () => {
  it('builds an RFI step and never crashes over many deals', () => {
    seedRandom(7);
    for (let i = 0; i < 200; i++) {
      const seq = nextHandSequence(DEFAULT_SESSION_OPTIONS);
      expect(seq.steps.length).toBeGreaterThan(0);
      for (const s of seq.steps) {
        const e = explainStep(s);
        expect(e.easy.oneLiner.length).toBeLessThanOrEqual(60);
        expect(bannedWords(e)).toEqual([]);
        expect(tierAGlosses(e)).toEqual([]);
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


/* ------------------------------------------------------------------ */
/* 예시 카드의 무늬가 화면에 깔린 카드와 같은가                           */
/* ------------------------------------------------------------------ */

describe('suit orientation', () => {
  it('reads the orientation off the dealt cards', () => {
    expect(suitOrientation([{ rank: 'T', suit: 'd' }, { rank: '9', suit: 'd' }])).toBe('diamond');
    expect(suitOrientation([{ rank: 'T', suit: 's' }, { rank: '9', suit: 's' }])).toBe('spade');
    expect(suitOrientation([{ rank: 'K', suit: 'd' }, { rank: 'Q', suit: 's' }])).toBe('diamond');
    expect(suitOrientation([{ rank: 'K', suit: 's' }, { rank: 'Q', suit: 'd' }])).toBe('spade');
    // dealCardsFor 는 언제나 높은 카드를 앞에 둡니다 — 첫 장만 보면 방향이 정해집니다.
    for (const hand of ['A5s', 'KQo', '77', 'T9s', '72o']) {
      for (let i = 0; i < 40; i++) {
        const cards = dealCardsFor(hand);
        expect(suitOrientation(cards)).toBe(cards[0].suit === 'd' ? 'diamond' : 'spade');
      }
    }
  });

  it('내 패의 무늬가 화면 카드와 어긋나지 않는다 (T9s를 10♦9♦로 받으면 예시도 10♦9♦)', () => {
    const t9 = explainStep(stepFor({ kind: 'rfi', hero: 'HJ' }, 'T9s'), 'diamond');
    const joined = t9.easy.example.join(' ');
    expect(joined).toContain('10♦9♦');
    expect(joined).not.toContain('10♠9♠');
    // 수티드 이야기는 들고 있는 무늬로 해야 합니다.
    const all = allStrings(t9).join('\n');
    expect(all).not.toMatch(/♠가 2장/);
    if (/[♠♦]가 2장/.test(all)) expect(all).toMatch(/♦가 2장/);

    const kq = explainStep(stepFor({ kind: 'rfi', hero: 'SB' }, 'KQo'), 'diamond').easy.example.join(' ');
    expect(kq).toContain('K♦Q♠');
    const p55 = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, '55'), 'diamond').easy.example.join(' ');
    expect(p55).toContain('5♦5♠');
  });

  it('뒤집기는 ♠↔♦ 맞바꾸기 하나뿐이다 — 그 밖의 글자는 한 자도 바뀌지 않는다', () => {
    const swap = (t: string) => t.replace(/[♠♦]/g, (c) => (c === '♠' ? '♦' : '♠'));
    for (const step of allSteps) {
      const a = allStrings(explainStep(step, 'spade'));
      const b = allStrings(explainStep(step, 'diamond'));
      expect(b.length, step.hand).toBe(a.length);
      for (let i = 0; i < a.length; i++) expect(b[i], `${step.scenario.kind}/${step.hand}`).toBe(swap(a[i]));
    }
  });

  it('뒤집은 해설에도 같은 카드가 두 번 나오지 않고, 오프수트 상대 패는 오프수트로 읽힌다', () => {
    for (const step of allSteps) {
      const exp = explainStep(step, 'diamond');
      for (const line of exp.easy.example) {
        const seen = new Set<string>();
        for (const m of line.matchAll(/((?:10|[2-9TJQKA]))([♠♦])/g)) {
          const card = `${m[1]}${m[2]}`;
          expect(seen.has(card), `${step.hand}: ${line}`).toBe(false);
          seen.add(card);
        }
        for (const m of line.matchAll(/((?:10|[2-9TJQKA]))([♠♦])((?:10|[2-9TJQKA]))([♠♦])/g)) {
          if (m[1] === m[3]) expect(m[2] === m[4], line).toBe(false);
        }
      }
    }
  });
});
