/**
 * AI에게 더 물어보기 패널 (COACH_SPEC §6.7).
 *
 * 본문(집중할 포인트)은 이 패널이 없어도 이미 완성돼 있습니다. 그래서 여기는 '더'입니다 —
 * 기본은 [질문 복사하기](계정만 있으면 되고 결제가 필요 없습니다)이고, 키를 넣는 길은 작은 링크
 * 하나로만 둡니다. 키를 권하는 화면이 되면 대다수에게는 못 쓰는 기능이 가장 크게 보이게 됩니다.
 */
import { useMemo, useState } from 'react';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { GlassPanel } from '../../components/ui/GlassPanel';
import { buildPrompt } from '../../state/coach/prompt';
import type { CoachDigest } from '../../state/coach/types';
import { ApiKeySheet } from './ApiKeySheet';
import { AskAiSheet } from './AskAiSheet';
import type { AskCoach } from './useAskCoach';

export function AskAiPanel({ digest, coach }: { digest: CoachDigest; coach: AskCoach }): JSX.Element {
  const [askOpen, setAskOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const prompt = useMemo(() => buildPrompt(digest), [digest]);

  return (
    <GlassPanel variant="clear" radius="lg" padding={16} className="coach-ai">
      <p className="coach-ai__lead">내 실수 기록을 정리해서 AI에게 물어봐요</p>
      <CapsuleButton tone="neutral" block onClick={() => setAskOpen(true)}>
        질문 복사하기
      </CapsuleButton>
      <button type="button" className="coach-ai__link" onClick={() => setKeyOpen(true)}>
        API 키가 있다면 바로 받기
      </button>

      <AskAiSheet
        open={askOpen}
        onClose={() => setAskOpen(false)}
        prompt={prompt}
        hasKey={coach.hasKey}
        canAsk={coach.canAsk}
        busy={coach.busy}
        onAsk={coach.ask}
      />
      <ApiKeySheet open={keyOpen} onClose={() => setKeyOpen(false)} />
    </GlassPanel>
  );
}
