import { describe, expect, it } from 'vitest';
import {
  anchorCell,
  atlasQuizKeys,
  compareCells,
  CORE_SEATS,
  differingLevers,
  entrySeat,
  gateText,
  handAtlas,
  isReachable,
  nearestCellWithAction,
  newcomersAt,
  rfiProfile,
  rfiThesis,
  seatLevers,
  sectionDigest,
  sectionDigestDetail,
  uniformLine,
  type AtlasCell,
  type AtlasSection,
  type HandAtlas,
  type Line,
  type WeightClass,
} from '../src/poker/atlas';
import { getChartCells, hasChart } from '../src/poker/data';
import { heroIsIP, seatsBehind } from '../src/poker/explain';
import { acrossRow } from '../src/poker/sheet';
import { ALL_HANDS, seedRandom } from '../src/poker/hands';
import { priceFacts } from '../src/poker/priceFacts';
import { fullMix, primaryAction, rangeShare } from '../src/poker/range';
import { allScenarios, scenarioKey } from '../src/poker/scenarios';
import { cardKeyOf, stepForKey } from '../src/state/srs';
import { buildSteps, DEFAULT_SESSION_OPTIONS, nextHandSequence } from '../src/poker/trainer';
import { POSITIONS, SCENARIO_KINDS, type Action, type HandName, type Pos, type Scenario, type ScenarioKind } from '../src/poker/types';

/*
 * 자리별 보기(HandAtlas) 엔진 — docs/ATLAS_SPEC.md §7 테스트 1~10.
 * 핵심은 5번(속성 테스트): 아틀라스가 만든 모든 문장의 claim 과 숫자를 **차트에서 다시 유도**해 대조합니다.
 * 이 파일의 재유도 코드는 atlas.ts 의 내부를 쓰지 않고 range.ts/data 만 씁니다 — 같은 버그를 두 번 쓰지 않으려고요.
 */

const pctInt = (x: number) => Math.round(x * 100);

/** §5.1 W 를 독립적으로 다시 씁니다. */
function weightClassOf(hand: HandName, s: Scenario): WeightClass {
  const list = fullMix(getChartCells(s)[hand]);
  const p = list[0]?.weight ?? 1;
  if (p >= 0.999) return 'always';
  const p2 = list[1]?.weight;
  if (p2 !== undefined && (Math.abs(p - p2) < 0.01 || p <= 0.5)) return 'half';
  if (p > 0.5) return 'most';
  return 'some';
}
const primaryOf = (hand: HandName, s: Scenario): Action => primaryAction(getChartCells(s)[hand]);

const shareMemo = new Map<string, number>();
function share(s: Scenario, action: Action): number {
  const k = `${scenarioKey(s)}|${action}`;
  let v = shareMemo.get(k);
  if (v === undefined) {
    v = pctInt(rangeShare(getChartCells(s), action));
    shareMemo.set(k, v);
  }
  return v;
}

const ACT_OF_WORD: Record<string, Action[]> = {
  폴드: ['fold'],
  콜: ['call'],
  오픈: ['raise'],
  레이즈: ['raise'],
  '3벳': ['threebet'],
  '4벳': ['fourbet'],
  올인: ['allin'],
  체크: ['check'],
};
const KIND_OF_WORD: Record<string, ScenarioKind> = { 오픈: 'vs_open', '3벳': 'vs_3bet', '4벳': 'vs_4bet', 올인: 'vs_5bet' };

const cellOf = (atlas: HandAtlas, kind: ScenarioKind, hero: Pos, villain?: Pos): AtlasCell => {
  const c = atlas.sections[kind].cells.find((x) => x.scenario.hero === hero && x.scenario.villain === villain);
  if (!c) throw new Error(`no cell ${kind} ${hero} ${villain ?? ''}`);
  return c;
};

/** 한 축 쌍 전부: 스트립은 모든 쌍, 삼각형은 같은 행 또는 같은 열. */
function axisPairs(sec: AtlasSection): Array<[AtlasCell, AtlasCell]> {
  const out: Array<[AtlasCell, AtlasCell]> = [];
  const cells = sec.cells;
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i].scenario;
      const b = cells[j].scenario;
      if (sec.layout === 'strip' || a.hero === b.hero || a.villain === b.villain) out.push([cells[i], cells[j]]);
    }
  }
  return out;
}

type Origin = 'thesis' | 'digest' | 'compare' | 'uniform' | 'across';
interface Tagged {
  line: Line;
  origin: Origin;
  hero?: Pos;
  kind?: ScenarioKind;
}

/** acrossRow 가 쓰는 열: 스트립은 하나, 삼각형은 상대(villain)마다 하나. 열의 아무 칸이나 대표로 부릅니다. */
const ACROSS_COLUMNS: Scenario[] = (() => {
  const seen = new Set<string>();
  const out: Scenario[] = [];
  for (const s of allScenarios().filter(hasChart)) {
    const k = `${s.kind}|${s.villain ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: s.kind, hero: s.hero, villain: s.villain });
  }
  return out;
})();

function allLines(atlas: HandAtlas): Tagged[] {
  const out: Tagged[] = [];
  for (const line of rfiThesis(atlas)) out.push({ line, origin: 'thesis' });
  // 해설 시트 ⑥의 자리 문장(sheet.acrossRow). rfi 는 rfiThesis 첫 줄 그대로라 thesis 로 이미 들어 있습니다.
  for (const s of ACROSS_COLUMNS) {
    if (s.kind === 'rfi') continue;
    const row = acrossRow(s, atlas.hand);
    if (row.cells.some((c) => c.reachable)) out.push({ line: row.line, origin: 'across', kind: s.kind });
  }
  for (const kind of SCENARIO_KINDS) {
    const sec = atlas.sections[kind];
    out.push({ line: sectionDigest(sec), origin: 'digest' });
    const detail = sectionDigestDetail(sec);
    if (detail) out.push({ line: detail, origin: 'digest' });
    const uni = uniformLine(sec);
    if (uni) out.push({ line: uni, origin: 'uniform', kind });
  }
  for (const kind of SCENARIO_KINDS) {
    for (const [a, b] of axisPairs(atlas.sections[kind])) for (const line of compareCells(a, b)) out.push({ line, origin: 'compare' });
  }
  return out;
}

const sentences = (text: string) => text.split(/(?<=[.?])\s+/).filter((x) => x.trim());

/**
 * 숫자 없는 고정 레버 문장 — docs/EXPLAIN_SPEC.md §5.4 표의 '바꾼 뒤' 열 그대로. 상수(constant) 레버는 이 안에 있어야 합니다.
 * (예전에는 explainStep 의 왜? 불릿 집합과 대조했는데, 그 불릿은 해설 재설계로 사라졌습니다.)
 */
const LEVER_CONSTANTS = new Set<string>([
  '포지션이 있어요.',
  '포지션이 없어요.',
  'SB는 콜하면 BB에게 스퀴즈당하기 쉬워요.',
  '그래서 3벳 아니면 폴드예요.',
  'BB는 이미 1bb를 냈으니 체크하면 공짜로 플랍을 봐요.',
  '앞자리 오픈은 강한 패 위주예요.',
  '뒷자리 오픈엔 약한 패도 많이 섞여 있어요.',
  'SB는 뒤에 BB 한 명뿐이라 따로 외워요.',
  ...(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as Pos[]).flatMap((v) => [`${v} 3벳엔 블러프도 섞여 있어요.`, `${v} 3벳은 밸류 위주예요.`]),
]);

/* ------------------------------------------------------------------ */

describe('atlas: 74 cells', () => {
  it('handAtlas: 74 cells per hand, keys equal srs.cardKeyOf', () => {
    const expected: Record<ScenarioKind, number> = { rfi: 5, vs_open: 15, vs_3bet: 15, vs_4bet: 15, vs_5bet: 15, cold_4bet: 4, vs_limp: 5 };
    for (const hand of ALL_HANDS) {
      const atlas = handAtlas(hand);
      let total = 0;
      for (const kind of SCENARIO_KINDS) {
        const sec = atlas.sections[kind];
        expect(sec.cells.length, `${hand} ${kind}`).toBe(expected[kind]);
        total += sec.cells.length;
        for (const c of sec.cells) {
          expect(c.key).toBe(cardKeyOf(c.scenario, hand));
          expect(c.scenario.extras).toBeUndefined();
          expect(c.primary).toBe(primaryOf(hand, c.scenario));
          expect(c.evidence).toBe(kind === 'vs_limp' ? 'human' : 'solver');
        }
      }
      expect(total).toBe(74);
      expect(handAtlas(hand)).toBe(atlas); // memo
    }
  });

  it('isReachable mirrors buildSteps', () => {
    const opts = { ...DEFAULT_SESSION_OPTIONS, kinds: [...SCENARIO_KINDS] };
    seedRandom(7);
    for (let i = 0; i < 2000; i++) {
      const seq = nextHandSequence(opts);
      for (const step of seq.steps) expect(isReachable(step.scenario, seq.hand).ok, `${scenarioKey(step.scenario)} ${seq.hand}`).toBe(true);
    }
    // 역방향: 상수 rng 로 villain 선택을 전부 훑어 buildSteps 가 내는 kind:villain 집합 = reachable 집합.
    for (const hero of POSITIONS) {
      for (const hand of ALL_HANDS) {
        const built = new Set<string>();
        for (const v of [0.1, 0.3, 0.5, 0.7, 0.9]) {
          for (const step of buildSteps(hero, hand, opts, () => v)) built.add(scenarioKey(step.scenario));
        }
        const reachable = new Set<string>();
        for (const kind of SCENARIO_KINDS) {
          for (const c of handAtlas(hand).sections[kind].cells) if (c.scenario.hero === hero && c.reachable) reachable.add(scenarioKey(c.scenario));
        }
        expect([...built].sort(), `${hero} ${hand}`).toEqual([...reachable].sort());
      }
    }
  });

  it('rfiProfile patterns', () => {
    const counts: Record<string, number> = {};
    for (const hand of ALL_HANDS) {
      const p = rfiProfile(hand).pattern;
      counts[p] = (counts[p] ?? 0) + 1;
    }
    // 스펙 §7 의 스냅샷(45·41·12)은 합이 174라 자체 모순이었습니다 — 실측값으로 고정합니다(합 169).
    expect(counts).toEqual({ always: 42, entry: 43, half: 8, partial: 4, sbOnly: 1, never: 71 });
    expect(ALL_HANDS.filter((h) => rfiProfile(h).sbDiffers)).toEqual(['J4s', 'K6o']);
    expect(ALL_HANDS.filter((h) => rfiProfile(h).firstAlways === null && rfiProfile(h).firstAny !== null)).toEqual(['Q8o', 'J8o', 'T8o', '98o']);
    expect(rfiProfile('K6o').pattern).toBe('sbOnly');
    expect(rfiProfile('KJo')).toMatchObject({ pattern: 'half', firstAny: 'UTG', firstAlways: 'HJ' });
    expect(rfiProfile('Q9o')).toMatchObject({ pattern: 'entry', firstAny: 'BTN', firstAlways: 'BTN' });
    for (const hand of ALL_HANDS) {
      const p = rfiProfile(hand);
      expect(p.seats.map((s) => s.pos)).toEqual(['UTG', 'HJ', 'CO', 'BTN', 'SB']);
      for (const s of p.seats) {
        expect(s.behind).toBe(seatsBehind(s.pos));
        expect(s.share).toBe(share({ kind: 'rfi', hero: s.pos }, 'raise'));
        expect(s.primary).toBe(primaryOf(hand, { kind: 'rfi', hero: s.pos }));
      }
    }
    expect(entrySeat('K6o')).toBe('SB');
    expect(entrySeat('72o')).toBeNull();
    expect(entrySeat('Q9o')).toBe('BTN');
  });

  it('newcomersAt partitions the openers', () => {
    const sets = CORE_SEATS.map((seat) => newcomersAt(seat));
    const union = new Set<string>();
    for (const set of sets) {
      for (const h of set) {
        expect(union.has(h), h).toBe(false);
        union.add(h);
      }
    }
    expect([...union].sort()).toEqual(ALL_HANDS.filter((h) => rfiProfile(h).firstAny !== null).sort());
    expect(newcomersAt('HJ')).toEqual(['K8s', 'K7s', 'QJo', 'KTo', 'T8s', '97s', '54s']);
    // prefer: 같은 줄 → 같은 클래스 → 그리드 순. prefer 자신은 빠집니다.
    expect(newcomersAt('HJ', 'KJo')).toEqual(['KTo', 'QJo', 'K8s', 'K7s', 'T8s', '97s', '54s']);
    expect(newcomersAt('UTG', 'KJo')).not.toContain('KJo');
  });
});

/* ------------------------------------------------------------------ */

describe('atlas: sentences re-derive from the charts (§5.5)', () => {
  // '…에서는 콜도 50% 섞어요'의 '콜도'는 1순위가 아니라 섞는 쪽이라 뺍니다(그 숫자는 (c)가 따로 대조합니다).
  const RE_HERO = /(UTG|HJ|CO|BTN|SB|BB)(에서는|에서|부터|만) ?(절반만 |절반은 |주로 )?(폴드|콜|오픈|레이즈|3벳|4벳|올인|체크)(?!도)/g;
  const RE_VILLAIN = /(UTG|HJ|CO|BTN|SB) (오픈|3벳|4벳|올인)에는 (절반만 |절반은 |주로 )?(폴드|콜|오픈|레이즈|3벳|4벳|올인)/g;
  // half 패턴 thesis 는 자리와 액션이 떨어져 있습니다("UTG에서 절반만, HJ부터 항상 오픈합니다") — 위 두 정규식이
  // 하나도 못 뽑아서, 자리를 잘못 적은 thesis 가 claims 만 맞으면 통과했습니다. 그 꼴을 따로 뽑습니다.
  const RE_HALF_SEAT = /(UTG|HJ|CO|BTN|SB|BB)에서 (절반만|주로|\d+%만)(?=,| 오픈)/g;
  const RE_ALWAYS_FROM = /(UTG|HJ|CO|BTN)부터는 항상 오픈/g;
  // 자리 문장(S-a)의 '…에서 항상 4벳해요' — 그 자리 칸은 100%여야 합니다.
  const RE_ALWAYS_AT = /(UTG|HJ|CO|BTN|SB|BB)에서 항상/g;
  const RE_NUM = /\d+(?=%|명|곳|문제|종)/g;
  const RE_PRICE = /\d+(?:\.\d+)?bb/g;

  /** 이 줄의 claims 로부터 문장에 올 수 있는 숫자 전부 — share / tb / behind / count / 혼합 비중. */
  function allowedNums(hand: HandName, line: Line): Set<number> {
    const out = new Set<number>();
    const acts = new Map<Action, number>();
    let half = 0;
    let mixed = 0;
    for (const c of line.claims) {
      const s = c.scenario;
      out.add(seatsBehind(s.hero));
      if (s.hero !== 'BB') out.add(share({ kind: 'rfi', hero: s.hero }, 'raise'));
      if (s.villain) {
        if (s.villain !== 'BB') out.add(share({ kind: 'rfi', hero: s.villain }, 'raise'));
        if (s.kind === 'vs_3bet' || s.kind === 'vs_5bet') out.add(share({ kind: 'vs_open', hero: s.villain, villain: s.hero }, 'threebet'));
      }
      for (const m of fullMix(getChartCells(s)[hand])) out.add(pctInt(m.weight));
      acts.set(c.action, (acts.get(c.action) ?? 0) + 1);
      const w = weightClassOf(hand, s);
      if (w === 'half') half++;
      if (w !== 'always') mixed++;
    }
    out.add(line.claims.length);
    for (const n of acts.values()) out.add(n);
    out.add(half);
    out.add(mixed);
    return out;
  }

  it('claims re-derive from the charts', () => {
    let lines = 0;
    for (const hand of ALL_HANDS) {
      const atlas = handAtlas(hand);
      const { pattern } = atlas.rfi;
      for (const { line, origin, kind } of allLines(atlas)) {
        lines++;
        const where = `${hand} [${origin}] ${line.text}`;
        // (a) 모든 claim 은 primary / weightClass 재계산과 같다
        for (const c of line.claims) {
          expect(c.action, where).toBe(primaryOf(hand, c.scenario));
          expect(c.weight, where).toBe(weightClassOf(hand, c.scenario));
        }
        // (b) 텍스트에서 뽑은 자리+액션 쌍은 전부 claims 로 설명된다
        for (const m of line.text.matchAll(RE_HERO)) {
          const [, seat, , w, act] = m;
          const ok = line.claims.some(
            (c) =>
              c.scenario.hero === seat &&
              ACT_OF_WORD[act].includes(c.action) &&
              (w === '절반만 ' || w === '절반은 ' ? c.weight === 'half' : w === '주로 ' ? c.weight === 'most' : true),
          );
          expect(ok, `${where} ← ${m[0]}`).toBe(true);
        }
        for (const m of line.text.matchAll(RE_HALF_SEAT)) {
          const [, seat, w] = m;
          const want = w === '절반만' ? 'half' : w === '주로' ? 'most' : 'some';
          const ok = line.claims.some((c) => c.scenario.hero === seat && c.weight === want && (c.scenario.kind !== 'rfi' || c.action === 'raise'));
          expect(ok, `${where} ← ${m[0]}`).toBe(true);
        }
        for (const m of line.text.matchAll(RE_ALWAYS_AT)) {
          const ok = line.claims.some((c) => c.scenario.hero === m[1] && c.weight === 'always');
          expect(ok, `${where} ← ${m[0]}`).toBe(true);
        }
        for (const m of line.text.matchAll(RE_ALWAYS_FROM)) {
          const ok = line.claims.some((c) => c.scenario.kind === 'rfi' && c.scenario.hero === m[1] && c.action === 'raise' && c.weight === 'always');
          expect(ok, `${where} ← ${m[0]}`).toBe(true);
        }
        for (const m of line.text.matchAll(RE_VILLAIN)) {
          const [, villain, kindWord, w, act] = m;
          const ok = line.claims.some(
            (c) =>
              c.scenario.villain === villain &&
              c.scenario.kind === KIND_OF_WORD[kindWord] &&
              ACT_OF_WORD[act].includes(c.action) &&
              (w === '절반만 ' || w === '절반은 ' ? c.weight === 'half' : w === '주로 ' ? c.weight === 'most' : true),
          );
          expect(ok, `${where} ← ${m[0]}`).toBe(true);
        }
        // (c) 텍스트의 모든 숫자는 nums 에 있고, nums 는 공식 값과 같다
        const allowed = allowedNums(hand, line);
        for (const m of line.text.match(RE_NUM) ?? []) expect(line.nums, `${where} ← ${m}`).toContain(Number(m));
        for (const n of line.nums) expect(allowed.has(n), `${where} ← nums ${n}`).toBe(true);
        for (const m of line.text.match(RE_PRICE) ?? []) {
          if (m === '1bb') continue; // 이미 낸 블라인드
          const ok = line.claims.some((c) => {
            const p = priceFacts(c.scenario);
            return p?.toCall === m;
          });
          expect(ok, `${where} ← ${m}`).toBe(true);
        }
        // (d) '부터' · '어디서든' · '까지'
        if (line.text.includes('부터')) {
          if (origin === 'thesis') expect(['entry', 'half'], where).toContain(pattern);
          else expect.fail(`'부터' outside thesis: ${where}`);
        }
        if (/어디서나|어느 자리에서/.test(line.text)) {
          if (origin === 'uniform') {
            // 섹션의 reachable 칸이 전부 같은 1순위일 때만 나오는 문장입니다.
            const prims = new Set(atlas.sections[kind!].cells.filter((c) => c.reachable).map((c) => primaryOf(hand, c.scenario)));
            expect(prims.size, where).toBe(1);
            continue;
          }
          if (origin === 'across') {
            // 자리 문장 S-a: 그 열의 도달 칸이 전부 같은 1순위(이고 두 자리 이상)일 때만.
            const prims = new Set(line.claims.map((c) => primaryOf(hand, c.scenario)));
            expect(prims.size, where).toBe(1);
            expect(line.claims.length, where).toBeGreaterThanOrEqual(2);
            continue;
          }
          expect(origin, where).toBe('thesis');
          if (line.text.includes('어느 자리에서')) {
            const prims = new Set(atlas.sections.rfi.cells.map((c) => primaryOf(hand, c.scenario)));
            expect(prims.size, where).toBe(1);
          }
          if (line.text.includes('어디서나')) {
            const prims = new Set(atlas.sections.vs_open.cells.filter((c) => c.reachable).map((c) => primaryOf(hand, c.scenario)));
            expect(prims.size, where).toBe(1);
          }
        }
        // 줄 경계('…까지')는 이제 line.ts 의 lineSentence 가 말합니다(tests/line.test.ts) — atlas 문장에는 없습니다.
        expect(line.text.includes('까지'), where).toBe(false);
        // (e) 상수 문장은 §5.4 표의 문장
        if (line.source === 'constant') {
          for (const sentence of sentences(line.text)) expect(LEVER_CONSTANTS.has(sentence), `${where} ← ${sentence}`).toBe(true);
        }
      }
    }
    expect(lines).toBeGreaterThan(169 * 180);
  });

  it('seatLevers constants are the §5.4 strings; numbers are the chart formulas', () => {
    for (const s of allScenarios().filter(hasChart)) {
      const atlasScenario: Scenario = { kind: s.kind, hero: s.hero, villain: s.villain };
      for (const lever of seatLevers(atlasScenario)) {
        const where = `${scenarioKey(s)} ${lever.id}: ${lever.text}`;
        if (lever.constant) for (const sentence of sentences(lever.text)) expect(LEVER_CONSTANTS.has(sentence), where).toBe(true);
        if (lever.id === 'behind') {
          expect(['SB', 'BB']).not.toContain(s.hero);
          expect(lever.nums).toEqual([seatsBehind(s.hero)]);
        }
        if (lever.id === 'openWidth') expect(lever.nums).toEqual([share({ kind: 'rfi', hero: s.villain ?? s.hero }, 'raise')]);
        if (lever.id === 'threebetWidth') expect(lever.nums).toEqual([share({ kind: 'vs_open', hero: s.villain!, villain: s.hero }, 'threebet')]);
        if (lever.id === 'position') expect(lever.text).toBe(heroIsIP(s) ? '포지션이 있어요.' : '포지션이 없어요.');
        if (lever.id === 'openWidth') expect(lever.text).toBe(`${s.villain ?? s.hero}${(s.villain ?? s.hero) === 'BTN' ? '은' : '는'} ${lever.nums[0]}%를 오픈해요.`);
        if (lever.id === 'threebetWidth') expect(lever.text).toBe(`${s.villain}${s.villain === 'BTN' ? '은' : '는'} ${lever.nums[0]}%를 3벳해요.`);
        if (lever.id === 'behind') expect(lever.text).toBe(`뒤에 ${lever.nums[0]}명이 남아 있어요.`);
        if (lever.id === 'bbPrice') {
          expect(lever.text).toBe(`BB는 이미 1bb를 냈으니 ${priceFacts(s)!.toCall}만 더 내면 돼요. ${s.villain === 'SB' ? 'SB 상대로는 포지션도 있어요.' : '마지막 차례라 제일 넓게 콜해요.'}`);
        }
        for (const m of lever.text.match(RE_PRICE) ?? []) {
          if (m === '1bb') continue;
          const p = priceFacts(s);
          expect(p?.toCall === m, where).toBe(true);
        }
      }
    }
  });

  it('compareCells null-equivalence', () => {
    const blind = (p?: Pos) => p === 'SB' || p === 'BB';
    const early = (p?: Pos) => p === 'UTG' || p === 'HJ';
    for (const hand of ALL_HANDS) {
      const atlas = handAtlas(hand);
      for (const kind of SCENARIO_KINDS) {
        for (const [a, b] of axisPairs(atlas.sections[kind])) {
          const lines = compareCells(a, b);
          if (!a.reachable || !b.reachable) {
            expect(lines).toEqual([]);
            continue;
          }
          const where = `${hand} ${a.key} vs ${b.key}`;
          const same = a.primary === b.primary;
          const halfContrast = same && [a.weightClass, b.weightClass].sort().join() === 'always,half';
          const head = lines[0].text;
          // "둘 다" ⇔ 같은 primary (단, 절반만↔항상 대비는 두 문장으로 말합니다)
          if (head.startsWith('둘 다')) expect(same && !halfContrast, where).toBe(true);
          else expect(!same || halfContrast, where).toBe(true);
          // 레버는 두 칸의 값이 다를 때만
          const sa = a.scenario;
          const sb = b.scenario;
          for (const lever of differingLevers(a, b)) {
            switch (lever.id) {
              case 'position':
                expect(heroIsIP(sa) !== heroIsIP(sb), where).toBe(true);
                break;
              case 'behind':
                expect(!blind(sa.hero) && !blind(sb.hero) && sa.hero !== sb.hero, where).toBe(true);
                expect(lever.nums).toEqual([seatsBehind(sa.hero), seatsBehind(sb.hero)].sort((x, y) => y - x));
                break;
              case 'openWidth': {
                const [x, y] = kind === 'rfi' ? [sa.hero, sb.hero] : [sa.villain!, sb.villain!];
                expect(Math.abs(share({ kind: 'rfi', hero: x }, 'raise') - share({ kind: 'rfi', hero: y }, 'raise')) >= 2, where).toBe(true);
                break;
              }
              case 'threebetWidth': {
                const ta = share({ kind: 'vs_open', hero: sa.villain!, villain: sa.hero }, 'threebet');
                const tb = share({ kind: 'vs_open', hero: sb.villain!, villain: sb.hero }, 'threebet');
                expect(Math.abs(ta - tb) >= 2, where).toBe(true);
                break;
              }
              case 'blind3bet':
                expect(blind(sa.villain) !== blind(sb.villain), where).toBe(true);
                break;
              case 'earlyOpener':
              case 'lateOpener':
                expect(early(sa.villain) !== early(sb.villain), where).toBe(true);
                break;
              case 'bbPrice':
              case 'sbRaiseOrFold':
              case 'bbFree':
                expect(sa.hero !== sb.hero && (blind(sa.hero) || blind(sb.hero)), where).toBe(true);
                break;
              default:
                expect.fail(`unexpected lever ${lever.id} in ${where}`);
            }
          }
          expect(differingLevers(a, b).length).toBeLessThanOrEqual(2);
        }
      }
    }
  });

  it('unreachable cells never surface', () => {
    for (const hand of ALL_HANDS) {
      const atlas = handAtlas(hand);
      const reachableKeys = new Set<string>();
      for (const kind of SCENARIO_KINDS) {
        const sec = atlas.sections[kind];
        for (const c of sec.cells) {
          expect(c.reachable).toBe(isReachable(c.scenario, hand).ok);
          if (c.reachable) reachableKeys.add(c.key);
          else expect(gateText(c), c.key).toBeTruthy();
        }
        for (const c of sectionDigest(sec).claims) expect(isReachable(c.scenario, hand).ok, `${hand} ${kind}`).toBe(true);
        for (const c of sec.cells) {
          const anchor = anchorCell(atlas, c);
          if (anchor) {
            expect(anchor.reachable, `${hand} anchor of ${c.key}`).toBe(true);
            expect(anchor.scenario.kind).toBe(kind);
          }
          if (!c.reachable) expect(anchor).toBeNull();
          for (const action of ['fold', 'call', 'raise', 'threebet', 'fourbet', 'allin', 'check'] as Action[]) {
            const near = nearestCellWithAction(c.scenario, hand, action);
            if (!near) continue;
            expect(near.kind).toBe(kind);
            expect(isReachable(near, hand).ok).toBe(true);
            expect(primaryOf(hand, near)).toBe(action);
            expect(near.hero === c.scenario.hero && near.villain === c.scenario.villain).toBe(false);
          }
        }
      }
      const keys = atlasQuizKeys(atlas);
      expect(keys.length).toBeLessThanOrEqual(12);
      expect(new Set(keys).size).toBe(keys.length);
      for (const k of keys) {
        expect(reachableKeys.has(k), `${hand} ${k}`).toBe(true);
        expect(k.startsWith('vs_limp:BB|')).toBe(false);
        expect(stepForKey(k)).not.toBeNull();
      }
      expect(atlasQuizKeys(atlas, { max: 3 }).length).toBeLessThanOrEqual(3);
    }
    // 섹션에 primary 가 한 가지뿐이고 전부 항상이면 그 섹션의 키는 안 나옵니다. 혼합 칸(KJo rfi:UTG)은 남습니다.
    const a5 = atlasQuizKeys(handAtlas('A5s'));
    expect(a5.some((k) => k.startsWith('vs_open:'))).toBe(false);
    expect(atlasQuizKeys(handAtlas('KJo'))[0]).toBe('rfi:UTG|KJo');
  });

  it('nearestCellWithAction', () => {
    expect(nearestCellWithAction({ kind: 'vs_open', hero: 'CO', villain: 'HJ' }, 'ATo', 'call')).toEqual({ kind: 'vs_open', hero: 'BTN', villain: 'HJ' });
    expect(nearestCellWithAction({ kind: 'rfi', hero: 'BTN' }, 'Q9o', 'fold')).toEqual({ kind: 'rfi', hero: 'CO' });
    expect(nearestCellWithAction({ kind: 'rfi', hero: 'UTG' }, 'KJo', 'fold')).toBeNull();
    // villain 축으로 넘어가는 경우: 같은 villain 쪽에 없으면 같은 hero 의 다른 상대.
    const kj = nearestCellWithAction({ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, 'KJo', 'call');
    expect(kj).toEqual({ kind: 'vs_open', hero: 'BB', villain: 'CO' });
  });
});

/* ------------------------------------------------------------------ */

describe('atlas: style lint (§5.4)', () => {
  // src/state/coach/lint.ts 의 BANNED_KO 와 같은 식('솔버'는 DISCLAIMER 전용이라 아틀라스 문장에는 못 옵니다).
  const BANNED_KO = /솔버|에퀴티|빈도|폴라|양극화|리니어|밸런스|콤보|노드|시뮬|레인지의?\s?\d/;
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  const hangulLen = (t: string) => (t.match(/[가-힣]/g) ?? []).length;

  it('style lint', () => {
    const check = (text: string, limit: number, where: string, endings: boolean) => {
      expect(text, where).not.toMatch(/!/);
      expect(text, where).not.toMatch(EMOJI);
      expect(text, where).not.toMatch(BANNED_KO);
      expect(text, where).not.toMatch(/니다|거든요|잖아요|답니다/);
      expect(text, where).not.toMatch(/[()]/);
      for (const s of sentences(text)) {
        // 글자 수는 한글 음절로 셉니다 — 'BB'·'1.5bb'·'18%' 같은 토큰은 읽는 부담이 아니라 숫자입니다.
        expect(hangulLen(s), `${where} ← ${s}`).toBeLessThanOrEqual(limit);
        // 해요체 한 가지(docs/EXPLAIN_SPEC.md §2.1): 문장은 '…요.'로 끝납니다.
        if (endings) expect(s, where).toMatch(/요[.?]$/);
        // 명사형 조각(digest)에는 서술형 어미가 없습니다.
        else expect(s, where).not.toMatch(/(니다|해요|예요)$/);
      }
    };
    for (const hand of ALL_HANDS) {
      const atlas = handAtlas(hand);
      for (const { line, origin } of allLines(atlas)) {
        check(line.text, origin === 'across' ? 40 : 30, `${hand} [${origin}]`, origin !== 'digest');
      }
      for (const kind of SCENARIO_KINDS) for (const c of atlas.sections[kind].cells) {
        const g = gateText(c);
        if (g) check(g, 30, `${hand} gate ${c.key}`, true);
      }
    }
    for (const s of allScenarios().filter(hasChart)) {
      for (const lever of seatLevers({ kind: s.kind, hero: s.hero, villain: s.villain })) check(lever.text, 30, `${scenarioKey(s)} ${lever.id}`, true);
    }
  });
});

/* ------------------------------------------------------------------ */

/* 스펙 §5.6 의 예시 몇 개를 그대로 고정합니다 — 템플릿이 바뀌면 여기서 먼저 보입니다. 문구는 EXPLAIN_SPEC §5.4 표(해요체). */
describe('atlas: worked examples (§5.6)', () => {
  const texts = (lines: Line[]) => lines.map((l) => l.text);
  it('KJo', () => {
    const a = handAtlas('KJo');
    expect(texts(rfiThesis(a))).toEqual(['KJo는 UTG에서 절반만, HJ부터는 항상 오픈해요.']);
    expect(texts(compareCells(cellOf(a, 'rfi', 'UTG'), cellOf(a, 'rfi', 'HJ')))).toEqual([
      'HJ에서는 오픈해요. UTG에서는 절반만 오픈해요.',
      'UTG는 뒤에 5명, HJ는 4명이 남아요.',
      '오픈 레인지는 UTG 18%, HJ 21%예요.',
    ]);
    expect(texts(compareCells(cellOf(a, 'vs_open', 'BB', 'BTN'), cellOf(a, 'vs_open', 'BB', 'UTG')))).toEqual([
      'BTN 오픈에는 3벳과 콜을 반반 섞어요. UTG 오픈에는 콜해요.',
      'UTG는 18%, BTN은 46%를 오픈해요.',
      '앞자리 오픈은 강한 패 위주예요. 뒷자리 오픈엔 약한 패도 많이 섞여 있어요.',
    ]);
    expect(sectionDigest(a.sections.vs_3bet).text).toBe('콜 3곳 · 폴드 12곳');
    expect(sectionDigestDetail(a.sections.vs_3bet)?.text).toBe('콜 3곳: BTN vs SB · BTN vs BB · SB vs BB');
    expect(sectionDigest(a.sections.vs_5bet).text).toBe('이 패로는 안 오는 상황');
    expect(sectionDigest(a.sections.vs_limp).text).toBe('BTN에서만 절반 레이즈 · BB는 체크');
    expect(anchorCell(a, cellOf(a, 'rfi', 'UTG'))?.scenario).toEqual({ kind: 'rfi', hero: 'HJ' });
    expect(anchorCell(a, cellOf(a, 'vs_open', 'BB', 'BTN'))?.scenario).toEqual({ kind: 'vs_open', hero: 'BB', villain: 'CO' });
  });
  it('76s · Q9o · A5s · 55', () => {
    const s76 = handAtlas('76s');
    expect(texts(rfiThesis(s76)).join(' ')).toBe('76s는 어느 자리에서나 오픈해요. 앞에서 오픈하면 콜 9곳 · 3벳 1곳 · 폴드 5곳이에요.');
    expect(texts(compareCells(cellOf(s76, 'vs_3bet', 'CO', 'SB'), cellOf(s76, 'vs_3bet', 'CO', 'BTN')))).toEqual([
      'SB 3벳에는 절반만 콜해요. BTN 3벳에는 폴드해요.',
      'SB 상대로는 포지션이 있고, BTN 상대로는 없어요.',
      'SB 3벳엔 블러프도 섞여 있어요. BTN 3벳은 밸류 위주예요.',
    ]);
    const q9 = handAtlas('Q9o');
    expect(texts(rfiThesis(q9)).join(' ')).toBe('Q9o는 BTN부터 오픈해요.');
    expect(texts(compareCells(cellOf(q9, 'vs_open', 'BB', 'HJ'), cellOf(q9, 'vs_open', 'BB', 'UTG')))).toEqual([
      'HJ 오픈에는 절반만 콜해요. UTG 오픈에는 폴드해요.',
      'UTG는 18%, HJ는 21%를 오픈해요.',
    ]);
    const a5 = handAtlas('A5s');
    expect(texts(rfiThesis(a5)).join(' ')).toBe('A5s는 어느 자리에서나 오픈해요. 앞에서 오픈하면 어디서나 3벳해요.');
    expect(sectionDigest(a5.sections.vs_3bet).text).toBe('15곳 전부 4벳 · 그중 3곳은 절반만');
    expect(texts(compareCells(cellOf(a5, 'vs_4bet', 'BTN', 'CO'), cellOf(a5, 'vs_4bet', 'BTN', 'HJ')).slice(0, 2))).toEqual(['둘 다 폴드예요.', 'CO 상대로는 올인도 25% 섞어요.']);
    const p55 = handAtlas('55');
    // 차이 레버 0개 → 결론만. 이유를 지어내지 않습니다.
    expect(texts(compareCells(cellOf(p55, 'vs_3bet', 'HJ', 'CO'), cellOf(p55, 'vs_3bet', 'HJ', 'BTN')))).toEqual(['BTN 3벳에는 절반만 콜해요. CO 3벳에는 주로 폴드해요.']);
    expect(sectionDigest(p55.sections.vs_limp).text).toBe('레이즈 3곳 · 폴드 1곳 · BB는 체크');
    expect(texts(compareCells(cellOf(p55, 'vs_open', 'SB', 'CO'), cellOf(p55, 'vs_open', 'SB', 'BTN')))).toEqual([
      '둘 다 콜이에요.',
      'CO 상대로는 폴드도 50% 섞어요.',
      'CO는 29%, BTN은 46%를 오픈해요.',
    ]);
    // hero 축의 혼합 차이: '자리 자리' 중복 없이 'X에서는'.
    expect(texts(compareCells(cellOf(p55, 'vs_open', 'SB', 'CO'), cellOf(p55, 'vs_open', 'BB', 'CO')))[0]).toMatch(/^(둘 다|SB에서는|BB에서는)/);
  });
  it('gateText · rfiThesis 의 다른 꼴 (§5.4)', () => {
    const k6 = handAtlas('K6o');
    expect(texts(rfiThesis(k6))[0]).toMatch(/^K6o는 SB에서 (절반만 |주로 )?오픈하고, 나머지는 폴드예요\.$/);
    expect(texts(rfiThesis(handAtlas('72o')))[0]).toBe('72o는 어느 자리에서도 오픈하지 않아요.');
    const q8 = texts(rfiThesis(handAtlas('Q8o')))[0];
    expect(q8).toMatch(/오픈하고, 나머지는 폴드예요\.$/);
    expect(q8).toContain('BTN과 SB에서');
    const kj = handAtlas('KJo');
    expect(gateText(cellOf(kj, 'vs_5bet', 'UTG', 'HJ'))).toBe('UTG에서 4벳하지 않으니 올인을 받을 일이 없어요.');
    const t2 = handAtlas('72o');
    expect(gateText(cellOf(t2, 'vs_3bet', 'UTG', 'HJ'))).toBe('UTG에서 오픈하지 않으니 이 상황은 안 생겨요.');
    expect(gateText(cellOf(t2, 'vs_4bet', 'HJ', 'UTG'))).toBe('UTG 오픈에 3벳하지 않으니 4벳을 받을 일이 없어요.');
    expect(uniformLine(handAtlas('AA').sections.vs_open)?.text).toMatch(/^어느 자리에서나 \S+해요\.$/);
  });
});
