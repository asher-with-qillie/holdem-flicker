import { useEffect, useState } from 'react';
import { ChartsScreen } from './screens/ChartsScreen';
import { CoachScreen } from './screens/CoachScreen';
import { QuizScreen } from './screens/QuizScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TrainerScreen } from './screens/TrainerScreen';
import { HomeScreen } from './screens/HomeScreen';
import { HandAtlasSheet } from './screens/atlas/HandAtlasSheet';
import { FloatingTabBar } from './components/ui/FloatingTabBar';
import { ToastHost } from './components/ui/Toast';
import { IconBack, IconCards, IconCoach, IconGrid, IconHome, IconQuiz } from './components/ui/icons';
import { openSettings, setTab, useNav, useUiChrome, type TabId } from './state/nav';
import { useLayout } from './state/viewport';

export type { TabId } from './state/nav';

const TABS: Array<{ id: TabId; label: string; icon: JSX.Element }> = [
  { id: 'home', label: '홈', icon: <IconHome /> },
  { id: 'train', label: '훈련', icon: <IconCards /> },
  { id: 'quiz', label: '퀴즈', icon: <IconQuiz /> },
  { id: 'coach', label: '코치', icon: <IconCoach /> },
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
  const layout = useLayout();

  // 스크롤이 없는 화면(§2.1): 훈련, 퀴즈 라운드(퀴즈가 탭 바를 숨긴 동안), land/tall/wide 의 차트 스테이지.
  const chartsStage = nav.tab === 'charts' && layout !== 'phone' && layout !== 'squat';
  const fixed = nav.tab === 'train' || (nav.tab === 'quiz' && chrome.sources.includes('quiz')) || chartsStage;
  const barHidden = chrome.tabBarHidden;
  // 일시정지한 훈련: 탭 바는 돌아오지만 화면은 바 없는 배치를 그대로 씁니다(접기·펼치기 자동 정지에도 화면이 다시 흐르지 않게).
  const barless = barHidden || (chrome.overlay && fixed);

  return (
    <div className="app">
      <main className={`app__main${fixed ? ' app__main--fixed' : ''}${barless ? ' app__main--barless' : ''}`}>
        <div key={nav.tab} className="app__view">
          {nav.tab === 'home' && <HomeScreen />}
          {nav.tab === 'train' && <TrainerScreen />}
          {nav.tab === 'quiz' && <QuizScreen />}
          {nav.tab === 'coach' && <CoachScreen />}
          {nav.tab === 'charts' && <ChartsScreen />}
        </div>
      </main>

      <FloatingTabBar
        items={TABS}
        active={nav.tab}
        onChange={setTab}
        hidden={barHidden}
        orientation={layout === 'land' || layout === 'wide' ? 'vertical' : 'horizontal'}
      />
      {/* 자리별 보기 — 시트는 portal 이라 어디서 렌더하든 같습니다. 모든 진입점이 이 한 장을 씁니다. */}
      <HandAtlasSheet />
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
