import { useMemo, useState } from 'react';
import { dealCardsFor } from '../../poker/hands';
import { stepFor } from '../../poker/trainer';
import type { Scenario } from '../../poker/types';
import { CapsuleButton, type CapsuleButtonProps } from './CapsuleButton';
import { Chip } from './Chip';
import { ChipRow } from './ChipRow';
import { FloatingTabBar, type TabId } from './FloatingTabBar';
import { GlassPanel } from './GlassPanel';
import { Heatmap } from './Heatmap';
import { IconButton } from './IconButton';
import { ProgressRing } from './ProgressRing';
import { RatingBar } from './RatingBar';
import { SegmentedControl } from './SegmentedControl';
import { SessionSummaryCard, type SummaryData } from './SessionSummaryCard';
import { Sheet } from './Sheet';
import { SpeedPicker, type SpeedPreset } from './SpeedPicker';
import { StatTile } from './StatTile';
import { Switch } from './Switch';
import { ToastHost, toast } from './Toast';
import { ICON_NAMES, Icon, IconCards, IconClose, IconGear, IconGrid, IconHome, IconQuiz } from './icons';

const TONES: NonNullable<CapsuleButtonProps['tone']>[] = ['primary', 'neutral', 'ghost', 'know', 'unsure', 'danger', 'tint'];
const SIZES: NonNullable<CapsuleButtonProps['size']>[] = ['md', 'lg', 'xl'];
const TABS: Array<{ id: TabId; label: string; icon: JSX.Element }> = [
  { id: 'home', label: '홈', icon: <IconHome /> },
  { id: 'train', label: '훈련', icon: <IconCards /> },
  { id: 'quiz', label: '퀴즈', icon: <IconQuiz /> },
  { id: 'charts', label: '차트', icon: <IconGrid /> },
];

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function sampleDays(todayKey: string): Record<string, number> {
  const [y, m, d] = todayKey.split('-').map(Number);
  const out: Record<string, number> = {};
  for (let i = 0; i < 84; i++) {
    const dt = new Date(y, m - 1, d - i);
    const v = (i * 7919) % 11 > 3 ? ((i * 31) % 47) + 1 : 0;
    if (v) out[`${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`] = v;
  }
  return out;
}

function summaryData(): SummaryData {
  const mk = (sc: Scenario, hand: string) => {
    const step = stepFor(sc, hand);
    return { key: `${sc.kind}:${sc.hero}${sc.villain ? ':' + sc.villain : ''}|${hand}`, hand, cards: dealCardsFor(hand), title: `${sc.hero} · ${sc.villain ?? ''} ${sc.kind}`, action: step.answer, kind: sc.kind };
  };
  return {
    mode: 'train',
    headline: '세션 끝!',
    seen: 20,
    size: 20,
    durationMs: 128_000,
    speedLabel: '보통',
    rated: 20,
    known: 16,
    unsure: 4,
    byOrigin: { new: 11, review: 6, unsure: 3 },
    goalToday: 20,
    goal: 20,
    goalReachedNow: true,
    streak: 8,
    streakIncremented: true,
    weekDots: [true, true, true, true, true, true, false],
    weakest: { label: 'SB · 오픈 대응', unsure: 3, shown: 4, quizAcc: 55 },
    unsureRows: [mk({ kind: 'vs_open', hero: 'BB', villain: 'BTN' }, 'KTo'), mk({ kind: 'rfi', hero: 'CO' }, 'A4s'), mk({ kind: 'rfi', hero: 'UTG' }, 'KJo'), mk({ kind: 'vs_open', hero: 'SB', villain: 'CO' }, 'QTs')],
    exposureOnly: false,
    firstSession: true,
    levelUp: '레귤러 됐어요',
  };
}

/** Dev route (#ui): every ui component in every tone/size, for the `ui-fixtures` screenshot. */
export function UiFixtures(): JSX.Element {
  const [tab, setTab] = useState<TabId>('home');
  const [barHidden, setBarHidden] = useState(false);
  const [seg, setSeg] = useState('b');
  const [on, setOn] = useState(true);
  const [speed, setSpeed] = useState<SpeedPreset>('normal');
  const [exposure, setExposure] = useState(false);
  const [sheet, setSheet] = useState<'auto' | 'half' | 'full' | 'held' | null>(null);
  const [ring, setRing] = useState(12);
  const [chipSel, setChipSel] = useState('b');
  const [heatNote, setHeatNote] = useState('');
  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);
  const days = useMemo(() => sampleDays(today), [today]);
  const summary = useMemo(summaryData, []);

  return (
    <div className="fx">
      <h1 className="t-title-l">UI fixtures</h1>

      <h2>GlassPanel</h2>
      <div className="fx__col">
        <GlassPanel>regular · r-lg · p16</GlassPanel>
        <GlassPanel variant="strong" radius="xl">strong · r-xl</GlassPanel>
        <GlassPanel variant="tint" tint="var(--amber)" radius="md" padding={12}>tint amber · r-md · p12</GlassPanel>
        <GlassPanel variant="clear" radius="sm" padding={20}>clear · r-sm · p20</GlassPanel>
        <GlassPanel as="button" interactive radius="capsule" padding={12}>as button · capsule · interactive</GlassPanel>
      </div>

      <h2>CapsuleButton · tones × sizes</h2>
      {SIZES.map((size) => (
        <div key={size} className="fx__row">
          {TONES.map((tone) => (
            <CapsuleButton key={tone} tone={tone} size={size} tint={tone === 'tint' ? 'var(--act-fourbet)' : undefined}>
              {tone}
            </CapsuleButton>
          ))}
        </div>
      ))}
      <CapsuleButton tone="primary" size="xl" block icon={<Icon name="play" size={20} />} trailing="· 약 2분">
        오늘 세션 시작 · 20장
      </CapsuleButton>
      <CapsuleButton tone="neutral" disabled>
        disabled
      </CapsuleButton>

      <h2>IconButton</h2>
      <div className="fx__row">
        <IconButton icon={<IconGear />} label="glass 44" />
        <IconButton icon={<IconGear />} label="glass 40" size={40} />
        <IconButton icon={<IconClose />} label="ghost" tone="ghost" />
        <IconButton icon={<Icon name="play" />} label="accent" tone="accent" />
        <IconButton icon={<Icon name="pause" />} label="active" active />
      </div>

      <h2>Chip / ChipRow</h2>
      <ChipRow ariaLabel="덱">
        {['전체', '오픈', '오픈 대응', '3벳 대응', '4벳/올인'].map((l, i) => (
          <Chip key={l} selected={chipSel === String.fromCharCode(97 + i)} onClick={() => setChipSel(String.fromCharCode(97 + i))}>
            {l}
          </Chip>
        ))}
        <Chip tint="var(--amber)" selected count={12} dot="var(--amber)">
          내 약점
        </Chip>
        <Chip disabled>아직 없어요</Chip>
      </ChipRow>
      <div className="fx__row">
        <Chip size={32}>32</Chip>
        <Chip size={36} dot="var(--sky)">
          36 dot
        </Chip>
        <Chip size={40} count={3}>
          40 count
        </Chip>
        <Chip size={32} selected>
          32 on
        </Chip>
        <Chip size={40} selected tint="var(--lilac)">
          40 on
        </Chip>
      </div>

      <h2>SegmentedControl 44 / 48</h2>
      <SegmentedControl options={[{ value: 'a', label: '천천히' }, { value: 'b', label: '보통' }, { value: 'c', label: '빠르게' }, { value: 'd', label: '순간기억', disabled: true }]} value={seg} onChange={setSeg} ariaLabel="seg44" />
      <SegmentedControl options={[{ value: 'a', label: '10' }, { value: 'b', label: '20' }, { value: 'c', label: '40' }]} value={seg} onChange={setSeg} size={48} ariaLabel="seg48" />

      <h2>Switch</h2>
      <div className="fx__row">
        <Switch checked={on} onChange={setOn} label="on/off" />
        <Switch checked={!on} onChange={(v) => setOn(!v)} label="inverse" />
        <Switch checked disabled onChange={() => {}} label="disabled" />
      </div>

      <h2>ProgressRing 64 / 88 / 120</h2>
      <div className="fx__row">
        <ProgressRing value={ring} max={20} size={64} stroke={6} label={<span>{ring}</span>} />
        <ProgressRing value={ring} max={20} size={88} stroke={8} innerValue={8} label={<span>{ring}/20</span>} />
        <ProgressRing value={20} max={20} size={120} stroke={10} tint="var(--gold)" celebrate label={<span>20/20</span>} />
        <CapsuleButton size="md" onClick={() => setRing((r) => (r + 4) % 24)}>
          +4
        </CapsuleButton>
      </div>

      <h2>StatTile</h2>
      <div className="fx__row" style={{ flexWrap: 'nowrap' }}>
        <StatTile label="외웠어요" value={142} dot="var(--mint)" delta="+6" />
        <StatTile label="배우는 중" value={38} dot="var(--amber)" />
        <StatTile label="새 카드" value={1246} dot="var(--lilac)" onClick={() => toast('타일 탭')} />
      </div>

      <h2>Heatmap</h2>
      <GlassPanel>
        <Heatmap days={days} goal={20} todayKey={today} onSelect={(k, v) => setHeatNote(`${k} · ${v}장`)} />
        <p className="t-footnote ink-2" style={{ minHeight: 18, marginTop: 8 }}>
          {heatNote}
        </p>
      </GlassPanel>

      <h2>RatingBar</h2>
      <RatingBar onRate={(r) => toast(r === 'know' ? '알아요' : '헷갈려요', r === 'know' ? 'mint' : 'amber')} pulseOnce />
      <RatingBar onRate={() => {}} compact knowDisabled knowDisabledHint="답을 먼저 봤어요 · 다음에 확인해요" />

      <h2>SpeedPicker</h2>
      <SpeedPicker value={speed} onChange={setSpeed} exposure={exposure} onExposureChange={setExposure} />

      <h2>Sheet / Toast / tab bar</h2>
      <div className="fx__row">
        <CapsuleButton size="md" onClick={() => setSheet('auto')}>
          sheet auto
        </CapsuleButton>
        <CapsuleButton size="md" onClick={() => setSheet('half')}>
          sheet half
        </CapsuleButton>
        <CapsuleButton size="md" onClick={() => setSheet('full')}>
          sheet full
        </CapsuleButton>
        <CapsuleButton size="md" onClick={() => setSheet('held')}>
          sheet held
        </CapsuleButton>
        <CapsuleButton size="md" onClick={() => toast('평가하면 다음에 더 잘 골라드려요')}>
          toast
        </CapsuleButton>
        <CapsuleButton size="md" onClick={() => toast('속도를 바꿨어요', 'mint')}>
          toast mint
        </CapsuleButton>
        <CapsuleButton size="md" onClick={() => setBarHidden((h) => !h)}>
          {barHidden ? '탭바 보이기' : '탭바 숨기기'}
        </CapsuleButton>
      </div>

      <h2>Icons</h2>
      <div className="fx__icons">
        {ICON_NAMES.map((n) => (
          <span key={n}>
            <Icon name={n} />
            {n}
          </span>
        ))}
      </div>

      <h2>SessionSummaryCard</h2>
      <SessionSummaryCard data={summary} onRetryUnsure={() => toast('헷갈린 것만 다시')} onAgain={() => toast('한 번 더')} onHome={() => toast('홈으로')} onQuiz={() => toast('퀴즈로 확인')} onOpenRow={(r) => toast(r.hand)} onSpeedFeedback={(v) => toast(v)} />

      <Sheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        detent={sheet === 'held' ? 'auto' : (sheet ?? 'auto')}
        held={sheet === 'held'}
        title={`Sheet · ${sheet ?? ''}`}
        footer={
          sheet === 'held' ? (
            <p className="t-footnote ink-3" style={{ width: '100%', textAlign: 'center' }}>
              손을 떼면 이어서 진행해요
            </p>
          ) : (
            <CapsuleButton block onClick={() => setSheet(null)}>
              닫기
            </CapsuleButton>
          )
        }
      >
        <div className="ui-explain">
          <h3>왜 이 액션인가</h3>
          {Array.from({ length: 14 }, (_, i) => (
            <p key={i}>본문 {i + 1} · 탑페어를 자주 만들어 콜하지만 큰 팟은 피해요. BTN 오픈 레인지는 약 44%로 넓어서 BB는 넓게 방어해요.</p>
          ))}
        </div>
      </Sheet>
      {sheet === 'held' && (
        <CapsuleButton tone="danger" size="md" style={{ position: 'fixed', top: 60, right: 16, zIndex: 60 }} onClick={() => setSheet(null)}>
          held 닫기
        </CapsuleButton>
      )}

      <FloatingTabBar items={TABS} active={tab} onChange={setTab} hidden={barHidden} />
      <ToastHost />
    </div>
  );
}
