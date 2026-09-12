/** Horizontal progress bar. progress 0..1 (1 = full). */
export function TimerBar({ progress, paused }: { progress: number; paused?: boolean }) {
  const w = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div className={`timerbar${paused ? ' timerbar--paused' : ''}`} role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}>
      <div className="timerbar__fill" style={{ width: `${w}%` }} />
    </div>
  );
}
