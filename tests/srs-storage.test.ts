/**
 * 저장 형식 고정 테스트.
 *
 * src/state/srs.ts 는 카드를 배열로 눌러 담으면서 액션을 `ACTIONS.indexOf(...)` 숫자로 적고,
 * 불러올 때 `ACTIONS[n]` 으로 되읽습니다. 저장본에 형식 버전이 따로 없어서(`load()` 는 `v === 1`
 * 만 봅니다) **ACTIONS 배열의 순서가 곧 저장 형식**입니다.
 *
 * 그래서 누군가 ACTIONS 중간에 액션을 끼워 넣으면, 이미 저장된 모든 카드의 정답이 한 칸씩 밀려
 * 조용히 다른 액션이 됩니다 — 예외도 안 나고, 화면도 멀쩡해 보이고, 되돌릴 수도 없습니다.
 * (실제로 '체크'를 넣을 때 이 위험이 있었습니다. 그래서 맨 뒤에 붙였습니다.)
 *
 * 아래 두 테스트가 그 사고를 막습니다: 인덱스를 못박고, 모든 액션이 왕복을 견디는지 봅니다.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { memStorage } = vi.hoisted(() => {
  const map = new Map<string, string>();
  const memStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: memStorage, configurable: true, writable: true });
  return { memStorage };
});

import { ACTIONS, type Action } from '../src/poker/types';

const SRS_KEY = 'holdem-flicker.srs.v1';

/**
 * 저장본에 박히는 인덱스. 이 표를 바꾸려면 기존 사용자의 저장본을 옮기는 코드를 같이 넣어야 합니다.
 * 새 액션은 **맨 뒤에만** 붙일 수 있습니다.
 */
const PINNED: Record<Action, number> = {
  fold: 0,
  call: 1,
  raise: 2,
  threebet: 3,
  fourbet: 4,
  allin: 5,
  check: 6,
};

describe('SRS 저장 형식', () => {
  beforeEach(() => {
    memStorage.clear();
    vi.resetModules();
  });

  it('액션 인덱스가 저장 형식으로 고정돼 있다 (중간 삽입 금지)', () => {
    for (const [action, index] of Object.entries(PINNED) as Array<[Action, number]>) {
      expect(ACTIONS.indexOf(action)).toBe(index);
    }
    // 표에 없는 액션이 생기면 이 테스트부터 고치게 만듭니다.
    expect(ACTIONS.length).toBe(Object.keys(PINNED).length);
    expect([...ACTIONS].sort()).toEqual(Object.keys(PINNED).sort());
  });

  it('모든 액션이 저장 → 불러오기를 왕복해도 그대로다', async () => {
    const { cardKeyOf, rate, flushSrs } = await import('../src/state/srs');
    const scenario = { kind: 'vs_open', hero: 'BTN', villain: 'CO' } as const;
    // 액션마다 카드를 하나씩 만들어 '내가 틀렸을 때 고른 액션'으로 적어 둡니다 — 이 칸이
    // lastWrongAction 이고, answer 와 함께 ACTIONS 인덱스로 저장되는 두 칸 중 하나입니다.
    // 손패 이름은 진짜여야 합니다: unpack() 이 parseCardKey 를 try 안에서 부르기 때문에,
    // 가짜 이름을 쓰면 불러올 때 카드가 통째로 버려지고 테스트가 엉뚱한 곳을 가리킵니다.
    const HANDS = ['AA', 'KK', 'QQ', 'JJ', 'TT', '99', '88'];
    expect(HANDS.length).toBeGreaterThanOrEqual(ACTIONS.length);
    const written: Array<{ key: string; chosen: Action }> = [];
    ACTIONS.forEach((chosen, i) => {
      const hand = HANDS[i];
      const key = cardKeyOf(scenario, hand);
      rate({ scenario, hand, answer: 'call', index: 0, total: 1 } as never, 'unsure', 'quiz', { chosen });
      written.push({ key, chosen });
    });
    flushSrs();

    const raw = memStorage.getItem(SRS_KEY);
    expect(raw).toBeTruthy();

    vi.resetModules();
    const fresh = await import('../src/state/srs');
    for (const { key, chosen } of written) {
      expect(fresh.getCard(key)?.lastWrongAction, `${chosen} 가 왕복에서 바뀌었습니다`).toBe(chosen);
    }
  });
});
