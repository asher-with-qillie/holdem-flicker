import { buildChart } from '../range';
import { allScenarios, scenarioId, scenarioKey } from '../scenarios';
import type { ChartCells, ChartDef, Scenario } from '../types';
import { RFI_CHARTS } from './rfi';
import { VS_OPEN_CHARTS } from './vsOpen';
import { VS_3BET_CHARTS } from './vs3bet';
import { VS_4BET_CHARTS } from './vs4bet';
import { VS_5BET_CHARTS } from './vs5bet';
import { COLD_4BET_CHARTS } from './cold4bet';

export const ALL_CHART_DEFS: ChartDef[] = [
  ...RFI_CHARTS,
  ...VS_OPEN_CHARTS,
  ...VS_3BET_CHARTS,
  ...VS_4BET_CHARTS,
  ...VS_5BET_CHARTS,
  ...COLD_4BET_CHARTS,
];

const defsById = new Map<string, ChartDef>();
for (const def of ALL_CHART_DEFS) {
  const expected = scenarioId(def.kind, def.hero, def.villain);
  if (def.id !== expected) throw new Error(`Chart id "${def.id}" should be "${expected}"`);
  if (defsById.has(def.id)) throw new Error(`Duplicate chart id ${def.id}`);
  defsById.set(def.id, def);
}

const cellCache = new Map<string, ChartCells>();

export function getChartDef(s: Scenario): ChartDef {
  const def = defsById.get(scenarioKey(s));
  if (!def) throw new Error(`No chart for ${scenarioKey(s)}`);
  return def;
}

export function hasChart(s: Scenario): boolean {
  return defsById.has(scenarioKey(s));
}

export function getChartCells(s: Scenario): ChartCells {
  const key = scenarioKey(s);
  let cells = cellCache.get(key);
  if (!cells) {
    cells = buildChart(getChartDef(s));
    cellCache.set(key, cells);
  }
  return cells;
}

/** Scenarios that are missing a chart (should be empty once all data is authored). */
export function missingScenarios(): Scenario[] {
  return allScenarios().filter((s) => !hasChart(s));
}
