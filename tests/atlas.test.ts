import { describe, expect, it } from 'vitest';
import {
  anchorCell,
  atlasQuizKeys,
  BB_PRICE_TAIL,
  BB_PRICE_TAIL_SB,
  blind3betText,
  bookDiffLine,
  compareCells,
  CORE_SEATS,
  differingLevers,
  entrySeat,
  gateLegend,
  gateText,
  handAtlas,
  isRare,
  isReachable,
  nearestCellWithAction,
  POSITION_IP,
  POSITION_OOP,
  SB_OPEN,
  SB_RAISE_OR_FOLD,
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
import { defendShare } from '../src/poker/theory/spot';
import { fullMix, primaryAction, rangeShare } from '../src/poker/range';
import { josa } from '../src/poker/ko';
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
  POSITION_IP,
  POSITION_OOP,
  // SB 의 오픈 대응: 차트가 콜을 0.7~1.5% 섞어서 '대부분'(감사 0) — 아래 '레버 결과 절' 테스트가 콜 < 2%를 셉니다.
  'SB는 콜하면 BB에게 스퀴즈당하기 쉽고, 플랍 이후 포지션도 없어요.',
  '그래서 콜은 드물고, 대부분 3벳 아니면 폴드예요.',
  'BB는 이미 1bb를 냈으니 체크하면 공짜로 플랍을 봐요.',
  '앞자리 오픈은 강한 패 위주라 좁게 맞서요.',
  '뒷자리 오픈엔 약한 패도 많이 섞여 있어 넓게 맞서요.',
  SB_OPEN,
  // 블라인드 3벳의 이유는 3벳 폭(감사 17 — '블러프도 섞여 · 밸류 위주'는 차트와 책 둘 다와 맞지 않았습니다).
  ...(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as Pos[]).flatMap((v) => [`${v} 3벳은 범위가 넓어 더 넓게 지켜요.`, `${v} 3벳은 범위가 좁아 더 좁게 지켜요.`]),
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
    // 1순위가 달라지는 J4s(BTN 오픈 → SB 폴드)·K6o(BTN 폴드 → SB 절반) 에 더해, 1순위는 같아도 BTN 은 항상·SB 는 절반인
    // Q2s·53s 도 SB 절을 받습니다 — 안 그러면 'BTN부터 오픈해요'가 SB 의 절반을 덮습니다.
    expect(ALL_HANDS.filter((h) => rfiProfile(h).sbDiffers)).toEqual(['Q2s', 'J4s', 'K6o', '53s']);
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
    // 다이제스트 · 비교 없는 결론의 칸 수: 같은 비중 등급끼리('9곳은 3벳하고, 5곳은 절반만 …'), 같은 섞임끼리('그중 3곳은 …'),
    // 센 칸(항상 + 주로)의 수. 전부 claims 의 칸을 차트에서 다시 세서 만듭니다.
    const byClass = new Map<WeightClass, number>();
    const bySig = new Map<string, number>();
    for (const c of line.claims) {
      const w = weightClassOf(hand, c.scenario);
      byClass.set(w, (byClass.get(w) ?? 0) + 1);
      const sig = fullMix(getChartCells(c.scenario)[hand]).map((m) => `${m.action}${pctInt(m.weight)}`).join();
      bySig.set(sig, (bySig.get(sig) ?? 0) + 1);
    }
    for (const n of [...byClass.values(), ...bySig.values()]) out.add(n);
    out.add((byClass.get('always') ?? 0) + (byClass.get('most') ?? 0));
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
        // thesis 의 '부터 오픈' · '어느 자리에서나 오픈'은 SB 까지 덮어 읽힙니다. SB 가 항상 오픈이 아니면
        // SB 를 따로 이름 대야 합니다(claims 에 SB 칸이 있어야 합니다).
        if (origin === 'thesis' && /부터 (항상 )?오픈|어느 자리에서나 오픈/.test(line.text)) {
          const sbMix = fullMix(getChartCells({ kind: 'rfi', hero: 'SB' })[hand]);
          const sbFull = sbMix[0].action === 'raise' && sbMix[0].weight >= 0.999;
          const sbNamed = line.claims.some((c) => c.scenario.kind === 'rfi' && c.scenario.hero === 'SB');
          expect(sbFull || sbNamed, `${where} ← SB 오픈 ${Math.round((sbMix.find((m) => m.action === 'raise')?.weight ?? 0) * 100)}%`).toBe(true);
        }
        if (/어디서나|어느 자리에서/.test(line.text)) {
          if (origin === 'uniform') {
            // 섹션의 reachable 칸이 전부 같은 1순위일 때만 나오는 문장입니다.
            const prims = new Set(atlas.sections[kind!].cells.filter((c) => c.reachable).map((c) => primaryOf(hand, c.scenario)));
            expect(prims.size, where).toBe(1);
            continue;
          }
          if (origin === 'across') {
            // 자리 문장 S-0(림프): '어느 자리에서도 레이즈하지 않아요' — 도달 칸 어디에도 레이즈 비중이 없을 때만.
            if (line.text.includes('하지 않아요')) {
              expect(kind, where).toBe('vs_limp');
              for (const c of line.claims) expect(getChartCells(c.scenario)[hand]?.raise ?? 0, where).toBe(0);
              expect(line.claims.length, where).toBeGreaterThanOrEqual(2);
              continue;
            }
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
    expect(SB_RAISE_OR_FOLD.every((x) => LEVER_CONSTANTS.has(x))).toBe(true);
    expect((['SB', 'BB', 'HJ', 'BTN'] as Pos[]).every((v) => LEVER_CONSTANTS.has(blind3betText(v)))).toBe(true);
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
        if (lever.id === 'position') expect(lever.text).toBe(heroIsIP(s) ? POSITION_IP : POSITION_OOP);
        if (lever.id === 'openWidth') expect(lever.text).toBe(`${s.villain ?? s.hero}${(s.villain ?? s.hero) === 'BTN' ? '은' : '는'} ${lever.nums[0]}%를 오픈해요.`);
        if (lever.id === 'threebetWidth') expect(lever.text).toBe(`${s.villain}${s.villain === 'BTN' ? '은' : '는'} ${lever.nums[0]}%를 3벳해요.`);
        if (lever.id === 'behind') expect(lever.text).toMatch(new RegExp(`^뒤에 ${lever.nums[0]}명이 남아 있어 .+기 쉬워요\\.$`));
        if (lever.id === 'bbPrice') {
          // 가격(책 5장 5절)과 뒤에 스퀴즈할 사람이 없음(책이 SB · BTN · CO 의 콜을 줄이는 이유를 BB 에 맞춘 것). '마지막 차례라 제일 넓게'는 책 1장의 오해로 읽혀서 뺐습니다(감사 5).
          expect(lever.text).toBe(`BB는 이미 1bb를 냈으니 ${priceFacts(s)!.toCall}만 더 내면 돼요. ${s.villain === 'SB' ? BB_PRICE_TAIL_SB : BB_PRICE_TAIL.join(' ')}`);
          expect(lever.text).not.toMatch(/마지막 차례/);
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
      for (const kind of SCENARIO_KINDS) {
        const b = bookDiffLine(atlas, kind);
        if (b) check(b, 30, `${hand} bookDiff ${kind}`, true);
        const legend = gateLegend(atlas.sections[kind]);
        if (legend) expect(legend, `${hand} legend ${kind}`).not.toMatch(BANNED_KO);
      }
    }
    for (const s of allScenarios().filter(hasChart)) {
      for (const lever of seatLevers({ kind: s.kind, hero: s.hero, villain: s.villain })) check(lever.text, 30, `${scenarioKey(s)} ${lever.id}`, true);
    }
  });
});

/* ------------------------------------------------------------------ */

/* 레버의 결과 절(블라인드 3벳엔 더 넓게 · 뒷자리 오픈엔 넓게 · SB 오픈은 BTN보다 넓지 않다)이 차트에서 참인지 — atlas.ts 주석. */
describe('atlas: 레버 결과 절은 차트로 확인한 것만', () => {
  const blinds: Pos[] = ['SB', 'BB'];
  const seats: Pos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  it('블라인드 3벳에는 모든 오프너가 블라인드가 아닌 3벳보다 넓게 지킨다', () => {
    for (const hero of seats) {
      const d = (v: Pos) => (hasChart({ kind: 'vs_3bet', hero, villain: v }) ? defendShare({ kind: 'vs_3bet', hero, villain: v }) : null);
      const blind = seats.filter((v) => blinds.includes(v)).map(d).filter((x): x is number => x != null);
      const other = seats.filter((v) => !blinds.includes(v)).map(d).filter((x): x is number => x != null);
      if (blind.length && other.length) expect(Math.min(...blind), hero).toBeGreaterThan(Math.max(...other));
    }
  });
  it('오픈에 맞서는 비중은 오프너가 앞자리(UTG·HJ)일 때가 뒷자리일 때보다 작다', () => {
    for (const hero of seats) {
      const d = (v: Pos) => (hasChart({ kind: 'vs_open', hero, villain: v }) ? defendShare({ kind: 'vs_open', hero, villain: v }) : null);
      const early = (['UTG', 'HJ'] as Pos[]).map(d).filter((x): x is number => x != null);
      const late = (['CO', 'BTN', 'SB'] as Pos[]).map(d).filter((x): x is number => x != null);
      if (early.length && late.length) expect(Math.max(...early), hero).toBeLessThan(Math.min(...late));
    }
  });
  it('SB 오픈은 BTN 오픈보다 넓지 않다', () => {
    expect(defendShare).toBeDefined();
    const open = (hero: Pos) => {
      const cells = getChartCells({ kind: 'rfi', hero });
      let t = 0;
      for (const h of ALL_HANDS) t += (cells[h]?.raise ?? 0) * (h.length === 2 ? 6 : h[2] === 's' ? 4 : 12);
      return t / 1326;
    };
    expect(open('SB')).toBeLessThanOrEqual(open('BTN'));
  });
});

/* 감사 8 — 도달은 1순위로 정하지만(트레이너 · 퀴즈 · 다이제스트), 앞 단계 액션을 섞는 칸은 '절대 안 온다'고 하지 않습니다. */
describe('atlas: 드문 칸(앞 단계 액션을 섞는 칸)은 비중으로 말한다', () => {
  /** 앞 단계 게이트를 차트에서 다시: [게이트 종류, 필요한 액션, 그 차트]. */
  const pathOf = (s: Scenario): Array<{ kind: ScenarioKind; needed: Action; at: Scenario }> =>
    s.kind === 'vs_3bet'
      ? [{ kind: 'rfi', needed: 'raise', at: { kind: 'rfi', hero: s.hero } }]
      : s.kind === 'vs_5bet'
        ? [
            { kind: 'rfi', needed: 'raise', at: { kind: 'rfi', hero: s.hero } },
            { kind: 'vs_3bet', needed: 'fourbet', at: { kind: 'vs_3bet', hero: s.hero, villain: s.villain } },
          ]
        : s.kind === 'vs_4bet'
          ? [{ kind: 'vs_open', needed: 'threebet', at: { kind: 'vs_open', hero: s.hero, villain: s.villain } }]
          : [];
  const w = (hand: HandName, s: Scenario, a: Action) => fullMix(getChartCells(s)[hand]).find((m) => m.action === a)?.weight ?? 0;

  it('모든 패 · 모든 칸: 도달(ok)은 1순위 그대로, 미도달 칸의 gate.weight 는 앞 단계 액션의 비중이고 문장이 그 비중을 따른다', () => {
    let rare = 0;
    let never = 0;
    for (const hand of ALL_HANDS) {
      const atlas = handAtlas(hand);
      for (const kind of SCENARIO_KINDS) {
        for (const c of atlas.sections[kind].cells) {
          const failing = pathOf(c.scenario).filter((g) => primaryOf(hand, g.at) !== g.needed);
          const where = `${hand} ${c.key}`;
          // ok 는 예전 규칙(1순위)과 같습니다 — 트레이너 · 퀴즈 · 다이제스트의 뜻이 바뀌지 않습니다.
          expect(c.reachable, where).toBe(failing.length === 0);
          expect(isReachable(c.scenario, hand).ok, where).toBe(failing.length === 0);
          if (c.reachable) {
            expect(c.gate, where).toBeUndefined();
            continue;
          }
          const zero = failing.find((g) => w(hand, g.at, g.needed) === 0);
          const g = c.gate!;
          const text = gateText(c)!;
          if (zero) {
            never++;
            expect(isRare(c), where).toBe(false);
            expect([g.kind, g.needed, g.weight], where).toEqual([zero.kind, zero.needed, 0]);
            // 비중 0 이면 예전 문장 그대로
            expect(text, where).toMatch(/하지 않으니 (이 상황은 안 생겨요|올인을 받을 일이 없어요|4벳을 받을 일이 없어요)\.$/);
          } else {
            rare++;
            expect(isRare(c), where).toBe(true);
            expect([g.kind, g.needed], where).toEqual([failing[0].kind, failing[0].needed]);
            const p = Math.round(w(hand, failing[0].at, failing[0].needed) * 100);
            expect(p, where).toBeGreaterThan(0);
            expect(Math.round(g.weight * 100), where).toBe(p);
            expect(text, where).toContain(`${p}%만 하니`);
            expect(text, where).not.toMatch(/없어요|안 생겨요|않으니/);
          }
        }
      }
    }
    // 감사 8 의 숫자: 4벳 대응 92칸 + 올인 대응 29칸이 드문 칸(전부 앞 단계 25%).
    expect(rare).toBe(121);
    expect(never).toBeGreaterThan(5000);
    expect(gateText(cellOf(handAtlas('TT'), 'vs_4bet', 'BTN', 'UTG'))).toBe('UTG 오픈에 3벳은 25%만 하니, 4벳은 그때만 받아요.');
    expect(gateText(cellOf(handAtlas('JJ'), 'vs_5bet', 'CO', 'SB'))).toBe('CO에서 SB 3벳에 4벳은 25%만 하니, 올인은 그때만 받아요.');
  });

  it('다이제스트 · 범례 · 결론도 드문 칸을 "안 생긴다"고 하지 않는다', () => {
    let rareDigest = 0;
    for (const hand of ALL_HANDS) {
      const atlas = handAtlas(hand);
      for (const kind of SCENARIO_KINDS) {
        const sec = atlas.sections[kind];
        const where = `${hand} ${kind}`;
        const live = sec.cells.filter((c) => c.reachable);
        const rareCells = sec.cells.filter(isRare);
        const d = sectionDigest(sec).text;
        if (!live.length) {
          expect(d, where).toBe(rareCells.length ? '이 패로는 드물게만 오는 상황' : '이 패로는 안 오는 상황');
          if (rareCells.length) rareDigest++;
        }
        const legend = gateLegend(sec);
        const gated = sec.cells.filter((c) => !c.reachable);
        expect(!!legend, where).toBe(gated.length > 0);
        if (legend) {
          // 드문 칸이 있으면 '드물게만 생기는 칸'과 그 비중을, 비중 0 칸이 있으면 '안 생기는'을.
          expect(legend.includes('드물게만 생기는'), `${where}: ${legend}`).toBe(rareCells.length > 0);
          expect(legend.includes('안 생기'), `${where}: ${legend}`).toBe(rareCells.length < gated.length);
          for (const c of rareCells) expect(legend, where).toMatch(new RegExp(`${Math.round(c.gate!.weight * 100)}%만|일부만`));
        }
        const u = uniformLine(sec);
        if (u && rareCells.length) expect(u.text, where).not.toMatch(/^이 패가 오는/);
      }
    }
    expect(rareDigest).toBe(14);
    // 옛 범례(비중 0 칸만 있을 때)는 글자 그대로입니다.
    expect(gateLegend(handAtlas('72o').sections.vs_3bet)).toBe('— 표시: 오픈하지 않는 자리라서 안 생기는 칸');
    // TT 는 4벳 대응의 미도달 칸이 전부 UTG 오픈(3벳 25%)이고, 87s 는 BB 의 넷만 25%, 나머지는 3벳을 안 해요.
    expect(gateLegend(handAtlas('TT').sections.vs_4bet)).toBe('— 표시: 그 오픈에 3벳을 25%만 하는 자리라서 드물게만 생기는 칸');
    expect(gateLegend(handAtlas('87s').sections.vs_4bet)).toBe('— 표시: 그 오픈에 3벳하지 않거나 25%만 하는 자리라서 안 생기거나 드물게만 생기는 칸');
  });
});

/* 감사 9 · 20 — 다이제스트 문법: '전부'는 모든 칸이 100%일 때만, 칸 하나는 '폴드 1곳', 섞인 칸은 무엇을 섞는지까지. */
describe('atlas: 다이제스트는 스스로 어긋나지 않는다', () => {
  it('모든 패 · 모든 섹션', () => {
    let mixedUniform = 0;
    for (const hand of ALL_HANDS) {
      const atlas = handAtlas(hand);
      for (const kind of SCENARIO_KINDS) {
        const sec = atlas.sections[kind];
        const d = sectionDigest(sec).text;
        const where = `${hand} ${kind}: ${d}`;
        const live = sec.cells.filter((c) => c.reachable);
        expect(d, where).not.toMatch(/(^|\D)1곳 전부/);
        // '전부 X'와 '그중 N곳은'이 한 줄에 같이 오지 않습니다(감사: 28줄).
        expect(/전부/.test(d) && /그중/.test(d), where).toBe(false);
        // '전부'는 모든 도달 칸이 같은 액션 100%일 때만.
        if (/전부/.test(d)) expect(live.length >= 2 && live.every((c) => c.mixList[0].weight >= 0.999 && c.primary === live[0].primary), where).toBe(true);
        // '절반만' 뒤에는 늘 액션이 옵니다(감사: 맨 '절반만').
        for (const m of d.matchAll(/절반만(\s*)(\S*)/g)) expect(m[1] === ' ' && /^(폴드|콜|오픈|레이즈|3벳|4벳|올인|체크)$/.test(m[2]), where).toBe(true);
        if (live.length === 1) expect(d, where).toMatch(/^\S.* 1곳( · .+)?$/);
        const prims = new Set(live.map((c) => c.primary));
        if (prims.size === 1 && live.length >= 2 && live.some((c) => c.weightClass !== 'always')) {
          mixedUniform++;
          // '폴드 15곳 · 그중 6곳은 올인 25% 섞음' — 머리의 수는 도달 칸 수, 그중 수의 합은 섞인 칸 수.
          expect(d, where).toMatch(new RegExp(`^\\S+ ${live.length}곳 · 그중 `));
          const counts = [...d.matchAll(/(\d+)곳은/g)].map((m) => Number(m[1]));
          expect(counts.reduce((t, n) => t + n, 0), where).toBe(live.filter((c) => c.weightClass !== 'always').length);
          // '…% 섞음'의 %는 그 칸들의 2순위 비중
          for (const m of d.matchAll(/(\S+) (\d+)% 섞음/g)) {
            const ok = live.some((c) => c.mixList[1] && pctInt(c.mixList[1].weight) === Number(m[2]));
            expect(ok, `${where} ← ${m[0]}`).toBe(true);
          }
        }
      }
    }
    expect(mixedUniform).toBeGreaterThan(20);
    expect(sectionDigest(handAtlas('JJ').sections.vs_5bet).text).toBe('폴드 1곳');
    expect(sectionDigest(handAtlas('KQs').sections.vs_open).text).toBe('3벳 15곳 · 그중 7곳은 3벳·콜 반반');
    expect(sectionDigest(handAtlas('A5s').sections.vs_4bet).text).toBe('폴드 15곳 · 그중 6곳은 올인 25% 섞음');
    // 섞는 묶음이 셋이어도 30자 안이면 묶음마다 이름을 댑니다 — 섞는 액션만('그중 14곳은 올인·폴드도 섞음') 말하면 절반 칸 5곳이 가려집니다.
    expect(sectionDigest(handAtlas('JJ').sections.vs_4bet).text).toBe('콜 15곳 · 그중 5곳은 절반만 콜 · 5곳은 올인 25% 섞음 · 4곳은 폴드 25% 섞음');
  });

  it("비교 상대가 없는 칸의 결론: 절반 칸이 끼면 '어느 자리에서나'로 덮지 않고 비중별로 칸 수를 댄다", () => {
    for (const hand of ALL_HANDS) {
      const atlas = handAtlas(hand);
      for (const kind of SCENARIO_KINDS) {
        const sec = atlas.sections[kind];
        const u = uniformLine(sec);
        if (!u) continue;
        const live = sec.cells.filter((c) => c.reachable);
        const weak = live.filter((c) => c.weightClass === 'half' || c.weightClass === 'some');
        const where = `${hand} ${kind}: ${u.text}`;
        if (!weak.length) {
          expect(u.text, where).toMatch(/^(어느 자리에서나|이 패가 (보통 )?오는 \d+곳에서는) \S+해요\.$/);
          continue;
        }
        expect(u.text, where).not.toMatch(/어느 자리에서나|어디서나/);
        const counts = [...u.text.matchAll(/(\d+)곳은/g)].map((m) => Number(m[1]));
        expect(counts.reduce((t, n) => t + n, 0), where).toBe(live.length);
        expect(u.text, where).toMatch(/절반|반반/);
      }
    }
    expect(uniformLine(handAtlas('A3s').sections.vs_open)?.text).toBe('9곳은 3벳하고, 5곳은 절반만 3벳하고, 1곳은 3벳과 콜을 반반 섞어요.');
  });
});

/* 감사 37 — 오픈 대응 한 줄이 칸 수만 말하지 않고, 칸이 모여 있으면 그 자리를 이름으로. */
describe('atlas: rfiThesis 오픈 대응 문장', () => {
  it('이름으로 부른 자리 · 오프너는 차트 그대로이고, 다른 곳은 전부 센 칸이다', () => {
    let named = 0;
    const RE = /^앞에서 오픈하면 (?:(UTG|HJ|CO|BTN|SB|BB)에서 ((?:(?:UTG|HJ|CO|BTN|SB)·?)+) 오픈에|(UTG|HJ|CO|BTN|SB) 오픈에 ((?:(?:HJ|CO|BTN|SB|BB)·?)+)에서) (주로 |절반만 )?(\S+)하고, 다른 곳은 (\S+)해요\.$/;
    for (const hand of ALL_HANDS) {
      const atlas = handAtlas(hand);
      const lines = rfiThesis(atlas);
      if (lines.length < 2) continue;
      const t = lines[1].text;
      const m = RE.exec(t);
      if (!m) continue;
      named++;
      const heroes = m[1] ? [m[1]] : m[4].split('·');
      const villains = m[1] ? m[2].split('·') : [m[3]];
      const word = m[5] ? m[5].trim() : '';
      const act = ACT_OF_WORD[m[6]][0];
      const other = ACT_OF_WORD[m[7]][0];
      for (const c of atlas.sections.vs_open.cells) {
        const where = `${hand}: ${t} ← ${c.key}`;
        if (heroes.includes(c.scenario.hero) && villains.includes(c.scenario.villain!)) {
          expect(primaryOf(hand, c.scenario), where).toBe(act);
          expect(weightClassOf(hand, c.scenario), where).toBe(word === '주로' ? 'most' : word === '절반만' ? 'half' : 'always');
        } else {
          expect(primaryOf(hand, c.scenario), where).toBe(other);
          expect(['always', 'most'], where).toContain(weightClassOf(hand, c.scenario));
        }
      }
    }
    expect(named).toBeGreaterThan(15);
    expect(rfiThesis(handAtlas('J2s'))[1].text).toBe('앞에서 오픈하면 BB에서 BTN·SB 오픈에 콜하고, 다른 곳은 폴드해요.');
    expect(rfiThesis(handAtlas('33'))[1].text).toBe('앞에서 오픈하면 CO·BTN·BB에서 콜하고, HJ·SB에서 폴드해요.');
  });

  it("1순위는 같은데 절반 칸이 끼면 비교 없는 결론과 같은 문장으로 — 명사형 다이제스트에 '이에요'를 붙이지 않는다", () => {
    for (const hand of ALL_HANDS) {
      const lines = rfiThesis(handAtlas(hand));
      if (lines.length < 2) continue;
      const t = lines[1].text;
      // '…콜 25% 섞음이에요'처럼 명사형 '섞음'에 서술격이 붙지 않습니다.
      expect(t, hand).not.toMatch(/섞음(이에요|예요)/);
      const sec = handAtlas(hand).sections.vs_open;
      const u = uniformLine(sec);
      const weak = sec.cells.some((c) => c.weightClass === 'half' || c.weightClass === 'some');
      if (u && weak && new Set(sec.cells.map((c) => c.primary)).size === 1) {
        const want = `앞에서 오픈하면 ${u.text}`;
        if ((want.match(/[가-힣]/g) ?? []).length <= 30) expect(t, hand).toBe(want);
      }
    }
    expect(rfiThesis(handAtlas('KQs'))[1].text).toBe('앞에서 오픈하면 8곳은 3벳하고, 7곳은 3벳과 콜을 반반 섞어요.');
    expect(rfiThesis(handAtlas('AQo'))[1].text).toBe('앞에서 오픈하면 11곳은 3벳하고, 4곳은 3벳과 콜을 반반 섞어요.');
    // 결론 문장이 30자를 넘으면 다이제스트로(이때도 '반반이에요'처럼 명사로 맺어 자연스러워요).
    expect(rfiThesis(handAtlas('A3s'))[1].text).toBe('앞에서 오픈하면 3벳 15곳 · 그중 5곳은 절반만 3벳 · 1곳은 3벳·콜 반반이에요.');
  });
});

/* 감사 20 — 자리별 보기의 올인 대응 · 콜드 4벳 섹션에 붙는 '책과 다른 점'은 그 패의 칸에서 참일 때만. */
describe('atlas: 책과 다른 점(패 단위)', () => {
  const BOOK5 = new Set<string>(['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs', 'AKo']);
  const BOOK5_BTN = new Set<string>([...BOOK5, '99', '88', '77', '66']);
  it('vs_5bet: 책이 콜하는 패를 차트가 늘 콜하지 않는 칸 수가 라벨별로 맞고, cold_4bet: 콜을 섞는 칸 수가 맞다', () => {
    let lines5 = 0;
    let linesCold = 0;
    for (const hand of ALL_HANDS) {
      const atlas = handAtlas(hand);
      for (const kind of SCENARIO_KINDS) {
        const b = bookDiffLine(atlas, kind);
        const live = atlas.sections[kind].cells.filter((c) => c.reachable);
        if (kind === 'vs_5bet') {
          const differ = live.filter((c) => (c.scenario.hero === 'BTN' ? BOOK5_BTN : BOOK5).has(hand) && !(primaryOf(hand, c.scenario) === 'call' && weightClassOf(hand, c.scenario) === 'always'));
          expect(!!b, `${hand} vs_5bet ${b}`).toBe(differ.length > 0);
          if (!b) continue;
          lines5++;
          expect(b, hand).toMatch(/^책은 (BTN이 )?올인에 /);
          const label = (c: AtlasCell) => {
            const a = primaryOf(hand, c.scenario) === 'call' ? '콜' : '폴드';
            const word = weightClassOf(hand, c.scenario);
            return word === 'always' ? a : word === 'most' ? `주로 ${a}` : `절반만 ${a}`;
          };
          const want = new Map<string, number>();
          for (const c of differ) want.set(label(c), (want.get(label(c)) ?? 0) + 1);
          const got = new Map([...b.matchAll(/(\d+)곳에서 ((?:주로 |절반만 )?(?:콜|폴드))/g)].map((m) => [m[2], Number(m[1])] as const));
          expect(got, `${hand}: ${b}`).toEqual(want);
        } else if (kind === 'cold_4bet') {
          const calls = live.filter((c) => fullMix(getChartCells(c.scenario)[hand]).some((m) => m.action === 'call' && m.weight > 0));
          expect(!!b, `${hand} cold ${b}`).toBe(calls.length > 0);
          if (!b) continue;
          linesCold++;
          expect(b, hand).toBe(`책은 오픈과 3벳 사이에 끼면 대부분 4벳 아니면 폴드라고 해요. 이 차트는 ${calls.length}곳에서 ${josa(hand, '을/를')} 콜하기도 해요.`);
        } else expect(b, `${hand} ${kind}`).toBeNull();
      }
    }
    // 차트에서 세면: 올인 대응은 AKs · AKo · QQ · JJ, 콜드 4벳은 AKs · AQs · AKo · QQ · JJ.
    expect(lines5).toBe(4);
    expect(linesCold).toBe(5);
    expect(bookDiffLine(handAtlas('QQ'), 'vs_5bet')).toBe('책은 올인에 TT 이상과 AK가 콜한다고 해요. 이 차트는 QQ를 4곳에서 폴드, 4곳에서 절반만 콜, 2곳에서 주로 콜해요.');
    expect(bookDiffLine(handAtlas('AA'), 'vs_5bet')).toBeNull();
    expect(bookDiffLine(handAtlas('A5s'), 'cold_4bet')).toBeNull();
  });
});

/* 감사 0 · 5 · 17 — 레버의 결과 절('대부분' · '가장 넓게 콜해요' · '범위가 넓어 더 넓게')이 차트에서 참인지. */
describe('atlas: 레버의 숫자 사실', () => {
  const seats: Pos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  const callShare = (hero: Pos, v: Pos) => rangeShare(getChartCells({ kind: 'vs_open', hero, villain: v }), 'call');
  const tbShare = (hero: Pos, v: Pos) => rangeShare(getChartCells({ kind: 'vs_open', hero, villain: v }), 'threebet');
  it('BB 는 어느 오프너에게나 다른 자리보다 넓게 콜한다', () => {
    for (const v of seats) {
      if (!hasChart({ kind: 'vs_open', hero: 'BB', villain: v })) continue;
      for (const h of seats.filter((x) => x !== 'BB' && hasChart({ kind: 'vs_open', hero: x, villain: v }))) expect(callShare('BB', v), `${h} vs ${v}`).toBeGreaterThan(callShare(h, v));
    }
  });
  it("SB 의 콜은 어느 오프너에게나 2% 아래이고 0은 아니다 — '콜은 드물고, 대부분 3벳 아니면 폴드'", () => {
    for (const v of ['UTG', 'HJ', 'CO', 'BTN'] as Pos[]) {
      expect(callShare('SB', v), v).toBeLessThan(0.02);
      expect(callShare('SB', v), v).toBeGreaterThan(0);
    }
  });
  it('같은 오프너에게 블라인드는 블라인드가 아닌 자리보다 넓게 3벳한다', () => {
    let n = 0;
    for (const opener of seats) {
      const has = (h: Pos) => hasChart({ kind: 'vs_open', hero: h, villain: opener });
      const blind = (['SB', 'BB'] as Pos[]).filter(has).map((h) => tbShare(h, opener));
      const other = (['HJ', 'CO', 'BTN'] as Pos[]).filter(has).map((h) => tbShare(h, opener));
      if (!blind.length || !other.length) continue;
      n++;
      expect(Math.min(...blind), opener).toBeGreaterThan(Math.max(...other));
    }
    expect(n).toBe(3);
  });
});

/* 스펙 §5.6 의 예시 몇 개를 그대로 고정합니다 — 템플릿이 바뀌면 여기서 먼저 보입니다. 문구는 EXPLAIN_SPEC §5.4 표(해요체). */
describe('atlas: worked examples (§5.6)', () => {
  const texts = (lines: Line[]) => lines.map((l) => l.text);
  it('KJo', () => {
    const a = handAtlas('KJo');
    expect(texts(rfiThesis(a))).toEqual(['KJo는 UTG에서 절반만, HJ부터는 항상 오픈해요.']);
    expect(texts(compareCells(cellOf(a, 'rfi', 'UTG'), cellOf(a, 'rfi', 'HJ')))).toEqual([
      'HJ에서는 오픈해요. UTG에서는 절반만 오픈해요.',
      'UTG는 뒤에 5명, HJ는 4명이 남아 UTG가 3벳을 받기 더 쉬워요.',
      '오픈 레인지는 UTG 18%, HJ 21%예요.',
    ]);
    expect(texts(compareCells(cellOf(a, 'vs_open', 'BB', 'BTN'), cellOf(a, 'vs_open', 'BB', 'UTG')))).toEqual([
      'BTN 오픈에는 3벳과 콜을 반반 섞어요. UTG 오픈에는 콜해요.',
      'UTG는 18%, BTN은 46%를 오픈해요.',
      '앞자리 오픈은 강한 패 위주라 좁게 맞서요. 뒷자리 오픈엔 약한 패도 많이 섞여 있어 넓게 맞서요.',
    ]);
    expect(sectionDigest(a.sections.vs_3bet).text).toBe('콜 3곳 · 폴드 12곳');
    expect(sectionDigestDetail(a.sections.vs_3bet)?.text).toBe('콜 3곳: BTN vs SB · BTN vs BB · SB vs BB');
    // KJo 는 BTN 이 BB 3벳에 4벳을 25% 섞어서, 그때만 올인을 받아요 — '안 오는 상황'이 아니라 '드물게만'(감사 8).
    expect(sectionDigest(a.sections.vs_5bet).text).toBe('이 패로는 드물게만 오는 상황');
    expect(sectionDigest(a.sections.vs_limp).text).toBe('BTN에서 절반만 레이즈 · 폴드 3곳 · BB는 체크');
    expect(anchorCell(a, cellOf(a, 'rfi', 'UTG'))?.scenario).toEqual({ kind: 'rfi', hero: 'HJ' });
    expect(anchorCell(a, cellOf(a, 'vs_open', 'BB', 'BTN'))?.scenario).toEqual({ kind: 'vs_open', hero: 'BB', villain: 'CO' });
  });
  it('76s · Q9o · A5s · 55', () => {
    const s76 = handAtlas('76s');
    expect(texts(rfiThesis(s76)).join(' ')).toBe('76s는 어느 자리에서나 오픈해요. 앞에서 오픈하면 콜 9곳 · 3벳 1곳 · 폴드 5곳이에요.');
    expect(texts(compareCells(cellOf(s76, 'vs_3bet', 'CO', 'SB'), cellOf(s76, 'vs_3bet', 'CO', 'BTN')))).toEqual([
      'SB 3벳에는 절반만 콜해요. BTN 3벳에는 폴드해요.',
      'SB 상대로는 포지션이 있어 플랍 이후 유리하고, BTN 상대로는 불리해요.',
      'SB 3벳은 범위가 넓어 더 넓게 지켜요. BTN 3벳은 범위가 좁아 더 좁게 지켜요.',
    ]);
    const q9 = handAtlas('Q9o');
    expect(texts(rfiThesis(q9)).join(' ')).toBe('Q9o는 BTN부터 오픈해요.');
    expect(texts(compareCells(cellOf(q9, 'vs_open', 'BB', 'HJ'), cellOf(q9, 'vs_open', 'BB', 'UTG')))).toEqual([
      'HJ 오픈에는 절반만 콜해요. UTG 오픈에는 폴드해요.',
      'UTG는 18%, HJ는 21%를 오픈해요.',
    ]);
    const a5 = handAtlas('A5s');
    expect(texts(rfiThesis(a5)).join(' ')).toBe('A5s는 어느 자리에서나 오픈해요. 앞에서 오픈하면 어디서나 3벳해요.');
    // 그 3곳은 4벳 50 · 콜 25 · 폴드 25 — '절반만'(= 나머지는 폴드)으로 줄이지 않습니다(THEORY_SPEC §5).
    // '전부'는 모든 칸이 100%일 때만 — 섞인 칸은 무엇을 섞는지까지(감사 9).
    expect(sectionDigest(a5.sections.vs_3bet).text).toBe('4벳 15곳 · 그중 3곳은 절반은 4벳, 절반은 콜·폴드 · 2곳은 콜 25% 섞음');
    expect(texts(compareCells(cellOf(a5, 'vs_3bet', 'UTG', 'HJ'), cellOf(a5, 'vs_3bet', 'UTG', 'SB')))[0]).toBe('SB 3벳에는 4벳해요. HJ 3벳에는 절반은 4벳하고, 나머지를 콜과 폴드로 나눠요.');
    expect(texts(compareCells(cellOf(a5, 'vs_3bet', 'UTG', 'HJ'), cellOf(a5, 'vs_3bet', 'UTG', 'BTN'))).slice(0, 2)).toEqual(['둘 다 4벳이에요.', 'HJ 상대로는 콜도 폴드도 25%씩 섞어요.']);
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
    // 비중어 바로 뒤의 '나머지는'은 "SB 의 나머지 절반"으로도 읽혀서 '다른 자리에서는'(THEORY_SPEC §5).
    expect(texts(rfiThesis(k6))[0]).toMatch(/^K6o는 SB에서 (절반만 |주로 )?오픈하고, 다른 자리에서는 폴드해요\.$/);
    expect(texts(rfiThesis(handAtlas('72o')))[0]).toBe('72o는 어느 자리에서도 오픈하지 않아요.');
    const q8 = texts(rfiThesis(handAtlas('Q8o')))[0];
    expect(q8).toMatch(/오픈하고, 다른 자리에서는 폴드해요\.$/);
    expect(q8).toContain('BTN과 SB에서');
    const kj = handAtlas('KJo');
    expect(gateText(cellOf(kj, 'vs_5bet', 'UTG', 'HJ'))).toBe('UTG에서 4벳하지 않으니 올인을 받을 일이 없어요.');
    const t2 = handAtlas('72o');
    expect(gateText(cellOf(t2, 'vs_3bet', 'UTG', 'HJ'))).toBe('UTG에서 오픈하지 않으니 이 상황은 안 생겨요.');
    expect(gateText(cellOf(t2, 'vs_4bet', 'HJ', 'UTG'))).toBe('UTG 오픈에 3벳하지 않으니 4벳을 받을 일이 없어요.');
    expect(uniformLine(handAtlas('AA').sections.vs_open)?.text).toMatch(/^어느 자리에서나 \S+해요\.$/);
    // 섹션에 이 패로 못 오는 칸이 있으면 '어느 자리에서나' 대신 오는 칸의 수로(THEORY_SPEC §5 — 못 오는 칸까지 덮지 않게).
    // A2s 는 CO 가 BB 3벳에 4벳을 25% 섞어 그때만 그 칸에 와요 — '오는 3곳'이 그 칸을 빼먹지 않게 '보통 오는'(감사 8).
    expect(uniformLine(handAtlas('A2s').sections.vs_5bet)?.text).toBe('이 패가 보통 오는 3곳에서는 폴드해요.');
    expect(uniformLine(handAtlas('A4s').sections.vs_5bet)?.text).toBe('이 패가 보통 오는 14곳에서는 폴드해요.');
    for (const hand of ALL_HANDS) {
      for (const kind of SCENARIO_KINDS) {
        const sec = handAtlas(hand).sections[kind];
        const u = uniformLine(sec);
        if (u && sec.cells.some((c) => !c.reachable)) expect(u.text, `${hand} ${kind}`).not.toMatch(/어느 자리에서나/);
      }
    }
  });
});
