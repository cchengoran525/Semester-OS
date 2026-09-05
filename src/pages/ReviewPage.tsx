import { useMemo, useState } from 'react';
import { addWeeks } from 'date-fns';
import { useApp } from '../components/AppProvider';
import { EmptyState, HealthDot } from '../components/common';
import * as repos from '../storage/repositories';
import { useToast } from '../store/uiStore';
import { REVIEW_QUESTIONS, type ReviewQuestionKey } from '../domain/types';
import { attentionAllocation, deepWorkBreakdown, filterBlocks } from '../services/statistics';
import { atTime, durationLabel, formatDateShort, getWeekInfo, todayDate } from '../services/timeService';
import { courseWarnings } from '../services/courseService';

export function ReviewPage() {
  const { courses, projects, milestones, tasks, blocks, reviews, settings } = useApp();
  const show = useToast((s) => s.show);
  const [weekOffset, setWeekOffset] = useState(0);
  const [answers, setAnswers] = useState<Partial<Record<ReviewQuestionKey, string>>>({});
  const [loadedWeekId, setLoadedWeekId] = useState<string | null>(null);

  const week = useMemo(
    () => getWeekInfo(addWeeks(todayDate(), weekOffset), settings?.weekStartDay ?? 1),
    [weekOffset, settings?.weekStartDay],
  );

  const review = reviews.find((r) => r.weekId === week.id);
  if (review && loadedWeekId !== week.id) {
    setLoadedWeekId(week.id);
    setAnswers(review.answers);
  }

  const weekFrom = atTime(week.startDate, '00:00');
  const weekTo = atTime(week.endDate, '23:59');
  const weekBlocks = useMemo(
    () => filterBlocks(blocks, { from: weekFrom, to: weekTo }),
    [blocks, weekFrom, weekTo],
  );

  const completedTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.status === 'DONE' &&
          t.completedAt != null &&
          t.completedAt.slice(0, 10) >= week.startDate &&
          t.completedAt.slice(0, 10) <= week.endDate,
      ),
    [tasks, week],
  );

  const deepWork = useMemo(() => deepWorkBreakdown(weekBlocks), [weekBlocks]);
  const allocation = useMemo(() => attentionAllocation(weekBlocks), [weekBlocks]);
  const warnings = useMemo(() => courseWarnings(courses), [courses]);

  const projectProgressLines = useMemo(
    () =>
      projects
        .filter((p) => p.status === 'ACTIVE')
        .map((p) => {
          const done = milestones.filter(
            (m) => m.projectId === p.id && m.status === 'DONE',
          ).length;
          const taskDone = tasks.filter((t) => t.projectId === p.id && t.status === 'DONE').length;
          return `${p.name} · +${done} milestones / +${taskDone} tasks`;
        }),
    [projects, milestones, tasks],
  );

  const save = async () => {
    await repos.reviewRepo.save({
      id: week.id,
      weekId: week.id,
      answers,
      createdAt: new Date().toISOString(),
    });
    show('Weekly Review 已保存');
  };

  return (
    <div>
      <div className="page-header">
        <h1>Weekly Review</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span className="sub">WEEK {String(week.weekNumber).padStart(2, '0')}</span>
          <button className="btn small" onClick={() => setWeekOffset(weekOffset - 1)}>‹</button>
          <button className="btn small" onClick={() => setWeekOffset(0)}>本周</button>
          <button className="btn small" onClick={() => setWeekOffset(weekOffset + 1)}>›</button>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <h2>Completed · {week.startDate} → {week.endDate}</h2>
          <div className="mono" style={{ marginBottom: 4 }}>
            Tasks completed: <strong>{completedTasks.length}</strong>
          </div>
          <div className="mono">
            Deep Work: <strong>{durationLabel(deepWork.totalMinutes)}</strong>
          </div>
          {Object.entries(deepWork.byContext)
            .sort((a, b) => b[1] - a[1])
            .map(([ctx, mins]) => (
              <div key={ctx} className="mono small muted">
                {ctx} {durationLabel(mins)}
              </div>
            ))}
          <h2 style={{ marginTop: 16 }}>Estimate vs Actual</h2>
          {completedTasks
            .filter((t) => t.actualMinutes != null && t.estimateMinutes > 0)
            .slice(0, 8)
            .map((t) => (
              <div key={t.id} className="mono small muted">
                {t.title}: {t.estimateMinutes}m → {t.actualMinutes}m
              </div>
            ))}
        </section>

        <section className="panel">
          <h2>Course</h2>
          {courses.map((c) => (
            <div key={c.id} className="small">
              <HealthDot health={c.health} />
              {c.name} <span className="mono faint">{c.health}</span>
            </div>
          ))}
          <h2 style={{ marginTop: 16 }}>Projects</h2>
          {projectProgressLines.map((l) => (
            <div key={l} className="small muted">
              {l}
            </div>
          ))}
          <h2 style={{ marginTop: 16 }}>Attention</h2>
          {allocation.length === 0 && <EmptyState>本周没有 Block 数据。</EmptyState>}
          {allocation.map((a) => (
            <div key={a.type} className="mono small muted">
              {a.type} {a.percent}% ({durationLabel(a.minutes)})
            </div>
          ))}
          {warnings.length > 0 && (
            <div className="warning-banner" style={{ marginTop: 12 }}>
              风险课程：{warnings.map((w) => w.courseName).join('、')}
            </div>
          )}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 14 }}>
        <h2>Review · {formatDateShort(atTime(week.startDate, '00:00'))}</h2>
        {REVIEW_QUESTIONS.map((q) => (
          <label className="field" key={q.key}>
            <span>{q.text}</span>
            <textarea
              rows={2}
              value={answers[q.key] ?? ''}
              onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })}
            />
          </label>
        ))}
        <div className="actions">
          <button className="btn primary" onClick={save}>
            保存 Review
          </button>
        </div>
      </section>
    </div>
  );
}
