import type { Explanation } from '../poker/explain';
import type { Step } from '../poker/trainer';
import { ActionBadge } from './ActionBadge';

/** Bottom sheet with the full Korean explanation (+ postflop plan for non-fold actions). */
export function ExplanationBody({ step, explanation }: { step: Step; explanation: Explanation }) {
  const e = explanation;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 17 }}>{e.headline}</strong>
        <ActionBadge action={step.answer} kind={step.scenario.kind} size="sm" />
      </div>
      <h3>상황</h3>
      <p>{e.situation}</p>
      <h3>핸드</h3>
      <p>{e.handProfile}</p>
      <h3>왜 이 액션인가</h3>
      <ul>
        {e.reasoning.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      <p style={{ marginTop: 6, color: 'var(--ink-dim)' }}>{e.rangeContext}</p>
      {e.mixNote && (
        <>
          <h3>혼합 빈도</h3>
          <p>{e.mixNote}</p>
        </>
      )}
      {e.chartNote && (
        <>
          <h3>메모</h3>
          <p>{e.chartNote}</p>
        </>
      )}
      {e.postflop && (
        <>
          <h3>플랍을 본 뒤 확인할 것 · {e.postflop.potType}</h3>
          <p style={{ color: 'var(--ink-dim)' }}>
            {e.postflop.role} · {e.postflop.position}
          </p>
          <ul>
            {e.postflop.checklist.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
          <h3>좋은 플랍 / 나쁜 플랍</h3>
          <p>👍 {e.postflop.goodBoards}</p>
          <p>👎 {e.postflop.badBoards}</p>
          <h3>플레이 계획</h3>
          <ul>
            {e.postflop.plan.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function ExplanationSheet({ step, explanation, onClose }: { step: Step; explanation: Explanation; onClose: () => void }) {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="해설">
        <div className="sheet__handle" />
        <ExplanationBody step={step} explanation={explanation} />
        <button type="button" className="btn btn--block" style={{ marginTop: 16 }} onClick={onClose}>
          닫기
        </button>
      </div>
    </>
  );
}
