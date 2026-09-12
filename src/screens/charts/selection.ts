import { hasChart } from '../../poker/data';
import { allScenarios, positionsBefore } from '../../poker/scenarios';
import { POSITIONS, SCENARIO_KINDS, type Pos, type Scenario, type ScenarioKind } from '../../poker/types';

/** What the chart browser remembers: kind + hero (+ villain when the kind has one). */
export interface ChartSelection {
  kind: ScenarioKind;
  hero: Pos;
  villain?: Pos;
}

/** Short chip labels (the full `SCENARIO_LABEL_KO` is too long for a chip row at 390px). */
export const KIND_CHIP_LABEL: Record<ScenarioKind, string> = {
  rfi: '오픈',
  vs_open: '오픈 대응',
  vs_3bet: '3벳 대응',
  vs_4bet: '4벳 대응',
  vs_5bet: '올인 대응',
  cold_4bet: '콜드 4벳',
};

/** Accessible label for the villain chip row, per kind (absent = the kind has no villain). */
export const VILLAIN_LABEL: Partial<Record<ScenarioKind, string>> = {
  vs_open: '오픈한 상대',
  vs_3bet: '3벳한 상대',
  vs_4bet: '오픈 후 4벳한 상대',
  vs_5bet: '3벳 후 올인한 상대',
};

const SCENARIOS: Scenario[] = allScenarios();

export function kindHasVillain(kind: ScenarioKind): boolean {
  return kind !== 'rfi' && kind !== 'cold_4bet';
}

/** Hero seats that exist for `kind`, in preflop order. */
export function heroesFor(kind: ScenarioKind): Pos[] {
  const set = new Set<Pos>();
  for (const s of SCENARIOS) if (s.kind === kind) set.add(s.hero);
  return POSITIONS.filter((p) => set.has(p));
}

/** Villain seats that exist for `kind` + `hero`, in preflop order (empty when the kind has no villain). */
export function villainsFor(kind: ScenarioKind, hero: Pos): Pos[] {
  const set = new Set<Pos>();
  for (const s of SCENARIOS) if (s.kind === kind && s.hero === hero && s.villain) set.add(s.villain);
  return POSITIONS.filter((p) => set.has(p));
}

export function kindHasAnyChart(kind: ScenarioKind): boolean {
  return SCENARIOS.some((s) => s.kind === kind && hasChart(s));
}

export function heroHasAnyChart(kind: ScenarioKind, hero: Pos): boolean {
  return SCENARIOS.some((s) => s.kind === kind && s.hero === hero && hasChart(s));
}

/** Coerce any partial/stale selection into a valid (kind, hero, villain) combination. */
export function normalizeSelection(raw: Partial<ChartSelection> | null | undefined): ChartSelection {
  const kind: ScenarioKind = raw?.kind && SCENARIO_KINDS.includes(raw.kind) ? raw.kind : 'rfi';
  const heroes = heroesFor(kind);
  const hero: Pos = raw?.hero && heroes.includes(raw.hero) ? raw.hero : heroes[0];
  const villains = villainsFor(kind, hero);
  if (!villains.length) return { kind, hero };
  const villain: Pos = raw?.villain && villains.includes(raw.villain) ? raw.villain : villains[0];
  return { kind, hero, villain };
}

/** The scenario to look up / explain. cold_4bet gets display-only seats: first seat opens, last seat before hero 3-bets. */
export function toScenario(sel: ChartSelection): Scenario {
  if (sel.kind === 'cold_4bet') {
    const before = positionsBefore(sel.hero);
    return { kind: sel.kind, hero: sel.hero, extras: { opener: before[0], threeBettor: before[before.length - 1] } };
  }
  return sel.villain ? { kind: sel.kind, hero: sel.hero, villain: sel.villain } : { kind: sel.kind, hero: sel.hero };
}

/* ---- sessionStorage (selection + 내 기록 overlay toggle survive tab switches, not app restarts) ---- */

const STORAGE_KEY = 'holdem-flicker.charts.selection.v1';
const OVERLAY_KEY = 'holdem-flicker.charts.overlay.v1';

export function loadSelection(): ChartSelection {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return normalizeSelection(raw ? (JSON.parse(raw) as Partial<ChartSelection>) : null);
  } catch {
    return normalizeSelection(null);
  }
}

export function saveSelection(sel: ChartSelection) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sel));
  } catch {
    /* ignore (private mode, quota) */
  }
}

export function loadOverlay(): boolean {
  try {
    return sessionStorage.getItem(OVERLAY_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveOverlay(on: boolean) {
  try {
    sessionStorage.setItem(OVERLAY_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** "45%", "8.1%", "12.4%" — one decimal, trailing .0 dropped. */
export function formatPct(x: number): string {
  return `${(x * 100).toFixed(1).replace(/\.0$/, '')}%`;
}
