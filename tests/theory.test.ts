import { describe, expect, it } from 'vitest';
import { ALL_CHART_DEFS, getChartCells, hasChart } from '../src/poker/data';
import { ALL_HANDS } from '../src/poker/hands';
import { isReachable } from '../src/poker/atlas';
import { fullMix, rangeShare } from '../src/poker/range';
import { heroInPosition } from '../src/poker/scenarios';
import { bannedHits } from '../src/poker/ko';
import { PRINCIPLES, type PrincipleId } from '../src/poker/theory/principles';
import { defendShare, spotReason } from '../src/poker/theory/spot';
import { priceOf, threebetRisk } from '../src/poker/theory/price';
import { familyOf, reasonKey } from '../src/poker/theory/keys';
import { fillSlots, handReason } from '../src/poker/theory/handReason';
import { HAND_REASONS } from '../src/poker/theory/handReasons.data';
import { CELL_DIFFS } from '../src/poker/theory/bookDiff';
import type { Action, Scenario } from '../src/poker/types';

/*
 * 책 원리 층(docs/THEORY_SPEC.md) — 자리 이유가 차트에 대해 단정하는 말을 74개 차트에서 다시 계산하고,
 * 원리 카드 · 이 패 이유 · 책과 다른 점의 말투와 범위를 확인합니다.
 */

const scen = (d: (typeof ALL_CHART_DEFS)[number]): Scenario => ({ kind: d.kind, hero: d.hero, ...(d.villain ? { villain: d.villain } : {}) }) as Scenario;
const share = (s: Scenario, a: Action) => rangeShare(getChartCells(s), a);
const CHARTS = ALL_CHART_DEFS.map((d) => ({ id: d.id, s: scen(d) }));

describe('가격(price.ts)', () => {
  it('책 1장의 필요 승률 = 콜 금액 ÷ 콜 뒤의 팟을 앱 크기로 계산해요', () => {
    const p = (s: Scenario) => Math.round(priceOf(s)!.need * 1000) / 10;
    expect(p({ kind: 'vs_open', hero: 'BB', villain: 'UTG' })).toBe(27.3); // 1.5 ÷ 5.5
    expect(p({ kind: 'vs_open', hero: 'BB', villain: 'SB' })).toBe(33.3); // 2 ÷ 6
    expect(p({ kind: 'vs_open', hero: 'BTN', villain: 'CO' })).toBe(38.5); // 2.5 ÷ 6.5
    expect(p({ kind: 'vs_3bet', hero: 'UTG', villain: 'HJ' })).toBe(30.3); // 5 ÷ 16.5
    expect(p({ kind: 'vs_3bet', hero: 'UTG', villain: 'BB' })).toBe(37.2); // 8 ÷ 21.5
    expect(p({ kind: 'vs_4bet', hero: 'HJ', villain: 'UTG' })).toBe(31.9); // 14.5 ÷ 45.5
    expect(p({ kind: 'vs_5bet', hero: 'UTG', villain: 'HJ' })).toBe(38.7); // 78 ÷ 201.5
  });
  it('책 4장 3벳 위험의 단순 모형(한 명당 7%)', () => {
    expect(Math.round(threebetRisk(2) * 1000) / 10).toBe(13.5); // 책의 BN
    expect(Math.round(threebetRisk(8) * 100)).toBe(44); // 책의 9인 UTG
  });
});

describe('자리 이유(spot.ts) — 차트에 대해 단정하는 말', () => {
  it('74개 차트 전부에 한두 문장과 원리 칩이 있고, 말투가 맞아요', () => {
    for (const { id, s } of CHARTS) {
      const r = spotReason(s);
      expect(r.lines.length, id).toBeGreaterThanOrEqual(1);
      expect(r.lines.length, id).toBeLessThanOrEqual(2);
      expect(r.principles.length, id).toBeGreaterThan(0);
      for (const p of r.principles) expect(PRINCIPLES[p], `${id} ${p}`).toBeDefined();
      for (const t of [...r.lines, r.numbers ?? '', r.bookDiff ?? '']) expect(bannedHits(t, 'style'), `${id}: ${t}`).toEqual([]);
    }
  });

  it('"콜은 거의 하지 않고" — SB의 오픈 대응과 콜드 4벳은 콜이 2% 미만이에요', () => {
    for (const { id, s } of CHARTS) {
      if (!spotReason(s).lines.join(' ').includes('콜은 거의 하지 않고')) continue;
      expect(share(s, 'call'), id).toBeLessThan(0.02);
    }
  });

  it('"콜이 4벳보다 많아요" — 포지션이 있는 3벳 대응', () => {
    for (const { id, s } of CHARTS) {
      if (s.kind !== 'vs_3bet' || !heroInPosition(s.hero, s.villain!)) continue;
      expect(spotReason(s).lines.join(' '), id).toContain('콜(');
      expect(share(s, 'call'), id).toBeGreaterThan(share(s, 'fourbet'));
    }
  });

  it('"오픈한 패의 X%만 지키고 (BB의 3벳에는 Y%)" — 포지션이 없으면 BB의 3벳보다 덜 지켜요', () => {
    for (const { id, s } of CHARTS) {
      if (s.kind !== 'vs_3bet' || heroInPosition(s.hero, s.villain!) || s.hero === 'SB') continue;
      expect(defendShare(s)!, id).toBeLessThan(defendShare({ kind: 'vs_3bet', hero: s.hero, villain: 'BB' })!);
    }
  });

  it('"처음 들어갈 때보다 좁게" — 림프 대응 레이즈와 HJ·CO의 오픈 대응은 RFI 폭보다 좁아요', () => {
    for (const { id, s } of CHARTS) {
      if (s.kind === 'vs_limp' && s.hero !== 'BB') expect(share(s, 'raise'), id).toBeLessThan(share({ kind: 'rfi', hero: s.hero }, 'raise'));
      if (s.kind === 'vs_open' && (s.hero === 'HJ' || s.hero === 'CO')) expect(defendShare(s)!, id).toBeLessThan(share({ kind: 'rfi', hero: s.hero }, 'raise'));
    }
  });

  it('"상대 범위가 넓을수록 BB도 넓게" · "BB가 가장 넓게" — BB 방어 폭은 상대 RFI 폭과 순서가 같고, SB 상대가 최대예요', () => {
    const openers = ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const;
    const rfi = openers.map((v) => share({ kind: 'rfi', hero: v }, 'raise'));
    const bb = openers.map((v) => defendShare({ kind: 'vs_open', hero: 'BB', villain: v })!);
    for (let i = 1; i < openers.length; i++) {
      if (rfi[i] > rfi[i - 1]) expect(bb[i], openers[i]).toBeGreaterThan(bb[i - 1]);
    }
    expect(Math.max(...bb)).toBe(bb[4]);
  });

  it('책과 다른 점의 사실도 차트와 맞아요', () => {
    // vs_4bet: "AA는 늘 올인해요"
    for (const { id, s } of CHARTS.filter((c) => c.s.kind === 'vs_4bet')) {
      if (!isReachable(s, 'AA').ok) continue;
      expect(fullMix(getChartCells(s).AA)[0], id).toEqual({ action: 'allin', weight: 1 });
    }
    // vs_open BTN: "상대가 넓을수록 콜도 늘어요"
    const btn = ['UTG', 'HJ', 'CO'].map((v) => share({ kind: 'vs_open', hero: 'BTN', villain: v as 'UTG' }, 'call'));
    expect(btn[0]).toBeLessThan(btn[1]);
    expect(btn[1]).toBeLessThan(btn[2]);
    // cold_4bet: "책(약 3~6%)보다 좁아요"
    for (const { id, s } of CHARTS.filter((c) => c.s.kind === 'cold_4bet')) expect(share(s, 'fourbet'), id).toBeLessThan(0.03);
    // rfi BTN: "책(약 43%)보다 조금 더 넓어요"
    expect(share({ kind: 'rfi', hero: 'BTN' }, 'raise')).toBeGreaterThan(0.43);
    // vs_5bet: "블러프로 4벳한 패는 폴드해요" — 작은 수티드 A 는 5벳에 늘 폴드
    for (const { id, s } of CHARTS.filter((c) => c.s.kind === 'vs_5bet')) {
      for (const h of ['A5s', 'A4s', 'A3s', 'A2s']) {
        if (!isReachable(s, h).ok) continue;
        expect(fullMix(getChartCells(s)[h])[0].action, `${id} ${h}`).toBe('fold');
      }
    }
  });

  it('칸 단위 책과 다른 점은 그 칸의 실제 답을 말해요', () => {
    expect(fullMix(getChartCells({ kind: 'vs_open', hero: 'BB', villain: 'UTG' }).A9o)[0]).toEqual({ action: 'call', weight: 1 });
    expect(fullMix(getChartCells({ kind: 'vs_open', hero: 'BB', villain: 'UTG' }).K2s).find((m) => m.action === 'call')?.weight).toBe(0.5);
    // 책 BN 범위는 A4o+ · K8o+ — 그 아래인 A3o · A2o · K7o 를 차트는 늘 오픈합니다
    for (const h of ['A3o', 'A2o', 'K7o']) expect(fullMix(getChartCells({ kind: 'rfi', hero: 'BTN' })[h])[0], h).toEqual({ action: 'raise', weight: 1 });
    // 칸 키는 실제 차트와 패여야 하고, 문장이 그 패를 이름으로 듭니다
    for (const [k, t] of Object.entries(CELL_DIFFS)) {
      const hand = k.split(':').pop()!;
      expect(t, k).toContain(hand);
    }
    for (const t of Object.values(CELL_DIFFS)) expect(bannedHits(t, 'style'), t).toEqual([]);
  });
});

describe('원리 카드(principles.ts)', () => {
  it('31장, 본문 2~3문장 해요체, 책 위치가 있어요', () => {
    const ids = Object.keys(PRINCIPLES) as PrincipleId[];
    expect(ids.length).toBe(31);
    for (const id of ids) {
      const p = PRINCIPLES[id];
      expect(p.id).toBe(id);
      expect(p.chip.length, id).toBeLessThanOrEqual(12);
      const sentences = p.body.split(/(?<=요\.)\s+/).filter(Boolean);
      expect(sentences.length, `${id}: ${p.body}`).toBeGreaterThanOrEqual(2);
      expect(sentences.length, `${id}: ${p.body}`).toBeLessThanOrEqual(3);
      expect(bannedHits(p.body, 'style'), id).toEqual([]);
      expect(p.ref, id).toMatch(/^책 \d+장/);
    }
  });
  it('숫자 줄은 해당 상황에서만 나와요', () => {
    const bbUtg: Scenario = { kind: 'vs_open', hero: 'BB', villain: 'UTG' };
    expect(PRINCIPLES['bb-price'].numbers!(bbUtg)).toBe('1.5bb를 더 내고 콜하면 팟은 5.5bb → 필요 승률 약 27%예요.');
    expect(PRINCIPLES['bb-price'].numbers!({ kind: 'rfi', hero: 'UTG' })).toBeNull();
    expect(PRINCIPLES['mdf-alpha'].numbers!({ kind: 'vs_3bet', hero: 'UTG', villain: 'BB' })).toContain('70%');
  });
});

describe('이 패 이유(handReason.ts)', () => {
  it('자리표시와 조사를 채워요', () => {
    expect(fillSlots('{hand|은/는} {villain|의} 3벳에', { kind: 'vs_3bet', hero: 'UTG', villain: 'BTN' }, 'TT')).toContain('TT은');
    expect(fillSlots('{hero|이/가} {hand|을/를}', { kind: 'rfi', hero: 'BTN' }, 'A5s')).toBe('BTN이 A5s를');
  });

  it('패 가족은 책의 묶음을 따라요', () => {
    expect(familyOf('A5s')).toBe('ace_s_wheel');
    expect(familyOf('ATo')).toBe('ace_o_big');
    expect(familyOf('K9s')).toBe('kq_s');
    expect(familyOf('T9s')).toBe('conn_s');
    expect(familyOf('K8o')).toBe('off_mid');
    expect(familyOf('72o')).toBe('trash');
  });

  const entries = Object.entries(HAND_REASONS);
  it.runIf(entries.length > 0)('도달 가능한 모든 칸(6,255)에 이 패 이유가 있어요', () => {
    const missing: string[] = [];
    for (const { id, s } of CHARTS) {
      if (!hasChart(s)) continue;
      const cells = getChartCells(s);
      for (const h of ALL_HANDS) {
        if (!isReachable(s, h).ok) continue;
        if (!handReason(s, h, cells[h])) missing.push(`${id} ${h} → ${reasonKey(s, h, cells[h])}`);
      }
    }
    expect(missing.slice(0, 20)).toEqual([]);
  });

  it.runIf(entries.length > 0)('문장은 한 문장 해요체, 80자 이하, 원리 카드가 있어요', () => {
    for (const [key, e] of entries) {
      expect(e.text.length, key).toBeLessThanOrEqual(80);
      expect(/[요]\.$|[요]$/.test(e.text.trim()), `${key}: ${e.text}`).toBe(true);
      expect(bannedHits(e.text, 'style'), `${key}: ${e.text}`).toEqual([]);
      expect(e.principles.length, key).toBeGreaterThan(0);
      for (const p of e.principles) expect(PRINCIPLES[p], `${key} ${p}`).toBeDefined();
      for (const m of e.text.matchAll(/\{([^}|]+)(?:\|([^}]+))?\}/g)) expect(['hand', 'hero', 'villain'], `${key}: ${m[0]}`).toContain(m[1]);
      if (e.bookDiff) expect(bannedHits(e.bookDiff, 'style'), key).toEqual([]);
    }
  });
});
