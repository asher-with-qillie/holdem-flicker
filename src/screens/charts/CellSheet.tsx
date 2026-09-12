import { useState } from 'react';
import { ExplanationBody } from '../../components/ExplanationSheet';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { Sheet } from '../../components/ui/Sheet';
import { toast } from '../../components/ui/Toast';
import { IconCheck } from '../../components/ui/icons';
import type { Explanation } from '../../poker/explain';
import type { Step } from '../../poker/trainer';
import { vibrate } from '../../state/settings';
import { rate } from '../../state/srs';

/**
 * Cell explanation sheet (spec §5.8): the shared answer-first `ExplanationBody` on a half-detent Sheet, with a
 * footer that flags the hand as 헷갈려요 through the chart channel (`rate(step, 'unsure', 'chart')`).
 * Key it by hand so the flagged state resets per cell; keep it mounted with `open={false}` for the exit slide.
 */
export function CellSheet({ step, explanation, open, onClose }: { step: Step; explanation: Explanation; open: boolean; onClose: () => void }) {
  const [flagged, setFlagged] = useState(false);

  const flag = () => {
    if (flagged) return;
    rate(step, 'unsure', 'chart');
    setFlagged(true);
    vibrate([18, 30, 18]);
    toast('헷갈려요로 표시했어요 · 다음 세션에 먼저 나와요', 'amber');
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      detent="half"
      title={explanation.headline}
      footer={
        <>
          {flagged ? (
            <p className="charts-sheet__done t-callout" role="status">
              <IconCheck />
              헷갈려요로 표시했어요
            </p>
          ) : (
            <CapsuleButton tone="unsure" size="lg" className="charts-sheet__flag" onClick={flag}>
              이 핸드 헷갈려요로 표시
            </CapsuleButton>
          )}
          <CapsuleButton tone="neutral" size="lg" className="charts-sheet__close" onClick={onClose}>
            닫기
          </CapsuleButton>
        </>
      }
    >
      <ExplanationBody step={step} explanation={explanation} />
    </Sheet>
  );
}
