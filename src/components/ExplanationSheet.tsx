import type { Explanation } from '../poker/explain';
import type { Step } from '../poker/trainer';
import { ActionBadge } from './ActionBadge';
import { CapsuleButton } from './ui/CapsuleButton';
import { Sheet } from './ui/Sheet';

/**
 * Full Korean explanation body, answer-first (spec §4): badge → 왜 이 액션인가 → 핸드 → 상황 → 레인지 → 혼합 빈도 → 메모 → 플랍.
 * The headline is the Sheet title; the hold overlay passes it the same way (`<Sheet held title={e.headline}>`).
 */
export function ExplanationBody({ step, explanation }: { step: Step; explanation: Explanation }) {
  const e = explanation;
  return (
    <div className="ui-explain">
      <div className="ui-explain__top">
        <ActionBadge action={step.answer} kind={step.scenario.kind} size="md" />
        <span className="ui-explain__hand tnum">
          {step.scenario.hero} · {step.hand}
        </span>
      </div>
      <h3>왜 이 액션인가</h3>
      <ul>
        {e.reasoning.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
      <h3>핸드</h3>
      <p>{e.handProfile}</p>
      <h3>상황</h3>
      <p>{e.situation}</p>
      <h3>레인지</h3>
      <p className="ui-explain__dim">{e.rangeContext}</p>
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
          <p className="ui-explain__dim">
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

/** 해설 bottom sheet (detent half, scrollable) with a sticky 닫기 footer. */
export function ExplanationSheet({ step, explanation, onClose }: { step: Step; explanation: Explanation; onClose: () => void }) {
  return (
    <Sheet
      open
      onClose={onClose}
      detent="half"
      title={explanation.headline}
      footer={
        <CapsuleButton tone="neutral" size="lg" block onClick={onClose}>
          닫기
        </CapsuleButton>
      }
    >
      <ExplanationBody step={step} explanation={explanation} />
    </Sheet>
  );
}
