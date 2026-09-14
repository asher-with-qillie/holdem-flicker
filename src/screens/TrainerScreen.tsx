import { useCallback, useEffect, useMemo, useState } from 'react';
import { CapsuleButton } from '../components/ui/CapsuleButton';
import { SessionSummaryCard } from '../components/ui/SessionSummaryCard';
import { Sheet } from '../components/ui/Sheet';
import { toast } from '../components/ui/Toast';
import { consumeLaunch, launch, setChromeHidden, setTab, useNav, type LaunchIntent } from '../state/nav';
import { getProgress, useProgress } from '../state/progress';
import { getSettings, updateSettings, useSettings, type DeckId, type Settings } from '../state/settings';
import { weakKeys } from '../state/srs';
import '../styles/trainer.css';
import { DECK_LABEL, resolvePositions, WEAK_MIN } from './trainer/decks';
import { discardSession, getSession, startSession, togglePause, type SessionConfig, type StartResult } from './trainer/sessionStore';
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
    // 인텐트가 자리를 콕 집었으면 설정 필터를 태우지 않습니다. `resolvePositions` 는 설정에 없는 자리를
    // 버리고 **풀 전체로 되돌리므로**, 코치의 '이 상황만 훈련 · BB' 를 눌렀는데 전 좌석이 열릴 수 있었습니다.
    // 라벨이 약속한 자리와 열리는 화면이 어긋나는 건 안 됩니다. 그 자리에 낼 카드가 없으면
    // `startSession` 이 실패해 토스트로 이유를 말해 줍니다 — 조용히 다른 걸 여는 것보다 낫습니다.
    positions: intent.positions?.length ? [...intent.positions] : resolvePositions(settings.lastPositions, settings),
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

/** 누른 버튼의 라벨이 **어디로 가는지를 약속했는가**. 코치 카드·차트·약한 곳 행이 여기에 해당합니다. */
function pinsDestination(i: LaunchIntent): boolean {
  return !!(i.onlyKeys?.length || i.scenarioId || i.positions?.length);
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/**
 * 인텐트가 **콕 집은 칸만** 지금 돌고 있는 세션과 비교합니다.
 *
 * 안 집은 칸은 설정값으로 채워지는 것이라 비교 대상이 아닙니다 — 홈의 시작 버튼은 덱 하나만 집으므로
 * 자리가 달라도 '같은 세션을 이어서 하는 것'이 맞습니다. 여기서 전부 같으면 인텐트를 버려도 어긋나지 않습니다.
 */
function sameAsRunning(intent: LaunchIntent, cfg: SessionConfig, live: SessionConfig): boolean {
  if (intent.deck && cfg.deck !== live.deck) return false;
  if (intent.scenarioId && intent.scenarioId !== live.scenarioId) return false;
  if (intent.onlyKeys && !sameList(intent.onlyKeys, live.onlyKeys ?? [])) return false;
  if (intent.positions?.length && !sameList(cfg.positions, live.positions)) return false;
  return true;
}

/** 덱·자리를 한 줄로. 자리가 넷 이상이면 덱 이름만 씁니다 — 360px 에서 여섯 자리를 나열하면 줄이 넘칩니다. */
function whereLabel(c: SessionConfig): string {
  if (c.onlyKeys?.length) return `헷갈린 것만 · ${c.onlyKeys.length}장`;
  const deck = DECK_LABEL[c.deck];
  if (c.scenarioId || !c.positions.length || c.positions.length > 3) return deck;
  return `${deck} · ${c.positions.join('·')}`;
}

/** 진행 중인 세션과 어긋나는 인텐트를 물어보는 동안 들고 있는 것. 버리지 않는 게 핵심입니다. */
interface PendingAsk {
  intent: LaunchIntent;
  /** 물어보려고 우리가 멈춘 세션인가 — '이어서 하기' 를 고르면 멈추기 전으로 되돌립니다. */
  resume: boolean;
}

/**
 * 훈련 tab (§5.2–5.6): setup → session → summary in one screen, driven by `sessionStore` (module-level, so a
 * paused session survives a tab switch). Hides the floating tab bar while a session is running and consumes
 * `LaunchIntent`s from Home / Charts / 코치 / the summary CTAs.
 */
export function TrainerScreen() {
  const [settings] = useSettings();
  const nav = useNav();
  const s = useTrainerSession(settings);
  const pv = useProgress(settings.dailyGoal);
  const [preset, setPreset] = useState<SetupPreset | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  const [ask, setAsk] = useState<PendingAsk | null>(null);
  const status = s.status;

  // Tab bar hidden while running; back on pause / summary / unmount.
  useEffect(() => {
    setChromeHidden('trainer', status === 'running');
    return () => setChromeHidden('trainer', false);
  }, [status]);

  /** 인텐트를 실제로 여는 곳. 자동 시작이면 바로 시작하고, 아니면 설정 화면을 그 값으로 채웁니다. */
  const apply = useCallback((intent: LaunchIntent) => {
    if (intent.deck && intent.deck !== 'scenario' && !intent.onlyKeys) updateSettings({ lastDeck: intent.deck });
    if (intent.positions?.length && !intent.scenarioId) updateSettings({ lastPositions: intent.positions });
    const current = getSettings();
    if (intent.autostart) {
      if (begin(configFromIntent(intent, current)).ok) return;
    } else if (getSession()) discardSession();
    const p: SetupPreset = {};
    if (intent.deck) p.deck = intent.deck;
    if (intent.positions?.length) p.positions = intent.positions;
    if (intent.scenarioId) p.scenarioId = intent.scenarioId;
    if (intent.onlyKeys) p.onlyKeys = intent.onlyKeys;
    setPreset(p);
  }, []);

  // Launch intents — on mount and whenever one arrives while mounted (summary CTAs, Home / Charts / 코치).
  useEffect(() => {
    if (!nav.launch || nav.launch.target !== 'train') return;
    const intent = consumeLaunch();
    if (!intent) return;
    const st = getSession();
    if (st && (st.status === 'running' || st.status === 'paused')) {
      // 인텐트가 집은 칸이 지금 세션과 다 같으면 그게 곧 '이어서 하기' 다 — 홈의 시작 버튼이 여기로 온다.
      if (sameAsRunning(intent, configFromIntent(intent, getSettings()), st.config)) return;
      if (pinsDestination(intent)) {
        // 라벨이 자리를 약속했는데 다른 화면이 뜨는 것도, 하던 세션을 말없이 지우는 것도 안 된다.
        // 둘 다 피하는 길은 묻는 것 하나뿐이라 인텐트를 들고 기다린다. 묻는 동안 카드가 넘어가지
        // 않게 세션을 멈춰 둔다(시트가 떠 있어도 타이머는 계속 돌기 때문).
        const wasRunning = st.status === 'running';
        if (wasRunning) togglePause();
        setAsk((prev) => ({ intent, resume: prev?.resume ?? wasRunning }));
        return;
      }
      // 덱만 다른 인텐트(홈 시작 버튼 등)는 목적지를 약속하지 않았으므로 묻지 않고 이어서 하되,
      // 왜 누른 것과 다른 화면이 떴는지는 한 줄로 말해 준다.
      toast('훈련이 진행 중이라 이어서 해요', 'amber');
      return;
    }
    apply(intent);
  }, [nav.launch, apply]);

  /** 시트에 띄울 두 목적지. 세션은 멈춰 있으므로 이 값들은 시트가 열려 있는 동안 변하지 않습니다. */
  const askInfo = useMemo(() => {
    const live = ask ? getSession() : null;
    if (!ask || !live) return null;
    return {
      now: whereLabel(live.config),
      next: whereLabel(configFromIntent(ask.intent, settings)),
      seen: live.queue.filter((c) => c.exposed).length,
    };
  }, [ask, settings]);

  const keepGoing = useCallback(() => {
    // 우리가 멈춘 세션만 되돌립니다. 사용자가 직접 일시정지해 둔 세션은 그대로 둡니다.
    if (ask?.resume && getSession()?.status === 'paused') togglePause();
    setAsk(null);
  }, [ask]);

  const startAsked = useCallback(() => {
    const pending = ask;
    setAsk(null);
    if (pending) apply(pending.intent);
  }, [ask, apply]);

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

      {/* 어긋난 인텐트: 버리지도, 하던 세션을 지우지도 않고 사용자가 고르게 한다. 닫으면 하던 것이 남는다. */}
      <Sheet
        open={!!askInfo}
        onClose={keepGoing}
        title="훈련이 진행 중이에요"
        footer={
          <>
            <CapsuleButton tone="neutral" size="lg" block onClick={keepGoing}>
              이어서 하기
            </CapsuleButton>
            <CapsuleButton tone="primary" size="lg" block onClick={startAsked}>
              새로 시작
            </CapsuleButton>
          </>
        }
      >
        {askInfo && (
          <>
            <p className="trainer-confirm t-body">하던 것 · {askInfo.now}</p>
            <p className="trainer-confirm t-body">방금 누른 것 · {askInfo.next}</p>
            <p className="trainer-confirm t-footnote tnum">새로 시작해도 본 카드 {askInfo.seen}장은 저장돼요</p>
          </>
        )}
      </Sheet>

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
