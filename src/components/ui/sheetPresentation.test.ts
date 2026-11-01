import { describe, expect, it } from 'vitest';
import { sheetPresentation } from './Sheet';

// §7: (land|wide) ? (forceBottom ? bottom : detent==='full' && !side ? panel : side) : bottom; held → side.
describe('sheetPresentation', () => {
  const LAYOUTS = ['phone', 'squat', 'land', 'tall', 'wide'] as const;
  const DETENTS = ['auto', 'half', 'full', 'peek'] as const;

  it('phone, squat and tall always get a bottom sheet', () => {
    for (const l of ['phone', 'squat', 'tall'] as const)
      for (const d of DETENTS) {
        expect(sheetPresentation(l, d, undefined)).toBe('bottom');
        expect(sheetPresentation(l, d, 'start', false, true)).toBe('bottom');
      }
  });

  it('land / wide: full without a side is a panel, everything else a side sheet', () => {
    for (const l of ['land', 'wide'] as const) {
      expect(sheetPresentation(l, 'full', undefined)).toBe('panel');
      expect(sheetPresentation(l, 'full', 'end')).toBe('side');
      for (const d of ['auto', 'half', 'peek'] as const) expect(sheetPresentation(l, d, undefined)).toBe('side');
    }
  });

  it('land / wide: forceBottom keeps the bottom sheet, but a held overlay is always a side sheet', () => {
    for (const l of ['land', 'wide'] as const)
      for (const d of DETENTS) {
        expect(sheetPresentation(l, d, undefined, true)).toBe('bottom');
        expect(sheetPresentation(l, d, undefined, true, true)).toBe('side');
      }
  });

  it('covers every class', () => {
    for (const l of LAYOUTS) expect(['bottom', 'side', 'panel']).toContain(sheetPresentation(l, 'auto', undefined));
  });
});
