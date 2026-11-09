import type { ScenarioKind } from '../../poker/types';

/**
 * 차트 아래 한 줄. 덱마다 근거를 그대로 적습니다(docs/THEORY_SPEC.md §10).
 * 림프 대응: 레이크 있는 6맥스 기성 솔루션에는 SB 말고 림프하는 노드가 거의 없어 '앞사람이 림프했다'는 차트가 없습니다.
 * 다만 책의 솔버는 SB에서 림프를 많이 쓰니(5장 2절) '솔버는 림프를 하지 않는다'고 쓰면 책과 어긋납니다.
 *
 * 차트 탭과 자리별 보기(HandAtlas)가 같은 원문을 씁니다 — 두 군데가 다른 말을 하면 안 됩니다.
 */
export const SOLVER_NOTE = '공개된 솔버 결과를 단순하게 줄인 차트예요. 책(Modern Poker Theory)의 균형 전략과 다른 곳은 해설의 \'책과 다른 점\'에 적었어요.';

export const DISCLAIMER: Record<ScenarioKind, string> = {
  rfi: SOLVER_NOTE,
  vs_open: SOLVER_NOTE,
  vs_3bet: SOLVER_NOTE,
  vs_4bet: SOLVER_NOTE,
  vs_5bet: SOLVER_NOTE,
  cold_4bet: SOLVER_NOTE,
  vs_limp: '솔버 결과에는 SB 말고 림프하는 노드가 거의 없어서, 이 차트는 사람이 만든 기본값이에요. 림퍼가 한 명일 때만 맞고, 책은 림퍼의 유형에 따라 아이솔레이트 폭을 바꾸라고 해요.',
};
