import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isReachable } from '../src/poker/atlas';
import { hasChart } from '../src/poker/data';
import { explainStep } from '../src/poker/explain';
import { ALL_HANDS } from '../src/poker/hands';
import { emWidth } from '../src/poker/ko';
import { lineOf, lineSentence, type LineDef } from '../src/poker/line';
import { allScenarios, scenarioKey } from '../src/poker/scenarios';
import { stepFor } from '../src/poker/trainer';

/*
 * 골든 코퍼스 — docs/EXPLAIN_SPEC.md §7.3.
 * 74개 상황 × 25줄의 줄 문장 1,089개를 전부 다시 만들어 tests/__golden__/line-sentences.tsv 와 바이트 단위로 비교합니다.
 * 열: scenarioKey \t lineId \t frame(폭 폴백이면 -noL / -cut) \t emWidth(소수 1자리) \t text
 *
 * 카피를 **의도적으로** 바꿀 때만 다시 씁니다:
 *   UPDATE_GOLDEN=1 npx vitest run tests/line.golden.test.ts
 * 그리고 PR 에 diff 를 그대로 올립니다(카피 리뷰 단위).
 *
 * 이력:
 *  - 최초 기록: 참고 구현(scripts/reference/line-gen.ts)의 출력과 같고, 세 줄만 다릅니다. 참고 구현은 섞는 칸들을
 *    언제나 'X부터는 …를 섞어요'(= 줄 끝까지)로 불렀는데, 그 뒤에 다른 칸이 남는 줄에서는 거짓이었습니다.
 *      vs_open BB:UTG 커넥터 — 32s 는 100% 폴드 → '76s부터 43s까지는 콜을 섞어요'
 *      vs_open BB:HJ  커넥터 — 32s 는 100% 폴드 → '87s부터 43s까지는 콜을 섞어요'
 *      vs_open BB:SB  수티드 Q — Q9s~Q2s 는 콜(뒤 절이 말함) → 'QJs·QTs는 3벳을 섞고, Q2s까지는 콜해요'
 */

const GOLDEN = new URL('./__golden__/line-sentences.tsv', import.meta.url);
const SHEET_GOLDEN = new URL('./__golden__/sheet-lines.tsv', import.meta.url);

function corpus(): { tsv: string; frames: Record<string, number> } {
  const lines = new Map<string, LineDef>();
  for (const h of ALL_HANDS) lines.set(lineOf(h).id, lineOf(h));
  const rows: string[] = [];
  const frames: Record<string, number> = {};
  for (const s of allScenarios().filter(hasChart)) {
    for (const line of lines.values()) {
      const r = lineSentence(s, line);
      if (!r) continue;
      frames[r.frame] = (frames[r.frame] ?? 0) + 1;
      const frame = `${r.frame}${r.fallback === 'noLabel' ? '-noL' : r.fallback === 'cut' ? '-cut' : ''}`;
      rows.push(`${scenarioKey(s)}\t${line.id}\t${frame}\t${emWidth(r.text).toFixed(1)}\t${r.text}`);
    }
  }
  return { tsv: rows.join('\n'), frames };
}

describe('line golden corpus (§7.3)', () => {
  const { tsv, frames } = corpus();

  it('regenerates tests/__golden__/line-sentences.tsv byte for byte', () => {
    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(GOLDEN)) writeFileSync(GOLDEN, tsv);
    expect(tsv.split('\n').length).toBe(1089);
    const want = readFileSync(GOLDEN, 'utf8');
    if (tsv !== want) {
      // 어느 줄이 움직였는지 먼저 보여 줍니다(전체 diff 는 UPDATE_GOLDEN=1 로 다시 쓰고 git diff 로).
      const a = want.split('\n');
      const b = tsv.split('\n');
      const moved = b.filter((row, i) => row !== a[i]).slice(0, 10);
      expect(moved, 'line-sentences.tsv 와 다른 줄').toEqual([]);
    }
    expect(tsv).toBe(want);
  });

  it('frame distribution snapshot', () => {
    expect(frames).toEqual({ P0: 472, P0h: 15, P1: 31, P2: 195, P2c: 8, P2m: 122, P2h: 105, P3: 51, P3h: 57, P4: 33 });
  });
});

/**
 * 두 번째 골든(§7.3): 74개 상황 × 169패 가운데 도달 칸 전부의 시트 문장.
 * 열: scenarioKey \t hand \t seat.numbers \t seat.lever \t across.line.text \t sibling?.text (없으면 빈 칸)
 */
describe('sheet golden corpus (§7.3)', () => {
  it('regenerates tests/__golden__/sheet-lines.tsv byte for byte', () => {
    const rows: string[] = [];
    for (const s of allScenarios().filter(hasChart)) {
      for (const hand of ALL_HANDS) {
        if (!isReachable(s, hand).ok) continue;
        const e = explainStep(stepFor(s, hand));
        rows.push([scenarioKey(s), hand, e.seat.numbers, e.seat.lever ?? '', e.across.line.text, e.sibling?.text ?? ''].join('\t'));
      }
    }
    const tsv = rows.join('\n');
    if (process.env.UPDATE_GOLDEN === '1' || !existsSync(SHEET_GOLDEN)) writeFileSync(SHEET_GOLDEN, tsv);
    const want = readFileSync(SHEET_GOLDEN, 'utf8');
    if (tsv !== want) {
      const a = want.split('\n');
      expect(rows.filter((row, i) => row !== a[i]).slice(0, 10), 'sheet-lines.tsv 와 다른 줄').toEqual([]);
    }
    expect(tsv).toBe(want);
  });
});
