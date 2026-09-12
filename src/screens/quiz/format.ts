/** First Korean sentence of a paragraph (cuts at the first "…다." / "…요." followed by a space or the end). */
export function firstSentence(text: string): string {
  const m = text.match(/^.+?(?:다|요|니다)\.(?=\s|$)/);
  return m ? m[0] : text;
}

export function pct(w: number): string {
  return `${Math.round(w * 100)}%`;
}

/** Relative time label for the mistakes list. */
export function formatAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return '방금';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.round(h / 24);
  if (d === 1) return '어제';
  return `${d}일 전`;
}
