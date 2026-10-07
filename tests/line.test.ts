import { describe, expect, it } from 'vitest';
import { isReachable } from '../src/poker/atlas';
import { getChartCells, getChartDef, hasChart } from '../src/poker/data';
import { classifyHand, explainStep } from '../src/poker/explain';
import { ALL_HANDS } from '../src/poker/hands';
import { emWidth } from '../src/poker/ko';
import { boundaryAfter, capsuleLabel, isMonotone, lineCells, lineOf, lineSentence, nearMiss, stripView, type LineClaim, type LineDef, type LineSentence, type WeightWord } from '../src/poker/line';
import { AGGRESSION_ORDER, foldWeight, fullMix, restAction } from '../src/poker/range';
import { allScenarios, scenarioKey } from '../src/poker/scenarios';
import { seatLever, seatNumbers, acrossRow, siblingLine } from '../src/poker/sheet';
import { stepFor } from '../src/poker/trainer';
import { actionWeight, PARTIAL_THRESHOLD } from '../src/screens/quiz/grade';
import type { Action, HandName, Scenario } from '../src/poker/types';

/*
 * 줄 문장의 불변식 — docs/EXPLAIN_SPEC.md §7.2 의 1·2·3·6·7·8·9·10.
 * 재계산 코드는 line.ts 의 내부를 쓰지 않고 차트(getChartCells · fullMix · isReachable)만 씁니다 —
 * 같은 버그를 두 번 쓰지 않으려고요. 줄 정의(lineOf)만은 1번 테스트가 따로 고정합니다.
 */

const SCENARIOS = allScenarios().filter(hasChart);
const LINES: LineDef[] = (() => {
  const m = new Map<string, LineDef>();
  for (const h of ALL_HANDS) m.set(lineOf(h).id, lineOf(h));
  return [...m.values()];
})();
const agg = (a: Action) => AGGRESSION_ORDER.indexOf(a);

/** 독립 재계산: 줄의 도달 칸(스트립 순서)과 각 칸의 1순위·비중·비중어. */
interface Cell {
  hand: HandName;
  p: Action;
  w: number;
  full: boolean;
  mix: Array<{ action: Action; weight: number }>;
  word: WeightWord;
}
function cellsOf(s: Scenario, line: LineDef): Cell[] {
  const cells = getChartCells(s);
  const rest = restAction(getChartDef(s));
  return line.slots
    .filter((x) => x.inLine && x.hand && isReachable(s, x.hand).ok)
    .map((x) => {
      const mix = fullMix(cells[x.hand!]);
      const p = mix[0].action;
      const w = mix[0].weight;
      const s2 = mix[1];
      const word: WeightWord =
        w >= 0.999 ? 'full' : w >= 0.6 ? '주로' : s2 && Math.abs(s2.weight - w) < 0.01 && s2.action !== rest ? '반반' : p === rest ? '절반은' : '절반만';
      return { hand: x.hand!, p, w, full: w >= 0.999, mix, word };
    });
}

/** claim 하나가 차트에서 참인가. 거짓이면 이유 문자열. */
function checkClaim(s: Scenario, cs: Cell[], c: LineClaim): string | null {
  const rest = restAction(getChartDef(s));
  const idx = (h: HandName) => cs.findIndex((x) => x.hand === h);
  const same = (a: HandName[], b: HandName[]) => [...a].sort().join() === [...b].sort().join();
  switch (c.t) {
    case 'all':
      return cs.every((x) => x.p === c.action) ? null : 'all';
    case 'upto': {
      const i0 = c.from ? idx(c.from) : 0;
      const i1 = idx(c.to);
      if (i0 < 0 || i1 < 0 || i0 > i1) return 'upto: 칸 없음';
      for (let i = i0; i <= i1; i++) if (cs[i].p !== c.action) return `upto: ${cs[i].hand} 은 ${cs[i].p}`;
      if (!cs[i1].full) return `upto: ${c.to} full 아님`;
      const next = cs[i1 + 1];
      if (next && next.p === c.action && next.full) return `upto: 다음 칸 ${next.hand} 도 full-${c.action}`;
      return null;
    }
    case 'only':
      return same(cs.filter((x) => x.p === c.action).map((x) => x.hand), c.hands) ? null : 'only';
    case 'toEnd': {
      const i0 = idx(c.from);
      if (i0 < 0) return 'toEnd: 칸 없음';
      for (let i = i0; i < cs.length; i++) {
        if (cs[i].p !== c.action) return `toEnd: ${cs[i].hand}`;
        // '부터는 전부 〈계속 액션〉'은 full 까지 말합니다. 체크 꼬리('부터는 체크해요')는 1순위만 말합니다.
        if (c.action !== rest && !cs[i].full) return `toEnd: ${cs[i].hand} full 아님`;
      }
      return null;
    }
    case 'weight': {
      const x = cs[idx(c.hand)];
      return x && x.p === c.action && x.word === c.word ? null : `weight ${c.hand}`;
    }
    case 'minor':
      if (!cs.every((x) => x.p === rest)) return 'minor: rest 아닌 칸';
      return same(cs.filter((x) => x.mix.some((m) => m.action === c.action && m.weight > 0.001)).map((x) => x.hand), c.hands) ? null : 'minor';
    case 'rest':
      return cs.filter((x) => !c.except.includes(x.hand)).every((x) => x.p === c.action) ? null : 'rest';
  }
}

const HAND_RE = /[2-9TJQKA]{2}[so]?/g;

/** 문장 속 패 이름의 집합(X~Y 범위는 양 끝과 사이 칸까지 펼칩니다). */
function textHands(text: string, cs: Cell[]): Set<HandName> {
  const out = new Set<HandName>();
  const order = cs.map((x) => x.hand);
  const span = (a: number, b: number) => {
    for (let i = a; i <= b; i++) out.add(order[i]);
  };
  // 'X~Y' 와 'X부터 Y까지는'은 사이 칸까지, 'X부터는 …를 섞어요'는 줄 끝까지 부릅니다.
  for (const m of text.matchAll(/([2-9TJQKA]{2}[so]?)(?:~| ?부터 )([2-9TJQKA]{2}[so]?)/g)) span(order.indexOf(m[1]), order.indexOf(m[2]));
  for (const m of text.matchAll(/([2-9TJQKA]{2}[so]?)부터는 \S+ 섞어요/g)) span(order.indexOf(m[1]), order.length - 1);
  for (const m of text.match(HAND_RE) ?? []) out.add(m);
  return out;
}

function claimHands(claims: LineClaim[]): { all: Set<HandName>; mentioned: Set<HandName> } {
  const all = new Set<HandName>();
  const mentioned = new Set<HandName>();
  for (const c of claims) {
    const hs: HandName[] = c.t === 'upto' ? [c.to] : c.t === 'only' || c.t === 'minor' ? c.hands : c.t === 'toEnd' || c.t === 'weight' ? [c.t === 'toEnd' ? c.from : c.hand] : c.t === 'rest' ? c.except : [];
    for (const h of hs) {
      all.add(h);
      mentioned.add(h);
    }
    // upto 의 from 은 문장에 이름이 안 나올 수 있습니다(둘째 run 의 시작 칸).
    if (c.t === 'upto' && c.from) all.add(c.from);
  }
  return { all, mentioned };
}

/** 74 × 25 전부. */
const ALL: Array<{ s: Scenario; line: LineDef; sentence: LineSentence | null; cells: Cell[] }> = SCENARIOS.flatMap((s) => LINES.map((line) => ({ s, line, sentence: lineSentence(s, line), cells: cellsOf(s, line) })));

describe('line: 줄 정의 (§7.2-1)', () => {
  it('169개 패가 정확히 하나의 줄을 받고, 그 줄의 줄 칸에 자기 자신이 있다', () => {
    expect(LINES.length).toBe(25);
    expect(LINES.filter((l) => l.id === 'pair').length).toBe(1);
    expect(LINES.filter((l) => l.id === 'conn').length).toBe(1);
    expect(LINES.filter((l) => l.id.startsWith('s') && l.id !== 'conn').length).toBe(11); // 수티드 A~4
    expect(LINES.filter((l) => l.id.startsWith('o')).length).toBe(12); // 오프수트 A~3
    for (const h of ALL_HANDS) {
      const def = lineOf(h);
      expect(def.slots.length, h).toBe(13);
      expect(def.slots.filter((x) => x.inLine && x.hand === h).length, h).toBe(1);
      expect(lineOf(h)).toBe(def); // 같은 패는 언제나 같은 줄
      expect(def.id === 'conn', h).toBe(classifyHand(h) === 'suited_connector');
    }
    const conn = lineOf('76s');
    expect(conn.slots[0]).toEqual({ hand: null, inLine: false, label: '' });
    expect(conn.slots.slice(1, 5).map((x) => [x.hand, x.inLine])).toEqual([
      ['AKs', false],
      ['KQs', false],
      ['QJs', false],
      ['JTs', false],
    ]);
    expect(conn.slots.slice(5).every((x) => x.inLine)).toBe(true);
    expect(conn.slots[5].label).toBe('T9');
    expect(lineOf('KJo').slots.map((x) => x.label).join('')).toBe('AKQJT98765432');
    expect(lineOf('KJo').slots[2].hand).toBe('KQo');
    expect(lineOf('A5s').label).toBe('수티드 A');
    expect(lineOf('T8s').id).toBe('sT'); // 갭퍼는 높은 카드 행
  });
});

describe('line: 문장 존재 · 길이 (§7.2-2·3)', () => {
  it('도달 칸이 있으면 문장, 없으면 null — 1,089개, 서로 다름', () => {
    for (const { s, line, sentence, cells } of ALL) {
      expect(sentence !== null, `${scenarioKey(s)} ${line.id}`).toBe(cells.length > 0);
      expect(lineCells(s, line).map((c) => c.hand)).toEqual(cells.map((c) => c.hand));
    }
    const texts = ALL.flatMap((x) => (x.sentence ? [x.sentence.text] : []));
    expect(SCENARIOS.length).toBe(74);
    expect(texts.length).toBe(1089);
    expect(new Set(texts).size).toBe(1089);
  });

  it('줄 문장 · 형제 줄 ≤ 42em, 자리 문장 ≤ 46em, 레버 ≤ 30자, 숫자 줄 ≤ 34em · 폴백은 noLabel 1, cut 0', () => {
    const fallback = { noLabel: 0, cut: 0 };
    for (const { s, line, sentence } of ALL) {
      if (!sentence) continue;
      expect(emWidth(sentence.text), sentence.text).toBeLessThanOrEqual(42);
      if (sentence.fallback) fallback[sentence.fallback]++;
      const top = lineSentence(s, line, { topic: true });
      expect(emWidth(top!.text), top!.text).toBeLessThanOrEqual(42);
    }
    expect(fallback).toEqual({ noLabel: 1, cut: 0 });
    expect(ALL.find((x) => x.sentence?.fallback === 'noLabel')!.s).toEqual({ kind: 'vs_open', hero: 'SB', villain: 'BTN' });
    for (const s of SCENARIOS) {
      const n = seatNumbers(s).text;
      expect(emWidth(n), n).toBeLessThanOrEqual(34);
      const lever = seatLever(s);
      // '자'는 공백을 뺀 글자 수로 셉니다 — 스펙 §4.3 의 레버 'BB는 이미 1bb를 냈으니 1.5bb만 더 내면 돼요.'가 공백 포함 31자입니다.
      if (lever) expect(lever.text.replace(/\s/g, '').length, lever.text).toBeLessThanOrEqual(30);
      for (const hand of ALL_HANDS) {
        if (!isReachable(s, hand).ok) continue;
        const sib = siblingLine(s, hand);
        if (sib) expect(emWidth(sib.text), sib.text).toBeLessThanOrEqual(42);
        const across = acrossRow(s, hand).line.text;
        expect(emWidth(across), across).toBeLessThanOrEqual(46);
      }
    }
  });
});

describe('line: 주장 재계산 (§7.2-6)', () => {
  it('1,089개 문장의 claims 가 차트에서 다시 계산해도 전부 참이고, 문장 속 패 이름 = claims 의 패', () => {
    let n = 0;
    for (const { s, line, sentence, cells } of ALL) {
      if (!sentence) continue;
      n++;
      const where = `${scenarioKey(s)} ${line.id} [${sentence.frame}] ${sentence.text}`;
      expect(sentence.claims.length, where).toBeGreaterThan(0);
      for (const c of sentence.claims) expect(checkClaim(s, cells, c), `${where} ← ${JSON.stringify(c)}`).toBeNull();
      const inText = textHands(sentence.text, cells);
      const { all, mentioned } = claimHands(sentence.claims);
      for (const h of inText) expect(all.has(h), `${where}: 문장의 ${h} 가 claims 에 없음`).toBe(true);
      for (const h of mentioned) expect(inText.has(h), `${where}: claim 의 ${h} 가 문장에 없음`).toBe(true);
    }
    expect(n).toBe(1089);
  });

  it('형제 줄(topic)도 같은 claims 를 갖고 참이다', () => {
    for (const { s, line, cells } of ALL) {
      const top = lineSentence(s, line, { topic: true });
      if (!top) continue;
      for (const c of top.claims) expect(checkClaim(s, cells, c), `${scenarioKey(s)} ${line.id} ${top.text}`).toBeNull();
    }
  });
});

describe('line: 단서 일관성 (§7.2-7)', () => {
  it('explainStep(step).line.sentence 는 lineSentence(s, lineOf(hand)) 와 글자까지 같고, 같은 줄의 패끼리 같다', () => {
    let seen = 0;
    for (const s of SCENARIOS) {
      const byLine = new Map<string, string>();
      for (const hand of ALL_HANDS) {
        if (!isReachable(s, hand).ok) continue;
        const e = explainStep(stepFor(s, hand));
        const want = lineSentence(s, lineOf(hand))!.text;
        expect(e.line.sentence?.text, `${scenarioKey(s)} ${hand}`).toBe(want);
        const id = lineOf(hand).id;
        if (byLine.has(id)) expect(want).toBe(byLine.get(id));
        else byLine.set(id, want);
        expect(e.line.slots[e.line.ring].hand).toBe(hand);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(5000);
    // §3.6 같은 줄, 다른 칸: rfi UTG 의 KQo·KTo·K2o 도 KJo 와 같은 문장, 링만 움직입니다.
    const kj = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, 'KJo'));
    for (const h of ['KQo', 'KTo', 'K2o']) {
      const e = explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, h));
      expect(e.line.sentence!.text).toBe(kj.line.sentence!.text);
      expect(e.line.ring).not.toBe(kj.line.ring);
    }
    expect(['KQo', 'KTo', 'K2o'].map((h) => explainStep(stepFor({ kind: 'rfi', hero: 'UTG' }, h)).capsule.label)).toEqual(['오픈', '폴드', '폴드']);
  });
});

describe('line: 단조성 회귀 (§7.2-8)', () => {
  /** 옛 rowBoundary.monotone: 계속 비중만 보고 비증가인가. */
  const contMonotone = (cs: Cell[], rest: Action) => {
    const ws = cs.map((c) => 1 - (rest === 'fold' ? foldWeight(Object.fromEntries(c.mix.map((m) => [m.action, m.weight]))) : (c.mix.find((m) => m.action === rest)?.weight ?? 0)));
    return ws.every((w, i) => i === 0 || w <= ws[i - 1] + 1e-6);
  };

  it('계속 비중으로는 단조지만 1순위가 번갈아 나오는 9개 수티드 A 줄과 BB 커넥터 줄은 P4 이고 경계 막대가 없다', () => {
    const NINE = ['vs_open:BTN:CO', 'vs_open:BB:UTG', 'vs_open:BB:HJ', 'vs_open:BB:CO', 'vs_open:BB:BTN', 'vs_open:BB:SB', 'vs_3bet:BTN:SB', 'vs_3bet:BTN:BB', 'vs_3bet:SB:BB'];
    const sA = lineOf('A5s');
    for (const key of NINE) {
      const s = SCENARIOS.find((x) => scenarioKey(x) === key)!;
      const cs = cellsOf(s, sA);
      expect(contMonotone(cs, restAction(getChartDef(s))), key).toBe(true);
      expect(cs.every((c, i) => i === 0 || agg(c.p) <= agg(cs[i - 1].p)), key).toBe(false);
      expect(lineSentence(s, sA)!.frame, key).toBe('P4');
      expect(boundaryAfter(s, sA), key).toBeNull();
    }
    for (const key of ['vs_open:BB:BTN', 'vs_open:BB:SB']) {
      const s = SCENARIOS.find((x) => scenarioKey(x) === key)!;
      expect(lineSentence(s, lineOf('76s'))!.frame, key).toBe('P4');
      expect(boundaryAfter(s, lineOf('76s')), key).toBeNull();
    }
  });

  it('단조롭지 않은 줄은 33개: 수티드 A 31개 + BB vs BTN/SB 커넥터 2개, 전부 P4', () => {
    const non = ALL.filter((x) => x.cells.length && !isMonotone(lineCells(x.s, x.line)));
    expect(non.length).toBe(33);
    expect(non.filter((x) => x.line.id === 'sA').length).toBe(31);
    expect(non.filter((x) => x.line.id === 'conn').map((x) => scenarioKey(x.s)).sort()).toEqual(['vs_open:BB:BTN', 'vs_open:BB:SB']);
    for (const x of non) expect(x.sentence!.frame).toBe('P4');
    expect(ALL.filter((x) => x.sentence?.frame === 'P4').length).toBe(33);
  });

  it('경계 막대: 단조 줄, 계속 칸이 있고 마지막 계속 칸이 도달 가능한 마지막 칸이 아닐 때만', () => {
    for (const { s, line, cells } of ALL) {
      const b = boundaryAfter(s, line);
      const rest = restAction(getChartDef(s));
      const mono = cells.every((c, i) => i === 0 || agg(c.p) <= agg(cells[i - 1].p));
      const lastCont = cells.map((c) => c.p !== rest).lastIndexOf(true);
      const want = cells.length && mono && lastCont >= 0 && lastCont < cells.length - 1 ? line.slots.findIndex((x) => x.hand === cells[lastCont].hand) : null;
      expect(b, `${scenarioKey(s)} ${line.id}`).toBe(want);
    }
  });
});

describe('line: 캡슐 (§7.2-9)', () => {
  /** 혼합 모양: 1순위/2순위… 를 '계속'·'폴드(rest)'와 정수 %로. */
  const shape = (mix: Array<{ action: Action; weight: number }>, rest: Action) => mix.map((m) => `${m.action === rest ? 'R' : 'C'}${Math.round(m.weight * 100)}`).join('/');

  it('§2.2 의 혼합 모양마다 라벨이 고정이고, capsule.action === step.answer', () => {
    const counts = new Map<string, number>();
    const labelOf = new Map<string, Set<string>>();
    for (const s of SCENARIOS) {
      const rest = restAction(getChartDef(s));
      for (const hand of ALL_HANDS) {
        if (!isReachable(s, hand).ok) continue;
        const step = stepFor(s, hand);
        const e = explainStep(step);
        expect(e.capsule.action, `${scenarioKey(s)} ${hand}`).toBe(step.answer);
        expect(e.capsule.label.length).toBeLessThanOrEqual(8);
        const sh = shape(step.mixList, rest);
        if (step.mixList[0].weight >= 0.999) continue;
        counts.set(sh, (counts.get(sh) ?? 0) + 1);
        const pattern = e.capsule.label.replace(/(오픈|레이즈|콜|3벳|4벳|올인|폴드|체크)/g, 'A');
        labelOf.set(sh, new Set([...(labelOf.get(sh) ?? []), pattern]));
      }
    }
    // 차트에 실제로 있는 혼합은 7가지뿐입니다(도달 가능한 칸 기준). 칸 수는 실측값입니다.
    expect([...labelOf.keys()].sort()).toEqual(['R50/C25/C25', 'C50/C25/R25', 'C50/C50', 'C50/R50', 'C75/C25', 'C75/R25', 'R75/C25'].sort());
    expect(Object.fromEntries([...labelOf.entries()].map(([k, v]) => [k, [...v]]))).toEqual({
      'C75/C25': ['주로 A'],
      'C75/R25': ['주로 A'],
      'R75/C25': ['주로 A'],
      'C50/R50': ['절반만 A'],
      'C50/C50': ['A·A 반반'],
      'C50/C25/R25': ['절반만 A'],
      'R50/C25/C25': ['절반은 A'],
    });
    expect(Object.fromEntries(counts)).toEqual({ 'C75/C25': 150, 'C75/R25': 91, 'R75/C25': 82, 'C50/R50': 209, 'C50/C50': 83, 'C50/C25/R25': 13, 'R50/C25/C25': 3 });
    // 라벨 리터럴
    expect(capsuleLabel([{ action: 'fold', weight: 1 }], 'fold', 'rfi')).toBe('폴드');
    expect(capsuleLabel([{ action: 'raise', weight: 0.5 }, { action: 'fold', weight: 0.5 }], 'fold', 'vs_limp')).toBe('절반만 레이즈');
    expect(capsuleLabel([{ action: 'fourbet', weight: 0.5 }, { action: 'call', weight: 0.5 }], 'fold', 'cold_4bet')).toBe('4벳·콜 반반');
    expect(capsuleLabel([{ action: 'fold', weight: 0.5 }, { action: 'fourbet', weight: 0.25 }, { action: 'call', weight: 0.25 }], 'fold', 'vs_3bet')).toBe('절반은 폴드');
  });

  it('부분 정답 문장이 있는 칸 = 2순위 비중 ≥ PARTIAL_THRESHOLD 인 칸', () => {
    for (const s of SCENARIOS) {
      for (const hand of ALL_HANDS) {
        if (!isReachable(s, hand).ok) continue;
        const step = stepFor(s, hand);
        const e = explainStep(step);
        const a2 = step.mixList[1];
        const want = !!a2 && actionWeight(step, a2.action) >= PARTIAL_THRESHOLD;
        expect(!!e.mix?.partial, `${scenarioKey(s)} ${hand}`).toBe(want);
      }
    }
  });
});

describe('line: 경계 거리 꼬리표 (§7.2-10)', () => {
  it('단조 줄에서만 null 이 아니고, 한 칸 밖인 패의 1순위는 rest 이며 바로 앞 도달 칸이 마지막 계속 칸이다', () => {
    let near = 0;
    for (const s of SCENARIOS) {
      const rest = restAction(getChartDef(s));
      for (const hand of ALL_HANDS) {
        if (!isReachable(s, hand).ok) continue;
        const nm = nearMiss(s, hand);
        if (!nm) continue;
        const cells = cellsOf(s, lineOf(hand));
        expect(cells.every((c, i) => i === 0 || agg(c.p) <= agg(cells[i - 1].p)), `${scenarioKey(s)} ${hand}`).toBe(true);
        const i = cells.findIndex((c) => c.hand === hand);
        const lastCont = cells.map((c) => c.p !== rest).lastIndexOf(true);
        if (nm === '한 칸 밖') {
          near++;
          expect(cells[i].p, `${scenarioKey(s)} ${hand}`).toBe(rest);
          expect(i - 1).toBe(lastCont);
        } else expect(i).toBe(lastCont);
      }
    }
    expect(near).toBeGreaterThan(100);
    expect(nearMiss({ kind: 'rfi', hero: 'UTG' }, 'KTo')).toBe('한 칸 밖');
    expect(nearMiss({ kind: 'vs_open', hero: 'SB', villain: 'UTG' }, 'KTs')).toBe('한 칸 밖');
    expect(nearMiss({ kind: 'rfi', hero: 'UTG' }, 'KJo')).toBe('마지막 칸');
    expect(nearMiss({ kind: 'rfi', hero: 'UTG' }, 'K9o')).toBeNull();
    // 단조롭지 않은 줄에는 꼬리표가 없습니다.
    expect(nearMiss({ kind: 'vs_3bet', hero: 'CO', villain: 'BTN' }, 'A6s')).toBeNull();
  });

  it('stripView: 유령 칸에는 색이 없고, 도달 불가 칸은 점선, 링은 이 패', () => {
    const v = stripView({ kind: 'vs_4bet', hero: 'HJ', villain: 'UTG' }, 'QQ');
    expect(v.slots.map((x) => x.role)).toEqual(['cell', 'cell', 'cell', 'cell', ...Array(9).fill('unreachable')]);
    expect(v.ring).toBe(2);
    expect(v.boundaryAfter).toBeNull();
    const c = stripView({ kind: 'vs_open', hero: 'BTN', villain: 'HJ' }, '76s');
    expect(c.slots[0].role).toBe('empty');
    expect(c.slots.slice(1, 5).every((x) => x.role === 'ghost' && x.mix === null)).toBe(true);
    expect(c.slots[8].hand).toBe('76s');
    expect(c.ring).toBe(8);
    expect(c.boundaryAfter).toBe(10); // 54s 뒤
  });
});
