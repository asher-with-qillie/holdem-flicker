/*
 * 칸 하나가 책과 다른 곳 — 상황 단위는 spot.ts 의 bookDiff, 키 단위는 handReasons.data.ts 의 bookDiff 가 맡고,
 * 책이 그 패를 이름으로 든 곳만 여기에 둡니다. docs/THEORY_SPEC.md §7.
 */
export const CELL_DIFFS: Record<string, string> = {
  // 노트 5장 5절: "A9o | LJ | 폴드" — 높은 카드가 하나뿐이고 수티드도 연결성도 없어 실현이 매우 나쁨
  'vs_open:BB:UTG:A9o': '책은 BB가 UTG(책의 LJ) 오픈에 A9o를 폴드한다고 해요(높은 카드가 하나뿐이고 수티드도 연결도 없어 실현이 나빠요). 이 차트는 콜해요.',
  // 노트 5장 5절: "K2s | LJ | 콜"
  'vs_open:BB:UTG:K2s': '책은 BB가 UTG(책의 LJ) 오픈에 K2s를 콜한다고 해요(수티드라 실현할 길이 많아요). 이 차트는 절반만 콜해요.',
  // 노트 5장 2절: BN 오픈 범위 예 "모든 포켓페어, A2s+, A4o+, K2s+, Q2s+, J4s+, K8o+ 같은 넓은 범위" — 전부가 아닌 예시라
  // (합쳐도 약 31%, BN 은 약 43%) '책이 예로 든 범위'라고만 말합니다. 그 안에서 오프수트 A · K 의 아래 끝은 명시돼 있어요.
  'rfi:BTN:A3o': '책이 예로 든 BTN 오픈 범위는 오프수트 A를 A4o까지 적어요. 이 차트는 A3o도 늘 오픈해요.',
  'rfi:BTN:A2o': '책이 예로 든 BTN 오픈 범위는 오프수트 A를 A4o까지 적어요. 이 차트는 A2o도 늘 오픈해요.',
  'rfi:BTN:K7o': '책이 예로 든 BTN 오픈 범위는 오프수트 K를 K8o까지 적어요. 이 차트는 K7o도 늘 오픈해요.',
};

export const cellDiff = (chartId: string, hand: string): string | null => CELL_DIFFS[`${chartId}:${hand}`] ?? null;
