import { describe, expect, it } from 'vitest';
import { barSide, clampH, classify, isJump, shortTier } from '../viewport';

// §1.3 matrix: [w, h, layout, short]
const MATRIX: [number, number, string, number][] = [
  [360, 640, 'phone', 700],
  [360, 780, 'phone', 0],
  [390, 664, 'phone', 700],
  [390, 750, 'phone', 0],
  [390, 844, 'phone', 0],
  [430, 739, 'phone', 740],
  [430, 932, 'phone', 0],
  [375, 553, 'squat', 700],
  [382, 580, 'squat', 700],
  [382, 540, 'squat', 700],
  [382, 678, 'phone', 700],
  [466, 678, 'phone', 700],
  [385, 571, 'squat', 700],
  [385, 609, 'squat', 700],
  [466, 498, 'squat', 700],
  [594, 368, 'land', 700],
  [594, 406, 'land', 700],
  [594, 356, 'land', 700],
  [594, 466, 'land', 700],
  [678, 340, 'land', 700],
  [844, 390, 'land', 700],
  [932, 430, 'land', 700],
  [669, 825, 'tall', 0],
  [669, 867, 'tall', 0],
  [669, 902, 'tall', 0],
  [669, 951, 'tall', 0],
  [951, 543, 'wide', 700],
  [951, 585, 'wide', 700],
  [951, 620, 'wide', 700],
  [951, 669, 'wide', 700],
  [867, 587, 'wide', 700],
];

describe('viewport classify', () => {
  it.each(MATRIX)('%i×%i → %s / short %i', (w, h, layout, short) => {
    expect(classify(w, h)).toBe(layout);
    expect(shortTier(h)).toBe(short);
    expect(barSide(classify(w, h))).toBe(layout === 'tall' || layout === 'wide' ? 'top' : 'bottom');
  });
  it('boundaries', () => {
    expect(classify(559, 900)).toBe('phone');
    expect(classify(560, 900)).toBe('tall');
    expect(classify(559, 639)).toBe('squat');
    expect(classify(819, 759)).toBe('land');
    expect(classify(820, 759)).toBe('wide');
    expect(classify(820, 479)).toBe('land');
    expect(shortTier(740)).toBe(740);
    expect(shortTier(741)).toBe(0);
    expect(shortTier(700)).toBe(700);
  });
  it('clampH rejects garbage', () => {
    expect(clampH(-33554432, 678)).toBe(678);
    expect(clampH(NaN, 500)).toBe(500);
    expect(clampH(undefined, 500)).toBe(500);
    expect(clampH(null, 500)).toBe(500);
    expect(clampH(150, 500)).toBe(500);
    expect(clampH(600, 500)).toBe(600);
    expect(clampH(601.5, 500)).toBe(500);
    expect(clampH(580, 618)).toBe(580);
  });
});

describe('viewport jumps (fold / unfold / rotation)', () => {
  it('fires on the Duo folds and on rotation', () => {
    expect(isJump(382, 669)).toBe(true); // unfold, outer → inner portrait
    expect(isJump(669, 951)).toBe(true); // inner portrait → inner landscape
    expect(isJump(951, 382)).toBe(true); // fold from landscape
    expect(isJump(390, 844)).toBe(true); // phone rotation
    expect(isJump(382, 594)).toBe(true); // outer rotation
  });
  it('ignores the toolbars, split-view nudges and the first measurement', () => {
    expect(isJump(382, 382)).toBe(false); // Safari toolbars only change the height
    expect(isJump(382, 385)).toBe(false); // Split View 385 vs full 382
    expect(isJump(390, 430)).toBe(false); // 40 pt is not a fold
    expect(isJump(0, 669)).toBe(false); // first resize after init
  });
});
