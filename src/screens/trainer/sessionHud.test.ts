import { describe, expect, it } from 'vitest';
import { dotClasses } from './SessionHud';

describe('HUD dots painted by result', () => {
  it('maps 1:1 when the queue fits the size', () => {
    expect(dotClasses(2, 4, 4, ['correct', 'wrong', undefined, undefined])).toEqual(['on on--correct', 'on on--wrong', 'now', '']);
  });
  it('keeps the configured dot count when chained steps lengthen the queue, and still paints', () => {
    const r = ['correct', 'wrong', 'partial', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined] as const;
    const c = dotClasses(3, 12, 10, [...r]);
    expect(c).toHaveLength(10);
    expect(c.filter((x) => x.startsWith('on on--'))).toEqual(['on on--correct', 'on on--wrong', 'on on--partial']);
    expect(c.filter((x) => x === 'now')).toHaveLength(1);
  });
  it('paints a run with its worst outcome, and the current card once revealed', () => {
    // 12 cards on 6 dots → runs of two
    const r: Array<'correct' | 'wrong' | 'partial' | 'neutral' | undefined> = ['correct', 'wrong', 'neutral', 'correct', ...Array(8).fill(undefined)];
    expect(dotClasses(3, 12, 6, r).slice(0, 2)).toEqual(['on on--wrong', 'on on--correct']);
    r[4] = 'partial';
    expect(dotClasses(4, 12, 6, r)[2]).toBe('now');
    r[5] = 'correct';
    expect(dotClasses(5, 12, 6, r)[2]).toBe('on on--partial');
  });
  it('a requeue in the middle does not unpaint earlier dots', () => {
    const before = dotClasses(5, 10, 10, ['wrong', 'correct', 'correct', 'correct', 'correct', undefined, undefined, undefined, undefined, undefined]);
    const after = dotClasses(5, 11, 10, ['wrong', 'correct', 'correct', 'correct', 'correct', undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(before[0]).toBe('on on--wrong');
    expect(after[0]).toBe('on on--wrong');
  });
  it('without results falls back to plain progress', () => {
    expect(dotClasses(2, 4, 4)).toEqual(['on', 'on', 'now', '']);
  });
  it('fewer cards than the size → one dot per card', () => {
    expect(dotClasses(0, 3, 10, [undefined, undefined, undefined])).toEqual(['now', '', '']);
  });
});
