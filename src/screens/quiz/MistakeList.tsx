import { useState } from 'react';
import { ActionBadge } from '../../components/ActionBadge';
import { GlassPanel } from '../../components/ui/GlassPanel';
import { SCENARIO_KINDS, type ScenarioKind } from '../../poker/types';
import type { Mistake } from '../../state/stats';
import { formatAgo } from './format';

const SHOWN = 20;

function kindOf(m: Mistake): ScenarioKind | undefined {
  const k = m.scenarioId.split(':')[0];
  return (SCENARIO_KINDS as readonly string[]).includes(k) ? (k as ScenarioKind) : undefined;
}

/** Collapsed "최근 실수" disclosure (§5.7) — the last 20 quiz mistakes: hand, scenario, 내 선택 → 정답, when. */
export function MistakeList({ mistakes }: { mistakes: Mistake[] }) {
  const [open, setOpen] = useState(false);
  const items = mistakes.slice(0, SHOWN);
  const now = Date.now();
  return (
    <GlassPanel as="section" radius="md" padding={0} className="glass-flat quiz-mistakes">
      <button type="button" className="quiz-mistakes__toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg className="quiz-mistakes__chev" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span>최근 실수</span>
        <span className={`quiz-mistakes__count tnum${items.length ? '' : ' quiz-mistakes__count--zero'}`}>{items.length}</span>
      </button>
      {open &&
        (items.length ? (
          <ul className="quiz-mistakes__list">
            {items.map((m) => {
              const kind = kindOf(m);
              return (
                <li key={m.at} className="quiz-mistake">
                  <span className="quiz-mistake__hand tnum">{m.hand}</span>
                  <div className="quiz-mistake__body">
                    <span className="quiz-mistake__title">{m.title}</span>
                    <span className="quiz-mistake__actions">
                      <span>내 선택</span>
                      <ActionBadge action={m.chosen} kind={kind} size="sm" short />
                      <span>→ 정답</span>
                      <ActionBadge action={m.answer} kind={kind} size="sm" short />
                    </span>
                  </div>
                  <span className="quiz-mistake__time">{formatAgo(m.at, now)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="quiz-mistakes__empty">아직 실수가 없어요. 10문제 풀면 여기에 모여요</p>
        ))}
    </GlassPanel>
  );
}
