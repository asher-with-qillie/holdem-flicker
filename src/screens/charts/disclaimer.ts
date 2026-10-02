import type { ScenarioKind } from '../../poker/types';

/**
 * 차트 아래 한 줄. 예전에는 한 문장을 모든 덱에 똑같이 붙였는데, 림프 대응이 생기면서
 * 그 문장이 그 덱에는 **거짓**이 됩니다 — 솔버는 레이크 있는 6맥스 트리에서 림프를 하지 않아서
 * '앞사람이 림프했다'는 노드 자체가 기성 솔루션에 없습니다. 덱마다 근거를 그대로 적습니다.
 *
 * 차트 탭과 자리별 보기(HandAtlas)가 같은 원문을 씁니다 — 두 군데가 다른 말을 하면 안 됩니다.
 */
export const SOLVER_NOTE = '솔버 결과를 단순화한 근사치예요. 레이크·상대 성향에 따라 경계 핸드는 달라질 수 있어요.';

export const DISCLAIMER: Record<ScenarioKind, string> = {
  rfi: SOLVER_NOTE,
  vs_open: SOLVER_NOTE,
  vs_3bet: SOLVER_NOTE,
  vs_4bet: SOLVER_NOTE,
  vs_5bet: SOLVER_NOTE,
  cold_4bet: SOLVER_NOTE,
  vs_limp:
    '림프는 솔버가 하지 않는 플레이라 이 상황은 솔버 기준이 없어요. 공개된 사람 작성 차트를 옮긴 기준선이고, 림프한 사람이 한 명일 때만 맞아요.',
};
