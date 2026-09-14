/**
 * Claude API 키 시트 (COACH_SPEC §4 L2 · §6.7).
 *
 * 키는 이 브라우저에 **평문으로** 저장됩니다. 앱에 서버가 없어서 달리 둘 곳이 없습니다. 그래서
 * 경고 한 줄을 --coral 로 **고정 노출**하고(접거나 숨기지 않습니다) [키 지우기]를 바로 옆에 둡니다.
 * 화면에 키를 그릴 때는 maskKey 로 끝 4자만 씁니다 — 전체 문자열은 어디에도 그리지 않습니다.
 *
 * 모델 선택도 여기 둡니다. 돈이 나가는 설정은 키를 넣는 화면과 같은 자리에 있어야 하고,
 * 설정 탭으로 보내면 키를 넣은 사람만 쓰는 줄이 모두에게 보이게 됩니다.
 */
import { useState } from 'react';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Sheet } from '../../components/ui/Sheet';
import { toast } from '../../components/ui/Toast';
import { COACH_MODELS, maskKey, useCoachAi } from '../../state/coach/aiStore';

export function ApiKeySheet({ open, onClose }: { open: boolean; onClose(): void }): JSX.Element {
  const ai = useCoachAi();
  const [draft, setDraft] = useState('');

  const save = () => {
    const v = draft.trim();
    if (v === '') return;
    ai.setKey(v);
    setDraft('');
    toast('키를 저장했어요', 'mint');
    onClose();
  };

  const clear = () => {
    ai.clearKey();
    setDraft('');
    toast('키를 지웠어요', 'neutral');
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      detent="auto"
      title="Claude API 키"
      footer={
        <CapsuleButton tone="neutral" block onClick={onClose}>
          닫기
        </CapsuleButton>
      }
    >
      <div className="coach-key">
        <div className="coach-key__warn">
          <p className="coach-key__warn-text">공용 PC에서는 넣지 마세요. 키가 이 브라우저에 그대로 저장됩니다.</p>
          <CapsuleButton tone="danger" size="md" disabled={ai.key === undefined} onClick={clear}>
            키 지우기
          </CapsuleButton>
        </div>

        {ai.key !== undefined && (
          <p className="coach-key__saved tnum">
            저장된 키 <span>{maskKey(ai.key)}</span>
          </p>
        )}

        <label className="coach-key__field">
          <span className="coach-key__label">{ai.key === undefined ? '키 넣기' : '다른 키로 바꾸기'}</span>
          <input
            className="fill coach-key__input"
            type="password"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <CapsuleButton tone="primary" block disabled={draft.trim() === ''} onClick={save}>
          키 저장
        </CapsuleButton>

        <div className="coach-key__field">
          <span className="coach-key__label">모델</span>
          <SegmentedControl
            options={COACH_MODELS.map((m) => ({ value: m.id, label: m.label }))}
            value={ai.model}
            onChange={ai.setModel}
            ariaLabel="코치가 쓸 모델"
          />
        </div>

        <p className="coach-key__note">요금은 내 키로 나갑니다. 한 번 물어볼 때 1원 안팎이에요.</p>
      </div>
    </Sheet>
  );
}
