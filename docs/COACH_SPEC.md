# 코치 탭 설계서 (COACH_SPEC)

퀴즈·훈련에서 낸 실수를 모아 **플레이 성향**을 진단하고, **집중할 포인트**를 개념적·현실적 조언으로 돌려주는 탭.
차트를 다시 읽어 주지 않는다 — 그건 차트 탭이 이미 한다.

> 이 문서는 독립 설계 4안을 심사·통합해 만들었습니다. 통계 설계의 근거가 되는 수치는
> 저장소의 실제 출제 로직을 시뮬레이션해 측정한 값입니다.

## 0. 요약

뼈대는 안 1(출제 편향 보정)이되, 그 치명적 결함 세 개를 실측으로 고쳐 세웠습니다. 저장소에서 4만 문제를 시뮬레이션해 확인한 사실: 기본 설정(cold_4bet 꺼짐)에서 정답의 51.3%가 fold이고, 무작위 오답자가 '공격 쪽으로 틀릴' 확률은 vs_open 0.750 / vs_3bet 0.726 / vs_4bet 0.662, 좌석별 fold-정답 비중은 BB 36.4%부터 SB 59.3%까지 벌어집니다. 따라서 안 2·3·4가 쓰는 (over−under)/(over+under)는 귀무값이 0이 아니라 +0.4~+0.8이고, 성향 없는 사람에게 '루즈합니다'를 출력합니다. 안 1의 pUp 보정은 방향을 맞게 잡지만 0<pUp<1 조건 때문에 정답이 'call'인 실수만 남아 간판 축이 사실상 안 열립니다. 이걸 **부호 검정(sign test)**으로 갈아끼웁니다 — L=3 시나리오에서 오답 선택지는 정확히 2개이고, 그중 '더 공격적인 쪽'을 골랐으면 +1, '덜 공격적인 쪽'이면 −1. 귀무 평균 0, 분산 1이 문제 구성과 무관하게 성립하고, rfi·vs_5bet(L=2, 방향 정보 없음)은 자동 제외되며, L=3 실수 전부(전체 문제의 63.6%)를 씁니다. 나머지 축은 srs 카드에 `quizSeen`/`pickSeen` 한 필드씩을 더해 **사용자가 실제로 받은 문제의 fold-정답 비중**을 정확한 기준선으로 삼습니다(시뮬레이션으로 귀무 편향 0.002 확인, 부분 정답 오염까지 제거). 자리·압박 축은 '기준선 대비 편차의 차이'라 귀무값이 구조적으로 0이므로 차트 난이도를 성향으로 오독하지 않습니다. 집중 포인트는 안 4의 실수 뭉치 방식(Σw≥6 && 서로 다른 핸드≥3, 여기에 lift≥1.5를 추가)으로 뽑고, 문구는 안 2의 3단 계약(제목 → 내 기록 → 생각 절차 → 질문 하나)에 안 4의 lintCoachText 게이트를 걸어 강제합니다. AI는 로컬 규칙(L0) → 프롬프트 복사(L1) → 내 키 직접 호출(L2) 3단이고 셋 다 같은 CoachDigest 하나만 먹습니다. 착수 전 저장소 수정 세 줄(quizSeen/pickSeen, allCards(), 훈련 탭 오답도 recordMistake)이 네 안 공통 최대 리스크인 '훈련만 하는 사용자는 코치 탭이 영원히 빈다'를 함께 해소합니다.

## 1. 성향 축

네 축 모두 **귀무값이 0**이 되도록 설계했다. 출제 풀은 정답의 절반 이상이 폴드이고 `interestingBias`가
비폴드 패를 더 자주 뽑으므로, 단순 비율 `(over−under)/(over+under)`을 쓰면 성향이 없는 사람에게도
"루즈합니다"가 나온다. 그건 잡음이 아니라 **계산 가능한 거짓말**이라 축마다 기준선을 따로 잡았다.

### `aggression` — 수동 ↔ 공격

- 양극: **콜·폴드 쪽으로 샌다** ↔ **레이즈·3벳 쪽으로 샌다**
- 최소 표본: 12
- 왜 중요한가: 들어가기로 정한 다음이 문제입니다. 콜만 하는 버릇과 아무 때나 올리는 버릇은 고치는 방법이 정반대예요. 어느 쪽인지 정해야 다음 판 결정이 반으로 줄어듭니다.

```
부호 검정. 기준선 보정이 필요 없는 유일한 축이다.

공통 정의
  ACTS(k) = SCENARIO_ACTIONS[k]  (types.ts:67, 공격성 오름차순 — 코드로 확인함)
  L(k) = ACTS(k).length          (rfi 2, vs_5bet 2, 나머지 전부 3)
  rank(k,a) = ACTS(k).indexOf(a)
  kindOf(m) = m.scenarioId.split(':')[0],  heroOf(m) = m.scenarioId.split(':')[1]
  keyOf(m)  = `${m.scenarioId}|${m.hand}`   // cardKeyOf 포맷과 동일
  pure(key) : s = stepForKey(key); s !== null && !s.mixList.some(x => x.action !== s.answer && x.weight >= 0.4)
              (부분 정답이 가능한 문제를 양쪽에서 빼서 grade.ts:21의 partial 처리로 생기는 편향을 없앤다. cardKey별 Map 메모)
  M = stats.mistakes.filter(m => pure(keyOf(m)))   // 분석 집합. src가 'quiz'든 'train'이든 전부 포함

축 계산
  U = M.filter(m => L(kindOf(m)) === 3)
  wrongOf(m) = ACTS(kindOf(m)).filter(a => a !== m.answer)          // L=3이면 정확히 2개
  u(m) = rank(kindOf(m), m.chosen) === Math.max(...wrongOf(m).map(a => rank(kindOf(m), a))) ? +1 : -1
  n = U.length;  S = Σ u(m);  t = S / n  (−1..+1, 마커 위치);  z = S / Math.sqrt(n)

왜 편향이 없나: 오답 선택지가 정확히 둘이고 u는 그 둘 중 어느 쪽인지만 보므로, '무작위로 틀리는 사람'은 정답이 fold든 call든 3벳이든 E[u]=0, Var[u]=1이다. 출제 분포·interestingBias·약점 덱 편향이 전부 상쇄된다. L=2(rfi, vs_5bet)는 오답 선택지가 하나뿐이라 방향 정보가 없고 자동 제외된다 — 이게 옳다.

실측 검증(합성 플레이어 150회 × 600문제): 중립 플레이어 평균 t = −0.012, 소극 플레이어(upBias .15) t = −0.64 z = −15.0, 공격 플레이어(upBias .85) t = +0.68 z = +16.3. 루즈/타이트 플레이어는 t ≈ 0 (2번 축과 직교).
```

### `entry` — 타이트 ↔ 루즈

- 양극: **접어야 할 자리는 잘 접는다** ↔ **접어야 할 자리에 들어간다**
- 최소 표본: 20
- 왜 중요한가: 프리플랍에서 가장 비싼 실수는 들어가지 말았어야 할 판에 들어간 것입니다. 이 축 하나가 나머지 실수의 절반을 만듭니다.

```
내 실수가 '접었어야 할 문제'에 몰렸는지를, 내가 실제로 받은 문제의 fold-정답 비중과 비교한다.

  seen = allCards().filter(c => (c.quizSeen + c.pickSeen) > 0 && pure(c.key))
  w(c) = c.quizSeen + c.pickSeen          // 그 카드로 실제로 답을 낸 횟수(정확값, 상한 없음)
  N    = Σ_{c ∈ seen} w(c)
  b    = Σ_{c ∈ seen, c.answer === 'fold'} w(c) / N          // 기준선: 받은 문제 중 정답이 폴드인 비율
  q    = |{ m ∈ M : m.answer === 'fold' }| / |M|
  t    = clamp((q − b) / Math.max(b, 1 − b), −1, +1)
  z    = (q − b) / Math.sqrt(b * (1 − b) / |M|)
  z > 0 = 루즈(들어가면 안 되는 자리에 들어간다), z < 0 = 타이트(들어가야 할 자리를 접는다)

왜 quizSeen/pickSeen이 필요한가: 시뮬레이션상 기본 설정의 fold-정답 비중은 51.3%지만 좌석·덱·kinds 설정에 따라 36%~60%로 움직인다. 전역 상수를 쓰면 설정만 바꿔도 진단 부호가 뒤집힌다. srs의 exposures는 훈련 노출(답을 안 낸 것 포함)까지 섞여 있어 분모로 못 쓴다. quizSeen(퀴즈 1문제 = +1)과 pickSeen(훈련에서 선택 버튼을 실제로 누른 것 = +1)만이 실수와 같은 모집단이다.

실측 검증: 중립 플레이어 평균 (q − b) = +0.0025 (pure 필터 없으면 +0.021 — 부분 정답 오염). 루즈 플레이어 q=0.84 vs b=0.49 → z=+19.6, 타이트 플레이어 q=0.18 → z=−19.2.
```

### `seat` — 뒷자리에서 좁다 ↔ 앞자리에서 넓다

- 양극: **앞자리(UTG·HJ)에서 넓다** ↔ **뒷자리(CO·BTN)에서 좁다**
- 최소 표본: 12
- 왜 중요한가: 같은 패라도 UTG와 BTN에서 값이 다릅니다. 자리를 안 보고 패만 보고 있으면 여기서 가장 조용히, 가장 많이 샙니다.

```
좌석 그룹마다 entry 축과 똑같은 편차 Δ를 따로 구해 그 차이를 본다. Δ 각각의 귀무값이 0이므로 차이의 귀무값도 0이다 — 좌석별 차트 난이도 차이(BB 36.4% vs SB 59.3%)에 오염되지 않는다.

  EARLY = ['UTG','HJ'],  LATE = ['CO','BTN']        // SB·BB는 이 축에서 완전히 제외
  그룹 g에 대해
    M_g    = M.filter(m => g.includes(heroOf(m)))
    seen_g = seen.filter(c => g.includes(c.hero))
    b_g    = Σ_{c ∈ seen_g, c.answer === 'fold'} w(c) / Σ_{c ∈ seen_g} w(c)
    q_g    = |{ m ∈ M_g : m.answer === 'fold' }| / |M_g|
    Δ_g    = q_g − b_g
  t = clamp((Δ_EARLY − Δ_LATE) / 0.5, −1, +1)
  z = (Δ_EARLY − Δ_LATE) / Math.sqrt( b_E(1−b_E)/|M_E| + b_L(1−b_L)/|M_L| )
  z > 0 = 앞자리에서 헐겁다, z < 0 = 뒷자리에서 레인지를 못 넓힌다

심사위원이 지적한 안 1의 치명적 결함(합동비율 z가 귀무 d=0을 가정하는데 실측 귀무는 −0.13)을 이 구조가 정확히 해소한다. SB·BB를 한쪽 극에 묶지 않는 것도 의도적이다 — BB는 rfi 자체가 없고(scenarios.ts allScenarios) 수비 자리라 BTN과 성격이 정반대다. 블라인드는 축이 아니라 패턴 규칙(bb_too_wide / bb_too_tight)으로만 다룬다.

실측 검증: 중립 플레이어 평균 (Δ_E − Δ_L) = +0.002.
```

### `pressure` — 압박에 접는다 ↔ 압박에 못 접는다

- 양극: **3벳·4벳을 맞으면 너무 접는다** ↔ **3벳·4벳을 맞고도 못 접는다**
- 최소 표본: 12
- 왜 중요한가: 3벳·4벳이 오면 팟이 커집니다. 여기서 한 번 잘못 접거나 잘못 콜하면 오픈 실수 열 번보다 손해가 큽니다.

```
seat 축과 같은 구조. 상황 그룹별 Δ를 구해 차이를 본다. 정답률을 비교하지 않는 것이 핵심 — rfi는 2지선다(찍기 50%), vs_open은 3지선다(33%), cold_4bet은 97%가 fold라 '항상 폴드'만 해도 고득점이므로 정답률 비교는 차트 구성을 재는 것이지 성향을 재는 게 아니다.

  OPEN = ['rfi','vs_open'],  HEAT = ['vs_3bet','vs_4bet','vs_5bet','cold_4bet']
  그룹 g(=kind 집합)에 대해 seat 축과 동일하게 b_g, q_g, Δ_g 계산 (필터만 kindOf(m) ∈ g / c.kind ∈ g)
  t = clamp((Δ_HEAT − Δ_OPEN) / 0.5, −1, +1)
  z = (Δ_HEAT − Δ_OPEN) / Math.sqrt( b_H(1−b_H)/|M_H| + b_O(1−b_O)/|M_O| )
  t > 0 = 큰 팟에서 못 접는다(정답이 폴드인 문제에서 실수가 몰린다), t < 0 = 큰 팟에서 너무 접는다

주의: kinds 기본값에 cold_4bet이 없다(settings.ts DEFAULT_SETTINGS.kinds). 그래서 HEAT 표본은 대개 vs_3bet 중심이고, cold_4bet이 켜져 있으면 b_H가 0.97 근처로 올라가는데 b가 분모에 들어가므로 자동 보정된다.
```

## 2. 실수 패턴 규칙

실수 뭉치가 `count ≥ minSample && distinctHands ≥ 3 && lift ≥ 1.5`를 넘을 때만 카드가 된다.
같은 패 한 장을 세 번 틀린 것은 패턴이 아니다.

### `call_not_raise` — 3벳할 자리에서 콜합니다  (n ≥ 6)

조건: C4 뭉치 `answer→chosen`. m.answer === 'threebet' && m.chosen === 'call'. lift 분모: Σ_{c ∈ seen, c.answer==='threebet'} w(c) / N × 1/(L−1).

조언:

> 3벳과 콜은 같은 패로 완전히 다른 판을 만듭니다. 콜하면 주도권이 상대에게 넘어가요. 들어가기로 정했으면 순서를 이렇게 보세요. 첫째, 이 패가 내 오픈 레인지 위쪽인가. 둘째, 상대가 4벳으로 올 때 접을 수 있나. 둘 다 예면 3벳입니다. 지금 콜하려는 이 패, 3벳으로 갔을 때 뭐가 무서운가요?

훈련: `launch({ target:'quiz', onlyKeys: 뭉치 카드키 최대 12개, autostart:true }) — 12개 미만이면 launch({ target:'train', deck:'vs_open', positions:[대표 hero], autostart:true })`

### `enter_by_calling` — 접어야 할 자리에 콜로 들어갑니다  (n ≥ 6)

조건: C4 + kind 필터. kindOf(m) === 'vs_open' && m.answer === 'fold' && m.chosen === 'call'. lift 분모: vs_open의 fold-정답 trial 비중 × 1/2.

조언:

> 콜은 가장 조용하게 돈이 새는 선택입니다. 접을 패를 3벳으로 갈 일은 거의 없지만 콜로는 계속 들어가게 돼요. 액션을 고르기 전에 순서를 바꿔 보세요. 먼저 폴드인지 아닌지만 정하고, 폴드가 아닐 때만 콜과 3벳 중에 고르세요. 이 패로 플랍에서 뭘 할 생각이었나요?

훈련: `launch({ target:'train', deck:'vs_open', positions:[뭉치 상위 hero 1개], autostart:true })`

### `fold_to_3bet` — 3벳을 맞으면 거의 다 접습니다  (n ≥ 6)

조건: C1 뭉치 `kind|dir`. kindOf(m) === 'vs_3bet' && m.chosen === 'fold' && m.answer !== 'fold'. lift 분모: vs_3bet의 비폴드-정답 trial 비중 × 1/2.

조언:

> 상대도 블러프로 3벳합니다. 다 접으면 그걸 그대로 내주는 거예요. 3벳을 맞았을 때 이렇게 생각하세요. 내가 이 자리에서 오픈하는 패들을 센 순서로 줄 세운다. 맨 위 몇 개는 4벳, 그 아래 몇 개는 콜로 남긴다. 나머지만 접는다. 지금 접으려는 이 패는 그 줄에서 어디쯤인가요?

훈련: `launch({ target:'train', deck:'vs_3bet', positions:[뭉치 상위 hero 1개], autostart:true })`

### `stubborn_vs_4bet` — 4벳을 맞고도 못 접습니다  (n ≥ 6)

조건: C1 뭉치. kindOf(m) ∈ {'vs_4bet','vs_5bet'} && m.answer === 'fold' && m.chosen !== 'fold'. lift 분모: 해당 kind의 fold-정답 trial 비중 × 1(L=2) 또는 ×1(두 오답 모두 비폴드).

조언:

> 4벳은 블러프가 훨씬 적습니다. 여기서 한 번 잘못 가면 스택이 통째로 나가요. 3벳을 누르기 전에 미리 정해 두세요. 이 패는 4벳이 오면 접을 패인지, 올인까지 갈 패인지. 미리 정하지 않고 4벳을 맞으면 거의 항상 잘못 갑니다. 지금 이 패, 3벳할 때 이미 정해 뒀나요?

훈련: `launch({ target:'train', deck:'vs_4bet_allin', positions:[뭉치 상위 hero 1개], autostart:true })`

### `early_seat_wide` — 앞자리에서 손이 헐겁습니다  (n ≥ 6)

조건: C2 뭉치 `hero|dir`. heroOf(m) ∈ {'UTG','HJ'} && m.answer === 'fold' && m.chosen !== 'fold'. lift 분모: 그 좌석들의 fold-정답 trial 비중.

조언:

> UTG에서는 뒤에 다섯 명이 남아 있습니다. 그중 한 명만 더 센 패를 들면 됩니다. 앞자리에서는 패를 보기 전에 기준을 먼저 세우세요. 페어인가, 두 장 다 높은가, 수티드인가. 셋 중 두 개는 되어야 엽니다. 지금 이 패, 뒤에 다섯 명이 있어도 열 건가요?

훈련: `launch({ target:'train', deck:'rfi', positions:['UTG','HJ'], autostart:true })`

### `late_seat_tight` — 뒷자리에서 너무 좁게 칩니다  (n ≥ 6)

조건: C2 뭉치. heroOf(m) ∈ {'CO','BTN'} && m.answer !== 'fold' && m.chosen === 'fold'. lift 분모: 그 좌석들의 비폴드-정답 trial 비중 × 1/(L−1).

조언:

> 버튼 뒤에는 블라인드 두 명뿐입니다. 앞자리와 같은 기준을 쓰면 매번 손해예요. 자리가 뒤로 갈수록 기준을 한 칸씩 내리세요. 앞자리에서 접던 수티드 커넥터와 작은 페어부터 넣으면 됩니다. 이 패를 UTG라고 생각하고 접은 건 아닌가요?

훈련: `launch({ target:'train', deck:'rfi', positions:['CO','BTN'], autostart:true })`

### `bb_too_wide` — BB를 너무 넓게 지킵니다  (n ≥ 6)

조건: C2 뭉치. heroOf(m) === 'BB' && kindOf(m) === 'vs_open' && m.answer === 'fold' && m.chosen !== 'fold'. lift 분모: BB vs_open의 fold-정답 trial 비중(실측 36.4%, 전 좌석 중 가장 낮다 — 그래서 기준선 보정이 특히 중요하다).

조언:

> 이미 깐 블라인드는 팟에 살아 있는 돈이라 콜 가격은 원래 좋습니다. BB를 접어야 하는 이유는 가격이 아니라 포지션이에요. 플랍부터 리버까지 내가 먼저 액션해야 하니 이겨도 다 못 받아냅니다. 콜하기 전에 한 번 물어보세요. 이 패로 플랍에서 뭘 할 건가요?

훈련: `launch({ target:'train', deck:'vs_open', positions:['BB'], autostart:true })`

### `bb_too_tight` — BB를 너무 쉽게 버립니다  (n ≥ 6)

조건: C2 뭉치. heroOf(m) === 'BB' && kindOf(m) === 'vs_open' && m.answer !== 'fold' && m.chosen === 'fold'. lift 분모: BB vs_open의 비폴드-정답 trial 비중 × 1/2.

조언:

> BB는 이미 낸 돈이 있어서 남들보다 싸게 볼 수 있습니다. 전 좌석 중에 가장 넓게 지키는 자리예요. 상대가 어느 자리에서 열었는지부터 보세요. BTN·CO 오픈은 넓으니 더 넓게 지키고, UTG 오픈에만 좁히면 됩니다. 이 패, 상대가 BTN에서 열었어도 접을 건가요?

훈련: `launch({ target:'train', deck:'vs_open', positions:['BB'], autostart:true })`

### `offsuit_ace_trap` — 오프수트 A를 너무 믿습니다  (n ≥ 6)

조건: C3 뭉치 `handClass|dir`. classifyHand(m.hand) === 'offsuit_ace' && m.answer === 'fold' && m.chosen !== 'fold'. lift 분모: offsuit_ace 카드의 fold-정답 trial 비중(실측 이 클래스는 전체 trial의 7.7%, fold-정답 77%).

조언:

> A가 한 장 있으면 세 보이지만, 킥커가 약하면 A가 깔리는 순간이 가장 위험합니다. 맞고도 지는 패예요. A를 봤을 때 킥커부터 보세요. 킥커가 T 아래면 오프수트로는 앞자리에서 버리는 패입니다. 이 A, 상대도 A를 들었을 때 이길 수 있나요?

훈련: `launch({ target:'quiz', onlyKeys: 뭉치 카드키 최대 12개, autostart:true })`

### `suited_trap` — 수티드면 일단 들어갑니다  (n ≥ 6)

조건: C3 뭉치. classifyHand(m.hand) ∈ {'suited_gapper','suited_qj','suited_king','suited_connector','wheel_ace'} && m.answer === 'fold' && m.chosen !== 'fold'.

조언:

> 같은 무늬는 플러시까지 아직 멉니다. 무늬만으로 들어갈 만큼 크지 않아요. 순서를 바꾸세요. 두 장이 높은지, 이어져 있는지를 먼저 보고 무늬는 마지막에 더하는 보너스로 두세요. 이 패, 무늬가 달랐어도 들어갔을까요?

훈련: `launch({ target:'quiz', onlyKeys: 뭉치 카드키 최대 12개, autostart:true })`

### `premium_underplay` — 센 패를 너무 얌전하게 씁니다  (n ≥ 6)

조건: C3 뭉치. classifyHand(m.hand) ∈ {'premium_pair','big_pair','ak'} && rank(kindOf(m), m.chosen) < rank(kindOf(m), m.answer).

조언:

> 센 패로 조용히 가면 팟이 안 커집니다. 이길 판에서 적게 버는 게 질 판에서 잃는 것만큼 아파요. 센 패를 잡으면 먼저 물어보세요. 이 패로 스택을 다 넣어도 되는 자리인가. 답이 예면 지금부터 올려서 팟을 키우세요. 지금 콜한 이 패, 뭘 기다리고 있었나요?

훈련: `launch({ target:'quiz', onlyKeys: 뭉치 카드키 최대 12개, autostart:true })`

### `seat_hotspot` — 이 자리에서 유독 많이 틀립니다  (n ≥ 5)

조건: 보루 규칙. 한 (kind, hero) 버킷이 |M|의 25% 이상이고 개수 ≥ 5. lift 게이트를 걸지 않는다 — 방향 주장을 하지 않고 '여기에 몰려 있다'는 셀 수 있는 사실만 말하기 때문이다. 다른 규칙이 하나도 통과하지 못했을 때만 낸다.

조언:

> 실수가 한 자리에 몰려 있습니다. 방향이 정해지진 않았지만 여기부터 보면 됩니다. 이 상황만 모아서 한 번 돌려 보세요. 열 문제만 풀어도 어느 쪽으로 새는지 보입니다.

훈련: `launch({ target:'train', deck: deckForKind(kind), positions:[hero], autostart:true })`

## 3. 다이제스트 / 카드 스키마

```ts
// /home/user/holdem-flicker/src/state/coach/types.ts
import type { Action, Pos, ScenarioKind } from '../../poker/types';
import type { HandClass } from '../../poker/explain';
import type { DeckId } from '../nav';

/** 세 AI 경로(localCoach / buildPrompt / askClaude)가 공유하는 단 하나의 입력. 개인정보 없음 — 손패와 액션뿐. */
export interface CoachDigest {
  v: 1;
  at: number;
  /** 이 다이제스트를 만든 재료의 지문. AI 응답 캐시 키이자 dayKey 메모 키. */
  hash: string;

  volume: {
    /** stats.total / stats.totalCorrect (퀴즈 누적) */
    quizTotal: number;
    quizCorrect: number;
    /** Σ (c.quizSeen + c.pickSeen) — 답을 실제로 낸 총 횟수. 축의 분모. */
    trials: number;
    /** stats.mistakes 전체 길이 */
    mistakesStored: number;
    /** pure() 통과 후 분석에 실제로 쓰인 실수 수 = |M| */
    mistakesUsed: number;
    /** M 중 src === 'train' 비율 (0..1). 훈련 탭이 얼마나 기여했는지. */
    trainShare: number;
    srsCards: number;
    streak: number;
    bestStreak: number;
  };

  byKind: Array<{ kind: ScenarioKind; trials: number; mistakes: number; foldAnswerShare: number }>;
  byHero: Array<{ hero: Pos; trials: number; mistakes: number; foldAnswerShare: number }>;

  axes: Array<{
    id: 'aggression' | 'entry' | 'seat' | 'pressure';
    /** 표본 미달이면 null — 이때 sample/need만 의미가 있다. */
    t: number | null;          // −1..+1 마커 위치
    z: number | null;
    sample: number;            // 이 축이 실제로 쓴 표본 수
    need: number;              // minSample − sample, 0 이하면 해금
    unlocked: boolean;
    /** 'confident'(|z|≥2.2 && |t|≥0.25) | 'leaning'(|z|≥1.2) | 'flat' | 'locked' */
    level: 'confident' | 'leaning' | 'flat' | 'locked';
    /** 해금됐을 때만. poles 중 t 부호에 해당하는 한국어 극 라벨. */
    pole: string | null;
    /** 화면 전체에서 단 하나의 축만 true (|z| 최대이면서 level === 'confident'). */
    headline: boolean;
  }>;

  patterns: Array<{
    id: string;                // patternRules의 id
    koName: string;
    count: number;             // 이 뭉치에 속한 실수 개수(가중 없는 실제 횟수 — 카드 문구에 그대로 쓴다)
    recent7d: number;
    distinctHands: number;
    lift: number;              // count/|M| ÷ 기대 비중
    score: number;             // Σw × lift 보정, 정렬용
    kind?: ScenarioKind;
    hero?: Pos;
    handClass?: HandClass;
    from?: Action;             // answer
    to?: Action;               // chosen
    examples: string[];        // 손패 이름 최대 3개 ("AJo","KTs","A8o")
    keys: string[];            // CardKey, 최대 12
    drill: { target: 'train' | 'quiz'; deck?: DeckId; positions?: Pos[]; scenarioId?: string; onlyKeys?: string[] };
  }>;

  /** 칭찬 한 줄의 재료. trials ≥ 15인 kind 중 정답률 최고. 없으면 null. */
  good: { kind: ScenarioKind; trials: number; acc: number } | null;

  /** srs.weakSpots(3) 그대로. 실수와 다른 모집단(스와이프 평가)이므로 축에는 쓰지 않고 목록으로만 보여 준다. */
  weakSpots: Array<{ kind: ScenarioKind; hero: Pos; unsureRate: number; rated: number; quizAcc?: number }>;

  recentMistakes: Array<{
    hand: string; handClass: HandClass; kind: ScenarioKind; hero: Pos; villain?: Pos;
    ip: boolean;               // heroInPosition(hero, villain), villain 없으면 false
    answer: Action; chosen: Action; daysAgo: number; src: 'quiz' | 'train';
  }>; // 최대 20
}

/** 세 경로가 모두 뱉는 유일한 출력. 규칙 카드든 AI 카드든 같은 렌더러를 탄다. */
export interface CoachCard {
  id: string;
  tone: 'good' | 'tendency' | 'focus';
  /** ≤ 20자, 결론 한 줄 */
  title: string;
  /** 내 기록 한 줄. 반드시 내 통계여야 한다. ≤ 30자 */
  evidence: string;
  /** 생각 절차 2~3줄, 각 ≤ 25자. 마지막 줄은 질문으로 끝낸다. */
  steps: string[];
  drill?: CoachDigest['patterns'][number]['drill'];
  src: 'rule' | 'ai';
}
```

## 4. AI 경로

세 경로가 **CoachDigest 하나만** 먹고 **CoachCard[] 하나만** 뱉는다. 비중은 규칙 70 / 복사 25 / 내 키 5로 잡는다.

**L0 — 로컬 규칙 코치 (기본값, 전원, 필수)**
`buildDigest()` → `localCoach(digest)`가 axes + patterns를 copy.ts의 한국어 템플릿에 넣어 CoachCard[]를 만든다. 네트워크 0, 비용 0, 지연 0, 오프라인 동작. 코치 탭 본문은 **항상** L0이다. AI가 전부 죽어도 화면이 완성되어 있다. 결과는 `dayKey() + digest.hash`로 메모이즈한다 — 스크롤할 때마다 조언이 바뀌면 신뢰를 잃는다.

**L1 — 프롬프트 복사 (키 없는 사용자의 실질적 AI 경로, 가장 중요)**
[AI에게 물어보기] → Sheet. `buildPrompt(digest)`가 **사람이 읽어도 말이 되는 한국어 요약문**을 만든다(JSON 덩어리를 붙이면 AI가 수치 나열로 답한다). 내용: 시스템 규칙 전문 + 내 성향 한 문단 + kind×hero 정답률 표 + 최근 실수 20건 표. `navigator.clipboard.writeText`, 실패 시 읽기 전용 textarea + `select()` 폴백. 버튼 아래 작은 링크 [Claude 열기](claude.ai) [ChatGPT 열기](chatgpt.com), `target="_blank" rel="noopener"`. 계정만 있으면 되고 결제가 필요 없다 — 한국 10~20대에게 실제로 굴러가는 유일한 경로다. 돌아온 답을 앱에 다시 넣는 왕복은 **강요하지 않는다**. 대신 접힌 disclosure로 "AI 답을 여기 붙여넣기" textarea를 하나 두고, 붙여넣으면 parse + lint 후 같은 CoachCardView로 렌더한다(선택 사항, P2로 미뤄도 됨).

**L2 — 내 키로 브라우저 직접 호출 (소수, 설정 안쪽)**
설정 → 코치 → "Claude API 키". 코치 탭에서는 "API 키가 있다면 바로 받기" 한 줄 링크로만 노출한다.
- SDK: `@anthropic-ai/sdk`를 **동적 import**로 부른다 — `const { default: Anthropic } = await import('@anthropic-ai/sdk')`. Vite가 자동으로 별도 청크로 쪼개므로 이 기능을 안 쓰는 95%의 사용자에게 번들 비용이 0이다. `new Anthropic({ apiKey, dangerouslyAllowBrowser: true })` (SDK가 `anthropic-dangerous-direct-browser-access: true` 헤더를 붙인다; 이 헤더 없이는 CORS에서 막힌다).
- 요청: `model` 기본 `claude-opus-5`, 설정에서 `claude-haiku-4-5`로 내릴 수 있다(사용자 돈이므로 선택권을 준다). `max_tokens: 1400` — 길게 주면 수치 나열로 흐른다. 비스트리밍(이 크기면 타임아웃 위험 없음). `thinking`은 **보내지 않는다**(Opus 5는 기본이 adaptive이고 `budget_tokens`는 400). `output_config: { effort: 'low' }`는 **opus-5일 때만** 보낸다 — Haiku 4.5는 `effort`에서 에러가 난다. 판단은 이미 로컬에서 끝났고 AI는 말로 푸는 역할이므로 low가 맞다.
- 출력 형식: 프롬프트로 JSON 배열을 요구하고 `JSON.parse`를 try/catch로 감싼다. 구조화 출력으로 올릴 거면 `output_config.format`(json_schema)을 쓰되 shape는 구현 시점의 SDK 타입으로 확인한다(`output_format`은 폐기됨).
- 게이트: 마지막 호출 이후 새 실수 10개 이상 또는 하루 1회. 응답은 `digest.hash`를 키로 localStorage에 캐시해 탭을 열 때마다 과금되지 않게 한다.
- 에러: `Anthropic.AuthenticationError` → "키가 맞지 않아요", `RateLimitError` → "잠시 뒤에 다시 해 주세요", 그 외 → "지금은 못 받았어요". 어느 경우든 L0 화면은 그대로 남는다.
- 키 저장: `localStorage['holdem-flicker.coach.v1']` 평문. 입력 화면에 "공용 PC에서는 넣지 마세요. 키가 이 브라우저에 그대로 저장됩니다."를 --coral로 고정 노출하고 [키 지우기] 버튼을 옆에 둔다. 화면에는 끝 4자만 보인다. 기본 꺼짐.

**공통 안전장치 — lintCoachText()**
L0 템플릿 카드와 AI 카드에 **똑같이** 건다. 하나라도 걸리면 그 카드를 버린다.
- 금지어 `/GTO|솔버|solver|EV|에퀴티|폴드\s?에퀴티|빈도|폴라|양극화|리니어|밸런스|MDF|콤보|노드|시뮬|레인지의?\s?\d/`
- 퍼센트는 기본 금지. 예외 화이트리스트 2개뿐 — 내 기록(evidence 필드 안), PLAIN_KO_STYLE §3이 명시한 확률(셋 12%, AK vs KK 30%, AK vs QQ 43%, QQ vs AK 57%).
- 레인지 표기 차단 `/[AKQJT2-9][AKQJT2-9][so]?\+/` , 한 카드에 손패 이름 3개 이상이면 버린다.
- **핸드 단위 단정 금지** — 템플릿에는 "AJo는 UTG에서 폴드입니다" 같은 문장을 아예 쓰지 않는다(rfi.ts의 UTG 레인지에 `AJo+`가 들어 있어 앱 차트와 정면으로 어긋난다). 기준은 항상 클래스 단위(오프수트 A, 수티드 커넥터)로만 말한다.
- 100bb 고정 앱이므로 "스택이 깊으면/얕으면" 같은 존재하지 않는 변수 금지 `/스택이\s?(깊|얕)/`.
- 린트 통과 카드가 2장 미만이면 AI 답을 통째로 버리고 L0 카드로 되돌린 뒤 토스트 "AI 답변이 너무 어려워서 걸렀어요".

## 5. 시스템 프롬프트

```
너는 한국어로 말하는 홀덤 프리플랍 코치다. 상대는 포커를 막 시작한 중고등학생·대학생이다.

아래는 이 사람이 6-max 100bb 프리플랍 퀴즈에서 낸 오답 기록과, 그 기록을 통계로 정리한 성향 수치다. 수치는 이미 출제 편향이 보정되어 있으니 그대로 믿어도 된다.

## 네가 할 일
차트를 다시 읽어 주지 마라. "이 패는 이 자리에서 폴드입니다" 같은 말은 앱이 이미 하고 있다. 너는 **어떻게 생각하면 되는지**와 **다음 판에 뭘 바꾸면 되는지**를 알려 준다.

## 절대 쓰지 말 것
- GTO, 솔버, EV, 에퀴티, 폴드 에퀴티, 빈도, 폴라, 양극화, 리니어, 밸런스, MDF, 콤보, 노드
- 레인지 퍼센트("상위 18%", "48% 레인지"), 혼합 빈도("30/70으로 믹스")
- 레인지 표기(ATo+, KJs+ 같은 것)
- 손패 이름은 한 카드에 2개까지만
- 퍼센트는 아래 둘만 허용한다: (1) 내 기록 줄에 들어가는 내 정답률·횟수, (2) 셋 확률 12%, AK vs KK 30%, AK vs QQ 43%
- 스택 깊이 이야기(이 앱은 100bb 고정이다)
- 느낌표, 이모지

## 그대로 써도 되는 말
폴드 · 콜 · 레이즈 · 오픈 · 3벳 · 4벳 · 5벳 · 올인 · 블러프 · 페어 · 포켓페어 · 셋 · 킥커 · 드로우 · 플랍 · 턴 · 리버 · 포지션 · 블라인드 · 팟 · 스택 · 레인지 · 수티드 · 오프수트 · 커넥터 · 브로드웨이 · UTG · HJ · CO · BTN · SB · BB

## 문장 규칙
- 한 문장 = 한 가지. 25자 안팎. 접속사로 잇지 말고 끊어라.
- 결론부터. 어미는 "~하세요 / ~예요 / ~입니다"만.
- 사람을 평가하지 마라. "당신은 도박사예요" 같은 말 금지. 행동만 말해라. "문제를 풀 때 이렇게 기웁니다".
- 데이터에 없는 건 지어내지 마라. 표본이 적으면 적다고 말해라.

## 출력 형식
JSON 배열 **하나만** 출력해라. 설명도, 코드 펜스도, 앞뒤 인사도 붙이지 마라.

```
[
  { "tone": "good",  "title": "...", "evidence": "...", "steps": ["...", "..."] },
  { "tone": "focus", "title": "...", "evidence": "...", "steps": ["...", "...", "..."] },
  ...
]
```

- 배열 길이는 정확히 4다. 첫 번째는 반드시 `tone: "good"`(잘하고 있는 것 한 줄), 나머지 3개는 `tone: "focus"`.
- `title` — 무엇이 새는지. 20자 이내. 단정문.
- `evidence` — 내 기록 한 줄. 30자 이내. 반드시 아래 데이터에 있는 숫자여야 한다. 예: "3벳 자리 실수 34개 중 22개가 콜이었어요".
- `steps` — 생각 절차 2~3줄. 각 25자 이내. 액션 지시로 끝내지 말고 **마지막 줄은 질문 하나로** 끝내라. 질문은 다음 판에 스스로 던질 수 있는 것이어야 한다.

## 나쁜 예 / 좋은 예
- 나쁜 예 title: "BTN RFI는 48% 레인지입니다"
- 좋은 예 title: "뒷자리에서 너무 좁게 칩니다"
- 나쁜 예 steps: ["AJo는 UTG에서 폴드입니다"]
- 좋은 예 steps: ["버튼 뒤에는 블라인드 두 명뿐이에요", "자리가 뒤로 갈수록 기준을 한 칸 내리세요", "이 패를 UTG라고 생각하고 접은 건 아닌가요?"]

---

# 이 사람의 기록

{여기에 buildPrompt(digest)가 만든 한국어 요약문이 들어간다 — 표본 크기, 해금된 성향 축과 그 방향, kind×hero 정답률 표, 실수 뭉치 상위 5개와 횟수, 최근 실수 20건(핸드 / 상황 / 정답 / 내 선택 / 며칠 전)}
```

## 6. 화면

1. 헤더 — .screen 안. h1 .screen__title "코치", 그 아래 .screen__sub "퀴즈·훈련에서 낸 실수 42개를 봤어요". 기간 필터·SegmentedControl 없음(stats.byKind에 타임스탬프가 없어 화면의 절반만 필터되므로 만들지 않는다 — 최신성은 랭킹 가중 w=최근 7일 ×2로만 반영한다).

2. 한 줄 요약 — GlassPanel variant="strong" radius="lg" padding=20. 큰 글씨(t-title-2) 한 문장: headline 축이 있으면 그 축의 pole 문장("3벳 자리에서 콜로 샙니다"), 없으면 "아직 한쪽으로 치우치지 않았어요". 그 아래 --ink-3 fs-footnote 각주 두 줄: "퀴즈·훈련에서 문제를 풀 때의 성향입니다" / "실수 42개 기준". headline은 화면 전체에서 **최대 1개**(|z| 최대이면서 |z|≥2.2 && |t|≥0.25) — 다중비교로 거짓 단정이 쌓이는 것을 구조로 막는다.

3. 잘하고 있는 것 — GlassPanel variant="tint" tint="var(--mint)" radius="md" padding=12. 한 줄: "4벳 대응은 잘하고 있어요 · 정답률 78%". digest.good이 null이면 이 섹션 자체를 렌더하지 않는다. 지적보다 먼저 온다.

4. 내 성향 — h2 .t-title-3 "내 성향". GlassPanel className="glass-flat" radius="lg" padding=16 안에 TendencyAxisRow 4줄(gap 14). 한 줄 = 위에 koLabel(fs-caption, --ink-3) / 가운데 트랙(높이 6, r-capsule, 배경 --heat-0, 중앙에 1px --ink-4 눈금) / 양 끝에 poles 라벨(fs-caption, --ink-3, 360px에서 2줄이 되면 트랙 위·아래로 접는다). 마커는 지름 14 원, left: calc(50% + var(--t) * 46%). 색은 level에 따라 confident=--amber, leaning=--sky, flat=--ink-3. 줄 아래 tnum 각주 "실수 26개 기준". 잠긴 축은 지우지 않고 회색 트랙(opacity .35, 마커 없음) + 우측에 "실수 8개 더". 레이더 차트는 쓰지 않는다 — 양극 축에서는 '중립'과 '데이터 없음'이 같은 모양이 된다.

5. 성향 근거 Sheet — 성향 줄 전체가 탭 가능. Sheet detent="half" title="{koLabel} 근거". 본문: 이 축이 무엇을 재는지 2줄 + 이 축에 쓰인 실수 목록(핸드 배지 + 상황 축약 + ActionBadge "콜 → 정답 3벳") 최대 10개 + 맨 아래 표본 수. 숫자를 숨기지 않고 다 보여 주는 곳이 여기 한 군데다.

6. 집중할 포인트 — h2 .t-title-3 "집중할 포인트". CoachCardView 최대 3장 세로 스택(gap 12). 카드 = GlassPanel radius="lg" padding=16, 좌측에 4px 세로 악센트 바(1순위 --flame, 2·3순위 --mint). 구성: 순번 원형 배지(1·2·3) + title(t-title-3) / evidence 한 줄(fs-subhead --ink-2 tnum) / 구분선 / "이렇게 생각하세요" 아래 steps 2~3개 불릿(4px dot, fs-body) — 마지막 불릿은 질문이다 / 하단 풀폭 CapsuleButton block. 첫 카드만 tone="primary"(화면당 solid 1개 규칙), 2·3은 tone="neutral". 버튼 라벨은 drill에 따라 "이 상황만 훈련 · 12장" 또는 "헷갈린 것만 퀴즈 · 9문제".

7. AI에게 더 물어보기 — h2 없음. GlassPanel variant="clear" radius="lg" padding=16. 설명 한 줄 "내 실수 기록을 정리해서 AI에게 물어봐요" + CapsuleButton tone="neutral" block [질문 복사하기] → AskAiSheet. 시트 안에 프롬프트 전문(.fill 박스, fs-footnote, max-height 240 스크롤) + footer [복사하기](primary) + ghost 칩 [Claude 열기] [ChatGPT 열기]. 패널 맨 아래 fs-footnote --ink-3 링크 "API 키가 있다면 바로 받기" → ApiKeySheet. 키가 저장돼 있으면 시트 첫 버튼이 [바로 물어보기]로 바뀌고, 받은 AI 카드는 6번 섹션 **아래**에 "AI 코치" 배지를 단 같은 모양 카드로 붙는다(L0 카드를 대체하지 않는다). 받은 시각 + [새로 받기](새 실수 10개 전까지 비활성).

8. 헷갈린다고 표시한 자리 — h2 .t-title-3. srs.weakSpots(3) 3행. 좌: "BB · 오픈 대응", 우: tnum "헷갈려요 62%" + IconNext. 행 탭 → launch({target:'train', deck: deckForKind(kind), positions:[hero], autostart:true}). **성향 축과 섞지 않는다** — weakSpots는 스와이프 자가평가(reps+lapses) 기반이라 실수와 다른 모집단이다. 섹션 제목이 그 차이를 말해 준다. 홈 화면 '약한 곳'과 중복이지만 홈은 진입, 여기는 진단 맥락이라 남긴다.

9. 최근 실수 — 기존 /home/user/holdem-flicker/src/screens/quiz/MistakeList.tsx를 그대로 재사용(접힌 상태, {mistakes} prop만 받는다). 코치용 MistakeList를 새로 만들지 않는다. 그 아래 CapsuleButton tone="ghost" block [틀린 것만 다시 풀기 · N문제] → launch({target:'quiz', onlyKeys: 최근 실수 카드키 최대 20개, autostart:true}).

10. 하단 여백 — .screen이 padding-bottom: var(--content-bottom)를 이미 준다. 별도 처리 없음.

## 7. 콜드 스타트

레이아웃은 모든 단계에서 동일하고, 채워지는 양만 다르다. 빈 화면을 만들지 않는 방법은 "잠긴 진짜 화면"을 보여 주는 것이다. 게이트는 `digest.volume.mistakesUsed`(= |M|) 기준이다.

**단계 0 — |M| = 0**
2~9번 섹션을 통째로 대체한다. CoachEmpty 한 장: GlassPanel 가운데 정렬, 큰 글씨 "아직 볼 게 없어요" / 한 줄 "문제를 20개쯤 풀면 성향이 보입니다" / ProgressRing size=64 label "0 / 20" / CapsuleButton tone="primary" [퀴즈 시작] → launch({target:'quiz', autostart:true}).
그 **아래**에 "초보가 제일 많이 틀리는 곳" 고정 카드 3장을 붙인다. 데이터가 0이어도 읽을 값이 있고, 카드 머리에 --ink-3로 "내 기록이 아니라 일반적인 이야기예요"라고 명시해 거짓말을 하지 않는다.
  1) "앞자리와 뒷자리는 다른 게임이에요" → [앞자리로 훈련] launch({target:'train', deck:'rfi', positions:['UTG','HJ'], autostart:true})
  2) "BB를 접는 이유는 가격이 아니라 포지션이에요" → [BB 수비 훈련] launch({target:'train', deck:'vs_open', positions:['BB'], autostart:true})
  3) "무늬는 마지막에 더하는 보너스예요" → [오픈 대응 훈련] launch({target:'train', deck:'vs_open', autostart:true})
AI 섹션은 숨긴다 — 재료 없는 다이제스트를 AI에게 보내면 그럴듯한 거짓말이 돌아온다.

**훈련만 하는 사용자 특례**
`digest.volume.trials > 0 && mistakesUsed === 0`이면 CTA 문구를 바꾼다: "아직 틀린 게 없어요. 선택 버튼으로 답을 고르면 성향이 쌓입니다." — 노출 모드(exposureMode)나 스와이프 평가만으로는 방향이 기록되지 않기 때문이다. 이 특례는 `sessionStore.leaveCard`가 `recordMistake`를 호출하도록 고친 뒤에만 의미가 있고, 그 수정이 네 안 공통 최대 리스크("훈련만 하면 코치 탭이 영원히 빈다")를 실제로 없앤다.

**단계 1 — |M| 1~11**
헤더 아래에 얇은 프로그레스 바 + "성향 분석까지 8개 남음". 2·3·6·7번 섹션은 숨긴다. 4번 성향 섹션은 **네 줄 모두 잠긴 회색 트랙**으로 실제 레이아웃 그대로 보여 주고 각 줄 우측에 "실수 N개 더"를 숫자로 적는다 — 무엇을 얼마나 더 하면 열리는지가 동기부여다. 8·9번(헷갈린 자리, 최근 실수)은 데이터가 1건이라도 있으면 즉시 켠다. 단계 0의 고정 카드 3장은 계속 둔다.

**단계 2 — |M| 12~19**
aggression이 먼저 열린다(minSample 12). 한 줄 요약이 등장하되 단정하지 않는다 — level이 confident가 아니면 "아직 한쪽으로 치우치지 않았어요"로 고정한다. 집중 포인트는 뭉치 게이트(count ≥ 6 && distinctHands ≥ 3 && lift ≥ 1.5)를 넘긴 것만, 최대 1장. 하나도 못 넘기면 seat_hotspot 보루 규칙 1장을 "먼저 여기부터" 톤으로 낸다. AI 섹션(L1 복사)은 이 단계부터 연다. 프롬프트 안에 "표본이 적으니 단정하지 말고 방향만 말하라"는 문장을 추가로 끼운다.

**단계 3 — |M| ≥ 20**
entry 해금. seat는 EARLY·LATE 각각 12개, pressure는 OPEN·HEAT 각각 12개를 채울 때 따로 열린다 — 전역 개수가 아니라 **축별 표본**으로 판정하므로 rfi만 푼 사람은 aggression만 먼저 열린다. 집중 포인트 최대 3장. 축이 해금되는 순간 그 줄에 마커가 좌우에서 미끄러져 들어오는 애니메이션(420ms, --ease-spring, prefers-reduced-motion이면 생략)과 토스트 "새 성향이 열렸어요 · 타이트 ↔ 루즈"를 **한 번만** 띄운다(해금 기록은 localStorage에 축 id로 남긴다).

**모든 단계 공통 원칙**
표본 부족을 "데이터 없음"으로 감추지 않고 "무엇을 하면 열리는지"로 바꿔 보여 준다. 흐린 문장("아마도 ~인 것 같아요")으로 때우지 않는다. 표본 3개로 "당신은 루즈합니다" 같은 단정은 어떤 경로에서도 나오지 않는다 — 게이트를 규칙 코치와 AI 프롬프트 양쪽에 똑같이 건다.

## 8. 결정 사항 (설계 단계에서 열려 있던 것들)

- `stats.mistakes` 상한 100 → **300**. 실수가 밀려나면 '고쳤다'는 사실이 화면에 안 보인다. 늘어나는 저장 용량은 약 30KB.
- 기본 설정에 `cold_4bet`이 빠져 있는 건 **건드리지 않는다**. 코치는 있는 데이터로만 말한다.
- L2 기본 모델은 **claude-opus-5**. 값싼 모델은 설정에서 고른다 — 돈 쓰는 쪽을 정하는 건 사용자다.
- 홈의 '약한 곳'과 코치 탭의 '헷갈린다고 표시한 자리'는 **둘 다 남긴다**. 홈은 진입 동선, 코치는 진단 맥락이다.

---

## 9. 구현하며 바뀐 것

- **축 이름의 좌우를 극(pole)과 맞췄다.** 머리말은 `[음수 ↔ 양수]` 여야 아래 라벨과 같이 읽힌다.
  `seat` 은 §1 제목이 뒤집혀 있었고, `pressure` 는 두 극이 모두 큰 팟 이야기인데 제목의 왼쪽만
  '첫 결정'이라 뜻까지 어긋나 있었다.
- **실수 뭉치의 중복 제거를 각도(family)별로 바꿨다.** 전역 그리디는 가장 넓은 규칙 하나가 실수를
  다 가져가서 더 구체적인 규칙이 영영 못 뜬다(실측: 실수 70개 중 37개를 `early_seat_wide` 가
  가져가 카드가 1장만 나왔다). 각도가 다르면 같은 실수를 두 번 봐도 된다 — 하나는 *어디서*,
  다른 하나는 *어떤 패에서* 새는지를 말하니 고치는 방법이 다르다. 다만 실수가 70% 넘게 겹치면
  말만 바꾼 같은 카드이므로 막는다. family: line · pressure · seat · hand.
- **자리·상황 규칙의 훈련 목적지를 개수와 무관하게 덱 훈련으로 고정했다.** 고치려는 건 특정 패의
  정답이 아니라 그 자리에서 패를 고르는 기준이다.

### 검수에서 고친 것 (2차)

독립 검수 여섯 각도 + 지적마다 반증 시도를 돌렸다. 살아남아 고친 것들:

**통계 — 실수는 서로 독립이 아니다**

네 축의 z 가 '실수 한 건 = 독립 관측 한 개'를 가정하고 있었다. 그런데 카드키 하나의 정답은 차트가
정해 놓아 고정이고, srs 는 틀린 카드를 10분 뒤로 되돌려 다시 내보내며, '내 약점' 덱은 아예 그
카드들만 모은다. 같은 카드를 세 번 틀리면 같은 이야기를 세 번 센 것인데 z 는 증거 세 개로 읽는다.
성향이 전혀 없는 사람의 **1/3이 '뚜렷하다'는 말을 듣고 있었다.**

→ `designEffect = √(실수 수 ÷ 서로 다른 카드 수)` 로 z 를 나눈다. 되풀이가 없으면 1 이라 아무 일도
일어나지 않고, 되풀이가 심할수록 단정이 어려워진다. 보정 뒤 우연한 단정은 5% 아래.

같은 뿌리로 두 군데를 더 고쳤다.
- **훈련 탭이 결정 하나를 실수 세 건으로 기록**하고 있었다. 재큐잉 복사본이 `exposed` 없는 새 카드라
  `recordMistake` 와 `pickSeen` 이 다시 돌았다. 세션 안에서 카드키당 한 번만 센다(`SessionState.counted`).
- **◀로 되돌아간 카드를 다시 큐에 넣고** 있었다. `advance()` 가 `exposed` 를 안 봐서 ◀/다음을
  왕복할 때마다 큐가 불어났다.

그리고 **테스트가 이 결함을 스스로 통과시키고 있었다.** 합성 시뮬레이터가 매 시행 정답을 새로
추첨해서, 같은 카드키가 이번엔 폴드 정답이고 다음엔 3벳 정답인 — 앱에 존재할 수 없는 세계를 만들고
있었다. 카드마다 정답을 고정하고, 틀린 카드가 더 자주 다시 나오도록(srs 흉내) 고쳤다.

**포커 — 조언이 앱 자신의 차트와 어긋나 있었다**

차트 데이터를 직접 펼쳐 대조한 결과다. 코치가 차트 탭과 반대말을 하면 기능 전체의 신뢰가 끝난다.

| 무엇이 틀렸나 | 차트가 말하는 것 |
|---|---|
| "오픈하는 패를 센 순서로 줄 세워 맨 위가 4벳" | vs_3bet 은 폴라라이즈드다. 4벳 칸이 `AA KK QQ AK` **와 `A5s A4s`** 이고 `AQs JJ TT` 는 그보다 아래인 콜 칸이다 |
| 앞자리 기준 "페어·둘 다 높음·수티드 중 둘" | UTG 오픈 45칸 중 **30칸이 이 기준에 걸린다**. 차트는 `22+`, `A2s+`, `ATo+` 를 전부 연다 |
| "뒷자리에선 수티드 커넥터와 작은 페어부터 넣는다" | 작은 페어는 UTG 부터 이미 전부 열고, 수티드 커넥터는 `54s` **한 칸**만 는다. 실제로 느는 건 오프수트 브로드웨이·낮은 수티드 K·수티드 갭퍼다 |
| "무늬가 달랐어도 들어갔을까요?" | 차트대로면 답이 "아니요"인데 그게 **맞는 판단**이다. 옳은 사고를 실수로 되돌리는 질문이라 무늬가 아니라 자리를 묻는다 |
| "접을 패를 3벳으로 갈 일은 거의 없다" | 3벳 정답 316칸 중 **248칸이 콜 빈도 0** 이다. `A5s~A2s` 가 바로 '접을 패가 3벳으로' 가는 패다 |
| "BB는 플랍부터 먼저 액션한다" | SB 오픈에서는 BB 가 포지션을 가진다(`heroInPosition('BB','SB') === true`). 그 노드를 규칙에서 뺀다 |

규칙 구조도 두 군데 갈랐다. `stubborn_vs_4bet` 이 vs_5bet 까지 잡으면서 "3벳하기 전에"라고 말했는데
vs_5bet 히어로는 3벳한 적이 없다(이미 4벳을 한 쪽이다). `premium_underplay` 는 폴드까지 잡아 놓고
"지금 콜한 이 패"라고 했다. 각각 `stubborn_vs_5bet` · `premium_overfold` 로 나눴다.

**문구 — 뜻이 조용히 잘려 나가고 있었다**

`copy.ts` 가 25자 넘는 문장을 버리는데, 규칙의 실제 내용이 거의 다 25자를 넘었다. 그래서 어떤 카드는
결론만, 어떤 카드는 전제만 남았다 — 뜻을 정하는 곳과 자르는 곳이 달라서 생긴 일이다. **조언을
처음부터 카드 예산 안에서 쓴다**(줄마다 25자 이하, 마지막 줄이 질문). 테스트가 이 약속을 지킨다.

린터도 뚫려 있었다. '액션 명사 + 종결어미'만 잡아서 "접는 패예요" 같은 고유어나 조사 한 글자로
빠져나갔다. 차트 표기(`AJo`·`A5s`)는 한 번이라도 나오면 버리고, 사람이 말로 쓰는 이름(`AK`·`QQ`)은
단정과 같은 줄일 때 버린다 — AK 도 vs_5bet 에서는 폴드라 자리를 빼고 단정하면 틀린 말이 된다.

**AI 경로**

- **캐시가 과금을 못 막고 있었다.** `digest.hash` 로 캐시해서 문제를 하나만 더 풀어도 받아 둔 답이
  사라지고 유료 버튼이 다시 열렸다. hash 일치가 아니라 '받은 뒤로 실수가 10개 늘었거나 하루가 지났는가'로 본다.
- `max_tokens` 1400 은 Opus 5 의 기본 adaptive thinking 과 같은 예산을 써서 잘릴 수 있었다. 8000 으로
  올리고 `stop_reason` 을 확인한다 — 잘린 답은 JSON 이 안 닫혀 조용히 0장이 되던 것을 말해 준다.
- 머리말에 `[요약]` 같은 대괄호가 있으면 배열 추출이 엉뚱한 곳을 잘랐다. '실제로 파싱되는 배열'을 찾는다.
- 동적 import 와 생성자가 try 밖이라 청크 로딩 실패 시 영어 에러가 토스트에 떴다.
- `steps` 를 앞에서 3줄로 자르면 4번째 줄의 질문이 날아가 린터에 걸려 카드가 통째로 버려졌다. 자르지 않는다.

**기타**

- 예전(13칸) 저장 기록은 `quizSeen/pickSeen` 이 0 이라 코치 탭의 분모가 통째로 비어 축이 영영
  안 열렸다. 평가 횟수(`reps + lapses`)로 어림잡는다.
- 상황·자리별 정답률이 모집단이 다른 두 수(`trials` 는 srs, `mistakes` 는 stats)로 계산돼
  프롬프트에 "정답률 −800%"가 실릴 수 있었다. 그 칸은 `—` 로 비운다.
- 축 이름의 좌우를 극(pole)과 맞췄다. `pressure` 는 두 극이 모두 큰 팟 이야기인데 제목의 왼쪽만
  '첫 결정'이라 뜻까지 어긋나 있었다.
- 모델 선택을 설정 탭이 아니라 키 시트 안에 뒀다(키 시트가 "설정에서 고를 수 있어요"라고 했는데
  설정에는 그 줄이 없었다). 요금 안내도 실제 범위로 고쳤다.

### 2차 검수에서 고친 것

1차 수정 뒤 같은 방식으로 한 번 더 돌렸다. 반증을 통과한 10건 중 3건은 1차에서 이미 고쳤고,
나머지는 **화면이 셀 수 없는 것을 셀 수 있는 척한다**는 한 가지 뿌리를 공유했다.

- **잠긴 축의 '실수 N개 더'가 줄지 않는 숫자였다.** seat 은 UTG·HJ / CO·BTN 만, pressure 는 상황
  그룹별로 세는데 화면은 그냥 '실수 N개 더'로 찍었다. BB 수비만 푸는 사람은 실수를 아무리 쌓아도
  이 숫자가 1도 안 줄어든다. → `needWhere`('앞자리·뒷자리', '3벳·4벳 자리', '답이 셋인 자리')를
  같이 내보내 어디서 필요한지까지 적는다. AI 프롬프트도 같은 문장을 쓴다.
- **기준선이 없는 것과 표본이 모자란 것을 구분하지 않았다.** 전자는 실수를 채워도 안 열린다.
  → `lockedBy: 'mistakes' | 'baseline' | 'no-baseline'`. 기준선이 없으면 숫자를 적지 않고
  '문제부터 풀기'라고 말한다.
- **기준선 표본이 1건이어도 마커를 트랙 끝까지 밀었다.** 색만 회색이 되는데 사람이 읽는 건 마커
  위치다. → 기준선 하한(minSample × 4)을 두고, 신호가 없으면(`flat`) 마커를 중앙으로 눕힌다.
  잰 값은 `tRaw` 에 남겨 귀무 편향 테스트가 공회전하지 않게 했다.
- **진행 바와 축이 같은 화면에서 다른 숫자를 말했다.** 진행 바는 전역 실수 수를, 축은 그 축의
  표본을 쟀다. → 진행 바를 '가장 먼저 열릴 축'의 숫자로 그린다.
- **아무것도 재지 않았는데 '재 봤더니 중립'이라고 했다.** 실수 12개를 넘기면 한 줄 요약이
  '아직 한쪽으로 치우치지 않았어요'로 떴는데 그때 네 축이 전부 잠겨 있을 수 있었다.
  → 요약을 '해금된 축이 하나라도 있는가'로 가른다.
- **저장된 실수가 있는데 '아직 틀린 게 없어요'라고 했다.** 실수가 전부 혼합 스팟이면 분석에서
  빠지는데, 같은 기기의 퀴즈 탭에는 그 실수가 그대로 보인다. → 뺀 개수를 말하고, '최근 실수'와
  '헷갈린 자리'는 1건이라도 있으면 보여 준다.
- **압박 축 근거 시트가 오픈 대응 실수 10개를 그 근거로 보여 줬다.** `belongs()` 에 pressure·entry
  케이스가 없어 전부 통과시켰다. → 네 축을 명시하고, 그룹이 둘인 축은 목록을 두 덩이로 나눠
  어느 쪽이 모자라 잠겼는지 보여 준다.
- **[새로 받기] 버튼이 구조적으로 절대 안 눌렸다.** 섹션 렌더 조건과 버튼 활성 조건이 얽혀 있었다.
- **축 해금 토스트가 한 번도 안 떴다.** 탭을 떠나면 화면이 언마운트돼 기준점이 날아갔다.
  → 해금 기록을 localStorage 에 남긴다. 기록이 없는 첫 실행은 조용히 기준점만 적는다 —
  안 그러면 기존 사용자가 옛날에 열린 축 네 개를 한꺼번에 축하받는다.
- **일시정지된 세션이 있으면 '이 상황만 훈련 · BB' 버튼이 다른 자리를 열었다.** 인텐트를 소비한 뒤
  버렸기 때문이다. → 목적지를 집은 인텐트가 현재 세션과 어긋나면 사용자에게 물어본다.
  진행 중인 세션을 말없이 날리지도, 누른 라벨과 다른 화면을 말없이 띄우지도 않는다.
