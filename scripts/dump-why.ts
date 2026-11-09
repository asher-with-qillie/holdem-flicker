/*
 * 시트 한 장에 같이 보이는 해설 전부를 칸마다 한 줄로 — 조각끼리 서로 어긋나지 않는지 사람이(또는 리뷰 에이전트가) 읽는 용도.
 *   ./node_modules/.bin/vite-node scripts/dump-why.ts <out-dir>
 * why.tsv: 칸마다 캡슐 · 줄 문장 · 자리 이유 · 숫자 줄 · 이 패 이유 · 원리 칩 · 책과 다른 점 · 메모
 * charts.tsv: 차트마다 요약 · 자리 이유 · 숫자 줄 · 상황 단위 책과 다른 점
 */
import { writeFileSync } from 'node:fs';
import { ALL_CHART_DEFS } from '../src/poker/data/index';
import { explainStep } from '../src/poker/explain';
import { stepFor } from '../src/poker/trainer';
import { isReachable } from '../src/poker/atlas';
import { ALL_HANDS } from '../src/poker/hands';
import { PRINCIPLES } from '../src/poker/theory/principles';
import { spotReason } from '../src/poker/theory/spot';
import { getChartCells } from '../src/poker/data';
import { fullMix } from '../src/poker/range';

const OUT = process.argv[2];
const clean = (s: unknown) => (s == null ? '' : String(s).replace(/\t|\n/g, ' '));
const rows = ['chart\thand\tmix\tcapsule\tline\tspot\thand_reason\tchips\tbook_diff\tmemo'];
const charts = ['chart\tsummary\tspot\tnumbers\tbook_diff'];
for (const def of ALL_CHART_DEFS) {
  const sc = { kind: def.kind, hero: def.hero, ...(def.villain ? { villain: def.villain } : {}) } as any;
  const sp = spotReason(sc);
  charts.push([def.id, def.summary, sp.lines.join(' '), sp.numbers, sp.bookDiff].map(clean).join('\t'));
  const cells = getChartCells(sc);
  for (const hand of ALL_HANDS) {
    if (!isReachable(sc, hand).ok) continue;
    const ex = explainStep(stepFor(sc, hand));
    const mix = fullMix(cells[hand]).map((m) => `${m.action} ${Math.round(m.weight * 100)}%`).join(' / ');
    rows.push(
      [def.id, hand, mix, ex.capsule.label, ex.line.sentence?.text, ex.why.spot.text, ex.why.hand, ex.why.principles.map((p) => PRINCIPLES[p].chip).join('·'), ex.why.bookDiff.join(' ‖ '), ex.more.memo]
        .map(clean)
        .join('\t'),
    );
  }
}
writeFileSync(`${OUT}/why.tsv`, rows.join('\n'));
writeFileSync(`${OUT}/charts.tsv`, charts.join('\n'));
console.log('cells', rows.length - 1, 'charts', charts.length - 1);
