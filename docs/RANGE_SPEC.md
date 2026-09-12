# Range chart authoring spec (Holdem Flicker)

This document defines the game model, notation and output format for preflop range charts.
Every chart in `src/poker/data/*.ts` follows it. Use it verbatim when authoring new charts.

## Game model

- **Format**: 6-max No-Limit Hold'em cash game, **100bb** effective stacks, mid-stakes online rake (≈ NL50–NL200).
- **Positions (preflop order)**: `UTG` (= LJ), `HJ`, `CO`, `BTN`, `SB`, `BB`.
- **Sizings**: open 2.5bb (SB opens 3bb; SB is raise-or-fold, no limping). 3-bet ≈ 3× in position, ≈ 4× (to ~10–11bb) from the blinds. 4-bet ≈ 2.2–2.5× (to ~22–25bb, not all-in). 5-bet = all-in. Cold 4-bet ≈ 2.2× the 3-bet.
- **Target**: approximate the widely published solver outputs (GTO Wizard 6-max 100bb NL500 / Upswing style). We favour **memorizable** simplifications: pure strategies where the solver is > 70% one action, otherwise a mixed weight.

## Scenarios (`kind`) and legal actions

| kind | Situation (hero = the player we train) | villain field | legal actions (aggressive last) |
|---|---|---|---|
| `rfi` | Folded to hero. | none | `fold`, `raise` |
| `vs_open` | villain (earlier seat) open-raised, hero to act. Everyone between folded. | opener | `fold`, `call`, `threebet` |
| `vs_3bet` | hero opened, villain (later seat) 3-bet, others folded. | 3-bettor | `fold`, `call`, `fourbet` |
| `vs_4bet` | villain opened, hero 3-bet, villain 4-bet. | opener | `fold`, `call`, `allin` (5-bet jam) |
| `vs_5bet` | hero opened, villain 3-bet, hero 4-bet, villain 5-bet all-in. | 3-bettor | `fold`, `call` |
| `cold_4bet` | an open and a 3-bet happened before hero; hero has not acted. Generic over the two villains. | none | `fold`, `call`, `fourbet` |

Valid (hero, villain) pairs: `vs_open`/`vs_4bet` need villain **before** hero; `vs_3bet`/`vs_5bet` need villain **after** hero.
`rfi` exists for UTG..SB (not BB). `cold_4bet` exists for CO, BTN, SB, BB.

Chart `id` is always `${kind}:${hero}` or `${kind}:${hero}:${villain}` (e.g. `vs_open:BTN:CO`).

## Range notation

Comma-separated tokens. Ranks `A K Q J T 9 8 7 6 5 4 3 2`; suffix `s` suited / `o` offsuit; pairs have no suffix.

| token | meaning |
|---|---|
| `AA` | one hand |
| `77+` | 77, 88, …, AA |
| `77-22` | 22 … 77 (either order) |
| `K9s+` | K9s, KTs, KJs, KQs (same high card, kicker up to one below) |
| `A5s-A2s` | A2s … A5s (same high card, either order) |
| `KQo:0.5` | weight 0.5 (mixed). Applies to the whole token, e.g. `A5s-A2s:0.25` |

A hand may appear under several actions; **weights across actions must sum to ≤ 1**. The remainder is fold.
Use only weights from `{0.25, 0.5, 0.75, 1}`. The memorization answer is the highest-weight action (ties → more aggressive).

## Anchor RFI ranges (already final — defend against these opening ranges)

```
UTG (~17.9%): 22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, 65s:0.5, AJo+, KQo, ATo:0.5, KJo:0.5
HJ  (~21.3%): 22+, A2s+, K7s+, Q9s+, J9s+, T8s+, 98s, 97s:0.5, 87s, 76s, 65s, 54s:0.5, ATo+, KJo+, QJo:0.5, KTo:0.5
CO  (~28.7%): 22+, A2s+, K4s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, 64s:0.5, A8o+, KTo+, QTo+, JTo
BTN (~44.9%): 22+, A2s+, K2s+, Q2s+, J4s+, T6s+, 96s+, 85s+, 75s+, 64s+, 53s+, A2o+, K8o+, Q9o+, J9o+, T9o
SB  (~46.5%): 22+, A2s+, K2s+, Q3s+, Q2s:0.5, J5s+, T6s+, 96s+, 85s+, 75s+, 64s+, 54s, 53s:0.5, A2o+, K7o+, K6o:0.5, Q9o+, Q8o:0.5, J9o+, J8o:0.5, T9o, T8o:0.5, 98o:0.5
```

## Typical range sizes (sanity targets, % of all 1326 combos)

- `vs_open` in position (HJ/CO/BTN): 3-bet 5–10% (wider vs later openers), call 5–14% (BTN widest; HJ vs UTG narrow). Total defend vs UTG ≈ 12–16%, vs CO ≈ 20–26%.
- `vs_open` SB: mostly 3-bet-or-fold: 3-bet 8–14% (vs BTN up to ~16%), call 0–4%.
- `vs_open` BB: 3-bet 6–15% (vs UTG ~6–8%, vs BTN/SB ~12–16%), call 25–55% (vs UTG ≈ 25–30%, vs BTN ≈ 45–55%, vs SB ≈ 50–60%).
- `vs_3bet` (hero opened): continue (call+4bet) ≈ 40–60% of the opening range. 4-bet 2.5–6% of all combos (value QQ+/AK plus A5s/A4s-type bluffs, more vs blinds), call wider in position (vs blinds) than out of position (vs IP 3-bettor).
- `vs_4bet`: continue 25–45% of the 3-bet range. 5-bet jam ≈ KK+ (QQ, AKs, AKo often mixed), call ≈ QQ–TT, AKs/AQs, some suited aces vs wider 4-bettors. Everything else folds.
- `vs_5bet`: call ≈ KK+, AKs (QQ/AKo mixed vs wide 5-bettors); fold everything else including 4-bet bluffs.
- `cold_4bet`: 4-bet ≈ KK+, AKs (QQ/AKo mixed, A5s bluff mixed), call ≈ QQ/JJ/AKo/AQs mixed at most; total continue 2–4%.

Monotonicity expectations: ranges defend **wider vs later (looser) openers**, tighter vs early openers. Blinds 3-bet more polar; in-position players 3-bet more linear. Never fold AA/KK anywhere; QQ/AK almost never fold preflop at 100bb except vs UTG/HJ 5-bets or cold 4-bets.

## Output format (authors)

Write JSON `{ "charts": ChartDef[] }`:

```json
{
  "charts": [
    {
      "id": "vs_open:BTN:CO",
      "kind": "vs_open",
      "hero": "BTN",
      "villain": "CO",
      "actions": {
        "threebet": "TT+, AJs+, AQo+, KQs, A5s-A2s:0.5, ...",
        "call": "99-22, ATs-A6s, KTs+, ..."
      },
      "summary": "한국어 1–3문장 전략 요약 (왜 이렇게 대응하는지)",
      "notes": { "A5s": "한국어 핸드별 메모 (경계·블러프·믹스 이유)", "KQo": "..." }
    }
  ]
}
```

Validate with `npx vite-node scripts/validate-charts.ts <file.json>` (prints shares; exits non-zero on hard errors).
Korean text conventions: 3벳/4벳/5벳, 오픈, 콜, 폴드, 올인, 수티드/오프수트, 블로커, 포지션, 레인지, 폴라/리니어, 셋마이닝, 임플라이드 오즈. Keep sentences short.
