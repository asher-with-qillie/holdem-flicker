import { writeFileSync } from 'node:fs';
import { ALL_CHART_DEFS } from '../src/poker/data/index';
import { explainStep } from '../src/poker/explain';
import { stepFor } from '../src/poker/trainer';
import { isReachable, handAtlas, rfiThesis, sectionDigest, sectionDigestDetail } from '../src/poker/atlas';
import { ALL_HANDS } from '../src/poker/hands';
const OUT = process.argv[2];
const rows: string[] = ['chart\thand\tcapsule\tline\tsibling\tpartial\tnumbers\tlever\tacross\tmemo\texample\tdisclaimer'];
const clean = (s: unknown) => (s == null ? '' : String(s).replace(/\t|\n/g, ' '));
const sums: string[] = ['chart\tsummary'];
for (const def of ALL_CHART_DEFS) {
  const sc = { kind: def.kind, hero: def.hero, ...(def.villain ? { villain: def.villain } : {}) } as any;
  sums.push(`${def.id}\t${clean(def.summary)}`);
  for (const hand of ALL_HANDS) {
    if (!isReachable(sc, hand).ok) continue;
    const ex = explainStep(stepFor(sc, hand));
    rows.push([def.id, hand, ex.capsule.label, ex.line.sentence?.text, ex.sibling?.text, ex.mix?.partial, ex.seat.numbers, ex.seat.lever, ex.across.line.text, ex.more.memo, ex.more.example, ex.disclaimer].map(clean).join('\t'));
  }
}
writeFileSync(`${OUT}/steps.tsv`, rows.join('\n'));
writeFileSync(`${OUT}/summaries.tsv`, sums.join('\n'));
const at: string[] = ['hand\tkind\ttext'];
for (const hand of ALL_HANDS) {
  const a = handAtlas(hand);
  for (const l of rfiThesis(a)) at.push(`${hand}\tthesis\t${clean(l.text)}`);
  for (const [k, sec] of Object.entries(a.sections)) { at.push(`${hand}\tdigest:${k}\t${clean(sectionDigest(sec as any).text)}`); const d = sectionDigestDetail(sec as any); if (d) at.push(`${hand}\tdetail:${k}\t${clean(d.text)}`); }
}
writeFileSync(`${OUT}/atlas.tsv`, at.join('\n'));
console.log('steps', rows.length - 1, 'charts', sums.length - 1, 'atlas', at.length - 1);
