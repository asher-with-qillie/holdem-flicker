/*
 * 칸 하나가 책과 다른 곳 — 상황 단위는 spot.ts 의 bookDiff, 키 단위는 handReasons.data.ts 의 bookDiff 가 맡고,
 * 책이 그 패를 이름으로 든 곳만 여기에 둡니다. docs/THEORY_SPEC.md §7.
 *
 * 문장 꼴: '책은 …라고 해요. 이 차트는 {패}를 (주로 · 절반만 · 가끔) {액션}해요.' 키는 `${차트 id}:${패}` 이고, 그 칸은 도달할 수
 * 있어야 해요(tests/theory.test.ts 가 차트 · 도달 · 비중어를 확인).
 *
 * 지금은 비어 있어요. 차트를 책(MPT 5장)에 맞춰 다시 만들면서 책이 이름으로 든 칸이 모두 책을 따르게 됐어요(2026-11):
 *   - BB vs UTG(책의 LJ): A9o 폴드 · K2s 콜(노트 5장 5절) — 옛 차트는 A9o 콜 · K2s 절반 콜
 *   - BB vs CO: K8o 주로 폴드(노트 5장 5절 '접는 경우가 많음')
 *   - BTN 오픈: 책이 예로 든 범위(A4o+ · K8o+ …)의 아래인 A3o · A2o · K7o 를 오픈하지 않음(노트 5장 2절) — 옛 차트는 늘 오픈
 * 차트가 다시 책에서 벗어나는 칸이 생기면 그 칸만 여기에 적어요.
 */
export const CELL_DIFFS: Record<string, string> = {};

export const cellDiff = (chartId: string, hand: string): string | null => CELL_DIFFS[`${chartId}:${hand}`] ?? null;
