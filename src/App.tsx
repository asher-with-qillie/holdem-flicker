import { useEffect, useState } from 'react';
import { ChartsScreen } from './screens/ChartsScreen';
import { QuizScreen } from './screens/QuizScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TrainerScreen } from './screens/TrainerScreen';
import { CapsuleButton } from './components/ui/CapsuleButton';
import { FloatingTabBar } from './components/ui/FloatingTabBar';
import { GlassPanel } from './components/ui/GlassPanel';
import { IconButton } from './components/ui/IconButton';
import { ProgressRing } from './components/ui/ProgressRing';
import { StatTile } from './components/ui/StatTile';
import { ToastHost } from './components/ui/Toast';
import { UiFixtures } from './components/ui/UiFixtures';
import { IconBack, IconCards, IconFlame, IconGear, IconGrid, IconHome, IconQuiz } from './components/ui/icons';
import { launch, openSettings, setTab, useNav, useUiChrome, type TabId } from './state/nav';
import { useSettings } from './state/settings';

export type { TabId } from './state/nav';

const TABS: Array<{ id: TabId; label: string; icon: JSX.Element }> = [
  { id: 'home', label: '홈', icon: <IconHome /> },
  { id: 'train', label: '훈련', icon: <IconCards /> },
  { id: 'quiz', label: '퀴즈', icon: <IconQuiz /> },
  { id: 'charts', label: '차트', icon: <IconGrid /> },
];

/** Inline placeholder until owner C lands src/screens/HomeScreen.tsx (§5.1 layout skeleton, first-run copy). */
function HomePlaceholder() {
  const [settings] = useSettings();
  return (
    <div className="screen home-ph">
      <div className="home-ph__top">
        <div>
          <p className="home-ph__eyebrow">
            <IconFlame size={16} /> 0일째 · 새싹
          </p>
          <h1 className="t-title-l">포커 프리플랍, 카드로 외워요</h1>
          <p className="home-ph__sub">첫 세션 20장 · 약 2분이면 끝나요</p>
        </div>
        <IconButton icon={<IconGear />} label="설정" onClick={() => openSettings(true)} />
      </div>

      <GlassPanel className="home-ph__card">
        <div className="home-ph__ring">
          <ProgressRing value={0} max={settings.dailyGoal} size={88} stroke={8} label={<span>0/{settings.dailyGoal}</span>} />
          <div className="home-ph__ringtext">
            <b>오늘 {settings.dailyGoal}장 남았어요</b>
            <span>복습 0 · 헷갈려요 0 · 새 카드 {settings.sessionSize}</span>
          </div>
        </div>
        <CapsuleButton tone="primary" size="xl" block onClick={() => launch({ target: 'train', deck: settings.lastDeck })} trailing="· 20장">
          훈련 시작
        </CapsuleButton>
      </GlassPanel>

      <div className="home-ph__tiles">
        <StatTile label="외웠어요" value={0} dot="var(--mint)" />
        <StatTile label="배우는 중" value={0} dot="var(--amber)" />
        <StatTile label="새 카드" value="—" dot="var(--lilac)" />
      </div>

      <GlassPanel className="glass-flat">
        <p className="home-ph__empty">첫 세션을 하면 여기가 채워져요</p>
      </GlassPanel>
    </div>
  );
}

function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

/** Keeps the pushed 설정 mounted during its 240 ms exit slide. */
function usePresence(open: boolean, exitMs: number): boolean {
  const [present, setPresent] = useState(open);
  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    const t = window.setTimeout(() => setPresent(false), exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);
  return present;
}

export default function App() {
  const hash = useHash();
  const nav = useNav();
  const chrome = useUiChrome();
  const settingsPresent = usePresence(nav.settingsOpen, 240);

  if (hash === '#ui') return <UiFixtures />;

  const fixed = nav.tab === 'train';
  const barHidden = chrome.tabBarHidden;

  return (
    <div className="app">
      <main className={`app__main${fixed ? ' app__main--fixed' : ''}${barHidden ? ' app__main--barless' : ''}`}>
        <div key={nav.tab} className="app__view">
          {nav.tab === 'home' && <HomePlaceholder />}
          {nav.tab === 'train' && <TrainerScreen />}
          {nav.tab === 'quiz' && <QuizScreen />}
          {nav.tab === 'charts' && <ChartsScreen />}
        </div>
      </main>

      <FloatingTabBar items={TABS} active={nav.tab} onChange={setTab} hidden={barHidden} />
      <ToastHost />

      {settingsPresent && (
        <div className={`app__push${nav.settingsOpen ? ' app__push--in' : ''}`} role="dialog" aria-modal="true" aria-label="설정" aria-hidden={!nav.settingsOpen}>
          <div className="app__push-head">
            <button type="button" className="app__push-back" onClick={() => openSettings(false)}>
              <IconBack />
              뒤로
            </button>
          </div>
          <div className="app__push-body">
            <SettingsScreen />
          </div>
        </div>
      )}
    </div>
  );
}
