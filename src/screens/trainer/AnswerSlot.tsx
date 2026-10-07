import { LineCapsule, LineStrip } from '../../components/LineStrip';
import { PlainText } from '../../components/Term';
import type { Explanation } from '../../poker/explain';
import type { Grade } from '../quiz/grade';
import type { Phase } from './sessionStore';

/**
 * 리빌 슬롯(docs/EXPLAIN_SPEC.md §3.1). 바깥 크기는 그대로(120 · 짧은 화면 114)이고 안에는 딱 세 줄입니다:
 *   A 답 캡슐(32 · 짧은 화면 28) — 섞인 칸이면 안쪽 아래 3px 분할 막대('섞는 비율 보기'), 오답·부분 정답이면 오른쪽 끝에 경계 꼬리표
 *   B 줄 스트립 sm(13칸 · 297px) — 이 패에 링, 경계 막대
 *   C 줄 문장(2줄 클램프) — 같은 줄의 패는 전부 같은 문장, 링만 움직입니다
 * 문장은 답을 말하지 않습니다(답은 캡슐이 말함). 그래서 맞혔든 틀렸든 같은 문장이 나오고, 그게 기억의 단서가 됩니다.
 * 기존 rotateX flip(240ms)에 세 줄이 함께 실립니다. 생각하는 동안에는 조용한 자리 표시만 둡니다.
 *
 * `grade` — 트레이너 선택 모드에서 고른 답의 채점. 경계 꼬리표(`한 칸 밖`/`마지막 칸`)는 오답·부분 정답일 때만 보입니다.
 */
export function AnswerSlot({ phase, explanation, showMix, animKey, hint, grade }: { phase: Phase; explanation: Explanation; showMix: boolean; animKey: string; hint?: string; grade?: Grade }) {
  if (phase === 'think') {
    return (
      <div className="trainer-answer trainer-answer--idle glass-clear" aria-live="polite">
        <div className="trainer-answer__idle t-footnote">{hint ?? '고르면 정답과 해설이 나와요'}</div>
      </div>
    );
  }
  const near = (grade === 'wrong' || grade === 'partial') && explanation.nearMiss;
  const sentence = explanation.line.sentence?.text ?? '';
  return (
    <div className="trainer-answer glass-clear" aria-live="polite">
      <div key={animKey} className="trainer-answer__flip">
        <div className="trainer-answer__caprow">
          <LineCapsule capsule={explanation.capsule} size="sm" showSplit={showMix} className="trainer-answer__cap" />
          {near && <span className="trainer-answer__near fill t-caption">{near}</span>}
        </div>
        <LineStrip view={explanation.line} size="sm" className="trainer-answer__strip" />
        <p className="trainer-answer__reason t-footnote">
          <PlainText text={sentence} />
        </p>
      </div>
    </div>
  );
}
