// Every reason key that occurs on a reachable cell → all its cells with mixes. JSON on stdout.
import { ALL_CHART_DEFS, getChartCells } from '../src/poker/data/index';
import { ALL_HANDS } from '../src/poker/hands';
import { isReachable } from '../src/poker/atlas';
import { fullMix } from '../src/poker/range';
import { reasonKey } from '../src/poker/theory/keys';
const map: Record<string, Array<{ chart: string; hand: string; mix: string }>> = {};
for (const def of ALL_CHART_DEFS) {
  const sc = { kind: def.kind, hero: def.hero, ...(def.villain ? { villain: def.villain } : {}) } as any;
  const cells = getChartCells(sc);
  for (const h of ALL_HANDS) {
    if (!isReachable(sc, h).ok) continue;
    const k = reasonKey(sc, h, cells[h]);
    (map[k] ??= []).push({ chart: def.id, hand: h, mix: fullMix(cells[h]).map((m) => `${m.action} ${Math.round(m.weight * 100)}%`).join(' / ') });
  }
}
console.log(JSON.stringify(map, null, 1));
