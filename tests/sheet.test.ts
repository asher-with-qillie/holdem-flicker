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
import { DISCLAIMER, DISCLAIMER_BB_LIMP } from '../src/screens/charts/disclaimer';
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
    for (const t of [...Object.values(DISCLAIMER), DISCLAIMER_BB_LIMP]) check(t, 'DISCLAIMER');
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
    for (const t of [...Object.values(DISCLAIMER), DISCLAIMER_BB_LIMP]) for (const x of sentences(t)) if (!/요[.?]$/.test(x)) bad.push(`DISCLAIMER: ${x}`);
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
    // BB 의 림프 대응 = SB 가 림프했고 BB 차례(책의 균형 전략에서 림프하는 자리는 SB 뿐) — extras 가 없어도 SB 입니다.
    expect(scenarioSituation({ kind: 'vs_limp', hero: 'BB', extras: { limper: 'SB' } })).toBe('SB가 림프했어요. BB는 체크 아니면 레이즈예요.');
    expect(scenarioSituation({ kind: 'vs_limp', hero: 'BB' })).toBe('SB가 림프했어요. BB는 체크 아니면 레이즈예요.');
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
  // 칸의 41개를 지웠고(THEORY_SPEC §9-2), 교차 검토(시트 한 장을 통째로 읽기)에서 11개를 더 지웠어요(595개).
  // 차트를 책(MPT 5장)에 맞춰 다시 만든 뒤(2026-11) 메모를 새 차트로 다시 썼어요: 378개를 고쳐 쓰거나 그대로 두고, 거짓이 됐거나
  // 도달할 수 없게 된 217개를 지우고, 섞인 칸 · 책이 이름으로 든 칸 · 경계 칸에 183개를 더했어요(561개). 교차 검토에서 옛 CO 림프
  // 차트의 블로커 레이즈 이유를 그대로 달고 있던 vs_limp:CO A4s 를 하나 더 지웠어요(560개).
  it('560개 전부 BANNED 에 걸리지 않는다', () => {
    expect(NOTES.length).toBe(560);
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
    expect(memo({ kind: 'rfi', hero: 'UTG' }, 'KJo')).toBe('KJo는 절반만 오픈해요. K나 J를 맞혀도 킥커에서 밀리는 상대 조합(AK·KQ·AJ)이 36개로, 늘 오픈하는 KQo(AK·AQ 24개)보다 많아요.');
    expect(memo({ kind: 'vs_3bet', hero: 'CO', villain: 'BTN' }, 'A5s')).toBe('4벳해요. A5s를 쥐면 BTN이 4벳에 계속하는 조합이 77개에서 약 63개로 줄어요. BTN이 올인하면 승률이 32%로 올인에 콜하는 값 38%에 못 미쳐 폴드해요.');
    expect(memo({ kind: 'vs_4bet', hero: 'HJ', villain: 'UTG' }, 'QQ')).toBe('콜해요. 책도 HJ가 UTG의 4벳을 받으면 KK보다 약한 페어는 대부분 콜한다고 해요. 올인하면 UTG는 QQ가 67%로 이기는 블러프(A5s~A3s·KQ)를 폴드하고, AA·KK·AK 위주로 콜해 승률이 42%로 떨어져요.');
    // 콜드 4벳은 이제 콜이 없어요(책 5장: 4벳 아니면 폴드) — 반반을 가르치던 QQ 대신 4벳 · 폴드를 섞는 JJ.
    expect(memo({ kind: 'cold_4bet', hero: 'CO' }, 'JJ')).toBe('주로 4벳하고, 가끔 폴드해요. HJ가 UTG 오픈에 3벳한 범위에는 승률이 약 56%지만, 그중 QQ 이상·AK 34조합에는 약 36%뿐이라 4벳과 폴드의 가치가 비슷해요. 승률이 약 51%인 TT부터는 폴드해요.');
    // SB 는 이제 UTG 오픈에 QJs 를 폴드만 해요(메모 없음) — 3벳과 폴드가 갈리는 KJs.
    expect(memo({ kind: 'vs_open', hero: 'SB', villain: 'UTG' }, 'KJs')).toBe('절반만 3벳해요. 3벳에 UTG가 콜하는 범위에 승률은 KQs 46%, KJs 44%, KTs 42%로, KJs는 늘 3벳하는 KQs와 폴드하는 KTs 사이예요.');
  });
});

describe('sheet: 숫자 줄 (§7.2-11)', () => {
  it('모든 %가 Math.round(rangeShare×100)이고, rfi 사다리는 17/21/28/43 · SB 레이즈 24 · 림프 38', () => {
    for (const s of SCENARIOS) {
      const n = seatNumbers(s);
      const pcts = [...n.text.matchAll(/(\d+)%( 미만)?/g)].map((m) => (m[2] ? 0 : Number(m[1])));
      expect(pcts, n.text).toEqual(n.nums);
      if (s.kind === 'rfi') {
        // 책 5장 2절: UTG(LJ) 약 17 · HJ 약 21 · CO 약 28 · BTN 약 43, SB 는 레이즈 약 24 · 림프 약 38 — SB 칸은 둘을 따로 적어요
        // (더해서 'SB 62%'라고 하면 BTN 보다 넓게 오픈한다고 읽히고, 레이즈만 적으면 림프가 사라져요).
        expect(n.ladder!.map((x) => x.pct)).toEqual([17, 21, 28, 43, 24]);
        expect(n.ladder!.map((x) => x.limp ?? null)).toEqual([null, null, null, null, 38]);
        expect(n.text).toBe('UTG 17% · HJ 21% · CO 28% · BTN 43% · SB 레이즈 24% · 림프 38%');
        expect(n.ladder!.find((x) => x.pos === 'SB')!.limp).toBe(Math.round(rangeShare(getChartCells({ kind: 'rfi', hero: 'SB' }), 'limp') * 100));
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
    expect(seatNumbers({ kind: 'vs_open', hero: 'BB', villain: 'CO' }).text).toBe('CO 오픈 28% → 내 콜 29% · 3벳 9%');
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
        // '콜 없이'는 콜이 정확히 0 일 때만, '거의 안 하고'는 0 보다 크고 2% 아래일 때만.
        expect(lever.text, where).toBe(rangeShare(getChartCells(s), 'call') === 0 ? 'SB는 콜 없이 3벳 아니면 폴드해요.' : 'SB는 콜을 거의 안 하고, 대부분 3벳 아니면 폴드해요.');
      }
      if (s.kind === 'vs_open' && s.hero === 'SB' && rangeShare(getChartCells(s), 'call') < 0.02) expect(lever?.id, where).toBe('sbRaiseOrFold');
      if (lever?.id === 'position') {
        expect(['vs_open', 'vs_3bet', 'vs_4bet']).toContain(s.kind);
        expect(lever.text, where).toBe(`${s.hero === 'BTN' ? 'BTN은' : `${s.hero}는`} ${s.villain}보다 포지션이 ${heroIsIP(s) ? '있어요' : '없어요'}.`);
      }
      if (s.kind === 'vs_5bet' || s.kind === 'cold_4bet') expect(lever?.text ?? '', where).not.toMatch(/포지션/);
      // rfi 레버는 오픈 폭 — SB 차트에 림프가 있으면 레이즈와 림프를 따로('SB는 할인 덕분에 레이즈 24%에 림프 38%를 섞어요.' — 책 5장 2절: 림프의 이유는 반값 할인).
      if (s.kind === 'rfi') expect(lever?.text, where).toMatch(rangeShare(getChartCells(s), 'limp') > 0 ? /^SB는 할인 덕분에 레이즈 \d+%에 림프 \d+%를 섞어요\.$/ : /오픈해요\.$/);
      if (s.kind === 'vs_open' && s.hero === 'BB') expect(lever?.id).toBe('bbPrice');
      if (s.kind === 'vs_limp') expect(lever?.id ?? null).toBe(s.hero === 'BB' ? 'bbFree' : null);
    }
    // BTN 오픈은 책의 약 43%(5장 2절)를 밝힙니다(감사 19). 차트가 책과 같은 43%라 같은 숫자를 두 번 쓰지 않아요
    // (예전 차트 46%: '책의 약 43%보다 넓은 46%를', 같을 때의 옛 문장: '책의 약 43%와 같은 43%를').
    expect(Math.round(rangeShare(getChartCells({ kind: 'rfi', hero: 'BTN' }), 'raise') * 100)).toBe(43);
    expect(seatLever({ kind: 'rfi', hero: 'BTN' })?.text).toBe('BTN은 블라인드만 남아 책과 같은 약 43%를 오픈해요.');
    // SB 오픈은 레이즈와 림프를 따로 — 책 5장 2절: 레이즈 약 24% · 림프 약 38%(감사 7: 'BTN만큼 연다'는 림프가 없던 차트의 말).
    expect(seatLever({ kind: 'rfi', hero: 'SB' })?.text).toBe('SB는 할인 덕분에 레이즈 24%에 림프 38%를 섞어요.');
    // SB 는 오픈에 콜하지 않아요(책 5장 5절 — 네 오프너 모두 콜 0).
    for (const v of ['UTG', 'HJ', 'CO', 'BTN'] as Pos[]) {
      expect(rangeShare(getChartCells({ kind: 'vs_open', hero: 'SB', villain: v }), 'call'), v).toBe(0);
      expect(seatLever({ kind: 'vs_open', hero: 'SB', villain: v })?.text, v).toBe('SB는 콜 없이 3벳 아니면 폴드해요.');
    }
    // HJ · CO · BTN 의 오픈 대응: 포지션만 말하면 콜의 이유처럼 읽혀서, 책이 드는 스퀴즈 위험을 같이(감사 18).
    // HJ · CO 는 콜이 0 이라(책 5장 4·5절: 콜 없이 3벳 아니면 폴드) 그 말 그대로, 콜을 섞는 BTN 은 스퀴즈 위험을.
    for (const s of SCENARIOS.filter((x) => x.kind === 'vs_open' && ['HJ', 'CO', 'BTN'].includes(x.hero))) {
      const noCall = s.hero !== 'BTN';
      expect(rangeShare(getChartCells(s), 'call') === 0, scenarioKey(s)).toBe(noCall);
      const text = noCall ? `${s.hero}는 콜 없이 3벳 아니면 폴드해요.` : 'BTN은 포지션이 있어도 콜하면 뒤에서 스퀴즈를 받기 쉬워요.';
      expect(seatLever(s)).toEqual({ id: 'behind', text });
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
    // 세 액션 자리는 새 차트에서 ATo 의 BTN 두 칸(SB · BB 3벳에 콜 50 · 4벳 25 · 폴드 25)뿐이에요. 그 칸이 보이는 자리 문장은
    // SB 3벳 열의 도달 자리 4개(UTG~BTN)와 BB 3벳 열의 5개(UTG~SB)에서 하나씩 — 9번 모두 '절반은'으로 불러요(예전 차트는 20번 넘게).
    expect(split).toBe(9);
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
    // 새 차트에서 다시 고른 예(같은 꼴): SB 는 오픈에 콜하지 않아서(책 5장 5절) 'UTG 오픈에 SB에서만 폴드'하는 꼴은 오픈 대응에서 사라졌어요.
    // 'KTs는 UTG 오픈에 BTN·BB에서만 콜해요.'(다른 자리가 전부 폴드)와, 3벳 대응의 'UTG에서만 폴드하고, 다른 자리에서는 콜해요.'
    expect(across({ kind: 'vs_open', hero: 'SB', villain: 'UTG' }, 'KTs')).toBe('KTs는 UTG 오픈에 BTN·BB에서만 콜해요.');
    expect(across({ kind: 'vs_3bet', hero: 'UTG', villain: 'SB' }, 'KTs')).toBe('KTs는 SB 3벳에 UTG에서만 폴드하고, 다른 자리에서는 콜해요.');
    expect(across({ kind: 'vs_open', hero: 'BB', villain: 'CO' }, 'KTs')).toBe('KTs는 CO 오픈에 SB에서만 3벳하고, 다른 자리에서는 콜해요.');
    // 림프에: SB 는 약 24%만 레이즈해서 98s 는 이제 SB 에서 폴드해요 — J9s 가 HJ~SB 모두 레이즈하는 예.
    expect(across({ kind: 'vs_limp', hero: 'BB' }, 'J9s')).toBe('J9s는 림프에 HJ~SB에서 레이즈하고, BB에서는 체크해요.');
    // 열에 도달 칸이 아닌 자리(BB 는 UTG 오픈에 AJo 를 주로 콜하고 3벳은 25%만 — 4벳은 그때만 받아요)가 있으면 '어느 자리에서나' 대신 자리 이름.
    expect(across({ kind: 'vs_4bet', hero: 'HJ', villain: 'UTG' }, 'AJo')).toBe('AJo는 UTG 4벳에 HJ~SB에서 폴드해요.');
    expect(across({ kind: 'vs_3bet', hero: 'BTN', villain: 'BB' }, 'K8s')).toBe('K8s는 BB 3벳에 BTN에서는 주로 콜하고, HJ·CO·SB에서는 폴드해요.');
    // (b) 세 액션 자리 — 새 차트의 세 액션 칸은 ATo 의 BTN(블라인드 3벳에 콜 50 · 4벳 25 · 폴드 25) 두 칸뿐이에요.
    expect(across({ kind: 'vs_3bet', hero: 'BTN', villain: 'SB' }, 'ATo')).toBe('ATo는 SB 3벳에 UTG~CO에서 폴드, BTN에서 절반은 콜, 절반은 4벳·폴드예요.');
    expect(across({ kind: 'vs_3bet', hero: 'BTN', villain: 'BB' }, 'ATo')).toBe('ATo는 BB 3벳에 UTG~CO·SB에서 폴드, BTN에서 절반은 콜, 절반은 4벳·폴드예요.');
  });

  it('리뷰가 짚은 자리 문장', () => {
    const across = (sc: Scenario, hand: string) => explainStep(stepFor(sc, hand)).across.line.text;
    // 새 차트에서 같은 꼴을 가진 칸으로 다시 골랐어요(A7s · AKs · AQo · 72o · AKo 는 차트가 바뀌어 다른 꼴이 됐어요).
    expect(across({ kind: 'vs_open', hero: 'SB', villain: 'CO' }, '66')).toBe('66은 CO 오픈에 SB에서는 절반만 3벳하고, 다른 자리에서는 콜해요.');
    expect(across({ kind: 'vs_4bet', hero: 'HJ', villain: 'UTG' }, 'AKo')).toBe('AKo는 UTG 4벳에 HJ·CO·SB·BB에서 주로 올인하고, BTN에서는 올인과 콜을 반반 섞어요.');
    expect(across({ kind: 'vs_open', hero: 'BTN', villain: 'CO' }, 'KJs')).toBe('KJs는 CO 오픈에 BTN·BB에서 3벳과 콜을 반반 섞고, SB에서는 3벳해요.');
    // 72o 는 이제 BB 가 SB 의 림프에 블러프로 레이즈해요(양극화 — BOOK_CHART_SPEC §5) — 어느 자리도 레이즈하지 않는 예는 J3s.
    expect(across({ kind: 'vs_limp', hero: 'HJ' }, '72o')).toBe('72o는 림프에 BB에서만 레이즈해요.');
    expect(across({ kind: 'vs_limp', hero: 'HJ' }, 'J3s')).toBe('J3s는 림프에 어느 자리에서도 레이즈하지 않아요.');
    // 콜드 상황의 앞머리는 '오픈과 3벳 뒤에'(책 5장 3절 — 앞의 오픈까지). 콜드 4벳은 이제 4벳 아니면 폴드라(책 5장 3절) 세 액션 칸이 없어요 —
    // 섞인 자리(BTN 4벳 50 · 폴드 50)는 비중어와 함께 불러요.
    expect(across({ kind: 'cold_4bet', hero: 'CO' }, 'TT')).toBe('TT은 오픈과 3벳 뒤에 CO에서 폴드, BTN에서 절반만 4벳, SB·BB에서 4벳이에요.');
  });

  it('부분 정답 문장: 두 액션의 가치가 비슷하다는 것(책 2장 무차별)을 먼저, 채점은 그다음 — "더 공격적인"은 두 계속 액션의 반반에만', () => {
    const actionLabelOf = (a: string, s: Scenario) => (a === 'raise' ? (s.kind === 'vs_limp' ? '레이즈' : '오픈') : ({ call: '콜', threebet: '3벳', fourbet: '4벳', allin: '올인', fold: '폴드', check: '체크', limp: '림프' } as Record<string, string>)[a]);
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
    // 두 계속 액션의 반반: CO 가 BTN 3벳에 AQs 를 4벳 50 · 콜 50(예전 예의 콜드 4벳 QQ 는 이제 늘 4벳 — 콜드 4벳에 콜이 없어요).
    expect(explainStep(stepFor({ kind: 'vs_3bet', hero: 'CO', villain: 'BTN' }, 'AQs')).mix!.partial).toBe('4벳과 콜은 가치가 비슷해요. 채점은 더 공격적인 4벳이 정답이에요.');
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
