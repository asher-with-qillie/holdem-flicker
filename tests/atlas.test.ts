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
  rowBoundary,
  seatLevers,
  seatSummary,
  sectionDigest,
  sectionDigestDetail,
  uniformLine,
  selfQuestion,
  type AtlasCell,
  type AtlasSection,
  type HandAtlas,
  type Line,
  type WeightClass,
} from '../src/poker/atlas';
import { getChartCells, hasChart } from '../src/poker/data';
import { classifyHand, explainStep, heroIsIP, OPEN, seatsBehind, type HandClass } from '../src/poker/explain';
import { ALL_HANDS, seedRandom } from '../src/poker/hands';
import { priceFacts } from '../src/poker/priceFacts';
import { AGGRESSION_ORDER, fullMix, primaryAction, rangeShare } from '../src/poker/range';
import { allScenarios, scenarioKey } from '../src/poker/scenarios';
import { cardKeyOf, stepForKey } from '../src/state/srs';
import { buildSteps, DEFAULT_SESSION_OPTIONS, nextHandSequence, stepFor } from '../src/poker/trainer';
import { POSITIONS, SCENARIO_KINDS, type Action, type HandName, type Pos, type Scenario, type ScenarioKind } from '../src/poker/types';

/*
 * 자리별 보기(HandAtlas) 엔진 — docs/ATLAS_SPEC.md §7 테스트 1~10.
 * 핵심은 5번(속성 테스트): 아틀라스가 만든 모든 문장의 claim 과 숫자를 **차트에서 다시 유도**해 대조합니다.
 * 이 파일의 재유도 코드는 atlas.ts 의 내부를 쓰지 않고 range.ts/data 만 씁니다 — 같은 버그를 두 번 쓰지 않으려고요.
 */

const pctInt = (x: number) => Math.round(x * 100);
const aggression = (a: Action) => AGGRESSION_ORDER.indexOf(a);

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

type Origin = 'thesis' | 'question' | 'digest' | 'summary' | 'compare' | 'uniform';
interface Tagged {
  line: Line;
  origin: Origin;
  hero?: Pos;
  kind?: ScenarioKind;
}

function allLines(atlas: HandAtlas): Tagged[] {
  const out: Tagged[] = [];
  for (const line of rfiThesis(atlas)) out.push({ line, origin: 'thesis' });
  out.push({ line: selfQuestion(atlas), origin: 'question' });
  for (const kind of SCENARIO_KINDS) {
    const sec = atlas.sections[kind];
    out.push({ line: sectionDigest(sec), origin: 'digest' });
    const detail = sectionDigestDetail(sec);
    if (detail) out.push({ line: detail, origin: 'digest' });
    const uni = uniformLine(sec);
    if (uni) out.push({ line: uni, origin: 'uniform', kind });
  }
  for (const hero of POSITIONS) out.push({ line: seatSummary(atlas, hero), origin: 'summary', hero });
  for (const kind of SCENARIO_KINDS) {
    for (const [a, b] of axisPairs(atlas.sections[kind])) for (const line of compareCells(a, b)) out.push({ line, origin: 'compare' });
  }
  return out;
}

const SB_OPEN_CONSTANT = 'SB는 BB 한 명만 남아 따로 봅니다.';
const sentences = (text: string) => text.split(/(?<=[.?])\s+/).filter((x) => x.trim());

/** 그 kind 의 모든 상황 × 모든 패에서 explainStep 이 낸 reasoning ∪ easy.why 의 집합. 상수 문장은 이 안에 있어야 합니다. */
const kindSets = new Map<ScenarioKind, Set<string>>();
function kindSet(kind: ScenarioKind): Set<string> {
  let set = kindSets.get(kind);
  if (set) return set;
  set = new Set<string>();
  for (const s of allScenarios().filter((x) => x.kind === kind && hasChart(x))) {
    for (const hand of ALL_HANDS) {
      const e = explainStep(stepFor(s, hand));
      // 용어 풀이(applyGlosses)가 한 문자열에 두 번째 문장을 붙이므로 문장 단위로 넣습니다.
      for (const t of [...e.reasoning, ...e.easy.why]) for (const sentence of sentences(t)) set.add(sentence);
    }
  }
  kindSets.set(kind, set);
  return set;
}

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
  const RE_HERO = /(UTG|HJ|CO|BTN|SB|BB)(에서는|에서|부터|만) ?(절반만 |절반은 |주로 )?(폴드|콜|오픈|레이즈|3벳|4벳|올인|체크)/g;
  const RE_VILLAIN = /(UTG|HJ|CO|BTN|SB) (오픈|3벳|4벳|올인)에는 (절반만 |절반은 |주로 )?(폴드|콜|오픈|레이즈|3벳|4벳|올인)/g;
  // half 패턴 thesis 는 자리와 액션이 떨어져 있습니다("UTG에서 절반만, HJ부터 항상 오픈합니다") — 위 두 정규식이
  // 하나도 못 뽑아서, 자리를 잘못 적은 thesis 가 claims 만 맞으면 통과했습니다. 그 꼴을 따로 뽑습니다.
  const RE_HALF_SEAT = /(UTG|HJ|CO|BTN|SB)에서 (절반만|주로|\d+%만)(?=,| 오픈)/g;
  const RE_ALWAYS_FROM = /(UTG|HJ|CO|BTN)부터 항상 오픈/g;
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

  /** villain 축이 단조인가 (reachable 칸만): 공격성 비감소. */
  function villainAxisMonotone(atlas: HandAtlas, kind: 'vs_open' | 'vs_3bet', hero: Pos): boolean {
    const cells = atlas.sections[kind].cells.filter((c) => c.scenario.hero === hero && c.reachable);
    return cells.every((c, i) => i === 0 || aggression(c.primary) >= aggression(cells[i - 1].primary));
  }

  it('claims re-derive from the charts', () => {
    let lines = 0;
    for (const hand of ALL_HANDS) {
      const atlas = handAtlas(hand);
      const { pattern } = atlas.rfi;
      for (const { line, origin, hero, kind } of allLines(atlas)) {
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
          const ok = line.claims.some((c) => c.scenario.kind === 'rfi' && c.scenario.hero === seat && c.action === 'raise' && c.weight === want);
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
            return p?.toCall === m || p?.pot === m;
          });
          expect(ok, `${where} ← ${m}`).toBe(true);
        }
        // (d) '부터' · '어디서든' · '까지'
        if (line.text.includes('부터')) {
          if (origin === 'thesis' || origin === 'question') expect(['entry', 'half'], where).toContain(pattern);
          else if (origin === 'summary') {
            expect(villainAxisMonotone(atlas, 'vs_open', hero!) && villainAxisMonotone(atlas, 'vs_3bet', hero!), where).toBe(true);
          } else expect.fail(`'부터' outside thesis/summary: ${where}`);
        }
        if (/어디서든|어느 자리에서/.test(line.text)) {
          if (origin === 'uniform') {
            // 섹션의 reachable 칸이 전부 같은 1순위일 때만 나오는 문장입니다.
            const prims = new Set(atlas.sections[kind!].cells.filter((c) => c.reachable).map((c) => primaryOf(hand, c.scenario)));
            expect(prims.size, where).toBe(1);
            continue;
          }
          expect(origin, where).toBe('thesis');
          if (line.text.includes('어느 자리에서')) {
            const prims = new Set(atlas.sections.rfi.cells.map((c) => primaryOf(hand, c.scenario)));
            expect(prims.size, where).toBe(1);
          }
          if (line.text.includes('어디서든')) {
            const prims = new Set(atlas.sections.vs_open.cells.filter((c) => c.reachable).map((c) => primaryOf(hand, c.scenario)));
            expect(prims.size, where).toBe(1);
          }
        }
        if (line.text.includes('까지')) {
          if (origin === 'summary') {
            // 요약의 '{v} 오픈까지는 폴드' — 앞쪽 폴드 구간 요약. 축이 단조일 때만 참입니다('부터'와 같은 조건).
            expect(/(오픈|3벳)까지는 폴드/.test(line.text), where).toBe(true);
            expect(villainAxisMonotone(atlas, 'vs_open', hero!) && villainAxisMonotone(atlas, 'vs_3bet', hero!), where).toBe(true);
            continue;
          }
          expect(origin, where).toBe('compare');
          for (const c of line.claims) {
            expect(c.scenario.kind, where).toBe('rfi');
            expect(rowBoundary(c.scenario, hand).monotone, where).toBe(true);
          }
        }
        // (e) 상수 문장은 explainStep 출력 집합의 원소
        if (line.source === 'constant') {
          const set = kindSet(line.claims[0].scenario.kind);
          for (const sentence of sentences(line.text)) {
            if (sentence === SB_OPEN_CONSTANT) continue;
            expect(set.has(sentence), `${where} ← ${sentence}`).toBe(true);
          }
        }
      }
    }
    expect(lines).toBeGreaterThan(169 * 180);
  });

  it('seatLevers constants are explainStep sentences; numbers are the chart formulas', () => {
    for (const s of allScenarios().filter(hasChart)) {
      const atlasScenario: Scenario = { kind: s.kind, hero: s.hero, villain: s.villain };
      for (const lever of seatLevers(atlasScenario)) {
        const where = `${scenarioKey(s)} ${lever.id}: ${lever.text}`;
        if (lever.constant) {
          for (const sentence of sentences(lever.text)) {
            if (sentence === SB_OPEN_CONSTANT) continue;
            expect(kindSet(s.kind).has(sentence), where).toBe(true);
          }
        }
        if (lever.id === 'behind') {
          expect(['SB', 'BB']).not.toContain(s.hero);
          expect(lever.nums).toEqual([seatsBehind(s.hero)]);
        }
        if (lever.id === 'openWidth') expect(lever.nums).toEqual([share({ kind: 'rfi', hero: s.villain ?? s.hero }, 'raise')]);
        if (lever.id === 'threebetWidth') expect(lever.nums).toEqual([share({ kind: 'vs_open', hero: s.villain!, villain: s.hero }, 'threebet')]);
        if (lever.id === 'position') expect(lever.text).toBe(heroIsIP(s) ? '플랍 이후 내가 나중에 액션합니다.' : '플랍 이후 내가 먼저 액션합니다.');
        for (const m of lever.text.match(RE_PRICE) ?? []) {
          if (m === '1bb') continue;
          const p = priceFacts(s);
          expect(p?.toCall === m || p?.pot === m, where).toBe(true);
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
      expect(text, where).not.toMatch(/해요|거든요/);
      expect(text, where).not.toMatch(/[()]/);
      for (const s of sentences(text)) {
        // 글자 수는 한글 음절로 셉니다 — 'BB'·'1.5bb'·'18%' 같은 토큰은 읽는 부담이 아니라 숫자입니다.
        expect(hangulLen(s), `${where} ← ${s}`).toBeLessThanOrEqual(limit);
        // 합니다체 한 가지: ~니다 / ~인가요 / ~나요 (겹칩니다·남습니다·봅니다 같은 동사도 같은 격식체입니다).
        if (endings) expect(s, where).toMatch(/(니다|인가요|나요)[.?]$/);
      }
    };
    for (const hand of ALL_HANDS) {
      const atlas = handAtlas(hand);
      for (const { line, origin } of allLines(atlas)) {
        const fragment = origin === 'digest' || origin === 'summary';
        check(line.text, origin === 'summary' ? 45 : 30, `${hand} [${origin}]`, !fragment);
        if (origin === 'summary') expect(sentences(line.text.replace(/:/g, '.')).length).toBeLessThanOrEqual(2);
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

describe('explain copy audit (§7 test 10)', () => {
  it('OPEN[] class lines agree with the charts', () => {
    const byClass = new Map<HandClass, HandName[]>();
    for (const hand of ALL_HANDS) {
      const cls = classifyHand(hand);
      byClass.set(cls, [...(byClass.get(cls) ?? []), hand]);
    }
    const failures: string[] = [];
    for (const [cls, hands] of byClass) {
      const text = OPEN[cls].join(' ');
      const lateOnly = text.includes('뒷자리에서만') || text.includes('앞자리 레인지에는 들어가지 않습니다');
      const everywhere = /어디서든|항상/.test(text);
      for (const hand of hands) {
        const first = rfiProfile(hand).firstAny;
        if (lateOnly && !(first === null || first === 'CO' || first === 'BTN')) failures.push(`${cls}/${hand} opens from ${first} but OPEN says 뒷자리에서만`);
        if (everywhere && first !== 'UTG') failures.push(`${cls}/${hand} opens from ${first} but OPEN says 어디서든/항상`);
      }
    }
    expect(failures).toEqual([]);
    // 스펙이 정한 새 카피.
    expect(OPEN.offsuit_broadway).toEqual(['자리가 뒤로 갈수록 더 많이 오픈합니다.', '킥커가 약한 쪽일수록 늦게 들어갑니다.']);
    expect(OPEN.suited_king).toEqual(['큰 수티드 K는 앞자리, 작은 쪽은 뒷자리에서 오픈합니다.', '3벳에는 대부분 폴드합니다.']);
    expect(OPEN.suited_qj).toEqual(['Q9s는 앞자리부터, 나머지는 뒷자리에서 오픈합니다.', '3벳에는 폴드가 기본입니다.']);
    expect(OPEN.suited_gapper).toEqual(['높은 갭퍼는 앞자리, 낮은 갭퍼는 뒷자리에서 오픈합니다.', '플랍에서 드로우가 붙어야 계속 갑니다.']);
    // Q9s 는 정말 앞자리(UTG)부터 엽니다 — 카피가 패 이름을 부르니 차트와 묶어 둡니다.
    expect(rfiProfile('Q9s').firstAny).toBe('UTG');
  });
});

/* 스펙 §5.6 의 예시 몇 개를 그대로 고정합니다 — 템플릿이 바뀌면 여기서 먼저 보입니다. */
describe('atlas: worked examples (§5.6)', () => {
  const texts = (lines: Line[]) => lines.map((l) => l.text);
  it('KJo', () => {
    const a = handAtlas('KJo');
    expect(texts(rfiThesis(a))).toEqual(['KJo는 UTG에서 절반만, HJ부터 항상 오픈합니다.']);
    expect(selfQuestion(a).text).toBe('다음에 KJo를 받으면: 내 자리가 HJ보다 앞인가요? UTG라면 절반만 오픈합니다.');
    expect(texts(compareCells(cellOf(a, 'rfi', 'UTG'), cellOf(a, 'rfi', 'HJ')))).toEqual([
      'HJ에서는 오픈합니다. UTG에서는 절반만 오픈합니다.',
      'UTG는 뒤에 5명, HJ는 4명이 남습니다.',
      '오픈 레인지는 UTG 18%, HJ 21%입니다.',
      'UTG는 오프수트 K를 KQo까지 항상, KJo는 절반만 오픈합니다.',
      'HJ는 오프수트 K를 KJo까지 항상, KTo는 절반만 오픈합니다.',
    ]);
    expect(texts(compareCells(cellOf(a, 'vs_open', 'BB', 'BTN'), cellOf(a, 'vs_open', 'BB', 'UTG')))).toEqual([
      'BTN 오픈에는 3벳과 콜을 반반 섞습니다. UTG 오픈에는 콜합니다.',
      'UTG는 18%, BTN은 46%를 오픈합니다.',
      '앞자리라 레인지가 강합니다. 뒷자리라 약한 패가 많이 섞여 있습니다.',
    ]);
    expect(sectionDigest(a.sections.vs_3bet).text).toBe('콜 3곳 · 폴드 12곳');
    expect(sectionDigestDetail(a.sections.vs_3bet)?.text).toBe('콜 3곳: BTN vs SB · BTN vs BB · SB vs BB');
    expect(sectionDigest(a.sections.vs_5bet).text).toBe('생기지 않는 상황');
    expect(sectionDigest(a.sections.vs_limp).text).toBe('BTN만 절반 레이즈 · BB는 폴드 없이 체크');
    expect(anchorCell(a, cellOf(a, 'rfi', 'UTG'))?.scenario).toEqual({ kind: 'rfi', hero: 'HJ' });
    expect(anchorCell(a, cellOf(a, 'vs_open', 'BB', 'BTN'))?.scenario).toEqual({ kind: 'vs_open', hero: 'BB', villain: 'CO' });
  });
  it('76s · Q9o · A5s · 55', () => {
    const s76 = handAtlas('76s');
    expect(texts(rfiThesis(s76)).join(' ')).toBe('76s는 어느 자리에서든 오픈합니다. 오픈을 맞으면 콜 9곳 · 3벳 1곳 · 폴드 5곳입니다.');
    expect(texts(compareCells(cellOf(s76, 'vs_3bet', 'CO', 'SB'), cellOf(s76, 'vs_3bet', 'CO', 'BTN')))).toEqual([
      'SB 3벳에는 절반만 콜합니다. BTN 3벳에는 폴드합니다.',
      'SB 상대로는 플랍 이후 내가 나중에, BTN 상대로는 먼저 액션합니다.',
      'SB의 3벳은 밸류와 블러프가 섞입니다. BTN의 3벳은 밸류 위주입니다.',
    ]);
    const q9 = handAtlas('Q9o');
    expect(texts(rfiThesis(q9)).join(' ')).toBe('Q9o는 BTN부터 오픈합니다. 앞에서는 폴드입니다.');
    expect(selfQuestion(q9).text).toBe('다음에 Q9o를 받으면: 내 자리가 BTN이나 SB인가요? 아니면 폴드입니다.');
    expect(texts(compareCells(cellOf(q9, 'vs_open', 'BB', 'HJ'), cellOf(q9, 'vs_open', 'BB', 'UTG')))).toEqual([
      'HJ 오픈에는 절반만 콜합니다. UTG 오픈에는 폴드합니다.',
      'UTG는 18%, HJ는 21%를 오픈합니다.',
    ]);
    const a5 = handAtlas('A5s');
    expect(texts(rfiThesis(a5)).join(' ')).toBe('A5s는 어느 자리에서든 오픈합니다. 오픈을 맞으면 어디서든 3벳합니다.');
    expect(selfQuestion(a5).text).toBe('다음에 A5s를 받으면: 앞에 오픈한 사람이 있나요? 있으면 3벳, 없으면 오픈입니다.');
    expect(sectionDigest(a5.sections.vs_3bet).text).toBe('15곳 전부 4벳 · 절반만 3곳');
    expect(texts(compareCells(cellOf(a5, 'vs_4bet', 'BTN', 'CO'), cellOf(a5, 'vs_4bet', 'BTN', 'HJ')).slice(0, 2))).toEqual(['둘 다 폴드입니다.', 'CO 상대로는 올인을 25% 섞습니다.']);
    const p55 = handAtlas('55');
    // 차이 레버 0개 → 결론만. 이유를 지어내지 않습니다.
    expect(texts(compareCells(cellOf(p55, 'vs_3bet', 'HJ', 'CO'), cellOf(p55, 'vs_3bet', 'HJ', 'BTN')))).toEqual(['BTN 3벳에는 절반만 콜합니다. CO 3벳에는 주로 폴드합니다.']);
    expect(sectionDigest(p55.sections.vs_limp).text).toBe('레이즈 3곳 · 폴드 1곳 · BB는 폴드 없이 체크');
    expect(texts(compareCells(cellOf(p55, 'vs_open', 'SB', 'CO'), cellOf(p55, 'vs_open', 'SB', 'BTN')))).toEqual([
      '둘 다 콜입니다.',
      'CO 상대로는 폴드를 50% 섞습니다.',
      'CO는 29%, BTN은 46%를 오픈합니다.',
    ]);
    expect(seatSummary(handAtlas('KTs'), 'SB').text).toBe('SB에서 KTs: 오픈 · UTG 오픈에는 폴드, HJ 오픈에는 절반만 3벳, CO 오픈부터 3벳 · 3벳에는 콜');
  });
});
