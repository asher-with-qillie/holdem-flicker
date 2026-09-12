import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { GlassPanel } from '../../components/ui/GlassPanel';
import { IconPlay } from '../../components/ui/icons';
import { ProgressRing } from '../../components/ui/ProgressRing';

export interface TodayPanelProps {
  todayCards: number;
  goal: number;
  /** today's rated cards → thin inner ring (0 hides it) */
  rated: number;
  goalDone: boolean;
  /** previewQueue() counts for the next session */
  preview: { new: number; due: number; unsure: number };
  /** today's quiz answers — second line only when > 0 */
  quizToday: number;
  cta: string;
  ctaTrailing: string;
  onStart(): void;
  reducedMotion: boolean;
}

/** §5.1 today card: ProgressRing 88/8 (gold when the goal is done) + queue preview + the one primary CTA. */
export function TodayPanel({ todayCards, goal, rated, goalDone, preview, quizToday, cta, ctaTrailing, onStart, reducedMotion }: TodayPanelProps): JSX.Element {
  const ringProps = rated > 0 ? { innerValue: rated } : {};
  return (
    <GlassPanel as="section" className="home-today" aria-label="오늘 진행">
      <div className="home-today__row">
        <ProgressRing
          value={todayCards}
          max={goal}
          size={88}
          stroke={8}
          tint={goalDone ? 'var(--gold)' : 'var(--mint)'}
          animate={!reducedMotion}
          label={
            <span className="home-today__count">
              {todayCards}/{goal}
            </span>
          }
          {...ringProps}
        />
        <div className="home-today__text">
          <p className="home-today__line">
            <span>
              <i className="home-dot" style={{ background: 'var(--sky)' }} aria-hidden="true" />
              복습 {preview.due}
            </span>
            <span>
              <i className="home-dot" style={{ background: 'var(--amber)' }} aria-hidden="true" />
              헷갈려요 {preview.unsure}
            </span>
            <span>
              <i className="home-dot" style={{ background: 'var(--lilac)' }} aria-hidden="true" />새 카드 {preview.new}
            </span>
          </p>
          {quizToday > 0 && <p className="home-today__line">퀴즈 {quizToday}문제</p>}
        </div>
      </div>
      <CapsuleButton tone="primary" size="xl" block icon={<IconPlay />} trailing={ctaTrailing} onClick={onStart}>
        {cta}
      </CapsuleButton>
    </GlassPanel>
  );
}
