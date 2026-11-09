// Structural facts per chart (for the explanation rewrite): range shares per action, whether a call range exists.
import { ALL_CHART_DEFS, getChartCells } from '../src/poker/data/index';
import { rangeShare } from '../src/poker/range';
const acts = ['raise', 'call', 'threebet', 'fourbet', 'allin', 'fold', 'check'] as const;
for (const def of ALL_CHART_DEFS) {
  const sc = { kind: def.kind, hero: def.hero, ...(def.villain ? { villain: def.villain } : {}) } as any;
  const cells = getChartCells(sc);
  const parts = acts.map((a) => { try { const v = rangeShare(cells, a as any); return v > 0.0005 ? `${a} ${(v * 100).toFixed(1)}%` : null; } catch { return null; } }).filter(Boolean);
  console.log(`${def.id.padEnd(22)} ${parts.join(' · ')}`);
}
