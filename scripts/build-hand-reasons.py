#!/usr/bin/env python3
"""
Write src/poker/theory/handReasons.data.ts from verified hand-reason results (docs/THEORY_SPEC.md §6).

  python3 scripts/build-hand-reasons.py <reasons.json>   # [{key, text, principles, book_diff}]

Keys are sorted; strings are emitted as TS single-quoted literals. tests/theory.test.ts checks coverage of every
reachable cell, length, style and principle ids.
"""
import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'src' / 'poker' / 'theory' / 'handReasons.data.ts'


def ts(s: str) -> str:
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


items = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
seen = {}
for it in items:
    k = it['key']
    if k in seen:
        sys.exit(f'duplicate key {k}')
    seen[k] = it
lines = [
    '/* 생성 파일 — scripts/build-hand-reasons.py 가 검증을 마친 문장으로 씁니다(docs/THEORY_SPEC.md §6).',
    ' * 키 = 상황 | 자리 쪽 | 패 가족 | 버킷(keys.ts). 손으로 고칠 때는 tests/theory.test.ts 를 같이 돌리세요. */',
    "import type { HandReasonEntry } from './handReason';",
    '',
    'export const HAND_REASONS: Record<string, HandReasonEntry> = {',
]
for k in sorted(seen):
    it = seen[k]
    pr = ', '.join(ts(p) for p in it['principles'])
    lines.append(f"  {ts(k)}: {{ text: {ts(it['text'].strip())}, principles: [{pr}], bookDiff: {ts((it.get('book_diff') or '').strip())} }},")
lines.append('};')
lines.append('')
OUT.write_text('\n'.join(lines), encoding='utf-8')
print(f'{len(seen)} keys → {OUT}')
