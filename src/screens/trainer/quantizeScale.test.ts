import { describe, expect, it } from 'vitest';
import { fanBox, pickFanSize, quantizeScale } from './FitBox';

describe('quantizeScale', () => {
  it('snaps down to the five steps', () => {
    expect(quantizeScale(1)).toBe(1);
    expect(quantizeScale(1.7)).toBe(1);
    expect(quantizeScale(0.99)).toBe(0.875);
    expect(quantizeScale(0.875)).toBe(0.875);
    expect(quantizeScale(0.8)).toBe(0.75);
    expect(quantizeScale(0.7)).toBe(0.625);
    expect(quantizeScale(0.6)).toBe(0.5);
    expect(quantizeScale(0.5)).toBe(0.5);
  });
  it('hides below one half, and for garbage', () => {
    expect(quantizeScale(0.49)).toBe(0);
    expect(quantizeScale(0)).toBe(0);
    expect(quantizeScale(-1)).toBe(0);
    expect(quantizeScale(Number.NaN)).toBe(0);
    expect(quantizeScale(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('pickFanSize', () => {
  it('keeps the large fan on tall phone stages', () => {
    expect(pickFanSize({ width: 358, height: 300 })).toBe('lg');
  });
  it('drops to md when lg would be scaled to half (Duo outer screen stage)', () => {
    expect(pickFanSize({ width: 184, height: 163 })).toBe('md');
  });
  it('falls back to sm in a sliver', () => {
    expect(pickFanSize({ width: 80, height: 70 })).toBe('sm');
  });
  it('fan box grows with the card width', () => {
    expect(fanBox('lg').width).toBeGreaterThan(fanBox('md').width);
  });
});
