import type { Scenario } from './types';

/*
 * 프리플랍 가격표 — 해설(explain.ts scenarioLines)과 자리별 보기(atlas.ts)가 같은 숫자를 읽는 한 곳.
 * 100bb · 오픈 2.5bb(SB 3bb) · 블라인드 3벳 10~11bb · 뒷자리 3벳 7.5bb · 4벳 22~25bb 를 전제로 한 값입니다.
 * 문장은 여기서 만들지 않습니다 — 숫자만 둡니다. 소비자가 글자를 바꾸면 tests/explain-golden.test.ts 가 잡습니다.
 */

export interface PriceFacts {
  /** 더 내야 하는 금액. 4벳·올인은 사이즈가 범위로만 정해져 글자로 쓰지 않습니다. */
  toCall?: string;
  /** 콜한 뒤 보는 팟. 위와 같은 이유로 4벳·올인은 없습니다. */
  pot?: string;
  /** 콜에 필요한 승률(정수 %). */
  needPct?: number;
}

/**
 * 상황별 가격. rfi·cold_4bet·vs_limp 는 돈을 더 내는 결정이 아니라 null.
 *  - vs_open  BB vs SB {2bb, 6bb, 33} · BB 그 외 {1.5bb, 5.5bb, 27} · SB {2bb, 6bb} · 그 외 {2.5bb, 6.5bb}
 *  - vs_3bet  블라인드 {8bb, 22bb, 36} · 그 외 {5bb, 16.5bb, 30}
 *  - vs_4bet  {-, -, 30} · vs_5bet {-, -, 39} (해설 원문은 "38~40%" — 대표값으로 39)
 */
export function priceFacts(s: Scenario): PriceFacts | null {
  const v = s.villain;
  switch (s.kind) {
    case 'vs_open':
      if (s.hero === 'BB') return v === 'SB' ? { toCall: '2bb', pot: '6bb', needPct: 33 } : { toCall: '1.5bb', pot: '5.5bb', needPct: 27 };
      if (s.hero === 'SB') return { toCall: '2bb', pot: '6bb' };
      return { toCall: '2.5bb', pot: '6.5bb' };
    case 'vs_3bet':
      return v === 'SB' || v === 'BB' ? { toCall: '8bb', pot: '22bb', needPct: 36 } : { toCall: '5bb', pot: '16.5bb', needPct: 30 };
    case 'vs_4bet':
      return { needPct: 30 };
    case 'vs_5bet':
      return { needPct: 39 };
    default:
      return null;
  }
}
