import type {
  Block,
  Course,
  ID,
  Milestone,
  Project,
  Settings,
  Task,
  WeeklyOutcome,
  WeeklyReview,
} from '../domain/types';
import { db } from './db';

/**
 * Repository layer: the ONLY place that touches Dexie tables.
 * UI components call these, never `db.tasks.put` directly.
 */

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// ── Settings ─────────────────────────────────────────────────────────

export const settingsRepo = {
  async get(): Promise<Settings | undefined> {
    return db.settings.get('app');
  },
  /**
   * 合并式更新 sync 配置：始终以库中最新值为基底，
   * 避免"基于旧渲染的展开"把刚填的字段覆盖掉。
   */
  async patchSync(patch: Partial<NonNullable<Settings['sync']>>): Promise<void> {
    const current = await db.settings.get('app');
    const base = current?.sync ?? {};
    const next = { ...base };
    for (const [k, v] of Object.entries(patch) as [keyof typeof base, never][]) {
      if (v !== undefined) (next as Record<string, unknown>)[k] = v;
    }
    await db.settings.update('app', { sync: next });
  },
  async save(patch: Partial<Settings>): Promise<Settings> {
    const current =
      (await db.settings.get('app')) ?? defaultSettings();
    const next = { ...current, ...patch, id: 'app' as const };
    await db.settings.put(next);
    return next;
  },
};

function defaultSettings(): Settings {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1); // month start as a sane default; user adjusts
  const end = new Date(now.getFullYear(), now.getMonth() + 4, 0);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    id: 'app',
    semesterStart: iso(start),
    semesterEnd: iso(end),
    timezone: 'Asia/Shanghai',
    weekStartDay: 1,
    wipLimit: 2,
    defaultTaskEstimate: 60,
    theme: 'DARK',
    initialized: false,
  };
}

// ── Courses ──────────────────────────────────────────────────────────

export const courseRepo = {
  list(): Promise<Course[]> {
    return db.courses.toArray();
  },
  get(id: ID) {
    return db.courses.get(id);
  },
  async create(course: Omit<Course, 'id'>): Promise<Course> {
    const c: Course = { ...course, id: uid('course') };
    await db.courses.put(c);
    return c;
  },
  async update(id: ID, patch: Partial<Course>): Promise<void> {
    await db.courses.update(id, patch);
  },
  async remove(id: ID): Promise<void> {
    await db.courses.delete(id);
  },
};

// ── Projects & milestones ────────────────────────────────────────────

export const projectRepo = {
  list(): Promise<Project[]> {
    return db.projects.toArray();
  },
  async create(project: Omit<Project, 'id'>): Promise<Project> {
    const p: Project = { ...project, id: uid('proj') };
    await db.projects.put(p);
    return p;
  },
  async update(id: ID, patch: Partial<Project>): Promise<void> {
    await db.projects.update(id, patch);
  },
  async remove(id: ID): Promise<void> {
    const milestones = await db.milestones.where('projectId').equals(id).toArray();
    await db.milestones.bulkDelete(milestones.map((m) => m.id));
    await db.projects.delete(id);
  },
};

export const milestoneRepo = {
  list(): Promise<Milestone[]> {
    return db.milestones.toArray();
  },
  async create(m: Omit<Milestone, 'id'>): Promise<Milestone> {
    const ms: Milestone = { ...m, id: uid('ms') };
    await db.milestones.put(ms);
    return ms;
  },
  async update(id: ID, patch: Partial<Milestone>): Promise<void> {
    await db.milestones.update(id, patch);
  },
  async remove(id: ID): Promise<void> {
    await db.milestones.delete(id);
  },
};

// ── Tasks ────────────────────────────────────────────────────────────

export const taskRepo = {
  list(): Promise<Task[]> {
    return db.tasks.toArray();
  },
  get(id: ID) {
    return db.tasks.get(id);
  },
  async create(task: Omit<Task, 'id' | 'createdAt'>): Promise<Task> {
    const t: Task = { ...task, id: uid('task'), createdAt: new Date().toISOString() };
    await db.tasks.put(t);
    return t;
  },
  async update(id: ID, patch: Partial<Task>): Promise<void> {
    await db.tasks.update(id, patch);
  },
  async complete(id: ID, actualMinutes?: number): Promise<void> {
    const patch: Partial<Task> = { status: 'DONE', completedAt: new Date().toISOString() };
    if (actualMinutes != null) patch.actualMinutes = actualMinutes;
    await db.tasks.update(id, patch);
  },
  async reopen(id: ID): Promise<void> {
    await db.tasks.update(id, { status: 'READY', completedAt: undefined, actualMinutes: undefined });
  },
  async remove(id: ID): Promise<void> {
    // Detach from blocks
    const blocks = await db.blocks.toArray();
    for (const b of blocks.filter((b) => b.taskIds.includes(id))) {
      await db.blocks.update(b.id, { taskIds: b.taskIds.filter((t) => t !== id) });
    }
    await db.tasks.delete(id);
  },
};

// ── Blocks ───────────────────────────────────────────────────────────

export const blockRepo = {
  list(): Promise<Block[]> {
    return db.blocks.toArray();
  },
  get(id: ID) {
    return db.blocks.get(id);
  },
  async create(block: Omit<Block, 'id'>): Promise<Block> {
    const b: Block = { ...block, id: uid('block') };
    await db.blocks.put(b);
    return b;
  },
  /** Re-insert a block with its original id (undo / restore support). */
  async restore(block: Block): Promise<void> {
    await db.blocks.put(block);
  },
  async update(id: ID, patch: Partial<Block>): Promise<void> {
    await db.blocks.update(id, patch);
  },
  async remove(id: ID): Promise<void> {
    await db.blocks.delete(id);
  },
  async attachTask(blockId: ID, taskId: ID): Promise<void> {
    const b = await db.blocks.get(blockId);
    if (!b) return;
    if (!b.taskIds.includes(taskId)) {
      await db.blocks.update(blockId, { taskIds: [...b.taskIds, taskId] });
    }
    const t = await db.tasks.get(taskId);
    if (t && t.status === 'BACKLOG') {
      await db.tasks.update(taskId, { status: 'READY' });
    }
  },
  async detachTask(blockId: ID, taskId: ID): Promise<void> {
    const b = await db.blocks.get(blockId);
    if (!b) return;
    await db.blocks.update(blockId, {
      taskIds: b.taskIds.filter((t) => t !== taskId),
    });
  },
};

// ── Weekly outcomes & reviews ────────────────────────────────────────

export const outcomeRepo = {
  list(): Promise<WeeklyOutcome[]> {
    return db.weeklyOutcomes.toArray();
  },
  async create(o: Omit<WeeklyOutcome, 'id'>): Promise<WeeklyOutcome> {
    const w: WeeklyOutcome = { ...o, id: uid('wo') };
    await db.weeklyOutcomes.put(w);
    return w;
  },
  async update(id: ID, patch: Partial<WeeklyOutcome>): Promise<void> {
    await db.weeklyOutcomes.update(id, patch);
  },
  async remove(id: ID): Promise<void> {
    await db.weeklyOutcomes.delete(id);
  },
};

export const reviewRepo = {
  get(weekId: ID) {
    return db.reviews.get(weekId);
  },
  async save(review: WeeklyReview): Promise<void> {
    await db.reviews.put(review);
  },
};
