// Every chart × hand → action mix (incl. the rest action) and reachability. Output: TSV on stdout.
import { ALL_CHART_DEFS, getChartCells } from '../src/poker/data/index';
import { fullMix, primaryAction } from '../src/poker/range';
import { ALL_HANDS } from '../src/poker/hands';
import { isReachable } from '../src/poker/atlas';
console.log('chart\thand\treachable\tprimary\tmix');
for (const def of ALL_CHART_DEFS) {
  const sc = { kind: def.kind, hero: def.hero, ...(def.villain ? { villain: def.villain } : {}) } as any;
  const cells = getChartCells(sc);
  for (const h of ALL_HANDS) {
    const r = isReachable(sc, h);
    const mix = fullMix(cells[h]).map((m) => `${m.action} ${Math.round(m.weight * 100)}%`).join(' / ');
    console.log(`${def.id}\t${h}\t${r.ok ? 'yes' : `no(${r.gate ?? ''})`}\t${primaryAction(cells[h])}\t${mix}`);
  }
}
