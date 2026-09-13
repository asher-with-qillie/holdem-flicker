#!/usr/bin/env bash
# Noto Sans KR (가변 400~800) 셀프 호스팅 파일을 다시 받아옵니다.
#
#   bash scripts/fetch-fonts.sh
#
# Google Fonts CSS를 크롬 UA로 요청하면 woff2 서브셋 124개를 unicode-range와 함께 내려줍니다.
# 그 파일들을 public/fonts/noto-sans-kr/ 에 그대로 저장하고, 같은 unicode-range를 가진
# src/styles/fonts.css 를 다시 생성합니다. 폰트 버전(v39 등)이 올라갔을 때만 실행하면 됩니다.
set -euo pipefail
cd "$(dirname "$0")/.."

UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
SRC='https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400..800&display=swap'
OUT_DIR='public/fonts/noto-sans-kr'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -sS --retry 3 -A "$UA" "$SRC" -o "$TMP/noto.css"
grep -c '@font-face' "$TMP/noto.css" >/dev/null

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
grep -o 'https://fonts.gstatic.com/[^)]*\.woff2' "$TMP/noto.css" \
  | xargs -P 8 -I{} sh -c 'curl -sS --retry 3 -o "'"$OUT_DIR"'/$(basename "{}")" "{}"'

# 폰트를 저장소에 같이 담아 배포하므로 라이선스 전문도 옆에 둡니다 (SIL OFL 1.1).
{
  printf 'Noto Sans KR — Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name "Source".\n'
  printf '출처: Google Fonts (https://fonts.google.com/noto/specimen/Noto+Sans+KR)\n'
  printf '원본 저장소: https://github.com/notofonts/noto-cjk\n\n'
  curl -sS --retry 3 'https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE'
} > "$OUT_DIR/OFL.txt"

python3 - "$TMP/noto.css" > src/styles/fonts.css <<'PY'
import re, sys

css = open(sys.argv[1], encoding='utf-8').read()
head = """/* Noto Sans KR (variable, 400~800) — 셀프 호스팅.
   Google Fonts가 내려주는 woff2 서브셋을 public/fonts/noto-sans-kr/ 에 그대로 담아 두고,
   unicode-range도 원본 그대로 유지합니다. 브라우저는 실제로 쓰는 글자의 조각만 내려받습니다.
   외부 요청이 없으니 오프라인·사내망·프록시 환경에서도 폰트가 항상 뜹니다.
   scripts/fetch-fonts.sh 가 생성하는 파일입니다. 직접 손대지 마세요. */
"""
faces = []
for block in re.findall(r'@font-face \{(.*?)\}', css, re.S):
    name = re.search(r'url\(https://fonts\.gstatic\.com/[^)]*/([^/)]+\.woff2)\)', block).group(1)
    rng = re.search(r'unicode-range:\s*([^;]+);', block).group(1).strip()
    faces.append(
        "@font-face {\n"
        "  font-family: 'Noto Sans KR';\n"
        "  font-style: normal;\n"
        "  font-weight: 400 800;\n"
        "  font-display: swap;\n"
        f"  src: url('/fonts/noto-sans-kr/{name}') format('woff2');\n"
        f"  unicode-range: {rng};\n"
        "}"
    )
print(head)
print("\n".join(faces))
PY

echo "woff2 $(ls "$OUT_DIR"/*.woff2 | wc -l)개, @font-face $(grep -c '@font-face' src/styles/fonts.css)개, OFL.txt $(wc -l < "$OUT_DIR/OFL.txt")줄"
