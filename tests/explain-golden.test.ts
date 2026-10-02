import { describe, expect, it } from 'vitest';
import { getChartCells, hasChart } from '../src/poker/data';
import { explainStep } from '../src/poker/explain';
import { ALL_HANDS } from '../src/poker/hands';
import { allScenarios } from '../src/poker/scenarios';
import { stepFor } from '../src/poker/trainer';

/*
 * 골든 테스트(ATLAS_SPEC §7 테스트 16).
 * 74차트 × 169패의 `reasoning` 전체를 FNV-1a 로 해시해 상수와 비교합니다.
 * 리팩터(가격 숫자를 priceFacts 로 옮기는 일)는 이 값을 1비트도 못 움직여야 합니다.
 * 카피를 **의도적으로** 바꿀 때만 아래 상수를 갱신하고, 무엇이 움직였는지 옆에 적습니다.
 */

/** 32비트 FNV-1a. hands.ts 의 nameHash 와 같은 식이지만 긴 문자열용이라 여기 따로 둡니다. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/*
 * 이력:
 *  - 최초 기록(priceFacts hoist 전): '0395885f'. hoist 뒤에도 같은 값이었습니다 — 리팩터는 글자를 안 움직였습니다.
 *  - 'ed117fea': OPEN[] 카피 4클래스(offsuit_broadway·suited_king·suited_qj·suited_gapper)를 차트와 맞춘 의도적 변경
 *    (ATLAS_SPEC §7 테스트 10). heroIsIP 의 vs_limp 수정은 reasoning 을 안 건드려 해시가 안 움직입니다.
 */
const GOLDEN = 'ed117fea';

describe('explain golden', () => {
  it('reasoning() is byte-identical after the priceFacts hoist', () => {
    const parts: string[] = [];
    for (const s of allScenarios().filter(hasChart)) {
      getChartCells(s);
      for (const hand of ALL_HANDS) parts.push(explainStep(stepFor(s, hand)).reasoning.join('\n'));
    }
    const hash = fnv1a(parts.join('\n\n'));
    expect(hash).toBe(GOLDEN);
  });
});
