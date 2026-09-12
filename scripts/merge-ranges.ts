/**
 * Consensus merge of independently authored range charts.
 * Usage: npx vite-node scripts/merge-ranges.ts out.json a.json b.json c.json
 * Each input: { charts: ChartDef[] }. Output: { charts: ChartDef[] (merged), report: [...] }
 *
 * Per hand, per action: weight = mean of author weights (missing author = 0 for that action).
 * Primary action = argmax (fold = 1 - sum). Cells where authors' primary actions disagree are reported.
 * Merged weights are rounded to 0.25 steps to keep charts memorizable; tiny weights (< 0.2) drop.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { buildChart, foldWeight, primaryAction } from '../src/poker/range';
import { ALL_HANDS } from '../src/poker/hands';
import { ACTIONS, type Action, type ChartDef } from '../src/poker/types';

const [outPath, ...inputs] = process.argv.slice(2);
if (!outPath || inputs.length === 0) {
  console.error('usage: merge-ranges.ts out.json in1.json in2.json ...');
  process.exit(1);
}
const authors = inputs.map((p) => JSON.parse(readFileSync(p, 'utf8')) as { charts: ChartDef[] });
const ids = new Set<string>();
for (const a of authors) for (const c of a.charts) ids.add(c.id);

const merged: ChartDef[] = [];
const report: string[] = [];

for (const id of [...ids].sort()) {
  const defs = authors.map((a) => a.charts.find((c) => c.id === id)).filter((d): d is ChartDef => !!d);
  const cellsList = defs.map((d) => buildChart(d));
  const base = defs[0];
  const acc: Record<string, Partial<Record<Action, number>>> = {};
  const disagreements: string[] = [];
  for (const h of ALL_HANDS) {
    const mixes = cellsList.map((c) => c[h] ?? {});
    const prim = mixes.map((m) => primaryAction(m));
    const mix: Partial<Record<Action, number>> = {};
    for (const a of ACTIONS) {
      if (a === 'fold') continue;
      const mean = mixes.reduce((s, m) => s + (m[a] ?? 0), 0) / mixes.length;
      const rounded = Math.round(mean * 4) / 4;
      if (rounded >= 0.25) mix[a] = rounded;
    }
    // normalize if rounding pushed the sum above 1
    const sum = Object.values(mix).reduce((s, w) => s + (w ?? 0), 0);
    if (sum > 1) for (const a of Object.keys(mix) as Action[]) mix[a] = Math.round(((mix[a] ?? 0) / sum) * 4) / 4;
    if (Object.keys(mix).length) acc[h] = mix;
    if (new Set(prim).size > 1) disagreements.push(`${h}: ${prim.join('/')} → ${primaryAction(mix)} (fold ${foldWeight(mix).toFixed(2)})`);
  }
  // Re-serialize as range strings per action
  const actions: Partial<Record<Exclude<Action, 'fold'>, string>> = {};
  for (const a of ACTIONS) {
    if (a === 'fold') continue;
    const toks: string[] = [];
    for (const h of ALL_HANDS) {
      const w = acc[h]?.[a];
      if (w) toks.push(w >= 1 ? h : `${h}:${w}`);
    }
    if (toks.length) actions[a] = toks.join(',');
  }
  const notes: Record<string, string> = {};
  for (const d of defs) Object.assign(notes, d.notes ?? {});
  merged.push({ id, kind: base.kind, hero: base.hero, villain: base.villain, actions, summary: defs.map((d) => d.summary).filter(Boolean).join(' | '), notes });
  report.push(`## ${id} (${defs.length} authors)\n` + (disagreements.length ? disagreements.join('\n') : 'no primary-action disagreements'));
}
writeFileSync(outPath, JSON.stringify({ charts: merged, report }, null, 2));
console.log(report.join('\n\n'));
