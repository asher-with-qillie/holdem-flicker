/**
 * 차트 메모(chart.notes, 사람 작성 647개)와 차트 요약(chart.summary, 74개)의 어미를 해요체로 바꾸는
 * 제안 diff — docs/EXPLAIN_SPEC.md §6.4.
 *
 *   npx vite-node scripts/sweep-notes.ts            # 바뀔 메모·요약을 - / + 로 출력만 합니다
 *   npx vite-node scripts/sweep-notes.ts --write    # src/poker/data/*.ts 에 그대로 씁니다
 *
 * 요약도 메모와 같은 화면(차트 탭 · 해설의 차트)에 나오므로 같은 표로 한꺼번에 돌립니다.
 * 이미 정리된 줄에는 아무 규칙도 걸리지 않으니 몇 번을 돌려도 결과가 같습니다.
 *
 * 하는 일은 두 가지뿐입니다. 합니다체 어미 → 해요체, 명령형 → 서술형.
 * 내용(숫자, 괄호 풀이, '→' 예시의 카드와 승률)은 건드리지 않습니다(§6.4, §8).
 * 기계 치환이 어색하게 만든 문장과 번역투(앞서다 · 접다 · 3벳을 맞다 …)는 사람이 손으로 고칩니다.
 * 그래서 끝에 BANNED(§2.6)에 아직 걸리는 메모를 따로 찍어 줍니다.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bannedHits, hasFinal } from '../src/poker/ko';

const DATA_DIR = fileURLToPath(new URL('../src/poker/data', import.meta.url));
const WRITE = process.argv.includes('--write');

/** 메모 한 줄: `      KJo: '…',` 또는 `      '65s': '…',` (데이터 파일은 한 메모 = 한 줄입니다). */
const NOTE_LINE = /^(\s+'?[2-9TJQKA]{2}[so]?'?: ')(.*)(',)$/;
/** 요약 한 줄: `    summary: '…',`. 길면 `    summary:` 다음 줄에 `      '…',` 로 내려 씁니다. */
const SUMMARY_LINE = /^(\s+summary: ')(.*)(',)$/;
const SUMMARY_HEAD = /^\s+summary:$/;
const SUMMARY_BODY = /^(\s+')(.*)(',)$/;

/**
 * 치환 표. 위에서부터 차례로 적용합니다(긴 꼴이 먼저).
 * 명령형 → 서술형이 먼저이고, 합니다체 → 해요체가 그다음입니다.
 */
const RULES: Array<[RegExp, string]> = [
  // 명령형 → 서술형 (§6.4)
  [/항상 4벳 블러프로 쓰세요/g, '4벳 블러프로 늘 써요'],
  [/하지 마세요/g, '하지 않아요'],
  [/하세요/g, '해요'],
  [/가세요/g, '가요'],
  [/쓰세요/g, '써요'],
  [/섞으세요/g, '섞어요'],
  [/받으세요/g, '받아요'],
  [/보세요/g, '봐요'],
  [/올리세요/g, '올려요'],
  // 합니다체 → 해요체 (§6.4 표 + 메모에 실제로 나오는 나머지 동사)
  [/앞섭니다/g, '이겨요'],
  [/이깁니다/g, '이겨요'],
  [/줄어듭니다/g, '줄어요'],
  [/줄입니다/g, '줄여요'],
  [/집니다/g, '져요'], // 집니다 · 좁아집니다 · 얇아집니다 · 낮아집니다
  [/밀립니다/g, '밀려요'],
  [/눌립니다/g, '눌려요'],
  [/버립니다/g, '버려요'],
  [/노립니다/g, '노려요'],
  [/시킵니다/g, '시켜요'],
  [/지킵니다/g, '지켜요'],
  [/지나칩니다/g, '지나쳐요'],
  [/까다롭습니다/g, '까다로워요'],
  [/어렵습니다/g, '어려워요'],
  [/없습니다/g, '없어요'],
  [/있습니다/g, '있어요'],
  [/않습니다/g, '않아요'],
  [/받습니다/g, '받아요'],
  [/많습니다/g, '많아요'],
  [/낮습니다/g, '낮아요'],
  [/높습니다/g, '높아요'],
  [/좋습니다/g, '좋아요'],
  [/맞습니다/g, '맞아요'],
  [/잡습니다/g, '잡아요'],
  [/적습니다/g, '적어요'],
  [/넓습니다/g, '넓어요'],
  [/좁습니다/g, '좁아요'],
  [/같습니다/g, '같아요'],
  [/섞습니다/g, '섞어요'],
  [/섞입니다/g, '섞여요'],
  [/넓힙니다/g, '넓혀요'],
  [/넘습니다/g, '넘어요'],
  [/남습니다/g, '남아요'],
  [/낫습니다/g, '나아요'],
  [/쌉니다/g, '싸요'], // 쌉니다 · 비쌉니다
  [/큽니다/g, '커요'],
  [/씁니다/g, '써요'],
  [/줍니다/g, '줘요'],
  [/둡니다/g, '둬요'],
  [/됩니다/g, '돼요'],
  [/싸웁니다/g, '싸워요'],
  [/법니다/g, '벌어요'],
  [/모자랍니다/g, '모자라요'],
  [/드뭅니다/g, '드물어요'],
  [/끝납니다/g, '끝나요'],
  [/합니다/g, '해요'],
];

/** `…입니다` → 앞 낱말의 받침에 따라 `예요/이에요`. 괄호 풀이 뒤면 괄호 앞 낱말을 봅니다. */
function copula(text: string): string {
  return text.replace(/(\S+)입니다/g, (_, word: string) => {
    const head = word.endsWith(')') ? word.slice(0, word.lastIndexOf('(')) : word;
    return `${word}${hasFinal(head) ? '이에요' : '예요'}`;
  });
}

export function sweepNote(text: string): string {
  let out = text;
  for (const [re, to] of RULES) out = out.replace(re, to);
  return copula(out);
}

interface Change { file: string; line: number; before: string; after: string }

/** 이 줄이 메모나 요약이면 [앞, 본문, 뒤]. `prev` 는 바로 윗줄(요약이 두 줄로 나뉜 경우를 봅니다). */
function matchText(raw: string, prev: string | undefined): [string, string, string] | null {
  const m = NOTE_LINE.exec(raw) ?? SUMMARY_LINE.exec(raw) ?? (prev !== undefined && SUMMARY_HEAD.test(prev) ? SUMMARY_BODY.exec(raw) : null);
  return m ? [m[1]!, m[2]!, m[3]!] : null;
}

function main(): void {
  const changes: Change[] = [];
  const leftovers: Array<{ file: string; line: number; text: string; hits: string[] }> = [];
  let total = 0;
  for (const name of readdirSync(DATA_DIR).filter((f) => f.endsWith('.ts')).sort()) {
    const path = join(DATA_DIR, name);
    const lines = readFileSync(path, 'utf8').split('\n');
    let dirty = false;
    lines.forEach((raw, i) => {
      const m = matchText(raw, lines[i - 1]);
      if (!m) return;
      total++;
      const [head, body, tail] = m;
      const next = sweepNote(body);
      if (next !== body) {
        changes.push({ file: name, line: i + 1, before: body, after: next });
        lines[i] = `${head}${next}${tail}`;
        dirty = true;
      }
      const hits = bannedHits(next);
      if (hits.length) leftovers.push({ file: name, line: i + 1, text: next, hits });
    });
    if (WRITE && dirty) writeFileSync(path, lines.join('\n'));
  }

  for (const c of changes) {
    console.log(`${c.file}:${c.line}`);
    console.log(`- ${c.before}`);
    console.log(`+ ${c.after}`);
  }
  console.log(`\n메모·요약 ${total}개 중 ${changes.length}개 변경${WRITE ? ' (기록함)' : ' (제안만, --write 로 기록)'}`);
  if (leftovers.length) {
    console.log(`\n손으로 고칠 메모·요약 ${leftovers.length}개 (BANNED §2.6):`);
    for (const l of leftovers) console.log(`${l.file}:${l.line} [${l.hits.join(', ')}] ${l.text}`);
  }
}

main();
