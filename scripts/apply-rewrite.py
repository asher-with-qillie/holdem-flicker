#!/usr/bin/env python3
"""
Apply verified rewrite results to the chart data files (docs/THEORY_SPEC.md §9, §11).

  python3 scripts/apply-rewrite.py memos <memos.json>       # [{chart, hand, text}] — text "" deletes the memo
  python3 scripts/apply-rewrite.py summaries <sums.json>    # [{chart, text}]

Works line by line on src/poker/data/*.ts: a memo is one line `      KJo: '…',` (or `'65s': '…'`) inside a chart
block, a summary is `    summary: '…',` or `    summary:` + `      '…',`. Only lines whose text actually changes are
rewritten; every requested (chart, hand) must be found exactly once, or the script stops without writing anything.
"""
import json
import re
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / 'src' / 'poker' / 'data'
ID_LINE = re.compile(r"^\s+id: '([^']+)',$")
NOTE_LINE = re.compile(r"^(\s+)('?)([2-9TJQKA]{2}[so]?)\2: '(.*)',$")
SUMMARY_ONE = re.compile(r"^(\s+summary: )'(.*)',$")
SUMMARY_HEAD = re.compile(r"^\s+summary:$")
SUMMARY_BODY = re.compile(r"^(\s+)'(.*)',$")


def ts_str(text: str) -> str:
    return "'" + text.replace('\\', '\\\\').replace("'", "\\'") + "'"


def key_token(hand: str) -> str:
    return f"'{hand}'" if hand[0].isdigit() else hand


def apply(kind: str, items: list) -> None:
    want = {}
    for it in items:
        k = (it['chart'], it.get('hand')) if kind == 'memos' else (it['chart'], None)
        if k in want:
            sys.exit(f'duplicate entry {k}')
        want[k] = it['text'].strip()
    found = set()
    outputs = {}
    for f in sorted(DATA.glob('*.ts')):
        lines = f.read_text(encoding='utf-8').split('\n')
        out = []
        chart = None
        i = 0
        changed = False
        while i < len(lines):
            line = lines[i]
            m = ID_LINE.match(line)
            if m:
                chart = m.group(1)
            if kind == 'memos':
                n = NOTE_LINE.match(line)
                if n and chart and (chart, n.group(3)) in want:
                    k = (chart, n.group(3))
                    found.add(k)
                    new = want[k]
                    if new == '':
                        changed = True
                        i += 1
                        continue
                    nl = f"{n.group(1)}{key_token(n.group(3))}: {ts_str(new)},"
                    changed |= nl != line
                    out.append(nl)
                    i += 1
                    continue
            else:
                s1 = SUMMARY_ONE.match(line)
                if s1 and chart and (chart, None) in want:
                    found.add((chart, None))
                    nl = f"{s1.group(1)}{ts_str(want[(chart, None)])},"
                    changed |= nl != line
                    out.append(nl)
                    i += 1
                    continue
                if SUMMARY_HEAD.match(line) and chart and (chart, None) in want and i + 1 < len(lines) and SUMMARY_BODY.match(lines[i + 1]):
                    found.add((chart, None))
                    indent = SUMMARY_BODY.match(lines[i + 1]).group(1)
                    nl = f"{indent}{ts_str(want[(chart, None)])},"
                    changed |= nl != lines[i + 1]
                    out.append(line)
                    out.append(nl)
                    i += 2
                    continue
            out.append(line)
            i += 1
        if changed:
            outputs[f] = '\n'.join(out)
    missing = set(want) - found
    if missing:
        sys.exit(f'not found ({len(missing)}): {sorted(missing)[:10]}')
    for f, text in outputs.items():
        f.write_text(text, encoding='utf-8')
    print(f'{kind}: {len(want)} entries, {len(outputs)} files written')


if __name__ == '__main__':
    kind, path = sys.argv[1], sys.argv[2]
    if kind not in ('memos', 'summaries'):
        sys.exit('kind must be memos or summaries')
    apply(kind, json.loads(Path(path).read_text(encoding='utf-8')))
