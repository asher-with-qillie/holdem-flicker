import { Fragment, createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { glossSentence } from '../poker/explain';
import { GLOSSARY_WORDS, glossaryLookup, type GlossaryEntry } from '../poker/glossary';
import '../styles/explain.css';

/*
 * PlainText — renders a Korean explanation string with glossary terms wrapped in a tappable
 * <button class="term"> (dotted underline). Tapping opens ONE small glass popover (module store: opening a term
 * closes any other). Only use it in explanation bodies and the one-line reason, never inside CapsuleButton labels.
 *
 * Inside a <TermScope> (one per explanation body) only the FIRST occurrence of a term is underlined — a page where
 * every 셋/킥커/레인지 is underlined is harder to read than one with no underlines at all.
 *
 * Two occurrences never get an underline at all:
 *   · one that already carries its "(…)" gloss (explain.ts applyGlosses) — the parentheses ARE the definition,
 *     so a popover with the same words next to them is the same explanation twice (가이드 §2.4);
 *   · one inside parentheses — that text is itself a gloss.
 * Both still render inside `.term-plain` so a hyphenated term ("c-bet") keeps its nowrap and never wraps as
 * "c-" / "bet"; the same wrapper carries the deduped later occurrences.
 */

/* ---- tiny module store: which term is open (at most one popover in the whole app) ---- */

interface OpenTerm {
  id: number;
  entry: GlossaryEntry;
  anchor: HTMLElement;
}
let current: OpenTerm | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => current;

export function openTerm(entry: GlossaryEntry, anchor: HTMLElement) {
  if (current && current.anchor === anchor) {
    closeTerm();
    return;
  }
  current = { id: ++seq, entry, anchor };
  emit();
}
export function closeTerm() {
  if (!current) return;
  current = null;
  emit();
}

/* ---- matcher ---- */

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Longest spelling first so "임플라이드 오즈" wins over "팟 오즈" and "셋마이닝" over "셋". */
const TERM_RE = new RegExp(GLOSSARY_WORDS.map(escapeRe).join('|'), 'gi');

/* ---- per-body dedupe: only the first occurrence of a term gets an underline ---- */

export interface TermScopeState {
  key: unknown;
  /**
   * 용어 → 이 본문에서 그 용어의 밑줄을 가져간 **글귀 그 자체**.
   *
   * 주인을 컴포넌트 인스턴스(useRef 토큰)로 잡아 봤지만 안 됩니다: StrictMode 의 첫 마운트에서는
   * React 가 훅 초기화까지 두 번 돌려서 두 패스의 ref 객체가 서로 다릅니다. 그러면 두 번째 패스가
   * 자기 것이 아닌 용어를 마주쳐 밑줄을 잃습니다(실측으로 확인). 글귀를 주인으로 쓰면 주인이
   * 렌더 입력에서 바로 나오므로 패스가 몇 번이든 같은 답이 됩니다.
   */
  owners: Map<string, string>;
}
const TermScopeCtx = createContext<TermScopeState | null>(null);

/**
 * Wrap one explanation body so each glossary term is underlined at most once inside it.
 *
 * `resetKey` 로 본문을 식별합니다(해설 객체를 그대로 넘기세요). 이 값이 바뀔 때만 장부를 새로
 * 만들기 때문에, React 가 같은 렌더를 두 번 호출해도(StrictMode·중단된 동시 렌더의 재실행)
 * 같은 주장을 다시 해서 같은 결과가 나옵니다. 예전처럼 렌더마다 `new Set()` 을 만들고
 * 자식이 그걸 `add` 하면, 두 번째 패스에서는 모든 용어가 '이미 본 것'이 되어 밑줄이 전부
 * 사라집니다 — 개발 모드에서 실제로 그랬습니다.
 */
export function TermScope({ children, resetKey }: { children: ReactNode; resetKey?: unknown }) {
  const ref = useRef<TermScopeState | null>(null);
  if (ref.current === null || ref.current.key !== resetKey) {
    ref.current = { key: resetKey, owners: new Map() };
  }
  return <TermScopeCtx.Provider value={ref.current}>{children}</TermScopeCtx.Provider>;
}

/**
 * 같은 글귀가 다시 물어보면 같은 답이 나옵니다 — 그래서 렌더를 여러 번 돌려도 안전합니다.
 *
 * 알려진 한계: 한 본문에 **완전히 똑같은 글귀**가 두 번 들어가면 둘 다 밑줄을 받습니다.
 * 렌더 입력만으로는 둘을 구분할 방법이 없고, 밑줄이 하나 더 그어지는 쪽이 전부 사라지는 쪽보다 낫습니다.
 */
export function claimTerm(scope: TermScopeState, term: string, owner: string): boolean {
  const held = scope.owners.get(term);
  if (held === undefined) {
    scope.owners.set(term, owner);
    return true;
  }
  return held === owner;
}

/**
 * 문자열 하나를 조각으로 나누고, 어느 조각이 밑줄을 받을지 정합니다.
 * 같은 (scope, text) 로 몇 번을 불러도 결과가 같아야 합니다 — tests/term-scope.test.ts 가 그걸 봅니다.
 */
export function resolveTerms(text: string, scope: TermScopeState | null): Piece[] {
  const owner = text;
  const here = new Set<string>(); // 이 호출 안에서만 쓰는 지역 상태라 바꿔도 순수합니다
  return splitTerms(text).map((p): Piece => {
    if (!p.entry) return p;
    const term = p.entry.term;
    // A term that carries its own "(…)" gloss is explained right there; it also spends the one underline
    // this body owes the term, so the popover never repeats what the reader just read.
    if (p.glossed) {
      if (scope && p.defines && !here.has(term)) {
        here.add(term);
        claimTerm(scope, term, owner);
      }
      return { text: p.text, glossed: true };
    }
    if (!scope) return p;
    if (here.has(term)) return { text: p.text, glossed: true };
    here.add(term);
    return claimTerm(scope, term, owner) ? p : { text: p.text, glossed: true };
  });
}

export type Piece = {
  text: string;
  entry?: GlossaryEntry;
  /** The term is written out here (gloss in parentheses, or inside one): show it plain, never underlined. */
  glossed?: boolean;
  /** This occurrence carries its own "(…)" gloss, so it also spends the one underline the body owes the term. */
  defines?: boolean;
};

/** True when the match at `i` sits inside a "(…)" — that text is already a definition. */
function insideParens(text: string, i: number): boolean {
  let depth = 0;
  for (let k = 0; k < i; k++) {
    if (text[k] === '(') depth++;
    else if (text[k] === ')' && depth > 0) depth--;
  }
  return depth > 0;
}

export function splitTerms(text: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  // matchAll 은 정규식을 내부에서 복제하므로 모듈 전역 TERM_RE 의 lastIndex 를 건드리지 않습니다.
  for (const m of text.matchAll(TERM_RE)) {
    // Latin spellings (SB, BB, SPR, c-bet …) must match case exactly: "2.5bb" is a bet size, not the blind.
    if (/^[A-Za-z-]+$/.test(m[0]) && !GLOSSARY_WORDS.includes(m[0])) continue;
    const entry = glossaryLookup(m[0]);
    if (!entry) continue;
    const start = m.index ?? 0;
    const end = start + m[0].length;
    // 풀이는 두 꼴 중 하나입니다: 괄호("백도어(…)", 차트 메모) 또는 바로 뒤 한 문장("c-bet은 … 벳입니다.", explain.ts).
    // 뒤 문장 꼴이면 그 본문 안의 모든 등장이 이미 설명을 달고 있는 셈이라 밑줄을 긋지 않습니다.
    const sentence = glossSentence(entry.term);
    const defines = text[end] === '(' || (sentence != null && text.includes(sentence));
    const glossed = defines || insideParens(text, start);
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: m[0], entry, glossed, defines });
    last = end;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/* ---- components ---- */

export function PlainText({ text, className }: { text: string; className?: string }) {
  const scope = useContext(TermScopeCtx);
  const pieces = resolveTerms(text, scope);
  return (
    <span className={className}>
      {pieces.map((p, i) =>
        p.entry ? (
          <button
            key={i}
            type="button"
            className="term"
            aria-label={`${p.text} 뜻 보기`}
            onClick={(e) => {
              e.stopPropagation();
              openTerm(p.entry!, e.currentTarget);
            }}
          >
            {p.text}
          </button>
        ) : p.glossed ? (
          <span key={i} className="term-plain">
            {p.text}
          </span>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
      <TermPopoverHost />
    </span>
  );
}

/** Mounted by every PlainText; only the instance that owns the open anchor renders the popover. */
function TermPopoverHost() {
  const open = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const selfRef = useRef<HTMLSpanElement>(null);
  if (!open) return <span ref={selfRef} hidden />;
  // Render from the PlainText whose DOM contains the tapped button (the first host in DOM order wins the tie).
  const mine = selfRef.current?.parentElement?.contains(open.anchor);
  return (
    <span ref={selfRef} hidden>
      {mine && <TermPopover open={open} />}
    </span>
  );
}

const MARGIN = 12;
const WIDTH = 300;

export function TermPopover({ open }: { open: OpenTerm }) {
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const [above, setAbove] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open.anchor.isConnected) {
      closeTerm();
      return;
    }
    const r = open.anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(WIDTH, vw - MARGIN * 2);
    const h = boxRef.current?.offsetHeight ?? 96;
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(MARGIN, Math.min(left, vw - MARGIN - w));
    const below = r.bottom + 8;
    const fitsBelow = below + h <= vh - MARGIN;
    const top = fitsBelow ? below : Math.max(MARGIN, r.top - 8 - h);
    setAbove(!fitsBelow);
    setStyle({ left, top, width: w, '--arrow-x': `${r.left + r.width / 2 - left}px` } as CSSProperties);
  }, [open]);

  // If the text that owns the anchor unmounts (sheet closed), forget the open term.
  // 스토어를 조용히 비우면 useSyncExternalStore 를 쓰는 다른 구독자가 이미 떨어져 나간 앵커에
  // 붙은 팝오버를 계속 그립니다 — 이 훅이 막으려는 바로 그 상태입니다. closeTerm() 으로 알립니다.
  useEffect(
    () => () => {
      if (current && current.anchor === open.anchor) closeTerm();
    },
    [open],
  );

  useEffect(() => {
    const onDown = (e: Event) => {
      const t = e.target as Node | null;
      if (boxRef.current?.contains(t) || open.anchor.contains(t)) return;
      closeTerm();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeTerm();
      }
    };
    const onScroll = () => closeTerm();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return createPortal(
    <div ref={boxRef} className={`term-pop glass-strong${above ? ' term-pop--above' : ''}`} role="dialog" aria-label={`${open.entry.term} 뜻`} style={style}>
      <div className="term-pop__head">
        <strong className="term-pop__term">{open.entry.term}</strong>
        <button type="button" className="term-pop__close" aria-label="닫기" onClick={closeTerm}>
          ×
        </button>
      </div>
      <p className="term-pop__def">{open.entry.def}</p>
    </div>,
    document.body,
  );
}
