import { Chip } from '../../components/ui/Chip';
import { ChipRow } from '../../components/ui/ChipRow';
import { toast } from '../../components/ui/Toast';
import { POSITIONS, type Pos, type ScenarioKind } from '../../poker/types';
import { DECK_KINDS, type DeckId } from '../../state/settings';

/**
 * Focus-deck and position chip rows (spec §5.2 / §5.7 — the shared DeckChips logic lives here; the
 * trainer may import it). Store-agnostic: the caller owns the selection and persists it to
 * `settings.lastDeck` / `settings.lastPositions`.
 */

export const DECK_ORDER: ReadonlyArray<Exclude<DeckId, 'scenario'>> = ['all', 'rfi', 'vs_open', 'vs_3bet', 'vs_4bet_allin', 'weak'];

export const DECK_LABELS: Record<DeckId, string> = {
  all: '전체',
  rfi: '오픈',
  vs_open: '오픈 대응',
  vs_3bet: '3벳 대응',
  vs_4bet_allin: '4벳/올인',
  weak: '내 약점',
  scenario: '이 상황',
};

/** 내 약점 opens once this many weak cards exist (§6.4). */
export const WEAK_MIN = 10;
export const WEAK_LOCKED_HINT = '아직 없어요 · 10장만 평가하면 열려요';
export const NO_CHARTS_HINT = '이 조합의 차트가 아직 없어요';

/** Scenario kinds behind a deck. 'all' and 'weak' follow `settings.kinds` (the SRS narrows 'weak' itself). */
export function deckKinds(deck: DeckId, settingsKinds: ScenarioKind[]): ScenarioKind[] {
  if (deck === 'all' || deck === 'weak' || deck === 'scenario') return settingsKinds;
  return DECK_KINDS[deck];
}

export interface DeckChipsProps {
  value: DeckId;
  onChange(deck: DeckId): void;
  /** Size of the 내 약점 deck; below `WEAK_MIN` the chip is locked and taps show the hint. */
  weakCount: number;
}

export function DeckChips({ value, onChange, weakCount }: DeckChipsProps): JSX.Element {
  const weakLocked = weakCount < WEAK_MIN;
  return (
    <ChipRow ariaLabel="덱">
      {DECK_ORDER.map((d) => {
        if (d === 'weak') {
          return (
            <Chip
              key={d}
              className={`quiz-chip${weakLocked ? ' quiz-chip--locked' : ''}`}
              selected={value === d}
              tint="var(--amber)"
              count={weakCount}
              aria-disabled={weakLocked || undefined}
              title={weakLocked ? WEAK_LOCKED_HINT : undefined}
              onClick={() => (weakLocked ? toast(WEAK_LOCKED_HINT, 'amber') : onChange(d))}
            >
              ⚡ {DECK_LABELS[d]}
            </Chip>
          );
        }
        return (
          <Chip key={d} className="quiz-chip" selected={value === d} onClick={() => onChange(d)}>
            {DECK_LABELS[d]}
          </Chip>
        );
      })}
    </ChipRow>
  );
}

export interface PositionChipsProps {
  /** Selected heroes (always ≥ 1). */
  value: Pos[];
  /** The positions on offer — `settings.positions`. "전체" selects all of them. */
  all: Pos[];
  onChange(positions: Pos[]): void;
}

export function PositionChips({ value, all, onChange }: PositionChipsProps): JSX.Element {
  const offered = POSITIONS.filter((p) => all.includes(p));
  const isAll = offered.every((p) => value.includes(p));
  const toggle = (p: Pos) => {
    if (isAll) {
      onChange([p]);
      return;
    }
    if (value.includes(p)) {
      if (value.length > 1) onChange(value.filter((q) => q !== p));
      return;
    }
    onChange(POSITIONS.filter((q) => q === p || value.includes(q)));
  };
  return (
    <ChipRow ariaLabel="포지션">
      <Chip className="quiz-chip" selected={isAll} onClick={() => onChange(offered)}>
        전체
      </Chip>
      {offered.map((p) => (
        <Chip key={p} className="quiz-chip tnum" selected={!isAll && value.includes(p)} onClick={() => toggle(p)}>
          {p}
        </Chip>
      ))}
    </ChipRow>
  );
}

/** Resolve `settings.lastPositions` (null = all) against the offered positions; never empty. */
export function resolvePositions(last: Pos[] | null, all: Pos[]): Pos[] {
  const offered = POSITIONS.filter((p) => all.includes(p));
  if (!last) return offered;
  const kept = offered.filter((p) => last.includes(p));
  return kept.length ? kept : offered;
}
