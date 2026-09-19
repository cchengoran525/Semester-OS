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
import { BlockCard, DropDay, DropZone, EmptyState, TaskRow } from '../components/common';
import { BlockDetailModal } from '../components/BlockDetailModal';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { makeLabelResolver } from '../components/labels';
import * as repos from '../storage/repositories';
import { useToast } from '../store/uiStore';
import type { Block, Task } from '../domain/types';
import { blocksOnDate, isCurrentBlock, openUnscheduledTasks } from '../services/statistics';
import { scheduleBlocksForRange } from '../services/scheduleService';
import { findConflicts } from '../services/scheduler';
import {
  daysOfWeek,
  getWeekInfo,
  todayDate,
  toISODate,
} from '../services/timeService';
import { handleBlockDayMove, handleBlockUnschedule, handleTaskDrop, handleTaskUnschedule, removeBlockWithUndo } from '../services/dropActions';
import { useUndo } from '../store/uiStore';

const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
/** 日历分段的颗粒度：早 / 午 / 晚，只做视觉锚点，不改数据。 */
const DAY_SEGMENTS: { label: string; from: number; to: number }[] = [
  { label: '早', from: 0, to: 12 },
  { label: '午', from: 12, to: 18 },
  { label: '晚', from: 18, to: 24 },
];

function segmentOf(block: Block): number {
  const hour = Number(block.start.slice(11, 13));
  return DAY_SEGMENTS.findIndex((s) => hour >= s.from && hour < s.to);
}

export function CalendarPage() {
  const { courses, projects, tasks, blocks, settings } = useApp();
  const show = useToast((s) => s.show);
  const push = useUndo((s) => s.push);
  const [weekOffset, setWeekOffset] = useState(0);
  const [draggingTask, setDraggingTask] = useState<Task | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);

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
    const overData = over.data.current;
    if (!data || !overData) return;
    try {
      if (data.kind === 'task') {
        const task = taskById.get(data.taskId);
        if (!task) return;
        if (overData.kind === 'block') {
          const res = await handleTaskDrop(task, { kind: 'block', blockId: overData.blockId }, { courses, settings, existingBlocks: blocks });
          show(res.message);
          if (res.undo) push({ label: res.message, undo: res.undo });
        } else if (overData.kind === 'day') {
          const res = await handleTaskDrop(task, { kind: 'day', dateISO: overData.dateISO }, { courses, settings, existingBlocks: blocks });
          show(res.message);
          if (res.undo) push({ label: res.message, undo: res.undo });
        } else if (overData.kind === 'backlog') {
          const res = await handleTaskUnschedule(task, blocks);
          show(res.message);
          if (res.undo) push({ label: res.message, undo: res.undo });
        }
      } else if (data.kind === 'block' && overData.kind === 'backlog') {
        const block = blocks.find((b) => b.id === data.blockId);
        if (block && block.source !== 'SCHEDULE') {
          const res = await handleBlockUnschedule(block);
          show(res.message);
          if (res.undo) push({ label: res.message, undo: res.undo });
        }
      } else if (data.kind === 'block' && overData.kind === 'day') {
        const block = blocks.find((b) => b.id === data.blockId);
        if (block && block.source !== 'SCHEDULE') {
          const res = await handleBlockDayMove(block, overData.dateISO);
          show(res.message);
          if (res.undo) push({ label: res.message, undo: res.undo });
        }
      }
    } catch {
      show('操作失败，请重试', 'error');
    }
  };

  const openTasks = useMemo(
    // 待排 = 未被任何未完成块占用；拖进块（哪天都算）即从列表消失
    () => openUnscheduledTasks(tasks, blocks),
    [tasks, blocks],
  );

  const selectedBlock = selectedBlockId ? blocks.find((b) => b.id === selectedBlockId) : null;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="page-header">
        <h1>日历</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span className="sub">{week.startDate} → {week.endDate}</span>
          <button className="btn small" onClick={() => setWeekOffset(weekOffset - 1)}>‹ 上周</button>
          <button className="btn small" onClick={() => setWeekOffset(0)}>本周</button>
          <button className="btn small" onClick={() => setWeekOffset(weekOffset + 1)}>下周 ›</button>
        </div>
      </div>

      {conflicts.length > 0 && (
        <div className="warning-banner">
          时间冲突：{conflicts.length} 处重叠时间块。点击时间块可调整。
        </div>
      )}

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
                {(() => {
                  const ov = settings?.scheduleOverrides?.find((o) => o.date === dateISO);
                  return (
                    <div className="day-head">
                      <span>{DAY_NAMES[(d.getDay() + 6) % 7]}</span>
                      <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        {ov && (
                          <span className="tag" style={{ padding: '0 4px' }}>
                            {ov.off ? '休' : '调'}
                          </span>
                        )}
                        {dateISO.slice(5)}
                      </span>
                    </div>
                  );
                })()}
                {dayBlocks.length === 0 && dateISO === todayISO && (
                  <div className="faint small" style={{ padding: '4px 0' }}>
                    拖任务到这里
                  </div>
                )}
                {DAY_SEGMENTS.map((seg, si) => {
                  const inSeg = dayBlocks.filter((b) => segmentOf(b) === si);
                  if (inSeg.length === 0) return null;
                  return (
                    <div key={seg.label} className="day-segment">
                      <span className="day-segment-label">{seg.label}</span>
                      {inSeg.map((b) => (
                        <BlockCard
                          key={b.id}
                          block={b}
                          label={labels.contextLabel(b.context)}
                          tasks={b.taskIds.map((id) => taskById.get(id)).filter((t): t is Task => !!t)}
                          current={isCurrentBlock(b, todayDate())}
                          droppable
                          draggable={b.source !== 'SCHEDULE'}
                          onClick={() => b.source !== 'SCHEDULE' && setSelectedBlockId(b.id)}
                          onDelete={(bb) => {
                            void (async () => {
                              const res = await removeBlockWithUndo(bb);
                              push({ label: res.message, undo: res.undo });
                              if (selectedBlockId === bb.id) setSelectedBlockId(null);
                              show(`${res.message} · ⌘Z 可撤销`);
                            })();
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </DropDay>
            );
          })}
      </div>

      {/* 待排任务横排便签：日历占满整行，待排放下面横向滑动 */}
      <DropZone id="backlog-calendar" data={{ kind: 'backlog' }} className="panel" style={{ marginTop: 14 }}>
        <h2>待排任务 · 拖到日历</h2>
        {openTasks.length === 0 && (
          <EmptyState>没有待排任务。从时间块里把任务拖回这里即可重新排期。</EmptyState>
        )}
        <div className="sticky-strip">
          {openTasks.map((t) => (
            <div key={t.id} className="sticky-note" style={{ minWidth: 300 }}>
              <TaskRow
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
            </div>
          ))}
        </div>
      </DropZone>

      {selectedBlock && (
        <BlockDetailModal block={selectedBlock} onClose={() => setSelectedBlockId(null)} />
      )}

      {detailTask && <TaskDetailModal task={detailTask} onClose={() => setDetailTask(null)} />}

      <DragOverlay dropAnimation={null}>
        {draggingTask ? (
          <div className="tag" style={{ padding: '4px 10px' }}>{draggingTask.title}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
