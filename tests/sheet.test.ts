import { describe, expect, it } from 'vitest';
import { compareAxis, compareCells, gateText, handAtlas, isReachable, rfiThesis, sectionDigest, sectionDigestDetail, uniformLine, type AtlasCell, type AtlasSection } from '../src/poker/atlas';
import { ALL_CHART_DEFS, getChartCells, hasChart } from '../src/poker/data';
import { explainStep, GLOSS, glossSentence, heroIsIP, type Explanation } from '../src/poker/explain';
import { ALL_HANDS } from '../src/poker/hands';
import { BANNED, bannedHits } from '../src/poker/ko';
import { rangeShare } from '../src/poker/range';
import { allScenarios, scenarioKey, scenarioSituation } from '../src/poker/scenarios';
import { seatLever, seatNumbers } from '../src/poker/sheet';
import { stepFor } from '../src/poker/trainer';
import { DISCLAIMER } from '../src/screens/charts/disclaimer';
import { SCENARIO_KINDS, type Pos, type Scenario } from '../src/poker/types';

/*
 * 해설 시트의 불변식 — docs/EXPLAIN_SPEC.md §7.2 의 4·5·11·12·14.
 */

const SCENARIOS = allScenarios().filter(hasChart);
const sentences = (text: string) => text.split(/(?<=[.?])\s+/).filter((x) => x.trim());

/** 모든 (상황, 도달 가능한 패)의 해설. 한 번만 만듭니다. */
const EXPLAINED: Array<{ s: Scenario; hand: string; e: Explanation }> = SCENARIOS.flatMap((s) =>
  ALL_HANDS.filter((hand) => isReachable(s, hand).ok).map((hand) => ({ s, hand, e: explainStep(stepFor(s, hand)) })),
);

/** 서술형 문장 필드(해요체로 끝나야 하는 것). */
const proseOf = (e: Explanation): string[] =>
  [e.line.sentence?.text, e.sibling?.text, e.across.line.text, e.seat.lever, e.mix?.partial, e.more.example].filter((x): x is string => !!x);
/** 명사형을 허용하는 필드(숫자 줄 · 캡슐 · 칩 · 제목). */
const nounsOf = (e: Explanation): string[] => [e.seat.numbers, e.capsule.label, e.title];

/** atlas 가 만드는 Line 전부(패 하나). compareCells 는 같은 축의 모든 쌍. */
function atlasTexts(hand: string): Array<{ text: string; noun: boolean }> {
  const atlas = handAtlas(hand);
  const out: Array<{ text: string; noun: boolean }> = [];
  for (const l of rfiThesis(atlas)) out.push({ text: l.text, noun: false });
  for (const kind of SCENARIO_KINDS) {
    const sec: AtlasSection = atlas.sections[kind];
    out.push({ text: sectionDigest(sec).text, noun: true });
    const d = sectionDigestDetail(sec);
    if (d) out.push({ text: d.text, noun: true });
    const u = uniformLine(sec);
    if (u) out.push({ text: u.text, noun: false });
    const cells = sec.cells;
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const [a, b] = [cells[i], cells[j]] as [AtlasCell, AtlasCell];
        if (compareAxis(a.scenario, b.scenario) === 'none') continue;
        for (const l of compareCells(a, b)) out.push({ text: l.text, noun: false });
      }
      const g = gateText(cells[i]);
      if (g) out.push({ text: g, noun: false });
    }
  }
  return out;
}

describe('sheet: 금지 표현 (§7.2-4)', () => {
  it('BANNED 가 해설의 생성 문자열 어디에도 없다', () => {
    const bad: string[] = [];
    const check = (t: string, where: string) => {
      const hits = bannedHits(t);
      if (hits.length) bad.push(`${where}: ${t} ← ${hits.join(', ')}`);
    };
    for (const { s, hand, e } of EXPLAINED) for (const t of [...proseOf(e), ...nounsOf(e)]) check(t, `${scenarioKey(s)} ${hand}`);
    for (const hand of ALL_HANDS) for (const { text } of atlasTexts(hand)) check(text, `atlas ${hand}`);
    for (const s of allScenarios()) check(scenarioSituation(s), `situation ${scenarioKey(s)}`);
    for (const s of allScenarios()) check(scenarioSituation({ ...s, extras: { limper: 'HJ', opener: 'UTG', threeBettor: 'HJ' } }), `situation+extras ${scenarioKey(s)}`);
    for (const t of Object.values(DISCLAIMER)) check(t, 'DISCLAIMER');
    // 용어 풀이: 용어 이름 자체(SPR · c-bet · 팟 오즈)는 이론 용어라 금지 목록에 있습니다 — 풀이 부분만 봅니다.
    for (const [term] of GLOSS) check(glossSentence(term)!.slice(term.length), `gloss ${term}`);
    expect(bad.slice(0, 20)).toEqual([]);
    expect(BANNED.length).toBeGreaterThan(40);
  });

  it('줄 문장 · 자리 문장 · 레버에는 괄호가 없다', () => {
    for (const { e } of EXPLAINED) for (const t of [e.line.sentence?.text, e.sibling?.text, e.across.line.text, e.seat.lever]) if (t) expect(t).not.toMatch(/[()]/);
  });
});

describe('sheet: 말투 (§7.2-5)', () => {
  /** '→'로 잇는 표기(상황 사다리 'UTG 오픈 → BTN 3벳 → 내 4벳 → BTN 올인.')는 숫자 줄과 같은 명사형 표기라 뺍니다. */
  const endsInYo = (sentence: string) => /요[.?]$/.test(sentence) || sentence.includes('→');

  it('서술형 문자열의 모든 문장은 해요체로 끝나고, 명사형 필드에는 서술형 어미가 없다', () => {
    const bad: string[] = [];
    for (const { s, hand, e } of EXPLAINED) {
      for (const t of proseOf(e)) for (const x of sentences(t)) if (!/요[.?]$/.test(x)) bad.push(`${scenarioKey(s)} ${hand}: ${x}`);
      for (const t of nounsOf(e)) if (/(니다|해요|예요)$/.test(t)) bad.push(`${scenarioKey(s)} ${hand} noun: ${t}`);
    }
    for (const hand of ALL_HANDS) {
      for (const { text, noun } of atlasTexts(hand)) {
        if (noun) {
          if (/(니다|해요|예요)$/.test(text)) bad.push(`atlas ${hand} noun: ${text}`);
        } else for (const x of sentences(text)) if (!/요[.?]$/.test(x)) bad.push(`atlas ${hand}: ${x}`);
      }
    }
    for (const s of allScenarios()) for (const x of sentences(scenarioSituation(s))) if (!endsInYo(x)) bad.push(`situation ${scenarioKey(s)}: ${x}`);
    for (const t of Object.values(DISCLAIMER)) for (const x of sentences(t)) if (!/요[.?]$/.test(x)) bad.push(`DISCLAIMER: ${x}`);
    for (const [term] of GLOSS) expect(glossSentence(term)!).toMatch(/(예요|이에요)\.$/);
    expect(bad.slice(0, 20)).toEqual([]);
    expect(glossSentence('블로커')).toBe('블로커는 내가 쥔 카드 때문에 상대 조합이 줄어드는 효과예요.');
    expect(glossSentence('지배')).toBe('지배는 같은 카드를 쥔 상대보다 킥커가 낮아, 그 카드를 맞춰도 지는 상태예요.');
    expect(glossSentence('셋마이닝')).toBeNull();
  });

  it('상황 문구 (§5.4)', () => {
    expect(scenarioSituation({ kind: 'rfi', hero: 'SB' })).toBe('앞에서 모두 폴드했어요. SB, 내 차례예요.');
    expect(scenarioSituation({ kind: 'vs_open', hero: 'BB', villain: 'BTN' })).toBe('BTN이 오픈했어요. BB, 내 차례예요.');
    expect(scenarioSituation({ kind: 'vs_3bet', hero: 'CO', villain: 'BTN' })).toBe('CO에서 오픈했는데 BTN이 3벳했어요. 다시 내 차례예요.');
    expect(scenarioSituation({ kind: 'vs_4bet', hero: 'BB', villain: 'CO' })).toBe('CO 오픈에 BB에서 3벳했더니 CO가 4벳했어요.');
    expect(scenarioSituation({ kind: 'vs_5bet', hero: 'UTG', villain: 'BTN' })).toBe('UTG 오픈 → BTN 3벳 → 내 4벳 → BTN 올인. 콜할까요?');
    expect(scenarioSituation({ kind: 'cold_4bet', hero: 'BTN', extras: { opener: 'UTG', threeBettor: 'CO' } })).toBe('앞에서 오픈과 3벳이 나왔어요. BTN, 내 차례예요.');
    expect(scenarioSituation({ kind: 'vs_limp', hero: 'CO', extras: { limper: 'HJ' } })).toBe('HJ가 림프했어요. CO, 내 차례예요.');
    expect(scenarioSituation({ kind: 'vs_limp', hero: 'BB', extras: { limper: 'BTN' } })).toBe('BTN이 림프했어요. BB는 체크 아니면 레이즈예요.');
  });
});

/** 사람이 쓴 차트 메모 전부(§6.4). '자세히'에 그대로 찍히므로 정리본도 같은 말투 규칙을 따릅니다. */
const NOTES = ALL_CHART_DEFS.flatMap((d) => Object.entries(d.notes ?? {}).map(([hand, text]) => ({ where: `${d.id} ${hand}`, text })));

describe('sheet: 차트 메모 정리본 (§6.4, §7.2-4·5)', () => {
  /**
   * 메모의 내용(숫자 · 괄호 풀이 · '→' 예시)은 사람이 쓴 원문이라 손대지 않습니다(§6.4, §8).
   * 이론 용어 셋은 메모에서 괄호로 풀이했거나 승률 숫자와 붙어 있는 내용이라 BANNED 에서 뺍니다.
   */
  const MEMO_CONTENT = new Set(['필요 승률', '팟 오즈', 'SPR']);

  // 647개를 하나씩 다시 쓰고, 이 패에만 해당하는 이유가 없거나(시트의 다른 조각을 되풀이할 뿐인 것 포함) 도달할 수 없는
  // 칸의 41개를 지웠고(THEORY_SPEC §9-2), 교차 검토(시트 한 장을 통째로 읽기)에서 11개를 더 지웠어요.
  it('595개 전부 BANNED 에 걸리지 않는다', () => {
    expect(NOTES.length).toBe(595);
    const bad: string[] = [];
    for (const { where, text } of NOTES) {
      const hits = bannedHits(text).filter((h) => !MEMO_CONTENT.has(h));
      if (hits.length) bad.push(`${where}: ${text} ← ${hits.join(', ')}`);
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it('모든 문장이 해요체로 끝난다 (\'→\' 예시 줄은 명사형으로 끝나도 되지만 합니다체는 안 된다)', () => {
    const bad: string[] = [];
    for (const { where, text } of NOTES) {
      for (const x of sentences(text)) {
        if (/요[.?]$/.test(x)) continue;
        if (x.includes('→') && !/(니다|세요)/.test(x)) continue;
        bad.push(`${where}: ${x}`);
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it('다시 쓴 메모 몇 개를 글자까지 고정 (THEORY_SPEC §9 — 이 패에만 해당하는 이유)', () => {
    const memo = (s: Scenario, hand: string) => explainStep(stepFor(s, hand)).more.memo;
    expect(memo({ kind: 'rfi', hero: 'UTG' }, 'KJo')).toBe('KJo는 절반만 오픈해요. KQo는 BTN·SB·BB의 3벳에 콜을 섞지만, KJo는 누가 3벳하든 폴드해서 오픈의 이득이 그만큼 얇아요.');
    expect(memo({ kind: 'vs_3bet', hero: 'CO', villain: 'BTN' }, 'A5s')).toBe('4벳해요. A5s를 쥐면 BTN이 4벳에 계속하는 조합이 49개에서 약 41개로 줄어요. BTN이 올인하면 폴드해요.');
    expect(memo({ kind: 'vs_4bet', hero: 'HJ', villain: 'UTG' }, 'QQ')).toBe('주로 콜하고, 가끔 올인해요. 올인하면 UTG는 QQ가 이기는 AKo·A5s를 폴드하고 AA·KK와 AKs 절반으로만 콜해 승률이 약 23%예요. 콜하면 범위 전체에 약 41%예요.');
    expect(memo({ kind: 'cold_4bet', hero: 'CO' }, 'QQ')).toBe('QQ는 4벳과 콜을 반반 섞어요. HJ의 3벳 범위 전체에는 승률이 약 55%지만, 그중 AA·KK 12조합에는 약 18%뿐이라 4벳과 콜의 가치가 비슷해요.');
    expect(memo({ kind: 'vs_open', hero: 'SB', villain: 'UTG' }, 'QJs')).toBe('주로 폴드하고, 가끔 3벳해요. QJs는 UTG의 4벳 범위 중 QQ만 막아서, 4벳 조합이 42개에서 39개로만 줄어요. KJs라면 35개로 줄어요.');
  });
});

describe('sheet: 숫자 줄 (§7.2-11)', () => {
  it('모든 %가 Math.round(rangeShare×100)이고, rfi 사다리는 18/21/29/46/46', () => {
    for (const s of SCENARIOS) {
      const n = seatNumbers(s);
      const pcts = [...n.text.matchAll(/(\d+)%( 미만)?/g)].map((m) => (m[2] ? 0 : Number(m[1])));
      expect(pcts, n.text).toEqual(n.nums);
      if (s.kind === 'rfi') {
        expect(n.ladder!.map((x) => x.pct)).toEqual([18, 21, 29, 46, 46]);
        expect(n.ladder!.filter((x) => x.me).map((x) => x.pos)).toEqual([s.hero]);
        for (const x of n.ladder!) expect(x.pct).toBe(Math.round(rangeShare(getChartCells({ kind: 'rfi', hero: x.pos }), 'raise') * 100));
      } else {
        expect(n.ladder).toBeNull();
        // 내 액션 %는 그 차트의 rangeShare 를 반올림한 값 그대로입니다.
        const cells = getChartCells(s);
        const mine = n.nums.slice(s.villain ? 1 : 0);
        const shares = (['call', 'raise', 'threebet', 'fourbet', 'allin'] as const).map((a) => Math.round(rangeShare(cells, a) * 100));
        for (const x of mine) expect(shares, `${scenarioKey(s)} ${n.text}`).toContain(x);
      }
    }
    expect(seatNumbers({ kind: 'vs_open', hero: 'BB', villain: 'CO' }).text).toBe('CO 오픈 29% → 내 콜 37% · 3벳 9%');
  });
});

describe('sheet: 레버 데이터 판단 (§7.2-12)', () => {
  it('SB 콜 문장은 콜 비중 < 2% 일 때만, 포지션 문장은 heroIsIP 와 같고, vs_5bet·cold_4bet 에는 포지션 문장이 없다', () => {
    for (const s of SCENARIOS) {
      const lever = seatLever(s);
      const where = `${scenarioKey(s)} ${lever?.text}`;
      if (lever?.id === 'sbRaiseOrFold') {
        expect(s.kind === 'vs_open' && s.hero === 'SB', where).toBe(true);
        expect(rangeShare(getChartCells(s), 'call'), where).toBeLessThan(0.02);
      }
      if (s.kind === 'vs_open' && s.hero === 'SB' && rangeShare(getChartCells(s), 'call') < 0.02) expect(lever?.id, where).toBe('sbRaiseOrFold');
      if (lever?.id === 'position') {
        expect(['vs_open', 'vs_3bet', 'vs_4bet']).toContain(s.kind);
        expect(lever.text, where).toBe(`${s.hero === 'BTN' ? 'BTN은' : `${s.hero}는`} ${s.villain}보다 포지션이 ${heroIsIP(s) ? '있어요' : '없어요'}.`);
      }
      if (s.kind === 'vs_5bet' || s.kind === 'cold_4bet') expect(lever?.text ?? '', where).not.toMatch(/포지션/);
      if (s.kind === 'rfi') expect(lever?.text, where).toMatch(/오픈해요\.$/);
      if (s.kind === 'vs_open' && s.hero === 'BB') expect(lever?.id).toBe('bbPrice');
      if (s.kind === 'vs_limp') expect(lever?.id ?? null).toBe(s.hero === 'BB' ? 'bbFree' : null);
    }
    // BTN 오픈은 책의 약 43%(5장 2절)와 차트 46%를 같이 밝힙니다(감사 19).
    expect(seatLever({ kind: 'rfi', hero: 'BTN' })?.text).toBe('BTN은 블라인드만 남아 책의 약 43%보다 넓은 46%를 오픈해요.');
    // SB 오픈은 뒤에 한 명뿐이라서 넓은 게 아닙니다 — SB 46.2% 는 BTN 46.3% 보다 넓지 않고, 포지션이 없어서예요(감사 7).
    expect(seatLever({ kind: 'rfi', hero: 'SB' })?.text).toBe('SB는 BB만 남아도 포지션이 없어 BTN만큼인 46%를 오픈해요.');
    expect(Math.round(rangeShare(getChartCells({ kind: 'rfi', hero: 'SB' }), 'raise') * 100)).toBe(Math.round(rangeShare(getChartCells({ kind: 'rfi', hero: 'BTN' }), 'raise') * 100));
    // SB 는 콜을 0.7~1.5% 섞어서 '대부분'(감사 0).
    expect(seatLever({ kind: 'vs_open', hero: 'SB', villain: 'UTG' })?.text).toBe('SB는 콜을 거의 안 하고, 대부분 3벳 아니면 폴드해요.');
    // HJ · CO · BTN 의 오픈 대응: 포지션만 말하면 콜의 이유처럼 읽혀서, 책이 드는 스퀴즈 위험을 같이(감사 18).
    for (const s of SCENARIOS.filter((x) => x.kind === 'vs_open' && ['HJ', 'CO', 'BTN'].includes(x.hero))) {
      expect(seatLever(s)).toEqual({ id: 'behind', text: `${s.hero === 'BTN' ? 'BTN은' : `${s.hero}는`} 포지션이 있어도 콜하면 뒤에서 스퀴즈를 받기 쉬워요.` });
      expect(heroIsIP(s), scenarioKey(s)).toBe(true);
    }
    expect(seatLever({ kind: 'vs_open', hero: 'BB', villain: 'SB' })?.text).toBe('BB는 이미 1bb를 냈으니 2bb만 더 내면 돼요.');
  });
});

describe('sheet: 반복 금지 (§7.2-14)', () => {
  /**
   * '서술어' = 문장 끝 두 어절('절반만 오픈해요', 'K9s까지 오픈해요'). 스펙 §4.3 의 KJo 시트는 줄 · 형제 줄 · 레버 · 자리 문장이
   * 전부 '…오픈해요'로 끝나므로, 동사 하나만 세면 스펙 자신의 예시가 규칙을 어깁니다 — 수식어까지 같은 끝맺음을 셉니다.
   */
  const predicate = (sentence: string) => sentence.replace(/[.?]$/, '').split(' ').slice(-2).join(' ');

  it('한 해설 안에서 같은 서술어가 세 번 이상 나오지 않는다', () => {
    const bad: string[] = [];
    for (const { s, hand, e } of EXPLAINED) {
      const counts = new Map<string, number>();
      // 줄 문장과 형제 줄이 같은 서술어로 끝나는 것은 허용합니다(같은 축) — 둘을 한 번으로 셉니다.
      const lineEnd = e.line.sentence ? predicate(sentences(e.line.sentence.text).at(-1)!) : null;
      for (const t of proseOf(e)) {
        if (t === e.sibling?.text && predicate(sentences(t).at(-1)!) === lineEnd) continue;
        for (const x of sentences(t)) counts.set(predicate(x), (counts.get(predicate(x)) ?? 0) + 1);
      }
      for (const [p, n] of counts) if (n >= 3) bad.push(`${scenarioKey(s)} ${hand}: '${p}' ×${n}`);
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });
});

describe('sheet: 자리 문장의 이름 규칙 (§4.2-⑥, 리뷰)', () => {
  const SEATS: Pos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  const WORD = (mix: Array<{ action: string; weight: number }>, rest: string) => {
    const [m0, m1] = mix;
    if (m0.weight >= 0.6) return null;
    // 세 액션 칸(콜 50 · 4벳 25 · 폴드 25): '절반만'(= 나머지는 폴드)으로 부르지 않고 '절반은'으로(THEORY_SPEC §5).
    if (mix.filter((m) => m.weight > 0.001).length >= 3) return 'split';
    if (m1 && Math.abs(m1.weight - m0.weight) < 0.01 && m1.action !== rest) return '반반';
    return m0.action === rest ? '절반은' : '절반만';
  };
  /** 문장 속 자리 언급 → 그 자리들. 'HJ~BTN'은 사이 자리까지. 각 언급 뒤 쉼표 전까지의 말을 붙여 돌려줍니다. */
  function mentions(text: string): Array<{ seats: Pos[]; tail: string }> {
    const out: Array<{ seats: Pos[]; tail: string }> = [];
    const re = /((?:(?:UTG|HJ|CO|BTN|SB|BB)(?:~(?:UTG|HJ|CO|BTN|SB|BB))?·?)+)에서/g;
    for (const m of text.matchAll(re)) {
      const seats: Pos[] = [];
      for (const part of m[1].split('·')) {
        const [a, b] = part.split('~') as Pos[];
        const i0 = SEATS.indexOf(a);
        const i1 = b ? SEATS.indexOf(b) : i0;
        for (let i = i0; i <= i1; i++) seats.push(SEATS[i]);
      }
      const rest = text.slice(m.index! + m[0].length);
      out.push({ seats, tail: rest.slice(0, rest.search(/,|\.|$/) + 1) });
    }
    return out;
  }

  it('섞인 자리(비중 ≤ 0.5)는 그 자리 이름 뒤에 비중어가 오거나, "다른 자리에서는 · 어느 자리에서나 〈비중어〉"에 든다 · "나머지는" 꼴은 없다', () => {
    let weak = 0;
    let split = 0;
    for (const { s, hand, e } of EXPLAINED) {
      if (s.kind === 'rfi') continue; // rfi 는 rfiThesis(atlas.test 가 따로 봅니다)
      const text = e.across.line.text;
      const where = `${scenarioKey(s)} ${hand}: ${text}`;
      expect(text, where).not.toMatch(/나머지는|나머지 자리/);
      const ms = mentions(text);
      const live = e.across.cells.filter((x) => x.reachable);
      const restOf = (c: (typeof live)[number]) => (c.scenario.kind === 'vs_limp' && c.scenario.hero === 'BB' ? 'check' : 'fold');
      for (const c of live) {
        const w = WORD(c.mixList, restOf(c));
        if (!w) continue;
        weak++;
        const m = ms.find((x) => x.seats.includes(c.scenario.hero));
        // 세 액션 자리: '절반은 콜(, 절반은 4벳·폴드 · 하고 나머지를 …)' 또는 46em 을 넘을 때 '콜 반·4벳·폴드'.
        // 같은 1순위의 '절반만' 자리는 세 액션 자리와 한 묶음일 때만 '절반은'으로 같이 부를 수 있습니다.
        const sameGroupSplit = !!m && live.some((x) => x !== c && m.seats.includes(x.scenario.hero) && WORD(x.mixList, restOf(x)) === 'split');
        const ok = (tail: string) => (w === 'split' ? /절반은|반·/.test(tail) : tail.includes(w) || (w === '절반만' && sameGroupSplit && tail.includes('절반은')));
        if (w === 'split') split++;
        if (m) expect(ok(m.tail), `${where} ← ${c.scenario.hero} ${w}`).toBe(true);
        else {
          const g = /(다른 자리에서는|어느 자리에서나) (.*)$/.exec(text);
          expect(!!g && (w === '반반' ? /\S+ \S+ 반반/.test(g[2]) : ok(g[2])), `${where} ← ${c.scenario.hero} ${w}`).toBe(true);
        }
      }
    }
    expect(weak).toBeGreaterThan(100);
    expect(split).toBeGreaterThan(20);
  });

  it("THEORY_SPEC §5: 못 오는 자리를 '어느 자리에서나' · '다른 자리에서는'으로 덮지 않고(a), 'X에서만 V'는 다른 자리가 rest 일 때만(g)", () => {
    let only = 0;
    for (const { s, hand, e } of EXPLAINED) {
      if (s.kind === 'rfi') continue;
      const text = e.across.line.text;
      const where = `${scenarioKey(s)} ${hand}: ${text}`;
      const live = e.across.cells.filter((x) => x.reachable);
      if (live.length < e.across.cells.length) expect(text, where).not.toMatch(/어느 자리에서나|다른 자리에서는/);
      const m = /((?:(?:UTG|HJ|CO|BTN|SB|BB)[~·]?)+)에서만 (\S+?)(해요|하고)/.exec(text);
      if (!m) continue;
      only++;
      const named = mentions(`${m[1]}에서`)[0].seats;
      const others = live.filter((c) => !named.includes(c.scenario.hero));
      const restAll = others.every((c) => c.primary === (c.scenario.kind === 'vs_limp' && c.scenario.hero === 'BB' ? 'check' : 'fold'));
      // 다른 자리가 전부 rest 면 '…에서만 콜해요'로 끝나고, 아니면 '…에서만 폴드하고, 다른 자리에서는 콜해요'처럼 그 액션을 말합니다.
      if (restAll) expect(m[3], where).toBe('해요');
      else expect(text, where).toMatch(/에서만 \S+하고, (다른 자리에서는|(?:(?:UTG|HJ|CO|BTN|SB|BB)[~·]?)+에서는) /);
    }
    expect(only).toBeGreaterThan(100);
    const across = (sc: Scenario, hand: string) => explainStep(stepFor(sc, hand)).across.line.text;
    expect(across({ kind: 'vs_open', hero: 'SB', villain: 'UTG' }, 'KTs')).toBe('KTs는 UTG 오픈에 SB에서만 폴드하고, 다른 자리에서는 콜해요.');
    expect(across({ kind: 'vs_open', hero: 'BB', villain: 'CO' }, 'KTs')).toBe('KTs는 CO 오픈에 SB에서만 3벳하고, 다른 자리에서는 콜해요.');
    expect(across({ kind: 'vs_limp', hero: 'BB' }, '98s')).toBe('98s는 림프에 HJ~SB에서 레이즈하고, BB에서는 체크해요.');
    expect(across({ kind: 'vs_4bet', hero: 'HJ', villain: 'UTG' }, 'AJs')).toBe('AJs는 UTG 4벳에 HJ~SB에서 폴드해요.');
    expect(across({ kind: 'vs_3bet', hero: 'BTN', villain: 'SB' }, 'K8s')).toBe('K8s는 SB 3벳에 BTN에서는 주로 콜하고, HJ·CO에서는 폴드해요.');
    // (b) 세 액션 자리
    expect(across({ kind: 'vs_3bet', hero: 'UTG', villain: 'HJ' }, 'A5s')).toBe('A5s는 HJ 3벳에 UTG에서 절반은 4벳하고, 나머지를 콜과 폴드로 나눠요.');
    expect(across({ kind: 'vs_3bet', hero: 'BTN', villain: 'BB' }, 'A9o')).toBe('A9o는 BB 3벳에 CO·SB에서 폴드, BTN에서 절반은 폴드, 절반은 4벳·콜이에요.');
  });

  it('리뷰가 짚은 자리 문장', () => {
    const across = (sc: Scenario, hand: string) => explainStep(stepFor(sc, hand)).across.line.text;
    expect(across({ kind: 'vs_open', hero: 'SB', villain: 'CO' }, 'A7s')).toBe('A7s는 CO 오픈에 SB에서는 절반만 3벳하고, 다른 자리에서는 콜해요.');
    expect(across({ kind: 'vs_4bet', hero: 'HJ', villain: 'UTG' }, 'AKs')).toBe('AKs는 UTG 4벳에 HJ~BTN에서 주로 올인하고, SB·BB에서는 올인과 콜을 반반 섞어요.');
    expect(across({ kind: 'vs_open', hero: 'HJ', villain: 'UTG' }, 'AQo')).toBe('AQo는 UTG 오픈에 HJ~BTN·BB에서 3벳과 콜을 반반 섞고, SB에서는 3벳해요.');
    expect(across({ kind: 'vs_limp', hero: 'HJ' }, '72o')).toBe('72o는 림프에 어느 자리에서도 레이즈하지 않아요.');
    // 세 액션 자리(CO 폴드 50 · 4벳 25 · 콜 25, BTN·BB 4벳 50 · 콜 25 · 폴드 25)는 '절반만'으로 줄이지 않습니다 —
    // 나눔까지 부르면 46em 을 넘어서 '절반은'으로 줄였고, 나머지가 폴드뿐인 SB 만 '절반만 4벳'이에요.
    // 콜드 상황의 앞머리는 '오픈과 3벳 뒤에'(책 5장 3절 — 앞의 오픈까지). 짧아진 만큼 46em 안에서 나눔('폴드 반·4벳·콜')까지 부릅니다.
    expect(across({ kind: 'cold_4bet', hero: 'CO' }, 'AKo')).toBe('AKo는 오픈과 3벳 뒤에 CO에서 폴드 반·4벳·콜, BTN·BB에서 4벳 반·콜·폴드, SB에서 절반만 4벳이에요.');
  });

  it('부분 정답 문장: 두 액션의 가치가 비슷하다는 것(책 2장 무차별)을 먼저, 채점은 그다음 — "더 공격적인"은 두 계속 액션의 반반에만', () => {
    const actionLabelOf = (a: string, s: Scenario) => (a === 'raise' ? (s.kind === 'vs_limp' ? '레이즈' : '오픈') : ({ call: '콜', threebet: '3벳', fourbet: '4벳', allin: '올인', fold: '폴드', check: '체크' } as Record<string, string>)[a]);
    let restTie = 0;
    let contTie = 0;
    for (const { e, s } of EXPLAINED) {
      const p = e.mix?.partial;
      if (!p) continue;
      const chips = e.mix!.chips;
      const [a1, a2] = [chips[0].action, chips[1].action];
      const rest = s.kind === 'vs_limp' && s.hero === 'BB' ? 'check' : 'fold';
      // 한쪽을 '정답'이라 부르기 전에, 두 액션이 가치가 거의 같아 둘 다 쓴다는 말이 먼저 옵니다.
      expect(p, p).toMatch(/^\S+[과와] \S+[은는] 가치가 비슷해요\. 채점은 (더 공격적인 )?\S+[이가] 정답이에요\.$/);
      expect(p.startsWith(`${actionLabelOf(a1, s)}`), p).toBe(true);
      expect(p.length, p).toBeLessThanOrEqual(40);
      expect(p, p).not.toMatch(/반반이라|이 칸은/);
      if (a2 === rest) {
        restTie++;
        // 계속 · rest 반반: '반반'(계속하는 두 액션 사이에만)도 '더 공격적인'(콜을 공격적이라 부르게 됨)도 쓰지 않습니다.
        expect(p, p).not.toMatch(/반반|공격적/);
      } else {
        contTie++;
        expect(p, p).toContain('더 공격적인');
        expect(a1).not.toBe(rest);
      }
    }
    expect(restTie).toBeGreaterThan(100);
    expect(contTie).toBeGreaterThan(50);
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'KJo')).mix!.partial).toBe('오픈과 폴드는 가치가 비슷해요. 채점은 오픈이 정답이에요.');
    expect(explainStep(stepFor({ kind: 'cold_4bet', hero: 'CO' }, 'QQ')).mix!.partial).toBe('4벳과 콜은 가치가 비슷해요. 채점은 더 공격적인 4벳이 정답이에요.');
  });
});

describe('sheet: acrossRow (§4.2-⑥)', () => {
  it('rfi·cold·limp 는 스트립 전체, 대응 상황은 같은 상대 열의 칸이고, 자리 문장은 도달 칸만 말한다', () => {
    for (const { s, hand, e } of EXPLAINED.filter((_, i) => i % 7 === 0)) {
      const cells = e.across.cells;
      if (s.kind === 'rfi' || s.kind === 'cold_4bet' || s.kind === 'vs_limp') expect(cells.length).toBe({ rfi: 5, cold_4bet: 4, vs_limp: 5 }[s.kind]);
      else for (const c of cells) expect(c.scenario.villain, `${scenarioKey(s)} ${hand}`).toBe(s.villain);
      expect(cells.some((c) => c.scenario.hero === s.hero)).toBe(true);
      const unreachable = cells.filter((c) => !c.reachable).map((c) => c.scenario.hero as Pos);
      for (const p of unreachable) expect(e.across.line.text.includes(`${p}에서`), `${scenarioKey(s)} ${hand}: ${e.across.line.text}`).toBe(false);
    }
  });
});
