import type { Scenario, ScenarioKind } from '../../poker/types';

/**
 * 차트 아래 한 줄. 덱마다 근거를 그대로 적습니다(docs/BOOK_CHART_SPEC.md §0).
 * 차트는 책(MPT 5장)이 밝힌 비율 · 크기 · 원리와 패의 예를 하나도 어기지 않게 다시 만들었어요. 책에는 패 하나하나의 빈도표가
 * 없어서(노트 5장 6절), 그 부분은 책의 원리와 공개 솔버 자료로 채웠다는 것을 밝힙니다.
 *
 * 차트 탭과 자리별 보기(HandAtlas)가 같은 원문을 씁니다 — 두 군데가 다른 말을 하면 안 됩니다.
 */
export const SOLVER_NOTE = '책(Modern Poker Theory) 5장의 비율 · 베팅 크기 · 원리에 맞춰 만든 차트예요. 책이 숫자를 주지 않은 곳은 공개 솔버 자료로 채웠고, 패 하나하나의 빈도는 원서 차트와 다를 수 있어요.';

export const DISCLAIMER: Record<ScenarioKind, string> = {
  rfi: SOLVER_NOTE,
  vs_open: SOLVER_NOTE,
  vs_3bet: SOLVER_NOTE,
  vs_4bet: SOLVER_NOTE,
  vs_5bet: SOLVER_NOTE,
  cold_4bet: SOLVER_NOTE,
  vs_limp: '책의 균형 전략에서는 SB 말고 림프하는 자리가 없어서, 앞에서 림프한 사람은 약한 플레이어로 봐요. 이 차트는 책의 기본 조언대로 평소 오픈 범위만큼 아이솔레이트해요. 림퍼가 수동적이면 더 넓게, 공격적이면 강한 패 위주로 좁혀요.',
};

/**
 * BB 의 림프 대응 = SB 가 림프했고 BB 차례. 책의 균형 전략에서 림프하는 자리는 SB 뿐이라(5장 2절) '림퍼가 한 명일 때만 ·
 * 림퍼의 유형에 따라'라는 앞자리 림프의 말(4장 7절 아이솔레이트)은 맞지 않습니다. BB 의 레이즈 폭은 책이 숫자를 주지 않아
 * 공개 솔버 자료(약 40%, 양극화)로 채웠습니다(docs/BOOK_CHART_SPEC.md §5).
 */
export const DISCLAIMER_BB_LIMP = 'SB가 림프하고 BB 차례인 상황이에요. 책의 균형 전략에서 림프하는 자리는 SB뿐이고, BB는 3.5bb로 레이즈하거나 체크해요. 레이즈 폭은 책이 숫자를 주지 않아 공개 솔버 자료로 채웠어요.';

/** 상황(자리까지)의 면책 한 줄. vs_limp 의 BB 만 DISCLAIMER_BB_LIMP, 나머지는 DISCLAIMER[kind]. */
export function disclaimerFor(s: Pick<Scenario, 'kind' | 'hero'>): string {
  return s.kind === 'vs_limp' && s.hero === 'BB' ? DISCLAIMER_BB_LIMP : DISCLAIMER[s.kind];
}
