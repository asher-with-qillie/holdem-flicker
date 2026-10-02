import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory localStorage before the stores load (settings.ts / srs.ts / progress.ts read it at import time).
vi.hoisted(() => {
  const map = new Map<string, string>();
  const mem = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: mem, configurable: true, writable: true });
});

import { seedRandom } from '../../poker/hands';
import { getSession, resetSessionStore, startSession, togglePause, type SessionConfig } from '../../screens/trainer/sessionStore';
import { closeAtlas, getAtlas, openAtlas, resetAtlasStore } from '../atlas';
import { resetProgress } from '../progress';
import { resetSettings, updateSettings } from '../settings';
import { resetSrs } from '../srs';

const BASE: SessionConfig = { deck: 'rfi', positions: ['UTG', 'HJ', 'CO'], size: 10, speed: 'normal', exposure: false, manual: false };

const status = () => getSession()?.status;

describe('atlas store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    seedRandom(7);
    resetSettings();
    resetSrs();
    resetProgress();
    resetSessionStore();
    resetAtlasStore();
    updateSettings({ coachSeen: 2, haptics: false });
  });
  afterEach(() => {
    resetSessionStore();
    resetAtlasStore();
    vi.useRealTimers();
  });

  it('openAtlas pauses a running session and closeAtlas resumes only what it paused', () => {
    expect(startSession(BASE).ok).toBe(true);
    expect(status()).toBe('running');

    openAtlas({ hand: 'KJo', origin: { kind: 'rfi', hero: 'UTG' } });
    expect(getAtlas()?.hand).toBe('KJo');
    expect(status()).toBe('paused');

    closeAtlas();
    expect(getAtlas()).toBeNull();
    expect(status()).toBe('running');

    // 사용자가 먼저 멈춘 세션은 아틀라스가 닫혀도 멈춘 채로 남습니다.
    togglePause();
    expect(status()).toBe('paused');
    openAtlas({ hand: 'KJo' });
    expect(status()).toBe('paused');
    closeAtlas();
    expect(status()).toBe('paused');
  });

  it('does not resume when the user resumed by hand while the atlas was open, and ignores idle sessions', () => {
    openAtlas({ hand: 'A5s', mode: 'pick' });
    expect(status()).toBeUndefined();
    closeAtlas();
    expect(getAtlas()).toBeNull();

    expect(startSession(BASE).ok).toBe(true);
    openAtlas({ hand: 'A5s' });
    expect(status()).toBe('paused');
    togglePause(); // ‖/▶ 를 눌러 직접 재개
    expect(status()).toBe('running');
    closeAtlas();
    expect(status()).toBe('running');
    // 다음 열기는 다시 멈추고, 다시 닫으면 재개 — 기억이 남지 않습니다.
    openAtlas({ hand: 'A5s' });
    expect(status()).toBe('paused');
    closeAtlas();
    expect(status()).toBe('running');
  });

  it('closeAtlas({ resume: false }) leaves the session paused (jumping to the quiz)', () => {
    expect(startSession(BASE).ok).toBe(true);
    openAtlas({ hand: '22' });
    expect(status()).toBe('paused');
    closeAtlas({ resume: false });
    expect(status()).toBe('paused');
    expect(getAtlas()).toBeNull();
  });
});
