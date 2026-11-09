// Every hand-written chart memo (notes) and summary, with the cell's mix — for review.
import { ALL_CHART_DEFS, getChartCells } from '../src/poker/data/index';
import { fullMix } from '../src/poker/range';
import { isReachable } from '../src/poker/atlas';
console.log('chart\thand\treachable\tmix\tmemo');
for (const def of ALL_CHART_DEFS) {
  const sc = { kind: def.kind, hero: def.hero, ...(def.villain ? { villain: def.villain } : {}) } as any;
  const cells = getChartCells(sc);
  for (const [h, note] of Object.entries(def.notes ?? {})) {
    const mix = fullMix(cells[h]).map((m) => `${m.action} ${Math.round(m.weight * 100)}%`).join(' / ');
    console.log(`${def.id}\t${h}\t${isReachable(sc, h).ok ? 'yes' : 'no'}\t${mix}\t${String(note).replace(/\t|\n/g, ' ')}`);
  }
}
