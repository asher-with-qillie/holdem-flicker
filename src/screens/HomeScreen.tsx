/**
 * 홈 (spec §5.1) — owner C.
 *
 * Reads: settings (goal, session size, decks, speed), progress (`useProgress(goal)`: today, streaks, heat
 * days, lastResult), srs (`useSrs()` version + `counts` / `weakSpots` / `weakKeys` / `previewQueue`).
 * Writes nothing; navigation goes through `launch()` / `openSettings()` (§3). App.tsx renders this for
 * the `home` tab; the screen adds `padding-bottom: var(--content-bottom)` via `.screen`.
 */
import { useMemo } from 'react';
import { IconButton } from '../components/ui/IconButton';
import { StatTile } from '../components/ui/StatTile';
import { IconFlame, IconGear } from '../components/ui/icons';
import { launch, openSettings, type DeckId } from '../state/nav';
import { getProgress, levelName, useProgress, type DayLog } from '../state/progress';
import { presetTiming, useSettings } from '../state/settings';
import { counts, previewQueue, useSrs, weakKeys, weakSpots, type WeakSpot } from '../state/srs';
import { ActivityPanel } from './home/ActivityPanel';
import { deckForKind, homeCopy, levelInfo, streakLabel } from './home/copy';
import { LastSession } from './home/LastSession';
import { TodayPanel } from './home/TodayPanel';
import { useReducedMotion } from './home/useReducedMotion';
import { WEAK_DECK_MIN, WeakSpots } from './home/WeakSpots';
import '../styles/home.css';

const NO_PREVIEW = { new: 0, due: 0, unsure: 0 };

/** DayLog of any day through the public API: getProgress() at noon of that day (dayKey = date of ts − 4 h). */
function logForDay(goal: number, key: string): DayLog {
  const [y, m, d] = key.split('-').map(Number);
  return getProgress(goal, new Date(y, m - 1, d, 12).getTime()).today;
}

export function HomeScreen(): JSX.Element {
  const [settings] = useSettings();
  const srsVersion = useSrs();
  const progress = useProgress(settings.dailyGoal);
  const reducedMotion = useReducedMotion();

  const positions = settings.lastPositions ?? settings.positions;
  const srs = useMemo(() => {
    const weakCount = weakKeys().length;
    // The CTA uses settings.lastDeck; 내 약점 is only a valid deck once it has ≥ 10 cards, so fall back to 전체 until then.
    const deck: DeckId = settings.lastDeck === 'weak' && weakCount < WEAK_DECK_MIN ? 'all' : settings.lastDeck;
    let preview = NO_PREVIEW;
    try {
      preview = previewQueue({
        size: settings.sessionSize,
        deck,
        positions,
        kinds: settings.kinds,
        mode: 'train',
        interestingBias: settings.interestingBias,
        activeDays: progress.activeDays,
      });
    } catch {
      /* a bad deck/position combination previews as zeros; the trainer shows the real reason */
    }
    return { weakCount, deck, preview, tiles: counts(settings.kinds, settings.positions), learnedAll: counts().learned, spots: weakSpots(3) };
  }, [srsVersion, settings.lastDeck, settings.sessionSize, positions, settings.kinds, settings.positions, settings.interestingBias, progress.activeDays]);

  const timing = presetTiming(settings);
  const cadenceMs = settings.exposureMode ? timing.expose + timing.transition : timing.think + timing.reveal + timing.transition;
  // The CTA states what the deck will actually hold: in the first week the queue caps new cards at 10 (§7.1), so a
  // fresh install previews ~11 cards, not the 20 of the session size.
  const previewTotal = srs.preview.new + srs.preview.due + srs.preview.unsure;
  const sessionCards = previewTotal > 0 ? Math.min(settings.sessionSize, previewTotal) : settings.sessionSize;
  const copy = homeCopy({
    activeDays: progress.activeDays,
    todayCards: progress.today.cards,
    goal: settings.dailyGoal,
    streak: progress.streak,
    restDays: progress.restDays,
    prevStreak: progress.prevStreak,
    goalReachedToday: progress.goalReachedToday,
    sessionSize: sessionCards,
    cadenceMs,
  });
  const level = levelInfo(srs.learnedAll);
  const showLevel = srs.learnedAll >= 1;
  const empty = copy.state === 'empty';

  const start = () => launch({ target: 'train', deck: srs.deck, autostart: true });
  const trainSpot = (s: WeakSpot) => launch({ target: 'train', deck: deckForKind(s.kind), positions: [s.hero], autostart: true });
  const trainWeak = () => launch({ target: 'train', deck: 'weak', autostart: true });

  return (
    <div className="screen home" data-state={copy.state}>
      <div className="home__top">
        <div className="home__head">
          <p className={`home__eyebrow${progress.streak > 0 ? '' : ' home__eyebrow--cold'}`}>
            <IconFlame size={16} />
            <span className="tnum">{streakLabel(progress.streak)}</span>
            {showLevel && <span> · {levelName(srs.learnedAll)}</span>}
          </p>
          <h1 className="t-title-l home__title">{copy.headline}</h1>
          <p className="home__sub">{copy.sub}</p>
        </div>
        <IconButton icon={<IconGear />} label="설정" onClick={() => openSettings(true)} />
      </div>

      <TodayPanel
        todayCards={progress.today.cards}
        goal={settings.dailyGoal}
        rated={progress.today.rated}
        goalDone={progress.goalReachedToday}
        preview={srs.preview}
        quizToday={progress.today.quiz}
        cta={copy.cta}
        ctaTrailing={copy.ctaTrailing}
        onStart={start}
        reducedMotion={reducedMotion}
      />

      <div className="home__tiles" role="group" aria-label="카드 현황">
        <StatTile label="외웠어요" value={srs.tiles.learned} dot="var(--mint)" />
        <StatTile label="배우는 중" value={srs.tiles.learning} dot="var(--amber)" />
        <StatTile label="새 카드" value={srs.tiles.fresh} dot="var(--lilac)" />
      </div>

      {showLevel && (
        <div className="home-level" aria-label="레벨">
          <div className="home-level__row">
            <span className="home-level__name">{level.name}</span>
            <span className="home-level__next tnum">{level.next ? `${level.next.name}까지 ${level.next.remaining}장` : '최고 레벨이에요'}</span>
          </div>
          <div className="home-level__bar" role="progressbar" aria-valuenow={Math.round(level.ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className="home-level__fill" style={{ width: `${Math.round(level.ratio * 100)}%` }} />
          </div>
        </div>
      )}

      <WeakSpots spots={srs.spots} weakCount={srs.weakCount} onTrainSpot={trainSpot} onTrainWeak={trainWeak} />

      <ActivityPanel days={progress.days} goal={settings.dailyGoal} todayKey={progress.todayKey} totalCards={progress.totalCards} empty={empty} logFor={(key) => logForDay(settings.dailyGoal, key)} />

      {progress.lastResult && !empty && <LastSession result={progress.lastResult} goal={settings.dailyGoal} todayCards={progress.today.cards} weekDots={progress.weekDots} />}
    </div>
  );
}
