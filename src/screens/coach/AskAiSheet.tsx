/**
 * 질문 복사 시트 (COACH_SPEC §4 L1 · §6.7) — 키 없는 사용자의 실질적인 AI 경로입니다.
 *
 * 프롬프트 상자를 읽기 전용 textarea 로 둔 것이 이 파일의 요점입니다. 클립보드 API 가 막힌
 * 브라우저(권한 거부·비보안 컨텍스트·인앱 브라우저)에서는 같은 상자를 select() 해서 손으로 복사할 수
 * 있어야 하는데, 보여 주는 상자와 폴백 상자가 따로면 화면에 같은 글이 두 번 나옵니다.
 *
 * 돌아온 답을 앱에 다시 붙여넣는 왕복은 강요하지 않습니다. 계정만 있으면 굴러가는 것이 이 경로의
 * 전부이고, 붙여넣기까지 시키면 대부분 거기서 멈춥니다.
 */
import { useRef } from 'react';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { Sheet } from '../../components/ui/Sheet';
import { toast } from '../../components/ui/Toast';

export interface AskAiSheetProps {
  open: boolean;
  onClose(): void;
  prompt: string;
  /** 키가 저장돼 있으면 첫 버튼이 [바로 물어보기]로 바뀝니다. */
  hasKey: boolean;
  canAsk: boolean;
  busy: boolean;
  onAsk(): void;
}

export function AskAiSheet({ open, onClose, prompt, hasKey, canAsk, busy, onAsk }: AskAiSheetProps): JSX.Element {
  const area = useRef<HTMLTextAreaElement>(null);

  /** 손으로 복사할 수 있게 상자를 통째로 선택해 둡니다. execCommand 는 마지막 수단입니다. */
  const selectAll = (): boolean => {
    const el = area.current;
    if (!el) return false;
    el.focus();
    el.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  };

  const copy = () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(prompt);
        toast('질문을 복사했어요 · AI에 붙여넣으세요', 'mint');
      } catch {
        toast(selectAll() ? '질문을 복사했어요 · AI에 붙여넣으세요' : '복사가 막혀 있어요 · 길게 눌러서 복사하세요', 'amber');
      }
    })();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      detent="auto"
      title="AI에게 물어보기"
      footer={
        <div className="coach-asksheet__foot">
          <div className="coach-asksheet__btns">
            {hasKey && (
              <CapsuleButton tone="primary" block disabled={!canAsk} onClick={onAsk}>
                {busy ? '받는 중' : '바로 물어보기'}
              </CapsuleButton>
            )}
            <CapsuleButton tone={hasKey ? 'neutral' : 'primary'} block onClick={copy}>
              복사하기
            </CapsuleButton>
          </div>
          <div className="coach-asksheet__links">
            <a className="ui-chip ui-chip--32 fill" href="https://claude.ai/" target="_blank" rel="noopener noreferrer">
              <span className="ui-chip__label">Claude 열기</span>
            </a>
            <a className="ui-chip ui-chip--32 fill" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">
              <span className="ui-chip__label">ChatGPT 열기</span>
            </a>
          </div>
        </div>
      }
    >
      <div className="coach-asksheet">
        <p className="coach-asksheet__lead">이 글을 그대로 복사해서 AI에 붙여넣으세요. 내 손패와 액션만 들어 있어요.</p>
        <textarea ref={area} className="fill coach-asksheet__prompt" readOnly value={prompt} aria-label="AI에게 보낼 질문" />
      </div>
    </Sheet>
  );
}
