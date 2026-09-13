/**
 * 용어집 — docs/PLAIN_KO_STYLE.md(v2) §1 기준.
 *
 * 담는 말은 두 종류뿐입니다.
 *   · B단계(어려운 개념): 블로커·도미네이트·셋마이닝·팟 오즈·임플라이드 오즈·스퀴즈·c-bet·SPR·세미 블러프·백도어
 *   · A단계 중 처음 보면 모를 수 있는 말: 수티드·오프수트·커넥터·브로드웨이·킥커·셋·오버페어·탑페어·레인지·포지션·블라인드 등
 *
 * 폴드·콜·벳·팟·보드·플랍·페어처럼 화면에 계속 나오는 말은 일부러 빼 두었습니다.
 * 밑줄이 너무 많으면 그 자체로 읽기 어려워집니다.
 */
export interface GlossaryEntry {
  term: string;
  aliases?: string[];
  def: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  /* ---- 어려운 개념 (B단계) ---- */
  { term: '블로커', def: '내가 그 카드를 들어 상대 조합이 줄어드는 효과' },
  { term: '도미네이트', aliases: ['도미네이션'], def: '같은 카드를 맞춰도 킥커에서 지는 상태' },
  { term: '셋마이닝', def: '셋을 노리고 콜하는 것. 플랍에서 셋이 될 확률은 12%' },
  { term: '팟 오즈', def: '콜 금액 대비 팟 크기. 쌀수록 넓게 콜해도 됩니다' },
  { term: '임플라이드 오즈', def: '맞았을 때 더 받아낼 수 있는 몫' },
  { term: '스퀴즈', def: '오픈과 콜 뒤에 크게 올리는 것' },
  { term: 'c-bet', aliases: ['씨벳'], def: '프리플랍 레이저가 플랍에서 잇는 벳' },
  { term: 'SPR', def: '팟 대비 남은 스택 비율. 낮을수록 올인이 쉽게 납니다' },
  { term: '세미 블러프', aliases: ['세미블러프'], def: '드로우를 들고 하는 블러프' },
  { term: '백도어', def: '두 장을 더 맞아야 완성되는 드로우' },

  /* ---- 처음 보면 모를 수 있는 표준 용어 (A단계) ---- */
  { term: '킥커', def: '페어를 맞춘 뒤 승부를 가르는 나머지 카드' },
  { term: '셋', def: '내 포켓페어와 같은 카드가 보드에 깔린 것' },
  { term: '오버페어', def: '보드에 깔린 카드보다 높은 포켓페어' },
  { term: '탑페어', def: '보드에서 가장 높은 카드와 맞춘 페어' },
  { term: '레인지', def: '그 자리에서 플레이하는 패 묶음' },
  { term: '포지션', def: '플랍 이후 나중에 액션하는 유리한 자리' },
  { term: '블라인드', def: '카드를 받기 전에 SB·BB가 미리 내는 돈' },
  { term: '수티드', def: '두 장이 같은 무늬 (♠♠ 또는 ♦♦)' },
  { term: '오프수트', def: '두 장이 서로 다른 무늬' },
  { term: '커넥터', def: '숫자가 이어진 두 장 (예: 8♠7♠)' },
  { term: '갭퍼', def: '숫자 사이가 한두 칸 비는 두 장 (예: 9♠7♠)' },
  { term: '브로드웨이', def: '10·J·Q·K·A 중 두 장으로 이뤄진 큰 패' },
  { term: '휠 에이스', def: 'A에 2~5가 붙은 패. A-2-3-4-5 스트레이트가 됩니다' },
  { term: '넛', def: '그 보드에서 나올 수 있는 가장 강한 패' },
  { term: '드라이 보드', aliases: ['드라이한 보드'], def: '드로우가 거의 없는 보드 (예: K♠7♦2♠)' },
  { term: '웻 보드', aliases: ['웻한 보드'], def: '플러시·스트레이트 드로우가 많은 보드' },
  { term: '오픈엔드', def: '양쪽이 다 열린 스트레이트 드로우. 맞출 카드 8장' },
  { term: '체크-레이즈', aliases: ['체크레이즈'], def: '체크했다가 상대가 벳하면 올리는 것' },
];

const index = new Map<string, GlossaryEntry>();
for (const e of GLOSSARY) {
  index.set(e.term.toLowerCase(), e);
  for (const a of e.aliases ?? []) index.set(a.toLowerCase(), e);
}

/** Find the entry for a term or one of its aliases (case-insensitive, trimmed). */
export function glossaryLookup(word: string): GlossaryEntry | undefined {
  return index.get(word.trim().toLowerCase());
}

/** Every matchable spelling (terms + aliases), longest first — used by `PlainText` to find terms in prose. */
export const GLOSSARY_WORDS: string[] = GLOSSARY.flatMap((e) => [e.term, ...(e.aliases ?? [])]).sort((a, b) => b.length - a.length || a.localeCompare(b));
