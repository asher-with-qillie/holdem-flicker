import type { Scenario } from './types';

/*
 * 프리플랍 가격표 — 해설 시트의 레버(sheet.seatLever)와 자리별 보기(atlas.ts)가 같은 숫자를 읽는 한 곳.
 * 100bb · 오픈 2.5bb(SB 3bb) · 블라인드 3벳 10~11bb · 뒷자리 3벳 7.5bb 를 전제로 한 값입니다.
 * 문장은 여기서 만들지 않습니다 — 숫자만 둡니다.
 *
 * 팟 크기와 필요 승률은 지웠습니다(docs/EXPLAIN_SPEC.md §6.3). 해설은 이제 레인지 폭과 섞는 비율 두 가지 숫자만 씁니다.
 */

export interface PriceFacts {
  /** 더 내야 하는 금액. 4벳·올인은 사이즈가 범위로만 정해져 글자로 쓰지 않습니다. */
  toCall: string;
}

/**
 * 상황별 가격. 돈을 더 내는 결정이 아니거나(rfi·cold_4bet·vs_limp) 금액을 글자로 못 박을 수 없는 상황(vs_4bet·vs_5bet)은 null.
 *  - vs_open  BB vs SB 2bb · BB 그 외 1.5bb · SB 2bb · 그 외 2.5bb
 *  - vs_3bet  블라인드 3벳 8bb · 그 외 5bb
 */
export function priceFacts(s: Scenario): PriceFacts | null {
  const v = s.villain;
  switch (s.kind) {
    case 'vs_open':
      if (s.hero === 'BB') return { toCall: v === 'SB' ? '2bb' : '1.5bb' };
      if (s.hero === 'SB') return { toCall: '2bb' };
      return { toCall: '2.5bb' };
    case 'vs_3bet':
      return { toCall: v === 'SB' || v === 'BB' ? '8bb' : '5bb' };
    default:
      return null;
  }
}
