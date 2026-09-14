/**
 * 코치 카드 린터 — COACH_SPEC §4 "공통 안전장치 lintCoachText".
 *
 * 이 기능의 존재 이유는 "차트를 다시 읽어 주지 않는다"입니다. 그 약속을 말로만 두면
 * 템플릿을 한 줄 고칠 때마다, AI가 한 번 답할 때마다 조용히 깨집니다. 그래서 계약을
 * **규칙 카드와 AI 카드에 똑같이 거는 함수 하나**로 내렸습니다. 통과하지 못한 카드는
 * 고쳐서 내보내지 않고 버립니다 — 반쯤 맞는 조언보다 카드가 한 장 없는 편이 낫습니다.
 *
 * 길이 제한이 여기서 가장 많은 일을 합니다. 25자 안에서는 레인지 표를 옮겨 적을 수가
 * 없고, 마지막 줄을 질문으로 강제하면 "이 패는 폴드입니다"로 끝낼 수가 없습니다.
 *
 * 순수 모듈입니다. window·localStorage·시계를 건드리지 않습니다.
 */
import type { CoachCard } from './types';

/** 글자 수는 코드포인트로 셉니다. 이모지·한글 조합 문자를 2~4자로 세면 한도가 제각각이 됩니다. */
const len = (s: string): number => Array.from(s).length;

const MAX_TITLE = 20;
const MAX_EVIDENCE = 30;
const MAX_STEP = 25;
const MIN_STEPS = 2;
const MAX_STEPS = 3;
/** 손패 이름이 세 개째 나오는 순간 카드가 차트로 변합니다. */
const MAX_HAND_NAMES = 2;

/**
 * 금지어. 한국어와 ASCII를 나눈 이유는 ASCII 쪽에만 단어 경계가 필요하기 때문입니다
 * (`level` 안의 `ev`까지 잡으면 안 되고, `EV를` 은 잡아야 합니다).
 */
const BANNED_KO = /솔버|에퀴티|빈도|폴라|양극화|리니어|밸런스|콤보|노드|시뮬|레인지의?\s?\d/;
const BANNED_EN = /\b(?:gto|solver|ev|mdf)\b/i;

/** 차트 문법. `ATo+`, `88+` 같은 표기는 코치가 쓸 말이 아닙니다. */
const RANGE_NOTATION = /[AKQJT2-9][AKQJT2-9][so]?\+/;

/** 이 앱은 100bb 고정입니다. 존재하지 않는 변수를 조언에 끌어들이지 않습니다. */
const STACK_DEPTH = /스택이?\s?(?:깊|얕)|스택\s?깊이/;

const BANG = /[!！]/;
const EMOJI = /\p{Extended_Pictographic}/u;

/** 레인지 퍼센트는 내 기록 줄에서도 막습니다 — 거기만 퍼센트가 열려 있기 때문입니다. */
const RANGE_PERCENT = /(?:상위|하위)\s?\d+(?:\.\d+)?\s?%/;
const PERCENT = /(\d+(?:\.\d+)?)\s?%/g;
/** PLAIN_KO_STYLE §3이 수치까지 못박은 확률만 내 기록 줄 밖에서 허용합니다. */
const ALLOWED_PERCENT = new Set(['12', '30', '43', '57']);

/**
 * 손패 이름 후보. 앞뒤가 영숫자면 잘라 낸 조각이므로 제외합니다.
 *
 * 숫자 두 개짜리(`22`, `43`)는 "실수 42번", "정답률 43%" 같은 내 기록과 구별할 방법이
 * 없어서 무늬 표기가 붙었을 때만 손패로 셉니다. 놓치는 쪽이 잘못 버리는 쪽보다 낫습니다.
 */
const HAND_NAME = /(?<![A-Za-z0-9])([AKQJT2-9])([AKQJT2-9])([so])?(?![A-Za-z0-9])/g;

/** 차트 표기(수티드/오프수트 접미사가 붙은 것). 이건 사람이 말로 쓰는 이름이 아니라 차트 문법입니다. */
const CHART_HAND = /(?<![A-Za-z0-9])[AKQJT2-9][AKQJT2-9][so](?![A-Za-z0-9])/;

/**
 * 액션 단정. 예전에는 '액션 명사 + 종결어미'(폴드입니다·콜하세요)만 잡았는데, 같은 말을 하는 방법이
 * 그것만이 아닙니다 — "접는 패예요", "받아도 됩니다"처럼 고유어 동사로도 되고, 명사와 어미 사이에
 * 조사 한 글자만 껴도 빠져나갑니다. 그래서 고유어를 목록에 넣고 사이에 몇 글자를 허용합니다.
 */
const VERDICT = /(?:폴드|콜|오픈|3벳|4벳|5벳|올인|접|받|들어가|던지|여|열)[가-힣]{0,3}(?:입니다|이에요|예요|하세요|합니다|세요|됩니다|돼요|맞아요|아니에요|아닙니다)/;

function countHandNames(text: string): number {
  let n = 0;
  for (const m of text.matchAll(HAND_NAME)) {
    const suited = m[3] !== undefined;
    const hasRankLetter = /[AKQJT]/.test(m[1] + m[2]);
    if (suited || hasRankLetter) n += 1;
  }
  return n;
}

interface Field {
  where: string;
  text: string;
  /** 내 기록 줄에서만 퍼센트가 열립니다. */
  percentAllowed: boolean;
}

function lintField(f: Field): string | null {
  const ko = BANNED_KO.exec(f.text);
  if (ko) return `${f.where}에 금지어가 있어요: ${ko[0]}`;
  const en = BANNED_EN.exec(f.text);
  if (en) return `${f.where}에 금지어가 있어요: ${en[0]}`;

  if (RANGE_NOTATION.test(f.text)) return `${f.where}에 레인지 표기가 있어요`;
  if (STACK_DEPTH.test(f.text)) return `${f.where}에 스택 깊이 이야기가 있어요`;
  if (BANG.test(f.text)) return `${f.where}에 느낌표가 있어요`;
  if (EMOJI.test(f.text)) return `${f.where}에 이모지가 있어요`;
  if (RANGE_PERCENT.test(f.text)) return `${f.where}에 레인지 퍼센트가 있어요`;

  if (!f.percentAllowed) {
    for (const m of f.text.matchAll(PERCENT)) {
      if (!ALLOWED_PERCENT.has(m[1])) return `${f.where}에 퍼센트가 있어요: ${m[0]}`;
    }
  }

  // 차트 표기(AJo·A5s)는 한 번이라도 나오면 버립니다 — 그건 차트 문법이지 코치가 쓰는 말이 아닙니다.
  if (CHART_HAND.test(f.text)) {
    return `${f.where}에 차트 표기 손패가 있어요 — 클래스 단위로만 말합니다`;
  }
  // 사람이 말로 쓰는 손패(AK·QQ)는 단정과 같은 줄에 있을 때만 막습니다. 자리에 따라 답이 달라지는
  // 것을 한 문장으로 단정하면 차트 탭과 반대말을 하게 됩니다(AK 도 vs_5bet 에서는 폴드입니다).
  if (countHandNames(f.text) > 0 && VERDICT.test(f.text)) {
    return `${f.where}에 핸드 단위 단정이 있어요`;
  }
  return null;
}

/**
 * 카드 한 장을 심사합니다. `null` 이면 통과, 문자열이면 그 카드를 버리는 이유입니다.
 *
 * 이유를 문자열로 돌려주는 건 화면에 띄우기 위해서가 아니라(사용자는 버려진 카드를
 * 볼 일이 없습니다) 템플릿을 고치다 걸렸을 때 테스트가 어디가 걸렸는지 말해 주기 위해서입니다.
 */
export function lintCoachText(card: CoachCard): string | null {
  const title = card.title.trim();
  const evidence = card.evidence.trim();
  const steps = card.steps.map((s) => s.trim());

  if (title === '') return '제목이 비었어요';
  if (len(title) > MAX_TITLE) return `제목이 ${MAX_TITLE}자를 넘었어요`;
  if (evidence === '') return '내 기록 줄이 비었어요';
  if (len(evidence) > MAX_EVIDENCE) return `내 기록 줄이 ${MAX_EVIDENCE}자를 넘었어요`;

  if (steps.length < MIN_STEPS || steps.length > MAX_STEPS) {
    return `생각 절차는 ${MIN_STEPS}~${MAX_STEPS}줄이어야 해요`;
  }
  for (const s of steps) {
    if (s === '') return '생각 절차에 빈 줄이 있어요';
    if (len(s) > MAX_STEP) return `생각 절차 한 줄이 ${MAX_STEP}자를 넘었어요`;
  }

  // 마지막 줄이 질문이어야 카드가 "다음 판에 스스로 던질 질문"으로 끝납니다.
  // 지시로 끝나면 그 순간 차트 요약이 됩니다.
  const last = steps[steps.length - 1];
  if (!last.endsWith('?') && !last.endsWith('？')) return '마지막 줄이 질문이 아니에요';

  const fields: Field[] = [
    { where: '제목', text: title, percentAllowed: false },
    { where: '내 기록 줄', text: evidence, percentAllowed: true },
    ...steps.map((text, i) => ({ where: `생각 절차 ${i + 1}번째 줄`, text, percentAllowed: false })),
  ];
  for (const f of fields) {
    const reason = lintField(f);
    if (reason) return reason;
  }

  // 손패 이름 한도만 카드 전체로 셉니다. 줄마다 두 개씩 나누어 적는 우회를 막습니다.
  if (countHandNames([title, evidence, ...steps].join(' ')) > MAX_HAND_NAMES) {
    return '한 카드에 손패 이름이 너무 많아요';
  }
  return null;
}

/** 통과한 카드만 남깁니다. 규칙 카드든 AI 카드든 이 문 하나만 지나갑니다. */
export function lintCards(cards: CoachCard[]): CoachCard[] {
  return cards.filter((c) => lintCoachText(c) === null);
}
