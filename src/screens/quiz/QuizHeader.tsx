import { IconFlame } from '../../components/ui/icons';
import type { Stats } from '../../state/stats';

/** Idle header (§5.7): large title + three blur-free `.glass-clear` stat pills (정답률 · 🔥 연속 · 최고). */
export function QuizHeader({ stats }: { stats: Stats }) {
  const accuracy = stats.total ? Math.round((stats.totalCorrect / stats.total) * 100) : null;
  return (
    <header className="quiz-head">
      <h1 className="t-title-l">퀴즈</h1>
      <div className="quiz-pills" aria-label="퀴즈 성적">
        <span className="quiz-pill glass-clear glass-flat tnum" title="정답률">
          {accuracy == null ? '–' : `${accuracy}%`}
        </span>
        <span className={`quiz-pill glass-clear glass-flat tnum${stats.streak >= 3 ? ' quiz-pill--hot' : ''}`} title="연속 정답">
          <IconFlame size={16} />
          {stats.streak}
        </span>
        <span className="quiz-pill glass-clear glass-flat tnum" title="최고 연속">
          최고 {stats.bestStreak}
        </span>
      </div>
    </header>
  );
}
