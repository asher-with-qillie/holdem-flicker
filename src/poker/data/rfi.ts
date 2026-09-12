import type { ChartDef } from '../types';

/**
 * RFI (raise first in) ranges — 6-max, 100bb, ~2.5bb open (SB 3bb), raise-or-fold from SB.
 * Approximates commonly published solver outputs (GTO Wizard / Upswing style) at mid-stakes rake.
 * Weights (":0.5") mark mixed-frequency hands; the memorization answer is the highest-weight action.
 */
export const RFI_CHARTS: ChartDef[] = [
  {
    id: 'rfi:UTG',
    kind: 'rfi',
    hero: 'UTG',
    actions: {
      raise: [
        '22+',
        'A2s+',
        'K9s+', 'Q9s+', 'J9s+', 'T9s', '98s', '87s', '76s', '65s:0.5',
        'AJo+', 'KQo', 'ATo:0.5', 'KJo:0.5',
      ].join(','),
    },
    summary:
      'UTG(LJ)는 뒤에 5명이 남아 있어 가장 타이트하게 오픈합니다(약 17%). 모든 포켓페어와 수티드 에이스, 강한 수티드 브로드웨이·커넥터, 오프수트는 AJo+와 KQo 정도까지만 엽니다.',
    notes: {
      '65s': '65s는 UTG에서 경계 핸드로 솔버가 오픈/폴드를 혼합합니다. 레이크가 높거나 뒤에 공격적인 3벳터가 있으면 폴드하세요.',
      ATo: 'ATo·KJo는 UTG에서 혼합 핸드입니다. 도미네이션 위험이 커서 절반 정도만 오픈합니다.',
      KJo: 'ATo·KJo는 UTG에서 혼합 핸드입니다. 도미네이션 위험이 커서 절반 정도만 오픈합니다.',
      A2s: '수티드 에이스는 낮은 킥커라도 넛 플러시 가능성과 3벳을 당했을 때 블러프 4벳 재료가 되어 UTG에서도 모두 오픈합니다.',
    },
  },
  {
    id: 'rfi:HJ',
    kind: 'rfi',
    hero: 'HJ',
    actions: {
      raise: [
        '22+',
        'A2s+',
        'K7s+', 'Q9s+', 'J9s+', 'T8s+', '98s', '97s:0.5', '87s', '76s', '65s', '54s:0.5',
        'ATo+', 'KJo+', 'QJo:0.5', 'KTo:0.5',
      ].join(','),
    },
    summary:
      'HJ는 UTG보다 한 명 적게 남아 약 21%를 오픈합니다. 수티드 킹이 K7s까지, 수티드 커넥터가 65s까지 넓어지고 오프수트는 ATo+, KJo+가 기본입니다.',
    notes: {
      '97s': '수티드 원갭퍼 97s는 HJ에서 경계 핸드입니다.',
      '54s': '54s는 HJ에서 절반 정도만 오픈하는 혼합 핸드입니다.',
      QJo: 'QJo·KTo는 HJ에서 혼합 핸드로, 뒤에 타이트한 플레이어가 많을수록 오픈 빈도를 높입니다.',
      KTo: 'QJo·KTo는 HJ에서 혼합 핸드로, 뒤에 타이트한 플레이어가 많을수록 오픈 빈도를 높입니다.',
    },
  },
  {
    id: 'rfi:CO',
    kind: 'rfi',
    hero: 'CO',
    actions: {
      raise: [
        '22+',
        'A2s+',
        'K4s+', 'Q7s+', 'J8s+', 'T8s+', '97s+', '86s+', '75s+', '65s', '54s', '64s:0.5',
        'A8o+', 'KTo+', 'QTo+', 'JTo',
      ].join(','),
    },
    summary:
      'CO는 뒤에 BTN과 블라인드만 남아 약 28%를 오픈합니다. 수티드 킹 K4s+, 수티드 퀸 Q7s+, 수티드 갭퍼(97s, 86s, 75s)와 오프수트 A8o+, KTo+, QTo+, JTo까지 확장됩니다.',
    notes: {
      '64s': '64s는 CO에서 혼합 핸드입니다. BTN이 타이트하면 오픈 빈도를 높이세요.',
      A8o: 'A8o는 CO 오픈의 하단 오프수트 에이스입니다. A7o 이하는 CO에서 폴드입니다.',
    },
  },
  {
    id: 'rfi:BTN',
    kind: 'rfi',
    hero: 'BTN',
    actions: {
      raise: [
        '22+',
        'A2s+', 'K2s+', 'Q2s+', 'J4s+', 'T6s+', '96s+', '85s+', '75s+', '64s+', '53s+',
        'A2o+', 'K7o+', 'Q9o+', 'Q8o:0.5', 'J9o+', 'J8o:0.5', 'T9o', 'T8o:0.5', '98o:0.5',
      ].join(','),
    },
    summary:
      'BTN은 항상 포지션을 가지므로 가장 넓게(약 46%) 오픈합니다. 모든 수티드 에이스·킹·퀸, 대부분의 수티드 커넥터·갭퍼, 오프수트는 A2o+, K7o+, Q9o+, J9o+, T9o까지 열고 Q8o·J8o·T8o·98o는 절반만 혼합 오픈합니다.',
    notes: {
      K8o: 'K8o·K7o는 BTN 오픈의 하단 오프수트 킹으로 순수 오픈입니다. K6o 이하는 폴드합니다.',
      K7o: 'K7o는 BTN 오픈의 하단 오프수트 킹으로 순수 오픈입니다. K6o 이하는 폴드합니다.',
      Q8o: 'Q8o·J8o·T8o·98o는 BTN 오픈의 경계 오프수트로 절반만 오픈합니다.',
      J8o: 'Q8o·J8o·T8o·98o는 BTN 오픈의 경계 오프수트로 절반만 오픈합니다.',
      T8o: 'Q8o·J8o·T8o·98o는 BTN 오픈의 경계 오프수트로 절반만 오픈합니다.',
      '98o': 'Q8o·J8o·T8o·98o는 BTN 오픈의 경계 오프수트로 절반만 오픈합니다.',
      '53s': '53s는 BTN에서 오픈하는 가장 낮은 수티드 원갭퍼입니다. 43s는 혼합 또는 폴드입니다.',
    },
  },
  {
    id: 'rfi:SB',
    kind: 'rfi',
    hero: 'SB',
    actions: {
      raise: [
        '22+',
        'A2s+', 'K2s+', 'Q3s+', 'Q2s:0.5', 'J5s+', 'T6s+', '96s+', '85s+', '75s+', '64s+', '54s', '53s:0.5',
        'A2o+', 'K7o+', 'K6o:0.5', 'Q9o+', 'Q8o:0.5', 'J9o+', 'J8o:0.5', 'T9o', 'T8o:0.5', '98o:0.5',
      ].join(','),
    },
    summary:
      'SB는 BB 한 명만 남아 레이즈-or-폴드 전략으로 약 46%를 3bb 오픈합니다. 림프 전략도 있지만 이 트레이너는 레이즈-폴드만 다룹니다. 포지션이 없으므로 넓지만 플랍 이후 조심해야 합니다.',
    notes: {
      Q2s: 'Q2s는 SB에서 혼합 핸드입니다.',
      K6o: 'K6o, Q8o, J8o, T8o, 98o는 SB 오픈의 경계 오프수트 핸드로 절반 정도만 오픈합니다.',
      Q8o: 'K6o, Q8o, J8o, T8o, 98o는 SB 오픈의 경계 오프수트 핸드로 절반 정도만 오픈합니다.',
      J8o: 'K6o, Q8o, J8o, T8o, 98o는 SB 오픈의 경계 오프수트 핸드로 절반 정도만 오픈합니다.',
      T8o: 'K6o, Q8o, J8o, T8o, 98o는 SB 오픈의 경계 오프수트 핸드로 절반 정도만 오픈합니다.',
      '98o': 'K6o, Q8o, J8o, T8o, 98o는 SB 오픈의 경계 오프수트 핸드로 절반 정도만 오픈합니다.',
    },
  },
];
