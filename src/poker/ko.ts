import { ACTION_SHORT_KO, type Action, type ScenarioKind } from './types';

/*
 * 한국어 조사 · 동사 · 폭 — 해설 생성기 전부가 거치는 한 곳(docs/EXPLAIN_SPEC.md §2.2·§2.4·§2.5·§2.6).
 *
 * 순수 함수만 둡니다. 예전에는 atlas.ts(seatP·handP·actP·rankP·actWord)와 explain.ts(seat·rp·hp)가
 * 같은 규칙을 따로 들고 있어서, 한쪽만 고치면 같은 화면에 "BTN은"과 "BTN는"이 같이 찍혔습니다.
 * 조사는 손으로 고르지 않습니다 — 여기 josa()를 부릅니다.
 */

export type Josa = '이/가' | '은/는' | '을/를' | '과/와' | '이에요/예요' | '이나/나';

/**
 * 라틴 문자를 소리 내어 읽었을 때 받침이 있는가. 엘·엠·엔·알만 받침이 있습니다.
 * T 는 이 앱에서 카드 10(십)이라 받침이 있습니다 — 단, 페어 TT 는 '티티'로 읽어 받침이 없습니다(hasFinal 참고).
 */
const LATIN_FINAL = new Set(['L', 'M', 'N', 'R', 'T', 'l', 'm', 'n', 'r']);
/** 숫자 끝자리: 0 영(십) · 1 일 · 3 삼 · 6 육 · 7 칠 · 8 팔 → 받침. 2 이 · 4 사 · 5 오 · 9 구 → 없음. */
const DIGIT_FINAL = new Set(['0', '1', '3', '6', '7', '8']);

/**
 * 마지막으로 소리 내어 읽는 음절에 받침이 있는가(§2.4 표).
 *  - 한글: 종성 유무 그대로 (곳·명·콜·3벳·오픈·올인 → 있음, 레이즈·체크·폴드·포켓페어 → 없음)
 *  - 자리: BTN(비티엔)만 있음. UTG·HJ·CO·SB·BB 는 없음
 *  - 랭크: T(십)·8·7·6·3 있음, A·K·Q·J·9·5·4·2 없음
 *  - 패 이름: 페어 88·77·66·33 만 있음(TT 는 티티). …s(에스)·…o(오)는 없음
 *  - %(퍼센트)·bb(비비)는 없음
 */
export function hasFinal(word: string): boolean {
  const w = word.trimEnd();
  const last = w[w.length - 1];
  if (!last) return false;
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[0-9]/.test(last)) return DIGIT_FINAL.has(last);
  // 'c-bet'은 '씨벳' — 영어 단어 하나를 통째로 읽는 유일한 용어입니다.
  if (/bet$/i.test(w)) return true;
  // 페어 TT 는 '티티' — 줄 이름의 T(십)와 달리 받침이 없습니다.
  if (last === 'T' && w[w.length - 2] === 'T') return false;
  return LATIN_FINAL.has(last);
}

const PAIRS: Record<Josa, [string, string]> = {
  '이/가': ['이', '가'],
  '은/는': ['은', '는'],
  '을/를': ['을', '를'],
  '과/와': ['과', '와'],
  '이에요/예요': ['이에요', '예요'],
  '이나/나': ['이나', '나'],
};

/** word + 조사. `josa('BTN', '은/는')` → 'BTN은', `josa('46%', '이에요/예요')` → '46%예요'. */
export function josa(word: string, j: Josa): string {
  const [withFinal, without] = PAIRS[j];
  return `${word}${hasFinal(word) ? withFinal : without}`;
}

/** 버튼·캡슐·문장이 같이 쓰는 액션 이름(§2.2). 림프를 올리는 건 '오픈'이 아니라 '레이즈'입니다. */
export function actWord(a: Action, kind: ScenarioKind): string {
  if (kind === 'vs_limp' && a === 'raise') return '레이즈';
  return ACTION_SHORT_KO[a];
}

/** 문장 동사 = 버튼 단어 + 해요/하고. `verb('fold', 'rfi', '해요')` → '폴드해요'. */
export function verb(a: Action, kind: ScenarioKind, end: '해요' | '하고'): string {
  return `${actWord(a, kind)}${end}`;
}

/**
 * 가중 폭(em). 한글 1 · 라틴 문자와 숫자 0.6 · 그 밖(공백·문장부호·기호) 0.3.
 * 리빌 슬롯의 2줄 클램프(≤ 42em)를 문자열만 보고 판단하려고 둡니다(§2.5).
 */
export function emWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (/[가-힣]/.test(ch)) w += 1;
    else if (/[A-Za-z0-9]/.test(ch)) w += 0.6;
    else w += 0.3;
  }
  return w;
}

/**
 * 학습자용 생성 문자열에 나오면 안 되는 표현(§2.6). 테스트가 줄 문장·형제 줄·자리 문장·숫자 줄·레버·
 * 부분 정답·예시·캡슐·atlas Line·gateText·상황 문구·용어 풀이·면책 문구에 전부 겁니다.
 * 문장 안 괄호는 필드마다 허용 여부가 달라 여기 넣지 않습니다(차트 메모는 괄호 풀이를 씁니다).
 */
export const BANNED: RegExp[] = [
  // 명령형
  /하세요/,
  /쓰세요/,
  /섞으세요/,
  /마세요/,
  /정하세요/,
  // 합니다체 · 한다체
  /니다(?=[.?,\s]|$)/,
  /샌다/,
  /접는다/,
  /넓다\./,
  // 호칭
  /당신/,
  /나는 이미/,
  // 번역투
  /앞서/,
  /받아 내/,
  /받아낼/,
  /값이 쌉/,
  /값을 뽑/,
  /싼값에/,
  /이길 그림/,
  /플랍이 편/,
  /버티기 어렵/,
  /계속 갑니다/,
  /계속 가는/,
  /끝까지 싸우/,
  /위주로 대응/,
  /포지션 불리/,
  /전체의 약/,
  /할 만합니다/,
  /쪽이 낫습니다/,
  /이 패는 거기에/,
  /그 안에 있습니다/,
  /기준 전략 빈도/,
  /프리플랍 가치/,
  /하이카드의 힘/,
  /열어요/,
  /열었/,
  /접어/,
  /접습니다/,
  /오픈을 맞으면/,
  /3벳을 맞/,
  /5벳 올인/,
  /오픈 레이즈/,
  /혼합 빈도/,
  /경계 핸드/,
  /근사치/,
  // 조사와 주어가 안 맞는 꼴('폴드도 반반') — 옛 readability 테스트에서 옮겼습니다.
  /폴드도 반반/,
  // 숫자 · 이론
  /필요 승률/,
  /팟 오즈/,
  /SPR/,
  /팟의 \d+%/,
  /bb 팟/,
  /c-bet/,
  /체크-레이즈/,
  /\d+\.\d+%/,
  // 기호
  /!/,
  /👍|👎/,
  /[\u{1F300}-\u{1FAFF}]/u,
];

/** 걸린 금지 표현들(없으면 빈 배열). 테스트 메시지용. */
export function bannedHits(text: string): string[] {
  return BANNED.filter((re) => re.test(text)).map((re) => re.source);
}
