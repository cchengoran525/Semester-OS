import {
  HEALTH_LABELS,
  type Block,
  type Course,
  type Priority,
  type Project,
  type Task,
} from '../domain/types';
import { minutesBetween, toDate } from './timeService';

// ── Conflict detection ───────────────────────────────────────────────

export interface BlockConflict {
  a: Block;
  b: Block;
}

export function findConflicts(blocks: Block[]): BlockConflict[] {
  const sorted = [...blocks].sort((x, y) => x.start.localeCompare(y.start));
  const conflicts: BlockConflict[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].start >= sorted[i].end) break; // no overlap possible further
      if (sorted[j].start < sorted[i].end && sorted[j].end > sorted[i].start) {
        conflicts.push({ a: sorted[i], b: sorted[j] });
      }
    }
  }
  return conflicts;
}

export function conflictsWith(
  candidate: { start: string; end: string },
  blocks: Block[],
): Block[] {
  return blocks.filter(
    (b) => candidate.start < b.end && candidate.end > b.start,
  );
}

// ── Task ranking ─────────────────────────────────────────────────────

const PRIORITY_WEIGHT: Record<Priority, number> = {
  HIGH: 30,
  MEDIUM: 15,
  LOW: 0,
};

export interface RankContext {
  courses: Course[];
  projects: Project[];
  /** Deep-work minutes logged this week per context (project id). */
  contextMinutesThisWeek: Record<string, number>;
  now: Date;
}

export interface RankedTask {
  task: Task;
  score: number;
  reasons: string[];
}

/**
 * Deterministic, explainable ranking:
 * fixed course need (debt) > high-risk course > active project > priority > deadline > neglected context.
 */
export function rankTasks(tasks: Task[], ctx: RankContext): RankedTask[] {
  const courseById = new Map(ctx.courses.map((c) => [c.id, c]));
  const projectById = new Map(ctx.projects.map((p) => [p.id, p]));
  const healthOrder = { RED: 40, YELLOW: 15, GREEN: 0 } as const;

  return tasks
    .filter((t) => t.status !== 'DONE')
    .map((task) => {
      let score = 0;
      const reasons: string[] = [];

      score += PRIORITY_WEIGHT[task.priority];
      if (task.priority === 'HIGH') reasons.push('优先级：高');

      if (task.courseId) {
        const course = courseById.get(task.courseId);
        if (course) {
          score += healthOrder[course.health];
          const debt =
            course.debt.understanding +
            course.debt.assignment +
            course.debt.review +
            course.debt.exam;
          score += debt * 5;
          if (course.health !== 'GREEN')
            reasons.push(`${course.name} 当前${HEALTH_LABELS[course.health]}`);
          if (debt > 0) reasons.push(`${course.name} 有 ${debt} 项债务`);
        }
      }

      if (task.projectId) {
        const project = projectById.get(task.projectId);
        if (project?.status === 'ACTIVE') {
          score += 20;
          reasons.push(`${project.name} 是进行中项目`);
          const logged = ctx.contextMinutesThisWeek[project.id] ?? 0;
          if (logged < 120) {
            score += 10;
            reasons.push(`本周 ${project.name} 投入时间偏低`);
          }
        }
      }

      if (task.dueDate) {
        const daysLeft = Math.ceil(
          (new Date(`${task.dueDate}T23:59:59`).getTime() - ctx.now.getTime()) /
            86400000,
        );
        if (daysLeft <= 1) {
          score += 60;
          reasons.push(daysLeft < 0 ? '已逾期' : '今天截止');
        } else if (daysLeft <= 3) {
          score += 18;
          reasons.push(`${daysLeft} 天后截止`);
        }
      }

      if (task.estimateMinutes > 0 && task.estimateMinutes <= 60) {
        score += 5; // quick wins slightly favored when scores tie elsewhere
      }

      return { task, score, reasons };
    })
    .sort((a, b) => b.score - a.score);
}

// ── Schedule suggestion ──────────────────────────────────────────────

/**
 * Tasks already attached to a live (PLANNED/ACTIVE) block. Suggesting a
 * time slot for a task the user has already placed is noise — the adoption
 * loop would otherwise re-propose the same task in the next free window.
 */
export function scheduledTaskIds(blocks: Block[]): Set<string> {
  const ids = new Set<string>();
  for (const b of blocks) {
    if (b.status === 'DONE') continue;
    for (const id of b.taskIds) ids.add(id);
  }
  return ids;
}

export interface FreeWindow {
  start: string;
  end: string;
  minutes: number;
}

/** Find free windows within a day given existing blocks (incl. class blocks). */
export function freeWindows(
  dayStartISO: string, // e.g. 2026-09-03T08:00:00
  dayEndISO: string,
  blocks: Block[],
  minMinutes = 45,
): FreeWindow[] {
  const busy = blocks
    .filter((b) => b.start < dayEndISO && b.end > dayStartISO)
    .map((b) => ({ start: b.start, end: b.end }))
    .sort((a, b) => a.start.localeCompare(b.start));

  const windows: FreeWindow[] = [];
  let cursor = dayStartISO;
  for (const slot of busy) {
    if (slot.start > cursor) {
      const mins = minutesBetween(cursor, slot.start);
      if (mins >= minMinutes)
        windows.push({ start: cursor, end: slot.start, minutes: mins });
    }
    if (slot.end > cursor) cursor = slot.end;
  }
  if (dayEndISO > cursor) {
    const mins = minutesBetween(cursor, dayEndISO);
    if (mins >= minMinutes)
      windows.push({ start: cursor, end: dayEndISO, minutes: mins });
  }
  return windows;
}

export interface Suggestion {
  task: Task;
  blockStart: string;
  blockEnd: string;
  type: 'DEEP_WORK' | 'ENGINEERING' | 'COURSE' | 'ADMIN' | 'ENGLISH';
  context?: string;
  reasons: string[];
}

export interface SuggestInput {
  ranked: RankedTask[];
  /** Candidate windows per day, in order. */
  windows: { date: string; window: FreeWindow }[];
  /** Blocks that already exist for those days (for context stats). */
  contextLabel: (t: Task) => string | undefined;
  maxSuggestions?: number;
}

export function suggestBlocks(input: SuggestInput): Suggestion[] {
  const out: Suggestion[] = [];
  const max = input.maxSuggestions ?? 5;
  const usedWindows = new Set<string>();

  for (const { task, reasons } of input.ranked) {
    if (out.length >= max) break;
    if (task.estimateMinutes <= 0) continue;

    const match = input.windows.find(
      (w) =>
        !usedWindows.has(`${w.date}|${w.window.start}`) &&
        w.window.minutes >= Math.min(task.estimateMinutes, 90),
    );
    if (!match) continue;
    usedWindows.add(`${match.date}|${match.window.start}`);

    const blockEnd = toLocalISO(
      toDate(match.window.start).getTime() + task.estimateMinutes * 60000,
    );
    const context = input.contextLabel(task);
    const type: Suggestion['type'] = task.courseId
      ? 'COURSE'
      : task.projectId
        ? 'ENGINEERING'
        : 'DEEP_WORK';

    out.push({
      task,
      blockStart: match.window.start,
      blockEnd,
      type,
      context,
      reasons: [
        ...reasons,
        `预计 ${task.estimateMinutes} 分钟`,
        `${match.date} 有 ${match.window.minutes} 分钟连续空闲`,
      ],
    });
  }
  return out;
}

export function toLocalISO(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}
