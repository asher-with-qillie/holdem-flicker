import { bb, priceOf } from './theory/price';
import type { Scenario } from './types';

/*
 * 프리플랍 가격표 — 해설 시트의 레버(sheet.seatLever)와 자리별 보기(atlas.ts)가 같은 숫자를 읽는 한 곳.
 * 크기는 theory/price.ts 한 곳(책 5장 1절: 오픈 2.5bb · SB 레이즈 3bb · 3벳 IP 약 8.5bb · 블라인드 약 10bb ·
 * SB 레이즈에 BB 3벳 9bb)에서 읽습니다 — 여기서 숫자를 따로 적으면 크기를 바꿀 때 두 곳이 어긋납니다.
 * 문장은 여기서 만들지 않습니다 — 숫자만 둡니다.
 */

export interface PriceFacts {
  /** 더 내야 하는 금액. 4벳·올인은 사이즈가 범위로만 정해져 글자로 쓰지 않습니다. */
  toCall: string;
}

/**
 * 상황별 가격. 돈을 더 내는 결정이 아니거나(rfi·cold_4bet·vs_limp) 금액을 글자로 못 박을 수 없는 상황(vs_4bet·vs_5bet)은 null.
 *  - vs_open  BB vs SB 2bb · BB 그 외 1.5bb · SB 2bb · 그 외 2.5bb
 *  - vs_3bet  블라인드 3벳 7.5bb · 뒷자리 3벳 6bb · SB 레이즈에 BB 3벳 6bb
 */
export function priceFacts(s: Scenario): PriceFacts | null {
  if (s.kind !== 'vs_open' && s.kind !== 'vs_3bet') return null;
  const p = priceOf(s);
  return p ? { toCall: bb(p.toCall) } : null;
}
