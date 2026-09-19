import { useMemo, useRef, useState } from 'react';
import { addDays, differenceInCalendarDays, parse } from 'date-fns';
import { useApp } from '../components/AppProvider';
import { Bar } from '../components/common';
import { milestoneProgress } from '../services/projectService';
import * as repos from '../storage/repositories';
import { useToast } from '../store/uiStore';
import { ISO_DATE, todayDate, toISODate } from '../services/timeService';

/** Semester roadmap: month-grouped tree view of course foundations + project milestones. */
export function SemesterPage() {
  const { courses, projects, milestones, settings, tasks, blocks } = useApp();
  const show = useToast((s) => s.show);
  // 路线图备注：本地草稿优先（IME 合成不被落库回填打断），防抖合并写入
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const draftsRef = useRef(notesDraft);
  draftsRef.current = notesDraft;
  const noteTimer = useRef<number | null>(null);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const saveNote = (label: string, text: string) => {
    setNotesDraft((d) => ({ ...d, [label]: text }));
    if (noteTimer.current != null) clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => {
      void repos.settingsRepo.save({
        roadmapNotes: {
          ...(settings?.roadmapNotes ?? {}),
          ...draftsRef.current,
          [label]: text,
        },
      });
    }, 400);
  };
  const [editing, setEditing] = useState(false);
  const [draftStart, setDraftStart] = useState(settings?.semesterStart ?? '');
  const [draftEnd, setDraftEnd] = useState(settings?.semesterEnd ?? '');
  const [draftWip, setDraftWip] = useState(settings?.wipLimit ?? 2);

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
      months[0].items.push({ text: `课程基础 · ${courses.length} 门课程进行中` });
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
        <h1>学期</h1>
        <span className="sub">
          {toISODate(semester.start)} → {toISODate(semester.end)} · 教学周 {teachingWeekNow}/{totalWeeks}
        </span>
      </div>

      <section className="panel" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>学期进度</h2>
          <button
            className="btn small"
            onClick={() => {
              if (!editing && settings) {
                setDraftStart(settings.semesterStart);
                setDraftEnd(settings.semesterEnd);
                setDraftWip(settings.wipLimit);
              }
              setEditing(!editing);
            }}
          >
            {editing ? '取消' : '✎ 编辑'}
          </button>
        </div>
        <Bar percent={(teachingWeekNow / totalWeeks) * 100} />
        <div className="small muted">
          第 {teachingWeekNow} 周 / 共 {totalWeeks} 周 · {openTasks} 个未完成任务 · {doneBlocks} 个已完成 Block
        </div>

        {editing && (
          <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field">
              <span>学期开始</span>
              <input type="date" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} />
            </label>
            <label className="field">
              <span>学期结束</span>
              <input type="date" value={draftEnd} onChange={(e) => setDraftEnd(e.target.value)} />
            </label>
            <label className="field">
              <span>WIP 上限（进行中项目数）</span>
              <input
                type="number"
                min={1}
                max={8}
                value={draftWip}
                style={{ width: 70 }}
                onChange={(e) => setDraftWip(Number(e.target.value))}
              />
            </label>
            <button
              className="btn primary"
              onClick={async () => {
                if (!draftStart || !draftEnd || draftEnd <= draftStart) {
                  show('学期结束需要晚于开始', 'error');
                  return;
                }
                if (draftWip < 1) {
                  show('WIP 上限至少为 1', 'error');
                  return;
                }
                await repos.settingsRepo.save({
                  semesterStart: draftStart,
                  semesterEnd: draftEnd,
                  wipLimit: draftWip,
                });
                setEditing(false);
                show('学期设置已保存');
              }}
            >
              保存
            </button>
          </div>
        )}
      </section>

      <section className="panel mono" style={{ fontSize: 13 }}>
        <h2>路线图</h2>
        <div className="faint small" style={{ fontFamily: 'inherit', marginBottom: 8 }}>
          自动生成：课程基础 + 各项目的剩余里程碑按月份铺开。点每月右侧「✎ 备注」写下自己的安排（每行一条），随输随存。
        </div>
        {semester.months.map((m, i) => {
          const noteVal = notesDraft[m.label] ?? settings?.roadmapNotes?.[m.label] ?? '';
          const noteLines = noteVal.split('\n').filter((l) => l.trim());
          const lastMonth = i === semester.months.length - 1;
          const lines = [
            ...m.items.map((it) => ({ text: it.text, dim: it.dim, mine: false })),
            ...noteLines.map((l) => ({ text: l, dim: false, mine: true })),
          ];
          const editing = editingNote === m.label;
          return (
            <div key={m.label} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ color: 'var(--text)' }}>{m.label}</div>
                <button
                  className="btn small subtle"
                  onClick={() => setEditingNote(editing ? null : m.label)}
                >
                  {editing ? '收起' : '✎ 备注'}
                </button>
              </div>
              {i === 0 && <div style={{ color: 'var(--text-faint)' }}>│</div>}
              {lines.length === 0 && !editing && (
                <div className="faint">│  （暂无安排）</div>
              )}
              {lines.map((item, j) => {
                const isLast = j === lines.length - 1 && lastMonth && !editing;
                return (
                  <div
                    key={j}
                    className={item.mine ? 'small' : item.dim ? 'faint' : 'muted'}
                    style={item.mine ? { color: 'var(--accent)' } : undefined}
                  >
                    {isLast ? '└──' : '├──'} {item.mine ? '✎ ' : ''}
                    {item.text}
                  </div>
                );
              })}
              {editing && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <span className="faint">│</span>
                  <textarea
                    rows={3}
                    autoFocus
                    value={noteVal}
                    placeholder="每行一条，可写多项…"
                    aria-label={`${m.label} 备注`}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px dashed var(--border)',
                      color: 'var(--text)',
                      fontFamily: 'inherit',
                      fontSize: 12.5,
                      lineHeight: 1.6,
                      padding: '2px 0',
                      flex: 1,
                      resize: 'vertical',
                    }}
                    onChange={(e) => saveNote(m.label, e.target.value)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="panel">
        <h2>项目里程碑</h2>
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
