import { useEffect, useRef } from 'react';
import type { Step } from '../../poker/trainer';
import type { ScenarioKind } from '../../poker/types';

const CRUMB_LABEL: Record<ScenarioKind, string> = {
  rfi: '오픈',
  vs_open: '오픈 대응',
  vs_3bet: '3벳 대응',
  vs_4bet: '4벳 대응',
  vs_5bet: '5벳 대응',
  cold_4bet: '콜드 4벳',
};

/** Which betting line a step belongs to (see buildSteps): A = hero opens, B = hero faces an open, C = cold 4-bet. */
function lineOf(kind: ScenarioKind): 'A' | 'B' | 'C' {
  if (kind === 'rfi' || kind === 'vs_3bet' || kind === 'vs_5bet') return 'A';
  if (kind === 'cold_4bet') return 'C';
  return 'B';
}

/** One-line breadcrumb of the current hand's decision steps; the current step is highlighted. */
export function StepCrumbs({ steps, current }: { steps: Step[]; current: number }) {
  const row = useRef<HTMLDivElement>(null);

  // Keep the active chip visible when the row overflows (manual scrollLeft: scrollIntoView could move the page).
  useEffect(() => {
    const r = row.current;
    if (!r) return;
    const el = r.querySelector<HTMLElement>('.crumb--on');
    if (!el || r.scrollWidth <= r.clientWidth) return;
    r.scrollLeft = el.offsetLeft - (r.clientWidth - el.offsetWidth) / 2;
  }, [current, steps]);

  return (
    <div ref={row} className="trainer-crumbs" aria-label="이 핸드의 결정 단계">
      <div className="trainer-crumbs__inner">
        {steps.map((s, i) => {
          const state = i === current ? 'on' : i < current ? 'done' : 'todo';
          const sep = i > 0 ? (lineOf(steps[i - 1].scenario.kind) === lineOf(s.scenario.kind) ? '→' : '·') : null;
          return (
            <span key={i} className="crumb-item">
              {sep && <span className={`crumb-sep${sep === '·' ? ' crumb-sep--line' : ''}`}>{sep}</span>}
              <span className={`crumb crumb--${state}`} aria-current={i === current ? 'step' : undefined}>
                {CRUMB_LABEL[s.scenario.kind]}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
