import { describe, expect, it } from 'vitest';
import { getChartCells, hasChart } from '../src/poker/data';
import { ALL_HANDS } from '../src/poker/hands';
import { fullMix, rangeShare } from '../src/poker/range';
import type { Action, HandName, Pos, Scenario } from '../src/poker/types';
import { equityVs } from '../scripts/equity-lib';

/*
 * 차트가 책(MPT 5장)의 균형 전략과 맞는지 — docs/BOOK_CHART_SPEC.md §3 의 숫자와 규칙을 그대로 검사해요.
 * 굵게 표시된 책의 숫자는 좁은 허용폭으로, 원리에서 끌어낸 목표는 방향으로 검사해요.
 */

const pct = (s: Scenario, a: Action) => rangeShare(getChartCells(s), a) * 100;
const combos = (h: HandName) => (h.length === 2 ? 6 : h[2] === 's' ? 4 : 12);
const w = (s: Scenario, h: HandName, a: Action) => fullMix(getChartCells(s)[h]).find((m) => m.action === a)?.weight ?? 0;
const primary = (s: Scenario, h: HandName) => fullMix(getChartCells(s)[h])[0]?.action;
const rfi = (hero: Pos): Scenario => ({ kind: 'rfi', hero });
const vo = (hero: Pos, villain: Pos): Scenario => ({ kind: 'vs_open', hero, villain });
const v3 = (hero: Pos, villain: Pos): Scenario => ({ kind: 'vs_3bet', hero, villain });
const v4 = (hero: Pos, villain: Pos): Scenario => ({ kind: 'vs_4bet', hero, villain });
const v5 = (hero: Pos, villain: Pos): Scenario => ({ kind: 'vs_5bet', hero, villain });
const LIMP = 'limp' as Action;

/** 앞 단계에서 고른 패 중 비율(%): vs_3bet 은 오픈한 패, vs_4bet 은 3벳한 패, vs_5bet 은 4벳한 패 기준. */
function relPct(s: Scenario, a: Action): number {
  const before: Scenario | null =
    s.kind === 'vs_3bet' ? rfi(s.hero) : s.kind === 'vs_4bet' ? vo(s.hero, s.villain!) : s.kind === 'vs_5bet' ? v3(s.hero, s.villain!) : null;
  const gate: Action = s.kind === 'vs_3bet' ? 'raise' : s.kind === 'vs_4bet' ? 'threebet' : 'fourbet';
  let num = 0;
  let den = 0;
  for (const h of ALL_HANDS) {
    const g = before ? w(before, h, gate) : 1;
    if (!g) continue;
    den += g * combos(h);
    num += g * combos(h) * w(s, h, a);
  }
  return den ? (num / den) * 100 : 0;
}

/** 상대 범위에 대한 승률 순서(가벼운 몬테카를로 — 순서만 봐요). */
const eqCache = new Map<string, Record<HandName, number>>();
function eqTable(spec: string): Record<HandName, number> {
  if (!eqCache.has(spec)) {
    const t: Record<HandName, number> = {};
    for (const h of ALL_HANDS) t[h] = equityVs(h, spec, 1200, 7).eq;
    eqCache.set(spec, t);
  }
  return eqCache.get(spec)!;
}

/** 선형도: 3벳 조합 중, 상대 범위 승률 상위(3벳 조합의 1.5배 폭) 안에 드는 비율. 작은 페어(88 이하)는 책이 말한 예외라 빼요. */
function linearity(s: Scenario, a: Action, oppSpec: string): number {
  const eq = eqTable(oppSpec);
  const order = [...ALL_HANDS].sort((x, y) => eq[y] - eq[x]);
  const total = ALL_HANDS.reduce((t, h) => t + w(s, h, a) * combos(h), 0);
  const top = new Set<HandName>();
  let acc = 0;
  for (const h of order) {
    if (acc >= total * 1.5) break;
    top.add(h);
    acc += combos(h);
  }
  let inTop = 0;
  let counted = 0;
  for (const h of ALL_HANDS) {
    const c = w(s, h, a) * combos(h);
    if (!c) continue;
    if (h.length === 2 && '23456788'.includes(h[0])) continue;
    counted += c;
    if (top.has(h)) inTop += c;
  }
  return counted ? inTop / counted : 1;
}

describe('RFI (노트 5장 2절)', () => {
  it('자리별 폭: UTG 17 · HJ 21 · CO 28 · BTN 43 (±0.5)', () => {
    expect(Math.abs(pct(rfi('UTG'), 'raise') - 17)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(pct(rfi('HJ'), 'raise') - 21)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(pct(rfi('CO'), 'raise') - 28)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(pct(rfi('BTN'), 'raise') - 43)).toBeLessThanOrEqual(0.5);
  });
  it('SB: 림프 약 38 · 레이즈 약 24 · 폴드 약 38 (±1)', () => {
    expect(Math.abs(pct(rfi('SB'), LIMP) - 38)).toBeLessThanOrEqual(1);
    expect(Math.abs(pct(rfi('SB'), 'raise') - 24)).toBeLessThanOrEqual(1);
  });
  it('SB 림프 범위에 AA · KK · QQ · AK가 일부 들어 있어요 (림프 뒤 재레이즈 · AA 슬로우플레이)', () => {
    // AK는 AKo 쪽이에요 — AKs는 늘 레이즈(명세 §5, 아래 '책이 비워 둔 곳'의 SB 레이즈 범위 테스트).
    for (const h of ['AA', 'KK', 'QQ', 'AKo']) expect(w(rfi('SB'), h, LIMP), h).toBeGreaterThan(0);
  });
  it('BTN은 책이 든 범위(모든 포켓페어, A2s+, A4o+, K2s+, Q2s+, J4s+, K8o+)를 전부 오픈하고 A3o · A2o · K7o는 오픈하지 않아요', () => {
    const must = [
      ...['22', '33', '44', '55', '66', '77', '88', '99', 'TT', 'JJ', 'QQ', 'KK', 'AA'],
      ...'KQJT98765432'.split('').map((r) => `A${r}s`),
      ...'KQJT98765'.split('').map((r) => `A${r}o`),
      'A4o',
      ...'QJT98765432'.split('').map((r) => `K${r}s`),
      ...'JT98765432'.split('').map((r) => `Q${r}s`),
      ...'T98765 4'.replace(' ', '').split('').map((r) => `J${r}s`),
      ...'QJT98'.split('').map((r) => `K${r}o`),
    ];
    for (const h of new Set(must)) expect(w(rfi('BTN'), h, 'raise'), h).toBe(1);
    for (const h of ['A3o', 'A2o', 'K7o', 'K6o']) expect(w(rfi('BTN'), h, 'raise'), h).toBe(0);
  });
  it('앞자리에서 오픈하는 패는 뒷자리에서도 같거나 더 자주 오픈해요 (UTG ⊂ HJ ⊂ CO ⊂ BTN)', () => {
    const seats: Pos[] = ['UTG', 'HJ', 'CO', 'BTN'];
    for (let i = 1; i < seats.length; i++)
      for (const h of ALL_HANDS) expect(w(rfi(seats[i]), h, 'raise'), `${seats[i - 1]}→${seats[i]} ${h}`).toBeGreaterThanOrEqual(w(rfi(seats[i - 1]), h, 'raise'));
  });
});

describe('오픈 대응 (노트 5장 4·5절)', () => {
  it('HJ · CO와 SB(UTG · HJ · CO 상대)는 콜 없이 3벳 아니면 폴드, SB vs BTN도 콜 없음', () => {
    for (const s of [vo('HJ', 'UTG'), vo('CO', 'UTG'), vo('CO', 'HJ'), vo('SB', 'UTG'), vo('SB', 'HJ'), vo('SB', 'CO'), vo('SB', 'BTN')]) expect(pct(s, 'call'), `${s.hero}:${s.villain}`).toBe(0);
  });
  it('HJ vs UTG 3벳은 최대 약 8%, CO vs UTG는 HJ보다 약 0.5%p 넓고, CO vs HJ는 그보다 넓어요', () => {
    const hj = pct(vo('HJ', 'UTG'), 'threebet');
    const coU = pct(vo('CO', 'UTG'), 'threebet');
    const coH = pct(vo('CO', 'HJ'), 'threebet');
    expect(hj).toBeGreaterThanOrEqual(7);
    expect(hj).toBeLessThanOrEqual(8.3);
    expect(coU - hj).toBeGreaterThanOrEqual(0.1);
    expect(coU - hj).toBeLessThanOrEqual(1.0);
    expect(coH).toBeGreaterThan(coU);
  });
  it('HJ · CO · SB의 3벳은 선형이에요 (작은 페어는 책이 말한 예외)', () => {
    for (const [s, opp] of [
      [vo('HJ', 'UTG'), 'chart:rfi:UTG:raise'],
      [vo('CO', 'UTG'), 'chart:rfi:UTG:raise'],
      [vo('CO', 'HJ'), 'chart:rfi:HJ:raise'],
      [vo('SB', 'UTG'), 'chart:rfi:UTG:raise'],
      [vo('SB', 'HJ'), 'chart:rfi:HJ:raise'],
      [vo('SB', 'CO'), 'chart:rfi:CO:raise'],
      [vo('SB', 'BTN'), 'chart:rfi:BTN:raise'],
    ] as Array<[Scenario, string]>)
      expect(linearity(s, 'threebet', opp), `${s.hero}:${s.villain}`).toBeGreaterThanOrEqual(0.8);
  });
  it('HJ vs UTG 3벳에 작은 페어(88~22)가 소수 섞여요', () => {
    const smalls = ['88', '77', '66', '55', '44', '33', '22'].filter((h) => w(vo('HJ', 'UTG'), h, 'threebet') > 0);
    expect(smalls.length).toBeGreaterThan(0);
  });
  it('BTN: 콜 약 5~7%(UTG ≥ HJ ≥ CO), 3벳 약 7 · 9 · 12% (±1)', () => {
    const c = (['UTG', 'HJ', 'CO'] as Pos[]).map((v) => pct(vo('BTN', v), 'call'));
    for (const x of c) {
      expect(x).toBeGreaterThanOrEqual(4.5);
      expect(x).toBeLessThanOrEqual(7.5);
    }
    expect(c[0]).toBeGreaterThanOrEqual(c[1]);
    expect(c[1]).toBeGreaterThanOrEqual(c[2]);
    const t = (['UTG', 'HJ', 'CO'] as Pos[]).map((v) => pct(vo('BTN', v), 'threebet'));
    [7, 9, 12].forEach((target, i) => expect(Math.abs(t[i] - target), `BTN 3벳 ${i}`).toBeLessThanOrEqual(1));
  });
  it('BTN의 3벳은 양극화(최강 패 + 콜 범위 아래의 블러프)이고, 콜 범위에 강한 패 일부를 섞어요', () => {
    for (const v of ['UTG', 'HJ', 'CO'] as Pos[]) {
      const s = vo('BTN', v);
      const eq = eqTable(`chart:rfi:${v}:raise`);
      expect(w(s, 'AA', 'threebet') + w(s, 'KK', 'threebet'), v).toBeGreaterThan(1);
      const calls = ALL_HANDS.filter((h) => w(s, h, 'call') > 0).map((h) => eq[h]);
      const minCall = Math.min(...calls);
      const bluffs = ALL_HANDS.filter((h) => w(s, h, 'threebet') > 0 && eq[h] < minCall);
      expect(bluffs.length, `${v} 블러프`).toBeGreaterThan(0);
      const strongCalls = ['AA', 'KK', 'QQ', 'JJ', 'AKs', 'AKo', 'AQs', 'TT'].filter((h) => w(s, h, 'call') > 0);
      expect(strongCalls.length, `${v} 슬로우플레이`).toBeGreaterThan(0);
    }
  });
  it('SB vs BTN 3벳은 약 15% (±1)', () => {
    expect(Math.abs(pct(vo('SB', 'BTN'), 'threebet') - 15)).toBeLessThanOrEqual(1);
  });
  it('BB: UTG 상대 A9o 폴드 · K2s 콜, CO 상대 K8o 주로 폴드 (책의 예)', () => {
    expect(primary(vo('BB', 'UTG'), 'A9o')).toBe('fold');
    expect(primary(vo('BB', 'UTG'), 'K2s')).toBe('call');
    expect(primary(vo('BB', 'CO'), 'K8o')).toBe('fold');
  });
  it('BB 방어 폭은 UTG < HJ < CO < BTN < SB(상대 범위가 넓을수록, SB에게는 포지션까지)', () => {
    const d = (['UTG', 'HJ', 'CO', 'BTN', 'SB'] as Pos[]).map((v) => pct(vo('BB', v), 'call') + pct(vo('BB', v), 'threebet'));
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
  });
  it('BB의 3벳: BTN에게는 선형, SB에게는 양극화', () => {
    expect(linearity(vo('BB', 'BTN'), 'threebet', 'chart:rfi:BTN:raise')).toBeGreaterThanOrEqual(0.8);
    const s = vo('BB', 'SB');
    const eq = eqTable('chart:rfi:SB:raise');
    const calls = ALL_HANDS.filter((h) => w(s, h, 'call') > 0).map((h) => eq[h]);
    const minCall = Math.min(...calls);
    expect(ALL_HANDS.filter((h) => w(s, h, 'threebet') > 0 && eq[h] < minCall).length).toBeGreaterThan(0);
  });
});

describe('3벳 대응 (노트 5장 2·3절) — 오픈한 패 중 비율', () => {
  const oop: Array<[Pos, Pos]> = [['UTG', 'HJ'], ['UTG', 'CO'], ['UTG', 'BTN'], ['HJ', 'CO'], ['HJ', 'BTN'], ['CO', 'BTN']];
  const ip: Array<[Pos, Pos]> = [['UTG', 'SB'], ['UTG', 'BB'], ['HJ', 'SB'], ['HJ', 'BB'], ['CO', 'SB'], ['CO', 'BB'], ['BTN', 'SB'], ['BTN', 'BB']];
  it('포지션 없이 IP 3벳을 받으면 4벳 약 22% (HJ vs CO가 책의 수치, ±3)', () => {
    for (const [h, v] of oop) expect(Math.abs(relPct(v3(h, v), 'fourbet') - 22), `${h}:${v}`).toBeLessThanOrEqual(3);
  });
  it('포지션 있게 블라인드 3벳을 받으면 4벳 약 10% (HJ vs BB가 책의 수치, ±3)이고 대부분 콜', () => {
    for (const [h, v] of ip) {
      const s = v3(h, v);
      expect(Math.abs(relPct(s, 'fourbet') - 10), `${h}:${v}`).toBeLessThanOrEqual(3);
      expect(relPct(s, 'call'), `${h}:${v}`).toBeGreaterThan(relPct(s, 'fourbet') * 2);
    }
  });
  it('같은 오프너라면 포지션 없을 때 콜이 더 적어요', () => {
    for (const h of ['UTG', 'HJ', 'CO'] as Pos[]) {
      const oopCall = Math.max(...oop.filter(([x]) => x === h).map(([, v]) => relPct(v3(h, v), 'call')));
      const ipCall = Math.min(...ip.filter(([x]) => x === h).map(([, v]) => relPct(v3(h, v), 'call')));
      expect(oopCall, h).toBeLessThan(ipCall);
    }
  });
  it('3벳에 콜하는 패: 오프수트 브로드웨이와 약한 오프수트 A는 포지션 없이 폴드', () => {
    for (const [h, v] of oop) for (const x of ['KJo', 'QJo', 'KTo', 'ATo', 'A9o']) if (w(rfi(h), x, 'raise') > 0) expect(w(v3(h, v), x, 'call'), `${h}:${v} ${x}`).toBe(0);
  });
  it('SB vs BB: 4벳은 최강 패와 블로커 패(양극화), 중간 강도 패는 콜', () => {
    const s = v3('SB', 'BB');
    expect(w(s, 'AA', 'fourbet') + w(s, 'KK', 'fourbet')).toBeGreaterThan(1);
    expect(['A5s', 'A4s', 'A3s', 'A2s'].some((h) => w(s, h, 'fourbet') > 0)).toBe(true);
    for (const h of ['TT', '99', 'AJs', 'KQs']) if (w(rfi('SB'), h, 'raise') > 0) expect(primary(s, h), h).toBe('call');
  });
});

describe('4벳 대응 (노트 5장 5절) — 3벳한 패 중 비율', () => {
  const ipPairs: Array<[Pos, Pos]> = [['HJ', 'UTG'], ['CO', 'UTG'], ['CO', 'HJ'], ['BTN', 'UTG'], ['BTN', 'HJ'], ['BTN', 'CO']];
  it('포지션 있게 3벳한 쪽: 올인 약 18% (±4), 대부분 콜', () => {
    for (const [h, v] of ipPairs) {
      const s = v4(h, v);
      expect(Math.abs(relPct(s, 'allin') - 18), `${h}:${v}`).toBeLessThanOrEqual(4);
      expect(relPct(s, 'call'), `${h}:${v}`).toBeGreaterThan(relPct(s, 'allin'));
    }
  });
  it('AA는 절반쯤 콜(슬로우플레이), KK보다 약한 페어는 대부분 콜', () => {
    for (const [h, v] of ipPairs) {
      const s = v4(h, v);
      expect(w(s, 'AA', 'call'), `${h}:${v}`).toBeGreaterThanOrEqual(0.5);
      for (const p of ['QQ', 'JJ', 'TT', '99', '88']) if (w(vo(h, v), p, 'threebet') > 0) expect(primary(s, p), `${h}:${v} ${p}`).toBe('call');
    }
  });
  it('CO vs HJ 4벳: KJs 같은 패를 콜에 더해요', () => {
    if (w(vo('CO', 'HJ'), 'KJs', 'threebet') > 0) expect(primary(v4('CO', 'HJ'), 'KJs')).toBe('call');
    else expect.fail('KJs가 CO vs HJ 3벳 범위에 없어 4벳에 콜할 수 없어요');
  });
  it('블라인드: 올인과 콜을 나누고, 상대 4벳이 넓을수록(뒷자리) AA 콜이 같거나 늘어요', () => {
    for (const h of ['SB', 'BB'] as Pos[]) {
      for (const v of ['UTG', 'HJ', 'CO', 'BTN'] as Pos[]) {
        if (!hasChart(v4(h, v))) continue;
        expect(relPct(v4(h, v), 'allin'), `${h}:${v}`).toBeGreaterThan(0);
        expect(relPct(v4(h, v), 'call'), `${h}:${v}`).toBeGreaterThan(0);
      }
      expect(w(v4(h, 'BTN'), 'AA', 'call'), h).toBeGreaterThanOrEqual(w(v4(h, 'UTG'), 'AA', 'call'));
    }
  });
  it('SB: CO · BTN 4벳에는 ATs · A5s 같은 비프리미엄 올인 블러프가 있고, UTG · HJ 4벳에는 없어요', () => {
    for (const v of ['CO', 'BTN'] as Pos[]) expect(['ATs', 'A5s'].some((h) => w(v4('SB', v), h, 'allin') > 0), v).toBe(true);
    for (const v of ['UTG', 'HJ'] as Pos[]) for (const h of ['ATs', 'A5s', 'A4s']) expect(w(v4('SB', v), h, 'allin'), `${v} ${h}`).toBe(0);
  });
});

describe('5벳 대응 (노트 5장 2·3절)', () => {
  it('TT+와 AK로 콜(BTN은 66+와 AK+), 그 밖의 4벳 패는 폴드', () => {
    const heroes: Array<[Pos, Pos]> = [
      ['UTG', 'HJ'], ['UTG', 'CO'], ['UTG', 'BTN'], ['UTG', 'SB'], ['UTG', 'BB'],
      ['HJ', 'CO'], ['HJ', 'BTN'], ['HJ', 'SB'], ['HJ', 'BB'],
      ['CO', 'BTN'], ['CO', 'SB'], ['CO', 'BB'],
      ['BTN', 'SB'], ['BTN', 'BB'], ['SB', 'BB'],
    ];
    for (const [h, v] of heroes) {
      const s = v5(h, v);
      const callers = h === 'BTN' ? ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88', '77', '66', 'AKs', 'AKo'] : ['AA', 'KK', 'QQ', 'JJ', 'TT', 'AKs', 'AKo'];
      for (const x of ALL_HANDS) {
        if (!w(v3(h, v), x, 'fourbet')) continue;
        expect(primary(s, x), `${h}:${v} ${x}`).toBe(callers.includes(x) ? 'call' : 'fold');
      }
    }
  });
});

describe('콜드 4벳 (노트 5장 3절)', () => {
  it('콜 없이 4벳 아니면 폴드, 상대가 타이트하면 약 3% · 넓으면 약 6%', () => {
    const target: Record<string, [number, number]> = { CO: [2.5, 3.5], BTN: [3.25, 4.25], SB: [4.25, 5.25], BB: [5, 6.25] };
    for (const [hero, [lo, hi]] of Object.entries(target)) {
      const s: Scenario = { kind: 'cold_4bet', hero: hero as Pos };
      expect(pct(s, 'call'), hero).toBe(0);
      const f = pct(s, 'fourbet');
      expect(f, hero).toBeGreaterThanOrEqual(lo);
      expect(f, hero).toBeLessThanOrEqual(hi);
    }
  });
});

describe('림프 대응 (노트 4장 7절)', () => {
  it('HJ · CO · BTN은 평소 오픈 범위 수준으로 고립(±1), SB는 레이즈 범위 수준', () => {
    for (const h of ['HJ', 'CO', 'BTN'] as Pos[]) expect(Math.abs(pct({ kind: 'vs_limp', hero: h }, 'raise') - pct(rfi(h), 'raise')), h).toBeLessThanOrEqual(1);
    expect(Math.abs(pct({ kind: 'vs_limp', hero: 'SB' }, 'raise') - pct(rfi('SB'), 'raise'))).toBeLessThanOrEqual(1);
  });
});

/* 책이 숫자를 주지 않은 곳 — 공개 솔버 자료로 채운 목표(docs/BOOK_CHART_SPEC.md §5). 허용폭을 더 넓게 둬요. */
describe('책이 비워 둔 곳 (공개 솔버 자료로 채운 목표)', () => {
  it('BB 방어(콜 + 3벳): UTG 29 · HJ 33 · CO 38 · BTN 45 · SB 57 (±2), 3벳 6 · 7.5 · 9.5 · 14 · 16 (±1.5)', () => {
    const target: Array<[Pos, number, number]> = [['UTG', 29, 6], ['HJ', 33, 7.5], ['CO', 38, 9.5], ['BTN', 45, 14], ['SB', 57, 16]];
    for (const [v, d, t] of target) {
      const s = vo('BB', v);
      expect(Math.abs(pct(s, 'call') + pct(s, 'threebet') - d), `BB vs ${v} 방어`).toBeLessThanOrEqual(2);
      expect(Math.abs(pct(s, 'threebet') - t), `BB vs ${v} 3벳`).toBeLessThanOrEqual(1.5);
    }
  });
  it('SB 3벳: UTG 7 · HJ 8.5 · CO 11 (±1.5)', () => {
    ([['UTG', 7], ['HJ', 8.5], ['CO', 11]] as Array<[Pos, number]>).forEach(([v, t]) => expect(Math.abs(pct(vo('SB', v), 'threebet') - t), v).toBeLessThanOrEqual(1.5));
  });
  it('SB 레이즈 범위: AKs · AQs · AJs · ATs · A9s · A8s · KQs · KJs · QJs · QTs · JTs는 늘 레이즈, 트랩 비중은 AA 25 · KK 50 · QQ 25 · JJ 50 · AKo 25 · AQo 50', () => {
    for (const h of ['AKs', 'AQs', 'AJs', 'ATs', 'A9s', 'A8s', 'KQs', 'KJs', 'QJs', 'QTs', 'JTs']) expect(w(rfi('SB'), h, 'raise'), h).toBe(1);
    const trap: Record<string, number> = { AA: 0.25, KK: 0.5, QQ: 0.25, JJ: 0.5, AKo: 0.25, AQo: 0.5 };
    for (const [h, l] of Object.entries(trap)) {
      expect(w(rfi('SB'), h, LIMP), h).toBeCloseTo(l, 5);
      expect(w(rfi('SB'), h, 'raise'), h).toBeCloseTo(1 - l, 5);
    }
  });
  it('BB vs SB 림프: 레이즈 약 40% (±3), 양극화(강한 패 + 약한 오프수트 블러프, 중간 패는 체크)', () => {
    const s: Scenario = { kind: 'vs_limp', hero: 'BB' };
    expect(Math.abs(pct(s, 'raise') - 40)).toBeLessThanOrEqual(3);
    for (const h of ['AA', 'KK', 'QQ', 'AKs', 'AKo']) expect(w(s, h, 'raise'), h).toBeGreaterThanOrEqual(0.75);
    // 블러프: 아주 약한 오프수트 패가 레이즈하고, 그보다 강한 중간 패(Q7s 같은 수티드 · 낮은 오프수트 A)는 체크
    expect(['72o', 'T4o', '92o', '84o', '83o', '94o', '73o'].filter((h) => w(s, h, 'raise') > 0).length).toBeGreaterThan(0);
    expect(['Q7s', 'A4o', 'A3o', 'A2o'].filter((h) => primary(s, h) === 'check').length).toBeGreaterThan(0);
  });
  it('3벳 대응 콜(오픈한 패 중): 포지션 없을 때 약 25, 블라인드 3벳에는 약 33 (±6)', () => {
    const oop: Array<[Pos, Pos]> = [['UTG', 'HJ'], ['UTG', 'CO'], ['UTG', 'BTN'], ['HJ', 'CO'], ['HJ', 'BTN'], ['CO', 'BTN']];
    const ip: Array<[Pos, Pos]> = [['UTG', 'SB'], ['UTG', 'BB'], ['HJ', 'SB'], ['HJ', 'BB'], ['CO', 'SB'], ['CO', 'BB'], ['BTN', 'SB'], ['BTN', 'BB']];
    for (const [h, v] of oop) expect(Math.abs(relPct(v3(h, v), 'call') - 25), `${h}:${v}`).toBeLessThanOrEqual(6);
    for (const [h, v] of ip) expect(Math.abs(relPct(v3(h, v), 'call') - 33), `${h}:${v}`).toBeLessThanOrEqual(6);
  });
  it('SB vs BB 3벳(SB 레이즈 범위 중): 4벳 약 20, 콜 약 25 (±5)', () => {
    expect(Math.abs(relPct(v3('SB', 'BB'), 'fourbet') - 20)).toBeLessThanOrEqual(5);
    expect(Math.abs(relPct(v3('SB', 'BB'), 'call') - 25)).toBeLessThanOrEqual(5);
  });
  it('블라인드의 4벳 대응(3벳한 패 중): 올인 약 25, 콜 약 30 (±8)', () => {
    for (const h of ['SB', 'BB'] as Pos[])
      for (const v of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as Pos[]) {
        if (v === h || !hasChart(v4(h, v))) continue;
        expect(Math.abs(relPct(v4(h, v), 'allin') - 25), `${h}:${v} 올인`).toBeLessThanOrEqual(8);
        expect(Math.abs(relPct(v4(h, v), 'call') - 30), `${h}:${v} 콜`).toBeLessThanOrEqual(8);
      }
  });
});
