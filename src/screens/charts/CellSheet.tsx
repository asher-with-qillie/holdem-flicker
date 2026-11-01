import { useEffect, useRef } from 'react';
import { ExplanationBody } from '../../components/ExplanationSheet';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { Sheet } from '../../components/ui/Sheet';
import { IconCheck } from '../../components/ui/icons';
import type { Explanation } from '../../poker/explain';
import type { Step } from '../../poker/trainer';
import { stepKey, useCellFlag } from './CellCard';

/**
 * 셀 해설 시트 (spec §5.8 · Duo spec §4.4). non-modal: 배경·스크롤 잠금이 없어서 시트가 떠 있는 채로 다른 칸을 누르면
 * 내용만 바뀝니다(호출자가 key 를 주지 않습니다 — 다시 마운트하지 않음).
 *
 * phone/squat: `expanded=false` 면 peek(≤ min(232, 0.42 core)) — 제목 · 답 캡슐 · 줄 스트립 · 줄 문장까지가 한눈에 들고
 * 격자가 시트 위로 보입니다. 「더 보기」가 같은 시트를 half 로 키웁니다(remount 없음). 본문은 늘 같은 ExplanationBody 라
 * peek 에서도 아래로 스크롤하면 전부 있습니다.
 * tall: 카드는 dock 에 있고, 이 시트는 「자세히」 때만 auto 바텀 시트로 엽니다(본문이 540 이상이라 두 칸).
 * 헷갈려요는 차트 채널로 표시합니다(`rate(step, 'unsure', 'chart')`). 닫힘 애니메이션을 위해 `open={false}` 로 마운트를 유지하세요.
 */
export function CellSheet({
  step,
  explanation,
  open,
  expanded,
  onExpand,
  onClose,
  onAcross,
  detent,
}: {
  step: Step;
  explanation: Explanation;
  open: boolean;
  expanded: boolean;
  onExpand(next: boolean): void;
  onClose: () => void;
  onAcross: () => void;
  /** 기본: expanded ? half : peek. tall 은 'auto'. */
  detent?: 'auto' | 'half' | 'peek';
}) {
  const [flagged, flag] = useCellFlag(step);
  const d = detent ?? (expanded ? 'half' : 'peek');
  const key = stepKey(step);
  const wrap = useRef<HTMLDivElement>(null);
  // 다른 칸으로 바뀌면 본문을 맨 위(캡슐 · 스트립 · 문장)로 — 시트는 그대로 둔 채.
  useEffect(() => {
    wrap.current?.closest('.ui-sheet__body')?.scrollTo({ top: 0 });
  }, [key]);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      detent={d}
      modal={false}
      forceBottom
      title={explanation.title}
      footer={
        <>
          {flagged ? (
            <p className="charts-sheet__done t-callout" role="status">
              <IconCheck />
              헷갈려요
            </p>
          ) : (
            <CapsuleButton tone="unsure" size="md" className="charts-sheet__flag" onClick={flag}>
              헷갈려요
            </CapsuleButton>
          )}
          {!detent && (
            <CapsuleButton tone="neutral" size="md" className="charts-sheet__more" aria-expanded={expanded} onClick={() => onExpand(!expanded)}>
              {expanded ? '작게 ⌄' : '더 보기 ⌃'}
            </CapsuleButton>
          )}
          <CapsuleButton tone="neutral" size="md" className="charts-sheet__close" onClick={onClose}>
            닫기
          </CapsuleButton>
        </>
      }
    >
      <div ref={wrap} className="charts-sheet__wrap">
        <ExplanationBody key={key} step={step} explanation={explanation} onAcross={onAcross} />
      </div>
    </Sheet>
  );
}
