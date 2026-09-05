import { useMemo } from 'react';
import { addDays, differenceInCalendarDays, parse } from 'date-fns';
import { useApp } from '../components/AppProvider';
import { Bar } from '../components/common';
import { milestoneProgress } from '../services/projectService';
import { ISO_DATE, todayDate, toISODate } from '../services/timeService';

/** Semester roadmap: month-grouped tree view of course foundations + project milestones. */
export function SemesterPage() {
  const { courses, projects, milestones, settings, tasks, blocks } = useApp();

  const semester = useMemo(() => {
    const now = todayDate();
    const start = settings
      ? parse(settings.semesterStart, ISO_DATE, now)
      : addDays(now, -30);
    const end = settings ? parse(settings.semesterEnd, ISO_DATE, now) : addDays(now, 60);
    const months: { label: string; items: { text: string; dim?: boolean }[] }[] = [];
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      months.push({
        label: `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`,
        items: [],
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    if (courses.length > 0 && months[0]) {
      months[0].items.push({ text: `Course foundations · ${courses.length} 门课程进行中` });
    }

    for (const p of projects) {
      if (p.status === 'DONE') continue;
      const own = milestones.filter((m) => m.projectId === p.id).sort((a, b) => a.order - b.order);
      const doing = own.find((m) => m.status !== 'DONE');
      if (!doing) continue;
      // spread remaining milestones across remaining months
      const remaining = own.filter((m) => m.status !== 'DONE');
      const monthsLeft = Math.max(1, months.length - Math.floor(remaining.length > 0 ? 0 : 0));
      remaining.forEach((m, i) => {
        const target = Math.min(months.length - 1, i + Math.max(0, months.length - monthsLeft));
        if (months[target]) {
          months[target].items.push({
            text: `${p.name} · ${m.name}`,
            dim: m.status === 'DOING' ? false : true,
          });
        }
      });
    }
    return { start, end, months };
  }, [courses, projects, milestones, settings]);

  const teachingWeekNow = settings
    ? Math.max(
        1,
        Math.floor(
          differenceInCalendarDays(todayDate(), parse(settings.semesterStart, ISO_DATE, todayDate())) / 7,
        ) + 1,
      )
    : 1;
  const totalWeeks = settings
    ? Math.max(
        1,
        Math.ceil(
          differenceInCalendarDays(
            parse(settings.semesterEnd, ISO_DATE, todayDate()),
            parse(settings.semesterStart, ISO_DATE, todayDate()),
          ) / 7,
        ),
      )
    : 1;

  const openTasks = tasks.filter((t) => t.status !== 'DONE').length;
  const doneBlocks = blocks.filter((b) => b.status === 'DONE').length;

  return (
    <div>
      <div className="page-header">
        <h1>Semester</h1>
        <span className="sub">
          {toISODate(semester.start)} → {toISODate(semester.end)} · 教学周 {teachingWeekNow}/{totalWeeks}
        </span>
      </div>

      <section className="panel" style={{ marginBottom: 14 }}>
        <h2>Semester Progress</h2>
        <Bar percent={(teachingWeekNow / totalWeeks) * 100} />
        <div className="small muted">
          第 {teachingWeekNow} 周 / 共 {totalWeeks} 周 · {openTasks} 个未完成任务 · {doneBlocks} 个已完成 Block
        </div>
      </section>

      <section className="panel mono" style={{ fontSize: 13 }}>
        <h2>Roadmap</h2>
        {semester.months.map((m, i) => (
          <div key={m.label} style={{ marginBottom: 12 }}>
            <div style={{ color: 'var(--text)' }}>{m.label}</div>
            {i === 0 && <div style={{ color: 'var(--text-faint)' }}>│</div>}
            {m.items.length === 0 ? (
              <div className="faint">│  （暂无安排）</div>
            ) : (
              m.items.map((item, j) => (
                <div key={j} className={item.dim ? 'faint' : 'muted'}>
                  {j === m.items.length - 1 && i === semester.months.length - 1 ? '└──' : '├──'}{' '}
                  {item.text}
                </div>
              ))
            )}
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>Project Milestones</h2>
        {projects
          .filter((p) => p.status === 'ACTIVE' || p.status === 'PAUSED')
          .map((p) => {
            const own = milestones
              .filter((m) => m.projectId === p.id)
              .sort((a, b) => a.order - b.order);
            return (
              <div key={p.id} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{p.name}</span>
                  <span className="mono small faint">{milestoneProgress(own)}%</span>
                </div>
                <div className="mono small muted">
                  {own
                    .map((m) =>
                      m.status === 'DONE' ? `${m.name} ✓` : m.status === 'DOING' ? `${m.name} ●` : `${m.name} ○`,
                    )
                    .join('  ')}
                </div>
              </div>
            );
          })}
      </section>
    </div>
  );
}
