import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PlayingCard } from '../../components/PlayingCard';
import { PlainText, TermScope } from '../../components/Term';
import { CapsuleButton } from '../../components/ui/CapsuleButton';
import { GlassPanel } from '../../components/ui/GlassPanel';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Sheet } from '../../components/ui/Sheet';
import { IconGrid } from '../../components/ui/icons';
import {
  anchorCell,
  atlasQuizKeys,
  compareAxis,
  handAtlas,
  newcomersAt,
  rfiThesis,
  seatLevers,
  sectionDigest,
  sectionDigestDetail,
  type AtlasCell,
  type AtlasSection,
  type HandAtlas,
  type LeverId,
} from '../../poker/atlas';
import { HAND_CLASS_KO } from '../../poker/explain';
import { dealCardsFor } from '../../poker/hands';
import type { HandName, Pos, Scenario, ScenarioKind } from '../../poker/types';
import { closeAtlas, useAtlas, type AtlasIntent } from '../../state/atlas';
import { launch } from '../../state/nav';
import { DISCLAIMER } from '../charts/disclaimer';
import { AtlasDetail } from './AtlasDetail';
import { HandPicker } from './HandPicker';
import { sameScenario, SeatStrip, type TileMarks } from './SeatStrip';
import { SeatTriangle } from './SeatTriangle';
import '../../styles/atlas.css';

/*
 * 자리별 보기(HandAtlas) 시트 — docs/ATLAS_SPEC.md §3.
 * App 이 루트에서 한 번만 렌더합니다. `useAtlas()` 로 intent 를 읽고, 열릴 때마다 안쪽 상태를 새로 만듭니다(key).
 * 글은 전부 PlainText 를 거치고, 용어 밑줄은 패 하나당 한 번(TermScope resetKey={hand}).
 */

type OpenSeg = 'vs_open' | 'vs_4bet';
type ThreeSeg = 'vs_3bet' | 'vs_5bet';

// '반반'은 계속하는 두 액션 사이에만 씁니다(§2.2). 오픈 50 / 폴드 50 같은 칸까지 아우르는 말이라 '비중이 같으면'.
const TIE_NOTE = '비중이 같으면 더 공격적인 쪽을 정답으로 쳐요.';
const NEWCOMER_MAX = 9;
/** 섹션 row 문장으로 쓰는 레버(자리만 보는 것). 숫자 레버·상대 레버는 비교 블록이 맡습니다. */
const ROW_LEVERS: LeverId[] = ['behind', 'bbPrice', 'sbRaiseOrFold', 'bbFree'];
/** 미도달 칸의 이유 — 범례 한 줄에 씁니다. */
const GATE_REASON: Partial<Record<ScenarioKind, string>> = { rfi: '오픈하지 않는 자리', vs_open: '그 오픈에 3벳하지 않는 자리', vs_3bet: '4벳하지 않는 자리' };

function cellOf(atlas: HandAtlas, s: Scenario | undefined): AtlasCell | undefined {
  if (!s) return undefined;
  return atlas.sections[s.kind]?.cells.find((c) => sameScenario(c.scenario, s));
}

/** 동점 반반(콜·3벳 50/50 같은 것)이 하나라도 있으면 각주를 답니다 — 트레이너 채점 규칙과 같은 말. */
function hasTie(sec: AtlasSection): boolean {
  return sec.cells.some((c) => c.reachable && c.mixList[1] !== undefined && Math.abs(c.mixList[0].weight - c.mixList[1].weight) < 0.01);
}

function gateLegend(sec: AtlasSection): string | null {
  const kinds = new Set<ScenarioKind>();
  for (const c of sec.cells) if (!c.reachable && c.gate) kinds.add(c.gate.kind);
  if (!kinds.size) return null;
  const reasons = [...kinds].map((k) => GATE_REASON[k]).filter((x): x is string => !!x);
  return `— 표시: ${reasons.join('거나 ')}라서 안 생기는 칸`;
}

function Section({ title, tag, control, children }: { title: string; tag?: string; control?: ReactNode; children: ReactNode }) {
  return (
    <section className="atlas__section">
      <div className="atlas__section-h">
        <h3 className="t-headline">
          {title}
          {tag && <span className="atlas__tag">{tag}</span>}
        </h3>
        {control}
      </div>
      {children}
    </section>
  );
}

function Digest({ sec }: { sec: AtlasSection }) {
  const detail = sectionDigestDetail(sec);
  return (
    <p className="atlas__digest t-footnote ink-2">
      <PlainText text={sectionDigest(sec).text} />
      {detail && (
        <>
          <br />
          <PlainText text={detail.text} />
        </>
      )}
    </p>
  );
}

interface InnerState {
  hand: HandName;
  selected?: Scenario;
  compare?: Scenario;
  seg: { open: OpenSeg; three: ThreeSeg };
  view: 'atlas' | 'pick';
}

function initState(intent: AtlasIntent): InnerState {
  const atlas = handAtlas(intent.hand);
  const origin = cellOf(atlas, intent.origin);
  const compare = intent.compare && origin ? cellOf(atlas, intent.compare) : undefined;
  const seg: InnerState['seg'] = { open: intent.origin?.kind === 'vs_4bet' ? 'vs_4bet' : 'vs_open', three: intent.origin?.kind === 'vs_5bet' ? 'vs_5bet' : 'vs_3bet' };
  const auto = origin ? anchorCell(atlas, origin) : null;
  return {
    hand: intent.hand,
    ...(origin ? { selected: origin.scenario } : {}),
    ...(compare ? { compare: compare.scenario } : auto ? { compare: auto.scenario } : {}),
    seg,
    view: intent.mode === 'pick' ? 'pick' : 'atlas',
  };
}

export function HandAtlasSheet(): JSX.Element | null {
  const intent = useAtlas();
  // 열릴 때마다 새 intent 객체가 옵니다 — 그걸 key 로 안쪽 상태를 통째로 새로 만듭니다.
  const lastIntent = useRef<AtlasIntent | null>(null);
  const seq = useRef(0);
  if (intent && intent !== lastIntent.current) {
    lastIntent.current = intent;
    seq.current += 1;
  }
  const shown = intent ?? lastIntent.current;
  if (!shown) return null;
  return <AtlasSheetInner key={seq.current} intent={shown} open={!!intent} />;
}

function AtlasSheetInner({ intent, open }: { intent: AtlasIntent; open: boolean }) {
  const [st, setSt] = useState<InnerState>(() => initState(intent));
  const { hand, view } = st;
  const atlas = useMemo(() => handAtlas(hand), [hand]);
  const origin = intent.origin;
  const selected = cellOf(atlas, st.selected);
  const compare = selected && selected.reachable ? (cellOf(atlas, st.compare) ?? null) : null;
  const marks: TileMarks = { selected: st.selected, compare: compare?.scenario, origin };

  const bodyRef = useRef<HTMLDivElement>(null);

  // 들어온 칸이 아래쪽 섹션이면 열리자마자 그 섹션으로 내립니다(rfi 는 이미 맨 위).
  useEffect(() => {
    if (!origin || origin.kind === 'rfi' || view !== 'atlas') return;
    const id = requestAnimationFrame(() => {
      bodyRef.current?.querySelector<HTMLElement>(`[data-kind="${origin.kind}"]`)?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 열릴 때 한 번
  }, []);

  /** 탭 1회 = 선택(민트). 선택된 상태에서 같은 행·열의 다른 칸 = 비교(하늘). 같은 칸 재탭 = 해제. 그 밖 = 새 선택. */
  const tap = useCallback(
    (cell: AtlasCell) => {
      setSt((s) => {
        const cur = cellOf(atlas, s.selected);
        if (cur && sameScenario(cur.scenario, cell.scenario)) {
          const { selected: _s, compare: _c, ...rest } = s;
          return rest;
        }
        // 같은 행·열(한 축만 다름)의 reachable 칸 = 비교 상대 교체. 지금 비교 칸을 누르면 그 칸이 새 선택이 됩니다.
        const sameAxis = cur && cur.reachable && cell.reachable && compareAxis(cur.scenario, cell.scenario) !== 'none';
        if (sameAxis && !sameScenario(s.compare, cell.scenario)) return { ...s, compare: cell.scenario };
        const auto = anchorCell(atlas, cell);
        const { compare: _c, ...rest } = s;
        return { ...rest, selected: cell.scenario, ...(auto ? { compare: auto.scenario } : {}) };
      });
    },
    [atlas],
  );

  /** 세그먼트 전환은 같은 (나, 상대) 기하를 유지합니다 — 선택·비교 칸이 그 섹션이면 같은 좌표로 옮깁니다. */
  const switchSeg = useCallback(
    (axis: 'open' | 'three', kind: OpenSeg | ThreeSeg) => {
      setSt((s) => {
        const prev = s.seg[axis];
        const next: InnerState = { ...s, seg: { ...s.seg, [axis]: kind } };
        if (s.selected?.kind === prev) {
          next.selected = { ...s.selected, kind };
          const moved = s.compare?.kind === prev ? cellOf(atlas, { ...s.compare, kind }) : undefined;
          const sel = cellOf(atlas, next.selected);
          const auto = moved && moved.reachable ? moved : sel ? anchorCell(atlas, sel) : null;
          if (auto) next.compare = auto.scenario;
          else delete next.compare;
        }
        return next;
      });
    },
    [atlas],
  );

  /** 다른 패로 전환(새로 들어오는 패 이름 · 손패 고르기): 좌표는 그대로, 비교 상대만 새로 정합니다. */
  const switchHand = useCallback((h: HandName) => {
    setSt((s) => {
      const a = handAtlas(h);
      const sel = cellOf(a, s.selected);
      const auto = sel ? anchorCell(a, sel) : null;
      const { compare: _c, ...rest } = s;
      return { ...rest, hand: h, view: 'atlas', ...(auto ? { compare: auto.scenario } : {}) };
    });
  }, []);

  const quizKeys = useMemo(() => atlasQuizKeys(atlas, { max: 12 }), [atlas]);
  const startQuiz = () => {
    if (!quizKeys.length) return;
    launch({ target: 'quiz', onlyKeys: quizKeys, autostart: true });
    // 훈련 탭을 떠나 퀴즈로 갑니다 — 아틀라스가 멈춘 세션을 뒤에서 다시 돌리지 않습니다.
    closeAtlas({ resume: false });
  };

  const title = view === 'pick' ? '다른 패 고르기' : `${hand} · 자리별`;
  const footer =
    view === 'pick' ? (
      <CapsuleButton tone="neutral" size="lg" block onClick={() => setSt((s) => ({ ...s, view: 'atlas' }))}>
        {hand} 자리별 보기
      </CapsuleButton>
    ) : (
      <>
        <CapsuleButton tone="primary" size="lg" className="atlas__quiz" disabled={!quizKeys.length} onClick={startQuiz}>
          {quizKeys.length ? `이 패로 퀴즈 · ${quizKeys.length}문제` : '자리마다 답이 같은 패'}
        </CapsuleButton>
        <CapsuleButton tone="neutral" size="lg" icon={<IconGrid />} onClick={() => setSt((s) => ({ ...s, view: 'pick' }))}>
          다른 패
        </CapsuleButton>
      </>
    );

  return (
    <Sheet open={open} onClose={() => closeAtlas()} detent="full" title={title} footer={footer}>
      <div ref={bodyRef}>
        {view === 'pick' ? (
          <HandPicker hand={hand} onSelect={switchHand} />
        ) : (
          <TermScope resetKey={hand}>
            <AtlasBody atlas={atlas} st={st} selected={selected} compare={compare} marks={marks} onTap={tap} onSeg={switchSeg} onHand={switchHand} />
          </TermScope>
        )}
      </div>
    </Sheet>
  );
}

function AtlasBody({
  atlas,
  st,
  selected,
  compare,
  marks,
  onTap,
  onSeg,
  onHand,
}: {
  atlas: HandAtlas;
  st: InnerState;
  selected: AtlasCell | undefined;
  compare: AtlasCell | null;
  marks: TileMarks;
  onTap(c: AtlasCell): void;
  onSeg(axis: 'open' | 'three', kind: OpenSeg | ThreeSeg): void;
  onHand(h: HandName): void;
}) {
  const { hand, rfi, sections } = atlas;
  const cards = useMemo(() => dealCardsFor(hand), [hand]);
  const thesis = rfiThesis(atlas).map((l) => l.text).join(' ');
  const detailFor = (kind: ScenarioKind) => (selected && selected.scenario.kind === kind ? <AtlasDetail key={selected.key} atlas={atlas} cell={selected} compare={compare} /> : null);

  // 새로 들어오는 패: firstAlways ?? firstAny 자리. 없으면(never·sbOnly) 줄 자체를 뺍니다.
  const entry = rfi.firstAlways ?? rfi.firstAny;
  const newcomers = useMemo(() => (entry ? newcomersAt(entry, hand) : []), [entry, hand]);

  const openSec = sections[st.seg.open];
  const otherOpen = sections[st.seg.open === 'vs_open' ? 'vs_4bet' : 'vs_open'];
  const threeSec = sections[st.seg.three];
  const otherThree = sections[st.seg.three === 'vs_3bet' ? 'vs_5bet' : 'vs_3bet'];
  const sharePct = (p: Pos) => `${rfi.seats.find((s) => s.pos === p)?.share ?? 0}%`;

  // 오픈 대응의 행 문장: 선택된 행(없으면 origin 행, 그것도 없으면 BB)의 자리 레버 ≤ 2줄. 4벳 대응에는 자리 레버가 없습니다.
  const rowHero: Pos = (selected?.scenario.kind === 'vs_open' ? selected.scenario.hero : marks.origin?.kind === 'vs_open' ? marks.origin.hero : undefined) ?? 'BB';
  // 상대는 선택한 칸의 상대 — BB×SB 를 골랐는데 UTG 값(1.5bb/5.5bb)을 보여 주면 틀립니다(BB vs SB 는 2bb/6bb).
  const rowVillain =
    selected?.scenario.kind === 'vs_open' && selected.scenario.hero === rowHero ? selected.scenario.villain : openSec.cols?.find((v) => v !== rowHero);
  const rowLines =
    st.seg.open === 'vs_open'
      ? seatLevers({ kind: 'vs_open', hero: rowHero, villain: rowVillain })
          .filter((l) => ROW_LEVERS.includes(l.id))
          .slice(0, 2)
      : [];

  const cold = sections.cold_4bet;
  const coldAllFold = cold.cells.every((c) => c.primary === 'fold');
  const [coldOpen, setColdOpen] = useState(false);
  const coldShown = !coldAllFold || coldOpen || selected?.scenario.kind === 'cold_4bet';

  const limp = sections.vs_limp;

  return (
    <div className="atlas">
      <div className="atlas__hand">
        <PlayingCard card={cards[0]} size="sm" />
        <PlayingCard card={cards[1]} size="sm" />
        <span className="t-footnote ink-2">
          <PlainText text={HAND_CLASS_KO[atlas.cls]} />
        </span>
      </div>

      <GlassPanel variant="tint" tint="var(--mint)" radius="md" padding={12} className="atlas__thesis glass-flat">
        <p className="t-headline">
          <PlainText text={thesis} />
        </p>
      </GlassPanel>

      <div data-kind="rfi">
        <Section title="오픈 · 앞에서 모두 폴드">
          <SeatStrip
            cells={sections.rfi.cells}
            kind="rfi"
            marks={marks}
            sbDivider
            captions={[
              { label: '뒤에', values: rfi.seats.map((s) => `${s.behind}명`) },
              { label: '오픈', values: rfi.seats.map((s) => `${s.share}%`) },
            ]}
            onSelect={onTap}
          />
          <p className="atlas__lever-core t-footnote ink-2">
            <PlainText text="뒤에 남은 사람이 적을수록 넓게 오픈해요." />
          </p>
          <p className="t-footnote ink-2">
            <PlainText text="SB는 뒤에 BB 한 명뿐이라 따로 외워요." />
          </p>
          {hasTie(sections.rfi) && (
            <p className="t-footnote ink-3">
              <PlainText text={TIE_NOTE} />
            </p>
          )}
          {entry && newcomers.length > 0 && (
            <p className="atlas__hands t-footnote ink-2">
              <PlainText text={`${entry}에서 새로 오픈하는 패:`} />
              {newcomers.slice(0, NEWCOMER_MAX).map((h) => (
                <button key={h} type="button" className="atlas__hand-btn tnum" onClick={() => onHand(h)}>
                  {h}
                </button>
              ))}
              {newcomers.length > NEWCOMER_MAX && <span>등 {newcomers.length}종</span>}
            </p>
          )}
          {detailFor('rfi')}
        </Section>
      </div>

      <div data-kind={st.seg.open}>
        <Section
          title="오픈 대응 · 누가 오픈했나"
          control={
            <SegmentedControl<OpenSeg>
              options={[
                { value: 'vs_open', label: '오픈에' },
                { value: 'vs_4bet', label: '4벳까지' },
              ]}
              value={st.seg.open}
              onChange={(v) => onSeg('open', v)}
              size={44}
              ariaLabel="오픈 대응 단계"
            />
          }
        >
          <SeatTriangle section={openSec} colSub={openSec.cols?.map(sharePct)} marks={marks} onSelect={onTap} />
          {rowLines.map((l) => (
            <p key={l.id} className="t-footnote ink-2">
              <PlainText text={l.text} />
            </p>
          ))}
          <Digest sec={openSec} />
          <p className="t-footnote ink-3">
            <PlainText text={`${st.seg.open === 'vs_open' ? '4벳까지 가면' : '앞에서 오픈하면'}: ${sectionDigest(otherOpen).text}`} />
          </p>
          {gateLegend(openSec) && <p className="t-footnote ink-3">{gateLegend(openSec)}</p>}
          {hasTie(openSec) && (
            <p className="t-footnote ink-3">
              <PlainText text={TIE_NOTE} />
            </p>
          )}
          {detailFor(st.seg.open)}
        </Section>
      </div>

      <div data-kind={st.seg.three}>
        <Section
          title="3벳 대응 · 내 오픈에 3벳"
          control={
            <SegmentedControl<ThreeSeg>
              options={[
                { value: 'vs_3bet', label: '3벳에' },
                { value: 'vs_5bet', label: '올인까지' },
              ]}
              value={st.seg.three}
              onChange={(v) => onSeg('three', v)}
              size={44}
              ariaLabel="3벳 대응 단계"
            />
          }
        >
          <SeatTriangle section={threeSec} marks={marks} onSelect={onTap} />
          <Digest sec={threeSec} />
          <p className="t-footnote ink-3">
            <PlainText text={`${st.seg.three === 'vs_3bet' ? '올인까지 가면' : '3벳을 받으면'}: ${sectionDigest(otherThree).text}`} />
          </p>
          {gateLegend(threeSec) && <p className="t-footnote ink-3">{gateLegend(threeSec)}</p>}
          {hasTie(threeSec) && (
            <p className="t-footnote ink-3">
              <PlainText text={TIE_NOTE} />
            </p>
          )}
          {detailFor(st.seg.three)}
        </Section>
      </div>

      <div data-kind="vs_limp">
        <Section title="림프 대응 · 앞에서 한 명이 림프" tag="사람 작성">
          <SeatStrip cells={limp.cells} kind="vs_limp" marks={marks} onSelect={onTap} />
          <Digest sec={limp} />
          <p className="atlas__disclaimer t-footnote ink-3">{DISCLAIMER.vs_limp}</p>
          {detailFor('vs_limp')}
        </Section>
      </div>

      <div data-kind="cold_4bet">
        {coldShown ? (
          <Section title="콜드 4벳 · 앞에서 오픈과 3벳">
            <SeatStrip cells={cold.cells} kind="cold_4bet" marks={marks} onSelect={onTap} />
            <Digest sec={cold} />
            {detailFor('cold_4bet')}
          </Section>
        ) : (
          <button type="button" className="atlas__fold" aria-expanded={false} onClick={() => setColdOpen(true)}>
            <span className="atlas__fold-mark t-headline" aria-hidden="true">▸</span>
            <span className="atlas__fold-title t-headline">콜드 4벳</span>
            <span className="atlas__fold-digest t-footnote ink-2">{sectionDigest(cold).text}</span>
          </button>
        )}
      </div>
    </div>
  );
}
