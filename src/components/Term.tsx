import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY_WORDS, glossaryLookup, type GlossaryEntry } from '../poker/glossary';
import '../styles/explain.css';

/*
 * PlainText — renders a plain-Korean explanation string with every glossary term wrapped in a tappable
 * <button class="term"> (dotted underline). Tapping opens ONE small glass popover (module store: opening a term
 * closes any other). Only use it in explanation bodies and the one-line reason, never inside CapsuleButton labels.
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
/** Longest spelling first so "폴드 에퀴티" wins over "폴드" + "에퀴티" and "체크-레이즈" over "체크". */
const TERM_RE = new RegExp(GLOSSARY_WORDS.map(escapeRe).join('|'), 'gi');

type Piece = { text: string; entry?: GlossaryEntry };

export function splitTerms(text: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  TERM_RE.lastIndex = 0;
  for (let m = TERM_RE.exec(text); m; m = TERM_RE.exec(text)) {
    // Latin spellings (SB, BB, SPR, c-bet …) must match case exactly: "2.5bb" is a bet size, not the blind.
    if (/^[A-Za-z-]+$/.test(m[0]) && !GLOSSARY_WORDS.includes(m[0])) continue;
    const entry = glossaryLookup(m[0]);
    if (!entry) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], entry });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/* ---- components ---- */

export function PlainText({ text, className }: { text: string; className?: string }) {
  const pieces = splitTerms(text);
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
  useEffect(
    () => () => {
      if (current && current.anchor === open.anchor) current = null;
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
