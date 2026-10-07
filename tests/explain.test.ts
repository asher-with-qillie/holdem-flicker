import { describe, expect, it } from 'vitest';
import { hasChart } from '../src/poker/data';
import { classifyHand, dominatedBy, dominatorOf, explainStep, glossSentence, heroIsIP, suitOrientation, type Explanation } from '../src/poker/explain';
import { parseHandName, ALL_HANDS, dealCardsFor } from '../src/poker/hands';
import { GLOSSARY, glossaryLookup, GLOSSARY_WORDS } from '../src/poker/glossary';
import { emWidth } from '../src/poker/ko';
import { fullMix } from '../src/poker/range';
import { mixBlock, oneExample } from '../src/poker/sheet';
import { allScenarios } from '../src/poker/scenarios';
import { splitTerms } from '../src/components/Term';
import { readFileSync } from 'node:fs';
import { stepFor, buildSteps, DEFAULT_SESSION_OPTIONS, nextHandSequence, randomQuizStep, type Step } from '../src/poker/trainer';
import type { Pos, Scenario, ScenarioKind } from '../src/poker/types';
import { seedRandom } from '../src/poker/hands';

/*
 * 해설 조립(explainStep)과 용어 정책 — docs/EXPLAIN_SPEC.md §7.1 이 남기거나 다시 쓰라고 한 것들.
 * 줄 문장 · 시트 문장의 불변식은 tests/line.test.ts · tests/sheet.test.ts, 조사 전수표는 tests/ko.test.ts 에 있습니다.
 */

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
/* docs/PLAIN_KO_STYLE.md — 용어 정책                                    */
/* ------------------------------------------------------------------ */

/** C단계: 어디에도 나오면 안 되는 말 (표준 용어를 억지로 푼 표현 + 옛 정책의 잔재). */
const BANNED = ['뻥', '옆 카드', '같은 숫자 3장', '미리 낸 돈', '제일 높은 한 쌍', '폴드 에퀴티', '에퀴티', '리니어', '폴라', '양극화', '실현', '콤보', '10번 중'];

/** A단계: 그대로 쓰는 표준 용어. 뒤에 "(…)" 풀이가 붙으면 안 됩니다. */
const TIER_A = [
  '폴드', '콜', '레이즈', '오픈', '3벳', '4벳', '5벳', '올인', '블러프', '밸류', '킥커', '셋', '탑페어', '오버페어',
  '포켓페어', '플러시', '스트레이트', '드로우', '보드', '플랍', '포지션', '블라인드', '팟', '레인지', '수티드',
  '오프수트', '커넥터', '브로드웨이',
];

/** B단계: 풀이가 필요한 개념. 풀이는 용어집 팝오버와 사람이 쓴 차트 메모의 괄호에서만 합니다. */
const TIER_B = ['블로커', '도미네이트', '셋마이닝', '팟 오즈', '임플라이드 오즈', '스퀴즈', 'c-bet', 'SPR', '세미 블러프', '백도어'];

const explainCss = readFileSync(new URL('../src/styles/explain.css', import.meta.url), 'utf8');

/** explain.ts · line.ts · sheet.ts 가 만드는 학습자용 문자열(차트 메모는 src/poker/data 소유라 빠집니다). */
const generated = (e: Explanation): string[] =>
  [e.title, e.capsule.label, e.line.sentence?.text, e.sibling?.text, e.mix?.partial, e.seat.numbers, e.seat.lever, e.across.line.text, e.more.example, e.disclaimer].filter((x): x is string => !!x);
/** 시트가 실제로 렌더하는 전부 — 차트 메모도 같은 시트의 '자세히'에 찍히므로 용어 정책이 같이 적용됩니다. */
const allStrings = (e: Explanation) => [...generated(e), e.more.memo ?? ''];

function bannedWords(e: Explanation): string[] {
  const text = allStrings(e).join('\n');
  return BANNED.filter((b) => text.includes(b));
}

/** A단계 용어 뒤의 "(" — 생성 문자열에서는 어떤 괄호 풀이도 없어야 합니다. */
function tierAGlosses(e: Explanation): string[] {
  const out: string[] = [];
  for (const s of generated(e)) for (const t of TIER_A) if (s.includes(`${t}(`)) out.push(`${t}( @ ${s}`);
  return out;
}

/** 풀이 두 꼴: 괄호("블로커(…)")와 glossSentence 한 문장("블로커는 … 효과예요."). */
function glossHits(text: string, t: string): number {
  const sentence = glossSentence(t);
  const paren = text.split(`${t}(`).length - 1;
  return paren + (sentence ? text.split(sentence).length - 1 : 0);
}

const CASES: Array<[Scenario, string]> = [
  [{ kind: 'rfi', hero: 'UTG' }, '72o'],
  [{ kind: 'rfi', hero: 'UTG' }, 'AA'],
  [{ kind: 'rfi', hero: 'UTG' }, '55'],
  [{ kind: 'rfi', hero: 'UTG' }, 'ATo'],
  [{ kind: 'rfi', hero: 'HJ' }, 'J8s'],
  [{ kind: 'rfi', hero: 'BTN' }, 'A5s'],
  [{ kind: 'rfi', hero: 'SB' }, 'KQo'],
  [{ kind: 'vs_open', hero: 'BB', villain: 'UTG' }, 'KQo'],
  [{ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, '76s'],
  [{ kind: 'vs_open', hero: 'BB', villain: 'CO' }, '22'],
  [{ kind: 'vs_open', hero: 'SB', villain: 'BTN' }, 'AJo'],
  [{ kind: 'vs_open', hero: 'BTN', villain: 'HJ' }, '88'],
  [{ kind: 'vs_open', hero: 'HJ', villain: 'UTG' }, 'A9o'],
  [{ kind: 'vs_3bet', hero: 'UTG', villain: 'BTN' }, 'AKs'],
  [{ kind: 'vs_3bet', hero: 'CO', villain: 'BTN' }, 'A5s'],
  [{ kind: 'vs_3bet', hero: 'BTN', villain: 'BB' }, 'T9s'],
  [{ kind: 'vs_4bet', hero: 'BTN', villain: 'CO' }, 'AA'],
  [{ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'QQ'],
  [{ kind: 'vs_4bet', hero: 'BB', villain: 'BTN' }, 'A4s'],
  [{ kind: 'vs_5bet', hero: 'UTG', villain: 'BTN' }, 'AKo'],
  [{ kind: 'vs_5bet', hero: 'CO', villain: 'BB' }, 'QQ'],
  [{ kind: 'cold_4bet', hero: 'BTN', extras: { opener: 'UTG', threeBettor: 'CO' } }, 'KK'],
  [{ kind: 'cold_4bet', hero: 'CO', extras: { opener: 'UTG', threeBettor: 'HJ' } }, 'A5s'],
  [{ kind: 'vs_limp', hero: 'BB', extras: { limper: 'HJ' } }, '55'],
  [{ kind: 'vs_limp', hero: 'BTN', extras: { limper: 'CO' } }, 'ATo'],
];
const allSteps: Step[] = CASES.map(([sc, hand]) => stepFor(sc, hand));

/** 차트가 있는 모든 상황(cold·limp 는 extras 포함) — 전수 검사용. */
const ALL_SPOTS: Scenario[] = allScenarios()
  .filter(hasChart)
  .map((s) => (s.kind === 'cold_4bet' ? { ...s, extras: { opener: 'UTG', threeBettor: 'HJ' } } : s.kind === 'vs_limp' ? { ...s, extras: { limper: 'UTG' } } : s));

/** 예시 한 줄의 세 모양(§4.2-⑦). */
const EXAMPLE_SHAPES = [
  /^내 (?:10|[2-9TJQKA])[♠♦](?:10|[2-9TJQKA])[♠♦] → 플랍에서 셋이 될 확률 12%예요\.$/,
  /^내 (?:10|[2-9TJQKA])[♠♦](?:10|[2-9TJQKA])[♠♦] vs 상대 (?:\S+) → (?:10|[AKQJ])[을를] 맞춰도 킥커에서 밀려요\.$/,
  /^내 A[♠♦][2-5][♠♦] → A를 쥐고 있어 상대 AA·AK 조합이 줄어요\.$/,
];

describe('explanations', () => {
  it('mixBlock: 칩 %는 fullMix 와 같고, 부분 정답 문장은 2순위 ≥ 0.4 일 때만', () => {
    for (const step of allSteps) {
      const m = mixBlock(step);
      const mix = fullMix(step.mix);
      if (mix[0].weight >= 0.999) {
        expect(m, step.hand).toBeNull();
        continue;
      }
      expect(m!.chips, step.hand).toEqual(mix.map((x) => ({ action: x.action, pct: Math.round(x.weight * 100) })));
      expect(!!m!.partial, step.hand).toBe(mix[1].weight >= 0.4);
    }
    const ato = mixBlock(stepFor({ kind: 'rfi', hero: 'UTG' }, 'ATo'))!;
    expect(ato.chips).toEqual([
      { action: 'raise', pct: 50 },
      { action: 'fold', pct: 50 },
    ]);
    expect(ato.partial).toBe('반반이라 더 공격적인 오픈을 정답으로 쳐요. 폴드도 부분 정답이에요.');
    expect(mixBlock(stepFor({ kind: 'vs_4bet', hero: 'HJ', villain: 'UTG' }, 'QQ'))!.partial).toBeNull();
  });

  it('percentages are written as numbers, never "10번 중 N번"', () => {
    for (const step of allSteps) {
      const e = explainStep(step);
      expect(generated(e).join('\n'), step.hand).not.toMatch(/10번 중|\d+\.\d+%/);
    }
  });
});

describe('line sentence in every kind', () => {
  it('7가지 상황 모두에 줄 문장이 있다', () => {
    const kinds = new Set<ScenarioKind>();
    for (const s of ALL_SPOTS) {
      for (const hand of ALL_HANDS) {
        const e = explainStep(stepFor(s, hand));
        if (e.line.sentence) kinds.add(s.kind);
      }
    }
    expect([...kinds].sort()).toEqual(['cold_4bet', 'rfi', 'vs_3bet', 'vs_4bet', 'vs_5bet', 'vs_limp', 'vs_open']);
    const answers = new Set(allSteps.map((s) => s.answer));
    for (const a of ['fold', 'call', 'raise', 'threebet', 'fourbet', 'allin', 'check'] as const) expect(answers.has(a), a).toBe(true);
  });

  it('the terminology policy holds for every hand in every charted spot', () => {
    let seen = 0;
    for (const sc of ALL_SPOTS) {
      for (const hand of ALL_HANDS) {
        const e = explainStep(stepFor(sc, hand));
        const where = `${sc.kind} ${sc.hero} ${hand}`;
        seen++;
        expect(bannedWords(e), where).toEqual([]);
        expect(tierAGlosses(e), where).toEqual([]);
        if (e.line.sentence) expect(emWidth(e.line.sentence.text), `${where}: ${e.line.sentence.text}`).toBeLessThanOrEqual(42);
        if (e.more.example) expect(e.more.example.length, `${where}: ${e.more.example}`).toBeLessThanOrEqual(40);
        if (e.mix?.partial) expect(e.mix.partial.length).toBeLessThanOrEqual(40);
      }
    }
    expect(seen).toBe(74 * 169);
  });

  it('the tier-C words the guide bans are nowhere to be found', () => {
    const text = ALL_SPOTS.flatMap((s) => ALL_HANDS.map((h) => generated(explainStep(stepFor(s, h))).join('\n'))).join('\n');
    for (const b of BANNED) expect(text.includes(b), b).toBe(false);
    // and the standard terms ARE used, bare
    for (const t of ['폴드', '콜', '오픈', '3벳', '4벳', '올인', '킥커', '셋', '포켓페어', '수티드', '오프수트', '커넥터', '포지션']) expect(text, t).toContain(t);
  });

  it('생성 문자열에는 괄호 풀이가 0개 — 풀이는 사람이 쓴 차트 메모에만 있다', () => {
    for (const sc of ALL_SPOTS) {
      for (const hand of ALL_HANDS) {
        const e = explainStep(stepFor(sc, hand));
        const text = generated(e).join('\n');
        for (const t of TIER_B) expect(glossHits(text, t), `${sc.kind} ${sc.hero} ${hand}: ${t}`).toBe(0);
        expect(text, `${sc.kind} ${sc.hero} ${hand}`).not.toMatch(/[가-힣A-Za-z]\(/);
      }
    }
    // 메모의 괄호 풀이는 그대로 둡니다(A2s 메모가 블로커를 풉니다).
    const a2 = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'A2s'));
    expect(a2.more.memo).toMatch(/블로커\(/);
  });

  it('차트 메모가 이미 푼 용어는 다시 풀지 않는다 (한 시트에 풀이 1회)', () => {
    for (const sc of ALL_SPOTS) {
      for (const hand of ALL_HANDS) {
        const e = explainStep(stepFor(sc, hand));
        const text = allStrings(e).join('\n');
        for (const t of TIER_B) expect(glossHits(text, t), `${sc.kind} ${sc.hero} ${hand}: ${t}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 예시 한 줄 (oneExample)                                               */
/* ------------------------------------------------------------------ */

describe('oneExample', () => {
  it('example cards come from the hand (hero cards are shown)', () => {
    expect(oneExample(stepFor({ kind: 'rfi', hero: 'BTN' }, 'A5s'))).toContain('A♠5♠');
    expect(oneExample(stepFor({ kind: 'rfi', hero: 'SB' }, 'KQo'))).toContain('K♠Q♦');
    expect(oneExample(stepFor({ kind: 'rfi', hero: 'UTG' }, '55'))).toContain('5♠5♦');
    expect(oneExample(stepFor({ kind: 'vs_open', hero: 'BTN', villain: 'HJ' }, '88'))).toMatch(/셋이 될 확률 12%/);
  });

  it('oneExample 은 §4.2-⑦ 의 세 모양 중 하나이거나 null 이고, 메모가 있으면 예시는 없다', () => {
    let shown = 0;
    for (const hand of ALL_HANDS) {
      const step = stepFor({ kind: 'rfi', hero: 'BTN' }, hand);
      const x = oneExample(step);
      if (x) {
        shown++;
        expect(EXAMPLE_SHAPES.some((re) => re.test(x)), x).toBe(true);
        expect(x.length, x).toBeLessThanOrEqual(40);
      }
      const cls = classifyHand(hand);
      if (cls === 'mid_pair' || cls === 'small_pair' || cls === 'wheel_ace') expect(x, hand).not.toBeNull();
      if (cls === 'premium_pair' || cls === 'big_pair' || cls === 'suited_connector' || cls === 'junk' || cls === 'ak') expect(x, hand).toBeNull();
    }
    expect(shown).toBeGreaterThan(40);
    for (const s of ALL_SPOTS) {
      for (const hand of ['A5s', 'KQo', '55', 'Q9s', 'T9s']) {
        const e = explainStep(stepFor(s, hand));
        if (e.more.memo) expect(e.more.example).toBeNull();
        else expect(e.more.example).toBe(oneExample(stepFor(s, hand)));
      }
    }
    expect(oneExample(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'CO' }, '22'))).toBe('내 2♠2♦ → 플랍에서 셋이 될 확률 12%예요.');
    expect(oneExample(stepFor({ kind: 'rfi', hero: 'UTG' }, 'A9o'))).toBe('내 A♠9♦ vs 상대 A♦K♠ → A를 맞춰도 킥커에서 밀려요.');
    expect(oneExample(stepFor({ kind: 'rfi', hero: 'UTG' }, 'QTs'))).toBe('내 Q♠10♠ vs 상대 A♦Q♦ → Q를 맞춰도 킥커에서 밀려요.');
  });

  it('an offsuit opponent hand never renders with two cards of the same suit, and no card appears twice', () => {
    for (const hand of ALL_HANDS) {
      const line = oneExample(stepFor({ kind: 'rfi', hero: 'BTN' }, hand));
      if (!line) continue;
      for (const m of line.matchAll(/((?:10|[2-9TJQKA]))([♠♦])((?:10|[2-9TJQKA]))([♠♦])/g)) {
        if (m[1] === m[3]) expect(m[2] === m[4], line).toBe(false);
      }
      const cards = line.match(/(?:10|[2-9TJQKA])[♠♦]/g) ?? [];
      expect(new Set(cards).size, `중복 카드: ${line}`).toBe(cards.length);
      // 오프수트 상대는 오프수트로 읽힙니다.
      const opp = /상대 ((?:10|[2-9TJQKA])([♠♦])(?:10|[2-9TJQKA])([♠♦]))/.exec(line);
      if (opp && parseHandName(hand).kind === 'offsuit') expect(opp[2] === opp[3], line).toBe(false);
    }
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
    expect(dominatedBy(parseHandName('AQo'))).toBe('KQo');
    // 예시 줄의 상대는 페어가 아니고, 내 높은 카드를 같이 들고 더 큰 킥커를 붙인 패입니다.
    for (const hand of ALL_HANDS) {
      const line = oneExample(stepFor({ kind: 'rfi', hero: 'BTN' }, hand));
      if (!line || !line.includes(' vs ')) continue;
      expect(line, hand).not.toMatch(/상대 ([2-9TJQKA]|10)[♠♦]\1[♠♦]/);
      expect(line.includes(`→ ${hand[0] === 'T' ? '10' : hand[0]}`), line).toBe(true);
    }
  });

  it('wheel ace 이고 메모가 없으면 예시는 블로커 줄', () => {
    let seen = 0;
    for (const s of ALL_SPOTS) {
      for (const hand of ['A5s', 'A4s', 'A3s', 'A2s']) {
        const e = explainStep(stepFor(s, hand));
        if (e.more.memo) continue;
        seen++;
        expect(e.more.example, `${s.kind} ${s.hero} ${hand}`).toBe(`내 A♠${hand[1]}♠ → A를 쥐고 있어 상대 AA·AK 조합이 줄어요.`);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('equity numbers: 셋이 될 확률 12% 만 남는다', () => {
    const text = ALL_SPOTS.flatMap((s) => ALL_HANDS.map((h) => explainStep(stepFor(s, h)).more.example ?? '')).join('\n');
    expect(text).toContain('셋이 될 확률 12%');
    expect(text).not.toMatch(/승률/);
    expect([...text.matchAll(/\d+%/g)].every((m) => m[0] === '12%')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Glossary                                                             */
/* ------------------------------------------------------------------ */

describe('glossary', () => {
  it('괄호 풀이가 붙은 자리에는 밑줄을 긋지 않는다 (설명은 한 번만 · 가이드 §2.4)', () => {
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
    expect(cbet.glossed).toBe(true);
    expect(explainCss).toMatch(/\.term-plain\s*\{[^}]*white-space:\s*nowrap/);
  });

  it('용어 풀이는 독립된 해요체 한 문장이고, 그 문장이 있는 본문에서는 밑줄을 긋지 않는다 (#8)', () => {
    for (const t of TIER_B) {
      const sentence = glossSentence(t)!;
      expect(sentence, t).toMatch(new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}[은는] .+(예요|이에요)\\.$`));
      expect(sentence.length, sentence).toBeLessThanOrEqual(45);
      expect(sentence, t).not.toMatch(/[()]/);
      const piece = splitTerms(`앞 문장이에요. ${sentence}`).find((p) => p.text === t || p.entry?.term === t);
      if (piece?.entry) expect(piece.defines, t).toBe(true);
    }
    expect(glossSentence('c-bet')).toBe('c-bet은 프리플랍 레이저가 플랍에서 잇는 벳이에요.');
    expect(glossSentence('스퀴즈')).toBe('스퀴즈는 오픈과 콜 뒤에 크게 올리는 것이에요.');
  });

  it('holds every tier-B concept and the tier-A terms worth explaining', () => {
    for (const t of TIER_B) expect(glossaryLookup(t), t).toBeDefined();
    for (const t of ['수티드', '오프수트', '커넥터', '브로드웨이', '킥커', '셋', '오버페어', '탑페어', '레인지', '포지션', '블라인드']) {
      expect(glossaryLookup(t), t).toBeDefined();
    }
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
        expect(e.line.sentence, `${s.scenario.kind} ${s.hand}`).not.toBeNull();
        expect(emWidth(e.line.sentence!.text)).toBeLessThanOrEqual(42);
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

describe('림프 대응의 포지션 (heroIsIP)', () => {
  // 림퍼는 언제나 내 앞자리에 앉아 있습니다. 블라인드는 플랍 이후 먼저, 나머지는 나중에 액션합니다.
  // 예전에는 BB 가 "나중에 액션"으로 읽혀 모든 BB 림프 카드에 포지션 문장이 거꾸로 붙었습니다.
  it('BB·SB 림프 카드는 포지션이 없고, CO·BTN 림프 카드는 포지션이 있다 — 림퍼 자리를 몰라도 같다', () => {
    for (const limper of ['UTG', 'HJ', 'CO', undefined] as Array<Pos | undefined>) {
      const extras = limper ? { limper } : undefined;
      for (const hero of ['SB', 'BB'] as Pos[]) expect(heroIsIP({ kind: 'vs_limp', hero, extras }), `${hero} ${limper}`).toBe(false);
      for (const hero of ['CO', 'BTN'] as Pos[]) if (hero !== limper) expect(heroIsIP({ kind: 'vs_limp', hero, extras }), `${hero} ${limper}`).toBe(true);
    }
    for (const hand of ALL_HANDS) {
      for (const hero of ['SB', 'BB'] as Pos[]) {
        const text = allStrings(explainStep(stepFor({ kind: 'vs_limp', hero, extras: { limper: 'HJ' } }, hand))).join('\n');
        expect(text, `${hero} ${hand}`).not.toContain('포지션이 있어요');
      }
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
  /** 메모가 없어 예시가 나오는 칸. */
  const noMemo = (s: Scenario, hand: string) => !explainStep(stepFor(s, hand)).more.memo;

  it('reads the orientation off the dealt cards', () => {
    expect(suitOrientation([{ rank: 'T', suit: 'd' }, { rank: '9', suit: 'd' }])).toBe('diamond');
    expect(suitOrientation([{ rank: 'T', suit: 's' }, { rank: '9', suit: 's' }])).toBe('spade');
    expect(suitOrientation([{ rank: 'K', suit: 'd' }, { rank: 'Q', suit: 's' }])).toBe('diamond');
    expect(suitOrientation([{ rank: 'K', suit: 's' }, { rank: 'Q', suit: 'd' }])).toBe('spade');
    for (const hand of ['A5s', 'KQo', '77', 'T9s', '72o']) {
      for (let i = 0; i < 40; i++) {
        const cards = dealCardsFor(hand);
        expect(suitOrientation(cards)).toBe(cards[0].suit === 'd' ? 'diamond' : 'spade');
      }
    }
  });

  it('내 패의 무늬가 화면 카드와 어긋나지 않는다 (KTs를 K♦10♦로 받으면 예시도 K♦10♦)', () => {
    const s: Scenario = { kind: 'vs_open', hero: 'SB', villain: 'UTG' };
    expect(noMemo(s, 'KTs')).toBe(true);
    const kt = explainStep(stepFor(s, 'KTs'), 'diamond').more.example!;
    expect(kt).toBe('내 K♦10♦ vs 상대 A♠K♠ → K를 맞춰도 킥커에서 밀려요.');
    const p22 = explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'CO' }, '22'), 'diamond').more.example!;
    expect(p22).toContain('2♦2♠');
  });

  it('뒤집기는 ♠↔♦ 맞바꾸기 하나뿐이다 — 그 밖의 글자는 한 자도 바뀌지 않고, 줄 문장 · 자리 문장은 그대로다', () => {
    const swap = (t: string) => t.replace(/[♠♦]/g, (c) => (c === '♠' ? '♦' : '♠'));
    for (const s of ALL_SPOTS.slice(0, 30)) {
      for (const hand of ALL_HANDS) {
        const a = explainStep(stepFor(s, hand), 'spade');
        const b = explainStep(stepFor(s, hand), 'diamond');
        expect(b.more.example, hand).toBe(a.more.example ? swap(a.more.example) : null);
        expect(b.more.memo, hand).toBe(a.more.memo ? swap(a.more.memo) : null);
        expect(b.line.sentence?.text).toBe(a.line.sentence?.text);
        expect(b.across.line.text).toBe(a.across.line.text);
      }
    }
  });

  it('뒤집은 예시에도 같은 카드가 두 번 나오지 않고, 오프수트 상대 패는 오프수트로 읽힌다', () => {
    for (const hand of ALL_HANDS) {
      const line = explainStep(stepFor({ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, hand), 'diamond').more.example;
      if (!line) continue;
      const seen = new Set<string>();
      for (const m of line.matchAll(/((?:10|[2-9TJQKA]))([♠♦])/g)) {
        const card = `${m[1]}${m[2]}`;
        expect(seen.has(card), `${hand}: ${line}`).toBe(false);
        seen.add(card);
      }
      for (const m of line.matchAll(/((?:10|[2-9TJQKA]))([♠♦])((?:10|[2-9TJQKA]))([♠♦])/g)) {
        if (m[1] === m[3]) expect(m[2] === m[4], line).toBe(false);
      }
    }
  });
});
