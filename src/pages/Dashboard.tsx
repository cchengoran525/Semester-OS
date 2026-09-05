import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { useApp } from '../components/AppProvider';
import {
  Bar,
  BlockCard,
  EmptyState,
  HealthDot,
  TaskRow,
  TypeTag,
} from '../components/common';
import { makeLabelResolver } from '../components/labels';
import * as repos from '../storage/repositories';
import { useToast } from '../store/uiStore';
import {
  BLOCK_TYPE_LABELS,
  type Block,
  type BlockType,
  type Task,
} from '../domain/types';
import {
  blocksOnDate,
  deepWorkBreakdown,
  filterBlocks,
  isCurrentBlock,
  attentionAllocation,
} from '../services/statistics';
import { courseWarnings, debtSummary, healthDrift, suggestHealth } from '../services/courseService';
import { milestoneProgress, currentMilestone, wipStatus } from '../services/projectService';
import { rankTasks, suggestBlocks, freeWindows, type Suggestion } from '../services/scheduler';
import { scheduleBlocksForDate } from '../services/scheduleService';
import {
  atTime,
  durationLabel,
  getWeekInfo,
  minutesBetween,
  todayDate,
  toISODate,
} from '../services/timeService';
import { handleTaskDrop } from '../services/dropActions';

const ALL_TYPES: BlockType[] = ['COURSE', 'DEEP_WORK', 'ENGINEERING', 'ENGLISH', 'ADMIN', 'RECOVERY'];

export function Dashboard() {
  const { courses, projects, milestones, tasks, blocks, outcomes, settings } = useApp();
  const show = useToast((s) => s.show);
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);

  const labels = useMemo(
    () => makeLabelResolver(projects, courses),
    [projects, courses],
  );

  const today = todayDate();
  const todayISO = toISODate(today);
  const week = getWeekInfo(today, settings?.weekStartDay ?? 1);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const schedBlocksToday = useMemo(
    () => scheduleBlocksForDate(today, courses, settings ?? { semesterStart: todayISO }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todayISO, courses, settings?.semesterStart],
  );

  const todayUserBlocks = useMemo(
    () => blocksOnDate(blocks, todayISO),
    [blocks, todayISO],
  );
  const todayAll = useMemo(
    () => [...schedBlocksToday, ...todayUserBlocks].sort((a, b) => a.start.localeCompare(b.start)),
    [schedBlocksToday, todayUserBlocks],
  );

  const weekFrom = atTime(week.startDate, '00:00');
  const weekTo = atTime(week.endDate, '23:59');
  const weekBlocks = useMemo(
    () => filterBlocks(blocks, { from: weekFrom, to: weekTo }),
    [blocks, weekFrom, weekTo],
  );
  const weekMinutesByType = useMemo(() => {
    const m = new Map<BlockType, number>();
    for (const b of weekBlocks) {
      m.set(b.type, (m.get(b.type) ?? 0) + (b.actualMinutes ?? minutesBetween(b.start, b.end)));
    }
    return m;
  }, [weekBlocks]);
  const maxWeekMinutes = Math.max(60, ...[...weekMinutesByType.values()]);

  const deepWork = useMemo(() => deepWorkBreakdown(weekBlocks), [weekBlocks]);
  const allocation = useMemo(() => attentionAllocation(weekBlocks), [weekBlocks]);

  const weekOutcomes = useMemo(
    () => outcomes.filter((o) => o.weekId === week.id),
    [outcomes, week.id],
  );

  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === 'ACTIVE'),
    [projects],
  );
  const wip = wipStatus(projects, settings?.wipLimit ?? 2);

  const warnings = useMemo(
    () => [...courseWarnings(courses), ...healthDrift(courses)],
    [courses],
  );

  // Scheduler suggestions (deterministic, explainable)
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!settings) return [];
    const contextMinutes: Record<string, number> = {};
    for (const b of weekBlocks) {
      if ((b.type === 'DEEP_WORK' || b.type === 'ENGINEERING') && b.context) {
        contextMinutes[b.context] = (contextMinutes[b.context] ?? 0) + minutesBetween(b.start, b.end);
      }
    }
    const ranked = rankTasks(tasks, {
      courses,
      projects,
      contextMinutesThisWeek: contextMinutes,
      now: today,
    });
    const windowList: { date: string; window: { start: string; end: string; minutes: number } }[] = [];
    // Look at next 7 days
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getTime() + i * 86400000);
      const dateISO = toISODate(d);
      const sched = scheduleBlocksForDate(d, courses, settings);
      const dayBlocks = [
        ...blocks.filter((b) => b.start.slice(0, 10) === dateISO),
        ...sched,
      ];
      for (const w of freeWindows(atTime(dateISO, '08:00'), atTime(dateISO, '22:00'), dayBlocks, 60)) {
        windowList.push({ date: dateISO, window: w });
      }
    }
    return suggestBlocks({
      ranked,
      windows: windowList,
      contextLabel: (t) => t.projectId ?? t.courseId ?? labels.taskContext(t),
      maxSuggestions: 3,
    });
  }, [tasks, courses, projects, blocks, settings, today, weekBlocks, labels]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith('task-')) {
      setDraggingTask(taskById.get(id.slice(5)) ?? null);
    }
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setDraggingTask(null);
    const { active, over } = e;
    if (!over || !settings) return;
    const data = active.data.current;
    if (!data || data.kind !== 'task') return;
    const task = taskById.get(data.taskId);
    if (!task) return;
    const overData = over.data.current;
    if (!overData) return;

    try {
      if (overData.kind === 'block' && overData.blockId) {
        const res = await handleTaskDrop(task, { kind: 'block', blockId: overData.blockId }, { courses, settings, existingBlocks: blocks });
        show(res.message);
      } else if (overData.kind === 'day' && overData.dateISO) {
        const res = await handleTaskDrop(task, { kind: 'day', dateISO: overData.dateISO }, { courses, settings, existingBlocks: blocks });
        show(res.message);
      }
    } catch {
      show('操作失败，请重试', 'error');
    }
  };

  const openTasks = useMemo(
    () => tasks.filter((t) => t.status === 'READY' || t.status === 'DOING').slice(0, 8),
    [tasks],
  );

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="page-header">
        <h1>Dashboard</h1>
        <span className="sub">WEEK {String(week.weekNumber).padStart(2, '0')} · {week.startDate} → {week.endDate}</span>
      </div>

      {warnings.length > 0 && (
        <div className="warning-banner">
          <AlertTriangle size={14} />
          {warnings.slice(0, 2).map((w) => w.message).join('　')}
          {warnings.length > 2 && <span className="faint">（还有 {warnings.length - 2} 项）</span>}
        </div>
      )}

      <div className="dashboard-grid">
        {/* TODAY */}
        <section className="panel" data-testid="today-panel">
          <h2>Today</h2>
          {todayAll.length === 0 ? (
            <EmptyState>今天还没有安排。把任务拖到这里，或按 B 创建 Block。</EmptyState>
          ) : (
            todayAll.map((b) => (
              <BlockCard
                key={b.id}
                block={b}
                label={labels.contextLabel(b.context)}
                tasks={b.taskIds.map((id) => taskById.get(id)).filter((t): t is Task => !!t)}
                current={isCurrentBlock(b, today)}
                droppable
              />
            ))
          )}
        </section>

        {/* THIS WEEK */}
        <section className="panel">
          <h2>This Week</h2>
          {ALL_TYPES.map((type) => {
            const mins = weekMinutesByType.get(type) ?? 0;
            return (
              <div key={type} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="mono small muted">{BLOCK_TYPE_LABELS[type]}</span>
                  <span className="mono small faint">{durationLabel(mins)}</span>
                </div>
                <Bar percent={(mins / maxWeekMinutes) * 100} />
              </div>
            );
          })}
          <div className="faint small" style={{ marginTop: 10 }}>
            Deep Work This Week
            <span className="mono" style={{ marginLeft: 8, fontSize: 15, color: 'var(--text)' }}>
              {durationLabel(deepWork.totalMinutes)}
            </span>
          </div>
          {Object.entries(deepWork.byContext)
            .sort((a, b) => b[1] - a[1])
            .map(([ctx, mins]) => (
              <div key={ctx} className="mono small muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{labels.contextLabel(ctx)}</span>
                <span>{durationLabel(mins)}</span>
              </div>
            ))}
        </section>

        {/* COURSE HEALTH */}
        <section className="panel">
          <h2>Course Health</h2>
          {courses.map((c) => {
            const suggested = suggestHealth(c.debt);
            const expanded = expandedCourse === c.id;
            return (
              <div key={c.id}>
                <button
                  className="btn subtle small"
                  style={{ width: '100%', textAlign: 'left', marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}
                  onClick={() => setExpandedCourse(expanded ? null : c.id)}
                  aria-expanded={expanded}
                >
                  <span>
                    <HealthDot health={c.health} />
                    {c.name}
                  </span>
                  <span className="mono faint small">
                    {c.health}
                    {suggested !== c.health ? ` (建议 ${suggested})` : ''}
                    {expanded ? <ChevronDown size={12} style={{ marginLeft: 6, verticalAlign: -2 }} /> : <ChevronRight size={12} style={{ marginLeft: 6, verticalAlign: -2 }} />}
                  </span>
                </button>
                {expanded && (
                  <div className="small muted" style={{ padding: '2px 10px 8px' }}>
                    <div className="mono">Understanding Debt: {c.debt.understanding}</div>
                    <div className="mono">Assignment Debt: {c.debt.assignment}</div>
                    <div className="mono">Review Debt: {c.debt.review}</div>
                    <div className="mono">Exam Debt: {c.debt.exam}</div>
                    <div className="faint" style={{ marginTop: 4 }}>{debtSummary(c.debt)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* ACTIVE PROJECTS */}
        <section className="panel">
          <h2>Active Projects · WIP {wip.activeCount}/{wip.limit}</h2>
          {activeProjects.length === 0 && <EmptyState>没有 Active 项目。</EmptyState>}
          {activeProjects.map((p) => {
            const ms = currentMilestone(p, milestones);
            const pct = milestoneProgress(milestones.filter((m) => m.projectId === p.id));
            return (
              <div key={p.id} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{p.name}</span>
                  <span className="mono small faint">{pct}%</span>
                </div>
                <div className="small muted">{ms ? ms.name : '—'}</div>
                <Bar percent={pct} />
              </div>
            );
          })}
          {wip.atLimit && (
            <div className="faint small">已有 {wip.activeCount} 个 Active Projects，新项目建议进入 Backlog。</div>
          )}
        </section>

        {/* THIS WEEK OUTCOMES */}
        <section className="panel">
          <h2>This Week Outcomes</h2>
          {weekOutcomes.length === 0 && <EmptyState>本周还没有设定 Outcomes。建议 3–5 个。</EmptyState>}
          {weekOutcomes.map((o) => (
            <div key={o.id} className="task-row" style={{ paddingLeft: 0 }}>
              <button
                className={`checkbox ${o.status === 'DONE' ? 'checked' : ''}`}
                aria-label="完成 outcome"
                onClick={() => repos.outcomeRepo.update(o.id, { status: o.status === 'DONE' ? 'OPEN' : 'DONE' })}
              >
                {o.status === 'DONE' ? '✓' : ''}
              </button>
              <span className="title" style={{ flex: 1 }}>{o.title}</span>
              <span className="mono faint small">{o.linkedTaskIds.length} tasks</span>
            </div>
          ))}
        </section>

        {/* SUGGESTIONS */}
        <section className="panel">
          <h2>Suggested Next</h2>
          {suggestions.length === 0 && (
            <EmptyState>暂无可排建议 —— 给任务填写 estimate 后会出现在这里。</EmptyState>
          )}
          {suggestions.map((s) => (
            <div key={s.task.id} className="row-item" style={{ display: 'block' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong className="small">{s.task.title}</strong>
                <TypeTag type={s.type} />
              </div>
              <div className="mono small muted" style={{ margin: '3px 0' }}>
                {s.blockStart.slice(5, 10)} {s.blockStart.slice(11, 16)}–{s.blockEnd.slice(11, 16)} · {labels.contextLabel(s.context)}
              </div>
              <ul className="faint small" style={{ margin: '2px 0 6px', paddingLeft: 16 }}>
                {s.reasons.slice(0, 3).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn small primary"
                  onClick={async () => {
                    await repos.blockRepo.create({
                      start: s.blockStart,
                      end: s.blockEnd,
                      type: s.type,
                      source: 'SUGGESTED',
                      context: s.context,
                      taskIds: [s.task.id],
                      status: 'PLANNED',
                      plannedMinutes: s.task.estimateMinutes,
                    });
                    show(`已按建议创建 Block：${s.task.title}`);
                  }}
                >
                  Accept
                </button>
                <button
                  className="btn small subtle"
                  onClick={() => show('已忽略该建议')}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </section>

        {/* READY TASKS (draggable) */}
        <section className="panel">
          <h2>Ready · 拖到 Today 或 Calendar</h2>
          {openTasks.length === 0 && <EmptyState>没有待排任务。</EmptyState>}
          {openTasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              contextLabel={labels.taskContext(t)}
              draggable
              onToggle={() =>
                t.status === 'DONE'
                  ? repos.taskRepo.reopen(t.id)
                  : repos.taskRepo.complete(t.id)
              }
            />
          ))}
        </section>

        {/* ATTENTION ALLOCATION */}
        <section className="panel">
          <h2>Attention Allocation</h2>
          {allocation.length === 0 && <EmptyState>本周还没有 Block 数据。</EmptyState>}
          {allocation.map((a) => (
            <div key={a.type} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="mono small muted">{BLOCK_TYPE_LABELS[a.type]}</span>
              <span className="mono small">
                {a.percent}% <span className="faint">({durationLabel(a.minutes)})</span>
              </span>
            </div>
          ))}
        </section>
      </div>

      <DragOverlay>
        {draggingTask ? (
          <div className="tag" style={{ padding: '4px 10px' }}>
            {draggingTask.title}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export type { Block };
