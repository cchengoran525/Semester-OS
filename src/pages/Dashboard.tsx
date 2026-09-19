import { useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { useApp } from '../components/AppProvider';
import {
  AIThinking,
  Bar,
  BlockCard,
  DayTimeline,
  DropZone,
  EmptyState,
  HealthDot,
  TaskRow,
  TypeTag,
} from '../components/common';
import { makeLabelResolver } from '../components/labels';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { BlockDetailModal } from '../components/BlockDetailModal';
import * as repos from '../storage/repositories';
import { useDismissedSuggestions, useToast, useUndo } from '../store/uiStore';
import {
  BLOCK_TYPE_LABELS,
  HEALTH_LABELS,
  type Block,
  type BlockType,
  type Task,
} from '../domain/types';
import {
  attentionAllocation,
  blocksOnDate,
  deepWorkBreakdown,
  filterBlocks,
  isCurrentBlock,
  openUnscheduledTasks,
} from '../services/statistics';
import { courseWarnings, debtSummary, healthDrift, suggestHealth } from '../services/courseService';
import { milestoneProgress, currentMilestone, wipStatus } from '../services/projectService';
import {
  rankTasks,
  scheduledTaskIds,
  suggestBlocks,
  type Suggestion,
} from '../services/scheduler';
import { scheduleBlocksForDate } from '../services/scheduleService';
import { aiConfig, deepAIConfig } from '../services/ai/config';
import {
  reviewGap,
  suggestWeeklyPlan,
  type GapFinding,
  type PlannedBlock,
} from '../services/ai/features';
import { collectUpcomingWindows } from '../services/planning';
import {
  atTime,
  durationLabel,
  getWeekInfo,
  minutesBetween,
  todayDate,
  toISODate,
} from '../services/timeService';
import {
  handleBlockUnschedule,
  handleTaskDrop,
  handleTaskUnschedule,
  removeBlockWithUndo,
} from '../services/dropActions';

const ALL_TYPES: BlockType[] = ['COURSE', 'DEEP_WORK', 'ENGINEERING', 'ENGLISH', 'ADMIN', 'RECOVERY'];

const WEEKDAY_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function Dashboard() {
  const { courses, projects, milestones, tasks, blocks, outcomes, settings } = useApp();
  const show = useToast((s) => s.show);
  const [expandedCourse, setExpandedCourse] = useState<string | null>(null);
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailBlock, setDetailBlock] = useState<Block | null>(null);
  const [tlPreview, setTlPreview] = useState<{ left: number; width: number } | null>(null);
  const [gaps, setGaps] = useState<GapFinding[] | null>(null);
  const [gapBusy, setGapBusy] = useState(false);
  const [weekPlan, setWeekPlan] = useState<
    { placement: PlannedBlock; task: Task }[] | null
  >(null);
  const [planFocus, setPlanFocus] = useState<string>('');
  const [planBusy, setPlanBusy] = useState(false);
  const [planSel, setPlanSel] = useState<Set<string>>(new Set());
  const [newOutcome, setNewOutcome] = useState('');
  const aiCfg = aiConfig(settings);
  // 周计划是深度规划，走深度模型档（未单独配置时回落到快速模型）
  const deepCfg = deepAIConfig(settings);

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
  const dismissedMap = useDismissedSuggestions((st) => st.dismissed);
  const dismissedRef = useRef(dismissedMap);
  dismissedRef.current = dismissedMap;
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!settings) return [];
    const contextMinutes: Record<string, number> = {};
    for (const b of weekBlocks) {
      if ((b.type === 'DEEP_WORK' || b.type === 'ENGINEERING') && b.context) {
        contextMinutes[b.context] = (contextMinutes[b.context] ?? 0) + minutesBetween(b.start, b.end);
      }
    }
    const alreadyScheduled = scheduledTaskIds(blocks);
    const ranked = rankTasks(
      tasks.filter((t) => !alreadyScheduled.has(t.id)),
      {
        courses,
        projects,
        contextMinutesThisWeek: contextMinutes,
        now: today,
      },
    );
    // 只看未来：今天的窗口从"现在"起算，不会建议把任务排到过去
    const windowList: { date: string; window: { start: string; end: string; minutes: number } }[] =
      collectUpcomingWindows(today, courses, settings, blocks, 7, 60).map((w) => ({
        date: w.date,
        window: { start: atTime(w.date, w.start), end: atTime(w.date, w.end), minutes: w.minutes },
      }));
    const suggestions = suggestBlocks({
      ranked,
      windows: windowList,
      contextLabel: (t) => t.projectId ?? t.courseId ?? labels.taskContext(t),
      maxSuggestions: 3,
    });
    // 已忽略的建议（持久化，7 天过期）不再出现
    return suggestions.filter((s) => !dismissedRef.current[s.task.id]);
  }, [tasks, courses, projects, blocks, settings, today, weekBlocks, labels, dismissedMap]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const push = useUndo((s) => s.push);
  const dismissSuggestion = useDismissedSuggestions((st) => st.dismiss);

  /** Delete a block from the UI with toast + undo support. */
  const deleteBlock = async (block: Block) => {
    const res = await removeBlockWithUndo(block);
    push({ label: res.message, undo: res.undo });
    show(`${res.message} · ⌘Z 可撤销`);
  };

  /** Close this attention block: status DONE + actual minutes. Independent of task completion. */
  const completeBlock = async (block: Block) => {
    const previous = { status: block.status, actualMinutes: block.actualMinutes };
    const actual = minutesBetween(block.start, block.end);
    await repos.blockRepo.update(block.id, { status: 'DONE', actualMinutes: actual });
    push({
      label: '完成时间块',
      undo: () => repos.blockRepo.update(block.id, previous),
    });
    show(`时间块已完成 · 实际 ${durationLabel(actual)} · ⌘Z 可撤销`);
  };

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith('task-')) {
      setDraggingTask(taskById.get(id.slice(5)) ?? null);
    }
  };

  // 时间轴落点计算：横坐标百分比 → 时刻，长度 = 任务预估（截到空闲窗口末尾）
  const computeSlot = (overRect: DOMRect, clientX: number, estimateMinutes: number) => {
    const pct = Math.min(1, Math.max(0, (clientX - overRect.left) / overRect.width));
    const dropMin = 8 * 60 + Math.round(pct * (22 * 60 - 8 * 60));
    const hh = String(Math.floor(dropMin / 60)).padStart(2, '0');
    const mm = String(dropMin % 60).padStart(2, '0');
    const dropAt = atTime(todayISO, `${hh}:${mm}`);
    const win = todayFree.find((w) => w.start <= dropAt && dropAt < w.end);
    if (!win) return null;
    const avail = minutesBetween(dropAt, win.end);
    const minutes = Math.min(estimateMinutes || 90, Math.max(15, avail));
    const left = ((dropMin - 8 * 60) / (22 * 60 - 8 * 60)) * 100;
    return { start: dropAt, minutes, left, width: (minutes / (22 * 60 - 8 * 60)) * 100 };
  };

  // 悬停时间轴时显示落点预览影子
  const onDragOver = (e: DragOverEvent) => {
    const data = e.active.data.current;
    const overData = e.over?.data.current;
    if (!data || data.kind !== 'task' || overData?.kind !== 'timeline' || !e.over) {
      setTlPreview(null);
      return;
    }
    const translated = e.active.rect.current.translated;
    if (!translated) return;
    const task = taskById.get(String(e.active.id).slice(5));
    const slot = computeSlot(
      e.over.rect as DOMRect,
      translated.left + translated.width / 2,
      task?.estimateMinutes ?? 90,
    );
    setTlPreview(slot ? { left: slot.left, width: slot.width } : null);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setDraggingTask(null);
    setTlPreview(null);
    const { active, over } = e;
    if (!over || !settings) return;
    const data = active.data.current;
    if (!data) return;
    const overData = over.data.current;
    if (!overData) return;

    try {
      if (data.kind === 'block' && overData.kind === 'backlog') {
        const block = blocks.find((b) => b.id === data.blockId);
        if (block) {
          const res = await handleBlockUnschedule(block);
          show(res.message);
          if (res.undo) push({ label: res.message, undo: res.undo });
        }
        return;
      }
      if (data.kind !== 'task') return;
      const task = taskById.get(data.taskId);
      if (!task) return;

      if (overData.kind === 'block' && overData.blockId) {
        const res = await handleTaskDrop(task, { kind: 'block', blockId: overData.blockId }, { courses, settings, existingBlocks: blocks });
        show(res.message);
        if (res.undo) push({ label: res.message, undo: res.undo });
      } else if (overData.kind === 'timeline') {
        const translated = active.rect.current.translated;
        if (!translated) return;
        const slot = computeSlot(
          over.rect as DOMRect,
          translated.left + translated.width / 2,
          task.estimateMinutes,
        );
        if (!slot) {
          show('落点已有安排，拖到空白处试试', 'error');
          return;
        }
        const res = await handleTaskDrop(task, { kind: 'slot', start: slot.start, minutes: slot.minutes }, { courses, settings, existingBlocks: blocks });
        show(res.message);
        if (res.undo) push({ label: res.message, undo: res.undo });
      } else if (overData.kind === 'window' && overData.start && overData.end) {
        const res = await handleTaskDrop(task, { kind: 'window', start: overData.start, end: overData.end }, { courses, settings, existingBlocks: blocks });
        show(res.message);
        if (res.undo) push({ label: res.message, undo: res.undo });
      } else if (overData.kind === 'day' && overData.dateISO) {
        const res = await handleTaskDrop(task, { kind: 'day', dateISO: overData.dateISO }, { courses, settings, existingBlocks: blocks });
        show(res.message);
        if (res.undo) push({ label: res.message, undo: res.undo });
      } else if (overData.kind === 'backlog') {
        const res = await handleTaskUnschedule(task, blocks);
        show(res.message);
        if (res.undo) push({ label: res.message, undo: res.undo });
      }
    } catch {
      show('操作失败，请重试', 'error');
    }
  };

  const openTasks = useMemo(
    () => openUnscheduledTasks(tasks, blocks, 8),
    [tasks, blocks],
  );

  // 今日空闲时段（课程块 + 自建块都算占用）
  // 今日空闲时段（课程块 + 自建块都算占用）；已过去的时间不算空闲
  const todayFree = useMemo(
    () =>
      settings
        ? collectUpcomingWindows(today, courses, settings, blocks, 1, 30).map((w) => ({
            start: atTime(w.date, w.start),
            end: atTime(w.date, w.end),
            minutes: w.minutes,
          }))
        : [],
    [blocks, courses, settings, today],
  );

  // 注意力账本：块的供给 vs 空闲（任务的完成情况不进这条账）
  const attentionLedger = useMemo(() => {
    const allocated = todayAll.reduce(
      (sum, b) => sum + (b.actualMinutes ?? minutesBetween(b.start, b.end)),
      0,
    );
    const free = todayFree.reduce((sum, w) => sum + w.minutes, 0);
    const byType = new Map<BlockType, number>();
    for (const b of todayAll) {
      byType.set(b.type, (byType.get(b.type) ?? 0) + (b.actualMinutes ?? minutesBetween(b.start, b.end)));
    }
    return { allocated, free, byType };
  }, [todayAll, todayFree]);

  /**
   * 计划 vs 实际对照：不做数据复述，只找偏离。
   * 关键信号是"设置了的目标拿到了多少时间块"——这是用户看不到的对比。
   */
  const generateGaps = async () => {
    if (!aiCfg) return;
    setGapBusy(true);
    try {
      const findings = await reviewGap(aiCfg, {
        weekLabel: `第 ${String(week.weekNumber).padStart(2, '0')} 周`,
        outcomes: weekOutcomes.map((o) => {
          const linked = o.linkedTaskIds;
          const linkedBlocks = blocks.filter((b) =>
            b.taskIds.some((id) => linked.includes(id)),
          );
          const scheduledMinutes = linkedBlocks.reduce(
            (sum, b) => sum + (b.actualMinutes ?? minutesBetween(b.start, b.end)),
            0,
          );
          const completedLinked = tasks.filter(
            (t) => linked.includes(t.id) && t.status === 'DONE',
          ).length;
          return {
            title: o.title,
            status: o.status === 'DONE' ? '已完成' : '未完成',
            linkedTasks: linked.length,
            scheduledMinutes,
            completedLinked,
          };
        }),
        completedTasks: tasks
          .filter(
            (t) =>
              t.status === 'DONE' &&
              t.completedAt != null &&
              t.completedAt.slice(0, 10) >= week.startDate &&
              t.completedAt.slice(0, 10) <= week.endDate,
          )
          .map((t) => ({ title: t.title, context: labels.taskContext(t) ?? undefined })),
        deepWorkMinutes: deepWork.totalMinutes,
        deepWorkByContext: Object.entries(deepWork.byContext).map(([ctx, minutes]) => ({
          label: labels.contextLabel(ctx),
          minutes,
        })),
        allocation: allocation.map((a) => ({
          label: BLOCK_TYPE_LABELS[a.type],
          percent: a.percent,
        })),
        courses: courses.map((c) => ({
          name: c.name,
          health: HEALTH_LABELS[c.health],
          debt: debtSummary(c.debt),
        })),
        warnings: warnings.map((w) => w.message),
      });
      setGaps(findings);
    } catch (e) {
      show(`AI 对照失败：${(e as Error).message}`, 'error');
    } finally {
      setGapBusy(false);
    }
  };

  const generateWeekPlan = async () => {
    if (!deepCfg || !settings) return;
    setPlanBusy(true);
    try {
      // 待排任务先用确定性排序取前 12，编号 T1… 交给 AI 引用
      const unscheduled = openUnscheduledTasks(tasks, blocks);
      const ranked = rankTasks(unscheduled, {
        courses,
        projects,
        contextMinutesThisWeek: {},
        now: today,
      }).slice(0, 12);
      if (ranked.length === 0) {
        show('没有待排任务，先去任务页创建几个');
        return;
      }
      const plan = await suggestWeeklyPlan(deepCfg, {
        weekLabel: `第 ${String(week.weekNumber).padStart(2, '0')} 周`,
        focusSource: {
          outcomes: weekOutcomes.map((o) => ({
            title: o.title,
            status: o.status === 'DONE' ? '已完成' : '未完成',
          })),
          projectMilestones: activeProjects.map((p) => ({
            project: p.name,
            milestone: currentMilestone(p, milestones)?.name ?? '未设定',
          })),
        },
        tasks: ranked.map((r, i) => ({
          key: `T${i + 1}`,
          title: r.task.title,
          estimateMinutes: r.task.estimateMinutes || settings.defaultTaskEstimate,
          priority: r.task.priority,
          dueInDays: r.task.dueDate
            ? Math.round(
                (new Date(r.task.dueDate + 'T00:00:00').getTime() -
                  new Date(todayISO + 'T00:00:00').getTime()) /
                  86400000,
              )
            : null,
          context: labels.taskContext(r.task) ?? undefined,
        })),
        // 未来窗口：今天的时段从"现在"起算，计划不会落在过去
        windows: collectUpcomingWindows(today, courses, settings, blocks, 7, 60),
        projects: activeProjects.map((p) => {
          const done = milestones.filter((m) => m.projectId === p.id && m.status === 'DONE').length;
          return `${p.name}（里程碑 ${done} 个已完成）`;
        }),
        courseHints: courses.map(
          (c) => `${c.name}[${HEALTH_LABELS[c.health]}]，债务：${debtSummary(c.debt)}`,
        ),
        warnings: warnings.map((w) => w.message),
      });
      const rows = plan.placements
        .map((placement) => {
          const idx = Number(placement.taskId.slice(1)) - 1;
          const rankedTask = ranked[idx];
          return rankedTask ? { placement, task: rankedTask.task } : null;
        })
        .filter((r): r is { placement: PlannedBlock; task: Task } => r !== null);
      if (rows.length === 0) {
        show('AI 的排期没有匹配到任何任务，请重试', 'error');
        return;
      }
      setPlanFocus(plan.focus);
      setWeekPlan(rows);
      setPlanSel(new Set(rows.map((_, i) => String(i))));
    } catch (e) {
      show(`AI 周计划生成失败：${(e as Error).message}`, 'error');
    } finally {
      setPlanBusy(false);
    }
  };

  const adoptPlan = async () => {
    if (!weekPlan || !settings) return;
    const picked = weekPlan.filter((_, i) => planSel.has(String(i)));
    if (picked.length === 0) return;
    const createdIds: string[] = [];
    try {
      for (const { placement, task } of picked) {
        const block = await repos.blockRepo.create({
          start: atTime(placement.date, placement.start),
          end: atTime(placement.date, placement.end),
          type: placement.type,
          source: 'SUGGESTED',
          context: task.projectId ?? task.courseId ?? labels.taskContext(task),
          taskIds: [task.id],
          status: 'PLANNED',
          plannedMinutes: task.estimateMinutes,
        });
        createdIds.push(block.id);
      }
    } catch (e) {
      // 部分创建失败时回滚已建的块，避免留下半套方案
      for (const id of createdIds) await repos.blockRepo.remove(id);
      show(`采纳失败：${(e as Error).message}`, 'error');
      return;
    }
    push({
      label: '采纳 AI 周计划',
      undo: async () => {
        for (const id of createdIds) await repos.blockRepo.remove(id);
      },
    });
    setWeekPlan(null);
    show(`已按周计划创建 ${createdIds.length} 个时间块 · ⌘Z 可整体撤销`);
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
      <div className="page-header">
        <h1>总览</h1>
        <span className="sub">第 {String(week.weekNumber).padStart(2, '0')} 周 · {week.startDate} → {week.endDate}</span>
      </div>

      {warnings.length > 0 && (
        <div className="warning-banner">
          <AlertTriangle size={14} />
          {warnings.slice(0, 2).map((w) => w.message).join('　')}
          {warnings.length > 2 && <span className="faint">（还有 {warnings.length - 2} 项）</span>}
        </div>
      )}

      {/* 双列瀑布流：左右两列各自向上堆，无空洞；今日安排与待排任务保持并排相邻 */}
      <div className="dash-cols">
        {/* ── 左列 ── */}
        <div>
          <section className="panel" data-testid="today-panel" style={{ marginBottom: 14 }}>
            <h2>今日安排</h2>
            {/* 注意力账本：块是主角，先回答"今天的注意力给了谁、还剩多少" */}
            <div className="ledger">
              <span>已分配 <strong className="mono">{durationLabel(attentionLedger.allocated)}</strong></span>
              <span>空闲 <strong className="mono">{durationLabel(attentionLedger.free)}</strong></span>
              {[...attentionLedger.byType.entries()]
                .filter(([, mins]) => mins > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([type, mins]) => (
                  <span key={type} className="mono small muted">
                    {BLOCK_TYPE_LABELS[type]} {durationLabel(mins)}
                  </span>
                ))}
            </div>
            {/* 一天全景长条：灰=固定课程，彩=你的块，空白=空闲，红线=现在；可直接拖任务上轴开块 */}
            <DayTimeline blocks={todayAll} now={today} labelFor={(c) => labels.contextLabel(c)} interactive preview={tlPreview} />
            {todayAll.length === 0 && (
              <EmptyState>今天还没有安排。把右边的任务拖到时间轴上，或按 B 创建时间块。</EmptyState>
            )}
            {todayAll.map((b) => (
              <BlockCard
                key={b.id}
                block={b}
                label={labels.contextLabel(b.context)}
                tasks={b.taskIds.map((id) => taskById.get(id)).filter((t): t is Task => !!t)}
                current={isCurrentBlock(b, today)}
                droppable
                draggable={b.source !== 'SCHEDULE'}
                onClick={() => b.source !== 'SCHEDULE' && setDetailBlock(b)}
                onTaskOpen={(t) => setDetailTask(t)}
                onDelete={deleteBlock}
                onComplete={completeBlock}
              />
            ))}
            <div className="faint small" style={{ marginTop: 6 }}>
              拖任务到时间轴的空白处，即从那个时刻开一个块
            </div>
          </section>

          {/* THIS WEEK */}
          <section className="panel" style={{ marginBottom: 14 }}>
            <h2>本周投入</h2>
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
              本周深度工作
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
          <section className="panel" style={{ marginBottom: 14 }}>
            <h2>课程健康</h2>
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
                      {HEALTH_LABELS[c.health]}
                      {suggested !== c.health ? `（建议 ${HEALTH_LABELS[suggested]}）` : ''}
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
            <h2>进行中项目 · WIP {wip.activeCount}/{wip.limit}</h2>
            {activeProjects.length === 0 && <EmptyState>没有进行中的项目。</EmptyState>}
            {activeProjects.map((p) => {
              const ms = currentMilestone(p, milestones);
              const pct = milestoneProgress(milestones.filter((m) => m.projectId === p.id));
              const own = milestones.filter((m) => m.projectId === p.id);
              const doneCount = own.filter((m) => m.status === 'DONE').length;
              return (
                <div key={p.id} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{p.name}</span>
                    <span className="mono small faint">{doneCount}/{own.length} · {pct}%</span>
                  </div>
                  <div className="small muted">{ms ? ms.name : '—'}</div>
                  <Bar percent={pct} />
                </div>
              );
            })}
            {wip.atLimit && (
              <div className="faint small">已有 {wip.activeCount} 个进行中项目，新项目建议进入待启动。</div>
            )}
          </section>
        </div>

        {/* ── 右列 ── */}
        <div>
          {/* READY TASKS (draggable; also the drop target to pull tasks back out of blocks) */}
          <DropZone id="backlog-dashboard" data={{ kind: 'backlog' }} className="panel" style={{ marginBottom: 14 }}>
            <h2>待排任务</h2>
            {openTasks.length === 0 && (
              <EmptyState>都排好了。把任务从时间块拖回这里可重新排期。</EmptyState>
            )}
            {openTasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                contextLabel={labels.taskContext(t)}
                draggable
                onClick={() => setDetailTask(t)}
                onToggle={() =>
                  t.status === 'DONE'
                    ? repos.taskRepo.reopen(t.id)
                    : repos.taskRepo.complete(t.id)
                }
              />
            ))}
          </DropZone>

          {/* THIS WEEK OUTCOMES */}
          <section className="panel" style={{ marginBottom: 14 }}>
            <h2>本周成果</h2>
            <div className="faint small" style={{ marginBottom: 6 }}>
              本周你想达成的 3–5 件事。AI 周计划以此定焦点，对照也会看它们的投入情况。
            </div>
            {weekOutcomes.length === 0 && <EmptyState>本周还没有设定目标。</EmptyState>}
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
                <span className="mono faint small">{o.linkedTaskIds.length} 个任务</span>
                <button
                  className="btn small subtle"
                  aria-label={`删除目标 ${o.title}`}
                  title="删除该目标"
                  onClick={() => repos.outcomeRepo.remove(o.id)}
                >
                  ×
                </button>
              </div>
            ))}
            <input
              style={{ marginTop: 8, width: '100%' }}
              value={newOutcome}
              placeholder="添加本周目标，回车写入"
              aria-label="添加本周目标"
              onChange={(e) => setNewOutcome(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key !== 'Enter' || !newOutcome.trim()) return;
                await repos.outcomeRepo.create({
                  weekId: week.id,
                  title: newOutcome.trim(),
                  linkedTaskIds: [],
                  status: 'OPEN',
                });
                setNewOutcome('');
              }}
            />
          </section>

          {/* SUGGESTIONS */}
          <section className="panel" style={{ marginBottom: 14 }}>
            <h2>下一步建议</h2>
            {suggestions.length === 0 && (
              <EmptyState>暂无可排建议 —— 给任务填写预估时间后会出现在这里。</EmptyState>
            )}
            {suggestions.map((s) => (
              <div key={s.task.id} className="row-item" style={{ display: 'block', marginBottom: 10 }}>
                {/* 块是主语：建议的是"开一个什么块"，任务只是可挂项 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <strong className="small">
                    {BLOCK_TYPE_LABELS[s.type]}块 · {s.blockStart.slice(5, 10)} {s.blockStart.slice(11, 16)}–{s.blockEnd.slice(11, 16)}
                  </strong>
                  <TypeTag type={s.type} />
                </div>
                <div className="mono small muted" style={{ margin: '3px 0' }}>
                  {labels.contextLabel(s.context)}
                </div>
                <ul className="faint small" style={{ margin: '2px 0 6px', paddingLeft: 16 }}>
                  {s.reasons.slice(0, 3).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <div className="small" style={{ marginBottom: 6 }}>
                  可顺手挂上：<span className="muted">{s.task.title}</span>
                  <span className="faint small">（{durationLabel(s.task.estimateMinutes)}）</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn small primary"
                    onClick={async () => {
                      const block = await repos.blockRepo.create({
                        start: s.blockStart,
                        end: s.blockEnd,
                        type: s.type,
                        source: 'SUGGESTED',
                        context: s.context,
                        taskIds: [s.task.id],
                        status: 'PLANNED',
                        plannedMinutes: s.task.estimateMinutes,
                      });
                      push({
                        label: '采纳建议',
                        undo: () => repos.blockRepo.remove(block.id),
                      });
                      show(`已开时间块：${BLOCK_TYPE_LABELS[s.type]} ${s.blockStart.slice(11, 16)}–${s.blockEnd.slice(11, 16)} · ⌘Z 可撤销`);
                    }}
                  >
                    采纳
                  </button>
                  <button
                    className="btn small subtle"
                    onClick={() => {
                      dismissSuggestion(s.task.id);
                      show('已忽略该建议（7 天内不再出现）');
                    }}
                  >
                    忽略
                  </button>
                </div>
              </div>
            ))}
          </section>

          {/* AI WEEK PLAN */}
          <section className="panel" style={{ marginBottom: 14 }}>
            <h2 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              AI 周计划
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span className="tag" title="周计划走深度模型档（设置 → AI 助手）">
                  深度{deepCfg && aiCfg && deepCfg.model !== aiCfg.model ? `· ${deepCfg.model}` : ''}
                </span>
                <button
                  className="btn small subtle"
                  disabled={planBusy || !deepCfg}
                  title={deepCfg ? undefined : '先在 设置 → AI 助手 里配置接口'}
                  onClick={generateWeekPlan}
                >
                  {planBusy ? 'AI 思考中…' : weekPlan ? '重新生成' : '生成周计划'}
                </button>
              </span>
            </h2>
            <AIThinking active={planBusy} />
            {!weekPlan ? (
              <div className="faint small">
                基于本周目标、课程债务和未来 7 天空闲窗口做一份有取舍的排期草稿：先定焦点，再排块，每条说明"为什么是它"。勾选后才落库。
              </div>
            ) : (
              <div>
                {planFocus && (
                  <div className="row-item" style={{ display: 'block', marginBottom: 10 }}>
                    <div className="faint small">未来 7 天焦点</div>
                    <div className="small" style={{ fontWeight: 500 }}>{planFocus}</div>
                  </div>
                )}
                {weekPlan.map((row, i) => {
                  const d = new Date(row.placement.date + 'T00:00:00');
                  const dayLabel = `${row.placement.date.slice(5)} ${WEEKDAY_LABEL[d.getDay()]}`;
                  return (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <label className="task-row" style={{ paddingLeft: 0, cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={planSel.has(String(i))}
                          onChange={() => {
                            const next = new Set(planSel);
                            if (next.has(String(i))) next.delete(String(i));
                            else next.add(String(i));
                            setPlanSel(next);
                          }}
                        />
                        <span className="title" style={{ flex: 1 }}>
                          <span className="mono small muted">{dayLabel} {row.placement.start}–{row.placement.end}</span>
                          <span style={{ display: 'block' }}>{row.task.title}</span>
                        </span>
                        <TypeTag type={row.placement.type} />
                      </label>
                      {row.placement.reason && (
                        <div className="faint small" style={{ margin: '2px 0 0 24px' }}>
                          {row.placement.reason}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button className="btn small primary" onClick={adoptPlan}>
                    采纳所选（{planSel.size}）
                  </button>
                  <button className="btn small subtle" onClick={() => setWeekPlan(null)}>
                    收起
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* AI GAP: 计划 vs 实际 */}
          <section className="panel" style={{ marginBottom: 14 }}>
            <h2 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              AI 对照 · 计划 vs 实际
              <button
                className="btn small subtle"
                disabled={gapBusy || !aiCfg}
                title={aiCfg ? undefined : '先在 设置 → AI 助手 里配置接口'}
                onClick={generateGaps}
              >
                {gapBusy ? 'AI 思考中…' : gaps ? '重新对照' : '看看差在哪'}
              </button>
            </h2>
            <AIThinking active={gapBusy} />
            {gaps === null ? (
              <div className="faint small">
                对照"本周设定的目标"和"实际投入的时间块"，只指出最值得注意的偏离（不汇总你已经看得到的数据）。
              </div>
            ) : gaps.length === 0 ? (
              <div className="small muted">计划与实际基本一致，没有发现明显偏离。</div>
            ) : (
              gaps.map((g, i) => (
                <div key={i} className="row-item" style={{ display: 'block', marginBottom: 10 }}>
                  <div className="small">{g.fact}</div>
                  {g.action && (
                    <div className="mono small muted" style={{ marginTop: 3 }}>
                      → {g.action}
                    </div>
                  )}
                </div>
              ))
            )}
          </section>

          {/* ATTENTION ALLOCATION */}
          <section className="panel">
            <h2>注意力分配</h2>
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
      </div>

      {detailTask && (
        <TaskDetailModal task={detailTask} onClose={() => setDetailTask(null)} />
      )}

      {detailBlock && (
        <BlockDetailModal block={detailBlock} onClose={() => setDetailBlock(null)} />
      )}

      <DragOverlay dropAnimation={null}>
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
