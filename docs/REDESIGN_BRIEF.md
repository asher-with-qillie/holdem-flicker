# Redesign brief — Holdem Flicker v2 (mobile only)

## Ask (from the product owner)
1. Make the UI feel **modern**: something Korean users in their teens and twenties would enjoy, and that harmonizes with the **latest iPhone design language** (iOS 26 "Liquid Glass": translucent, refractive glass materials for controls; floating capsule tab bar with inset margins; concentric rounded corners; large bold titles; controls float above content; vibrant tinted glass; springy micro-interactions; sheets with glass materials).
2. Treat **training mode like a flash-memory vocabulary app** (순간기억 단어 암기앱: rapid-exposure flashcards, decks/sessions, "알아요/헷갈려요" swipes, spaced repetition, daily goals, streaks, session summaries) and **fill in what is missing**.

## Constraints that do not change
- Mobile only (portrait phones 360–430 px; reference iPhone 13 390×844). Touch targets ≥ 44 px. Safe areas. No horizontal scroll.
- Korean UI. Cards keep the realistic look and use only ♠ and ♦ (suited = same suit, offsuit = one each).
- The engine (`src/poker/*`), chart data, settings/stats stores and the explanation generator stay; screens and components may be reorganized freely. React 18 + TypeScript, no new runtime dependencies (CSS/SVG only; `backdrop-filter` is fine).
- Linear position strip (no oval table) stays as the way to show seats/action.
- Hold-to-pause with explanation overlay stays in the trainer.

## What exists today (v1)
Tabs: 훈련 (auto flashcards: think → reveal → next, timer bar, hold-to-pause overlay, 해설 sheet, ◀ ▶, 새 핸드), 퀴즈 (answer buttons, accuracy/streak, 최근 실수), 차트 (13×13 grid + cell explanations), 설정 (positions, scenario kinds, timers, auto-advance, bias, mix display, haptics, resets). Dark green felt theme, system fonts.

## Gaps vs. a good flash-memory vocabulary app (fill these)
- **Decks / sessions**: a session has a size (e.g. 20 hands), a progress indicator, and an **end-of-session summary** (hands seen, new vs review, time, accuracy if rated, streak) with "한 번 더" / "헷갈린 것만 다시".
- **Speed presets** instead of raw seconds: 천천히 · 보통 · 빠르게 · 순간기억 (hand and answer nearly simultaneous, ~0.8 s cadence) and an **노출 모드** (answer shown with the hand, no think phase) for pure passive exposure.
- **Swipe rating** after reveal: swipe right = 알아요, swipe left = 헷갈려요 (or two glass buttons). Ratings feed a **spaced-repetition queue** (per scenario+hand key: interval/ease/due) so the next session leads with due/헷갈려요 cards, then new cards.
- **Daily goal + day streak + activity heatmap** (last 8–12 weeks), total exposures, learned/learning/new counts.
- **Focus decks** one tap away (chips on the trainer): 전체 · 오픈 레인지 · 오픈 대응 · 3벳 대응 · 4벳/올인 · 내 약점 (from ratings/quiz mistakes); position chips.
- **Card flip / slide animation** between think and reveal; new hand slides in. Springy but subtle; respect `prefers-reduced-motion`.
- **Weak-spot analytics** from quiz + ratings (per scenario kind and position), surfaced on a Home/Progress view and in the session summary.
- **First-run coach mark**: how hold-to-pause and swipes work.
- Microcopy: friendly, short, Toss-style plain Korean; light gamification (streak flame, level names), no cringe.

## Deliverable of the design phase
`docs/REDESIGN_SPEC.md`: information architecture (tabs/screens), visual system (tokens: colors, glass materials, radii, type scale, motion), component inventory with props, per-screen layouts (ASCII wireframes at 390 px), the training-session state machine including SRS rules and data model additions (`src/state/*`), and an implementation plan split into independent owners (files each owner may touch).
