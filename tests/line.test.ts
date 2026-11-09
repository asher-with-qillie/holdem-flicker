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

/** 독립 재계산: 줄의 도달 칸(스트립 순서)과 각 칸의 1순위·비중·비중어. split = 세 액션 칸(1순위 절반 + 나머지 둘)의 액션들. */
interface Cell {
  hand: HandName;
  slot: number;
  p: Action;
  w: number;
  full: boolean;
  mix: Array<{ action: Action; weight: number }>;
  word: WeightWord;
  split: Action[] | null;
}
function cellsOf(s: Scenario, line: LineDef): Cell[] {
  const cells = getChartCells(s);
  const rest = restAction(getChartDef(s));
  return line.slots.flatMap((x, slot) => {
    if (!x.inLine || !x.hand || !isReachable(s, x.hand).ok) return [];
    const mix = fullMix(cells[x.hand]);
    const p = mix[0].action;
    const w = mix[0].weight;
    const s2 = mix[1];
    const word: WeightWord =
      w >= 0.999 ? 'full' : w >= 0.6 ? '주로' : s2 && Math.abs(s2.weight - w) < 0.01 && s2.action !== rest ? '반반' : p === rest ? '절반은' : '절반만';
    const nz = mix.filter((m) => m.weight > 0.001);
    return [{ hand: x.hand, slot, p, w, full: w >= 0.999, mix, word, split: nz.length >= 3 ? nz.map((m) => m.action) : null }];
  });
}
/** 줄 칸 중 도달할 수 없는 칸(스트립의 점선)의 slot. */
const holesOf = (s: Scenario, line: LineDef): number[] => line.slots.flatMap((x, i) => (x.inLine && x.hand && !isReachable(s, x.hand).ok ? [i] : []));

/** 이름 없이 덮어도 되는 비중의 하한('주로'). */
const STRONG = 0.6 - 1e-9;

const ACT_WORD: Record<Action, string> = { raise: '오픈', call: '콜', threebet: '3벳', fourbet: '4벳', allin: '올인', fold: '폴드', check: '체크' };
const actOf = (a: Action, s: Scenario) => (a === 'raise' && s.kind === 'vs_limp' ? '레이즈' : ACT_WORD[a]);
// P0h 의 섞는 쪽('3벳을 25% 섞고' · '콜도 25% 섞어요')도 비중을 말하는 마디입니다. 옛 '가끔'은 비중어 밖이라 없앴습니다(감사).
const WEIGHT_WORDS = ['주로', '절반만', '절반은', '반반', '% 섞'];

/**
 * 문장을 쉼표 마디로 나누고, 마디마다 그 안에서 **이름으로 부른** 칸을 찾습니다. 'X~Y'는 사이 칸까지 이름입니다.
 * 범위의 끝('X까지' · 'X까지는' · 'X부터는')은 이름이 아니라 경계입니다 — 그 칸은 범위가 덮습니다.
 */
function namedInClauses(text: string, cs: Cell[]): Array<{ clause: string; hands: HandName[] }> {
  const order = cs.map((x) => x.hand);
  return text
    .replace(/\.$/, '')
    .split(', ')
    .map((clause) => {
      const hands: HandName[] = [];
      for (const m of clause.matchAll(/(?<!\d)([2-9TJQKA]{2}[so]?)(?:~([2-9TJQKA]{2}[so]?))?(?![\d%]|까지|부터는)/g)) {
        if (m[2]) {
          const i0 = order.indexOf(m[1]);
          const i1 = order.indexOf(m[2]);
          for (let i = i0; i <= i1; i++) hands.push(order[i]);
        } else hands.push(m[1]);
      }
      return { clause, hands };
    });
}

/**
 * 문장 하나의 claims 를 차트에서 다시 계산해 대조합니다. 틀린 점을 전부 돌려줍니다(없으면 빈 배열).
 *
 * claim 마다의 사실에 더해 **이름 규칙**(docs/EXPLAIN_SPEC.md §3.4)을 칸마다 봅니다:
 *  - 비중어와 함께 이름을 댄 칸(weight · minor)은 그 비중어가 맞으면 됩니다.
 *  - 이름만 댄 칸(only)은 full 이어야 합니다 — '주로' 칸은 '주로'와 함께 부릅니다(THEORY_SPEC §5).
 *  - 범위로 덮은 칸(all · upto · toEnd · rest)은 그 범위가 말하는 액션이 1순위이고 비중이 0.6 이상이어야 하고,
 *    '전부'(whole)면 full 이어야 합니다.
 *  - 문장이 아무 말도 하지 않는 칸은 나머지(rest)로 읽히므로 1순위가 rest 이고 비중이 0.6 이상이어야 합니다.
 *  - 문장에 '전부'가 있으면 whole claim 이 있고, 없으면 없습니다.
 * 그리고 줄 문장의 모호함(THEORY_SPEC §5)을 글자로 봅니다:
 *  (a) '전부'(whole)는 도달할 수 없는 칸을 덮지 않고, 도달 불가 칸이 있는 줄은 줄 이름 전체로 덮지 않습니다(all 없음).
 *  (b) 세 액션 칸은 split 으로만 — 그 마디에 '절반은 〈1순위〉', 다음 마디가 '나머지를 〈둘〉로 나눠요' 또는 '절반은 〈둘〉'.
 *  (c) '나머지는'은 비중어가 있는 마디 바로 뒤에 오지 않습니다.
 *  (d) 'X만 V하고' 뒤에 같은 V 의 비중어('절반만 V' · 'V과 …를 반반')가 오지 않습니다.
 *  (e) 이름으로 부른 칸은 그 마디에 제 비중어가 있습니다(주로 · 절반만 · 절반은 · 반반, rest 쪽 주로는 섞는 쪽의 비중 '…를 25% 섞고'도).
 */
function checkSentence(s: Scenario, cs: Cell[], text: string, claims: LineClaim[], holes: number[] = []): string[] {
  const rest = restAction(getChartDef(s));
  const err: string[] = [];
  const idx = (h: HandName) => cs.findIndex((x) => x.hand === h);
  const same = (a: HandName[], b: HandName[]) => [...a].sort().join() === [...b].sort().join();
  const cover = new Map<HandName, Array<{ action: Action; whole: boolean; by: string }>>();
  const named = new Map<HandName, 'word' | 'bare'>();
  const add = (i: number, action: Action, whole: boolean, by: string) => cover.set(cs[i].hand, [...(cover.get(cs[i].hand) ?? []), { action, whole, by }]);
  for (const c of claims) {
    switch (c.t) {
      case 'all':
        if (holes.length) err.push('(a) 도달 불가 칸이 있는 줄을 줄 이름 전체로 덮음');
        cs.forEach((_, i) => add(i, c.action, c.whole, 'all'));
        break;
      case 'upto': {
        const i0 = c.from ? idx(c.from) : 0;
        const i1 = idx(c.to);
        if (i0 < 0 || i1 < 0 || i0 > i1) {
          err.push(`upto ${c.from}→${c.to}: 칸 없음`);
          break;
        }
        for (let i = i0; i <= i1; i++) add(i, c.action, false, `upto ${c.to}`);
        const next = cs[i1 + 1];
        if (next && next.p === c.action && next.full) err.push(`upto: 다음 칸 ${next.hand} 도 full-${c.action}`);
        break;
      }
      case 'toEnd': {
        const i0 = idx(c.from);
        if (i0 < 0) err.push(`toEnd ${c.from}: 칸 없음`);
        else {
          for (let i = i0; i < cs.length; i++) add(i, c.action, c.whole, `toEnd ${c.from}`);
          if (c.whole && holes.some((h) => h > cs[i0].slot)) err.push(`(a) '${c.from}부터는 전부'가 도달 불가 칸까지 덮음`);
        }
        break;
      }
      case 'rest':
        if (c.whole && holes.length) err.push("(a) '나머지는 전부'가 도달 불가 칸까지 덮음");
        cs.forEach((x, i) => !c.except.includes(x.hand) && add(i, c.action, c.whole, 'rest'));
        break;
      case 'only':
        if (!same(cs.filter((x) => x.p === c.action).map((x) => x.hand), c.hands)) err.push(`only ${c.action}`);
        for (const h of c.hands) if (!named.has(h)) named.set(h, 'bare');
        break;
      case 'weight': {
        const x = cs[idx(c.hand)];
        if (!x || x.p !== c.action || x.word !== c.word) err.push(`weight ${c.hand}: ${x?.p} ${x?.word}`);
        if (x?.split) err.push(`(b) ${c.hand}: 세 액션 칸(${x.split})을 비중어 하나로 부름`);
        named.set(c.hand, 'word');
        break;
      }
      case 'split': {
        const x = cs[idx(c.hand)];
        if (!x || x.split?.join() !== c.actions.join() || Math.abs(x.w - 0.5) > 0.01) err.push(`split ${c.hand}: ${x?.split} ${x?.w}`);
        named.set(c.hand, 'word');
        break;
      }
      case 'minor': {
        if (!cs.every((x) => x.p === rest)) err.push('minor: rest 아닌 칸');
        const has = (x: Cell) => x.mix.some((m) => c.actions.includes(m.action) && m.weight > 0.001);
        if (!same(cs.filter(has).map((x) => x.hand), c.hands)) err.push('minor: 칸');
        const used = new Set(cs.filter((x) => c.hands.includes(x.hand)).flatMap((x) => x.mix.filter((m) => m.action !== rest && m.weight > 0.001).map((m) => m.action)));
        if (!same([...used], c.actions)) err.push(`minor: 액션 ${[...used]} ≠ ${c.actions}`);
        for (const h of c.hands) {
          if (cs[idx(h)]?.split) err.push(`(b) ${h}: 세 액션 칸을 섞는 쪽 하나로 부름`);
          named.set(h, 'word');
        }
        break;
      }
    }
  }
  for (const x of cs) {
    const n = named.get(x.hand);
    if (n) {
      if (n === 'bare' && !x.full) err.push(`(e) ${x.hand}: ${x.word} 칸인데 비중어 없이 이름만`);
      continue;
    }
    const cv = cover.get(x.hand);
    if (!cv) {
      if (x.p !== rest || x.w < STRONG) err.push(`${x.hand}: 문장이 말하지 않는 칸(= ${rest})인데 ${x.p} ${x.word}`);
      continue;
    }
    for (const k of cv) {
      if (k.action !== x.p) err.push(`${x.hand}: ${k.by} 는 ${k.action} 인데 칸은 ${x.p}`);
      else if (x.w < STRONG) err.push(`${x.hand}: ${k.by} 가 ${x.word} 칸을 이름 없이 덮음`);
      else if (k.whole && !x.full) err.push(`${x.hand}: '전부'인데 ${x.word}`);
    }
  }
  const whole = claims.some((c) => 'whole' in c && c.whole);
  if (text.includes('전부') !== whole) err.push(`'전부' 글자(${text.includes('전부')}) ≠ claims(${whole})`);
  // 비중어 claim 은 그 말이 문장에 있어야 합니다('콜을 섞어요'처럼 비중어 없이 뭉뚱그리지 않게).
  for (const c of claims) {
    if (c.t === 'weight' && c.word !== 'full' && !text.includes(c.word)) err.push(`weight ${c.hand}: '${c.word}'가 문장에 없음`);
    if (c.t === 'minor') {
      // 섞는 쪽은 비중과 함께('3벳을 25% 섞고'). 칸마다 섞는 비중의 합이 같으면 그 %가 문장에 있어야 하고, 문장의 '% 섞'은 그 값뿐입니다.
      const ws = c.hands.map((h) => cs[idx(h)]?.mix.filter((m) => m.action !== rest && m.weight > 0.001).reduce((t, m) => t + m.weight, 0) ?? 0);
      const same = ws.every((w) => Math.abs(w - ws[0]) < 0.01);
      if (!text.includes('섞')) err.push("minor: 섞는 쪽이 문장에 없음");
      if (text.includes('가끔')) err.push("minor: 비중어 밖의 '가끔'");
      if (same && !text.includes(`${Math.round(ws[0] * 100)}% 섞`)) err.push(`minor: 섞는 비중 ${Math.round(ws[0] * 100)}%가 문장에 없음`);
      for (const m of text.matchAll(/(\d+)% 섞/g)) if (!same || Number(m[1]) !== Math.round(ws[0] * 100)) err.push(`minor: '${m[0]}'가 차트(${ws.map((w) => Math.round(w * 100))})와 다름`);
    }
  }
  // 마디 단위 글자 검사(THEORY_SPEC §5).
  const clauses = namedInClauses(text, cs);
  clauses.forEach(({ clause, hands }, i) => {
    for (const h of hands) {
      const x = cs[idx(h)];
      if (!x) continue;
      if (x.split) {
        // (b) 'KQo는 절반은 콜하고, 나머지를 3벳과 폴드로 나눠요' · 'AJo는 절반은 콜, 절반은 4벳·폴드(예요)'
        const [a1, ...others] = x.split.map((a) => actOf(a, s));
        const next = clauses[i + 1]?.clause ?? '';
        const solo = new RegExp(`^나머지를 ${others.slice(0, -1).join('·')}[과와] ${others[others.length - 1]}(으로|로) 나눠요`);
        const noun = new RegExp(`^절반은 ${others.join('·')}`);
        if (!clause.includes(`절반은 ${a1}`) || !(solo.test(next) || noun.test(next))) err.push(`(b) ${h}: 세 액션 칸의 나눔이 문장에 없음 — ${clause} / ${next}`);
      } else if (x.word === '주로') {
        if (!clause.includes('주로') && !(x.p === rest && clause.includes('% 섞'))) err.push(`(e) ${h}: 주로 칸인데 마디에 '주로'가 없음 — ${clause}`);
      } else if (x.word !== 'full' && !clause.includes(x.word)) err.push(`(e) ${h}: ${x.word} 칸인데 마디에 '${x.word}'가 없음 — ${clause}`);
    }
    // (c) 비중어 마디 바로 뒤의 '나머지는' — "그 칸의 나머지 절반"으로도 읽힙니다.
    if (clause.startsWith('나머지는') && i > 0 && WEIGHT_WORDS.some((w) => clauses[i - 1].clause.includes(w))) err.push(`(c) 비중어 뒤 '나머지는' — ${clauses[i - 1].clause}, ${clause}`);
    // '나머지를'은 세 액션 칸의 나눔('절반은 콜하고, 나머지를 …로 나눠요')에만 씁니다.
    if (clause.startsWith('나머지를') && !/절반은 \S+하고$/.test(clauses[i - 1]?.clause ?? '')) err.push(`'나머지를'이 세 액션 칸 나눔 밖에 있음 — ${clause}`);
  });
  // (d) 'X만 V하고, Y는 절반만 V' — '만'과 뒤 절이 서로 어긋납니다.
  for (const m of text.matchAll(/만 (오픈|레이즈|콜|3벳|4벳|올인)하고, (.*)$/g)) {
    const [, act, tail] = m;
    if (new RegExp(`(주로|절반만|절반은) ${act}|${act}[과와] \\S+[을를] 반반|\\S+[과와] ${act}[을를] 반반|${act}·\\S+ 반반|\\S+·${act} 반반`).test(tail)) err.push(`(d) '만 ${act}' 뒤에 같은 액션의 비중어 — ${text}`);
  }
  // (f) 콜론 머리표는 문장이 아닙니다.
  if (text.includes(':')) err.push(`(f) 콜론 머리표 — ${text}`);
  // (a) 'X~Y' · 'X부터 Y까지'는 스트립에서 사이 칸까지 덮습니다 — 사이에 도달 불가 칸(점선)이 끼면 안 됩니다('T9s~54s'인데 98s·87s 는 못 옴).
  for (const m of text.matchAll(/([2-9TJQKA]{2}[so]?)(?:~| ?부터 )([2-9TJQKA]{2}[so]?)/g)) {
    const a = cs[idx(m[1])];
    const b = cs[idx(m[2])];
    if (a && b && holes.some((h) => h > a.slot && h < b.slot)) err.push(`(a) '${m[0]}'가 도달 불가 칸까지 덮음`);
  }
  return err;
}

// 숫자 비중('콜을 25% 섞고')의 '25'는 패 이름이 아닙니다 — 앞뒤가 숫자나 %인 두 글자는 빼요(패 이름 뒤에는 %가 오지 않아요).
const HAND_RE = /(?<!\d)[2-9TJQKA]{2}[so]?(?![\d%])/g;

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

function claimHands(claims: LineClaim[], cs: Cell[]): { all: Set<HandName>; mentioned: Set<HandName> } {
  const all = new Set<HandName>();
  const mentioned = new Set<HandName>();
  const order = cs.map((x) => x.hand);
  for (const c of claims) {
    const hs: HandName[] =
      c.t === 'upto' ? [c.to] : c.t === 'only' || c.t === 'minor' ? c.hands : c.t === 'toEnd' ? [c.from] : c.t === 'weight' || c.t === 'split' ? [c.hand] : c.t === 'rest' ? c.except : [];
    for (const h of hs) {
      all.add(h);
      mentioned.add(h);
    }
    // upto 의 from 과 사이 칸은 문장에 이름이 안 나올 수 있습니다('A9o까지는 콜' — 앞 항목 다음 칸부터).
    // 'X·Y는 4벳'처럼 양 끝을 다 부르면 둘 다 문장에 있습니다.
    if (c.t === 'upto') for (let i = c.from ? order.indexOf(c.from) : 0; i <= order.indexOf(c.to); i++) all.add(order[i]);
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
    // 서로 다릅니다 — 단, 도달 칸이 줄의 일부뿐이라 칸 이름으로 말하는 두 줄의 도달 칸이 똑같으면 같은 문장이 맞습니다
    // (THEORY_SPEC §5 (a)): vs_4bet SB:CO 의 커넥터 줄과 수티드 T 줄은 둘 다 T9s 하나만 와서 'SB는 CO 4벳에 T9s를 폴드해요.'
    const byText = new Map<string, string[]>();
    for (const x of ALL) if (x.sentence) byText.set(x.sentence.text, [...(byText.get(x.sentence.text) ?? []), `${scenarioKey(x.s)}|${x.cells.map((c) => c.hand).join()}`]);
    const dup = [...byText.entries()].filter(([, ks]) => ks.length > 1);
    for (const [t, ks] of dup) expect(new Set(ks).size, `${t}: ${ks}`).toBe(1);
    expect(dup.map(([t]) => t)).toEqual(['SB는 CO 4벳에 T9s를 폴드해요.']);
    expect(byText.size).toBe(1088);
  });

  it('줄 문장 · 형제 줄 ≤ 42em, 자리 문장 ≤ 46em, 레버 ≤ 30자, 숫자 줄 ≤ 34em · 폴백 실측', () => {
    const fallback = { noLabel: 0, noCtx: 0, noSubj: 0 };
    for (const { s, line, sentence } of ALL) {
      if (!sentence) continue;
      expect(emWidth(sentence.text), sentence.text).toBeLessThanOrEqual(42);
      if (sentence.fallback) fallback[sentence.fallback]++;
      const top = lineSentence(s, line, { topic: true });
      expect(emWidth(top!.text), top!.text).toBeLessThanOrEqual(42);
    }
    // 폴백 실측(§9, THEORY_SPEC §5): 틀 문장의 noLabel 은 vs_open SB:BTN 커넥터 한 줄. 콜드 4벳 AKo 세 줄은 주어를
    // '앞에서 3벳이 나오면' → '오픈과 3벳 뒤에'로 줄이면서(앞의 오픈까지 말하고 더 짧아요) 줄 이름을 되찾았습니다(28 → 24).
    // 칸 나열 꼴은 noLabel 23 · noCtx 8 · noSubj 2 — 주로 칸에 '주로'를 붙이고(e) 세 액션 칸의 나눔을 부르느라(b) 길어졌습니다.
    // noSubj 둘(vs_3bet UTG:CO · vs_open BTN:HJ 의 수티드 A)은 '〈자리〉에서'를 붙이면 42em 을 넘습니다.
    expect(fallback).toEqual({ noLabel: 24, noCtx: 8, noSubj: 2 });
    expect(ALL.filter((x) => x.sentence?.fallback === 'noSubj').map((x) => `${scenarioKey(x.s)} ${x.line.id}`)).toEqual(['vs_3bet:UTG:CO sA', 'vs_open:BTN:HJ sA']);
    expect(ALL.filter((x) => x.sentence?.fallback === 'noLabel' && x.sentence.form === 'frame').map((x) => scenarioKey(x.s))).toEqual(['vs_open:SB:BTN']);
    const forms: Record<string, number> = {};
    for (const x of ALL) if (x.sentence) forms[x.sentence.form] = (forms[x.sentence.form] ?? 0) + 1;
    expect(forms).toEqual({ frame: 992, except: 4, list: 93 });
    // noCtx · noSubj 는 칸 나열 꼴에서만. noCtx 는 '〈내 자리〉에서 …'로 시작하는 문장이고(옛 'HJ:' 머리표 없음),
    // noSubj 는 그래도 넘치는 줄에서 주어를 뺀 문장입니다 — 리빌 바로 위 상황 줄이 내 자리와 상대를 말합니다.
    for (const x of ALL.filter((y) => y.sentence?.fallback === 'noCtx' || y.sentence?.fallback === 'noSubj')) {
      expect(x.sentence!.form).toBe('list');
      expect(x.sentence!.text).not.toMatch(/:/);
      if (x.sentence!.fallback === 'noCtx') expect(x.sentence!.text.startsWith(`${x.s.hero}에서 `), x.sentence!.text).toBe(true);
      else expect(x.sentence!.text, x.sentence!.text).toMatch(/^[2-9TJQKA]{2}[so]?/);
    }
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
  it('1,089개 문장의 claims 가 차트에서 다시 계산해도 전부 참이고 이름 규칙을 지키며, 문장 속 패 이름 = claims 의 패', () => {
    let n = 0;
    for (const { s, line, sentence, cells } of ALL) {
      if (!sentence) continue;
      n++;
      const where = `${scenarioKey(s)} ${line.id} [${sentence.frame}] ${sentence.text}`;
      expect(sentence.claims.length, where).toBeGreaterThan(0);
      expect(checkSentence(s, cells, sentence.text, sentence.claims, holesOf(s, line)), where).toEqual([]);
      const inText = textHands(sentence.text, cells);
      const { all, mentioned } = claimHands(sentence.claims, cells);
      for (const h of inText) expect(all.has(h), `${where}: 문장의 ${h} 가 claims 에 없음`).toBe(true);
      for (const h of mentioned) expect(inText.has(h), `${where}: claim 의 ${h} 가 문장에 없음`).toBe(true);
    }
    expect(n).toBe(1089);
  });

  it('형제 줄(topic)도 참이고 이름 규칙을 지킨다', () => {
    for (const { s, line, cells } of ALL) {
      const top = lineSentence(s, line, { topic: true });
      if (!top) continue;
      expect(checkSentence(s, cells, top.text, top.claims, holesOf(s, line)), `${scenarioKey(s)} ${line.id} ${top.text}`).toEqual([]);
    }
  });

  it('섞인 칸(비중 ≤ 0.5)은 하나도 빠짐없이 문장에 이름이 나온다 — 리빌에서 내 패가 섞인 칸이면 문장이 그 패를 부른다', () => {
    let mixed = 0;
    for (const { s, line, sentence, cells } of ALL) {
      if (!sentence) continue;
      const inText = textHands(sentence.text, cells);
      for (const c of cells) {
        if (c.w >= STRONG) continue;
        mixed++;
        expect(inText.has(c.hand), `${scenarioKey(s)} ${line.id} ${c.hand}(${c.word}): ${sentence.text}`).toBe(true);
      }
    }
    expect(mixed).toBeGreaterThan(250);
  });

  it('리뷰가 짚은 문장들 (§9)', () => {
    const at = (key: string, hand: string) => lineSentence(SCENARIOS.find((x) => scenarioKey(x) === key)!, lineOf(hand))!.text;
    // '전부'가 50/50 칸을 덮던 P1
    expect(at('vs_open:SB:CO', 'A7s')).toBe('SB는 CO 오픈에 수티드 A를 3벳하고, A8s부터 A6s까지는 절반만 3벳해요.');
    // '까지'가 줄 첫 칸에 붙고 run 1 의 섞인 꼬리를 버리던 P3
    expect(at('vs_open:BB:UTG', 'AQo')).toBe('BB는 UTG 오픈에 AKo는 3벳, AQo는 3벳·콜 반반, A9o까지는 콜, A8o는 절반만 콜해요.');
    // 마지막 계속 run 의 섞인 꼬리(경계 막대 칸)를 부른다
    expect(at('vs_3bet:UTG:HJ', '77')).toBe('UTG는 HJ 3벳에 KK까지는 4벳, QQ는 4벳·콜 반반, 88까지는 콜, 77은 절반만 콜해요.');
    // '그 밖' 꼬리('콜을 섞어요') 대신 앞쪽 '주로' 칸을 '까지'에 넣는다
    expect(at('vs_open:BB:UTG', '76s')).toBe('BB는 UTG 오픈에 수티드 커넥터를 54s까지 콜하고, 43s는 절반만 콜해요.');
    expect(at('vs_open:BB:SB', 'QTs')).toBe('BB는 SB 오픈에 수티드 Q 중 QJs는 주로 3벳, QTs는 3벳·콜 반반, Q9s부터는 콜해요.');
    // P0h: 폴드 50 · 3벳 25 · 콜 25 인 칸 — '3벳이나 콜을 섞고'로 줄이지 않고 나눔을 부릅니다(THEORY_SPEC §5)
    expect(at('vs_open:HJ:UTG', 'KQo')).toBe('HJ는 UTG 오픈에 오프수트 K 중 KQo는 절반은 폴드하고, 나머지를 3벳과 콜로 나눠요.');
    // 섞인 칸이 사이에 낀 줄: '나머지 전부' 꼴
    expect(at('vs_limp:BTN', 'A7s')).toBe('BTN은 림프에 수티드 A를 레이즈하고, A7s·A6s·A3s·A2s는 절반만 레이즈해요.');
  });
});

describe('line: 줄 문장의 모호함 (THEORY_SPEC §5)', () => {
  const at = (key: string, hand: string, topic = false) => lineSentence(SCENARIOS.find((x) => scenarioKey(x) === key)!, lineOf(hand), { topic })!.text;

  it("(a) 도달 칸이 줄의 일부뿐이면 '전부'나 줄 이름 대신 칸 이름으로", () => {
    expect(at('vs_5bet:CO:SB', 'AA')).toBe('CO는 SB 올인에 AA~QQ를 콜해요.');
    expect(at('vs_5bet:UTG:HJ', 'AKo')).toBe('UTG는 HJ 올인에 AKo를 폴드해요.');
    expect(at('vs_3bet:BTN:BB', '76s')).toBe('BTN은 BB 3벳에 T9s~54s를 콜해요.');
    expect(at('vs_3bet:UTG:HJ', 'KQo', true)).toBe('오프수트 K는 KQo·KJo를 폴드해요.');
    // 칸 이름 범위도 slot 으로: 98s·87s 가 못 오는 줄은 'T9s~54s'가 아니라 'T9s·76s~54s'.
    expect(at('vs_4bet:BB:SB', 'T9s')).toBe('BB는 SB 4벳에 T9s·76s~54s를 폴드해요.');
    // '그 아래 칸은'도 도달 불가 칸을 덮지 않게 — 그 아래 도달 칸이 전부 full 폴드면 이름으로, 하나도 없으면 그 절 없이.
    expect(at('vs_4bet:BTN:UTG', 'AKo')).toBe('BTN은 UTG 4벳에 오프수트 A 중 AKo는 올인과 콜을 반반 섞고, AQo는 폴드해요.');
    expect(at('vs_3bet:UTG:HJ', 'T9s')).toBe('UTG는 HJ 3벳에 수티드 커넥터 중 T9s는 절반만 콜하고, 98s~65s는 폴드해요.');
    expect(at('vs_5bet:UTG:SB', 'AKo')).toBe('UTG는 SB 올인에 AKo를 주로 폴드하고, 콜도 25% 섞어요.');
    expect(at('vs_5bet:UTG:SB', 'AKo', true)).toBe('오프수트 A는 AKo를 주로 폴드하고, 콜도 25% 섞어요.');
    // 전수: 도달 불가 칸이 있는 줄의 문장에는 '전부'도, 줄 이름 전체를 덮는 claim(all)도 없습니다(checkSentence 가 claims 로도 봅니다).
    let n = 0;
    for (const { s, line, sentence } of ALL) {
      if (!sentence || !holesOf(s, line).length) continue;
      n++;
      expect(sentence.text, `${scenarioKey(s)} ${line.id}`).not.toMatch(/전부/);
      expect(sentence.claims.some((c) => c.t === 'all')).toBe(false);
    }
    expect(n).toBeGreaterThan(100);
    // 전수: '그 아래 칸은'이 가리키는 도달 칸이 있고, 그 사이에 도달 불가 칸이 끼면 이름으로 못 부르는 칸('주로 폴드')이 있을 때뿐입니다.
    const rest = (s: Scenario) => restAction(getChartDef(s));
    let below = 0;
    for (const { s, line, cells } of ALL) {
      for (const t of [lineSentence(s, line)?.text, lineSentence(s, line, { topic: true })?.text]) {
        if (!t?.includes('그 아래 칸은')) continue;
        const named = textHands(t.split('그 아래 칸은')[0], cells);
        const last = Math.max(...cells.flatMap((c, i) => (named.has(c.hand) ? [i] : [])));
        const under = cells.slice(last + 1);
        expect(under.length, t).toBeGreaterThan(0);
        if (holesOf(s, line).some((h) => h > cells[last].slot)) {
          below++;
          expect(under.some((c) => c.p !== rest(s) || !c.full), `${scenarioKey(s)} ${t}`).toBe(true);
        }
      }
    }
    expect(below).toBe(10);
  });

  it('(b) 세 액션 칸은 나눔을 이름으로 — 비중어 하나로 줄이지 않습니다', () => {
    expect(at('vs_open:CO:UTG', 'KQo')).toBe('CO는 UTG 오픈에 오프수트 K 중 KQo는 절반은 콜하고, 나머지를 3벳과 폴드로 나눠요.');
    expect(at('vs_3bet:BTN:BB', 'A9o')).toBe('BTN은 BB 3벳에 AKo는 4벳, ATo까지는 콜, A9o는 절반은 폴드, 절반은 4벳·콜이에요.');
    // 콜드 상황의 주어는 앞의 오픈까지(책 5장 3절: 오픈과 3벳 사이에 끼어 있을 때).
    expect(at('cold_4bet:BTN', 'AKo')).toBe('BTN은 오픈과 3벳 뒤에 오프수트 A 중 AKo는 절반은 4벳하고, 나머지를 콜과 폴드로 나눠요.');
    // 전수: 세 액션 칸이 있는 줄은 16개이고, 전부 split claim 으로 부릅니다.
    const lines = ALL.filter((x) => x.cells.some((c) => c.split));
    expect(lines.length).toBe(16);
    for (const x of lines) {
      for (const c of x.cells.filter((y) => y.split)) {
        expect(c.w, `${scenarioKey(x.s)} ${c.hand}`).toBeCloseTo(0.5);
        expect(x.sentence!.claims.some((k) => k.t === 'split' && k.hand === c.hand), `${scenarioKey(x.s)} ${x.sentence!.text}`).toBe(true);
        expect(x.sentence!.text).not.toMatch(new RegExp(`${c.hand}(는|은) (절반만|가끔)`));
      }
    }
  });

  it("(c) 비중어 바로 뒤에 '나머지는'이 오지 않습니다 — '그 아래 칸은' · '다른 칸은'", () => {
    expect(at('vs_open:BB:CO', '87o')).toBe('BB는 CO 오픈에 오프수트 8 중 87o는 절반만 콜하고, 그 아래 칸은 폴드해요.');
    // 섞는 쪽은 비중으로(감사: '가끔'은 앱의 비중어 밖이었습니다). QJs 는 폴드 75 · 3벳 25.
    expect(at('vs_open:SB:UTG', 'QJs')).toBe('SB는 UTG 오픈에 수티드 Q 중 QJs만 3벳을 25% 섞고, 그 아래 칸은 폴드해요.');
    expect(at('vs_open:SB:UTG', 'QJs', true)).toBe('수티드 Q는 QJs만 3벳을 25% 섞고, 그 아래 칸은 폴드해요.');
    expect(at('vs_open:BB:UTG', 'A5s')).toBe('BB는 UTG 오픈에 AKs·AQs·A5s·A4s는 3벳, A3s·A2s는 3벳·콜 반반, 다른 칸은 콜해요.');
    for (const { s, line, sentence } of ALL) {
      for (const t of [sentence?.text, lineSentence(s, line, { topic: true })?.text]) {
        if (!t) continue;
        expect(t).not.toMatch(/(주로|절반만|절반은|반반|가끔|% 섞)[^,.]*, 나머지는/);
        // '가끔'은 앱의 비중어(전부 · 주로 · 절반만 · 반반 · 절반은) 밖이라 쓰지 않습니다(감사: 25%를 '가끔'이라 불렀어요).
        expect(t, `${scenarioKey(s)} ${line.id}`).not.toMatch(/가끔/);
      }
    }
  });

  it("(d) 'X만 V하고, Y는 절반만 V' 대신 '늘 V하는 건 X까지이고, …'", () => {
    expect(at('rfi:UTG', 'KJo')).toBe('UTG는 오프수트 K 중 늘 오픈하는 건 KQo까지이고, KJo는 절반만 오픈해요.');
    expect(at('rfi:UTG', 'KJo', true)).toBe('오프수트 K 중 늘 오픈하는 건 KQo까지이고, KJo는 절반만 오픈해요.');
    expect(at('vs_3bet:UTG:BB', '98s')).toBe('UTG는 BB 3벳에 수티드 커넥터 중 늘 콜하는 건 T9s까지이고, 98s는 주로 콜해요.');
    expect(at('vs_open:HJ:UTG', 'AQo')).toBe('HJ는 UTG 오픈에 오프수트 A 중 늘 3벳하는 건 AKo까지이고, AQo는 3벳과 콜을 반반 섞어요.');
  });

  it("(e) 주로인 칸을 이름으로 부를 때는 '주로'와 함께", () => {
    expect(at('vs_open:SB:HJ', 'A2s')).toBe('SB는 HJ 오픈에 ATs까지는 3벳, A9s는 절반만 3벳, A5s~A3s는 3벳, A2s는 주로 3벳해요.');
    expect(at('vs_3bet:UTG:SB', 'A4s')).toBe('UTG는 SB 3벳에 수티드 A 중 AKs는 4벳, ATs까지는 콜, A5s는 4벳, A4s는 주로 4벳해요.');
    expect(at('vs_open:BB:SB', 'A9s')).toBe('BB는 SB 오픈에 수티드 A 중 A9s까지는 3벳, A6s까지는 콜, A5s부터는 전부 3벳해요.');
  });

  it("(f) 콜론 머리표('HJ: …') 없이 문장으로", () => {
    expect(at('vs_3bet:UTG:BB', 'A5s')).toBe('UTG에서 AKs는 4벳, ATs까지는 콜, A9s는 절반만 콜, A5s·A4s는 4벳, A3s는 절반만 4벳해요.');
    // 액션별 나열에서 콜 칸(ATs·A9s)이 AJs 바로 뒤에 이어지므로 AJs 를 그 앞에 두고 'A9s까지는'으로 — 주로인 A9s 를 범위로 덮습니다.
    expect(at('vs_open:HJ:UTG', 'A5s')).toBe('HJ에서 AKs·AQs·A5s·A4s는 3벳, A3s는 절반만 3벳, AJs는 3벳·콜 반반, A9s까지는 콜해요.');
    // '〈자리〉에서'로도 넘치는 두 줄은 주어를 뺍니다(리빌 바로 위 상황 줄이 내 자리와 상대를 말합니다).
    expect(at('vs_open:BTN:HJ', 'A5s')).toBe('AKs·AQs·A5s·A4s는 3벳, AJs는 3벳·콜 반반, A3s·A2s는 절반만 3벳, 다른 칸은 콜해요.');
    for (const { s, line, sentence } of ALL) {
      for (const t of [sentence?.text, lineSentence(s, line, { topic: true })?.text]) if (t) expect(t).not.toMatch(/:/);
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
        const slotOf = (h: HandName) => lineOf(hand).slots.findIndex((x) => x.hand === h);
        if (nm === '한 칸 밖') {
          near++;
          expect(cells[i].p, `${scenarioKey(s)} ${hand}`).toBe(rest);
          expect(i - 1).toBe(lastCont);
          // 스트립 칸으로도 바로 다음 — 사이에 점선(도달 불가) 칸이 끼면 '한 칸 밖'이 아닙니다.
          expect(slotOf(hand), `${scenarioKey(s)} ${hand}`).toBe(slotOf(cells[lastCont].hand) + 1);
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
    // 막대(AKs 뒤)와 링(A5s) 사이에 점선 칸 7개 — 도달 칸끼리는 이웃이어도 '한 칸 밖'이 아닙니다(UI 리뷰).
    const v = stripView({ kind: 'vs_5bet', hero: 'UTG', villain: 'CO' }, 'A5s');
    expect(v.boundaryAfter).toBe(1);
    expect(v.slots.slice(2, 9).every((x) => x.role === 'unreachable')).toBe(true);
    expect(nearMiss({ kind: 'vs_5bet', hero: 'UTG', villain: 'CO' }, 'A5s')).toBeNull();
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

/* 교차 검토: 'JTs만 3벳해요'인데 같은 줄의 J9s 가 3벳을 25% 섞으면 '만'이 거짓이에요. */
describe('line: "X만 V해요"의 V 는 같은 줄 다른 칸에 없어요', () => {
  it('74개 차트의 모든 줄', () => {
    const VERB: Record<string, string> = { '3벳': 'threebet', 콜: 'call', 오픈: 'raise', '4벳': 'fourbet', 올인: 'allin', 레이즈: 'raise' };
    const bad: string[] = [];
    let checked = 0;
    for (const s of allScenarios()) {
      if (!hasChart(s)) continue;
      const seen = new Set<string>();
      for (const h of ALL_HANDS) {
        const line = lineOf(h);
        if (seen.has(line.id)) continue;
        seen.add(line.id);
        const text = lineSentence(s, line)?.text;
        if (!text) continue;
        const cells = lineCells(s, line);
        const order = line.slots.map((x) => x.hand);
        for (const m of text.matchAll(/((?:[2-9TJQKA]{2}[so]?)(?:[·~][2-9TJQKA]{2}[so]?)*)만 (?:늘 )?(3벳|콜|오픈|4벳|올인|레이즈)(?:해요|하고)/g)) {
          checked++;
          // 'AKs~A8s·A5s·A4s' — 이름 목록 전체(범위는 줄 순서로 펼쳐요)
          const named = new Set<string>();
          for (const part of m[1].split('·')) {
            const [a, b] = part.split('~');
            if (!b) named.add(a);
            else for (const x of order.slice(order.indexOf(a), order.indexOf(b) + 1)) if (x) named.add(x);
          }
          const act = VERB[m[2]];
          // 같은 문장 뒤에서 그 칸을 이름으로 대면('…JTs만 늘 3벳하고, J9s는 … 3벳을 25% 섞어요') 괜찮아요.
          const others = cells.filter((c) => !named.has(c.hand) && !text.includes(c.hand) && c.mixList.some((x) => x.action === act && x.weight > 0));
          if (others.length) bad.push(`${scenarioKey(s)}: ${text} ← ${others.map((c) => c.hand).join(', ')}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(checked).toBeGreaterThan(20);
  });
});
