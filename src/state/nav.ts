/**
 * Navigation store (spec §3) — module-level, read with `useNav()`.
 *
 *   setTab('quiz')                       switch the floating tab
 *   openSettings(true | false)           push / pop the 설정 screen (App renders it above the tabs)
 *   launch({ target: 'train', ... })     jump to a tab with an intent; the target screen calls
 *   consumeLaunch()                      once on mount/focus to read-and-clear it
 *
 * UI chrome (tab-bar visibility) — anything that needs the floating tab bar out of the way (a running trainer
 * session, a quiz round, a full-screen coach mark…) calls
 *
 *   setChromeHidden('trainer', true)     when it starts, and
 *   setChromeHidden('trainer', false)    when it ends (also in the effect cleanup / on unmount)
 *
 * The bar hides while ANY source is hidden; sources are free-form strings owned by the caller.
 * `useUiChrome()` returns `{ tabBarHidden, sources }` and re-renders on change. App reads it; screens normally
 * only write. Screens keep their `padding-bottom: var(--content-bottom)` regardless (session views are fixed).
 */
import { useSyncExternalStore } from 'react';
import type { Pos } from '../poker/types';
import type { DeckId } from './settings';

export type { DeckId } from './settings';

export type TabId = 'home' | 'train' | 'quiz' | 'coach' | 'charts';

export interface LaunchIntent {
  target: 'train' | 'quiz';
  deck?: DeckId;
  positions?: Pos[]; // omit = keep current
  scenarioId?: string; // with deck 'scenario' (e.g. "vs_open:BB:BTN")
  onlyKeys?: string[]; // exact card keys (헷갈린 것만 다시 / 퀴즈로 확인)
  autostart?: boolean; // skip the setup screen
}

export interface NavState {
  tab: TabId;
  settingsOpen: boolean;
  launch: LaunchIntent | null;
}

const TAB_IDS: readonly TabId[] = ['home', 'train', 'quiz', 'coach', 'charts'];

let nav: NavState = { tab: 'home', settingsOpen: false, launch: null };
const navListeners = new Set<() => void>();

function commitNav(patch: Partial<NavState>) {
  nav = { ...nav, ...patch };
  navListeners.forEach((l) => l());
}

function subscribeNav(l: () => void) {
  navListeners.add(l);
  return () => {
    navListeners.delete(l);
  };
}

const getNavSnapshot = () => nav;

export function useNav(): NavState {
  return useSyncExternalStore(subscribeNav, getNavSnapshot, getNavSnapshot);
}

/** Non-hook read (event handlers, stores). */
export function getNav(): NavState {
  return nav;
}

export function setTab(tab: TabId): void {
  if (!TAB_IDS.includes(tab) || tab === nav.tab) return;
  commitNav({ tab });
}

export function openSettings(open: boolean): void {
  if (open === nav.settingsOpen) return;
  commitNav({ settingsOpen: open });
}

/** Sets `tab = intent.target`, stores the intent (and pops 설정 if it was open). */
export function launch(intent: LaunchIntent): void {
  commitNav({ tab: intent.target, launch: intent, settingsOpen: false });
}

/** Trainer/quiz call once on mount/focus: returns the pending intent (or null) and clears it. */
export function consumeLaunch(): LaunchIntent | null {
  const intent = nav.launch;
  if (intent) commitNav({ launch: null });
  return intent;
}

/* ---------------------------------------------------------------- UI chrome (tab-bar visibility) */

export interface UiChrome {
  /** true while at least one source asked for the bar to hide */
  tabBarHidden: boolean;
  sources: readonly string[];
}

const hiddenSources = new Set<string>();
let chrome: UiChrome = { tabBarHidden: false, sources: [] };
const chromeListeners = new Set<() => void>();

function subscribeChrome(l: () => void) {
  chromeListeners.add(l);
  return () => {
    chromeListeners.delete(l);
  };
}

const getChromeSnapshot = () => chrome;

export function setChromeHidden(source: string, hidden: boolean): void {
  if (hiddenSources.has(source) === hidden) return;
  if (hidden) hiddenSources.add(source);
  else hiddenSources.delete(source);
  chrome = { tabBarHidden: hiddenSources.size > 0, sources: [...hiddenSources] };
  chromeListeners.forEach((l) => l());
}

export function useUiChrome(): UiChrome {
  return useSyncExternalStore(subscribeChrome, getChromeSnapshot, getChromeSnapshot);
}

/** Non-hook read. */
export function getUiChrome(): UiChrome {
  return chrome;
}
