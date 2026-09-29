import { describe, expect, it } from 'vitest';
import { expandToken, parseRange, buildChart, primaryAction, rangeShare, fullMix } from '../src/poker/range';
import { ALL_HANDS, RANK_VALUE, gridHand, handNameFromCards, dealCardsFor, combos, seedRandom } from '../src/poker/hands';

describe('range notation', () => {
  it('expands pairs with + and -', () => {
    expect(expandToken('JJ+').sort()).toEqual(['AA', 'JJ', 'KK', 'QQ']);
    expect(expandToken('55-22').sort()).toEqual(['22', '33', '44', '55']);
    expect(expandToken('22-55').sort()).toEqual(['22', '33', '44', '55']);
  });
  it('expands suited/offsuit with + and -', () => {
    expect(expandToken('K9s+').sort()).toEqual(['K9s', 'KJs', 'KQs', 'KTs']);
    expect(expandToken('A5s-A2s').sort()).toEqual(['A2s', 'A3s', 'A4s', 'A5s']);
    expect(expandToken('A2o-A5o').sort()).toEqual(['A2o', 'A3o', 'A4o', 'A5o']);
    expect(expandToken('AKo+')).toEqual(['AKo']);
  });
  it('normalizes rank order and case', () => {
    expect(expandToken('ka s'.replace(' ', ''))).toEqual(['AKs']);
    expect(expandToken('tt')).toEqual(['TT']);
  });
  it('parses weights', () => {
    const r = parseRange('AA, KQo:0.5, A5s-A2s:0.25');
    expect(r.AA).toBe(1);
    expect(r.KQo).toBe(0.5);
    expect(r.A3s).toBe(0.25);
  });
  it('rejects bad tokens', () => {
    expect(() => parseRange('AK')).toThrow();
    expect(() => parseRange('AAs')).toThrow();
    expect(() => parseRange('AKs-KQs')).toThrow();
    expect(() => parseRange('AKs:1.5')).toThrow();
    expect(() => parseRange('KQo :0.5')).toThrow();
    expect(() => parseRange('KQo:0x1')).toThrow();
  });
  it('builds charts and detects over-weight', () => {
    const cells = buildChart({ id: 'x', kind: 'vs_open', hero: 'BTN', villain: 'CO', actions: { threebet: 'QQ+,AKs:0.5', call: 'AKs:0.5,JJ' } });
    expect(primaryAction(cells.AA)).toBe('threebet');
    expect(primaryAction(cells.JJ)).toBe('call');
    expect(primaryAction(cells.AKs)).toBe('threebet'); // tie → more aggressive
    expect(primaryAction(cells['72o'])).toBe('fold');
    expect(fullMix(cells.AKs).map((m) => m.action)).toEqual(['threebet', 'call']);
    expect(() => buildChart({ id: 'y', kind: 'rfi', hero: 'UTG', actions: { raise: 'AA', call: 'AA:0.2' } })).toThrow();
  });
  it('computes range share', () => {
    const cells = buildChart({ id: 'x', kind: 'rfi', hero: 'UTG', actions: { raise: 'AA,AKs,AKo' } });
    expect(rangeShare(cells)).toBeCloseTo((6 + 4 + 12) / 1326, 6);
  });
});

describe('hands', () => {
  it('has 169 unique hands in grid order', () => {
    expect(new Set(ALL_HANDS).size).toBe(169);
    expect(gridHand(0, 0)).toBe('AA');
    expect(gridHand(0, 1)).toBe('AKs');
    expect(gridHand(1, 0)).toBe('AKo');
    expect(gridHand(12, 12)).toBe('22');
    expect(ALL_HANDS.reduce((a, h) => a + combos(h), 0)).toBe(1326);
  });
  it('names hands from cards', () => {
    expect(handNameFromCards({ rank: 'K', suit: 's' }, { rank: 'A', suit: 's' })).toBe('AKs');
    expect(handNameFromCards({ rank: 'K', suit: 'd' }, { rank: 'A', suit: 's' })).toBe('AKo');
    expect(handNameFromCards({ rank: '7', suit: 'd' }, { rank: '7', suit: 's' })).toBe('77');
  });
  it('deals only spades/diamonds and preserves suitedness', () => {
    seedRandom(42);
    for (let i = 0; i < 50; i++) {
      for (const h of ['AKs', 'AKo', 'QQ', '72o', '54s']) {
        const [a, b] = dealCardsFor(h);
        expect(['s', 'd']).toContain(a.suit);
        expect(['s', 'd']).toContain(b.suit);
        expect(handNameFromCards(a, b)).toBe(h);
      }
    }
  });
});

/**
 * 무늬는 '수딧이냐 오프수딧이냐'를 한눈에 보이게 하려고 ♠·♦ 두 가지만 씁니다.
 * 그래서 무늬가 **손패 이름에서 결정론적으로** 나와야 합니다. 예전에는 매번 무작위로 뽑아서
 * 같은 페어가 7♠7♦ 로도 7♦7♠ 로도 나왔고, 페어는 두 장의 숫자가 같으니 눈에 보이는 차이가
 * '왼쪽이 스페이드냐'뿐이라 같은 문제가 두 개로 읽혔습니다. 요약·홈 목록은 렌더할 때마다
 * 다시 뽑아서 세션에서 본 카드와 어긋나기도 했습니다.
 */
describe('dealCardsFor 무늬는 패마다 고정', () => {
  const str = (h: string) => dealCardsFor(h).map((c) => `${c.rank}${c.suit}`).join('');

  it('같은 패는 몇 번을 뽑아도 같은 카드', () => {
    for (const h of ALL_HANDS) {
      const first = str(h);
      for (let i = 0; i < 20; i++) expect(str(h)).toBe(first);
    }
  });

  it('페어는 언제나 ♠ 먼저, ♦ 나중 — 무늬로 두 가지 문제가 되지 않는다', () => {
    for (const h of ALL_HANDS) {
      if (h.length !== 2) continue;
      const [a, b] = dealCardsFor(h);
      expect(a.suit).toBe('s');
      expect(b.suit).toBe('d');
    }
  });

  it('수딧은 두 장이 같은 무늬, 오프수트는 다른 무늬', () => {
    for (const h of ALL_HANDS) {
      const [a, b] = dealCardsFor(h);
      if (h.endsWith('s')) expect(a.suit).toBe(b.suit);
      else expect(a.suit).not.toBe(b.suit);
    }
  });

  it('수딧이 전부 스페이드로 쏠리지 않는다 (화면이 단조로워지지 않게)', () => {
    const suited = ALL_HANDS.filter((h) => h.endsWith('s'));
    const spades = suited.filter((h) => dealCardsFor(h)[0].suit === 's').length;
    expect(spades).toBeGreaterThan(suited.length * 0.25);
    expect(spades).toBeLessThan(suited.length * 0.75);
  });

  it('높은 카드가 언제나 앞 — suitOrientation 이 첫 장만 보고 판단한다', () => {
    for (const h of ALL_HANDS) {
      const [a, b] = dealCardsFor(h);
      expect(RANK_VALUE[a.rank]).toBeGreaterThanOrEqual(RANK_VALUE[b.rank]);
    }
  });
});
