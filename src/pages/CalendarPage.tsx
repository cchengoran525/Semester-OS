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
import { addWeeks } from 'date-fns';
import { useApp } from '../components/AppProvider';
import { BlockCard, DropDay, EmptyState, TaskRow } from '../components/common';
import { makeLabelResolver } from '../components/labels';
import * as repos from '../storage/repositories';
import { useToast } from '../store/uiStore';
import type { Task } from '../domain/types';
import { blocksOnDate, isCurrentBlock } from '../services/statistics';
import { scheduleBlocksForRange } from '../services/scheduleService';
import { findConflicts } from '../services/scheduler';
import {
  daysOfWeek,
  formatTime,
  getWeekInfo,
  minutesBetween,
  todayDate,
  toISODate,
} from '../services/timeService';
import { handleTaskDrop } from '../services/dropActions';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function CalendarPage() {
  const { courses, projects, tasks, blocks, settings } = useApp();
  const show = useToast((s) => s.show);
  const [weekOffset, setWeekOffset] = useState(0);
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const labels = useMemo(() => makeLabelResolver(projects, courses), [projects, courses]);
  const weekStartsOn = settings?.weekStartDay ?? 1;
  const baseDate = useMemo(
    () => addWeeks(todayDate(), weekOffset),
    [weekOffset],
  );
  const days = useMemo(
    () => daysOfWeek(baseDate, weekStartsOn),
    [baseDate, weekStartsOn],
  );
  const week = getWeekInfo(baseDate, weekStartsOn);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const todayISO = toISODate(todayDate());

  const sched = useMemo(
    () => scheduleBlocksForRange(days, courses, settings ?? { semesterStart: todayISO }),
    [days, courses, settings?.semesterStart, todayISO],
  );

  const allThisWeek = useMemo(() => [...blocks, ...sched], [blocks, sched]);
  const conflicts = useMemo(() => findConflicts(allThisWeek), [allThisWeek]);
  const conflictIds = useMemo(
    () => new Set(conflicts.flatMap((c) => [c.a.id, c.b.id])),
    [conflicts],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith('task-')) setDraggingTask(taskById.get(id.slice(5)) ?? null);
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
      if (overData.kind === 'block') {
        const res = await handleTaskDrop(task, { kind: 'block', blockId: overData.blockId }, { courses, settings, existingBlocks: blocks });
        show(res.message);
      } else if (overData.kind === 'day') {
        const res = await handleTaskDrop(task, { kind: 'day', dateISO: overData.dateISO }, { courses, settings, existingBlocks: blocks });
        show(res.message);
      }
    } catch {
      show('操作失败，请重试', 'error');
    }
  };

  const openTasks = useMemo(
    () => tasks.filter((t) => t.status === 'READY' || t.status === 'DOING'),
    [tasks],
  );

  const selectedBlock = selectedBlockId ? blocks.find((b) => b.id === selectedBlockId) : null;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="page-header">
        <h1>Calendar</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span className="sub">{week.startDate} → {week.endDate}</span>
          <button className="btn small" onClick={() => setWeekOffset(weekOffset - 1)}>‹ Prev</button>
          <button className="btn small" onClick={() => setWeekOffset(0)}>This Week</button>
          <button className="btn small" onClick={() => setWeekOffset(weekOffset + 1)}>Next ›</button>
        </div>
      </div>

      {conflicts.length > 0 && (
        <div className="warning-banner">
          时间冲突：{conflicts.length} 处重叠 Block。点击 Block 可调整。
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 14, alignItems: 'start' }}>
        <div className="calendar-grid">
          {days.map((d) => {
            const dateISO = toISODate(d);
            const dayBlocks = [
              ...blocksOnDate(blocks, dateISO),
              ...sched.filter((b) => b.start.slice(0, 10) === dateISO),
            ].sort((a, b) => a.start.localeCompare(b.start));
            return (
              <DropDay
                key={dateISO}
                dateISO={dateISO}
                className={`calendar-day ${dateISO === todayISO ? 'today' : ''}`}
              >
                <div className="day-head">
                  <span>{DAY_NAMES[(d.getDay() + 6) % 7]}</span>
                  <span>{dateISO.slice(5)}</span>
                </div>
                {dayBlocks.length === 0 && (
                  <div className="faint small" style={{ padding: '4px 0' }}>
                    {dateISO === todayISO ? '拖任务到这里' : ''}
                  </div>
                )}
                {dayBlocks.map((b) => (
                  <BlockCard
                    key={b.id}
                    block={b}
                    label={labels.contextLabel(b.context)}
                    tasks={b.taskIds.map((id) => taskById.get(id)).filter((t): t is Task => !!t)}
                    current={isCurrentBlock(b, todayDate())}
                    droppable
                    onClick={() => b.source !== 'SCHEDULE' && setSelectedBlockId(b.id)}
                  />
                ))}
              </DropDay>
            );
          })}
        </div>

        <div>
          <section className="panel" style={{ marginBottom: 14 }}>
            <h2>Ready Tasks · 拖到日历</h2>
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

          {selectedBlock && (
            <section className="panel">
              <h2>Block Detail</h2>
              <div className="mono muted">
                {formatTime(selectedBlock.start)}–{formatTime(selectedBlock.end)} ·{' '}
                {minutesBetween(selectedBlock.start, selectedBlock.end)} min
              </div>
              <div className="small" style={{ margin: '6px 0' }}>
                {labels.contextLabel(selectedBlock.context)}
              </div>
              <div className="small muted">
                Energy: {selectedBlock.energy ?? '—'} / 5 · Source: {selectedBlock.source}
              </div>
              <ul style={{ paddingLeft: 18, marginTop: 8 }} className="small">
                {selectedBlock.taskIds.map((id) => {
                  const t = taskById.get(id);
                  return t ? (
                    <li key={id} style={{ marginBottom: 4 }}>
                      {t.status === 'DONE' ? '☑' : '□'} {t.title}{' '}
                      <button
                        className="btn small subtle"
                        onClick={() => repos.blockRepo.detachTask(selectedBlock.id, id)}
                      >
                        移出
                      </button>
                      {t.status !== 'DONE' && (
                        <button
                          className="btn small"
                          style={{ marginLeft: 4 }}
                          onClick={() => repos.taskRepo.complete(t.id, minutesBetween(selectedBlock.start, selectedBlock.end))}
                        >
                          完成
                        </button>
                      )}
                    </li>
                  ) : null;
                })}
              </ul>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button
                  className="btn small"
                  onClick={() => repos.blockRepo.update(selectedBlock.id, { status: 'DONE', actualMinutes: minutesBetween(selectedBlock.start, selectedBlock.end) })}
                >
                  完成 Block（记录实际时长）
                </button>
                <button
                  className="btn small danger"
                  onClick={async () => {
                    await repos.blockRepo.remove(selectedBlock.id);
                    setSelectedBlockId(null);
                  }}
                >
                  删除
                </button>
              </div>
              {conflictIds.has(selectedBlock.id) && (
                <div className="warning-banner" style={{ marginTop: 10 }}>
                  此 Block 与其他 Block 时间重叠。
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      <DragOverlay>
        {draggingTask ? (
          <div className="tag" style={{ padding: '4px 10px' }}>{draggingTask.title}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
