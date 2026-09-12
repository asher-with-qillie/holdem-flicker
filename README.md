# Holdem Flicker · 프리플랍 GTO 암기 트레이너

6-max 100bb 캐시 게임 기준의 **프리플랍 GTO 레인지**를 카드 플래시 방식으로 암기하는 모바일 웹앱입니다.

- **훈련 모드**: 무작위 핸드를 받고, 포지션과 상황(앞에 아무도 없음 / 앞에서 오픈 / 내 오픈에 3벳 / 내 3벳에 4벳 / 5벳 올인 / 콜드 4벳)을 순서대로 돌며 정답 액션이 자동으로 표시되고 다음으로 넘어갑니다. 화면을 **길게 누르면 타이머가 멈추고 해설**이 나옵니다.
- **퀴즈 모드**: 직접 액션을 고르고 정답률·연속 정답을 기록합니다.
- **차트**: 상황별 13×13 레인지 차트와 셀별 해설.
- **해설**: 왜 그 액션인지(레인지, 블로커, 포지션, 팟 오즈)와 **폴드가 아닐 때 플랍에서 확인할 것**(레인지 우위, 넛 우위, SPR, 보드 텍스처, 플레이 계획).
- 카드는 수티드/오프수트 구분이 한눈에 보이도록 **♠와 ♦만** 사용합니다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173/holdem-flicker/
npm test         # 레인지 표기 파서 + 차트 무결성 테스트
npm run build    # dist/
```

## 배포

`main` 브랜치에 푸시하면 GitHub Actions(`.github/workflows/deploy.yml`)가 빌드 후 GitHub Pages로 배포합니다.
저장소 Settings → Pages → Source가 **GitHub Actions**로 되어 있어야 합니다 (워크플로가 자동 활성화를 시도합니다).
배포 주소: `https://<owner>.github.io/holdem-flicker/`

## 구조

```
src/poker/        엔진: 포지션·액션·시나리오, 169 핸드 유틸, 레인지 표기 파서, 트레이너 시퀀스, 해설 생성기
src/poker/data/   차트 데이터 (rfi, vsOpen, vs3bet, vs4bet, vs5bet, cold4bet)
src/components/   카드(SVG), 테이블 다이어그램, 레인지 그리드, 액션 배지, 해설 시트
src/screens/      훈련 / 퀴즈 / 차트 / 설정
docs/RANGE_SPEC.md  차트 표기법·게임 모델·작성 규칙
docs/UI_SPEC.md     UI 규칙
```

## 데이터에 대해

레인지는 널리 공개된 솔버 결과(GTO Wizard·Upswing 계열, 6-max 100bb, 2.5bb 오픈)를 **암기하기 쉽게 근사**한 것입니다.
실제 솔버 출력은 레이크·사이징·상대 레인지에 따라 달라지며, 혼합 빈도 핸드는 가장 높은 빈도의 액션을 정답으로 표시합니다.
차트는 `src/poker/data/*.ts`에서 `docs/RANGE_SPEC.md`의 표기법으로 직접 수정할 수 있습니다.
