import { describe, expect, it } from 'vitest';
import { expandToken, parseRange, buildChart, primaryAction, rangeShare, fullMix } from '../src/poker/range';
import { ALL_HANDS, gridHand, handNameFromCards, dealCardsFor, combos, seedRandom } from '../src/poker/hands';

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
