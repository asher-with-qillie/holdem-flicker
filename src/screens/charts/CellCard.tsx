import { useState } from 'react';
import { ExplanationBody } from '../../components/ExplanationSheet';
import { LineCapsule, LineStrip } from '../../components/LineStrip';
import { SeatChips } from '../../components/SeatChips';
import { PlainText, TermScope } from '../../components/Term';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { IconButton } from '../../components/ui/IconButton';
import { toast } from '../../components/ui/Toast';
import { IconCheck, IconClose, IconGrid } from '../../components/ui/icons';
import type { Explanation } from '../../poker/explain';
import { scenarioKey } from '../../poker/scenarios';
import type { Step } from '../../poker/trainer';
import { useSettings, vibrate } from '../../state/settings';
import { rate } from '../../state/srs';

/** 칸 하나를 가리키는 키(상황 + 패). 헷갈려요 표시는 이 키로 기억해서, 다른 칸을 누르면 저절로 풀립니다. */
export const stepKey = (step: Step): string => `${scenarioKey(step.scenario)}|${step.hand}`;

/** The last cell flagged from the chart. Module-level so the sheet (phone/squat) and the inline card (tall dock,
 *  land/wide column) agree after a fold or rotation swaps one for the other — the cell is never rated twice. */
let lastFlaggedKey: string | null = null;

/** 헷갈려요 표시(차트 채널). 칸이 바뀌면 표시 상태도 그 칸 것으로 — 시트·카드를 다시 마운트하지 않습니다. */
export function useCellFlag(step: Step): [boolean, () => void] {
  const [flaggedKey, setFlaggedKey] = useState<string | null>(() => lastFlaggedKey);
  const key = stepKey(step);
  const flagged = flaggedKey === key;
  const flag = () => {
    if (flagged) return;
    rate(step, 'unsure', 'chart');
    lastFlaggedKey = key;
    setFlaggedKey(key);
    vibrate([18, 30, 18]);
    toast('헷갈려요로 표시했어요 · 다음 세션에 먼저 나와요', 'amber');
  };
  return [flagged, flag];
}

/**
 * 인라인 셀 카드(Duo spec §4.4) — land/wide 의 옆 칼럼, tall 의 dock 에서 셀 시트 대신 씁니다.
 * 접힘: 제목 · 답 캡슐 + 줄 이름 · 줄 스트립(md) · 줄 문장 · S(자리별 답, 누르면 자리별 보기) · [헷갈려요][자세히][자리별].
 * `expanded` 면 가운데를 해설 본문 전체(ExplanationBody)로 바꿉니다 — 옆 칼럼이 안쪽 스크롤이라 격자는 그대로 보이고 눌립니다.
 * 카드 폭이 좁으면(<260, land) 스트립은 숨기고 S 를 3칸 두 줄로 — 줄은 바로 옆 격자에 외곽선으로 그려져 있습니다.
 */
export function CellCard({
  step,
  explanation,
  expanded,
  onExpand,
  onClose,
  onAcross,
}: {
  step: Step;
  explanation: Explanation;
  expanded: boolean;
  onExpand(next: boolean): void;
  onClose(): void;
  onAcross(): void;
}) {
  const e = explanation;
  const [settings] = useSettings();
  const [flagged, flag] = useCellFlag(step);
  const cut = e.title.lastIndexOf(' · ');
  const titleSit = cut > 0 ? e.title.slice(0, cut) : e.title;
  const titleHand = cut > 0 ? e.title.slice(cut) : '';
  return (
    <section className={`cellcard glass-flat${expanded ? ' cellcard--expanded' : ''}`} aria-label={`${e.title} 해설`}>
      <div className="cellcard__in">
        <div className="cellcard__head">
          <h3 className="cellcard__title t-headline">
            {/* "HJ 오픈 대응 · KQo": in the narrow dock title slot the situation ellipsizes, the hand never does */}
            <span className="cellcard__title-sit">{titleSit}</span>
            {titleHand && <span className="cellcard__title-hand">{titleHand}</span>}
          </h3>
          <IconButton icon={<IconClose />} label="선택 해제" size={40} tone="ghost" className="cellcard__close" onClick={onClose} />
        </div>
        {expanded ? (
          <ExplanationBody step={step} explanation={e} onAcross={onAcross} />
        ) : (
          <div className="cellcard__body">
            <div className="cellcard__cap">
              <LineCapsule capsule={e.capsule} size="md" showSplit={settings.showMixFrequencies} />
              <span className="cellcard__caption t-caption">이 줄 · {e.line.def.label}</span>
            </div>
            <LineStrip view={e.line} size="md" className="cellcard__strip" />
            {e.line.sentence && (
              <p className="cellcard__sentence t-callout">
                <TermScope resetKey={e}>
                  <PlainText text={e.line.sentence.text} />
                </TermScope>
              </p>
            )}
            <SeatChips step={step} explanation={e} onPress={onAcross} />
          </div>
        )}
        <div className="cellcard__actions">
          {flagged ? (
            <p className="charts-sheet__done cellcard__done t-callout" role="status">
              <IconCheck />
              헷갈려요
            </p>
          ) : (
            <CapsuleButton tone="unsure" size="md" className="cellcard__flag" onClick={flag}>
              헷갈려요
            </CapsuleButton>
          )}
          <CapsuleButton tone="neutral" size="md" aria-expanded={expanded} onClick={() => onExpand(!expanded)}>
            {expanded ? '접기' : '자세히'}
          </CapsuleButton>
          <CapsuleButton tone="neutral" size="md" icon={<IconGrid />} onClick={onAcross} aria-label="이 패, 다른 자리에서는 · 자리별 보기">
            자리별
          </CapsuleButton>
        </div>
      </div>
    </section>
  );
}
