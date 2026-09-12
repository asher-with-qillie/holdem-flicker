import { useCallback, useEffect, useMemo, useState } from 'react';
import { SessionSummaryCard } from '../components/ui/SessionSummaryCard';
import { Sheet } from '../components/ui/Sheet';
import { toast } from '../components/ui/Toast';
import { consumeLaunch, launch, setChromeHidden, setTab, useNav, type LaunchIntent } from '../state/nav';
import { getProgress, useProgress } from '../state/progress';
import { getSettings, updateSettings, useSettings, type DeckId, type Settings } from '../state/settings';
import { weakKeys } from '../state/srs';
import '../styles/trainer.css';
import { resolvePositions, WEAK_MIN } from './trainer/decks';
import { discardSession, getSession, startSession, type SessionConfig, type StartResult } from './trainer/sessionStore';
import { SessionView } from './trainer/SessionView';
import { SetupView, type SetupPreset } from './trainer/SetupView';
import { SummaryView, toSummaryData } from './trainer/SummaryView';
import { useTrainerSession } from './trainer/useTrainerSession';

const START_ERROR: Record<'no_charts' | 'empty', string> = { no_charts: '이 조합의 차트가 아직 없어요', empty: '훈련할 카드가 없어요' };

/** Session config from a launch intent + current settings (§5.2 / §6.4). */
function configFromIntent(intent: Pick<LaunchIntent, 'deck' | 'positions' | 'scenarioId' | 'onlyKeys'>, settings: Settings): SessionConfig {
  let deck: DeckId = intent.deck ?? (intent.scenarioId ? 'scenario' : settings.lastDeck);
  if (deck === 'weak' && weakKeys().length < WEAK_MIN) deck = 'all';
  const config: SessionConfig = {
    deck,
    positions: resolvePositions(intent.positions?.length ? intent.positions : settings.lastPositions, settings),
    size: settings.sessionSize,
    speed: settings.speedPreset,
    exposure: settings.exposureMode,
    manual: !settings.autoAdvance || !!intent.onlyKeys,
  };
  if (intent.scenarioId) config.scenarioId = intent.scenarioId;
  if (intent.onlyKeys) config.onlyKeys = intent.onlyKeys;
  return config;
}

function begin(config: SessionConfig): StartResult {
  if (getSession()) discardSession();
  const r = startSession(config);
  if (!r.ok) toast(START_ERROR[r.reason], 'amber');
  return r;
}

/**
 * 훈련 tab (§5.2–5.6): setup → session → summary in one screen, driven by `sessionStore` (module-level, so a
 * paused session survives a tab switch). Hides the floating tab bar while a session is running and consumes
 * `LaunchIntent`s from Home / Charts / the summary CTAs.
 */
export function TrainerScreen() {
  const [settings] = useSettings();
  const nav = useNav();
  const s = useTrainerSession(settings);
  const pv = useProgress(settings.dailyGoal);
  const [preset, setPreset] = useState<SetupPreset | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  const status = s.status;

  // Tab bar hidden while running; back on pause / summary / unmount.
  useEffect(() => {
    setChromeHidden('trainer', status === 'running');
    return () => setChromeHidden('trainer', false);
  }, [status]);

  // Launch intents — on mount and whenever one arrives while mounted (summary CTAs, Home/Charts).
  useEffect(() => {
    if (!nav.launch || nav.launch.target !== 'train') return;
    const intent = consumeLaunch();
    if (!intent) return;
    const st = getSession();
    const focused = !!(intent.onlyKeys || intent.scenarioId);
    if (st && (st.status === 'running' || st.status === 'paused') && !focused) return; // "이어서 하기": keep the session in progress
    if (intent.deck && intent.deck !== 'scenario' && !intent.onlyKeys) updateSettings({ lastDeck: intent.deck });
    if (intent.positions?.length && !intent.scenarioId) updateSettings({ lastPositions: intent.positions });
    const current = getSettings();
    if (intent.autostart) {
      if (begin(configFromIntent(intent, current)).ok) return;
    } else if (st) discardSession();
    const p: SetupPreset = {};
    if (intent.deck) p.deck = intent.deck;
    if (intent.positions?.length) p.positions = intent.positions;
    if (intent.scenarioId) p.scenarioId = intent.scenarioId;
    if (intent.onlyKeys) p.onlyKeys = intent.onlyKeys;
    setPreset(p);
  }, [nav.launch]);

  const onStart = useCallback((config: SessionConfig) => {
    setPreset(null);
    begin(config);
  }, []);

  const onAgain = useCallback(() => {
    const cfg = getSession()?.config;
    if (cfg) begin(cfg);
  }, []);
  const onRetryUnsure = useCallback((keys: string[]) => {
    if (!keys.length) return;
    launch({ target: 'train', onlyKeys: keys, autostart: true });
  }, []);
  const onQuiz = useCallback((keys: string[]) => {
    discardSession();
    launch({ target: 'quiz', onlyKeys: keys, autostart: true });
  }, []);
  const onHome = useCallback(() => {
    discardSession();
    setTab('home');
  }, []);

  const lastResult = pv.lastResult && pv.lastResult.mode === 'train' ? pv.lastResult : undefined;
  const lastData = useMemo(() => {
    if (!lastOpen || !lastResult) return null;
    const view = getProgress(settings.dailyGoal);
    return toSummaryData(lastResult, view, settings.dailyGoal, { partial: lastResult.seen < lastResult.config.size, firstSession: false });
  }, [lastOpen, lastResult, settings.dailyGoal]);

  return (
    <div className={`trainer trainer--${status}`}>
      {status === 'idle' && <SetupView settings={settings} preset={preset} onStart={onStart} lastResult={lastResult} onOpenLast={() => setLastOpen(true)} />}
      {(status === 'running' || status === 'paused') && <SessionView s={s} settings={settings} />}
      {status === 'summary' && s.result && (
        <SummaryView result={s.result} partial={!!s.session?.endedEarly} settings={settings} onRetryUnsure={onRetryUnsure} onAgain={onAgain} onQuiz={onQuiz} onHome={onHome} />
      )}

      <Sheet open={lastOpen} onClose={() => setLastOpen(false)} detent="full" title="지난 세션">
        {lastData && lastResult && (
          <SessionSummaryCard
            data={lastData}
            onRetryUnsure={() => {
              setLastOpen(false);
              onRetryUnsure(lastResult.unsureKeys);
            }}
            onAgain={() => {
              setLastOpen(false);
              begin(configFromIntent({ deck: lastResult.config.deck === 'scenario' ? 'all' : lastResult.config.deck, positions: lastResult.config.positions }, getSettings()));
            }}
            onQuiz={() => {
              setLastOpen(false);
              onQuiz(lastResult.allKeys);
            }}
            onHome={() => setLastOpen(false)}
          />
        )}
      </Sheet>
    </div>
  );
}
