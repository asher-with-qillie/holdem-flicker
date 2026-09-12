/**
 * Generate a TS data module from reconciled chart JSON files.
 * Usage: npx vite-node scripts/json-to-ts.ts <module> <EXPORT_NAME> <out.ts> <in1.json> [in2.json ...]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { ChartDef } from '../src/poker/types';

const [moduleName, exportName, out, ...inputs] = process.argv.slice(2);
if (!moduleName || !exportName || !out || inputs.length === 0) {
  console.error('usage: json-to-ts.ts <module> <EXPORT_NAME> <out.ts> <in.json...>');
  process.exit(1);
}
const charts: ChartDef[] = inputs.flatMap((p) => (JSON.parse(readFileSync(p, 'utf8')) as { charts: ChartDef[] }).charts);
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const lines: string[] = [];
lines.push(`import type { ChartDef } from '../types';`, '');
lines.push(`/** ${moduleName} charts — generated from reconciled author consensus (see docs/RANGE_SPEC.md). Edit freely; run npm test after. */`);
lines.push(`export const ${exportName}: ChartDef[] = [`);
for (const c of charts) {
  lines.push('  {');
  lines.push(`    id: ${q(c.id)},`);
  lines.push(`    kind: ${q(c.kind)},`);
  lines.push(`    hero: ${q(c.hero)},`);
  if (c.villain) lines.push(`    villain: ${q(c.villain)},`);
  lines.push('    actions: {');
  for (const [a, str] of Object.entries(c.actions)) {
    if (!str) continue;
    const tokens = String(str).split(/\s*,\s*/).filter(Boolean);
    lines.push(`      ${a}: [`);
    for (let i = 0; i < tokens.length; i += 8) lines.push(`        ${tokens.slice(i, i + 8).map(q).join(', ')},`);
    lines.push(`      ].join(','),`);
  }
  lines.push('    },');
  if (c.summary) lines.push(`    summary: ${q(c.summary)},`);
  const notes = Object.entries(c.notes ?? {});
  if (notes.length) {
    lines.push('    notes: {');
    for (const [h, n] of notes) lines.push(`      ${/^[A-Z]/.test(h) ? h : q(h)}: ${q(n)},`);
    lines.push('    },');
  }
  lines.push('  },');
}
lines.push('];', '');
writeFileSync(out, lines.join('\n'));
console.log(`wrote ${charts.length} charts to ${out}`);
