/**
 * Size class for the whole app (iPhone Duo spec §1–§2). The single source of truth: CSS structure rules branch
 * only on the `<html data-layout|data-bar|data-short>` attributes written here, never on `@media (max-height)`.
 *
 * Height input is min(svh, innerHeight): svh does not move when Safari's toolbars collapse/expand, so the class
 * and the short tier never flip while the user scrolls. Width jumps ≥ 80 (fold, unfold, rotate — toolbars never
 * change width) are reported immediately through onViewportJump so running timers can pause.
 */
import { useSyncExternalStore } from 'react';

export type Layout = 'phone' | 'squat' | 'land' | 'tall' | 'wide';
export type Bar = 'top' | 'bottom';
export type Short = 0 | 700 | 740;
export interface ViewportClass { layout: Layout; bar: Bar; short: Short }

/** Rejects garbage heights (e.g. −33554432 right after unfolding in standalone) and falls back to innerHeight. */
export const clampH = (h: number | null | undefined, ih: number): number =>
  typeof h === 'number' && Number.isFinite(h) && h >= 200 && h <= ih + 100 ? h : ih;

export function classify(w: number, h: number): Layout {
  if (w < 560) return h < 640 ? 'squat' : 'phone';
  if (h < 480 || (h < 760 && w < 820)) return 'land';
  return h < 760 ? 'wide' : 'tall';
}
export const barSide = (l: Layout): Bar => (l === 'tall' || l === 'wide' ? 'top' : 'bottom');
export const shortTier = (h: number): Short => (h <= 700 ? 700 : h <= 740 ? 740 : 0);

let probe: HTMLDivElement | null = null;
function svh(): number {
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:100vh;height:100svh;visibility:hidden;pointer-events:none';
    document.documentElement.appendChild(probe);
  }
  return clampH(probe.offsetHeight, window.innerHeight);
}
/** 지금 보이는 높이. 접었다 펼친 뒤의 visualViewport 버그 값은 잘라 냅니다. Term 등 팝오버 위치용입니다. */
export function viewportHeight(): number { return clampH(window.visualViewport?.height, window.innerHeight); }
export function viewportTop(): number {
  const t = window.visualViewport?.offsetTop;
  return typeof t === 'number' && Number.isFinite(t) && t >= 0 && t < 200 ? t : 0;
}

function compute(): ViewportClass {
  const w = document.documentElement.clientWidth;
  const h = Math.min(svh(), window.innerHeight);
  const layout = classify(w, h);
  return { layout, bar: barSide(layout), short: shortTier(h) };
}

let cls: ViewportClass = { layout: 'phone', bar: 'bottom', short: 0 };
const subs = new Set<() => void>();
const jumpSubs = new Set<() => void>();
let timer = 0;
let lastW = 0;
let inited = false;

function write(c: ViewportClass) {
  const d = document.documentElement.dataset;
  d.layout = c.layout; d.bar = c.bar;
  if (c.short) d.short = String(c.short); else delete d.short;
}
function settle() {
  timer = 0;
  const next = compute();
  if (next.layout === cls.layout && next.bar === cls.bar && next.short === cls.short) return;
  cls = next; write(cls); subs.forEach((f) => f());
}
let lastVv = -1;
/** --vv-h (입력칸이 있는 시트의 높이)는 값이 바뀔 때만 씁니다 — 툴바가 움직이는 동안 visualViewport resize 가 연달아 오는데,
 *  그때마다 html 인라인 스타일을 건드리면 루트 스타일이 매번 무효화됩니다. */
function writeVv() {
  const v = Math.round(viewportHeight());
  if (v === lastVv) return;
  lastVv = v;
  document.documentElement.style.setProperty('--vv-h', `${v}px`);
}
function onResize() {
  const w = document.documentElement.clientWidth;
  if (lastW && Math.abs(w - lastW) >= 80) jumpSubs.forEach((f) => f());   // 접기, 펼치기, 회전. 툴바는 폭을 바꾸지 않습니다
  lastW = w;
  writeVv();
  window.clearTimeout(timer);
  timer = window.setTimeout(settle, 150);
}

export function initViewport(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || inited) return;
  inited = true;
  cls = compute(); write(cls); lastW = document.documentElement.clientWidth;
  writeVv();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  window.visualViewport?.addEventListener('resize', onResize);   // 페이지 끝에서 툴바가 다시 자랄 때는 이 이벤트만 옵니다
}
/** 디바운스가 걸려 있는 동안(크기 바뀌는 중)에는 true입니다. FitBox가 마지막 배율을 유지하는 데 씁니다. */
export const isSettling = (): boolean => timer !== 0;
export const getViewportClass = (): ViewportClass => cls;
export function onLayoutChange(cb: () => void): () => void { subs.add(cb); return () => { subs.delete(cb); }; }
export function onViewportJump(cb: () => void): () => void { jumpSubs.add(cb); return () => { jumpSubs.delete(cb); }; }
export function useViewportClass(): ViewportClass { return useSyncExternalStore(onLayoutChange, getViewportClass, getViewportClass); }
export const useLayout = (): Layout => useViewportClass().layout;
