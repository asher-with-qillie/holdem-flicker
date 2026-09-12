/**
 * Focus decks, speed timing and small formatting helpers shared by the trainer's setup / session / summary
 * views (spec §5.2, §6.2, §6.4). Pure functions only — no store subscriptions.
 */
import { feasiblePositions } from '../../poker/trainer';
import { POSITIONS, SCENARIO_KINDS, type Pos, type ScenarioKind } from '../../poker/types';
import { DECK_KINDS, SPEED_PRESETS, type DeckId, type Settings, type SpeedPreset } from '../../state/settings';

export const DECK_ORDER: ReadonlyArray<Exclude<DeckId, 'scenario'>> = ['all', 'rfi', 'vs_open', 'vs_3bet', 'vs_4bet_allin', 'weak'];

export const DECK_LABEL: Record<DeckId, string> = {
  all: '전체',
  rfi: '오픈',
  vs_open: '오픈 대응',
  vs_3bet: '3벳 대응',
  vs_4bet_allin: '4벳/올인',
  weak: '내 약점',
  scenario: '이 상황',
};

/** Short kind names used in the summary's weakest label ("SB · 오픈 대응") and the crumbs. */
export const KIND_SHORT: Record<ScenarioKind, string> = {
  rfi: '오픈',
  vs_open: '오픈 대응',
  vs_3bet: '3벳 대응',
  vs_4bet: '4벳 대응',
  vs_5bet: '올인 대응',
  cold_4bet: '콜드 4벳',
};

/** 내 약점 needs at least this many weak cards (§6.4). */
export const WEAK_MIN = 10;

export type Origin = 'new' | 'due' | 'unsure' | 'requeue' | 'quizWrong';

export const ORIGIN_TAG: Record<Origin, { label: string; color: string }> = {
  new: { label: '새 카드', color: 'var(--lilac)' },
  due: { label: '복습', color: 'var(--sky)' },
  unsure: { label: '헷갈려요', color: 'var(--amber)' },
  requeue: { label: '다시', color: 'var(--amber)' },
  quizWrong: { label: '퀴즈 오답', color: 'var(--coral)' },
};

/** Scenario kinds a deck trains ('all' → the kinds enabled in settings; weak/scenario are resolved by srs.ts). */
export function deckKinds(deck: DeckId, settingsKinds: ScenarioKind[]): ScenarioKind[] {
  if (deck === 'all' || deck === 'weak' || deck === 'scenario') return settingsKinds.length ? settingsKinds : [...SCENARIO_KINDS];
  return DECK_KINDS[deck];
}

/** Does deck × positions have at least one chart to train? (`feasiblePositions` is the engine's own check.) */
export function hasChartsFor(deck: DeckId, positions: Pos[], settings: Pick<Settings, 'kinds' | 'interestingBias'>): boolean {
  const kinds = deckKinds(deck, settings.kinds);
  return feasiblePositions({ positions: positions.length ? positions : [...POSITIONS], kinds, interestingBias: settings.interestingBias }).length > 0;
}

export interface Timing {
  think: number;
  reveal: number;
  expose: number;
  transition: number;
}

/** Exact ms per preset (§6.2); `custom` reads the seconds sliders (expose = reveal, slide 300). Minimum 200 ms. */
export function timingFor(speed: SpeedPreset, settings: Pick<Settings, 'thinkSeconds' | 'revealSeconds'>): Timing {
  if (speed === 'custom') {
    const think = Math.max(200, Math.round(settings.thinkSeconds * 1000));
    const reveal = Math.max(200, Math.round(settings.revealSeconds * 1000));
    return { think, reveal, expose: reveal, transition: 300 };
  }
  const { think, reveal, expose, transition } = SPEED_PRESETS[speed];
  return { think, reveal, expose, transition };
}

/** Seconds per card: think + reveal (or expose) + the card transition. 순간기억 = 250 + 550 + 120 = 920 ms. */
export function cadenceMs(t: Timing, exposure: boolean): number {
  return (exposure ? t.expose : t.think + t.reveal) + t.transition;
}

/** Estimated session time = size × cadence + 0.3 s (§5.2). */
export function estimateMs(size: number, t: Timing, exposure: boolean): number {
  return size * cadenceMs(t, exposure) + 300;
}

export function formatEstimate(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  if (total < 60) return `약 ${Math.max(5, Math.round(total / 5) * 5)}초`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (s < 15) return `약 ${m}분`;
  if (s < 45) return `약 ${m}분 30초`;
  return `약 ${m + 1}분`;
}

/** "보통" / "순간기억" / "노출 · 보통" / "사용자" */
export function speedLabel(speed: SpeedPreset, exposure: boolean): string {
  const base = speed === 'custom' ? '사용자' : SPEED_PRESETS[speed].label;
  return exposure ? `노출 · ${base}` : base;
}

/** Positions to train: an explicit selection, else every position enabled in settings. */
export function resolvePositions(selected: Pos[] | null, settings: Pick<Settings, 'positions'>): Pos[] {
  const pool = settings.positions.length ? settings.positions : [...POSITIONS];
  if (!selected || !selected.length) return [...pool];
  const kept = selected.filter((p) => pool.includes(p));
  return kept.length ? kept : [...pool];
}
