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
    expect(glossSentence('블로커')).toBe('블로커는 내가 그 카드를 들어 상대 조합이 줄어드는 효과예요.');
    expect(glossSentence('셋마이닝')).toBe('셋마이닝은 셋을 노리고 콜하는 것이에요.');
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

  it('647개 전부 BANNED 에 걸리지 않는다', () => {
    expect(NOTES.length).toBe(647);
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

  it('§4.3 시트의 메모 7개가 정리본과 글자까지 같다', () => {
    const memo = (s: Scenario, hand: string) => explainStep(stepFor(s, hand)).more.memo;
    expect(memo({ kind: 'rfi', hero: 'UTG' }, 'KJo')).toBe('KJo는 절반만 오픈해요. AK·KQ에 도미네이트(같은 카드를 맞춰도 킥커에서 지는 상태)당하기 쉬워요. 내 K♠J♦ vs 상대 A♠K♦ → K가 깔려도 킥커에서 져요.');
    expect(memo({ kind: 'vs_3bet', hero: 'CO', villain: 'BTN' }, 'A5s')).toBe('4벳 블러프로 늘 써요. A4s도 같아요. 내 A가 상대의 AA·AK 조합을 줄여 줘요.');
    expect(memo({ kind: 'vs_4bet', hero: 'HJ', villain: 'UTG' }, 'QQ')).toBe('콜 75%, 올인 25%예요. 콜을 받으면 AA·KK에 크게 밀려요. 내 Q♠Q♦ vs 상대 A♦K♠ → 승률 57%.');
    expect(memo({ kind: 'vs_5bet', hero: 'CO', villain: 'BTN' }, 'QQ')).toBe('4번 중 3번은 콜해요. 상대 AK·JJ가 섞여 승률 40%를 살짝 넘겨요. 예: 내 Q♠Q♦ vs 상대 A♠K♦ → 승률 57%.');
    expect(memo({ kind: 'cold_4bet', hero: 'CO' }, 'QQ')).toBe('QQ는 절반은 4벳, 절반은 콜이에요. 4벳 뒤 올인을 받으면 KK·AA가 많아 폴드해요. 콜하면 뒤의 3명에게 스퀴즈(오픈과 콜 뒤에 크게 올리는 것)를 맞을 수 있어요.');
    expect(memo({ kind: 'vs_limp', hero: 'BB' }, '55')).toBe('55는 체크예요. 다른 자리에서는 올리는 패인데, BB에서는 공짜로 플랍을 보고 셋이 되면 그때 키우는 게 나아요.');
    expect(memo({ kind: 'vs_open', hero: 'SB', villain: 'UTG' }, 'QJs')).toBe('QJs는 25%만 3벳 블러프예요. JTs와 함께 조금씩 섞어 여러 보드에 대비해요.');
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
    expect(seatLever({ kind: 'rfi', hero: 'BTN' })?.text).toBe('BTN은 뒤에 블라인드 둘만 남아 46%를 오픈해요.');
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

  it('섞인 자리(비중 ≤ 0.5)는 그 자리 이름 뒤에 비중어가 오거나, "나머지 자리에서는 · 어느 자리에서나 〈비중어〉"에 든다 · "나머지는" 꼴은 없다', () => {
    let weak = 0;
    for (const { s, hand, e } of EXPLAINED) {
      if (s.kind === 'rfi') continue; // rfi 는 rfiThesis(atlas.test 가 따로 봅니다)
      const text = e.across.line.text;
      const where = `${scenarioKey(s)} ${hand}: ${text}`;
      expect(text, where).not.toMatch(/나머지는/);
      const ms = mentions(text);
      for (const c of e.across.cells.filter((x) => x.reachable)) {
        const w = WORD(c.mixList, c.scenario.kind === 'vs_limp' && c.scenario.hero === 'BB' ? 'check' : 'fold');
        if (!w) continue;
        weak++;
        const m = ms.find((x) => x.seats.includes(c.scenario.hero));
        if (m) expect(m.tail.includes(w), `${where} ← ${c.scenario.hero} ${w}`).toBe(true);
        else expect(text, `${where} ← ${c.scenario.hero} ${w}`).toMatch(new RegExp(`(나머지 자리에서는|어느 자리에서나) ${w === '반반' ? '\\S+ \\S+ 반반' : w}`));
      }
    }
    expect(weak).toBeGreaterThan(100);
  });

  it('리뷰가 짚은 자리 문장', () => {
    const across = (sc: Scenario, hand: string) => explainStep(stepFor(sc, hand)).across.line.text;
    expect(across({ kind: 'vs_open', hero: 'SB', villain: 'CO' }, 'A7s')).toBe('A7s는 CO 오픈에 SB에서는 절반만 3벳하고, 나머지 자리에서는 콜해요.');
    expect(across({ kind: 'vs_4bet', hero: 'HJ', villain: 'UTG' }, 'AKs')).toBe('AKs는 UTG 4벳에 HJ~BTN에서 주로 올인하고, SB·BB에서는 올인과 콜을 반반 섞어요.');
    expect(across({ kind: 'vs_open', hero: 'HJ', villain: 'UTG' }, 'AQo')).toBe('AQo는 UTG 오픈에 HJ~BTN·BB에서 3벳과 콜을 반반 섞고, SB에서는 3벳해요.');
    expect(across({ kind: 'vs_limp', hero: 'HJ' }, '72o')).toBe('72o는 림프에 어느 자리에서도 레이즈하지 않아요.');
    expect(across({ kind: 'cold_4bet', hero: 'CO' }, 'AKo')).toBe('AKo는 앞에서 3벳이 나오면 CO에서는 절반은 폴드하고, 나머지 자리에서는 절반만 4벳해요.');
  });

  it('부분 정답 문장: 계속 · rest 반반은 "이 칸은 …", 두 계속 액션 반반만 "반반이라 더 공격적인 …"', () => {
    let restTie = 0;
    let contTie = 0;
    for (const { e } of EXPLAINED) {
      const p = e.mix?.partial;
      if (!p) continue;
      if (p.startsWith('이 칸은')) restTie++;
      else if (p.startsWith('반반이라')) {
        contTie++;
        expect(p).not.toMatch(/(폴드|체크)도 부분 정답/);
      }
    }
    expect(restTie).toBeGreaterThan(100);
    expect(contTie).toBeGreaterThan(50);
    expect(explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'KJo')).mix!.partial).toBe('이 칸은 오픈을 정답으로 쳐요. 폴드도 부분 정답이에요.');
    expect(explainStep(stepFor({ kind: 'cold_4bet', hero: 'CO' }, 'QQ')).mix!.partial).toBe('반반이라 더 공격적인 4벳을 정답으로 쳐요. 콜도 부분 정답이에요.');
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
