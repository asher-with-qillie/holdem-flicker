/**
 * L2(내 키로 바로 호출) 한 번을 감싸는 훅. COACH_SPEC §4·§6.7.
 *
 * 화면 쪽에서 지키는 약속은 두 가지입니다.
 *   1. **같은 다이제스트면 다시 묻지 않습니다.** 재료가 그대로면 답도 그대로인데 호출은 사용자 돈으로
 *      나갑니다. 그래서 캐시(hash 키)에 답이 있으면 [새로 받기]를 잠가 두고, 새 실수가 쌓여 hash 가
 *      바뀌면 저절로 풀립니다.
 *   2. **실패해도 화면은 그대로입니다.** 오류는 토스트 한 줄로만 말하고 L0 카드는 건드리지 않습니다.
 *      askClaude 가 던지는 message 는 이미 한국어 한 줄이라 그대로 띄웁니다.
 */
import { useState } from 'react';
import { toast } from '../../components/ui/Toast';
import { useCoachAi } from '../../state/coach/aiStore';
import { askClaude } from '../../state/coach/claude';
import type { CoachCard, CoachDigest } from '../../state/coach/types';

export interface AskCoach {
  hasKey: boolean;
  busy: boolean;
  /** 누를 수 있는가. 키가 있고, 부르는 중이 아니고, 이 다이제스트로 받아 둔 답이 없을 때만. */
  canAsk: boolean;
  /** 이 다이제스트로 받은 카드. 없으면 null. */
  answer: CoachCard[] | null;
  /** 이번 세션에서 방금 받았을 때만 시각이 남습니다(캐시에서 꺼낸 답은 시각을 모릅니다). */
  at: number | null;
  ask(): void;
}

export function useAskCoach(digest: CoachDigest): AskCoach {
  const ai = useCoachAi();
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<{ hash: string; cards: CoachCard[]; at: number } | null>(null);

  const hash = digest.hash;
  const mine = local && local.hash === hash ? local : null;
  const answer = mine ? mine.cards : ai.cached(hash);

  function ask(): void {
    const key = ai.key;
    if (!key || busy) return;
    setBusy(true);
    askClaude(digest, { apiKey: key, model: ai.model })
      .then((cards) => {
        // 린트를 통과한 카드가 모자라면 askClaude 가 빈 배열을 돌려줍니다 — 이때는 L0 화면 그대로 둡니다.
        if (cards.length === 0) {
          toast('AI 답변이 너무 어려워서 걸렀어요', 'amber');
          return;
        }
        ai.remember(hash, cards);
        setLocal({ hash, cards, at: Date.now() });
        toast('AI 코치 답이 왔어요', 'mint');
      })
      .catch((e: unknown) => {
        toast(e instanceof Error ? e.message : '지금은 못 받았어요', 'amber');
      })
      .finally(() => setBusy(false));
  }

  return {
    hasKey: ai.key !== undefined,
    busy,
    canAsk: ai.key !== undefined && !busy && answer === null,
    answer,
    at: mine ? mine.at : null,
    ask,
  };
}
