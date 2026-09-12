/**
 * Validate an authored chart JSON file. Usage: npx vite-node scripts/validate-charts.ts work/<group>/<file>.json
 * Exits non-zero on hard errors. Prints per-chart range shares so authors can sanity-check sizes.
 */
import { readFileSync } from 'node:fs';
import { buildChart, primaryAction, rangeShare } from '../src/poker/range';
import { ALL_HANDS } from '../src/poker/hands';
import { allScenarios, scenarioId } from '../src/poker/scenarios';
import { ACTIONS, SCENARIO_ACTIONS, type Action, type ChartDef } from '../src/poker/types';

const path = process.argv[2];
if (!path) {
  console.error('usage: validate-charts.ts file.json');
  process.exit(1);
}
const data = JSON.parse(readFileSync(path, 'utf8')) as { charts: ChartDef[] };
const validIds = new Set(allScenarios().map((s) => scenarioId(s.kind, s.hero, s.villain)));
const errors: string[] = [];
const warnings: string[] = [];
const rows: string[] = [];

for (const def of data.charts) {
  const expected = scenarioId(def.kind, def.hero, def.villain);
  if (def.id !== expected) errors.push(`${def.id}: id should be "${expected}"`);
  if (!validIds.has(expected)) errors.push(`${def.id}: not a valid scenario (hero/villain order?)`);
  const legal = new Set<Action>(SCENARIO_ACTIONS[def.kind] ?? []);
  for (const a of Object.keys(def.actions ?? {})) if (!legal.has(a as Action)) errors.push(`${def.id}: action "${a}" not legal for ${def.kind}`);
  let cells;
  try {
    cells = buildChart(def);
  } catch (e) {
    errors.push(`${def.id}: ${(e as Error).message}`);
    continue;
  }
  const aggressive = SCENARIO_ACTIONS[def.kind].at(-1)!;
  if (primaryAction(cells.AA) !== aggressive) errors.push(`${def.id}: AA must be ${aggressive}`);
  if (primaryAction(cells.KK) === 'fold') errors.push(`${def.id}: KK must not fold`);
  for (const h of ['72o', '83o', '92o']) if (primaryAction(cells[h]) !== 'fold') errors.push(`${def.id}: ${h} must fold`);
  for (const h of Object.keys(def.notes ?? {})) if (!ALL_HANDS.includes(h)) errors.push(`${def.id}: note for unknown hand "${h}"`);
  if (!def.summary || def.summary.length < 10) warnings.push(`${def.id}: missing/short summary`);
  const shares = ACTIONS.filter((a) => a !== 'fold' && legal.has(a)).map((a) => `${a}=${(rangeShare(cells, a) * 100).toFixed(1)}%`);
  rows.push(`${def.id.padEnd(22)} total=${(rangeShare(cells) * 100).toFixed(1)}%  ${shares.join('  ')}`);
}

console.log(rows.join('\n'));
if (warnings.length) console.log('\nWARNINGS:\n' + warnings.join('\n'));
if (errors.length) {
  console.error('\nERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`\nOK: ${data.charts.length} charts valid`);
