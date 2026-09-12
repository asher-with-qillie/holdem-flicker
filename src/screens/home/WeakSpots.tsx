import { Chip } from '../../components/ui/Chip';
import { GlassPanel } from '../../components/ui/GlassPanel';
import { IconNext } from '../../components/ui/icons';
import type { WeakSpot } from '../../state/srs';
import { pct, spotLabel } from './copy';

/** 내 약점 deck opens at this many weak cards (§6.4). */
export const WEAK_DECK_MIN = 10;

export interface WeakSpotsProps {
  spots: WeakSpot[];
  /** weakKeys().length — the 내 약점 deck size */
  weakCount: number;
  onTrainSpot(spot: WeakSpot): void;
  onTrainWeak(): void;
}

/** §5.1 약한 곳: kind × position buckets with ≥ 8 ratings; each row launches only that situation. */
export function WeakSpots({ spots, weakCount, onTrainSpot, onTrainWeak }: WeakSpotsProps): JSX.Element {
  const deckReady = weakCount >= WEAK_DECK_MIN;
  return (
    <section className="home-section" aria-label="약한 곳">
      <header className="home-sec">
        <h2 className="t-title-3">약한 곳</h2>
        {deckReady ? (
          <button type="button" className="home-link" onClick={onTrainWeak}>
            내 약점 덱 훈련
            <IconNext size={18} />
          </button>
        ) : (
          <span className="home-sec__aside">{spots.length ? `내 약점 덱 · ${WEAK_DECK_MIN}장만 평가하면 열려요` : ''}</span>
        )}
      </header>
      {spots.length === 0 ? (
        <GlassPanel className="glass-flat home-empty" radius="lg" padding={16}>
          {WEAK_DECK_MIN}장만 평가하면 약점이 보여요
        </GlassPanel>
      ) : (
        <GlassPanel className="glass-flat" radius="lg" padding={12}>
          <ul className="home-spots">
            {spots.map((s) => {
              const label = spotLabel(s.kind, s.hero);
              const meta = [`헷갈려요 ${pct(s.unsureRate)}`, s.quizAcc !== undefined ? `퀴즈 ${pct(s.quizAcc)}` : ''].filter(Boolean).join(' · ');
              return (
                <li key={`${s.kind}:${s.hero}`} className="home-spot">
                  <i className="home-spot__dot" aria-hidden="true" />
                  <div className="home-spot__text">
                    <span className="home-spot__name">{label}</span>
                    <span className="home-spot__meta tnum">{meta}</span>
                  </div>
                  <Chip size={32} onClick={() => onTrainSpot(s)} aria-label={`${label} 이 상황만 훈련`}>
                    이 상황만 훈련
                  </Chip>
                </li>
              );
            })}
          </ul>
        </GlassPanel>
      )}
    </section>
  );
}
