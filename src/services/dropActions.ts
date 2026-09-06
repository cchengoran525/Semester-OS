import { addDays } from 'date-fns';
import type { Block, BlockType, Course, Settings, Task } from '../domain/types';
import { blockRepo, taskRepo } from '../storage/repositories';
import { atTime, toDate, toISODate, toISODateTime, todayDate } from './timeService';
import { freeWindows } from './scheduler';
import { scheduleBlocksForDate } from './scheduleService';

export type DropTarget =
  | { kind: 'block'; blockId: string }
  | { kind: 'day'; dateISO: string }
  /** A specific free window shown in 今日安排 — block is created exactly there. */
  | { kind: 'window'; start: string; end: string }
  /** A point on the day timeline: block starts there, length = minutes. */
  | { kind: 'slot'; start: string; minutes: number };

export interface DropContext {
  courses: Course[];
  settings: Settings;
  existingBlocks: Block[];
}

/** Payload carried by the free-window droppable in 今日安排. */
export interface FreeWindowChipData {
  kind: 'window';
  start: string;
  end: string;
}

export interface DropResult {
  message: string;
  /** Push to the global undo stack after the mutation committed. */
  undo?: () => Promise<void>;
}

/** Snapshot the taskIds of the given blocks for undo restoration. */
function snapshotBlocks(blocks: Block[]): Block[] {
  return blocks.map((b) => ({ ...b, taskIds: [...b.taskIds] }));
}

async function restoreTaskIds(snapshots: Block[]): Promise<void> {
  for (const snap of snapshots) {
    const current = await blockRepo.get(snap.id);
    if (current) await blockRepo.update(snap.id, { taskIds: snap.taskIds });
    else await blockRepo.restore(snap);
  }
}

/**
 * Handle a task dropped onto a block, a calendar day, or a concrete free
 * window. Day drop creates a new block in the largest free window of that day.
 */
export async function handleTaskDrop(
  task: Task,
  target: DropTarget,
  ctx: DropContext,
): Promise<DropResult> {
  if (target.kind === 'block') {
    const before = snapshotBlocks(
      ctx.existingBlocks.filter(
        (b) => b.source !== 'SCHEDULE' && b.taskIds.includes(task.id),
      ),
    );
    await blockRepo.attachTask(target.blockId, task.id);
    // Planka-like move semantics: dragging a task into a live block pulls it
    // out of the other live blocks it sat in (past/done blocks stay untouched).
    const todayISO = toISODate(todayDate());
    const stale = ctx.existingBlocks.filter(
      (b) =>
        b.id !== target.blockId &&
        b.status !== 'DONE' &&
        b.source !== 'SCHEDULE' &&
        b.taskIds.includes(task.id) &&
        b.start.slice(0, 10) >= todayISO,
    );
    for (const b of stale) await blockRepo.detachTask(b.id, task.id);
    if (task.status === 'BACKLOG') await taskRepo.update(task.id, { status: 'READY' });
    return {
      message: `已把「${task.title}」加入时间块`,
      undo: async () => {
        await restoreTaskIds(before);
        await blockRepo.detachTask(target.blockId, task.id);
      },
    };
  }

  if (target.kind === 'window') {
    const minutes = Math.round(
      (new Date(target.end).getTime() - new Date(target.start).getTime()) / 60000,
    );
    return createTaskBlock(task, target.start, minutes);
  }

  if (target.kind === 'slot') {
    return createTaskBlock(task, target.start, target.minutes);
  }

  // Day drop → create block
  const date = new Date(`${target.dateISO}T00:00:00`);
  const dayStart = atTime(target.dateISO, '08:00');
  const dayEnd = atTime(target.dateISO, '22:00');
  const sched = scheduleBlocksForDate(date, ctx.courses, ctx.settings);
  const busy = [...ctx.existingBlocks, ...sched];
  const windows = freeWindows(dayStart, dayEnd, busy, Math.min(task.estimateMinutes || 90, 60));

  let start = atTime(target.dateISO, '14:00');
  let minutes = task.estimateMinutes || 90;
  if (windows.length > 0) {
    const best = windows.reduce((a, b) => (b.minutes > a.minutes ? b : a));
    start = best.start;
    minutes = Math.min(task.estimateMinutes || 90, best.minutes);
  }

  const res = await createTaskBlock(task, start, minutes);
  const windowNote = windows.length > 0 ? '空闲时段' : '默认 14:00（当天无整段空闲）';
  return { message: `${res.message} · ${windowNote}` };
}

/** Create a block for a task starting at `start` lasting `minutes`. */
async function createTaskBlock(
  task: Task,
  start: string,
  minutes: number,
): Promise<DropResult> {
  const type: BlockType = task.courseId ? 'COURSE' : 'ENGINEERING';
  const context = task.projectId ?? task.courseId;
  const end = toISODateTime(new Date(new Date(start).getTime() + minutes * 60000));
  const block = await blockRepo.create({
    start,
    end,
    type,
    source: 'USER',
    context,
    taskIds: [task.id],
    status: 'PLANNED',
    plannedMinutes: minutes,
  });
  const prevStatus = task.status;
  if (task.status === 'BACKLOG') await taskRepo.update(task.id, { status: 'READY' });
  return {
    message: `已创建时间块并关联「${task.title}」`,
    undo: async () => {
      await blockRepo.remove(block.id);
      if (prevStatus === 'BACKLOG') await taskRepo.update(task.id, { status: 'BACKLOG' });
    },
  };
}

/** Drag a task back out of every block → returns to the 待排 list. */
export async function handleTaskUnschedule(
  task: Task,
  blocks: Block[],
): Promise<DropResult> {
  const owners = blocks.filter(
    (b) => b.source !== 'SCHEDULE' && b.taskIds.includes(task.id),
  );
  if (owners.length === 0) return { message: `「${task.title}」不在任何时间块里` };
  const before = snapshotBlocks(owners);
  for (const b of owners) await blockRepo.detachTask(b.id, task.id);
  // 体面的消失：任务拖走后，空的 MANUAL/SUGGESTED 块不再留壳
  const emptied = owners.filter((b) => b.taskIds.length === 1);
  for (const b of emptied) await blockRepo.remove(b.id);
  return {
    message: `已把「${task.title}」移回待排`,
    undo: async () => {
      await restoreTaskIds(before);
    },
  };
}

/** New start/end when a block is dragged to another day (time of day kept). */
export function shiftBlockToDay(
  block: Block,
  dateISO: string,
): { start: string; end: string } {
  const delta = Math.round(
    (new Date(`${dateISO}T00:00:00`).getTime() -
      new Date(`${block.start.slice(0, 10)}T00:00:00`).getTime()) /
      86400000,
  );
  return {
    start: toISODateTime(addDays(toDate(block.start), delta)),
    end: toISODateTime(addDays(toDate(block.end), delta)),
  };
}

/** Drop a whole block onto another calendar day. */
export async function handleBlockDayMove(
  block: Block,
  dateISO: string,
): Promise<DropResult> {
  if (block.start.slice(0, 10) === dateISO) {
    return { message: '时间块已在这一天' };
  }
  const previous = { start: block.start, end: block.end };
  const { start, end } = shiftBlockToDay(block, dateISO);
  await blockRepo.update(block.id, { start, end });
  return {
    message: `已把时间块移到 ${dateISO}`,
    undo: async () => {
      await blockRepo.update(block.id, previous);
    },
  };
}

/** Remove a block, keeping a restorable snapshot for undo. */
export async function removeBlockWithUndo(
  block: Block,
): Promise<DropResult & { block: Block }> {
  await blockRepo.remove(block.id);
  return {
    message: '时间块已删除',
    block,
    undo: async () => {
      await blockRepo.restore(block);
    },
  };
}

/** Drop a whole block back onto the 待排 zone: release its tasks, remove the block. */
export async function handleBlockUnschedule(
  block: Block,
): Promise<DropResult> {
  if (block.source === 'SCHEDULE') {
    return { message: '固定课程块不能移除' };
  }
  const snapshot: Block = { ...block, taskIds: [...block.taskIds] };
  await blockRepo.remove(block.id);
  const n = snapshot.taskIds.length;
  return {
    message: n > 0 ? `已移回待排（释放 ${n} 个任务）` : '空时间块已移除',
    undo: async () => {
      await blockRepo.restore(snapshot);
    },
  };
}
