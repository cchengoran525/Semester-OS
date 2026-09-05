import type { Block, BlockType, Task } from '../domain/types';
import { minutesBetween, toDate } from './timeService';

export interface BlockFilter {
  from?: string; // ISO datetime
  to?: string;
  types?: BlockType[];
}

function inRange(b: Block, from?: string, to?: string): boolean {
  if (from && b.end < from) return false;
  if (to && b.start > to) return false;
  return true;
}

export function filterBlocks(blocks: Block[], f: BlockFilter): Block[] {
  return blocks.filter(
    (b) =>
      inRange(b, f.from, f.to) && (!f.types || f.types.includes(b.type)),
  );
}

export function blocksOnDate(blocks: Block[], dateISO: string): Block[] {
  return blocks
    .filter((b) => b.start.slice(0, 10) === dateISO)
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** Minutes logged in a set of blocks (planned, or actual when present). */
export function blockMinutes(blocks: Block[]): number {
  return blocks.reduce(
    (sum, b) => sum + (b.actualMinutes ?? minutesBetween(b.start, b.end)),
    0,
  );
}

export interface DeepWorkBreakdown {
  totalMinutes: number;
  byContext: Record<string, number>;
}

/** Deep work = DEEP_WORK + ENGINEERING blocks, grouped by context label. */
export function deepWorkBreakdown(blocks: Block[]): DeepWorkBreakdown {
  const byContext: Record<string, number> = {};
  let totalMinutes = 0;
  for (const b of blocks) {
    if (b.type !== 'DEEP_WORK' && b.type !== 'ENGINEERING') continue;
    const mins = b.actualMinutes ?? minutesBetween(b.start, b.end);
    totalMinutes += mins;
    const key = b.context || 'UNLABELED';
    byContext[key] = (byContext[key] ?? 0) + mins;
  }
  return { totalMinutes, byContext };
}

/** Attention allocation: share of minutes per block type. */
export function attentionAllocation(
  blocks: Block[],
): { type: BlockType; minutes: number; percent: number }[] {
  const perType = new Map<BlockType, number>();
  let total = 0;
  for (const b of blocks) {
    const mins = b.actualMinutes ?? minutesBetween(b.start, b.end);
    perType.set(b.type, (perType.get(b.type) ?? 0) + mins);
    total += mins;
  }
  return [...perType.entries()]
    .map(([type, minutes]) => ({
      type,
      minutes,
      percent: total === 0 ? 0 : Math.round((minutes / total) * 100),
    }))
    .sort((a, b) => b.minutes - a.minutes);
}

export function isCurrentBlock(b: Block, now: Date): boolean {
  const s = toDate(b.start);
  const e = toDate(b.end);
  return s <= now && now <= e;
}

export interface EstimateAccuracy {
  title: string;
  estimate: number;
  actual: number;
}

export function estimateVsActual(tasks: Task[]): EstimateAccuracy[] {
  return tasks
    .filter((t) => t.status === 'DONE' && t.actualMinutes != null && t.estimateMinutes > 0)
    .map((t) => ({
      title: t.title,
      estimate: t.estimateMinutes,
      actual: t.actualMinutes as number,
    }));
}

export function taskCounts(tasks: Task[]): {
  total: number;
  done: number;
  open: number;
  overdue: number;
  today: string;
} {
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: tasks.length,
    done: tasks.filter((t) => t.status === 'DONE').length,
    open: tasks.filter((t) => t.status !== 'DONE').length,
    overdue: tasks.filter(
      (t) =>
        t.status !== 'DONE' && t.dueDate != null && t.dueDate < today,
    ).length,
    today,
  };
}
