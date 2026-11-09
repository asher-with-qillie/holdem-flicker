# 키 단위 book_diff 중 특정 패 이름을 든 것을 그 칸에만 맞게 고칩니다(키의 다른 칸에 엉뚱하게 뜨지 않게).
import json, sys
p = sys.argv[1]
d = json.load(open(p))
by = {x['key']: x for x in d}
HJCO = '책은 HJ·CO가 앞자리 오픈에 콜 없이 3벳 아니면 폴드로 대응한다고 해요.'
fix = {
  'rfi|BTN|ace_o_small|raise': '',   # → CELL_DIFFS rfi:BTN:A3o, A2o
  'rfi|BTN|off_mid|raise': '',       # → CELL_DIFFS rfi:BTN:K7o
  'vs_open|mid|pair_mid|call': HJCO + ' 이 차트는 {hand|으로/로} 콜을 써요.',
  'vs_open|mid|conn_s|call': HJCO + ' 이 차트는 {hand|으로/로} 콜을 써요.',
  'vs_open|mid|bw_s|call': HJCO + ' 이 차트는 {hand|으로/로} 콜을 써요.',
  'vs_open|mid|ace_s_mid|call': HJCO + ' 이 차트는 {hand|으로/로} 콜을 써요.',
  'vs_open|mid|pair_small|call': '책은 HJ·CO가 앞자리 오픈에 콜 없이 3벳 아니면 폴드하고, HJ는 UTG 상대로 작은 페어를 3벳에 조금 섞는다고 해요. 이 차트는 {hand|을/를} 3벳하지 않고 콜해요.',
}
# 칸 일부가 폴드 75%인 키: '폴드해요' 대신 모든 칸에서 참인 말로
for k in ('vs_4bet|IP|pair_mid|fold', 'vs_5bet|OOP|ak|fold'):
    if k in by:
        by[k]['book_diff'] = by[k]['book_diff'].replace('{hand|을/를} 폴드해요', '{hand|으로/로} 콜보다 폴드를 더 많이 해요')
for k, v in fix.items():
    if k in by:
        by[k]['book_diff'] = v
json.dump(list(by.values()), open(p, 'w'), ensure_ascii=False, indent=1)
print('fixups applied', sum(k in by for k in fix))
