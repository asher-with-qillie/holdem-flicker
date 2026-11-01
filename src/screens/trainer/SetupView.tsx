import { useCallback, useEffect, useMemo, useState } from 'react';
import { KindProgress } from '../../components/KindProgress';
import { formatDuration } from '../../components/ui/SessionSummaryCard';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { Chip } from '../../components/ui/Chip';
import { ChipRow } from '../../components/ui/ChipRow';
import { GlassPanel } from '../../components/ui/GlassPanel';
import { IconButton } from '../../components/ui/IconButton';
import { SpeedPicker } from '../../components/ui/SpeedPicker';
import { IconMore, IconPlay } from '../../components/ui/icons';
import { POSITIONS, type Pos } from '../../poker/types';
import { openSettings } from '../../state/nav';
import { useProgress, type SessionResult } from '../../state/progress';
import { applySpeedPreset, updateSettings, type DeckId, type Settings } from '../../state/settings';
import { previewQueue, useSrs, weakKeys } from '../../state/srs';
import { useLayout } from '../../state/viewport';
import { DECK_LABEL, DECK_ORDER, deckKinds, estimateMs, formatEstimate, hasChartsFor, resolvePositions, timingFor, WEAK_MIN } from './decks';
import type { SessionConfig } from './sessionStore';

/** Pre-selection from a `LaunchIntent` that did not autostart (§5.2). */
export interface SetupPreset {
  deck?: DeckId;
  positions?: Pos[];
  scenarioId?: string;
  onlyKeys?: string[];
}

const SIZES: ReadonlyArray<Settings['sessionSize']> = [10, 20, 40];
const NO_CHARTS = '이 조합의 차트가 아직 없어요';
const WEAK_HINT = '아직 없어요 · 10장만 평가하면 열려요';

export interface SetupViewProps {
  settings: Settings;
  preset: SetupPreset | null;
  onStart(config: SessionConfig): void;
  lastResult?: SessionResult;
  onOpenLast(): void;
}

export function SetupView({ settings, preset, onStart, lastResult, onOpenLast }: SetupViewProps) {
  useSrs();
  const layout = useLayout();
  const wideCols = layout === 'land' || layout === 'tall' || layout === 'wide';
  const pv = useProgress(settings.dailyGoal);
  const [deck, setDeck] = useState<DeckId>(() => preset?.deck ?? settings.lastDeck);
  const [positions, setPositions] = useState<Pos[] | null>(() => (preset?.positions?.length ? preset.positions : settings.lastPositions));
  const [scenarioId, setScenarioId] = useState<string | undefined>(preset?.scenarioId);
  const [onlyKeys, setOnlyKeys] = useState<string[] | undefined>(preset?.onlyKeys);

  // A launch intent arriving while the setup is mounted re-selects the chips.
  useEffect(() => {
    if (!preset) return;
    if (preset.deck) setDeck(preset.deck);
    if (preset.positions?.length) setPositions(preset.positions);
    setScenarioId(preset.scenarioId);
    setOnlyKeys(preset.onlyKeys);
  }, [preset]);

  const weakCount = useMemo(() => weakKeys().length, [pv.totalCards, settings.kinds]); // eslint-disable-line react-hooks/exhaustive-deps
  const weakOk = weakCount >= WEAK_MIN;
  const effectiveDeck: DeckId = onlyKeys ? 'all' : scenarioId ? 'scenario' : deck === 'weak' && !weakOk ? 'all' : deck;
  const pool = settings.positions.length ? settings.positions : [...POSITIONS];
  const chosen = resolvePositions(positions, settings);
  const allSelected = positions === null || chosen.length === pool.length;

  const pickDeck = useCallback(
    (d: DeckId) => {
      setDeck(d);
      setScenarioId(undefined);
      setOnlyKeys(undefined);
      if (d !== 'scenario') updateSettings({ lastDeck: d });
    },
    [],
  );

  const togglePos = useCallback(
    (p: Pos | 'all') => {
      let nextSel: Pos[] | null;
      if (p === 'all') nextSel = null;
      else if (positions === null) nextSel = [p];
      else if (positions.includes(p)) nextSel = positions.length > 1 ? positions.filter((x) => x !== p) : null;
      else nextSel = pool.filter((x) => positions.includes(x) || x === p);
      setPositions(nextSel);
      updateSettings({ lastPositions: nextSel });
    },
    [positions, pool],
  );

  const timing = timingFor(settings.speedPreset, settings);
  const size = onlyKeys ? onlyKeys.length : settings.sessionSize;
  const charts = onlyKeys ? onlyKeys.length > 0 : effectiveDeck === 'weak' ? weakOk : hasChartsFor(effectiveDeck, chosen, settings);

  const counts = useMemo(() => {
    if (!charts) return { new: 0, due: 0, unsure: 0 };
    return previewQueue({
      size: settings.sessionSize,
      deck: effectiveDeck,
      positions: chosen,
      kinds: settings.kinds,
      mode: 'train',
      interestingBias: settings.interestingBias,
      activeDays: pv.activeDays,
      ...(scenarioId ? { scenarioId } : {}),
      ...(onlyKeys ? { onlyKeys } : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charts, settings.sessionSize, effectiveDeck, chosen.join(','), settings.kinds.join(','), settings.interestingBias, pv.activeDays, scenarioId, onlyKeys]);

  const start = () => {
    const config: SessionConfig = {
      deck: effectiveDeck,
      positions: chosen,
      size: settings.sessionSize,
      speed: settings.speedPreset,
      exposure: settings.exposureMode,
      manual: !settings.autoAdvance || !!onlyKeys,
    };
    if (scenarioId) config.scenarioId = scenarioId;
    if (onlyKeys) config.onlyKeys = onlyKeys;
    onStart(config);
  };

  // The queue builder may return fewer cards than the nominal size (first-week new-card cap, small decks).
  const planned = charts ? Math.max(0, counts.new + counts.due + counts.unsure) || size : size;
  const estimate = formatEstimate(estimateMs(planned, timing, settings.exposureMode));
  const lastPct = lastResult && lastResult.rated > 0 ? Math.round((lastResult.known / lastResult.rated) * 100) : null;

  // land / tall / wide: the chip rows wrap inside their column instead of scrolling sideways (Duo spec §4.3)
  const wrapChips = layout === 'land' || layout === 'tall' || layout === 'wide';

  return (
    <div className="trainer-setup">
      <header className="trainer-setup__head">
        <div>
          <h1 className="t-title-l">훈련</h1>
          <p className="t-callout ink-2">덱을 고르고 시작해요</p>
        </div>
        <IconButton icon={<IconMore />} label="설정" onClick={() => openSettings(true)} />
      </header>

      <div className="trainer-setup__col trainer-setup__col--l">
        <section className="trainer-setup__group">
          <h2 className="trainer-setup__label t-caption">덱</h2>
          <ChipRow ariaLabel="덱" wrap={wrapChips}>
            {scenarioId && (
              <Chip selected tint="var(--sky)" onClick={() => undefined}>
                이 상황
              </Chip>
            )}
            {onlyKeys && (
              <Chip selected tint="var(--amber)" count={onlyKeys.length} onClick={() => undefined}>
                선택한 카드
              </Chip>
            )}
            {DECK_ORDER.map((d) =>
              d === 'weak' ? (
                <Chip key={d} selected={effectiveDeck === 'weak'} tint="var(--amber)" count={weakCount} disabled={!weakOk} onClick={() => pickDeck('weak')} title={weakOk ? undefined : WEAK_HINT}>
                  ⚡ {DECK_LABEL.weak}
                </Chip>
              ) : (
                <Chip key={d} selected={effectiveDeck === d} onClick={() => pickDeck(d)}>
                  {DECK_LABEL[d]}
                </Chip>
              ),
            )}
          </ChipRow>
          {!weakOk && <p className="trainer-setup__hint t-footnote">내 약점 · {WEAK_HINT}</p>}
        </section>

        <section className="trainer-setup__group">
          <h2 className="trainer-setup__label t-caption">포지션</h2>
          <ChipRow ariaLabel="포지션" wrap={wrapChips}>
            <Chip selected={allSelected} onClick={() => togglePos('all')} disabled={!!scenarioId}>
              전체
            </Chip>
            {pool.map((p) => (
              <Chip key={p} selected={!allSelected && chosen.includes(p)} onClick={() => togglePos(p)} disabled={!!scenarioId}>
                {p}
              </Chip>
            ))}
          </ChipRow>
        </section>

        <section className="trainer-setup__group trainer-setup__group--speed">
          <h2 className="trainer-setup__label t-caption">속도</h2>
          <SpeedPicker value={settings.speedPreset} onChange={applySpeedPreset} exposure={settings.exposureMode} onExposureChange={(v) => updateSettings({ exposureMode: v })} />
        </section>

        <section className="trainer-setup__group trainer-setup__group--row">
          <h2 className="trainer-setup__label t-caption">세션 크기</h2>
          <div className="trainer-setup__sizes" role="group" aria-label="세션 크기">
            {SIZES.map((n) => (
              <Chip key={n} selected={settings.sessionSize === n} onClick={() => updateSettings({ sessionSize: n })} disabled={!!onlyKeys}>
                {n}
              </Chip>
            ))}
          </div>
        </section>

      </div>

      <div className="trainer-setup__col trainer-setup__col--r">
        {/* 미리보기 + 시작 = 한 덩어리(dock). phone / squat: 목록이 화면보다 길면 스크롤러 아래에 붙어 있고(유리 뒤로 위 칸이
            흐려지며 지나감 — 버튼이 글자를 자르지 않습니다), 예상 시간은 버튼 안에. land: 오른쪽 칼럼 맨 위에 붙습니다. */}
        <GlassPanel variant="strong" radius="lg" padding={12} className="trainer-go trainer-preview">
          <p className={`trainer-go__head t-headline${charts ? ' trainer-go__head--est' : ''}`}>{charts ? (
              <>
                <span className="trainer-go__lead">이번 세션 </span>
                {`${planned}장 · ${estimate}`}
              </>
            ) : (
              '지금은 시작할 수 없어요'
            )}
          </p>
          {charts ? (
            <p className="trainer-preview__counts t-footnote tnum">
              <span>
                <i style={{ background: 'var(--sky)' }} /> 복습 {counts.due}
              </span>
              <span>
                <i style={{ background: 'var(--amber)' }} /> 헷갈려요 {counts.unsure}
              </span>
              <span>
                <i style={{ background: 'var(--lilac)' }} /> 새 카드 {counts.new}
              </span>
            </p>
          ) : (
            <p className="trainer-preview__counts trainer-go__reason t-footnote" style={{ color: 'var(--amber)' }}>
              {effectiveDeck === 'weak' ? WEAK_HINT : NO_CHARTS}
            </p>
          )}
          <CapsuleButton
            tone="primary"
            size="xl"
            block
            icon={<IconPlay />}
            onClick={start}
            disabled={!charts}
            className="trainer-setup__start"
            trailing={charts ? <span className="trainer-go__est tnum">{`${planned}장 · ${estimate}`}</span> : undefined}
          >
            시작
          </CapsuleButton>
        </GlassPanel>

        {lastResult && (
          <button type="button" className="trainer-lastrow" onClick={onOpenLast}>
            <span className="t-callout">지난 세션</span>
            <span className="trainer-lastrow__meta t-footnote tnum">
              {/* no-break space inside each pair and after each '·': it wraps only before a '·', so a wrapped line always
                  starts with one (binding it to the item before instead took three lines in the 104 px land column) */}
              {`${lastResult.seen}장${lastPct !== null ? ` ·\u00a0정답\u00a0${lastPct}%` : ''} ·\u00a0${formatDuration(lastResult.activeMs).replace(/ /g, '\u00a0')}`}
            </span>
            <span className="trainer-lastrow__chev" aria-hidden="true">
              ▸
            </span>
          </button>
        )}

        {/* land / tall / wide: 오른쪽 칼럼의 남는 높이에 이 덱 · 자리의 상황별 외운 정도(차트가 머리에 얼마나 들어왔는지) */}
        {wideCols && <KindProgress kinds={deckKinds(effectiveDeck, settings.kinds)} positions={chosen} />}
      </div>
    </div>
  );
}
