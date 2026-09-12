import { useEffect, useState } from 'react';
import { ChartsScreen } from './screens/ChartsScreen';
import { QuizScreen } from './screens/QuizScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TrainerScreen } from './screens/TrainerScreen';
import { HomeScreen } from './screens/HomeScreen';
import { FloatingTabBar } from './components/ui/FloatingTabBar';
import { ToastHost } from './components/ui/Toast';
import { IconBack, IconCards, IconGrid, IconHome, IconQuiz } from './components/ui/icons';
import { openSettings, setTab, useNav, useUiChrome, type TabId } from './state/nav';

export type { TabId } from './state/nav';

const TABS: Array<{ id: TabId; label: string; icon: JSX.Element }> = [
  { id: 'home', label: '홈', icon: <IconHome /> },
  { id: 'train', label: '훈련', icon: <IconCards /> },
  { id: 'quiz', label: '퀴즈', icon: <IconQuiz /> },
  { id: 'charts', label: '차트', icon: <IconGrid /> },
];

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
  const nav = useNav();
  const chrome = useUiChrome();
  const settingsPresent = usePresence(nav.settingsOpen, 240);


  const fixed = nav.tab === 'train';
  const barHidden = chrome.tabBarHidden;

  return (
    <div className="app">
      <main className={`app__main${fixed ? ' app__main--fixed' : ''}${barHidden ? ' app__main--barless' : ''}`}>
        <div key={nav.tab} className="app__view">
          {nav.tab === 'home' && <HomeScreen />}
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
