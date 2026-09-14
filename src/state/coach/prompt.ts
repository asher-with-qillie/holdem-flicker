/**
 * AI 에게 보낼 프롬프트. 시스템 규칙(COACH_SPEC §5)과 다이제스트 요약문을 만듭니다.
 *
 * 요약문에 JSON 을 붙이지 않는 것이 이 파일의 핵심입니다. JSON 을 주면 AI 가 그 필드를 그대로
 * 옮겨 적어서 "vs_3bet 정답률 0.62" 같은 수치 나열이 돌아옵니다. 사람이 읽어도 말이 되는
 * 한국어 문장과 표로만 적으면 AI 도 문장으로 답합니다 — L1(복사 붙여넣기) 경로에서는 이 글을
 * 사용자가 직접 읽고 붙여넣기까지 하므로, 읽히는 글이어야 한다는 제약이 곧 품질 장치입니다.
 *
 * 축의 `t`·`z` 같은 원수치는 일부러 뺐습니다. 숫자를 주면 AI 가 그 숫자를 카드 문구에 인용하고,
 * 그 순간 린터(§4)에 걸려 카드가 통째로 버려집니다. 방향과 세기는 한국어 단어로만 넘깁니다.
 *
 * **출력 형식은 경로마다 다릅니다.** L2(내 키 직접 호출)는 앱이 파싱해 카드로 그리므로 JSON 이지만,
 * L1(복사해서 붙여넣기)은 사용자가 채팅 화면에서 눈으로 읽는 답이라 평문이어야 합니다. 파서가 없는
 * 자리에 JSON 을 시키면 읽기만 나빠지고, 카드 상자가 없으니 20자·25자 같은 길이 제한도 뜻이 없습니다.
 * 개념적 조언이라는 본래 제약(차트 재설명 금지, 질문으로 끝내기)만 양쪽에 똑같이 겁니다.
 *
 * 순수 함수입니다. 저장소도 시계도 읽지 않습니다 — 재료는 digest.ts 가 모아서 넘깁니다.
 */
import { ACTION_SHORT_KO, type ScenarioKind } from '../../poker/types';
import type { AxisView, CoachDigest, CoachMistake, PatternHit } from './types';

/**
 * 두 경로가 함께 쓰는 규칙. 역할·금지어·문장 규칙까지만 담고 **출력 형식은 담지 않습니다** —
 * 그 부분만 경로별로 다르기 때문입니다(아래 OUTPUT_JSON / OUTPUT_PLAIN).
 */
const COACH_SYSTEM_RULES = `너는 한국어로 말하는 홀덤 프리플랍 코치다. 상대는 포커를 막 시작한 중고등학생·대학생이다.

아래는 이 사람이 6-max 100bb 프리플랍 퀴즈에서 낸 오답 기록과, 그 기록을 통계로 정리한 성향 수치다. 수치는 이미 출제 편향이 보정되어 있으니 그대로 믿어도 된다.

## 네가 할 일
차트를 다시 읽어 주지 마라. "이 패는 이 자리에서 폴드입니다" 같은 말은 앱이 이미 하고 있다. 너는 **어떻게 생각하면 되는지**와 **다음 판에 뭘 바꾸면 되는지**를 알려 준다.

## 절대 쓰지 말 것
- GTO, 솔버, EV, 에퀴티, 폴드 에퀴티, 빈도, 폴라, 양극화, 리니어, 밸런스, MDF, 콤보, 노드
- 레인지 퍼센트("상위 18%", "48% 레인지"), 혼합 빈도("30/70으로 믹스")
- 레인지 표기(ATo+, KJs+ 같은 것)
- 손패 이름은 한 덩어리에 2개까지만
- 퍼센트는 아래 둘만 허용한다: (1) 내 기록을 적는 줄의 내 정답률·횟수, (2) 셋 확률 12%, AK vs KK 30%, AK vs QQ 43%
- 스택 깊이 이야기(이 앱은 100bb 고정이다)
- 느낌표, 이모지

## 그대로 써도 되는 말
폴드 · 콜 · 레이즈 · 오픈 · 3벳 · 4벳 · 5벳 · 올인 · 블러프 · 페어 · 포켓페어 · 셋 · 킥커 · 드로우 · 플랍 · 턴 · 리버 · 포지션 · 블라인드 · 팟 · 스택 · 레인지 · 수티드 · 오프수트 · 커넥터 · 브로드웨이 · UTG · HJ · CO · BTN · SB · BB

## 문장 규칙
- 한 문장 = 한 가지. 25자 안팎. 접속사로 잇지 말고 끊어라.
- 결론부터. 어미는 "~하세요 / ~예요 / ~입니다"만.
- 사람을 평가하지 마라. "당신은 도박사예요" 같은 말 금지. 행동만 말해라. "문제를 풀 때 이렇게 기웁니다".
- 데이터에 없는 건 지어내지 마라. 표본이 적으면 적다고 말해라.`;

/**
 * 내 키로 직접 부를 때(L2)의 출력 형식. 앱이 `parseCoachCards` 로 파싱해 카드로 렌더하므로
 * JSON 이어야 하고, 길이 제한도 카드 상자에 맞춘 값입니다.
 */
const OUTPUT_JSON = `
## 출력 형식
JSON 배열 **하나만** 출력해라. 설명도, 코드 펜스도, 앞뒤 인사도 붙이지 마라.

\`\`\`
[
  { "tone": "good",  "title": "...", "evidence": "...", "steps": ["...", "..."] },
  { "tone": "focus", "title": "...", "evidence": "...", "steps": ["...", "...", "..."] },
  ...
]
\`\`\`

- 배열 길이는 정확히 4다. 첫 번째는 반드시 \`tone: "good"\`(잘하고 있는 것 한 줄), 나머지 3개는 \`tone: "focus"\`.
- \`title\` — 무엇이 새는지. 20자 이내. 단정문.
- \`evidence\` — 내 기록 한 줄. 30자 이내. 반드시 아래 데이터에 있는 숫자여야 한다. 예: "3벳 자리 실수 34개 중 22개가 콜이었어요".
- \`steps\` — 생각 절차 2~3줄. 각 25자 이내. 액션 지시로 끝내지 말고 **마지막 줄은 질문 하나로** 끝내라. 질문은 다음 판에 스스로 던질 수 있는 것이어야 한다.

## 나쁜 예 / 좋은 예
- 나쁜 예 title: "BTN RFI는 48% 레인지입니다"
- 좋은 예 title: "뒷자리에서 너무 좁게 칩니다"
- 나쁜 예 steps: ["AJo는 UTG에서 폴드입니다"]
- 좋은 예 steps: ["버튼 뒤에는 블라인드 두 명뿐이에요", "자리가 뒤로 갈수록 기준을 한 칸 내리세요", "이 패를 UTG라고 생각하고 접은 건 아닌가요?"]

---`;

/**
 * 복사해서 다른 AI 에 붙여넣을 때(L1)의 출력 형식.
 *
 * 이쪽은 **사람이 채팅 화면에서 그대로 읽는 답**입니다. 파서가 없으니 JSON 을 시킬 이유가 없고,
 * 시키면 읽기만 나빠집니다. 카드 상자가 없으므로 20자·25자 같은 길이 제한도 뜻이 없습니다.
 * 대신 개념적 조언이라는 본래 제약(차트 재설명 금지, 질문으로 끝내기)은 그대로 둡니다.
 * 채팅이라 이어서 물어볼 수 있다는 점도 알려 줍니다 — 이 경로의 장점이 그것이기 때문입니다.
 */
const OUTPUT_PLAIN = `
## 출력 형식
한국어 글로 답해라. JSON·표·코드 블록은 쓰지 마라 — 사람이 채팅 화면에서 눈으로 읽는다.

이 순서로 쓴다.

1. **잘하고 있는 것** — 두세 문장. 지적보다 먼저 온다.
2. **집중할 것 세 가지** — 하나씩 이렇게 쓴다.
   - 소제목 한 줄: 무엇이 새는지 (단정문)
   - 내 기록 한 줄: 아래 데이터에 있는 숫자
   - 어떻게 생각하면 되는지: 두세 문장. 사고 절차를 순서대로.
   - 다음 판에 스스로 던질 질문 한 줄
3. **마지막 한 줄** — 더 궁금한 게 있으면 물어보라고 한 문장.

소제목과 굵게, 목록 기호는 써도 된다. 전체 800자 안팎으로 끝내라.

## 나쁜 예 / 좋은 예
- 나쁜 예: "BTN RFI는 48% 레인지입니다"
- 좋은 예: "뒷자리에서 너무 좁게 칩니다"
- 나쁜 예: "AJo는 UTG에서 폴드입니다"
- 좋은 예: "버튼 뒤에는 블라인드 두 명뿐이에요. 자리가 뒤로 갈수록 기준을 한 칸 내리세요. 이 패를 UTG라고 생각하고 접은 건 아닌가요?"

---`;

/** L2(내 키 직접 호출)용. askClaude 가 이걸 `system` 으로 보냅니다. */
export const COACH_SYSTEM_PROMPT = COACH_SYSTEM_RULES + OUTPUT_JSON;

/** L1(복사해서 붙여넣기)용. buildPrompt 가 요약문 앞에 붙입니다. */
export const COACH_COPY_PROMPT = COACH_SYSTEM_RULES + OUTPUT_PLAIN;


/** 요약문 맨 앞에 붙는 제목. buildPrompt 가 시스템 규칙과 요약문을 잇는 자리이기도 합니다. */
const RECORD_HEADING = '# 이 사람의 기록';

/** 이 밑이면 "단정하지 말라"를 프롬프트에 끼웁니다(SPEC §7 단계 2). */
const SMALL_SAMPLE = 20;

/** 표에 쓰는 짧은 이름. SCENARIO_LABEL_KO 는 괄호 설명이 붙어 있어 한 줄 표에는 길어서 따로 둡니다. */
const KIND_SHORT_KO: Record<ScenarioKind, string> = {
  rfi: '오픈',
  vs_open: '오픈 대응',
  vs_3bet: '3벳 대응',
  vs_4bet: '4벳 대응',
  vs_5bet: '5벳 올인 대응',
  cold_4bet: '콜드 4벳',
};

/** 축의 세기를 숫자 대신 한국어 한 단어로 넘깁니다 — z 를 주면 AI 가 그 숫자를 인용합니다. */
const LEVEL_KO: Record<AxisView['level'], string> = {
  confident: '뚜렷해요',
  leaning: '조금 기울어 있어요',
  flat: '아직 한쪽으로 치우치지 않았어요',
  locked: '아직 못 재요',
};

/**
 * 상황·자리별 정답률.
 *
 * trials 는 srs 카드가 센 '답을 낸 횟수'이고 mistakes 는 stats 가 센 '실수 기록 수'라 모집단이
 * 다릅니다. 두 저장소가 어긋나면 분자가 음수가 되어 프롬프트에 "정답률 -800%"가 그대로 실립니다.
 * 감추지 말고, 두 수를 같은 모집단으로 볼 수 없다는 뜻이므로 칸을 비웁니다.
 */
function accuracy(trials: number, mistakes: number): string {
  if (trials <= 0 || mistakes > trials) return '—';
  return pct(trials - mistakes, trials);
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

function daysAgoKo(n: number): string {
  if (n <= 0) return '오늘';
  if (n === 1) return '어제';
  return `${n}일 전`;
}

/** 표는 마크다운으로 씁니다. 붙여넣기 경로(L1)에서 AI 가 가장 안정적으로 읽는 형식입니다. */
function table(head: string[], rows: string[][]): string {
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`];
  for (const r of rows) lines.push(`| ${r.join(' | ')} |`);
  return lines.join('\n');
}

function volumeSection(d: CoachDigest): string {
  const v = d.volume;
  const lines: string[] = [];
  lines.push(`- 퀴즈를 ${v.quizTotal}문제 풀어서 ${v.quizCorrect}문제를 맞혔어요 (정답률 ${pct(v.quizCorrect, v.quizTotal)}).`);
  lines.push(`- 퀴즈와 훈련을 합쳐 답을 낸 횟수는 모두 ${v.trials}번이에요.`);
  lines.push(`- 저장된 실수 ${v.mistakesStored}개 중 ${v.mistakesUsed}개를 분석에 썼어요.`);
  if (v.mistakesUsed > 0) {
    lines.push(`- 그 실수 중 ${Math.round(v.trainShare * 100)}%는 훈련 탭에서 나왔어요.`);
  }
  lines.push(`- 지금 연속 정답 ${v.streak}개, 최고 기록은 ${v.bestStreak}개예요.`);
  return `## 얼마나 풀었나\n${lines.join('\n')}`;
}

/** 왜 잠겼는지 한 문장. 화면(TendencyAxes)과 같은 갈래를 씁니다. */
function lockReason(a: AxisView): string {
  const where = a.needWhere ? `${a.needWhere} ` : '';
  if (a.lockedBy === 'no-baseline') return `${where}문제를 푼 기록이 없어 아직 기준을 못 잡았어요.`;
  if (a.lockedBy === 'baseline') return `${where}문제를 ${Math.max(a.baselineNeed ?? 1, 1)}개 더 풀면 기준이 잡혀요.`;
  return `${where}실수 ${Math.max(a.need, 1)}개가 더 쌓여야 열려요.`;
}

function axesSection(axes: AxisView[]): string {
  if (axes.length === 0) return '';
  const lines = axes.map((a) => {
    // 잠긴 축도 '실수 N개 더'로만 적으면 안 됩니다 — seat·pressure 는 특정 자리·상황의 실수만 세고,
    // 기준선이 아예 없으면 실수를 아무리 쌓아도 안 열립니다. 화면과 같은 사실을 AI에게도 말합니다.
    if (!a.unlocked) return `- ${a.koLabel} — ${LEVEL_KO.locked}. ${lockReason(a)}`;
    const where = a.level === 'flat' || !a.pole ? LEVEL_KO.flat : `'${a.pole}' 쪽이고 그 기울기가 ${LEVEL_KO[a.level]}`;
    return `- ${a.koLabel} — ${where}. 실수 ${a.sample}개로 재 봤어요.`;
  });
  const headline = axes.find((a) => a.headline);
  if (headline) lines.push(`- 가장 크게 기운 축은 '${headline.koLabel}'이에요. 이 사람 이야기의 중심으로 삼으세요.`);
  else lines.push('- 한 축만 골라 단정할 만큼 기운 축은 없어요.');
  return `## 내 성향 (출제 편향을 보정한 값)\n${lines.join('\n')}`;
}

function kindSection(d: CoachDigest): string {
  const rows = d.byKind
    .filter((r) => r.trials > 0)
    .map((r) => [KIND_SHORT_KO[r.kind], String(r.trials), String(r.mistakes), accuracy(r.trials, r.mistakes)]);
  if (rows.length === 0) return '';
  return `## 상황별 기록\n${table(['상황', '푼 횟수', '틀린 횟수', '정답률'], rows)}`;
}

function heroSection(d: CoachDigest): string {
  const rows = d.byHero
    .filter((r) => r.trials > 0)
    .map((r) => [r.hero, String(r.trials), String(r.mistakes), accuracy(r.trials, r.mistakes)]);
  if (rows.length === 0) return '';
  return `## 자리별 기록\n${table(['자리', '푼 횟수', '틀린 횟수', '정답률'], rows)}`;
}

function patternLine(p: PatternHit, i: number): string {
  const parts = [`${i + 1}. ${p.koName} — ${p.count}번`];
  if (p.recent7d > 0) parts.push(`(최근 7일에만 ${p.recent7d}번)`);
  parts.push(`· 서로 다른 손패 ${p.distinctHands}개`);
  // 손패 예시는 두 개까지만 넘깁니다 — 시스템 규칙이 카드에 두 개까지만 허용하는데,
  // 프롬프트에 세 개를 깔아 두면 AI 가 그대로 옮겨 적고 린터에 걸립니다.
  if (p.examples.length > 0) parts.push(`· 예: ${p.examples.slice(0, 2).join(', ')}`);
  return parts.join(' ');
}

function patternsSection(patterns: PatternHit[]): string {
  if (patterns.length === 0) return '';
  const rows = patterns.slice(0, 5).map(patternLine);
  return `## 되풀이되는 실수 뭉치\n${rows.join('\n')}`;
}

function goodSection(d: CoachDigest): string {
  if (!d.good) return '';
  const g = d.good;
  return `## 잘하고 있는 것\n- ${KIND_SHORT_KO[g.kind]}은 ${g.trials}번 중 ${Math.round(g.acc * 100)}%를 맞혔어요. 가장 잘 맞히는 상황이에요.`;
}

function weakSpotsSection(d: CoachDigest): string {
  if (d.weakSpots.length === 0) return '';
  const rows = d.weakSpots.map(
    (w) => `- ${w.hero} · ${KIND_SHORT_KO[w.kind]} — ${w.rated}번 중 ${Math.round(w.unsureRate * 100)}%를 헷갈린다고 표시했어요.`,
  );
  return `## 스스로 헷갈린다고 표시한 자리\n${rows.join('\n')}`;
}

function mistakeRow(m: CoachMistake): string[] {
  const situation = m.villain ? `${KIND_SHORT_KO[m.kind]} (상대 ${m.villain})` : KIND_SHORT_KO[m.kind];
  return [m.hand, situation, m.hero, ACTION_SHORT_KO[m.answer], ACTION_SHORT_KO[m.chosen], daysAgoKo(m.daysAgo)];
}

function recentSection(d: CoachDigest): string {
  if (d.recentMistakes.length === 0) return '## 최근 실수\n- 아직 기록된 실수가 없어요.';
  const rows = d.recentMistakes.slice(0, 20).map(mistakeRow);
  return `## 최근 실수 ${rows.length}건\n${table(['손패', '상황', '내 자리', '정답', '내 선택', '언제'], rows)}`;
}

/**
 * 사람이 읽어도 말이 되는 한국어 요약문. L1(복사 붙여넣기)에서는 사용자가 이 글을 눈으로 읽고
 * 나서 붙여넣으므로, 읽히지 않는 문장은 그 자리에서 들통납니다.
 */
export function buildDigestSummary(d: CoachDigest): string {
  const blocks: string[] = [volumeSection(d)];
  if (d.volume.mistakesUsed < SMALL_SAMPLE) {
    blocks.push(
      '## 표본 주의\n- 아직 표본이 적어요. 단정하지 말고 방향만 말해 주세요.\n- 없는 성향을 만들어 내지 말고, 지금 보이는 것까지만 말해 주세요.',
    );
  }
  for (const s of [
    axesSection(d.axes),
    kindSection(d),
    heroSection(d),
    patternsSection(d.patterns),
    goodSection(d),
    weakSpotsSection(d),
    recentSection(d),
  ]) {
    if (s) blocks.push(s);
  }
  return blocks.join('\n\n');
}

/** 시스템 규칙 + 요약문. [질문 복사하기] 버튼이 이걸 그대로 클립보드에 넣습니다. */
export function buildPrompt(d: CoachDigest): string {
  return `${COACH_COPY_PROMPT}\n\n${RECORD_HEADING}\n\n${buildDigestSummary(d)}\n`;
}
