import type { Block, BlockType, Course, Settings, Task } from '../domain/types';
import { blockRepo, taskRepo } from '../storage/repositories';
import { atTime, toISODateTime } from './timeService';
import { freeWindows } from './scheduler';
import { scheduleBlocksForDate } from './scheduleService';

export type DropTarget =
  | { kind: 'block'; blockId: string }
  | { kind: 'day'; dateISO: string };

export interface DropContext {
  courses: Course[];
  settings: Settings;
  existingBlocks: Block[];
}

/**
 * Handle a task dropped onto a block or a calendar day.
 * Day drop creates a new block in the largest free window of that day.
 */
export async function handleTaskDrop(
  task: Task,
  target: DropTarget,
  ctx: DropContext,
): Promise<{ message: string }> {
  if (target.kind === 'block') {
    await blockRepo.attachTask(target.blockId, task.id);
    if (task.status === 'BACKLOG') await taskRepo.update(task.id, { status: 'READY' });
    return { message: `已把「${task.title}」加入 Block` };
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

  const type: BlockType = task.courseId ? 'COURSE' : 'ENGINEERING';
  const context = task.projectId ?? task.courseId;
  const block = await blockRepo.create({
    start,
    end: toISODateTime(new Date(new Date(start).getTime() + minutes * 60000)),
    type,
    source: 'USER',
    context,
    taskIds: [task.id],
    status: 'PLANNED',
    plannedMinutes: minutes,
  });
  if (task.status === 'BACKLOG') await taskRepo.update(task.id, { status: 'READY' });
  void block;
  const windowNote = windows.length > 0 ? '空闲时段' : '默认 14:00（当天无整段空闲）';
  return { message: `已创建 Block 并关联「${task.title}」· ${windowNote}` };
}
