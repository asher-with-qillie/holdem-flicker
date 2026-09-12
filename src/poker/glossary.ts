/**
 * 쉬운 말 용어집 — docs/PLAIN_KO_STYLE.md 의 "용어 풀이 표" 전체를 코드로 옮긴 것.
 * 해설 본문(`PlainText`)에서 용어를 찾아 밑줄을 긋고, 누르면 이 풀이를 보여 줍니다.
 * `def` 는 스타일 가이드의 "쉬운 말" 칸 그대로입니다.
 */
export interface GlossaryEntry {
  term: string;
  aliases?: string[];
  def: string;
}

export const GLOSSARY: GlossaryEntry[] = [
  { term: '레인지', aliases: ['범위'], def: '그 자리에서 보통 플레이하는 손패 묶음' },
  { term: '오픈', aliases: ['오픈 레이즈', '오픈(레이즈)'], def: '아무도 안 올렸을 때 내가 먼저 올리는 것' },
  { term: '3벳', def: '상대가 올린 걸 내가 다시 올리는 것' },
  { term: '4벳', aliases: ['콜드 4벳'], def: '3벳을 받은 사람이 또 올리는 것' },
  { term: '5벳', aliases: ['올인', '5벳 올인'], def: '남은 칩을 전부 거는 것' },
  { term: '콜', aliases: ['올인 콜'], def: '상대가 건 만큼 따라 내는 것' },
  { term: '폴드', def: '패를 접고 이번 판을 포기하는 것' },
  { term: '포지션', aliases: ['인포지션'], def: '플랍 뒤에 나중에 행동할 수 있는 유리한 자리 (상대가 먼저 움직이니 정보를 더 얻어요)' },
  { term: '아웃오브포지션', def: '내가 먼저 행동해야 하는 불리한 자리' },
  { term: '블로커', def: '내가 쥔 카드 때문에 상대가 그 강한 패를 가질 확률이 줄어드는 것 (예: 내가 A를 들면 상대가 AA일 확률이 반으로 줄어요)' },
  { term: '도미네이트', aliases: ['도미네이션'], def: '같은 카드를 맞춰도 옆 카드(킥커)가 낮아서 지는 상황' },
  { term: '킥커', def: '짝을 맞춘 카드 옆의 나머지 카드. 승부가 같으면 킥커로 갈려요' },
  { term: '팟 오즈', def: '내야 하는 돈에 비해 딸 수 있는 돈의 비율. 싸게 볼수록 넓게 콜해도 돼요' },
  { term: '임플라이드 오즈', def: '지금은 손해 같아도, 좋은 패가 완성되면 크게 딸 수 있는 가능성' },
  { term: '셋마이닝', def: '포켓페어로 플랍에서 셋(같은 숫자 3장)을 노리는 것. 플랍에서 셋이 될 확률은 약 8분의 1이에요' },
  { term: '에퀴티', def: '지금 패가 끝까지 갔을 때 이길 확률' },
  { term: '폴드 에퀴티', def: '내가 올렸을 때 상대가 접어서 그냥 이길 가능성' },
  { term: '밸류', aliases: ['밸류벳', '밸류(벳)'], def: '내가 앞서 있다고 보고 돈을 더 받으려고 거는 것' },
  { term: '블러프', aliases: ['뻥'], def: '약한 패로 상대를 접게 하려고 거는 것' },
  { term: '세미 블러프', aliases: ['세미블러프'], def: '지금은 약하지만 더 맞으면 강해지는 패로 거는 블러프' },
  { term: '넛', def: '지금 나올 수 있는 가장 강한 패' },
  { term: '드로우', def: '한 장만 더 맞으면 완성되는 패 (예: 같은 무늬 4장 → 플러시 드로우)' },
  { term: '백도어', def: '두 장을 더 맞아야 완성되는 패. 가능성은 낮지만 덤으로 생각해요' },
  { term: '수티드', def: '두 장이 같은 무늬 (♠♠ 또는 ♦♦)' },
  { term: '오프수트', def: '두 장이 다른 무늬' },
  { term: '커넥터', def: '숫자가 이어진 두 장 (예: 8♠7♠)' },
  { term: '갭퍼', def: '숫자 사이가 한두 칸 비는 두 장 (예: 9♠7♠)' },
  { term: '브로드웨이', def: '10·J·Q·K·A처럼 큰 카드 두 장' },
  { term: '휠 에이스', def: 'A와 2~5처럼 A에 작은 카드가 붙은 패. A-2-3-4-5 스트레이트가 될 수 있어요' },
  { term: '포켓페어', def: '손에 든 두 장이 같은 숫자' },
  { term: '오버페어', def: '보드(공용 카드)보다 높은 포켓페어' },
  { term: '탑페어', def: '보드에서 제일 높은 카드와 짝을 맞춘 것' },
  { term: '셋', def: '포켓페어 + 보드 한 장으로 같은 숫자 3장' },
  { term: '보드', def: '가운데 깔리는 공용 카드' },
  { term: '플랍', def: '가운데 깔리는 공용 카드 중 처음 3장' },
  { term: '드라이 보드', aliases: ['드라이한 보드'], def: '드로우가 거의 없는 보드 (예: K♠7♦2♠처럼 서로 안 이어짐)' },
  { term: '웻 보드', aliases: ['웻한 보드'], def: '플러시·스트레이트 드로우가 많은 보드 (예: 9♠8♠7♦)' },
  { term: 'c-bet', aliases: ['컨티뉴에이션 벳', '씨벳'], def: '프리플랍에서 올린 사람이 플랍에서도 이어서 거는 것' },
  { term: '체크', def: '돈을 안 걸고 차례를 넘기는 것' },
  { term: '체크-레이즈', aliases: ['체크레이즈'], def: '일부러 체크했다가 상대가 걸면 올리는 것' },
  { term: '스퀴즈', def: '누가 올리고 누가 콜한 뒤에 내가 크게 올리는 것' },
  { term: 'SPR', def: '남은 칩 ÷ 팟 크기. 작을수록 올인이 쉽게 나와요' },
  { term: '어그레서', def: '마지막에 올린 사람' },
  { term: '콜러', def: '따라 낸 사람' },
  { term: '헤즈업', def: '둘만 남은 상황' },
  { term: '리버스 임플라이드 오즈', def: '패를 맞췄는데도 더 큰 패에 져서 크게 잃는 위험' },
  { term: '솔버', aliases: ['GTO'], def: "컴퓨터가 계산한 '가장 손해 안 보는 플레이'. 이 앱의 정답 기준이에요" },
  { term: '혼합', aliases: ['믹스', '혼합(믹스)'], def: '같은 패로 어떤 땐 올리고 어떤 땐 콜하는 것. 정답은 더 자주 하는 쪽' },
  // 표에는 없지만 해설에 자주 나오는 말 — 중학생은 블라인드가 뭔지 몰라요.
  { term: '블라인드', aliases: ['SB', 'BB'], def: '카드를 보기 전에 SB·BB가 미리 내는 돈(그 자리 사람들도 블라인드라고 불러요)' },
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
