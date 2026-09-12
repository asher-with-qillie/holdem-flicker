import type { Stats } from '../../state/stats';

/** Title row + accuracy / streak / best streak tiles. */
export function QuizHeader({ stats }: { stats: Stats }) {
  const accuracy = stats.total ? Math.round((stats.totalCorrect / stats.total) * 100) : null;
  return (
    <header className="quiz-header">
      <div className="quiz-header__title">
        <h1 className="screen__title">퀴즈</h1>
        <span className="quiz-header__sub">{stats.total ? `${stats.total}문제 풀이` : '정답을 골라 보세요'}</span>
      </div>
      <div className="quiz-stats" aria-label="퀴즈 성적">
        <div className="quiz-stat">
          <span className="quiz-stat__value">{accuracy == null ? '–' : `${accuracy}%`}</span>
          <span className="quiz-stat__label">정답률</span>
        </div>
        <div className={`quiz-stat${stats.streak >= 3 ? ' quiz-stat--hot' : ''}`}>
          <span className="quiz-stat__value">{stats.streak}</span>
          <span className="quiz-stat__label">연속</span>
        </div>
        <div className="quiz-stat">
          <span className="quiz-stat__value">{stats.bestStreak}</span>
          <span className="quiz-stat__label">최고</span>
        </div>
      </div>
    </header>
  );
}
