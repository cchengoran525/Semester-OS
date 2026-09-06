import { describe, expect, it } from 'vitest';
import type { Block, Course, Project, Task } from '../domain/types';
import { suggestHealth, totalDebt, healthDrift, courseWarnings } from './courseService';
import { milestoneProgress, wipStatus } from './projectService';
import { attentionAllocation, deepWorkBreakdown, estimateVsActual, openUnscheduledTasks, taskCounts } from './statistics';
import { conflictsWith, findConflicts, freeWindows, rankTasks } from './scheduler';
import { minutesBetween } from './timeService';
import { handleTaskUnschedule, shiftBlockToDay } from './dropActions';

const noDebt = { understanding: 0, assignment: 0, review: 0, exam: 0 };

describe('courseService', () => {
  it('suggests GREEN when no debt', () => {
    expect(suggestHealth(noDebt)).toBe('GREEN');
  });
  it('suggests YELLOW on small debt', () => {
    expect(suggestHealth({ understanding: 2, assignment: 0, review: 1, exam: 0 })).toBe('YELLOW');
  });
  it('suggests RED on severe debt', () => {
    expect(suggestHealth({ understanding: 3, assignment: 0, review: 0, exam: 0 })).toBe('RED');
    expect(suggestHealth({ understanding: 0, assignment: 0, review: 0, exam: 2 })).toBe('RED');
  });
  it('totals debt across categories', () => {
    expect(totalDebt({ understanding: 1, assignment: 2, review: 3, exam: 4 })).toBe(10);
  });
  it('flags non-green courses as warnings', () => {
    const courses: Course[] = [
      { id: 'c1', name: '电路', schedule: [], health: 'GREEN', debt: noDebt },
      { id: 'c2', name: '控数', schedule: [], health: 'YELLOW', debt: { understanding: 2, assignment: 0, review: 1, exam: 0 } },
    ];
    expect(courseWarnings(courses)).toHaveLength(1);
    expect(courseWarnings(courses)[0].courseName).toBe('控数');
  });
  it('detects health drift when debt worse than confirmed health', () => {
    const courses: Course[] = [
      { id: 'c1', name: '信号', schedule: [], health: 'GREEN', debt: { understanding: 3, assignment: 0, review: 0, exam: 0 } },
    ];
    const drift = healthDrift(courses);
    expect(drift).toHaveLength(1);
    expect(drift[0].message).toContain('信号');
  });
});

describe('projectService', () => {
  it('每个完成的里程碑固定加 1%', () => {
    const ms = [
      { id: '1', projectId: 'p', name: 'M0', order: 0, status: 'DONE' as const },
      { id: '2', projectId: 'p', name: 'M1', order: 1, status: 'DOING' as const },
      { id: '3', projectId: 'p', name: 'M2', order: 2, status: 'TODO' as const },
      { id: '4', projectId: 'p', name: 'M3', order: 3, status: 'TODO' as const },
    ];
    expect(milestoneProgress(ms)).toBe(1); // 1 个完成 = 1%
    expect(milestoneProgress([{ id: '1', projectId: 'p', name: 'M0', order: 0, status: 'DONE' as const }])).toBe(1);
    expect(milestoneProgress([])).toBe(0);
  });
  it('handles empty milestones', () => {
    expect(milestoneProgress([])).toBe(0);
  });
  it('computes WIP status with soft limit', () => {
    const mk = (status: Project['status']): Project => ({
      id: 'p', name: 'x', status, priority: 'MEDIUM',
    });
    const two = [mk('ACTIVE'), mk('ACTIVE'), mk('BACKLOG')];
    const w = wipStatus(two, 2);
    expect(w.activeCount).toBe(2);
    expect(w.atLimit).toBe(true);
    expect(w.overLimit).toBe(false);
    expect(wipStatus([...two, mk('ACTIVE')], 2).overLimit).toBe(true);
  });
});

describe('statistics', () => {
  const mkBlock = (start: string, end: string, type: Block['type'], context?: string): Block => ({
    id: start + type, start, end, type, source: 'USER', taskIds: [], status: 'PLANNED', context,
  });

  it('deep work counts DEEP_WORK and ENGINEERING grouped by context', () => {
    const blocks = [
      mkBlock('2026-09-03T14:00:00', '2026-09-03T16:00:00', 'DEEP_WORK', 'AS'),
      mkBlock('2026-09-03T19:00:00', '2026-09-03T21:00:00', 'ENGINEERING', 'SC'),
      mkBlock('2026-09-03T10:00:00', '2026-09-03T11:00:00', 'ADMIN'),
    ];
    const dw = deepWorkBreakdown(blocks);
    expect(dw.totalMinutes).toBe(240);
    expect(dw.byContext.AS).toBe(120);
    expect(dw.byContext.SC).toBe(120);
  });
  it('prefers actualMinutes when present', () => {
    const b = { ...mkBlock('2026-09-03T14:00:00', '2026-09-03T16:00:00', 'DEEP_WORK'), actualMinutes: 170 };
    expect(deepWorkBreakdown([b]).totalMinutes).toBe(170);
  });
  it('computes attention allocation percentages', () => {
    const blocks = [
      mkBlock('2026-09-03T14:00:00', '2026-09-03T16:00:00', 'DEEP_WORK'),
      mkBlock('2026-09-03T17:00:00', '2026-09-03T18:00:00', 'COURSE'),
    ];
    const alloc = attentionAllocation(blocks);
    expect(alloc.find((a) => a.type === 'DEEP_WORK')?.percent).toBe(67);
    expect(alloc.find((a) => a.type === 'COURSE')?.percent).toBe(33);
  });
  it('estimate vs actual only for done tasks with both numbers', () => {
    const tasks: Task[] = [
      { id: '1', title: 'a', estimateMinutes: 90, priority: 'MEDIUM', status: 'DONE', createdAt: '', actualMinutes: 170 },
      { id: '2', title: 'b', estimateMinutes: 90, priority: 'MEDIUM', status: 'DONE', createdAt: '' },
      { id: '3', title: 'c', estimateMinutes: 90, priority: 'MEDIUM', status: 'READY', createdAt: '', actualMinutes: 30 },
    ];
    const acc = estimateVsActual(tasks);
    expect(acc).toHaveLength(1);
    expect(acc[0].actual).toBe(170);
  });
  it('openUnscheduledTasks hides tasks attached to any live block (date-independent)', () => {
    const tasks: Task[] = [
      { id: 't1', title: '已排进过去块', estimateMinutes: 30, priority: 'MEDIUM', status: 'READY', createdAt: '' },
      { id: 't2', title: '还没排', estimateMinutes: 30, priority: 'MEDIUM', status: 'READY', createdAt: '' },
      { id: 't3', title: '在已完成块里但仍未完成', estimateMinutes: 30, priority: 'MEDIUM', status: 'READY', createdAt: '' },
    ];
    const blocks: Block[] = [
      { id: 'b1', start: '2026-09-05T14:00:00', end: '2026-09-05T15:00:00', type: 'DEEP_WORK', source: 'USER', taskIds: ['t1'], status: 'PLANNED' },
      { id: 'b2', start: '2026-09-05T09:00:00', end: '2026-09-05T10:00:00', type: 'COURSE', source: 'USER', taskIds: ['t3'], status: 'DONE' },
    ];
    const open = openUnscheduledTasks(tasks, blocks);
    expect(open.map((t) => t.id)).toEqual(['t2', 't3']);
    expect(openUnscheduledTasks(tasks, blocks, 1)).toHaveLength(1);
  });
  it('taskCounts counts overdue open tasks', () => {
    const tasks: Task[] = [
      { id: '1', title: 'a', estimateMinutes: 0, priority: 'LOW', status: 'DONE', createdAt: '' },
      { id: '2', title: 'b', estimateMinutes: 0, priority: 'LOW', status: 'READY', createdAt: '', dueDate: '2000-01-01' },
    ];
    const c = taskCounts(tasks);
    expect(c.done).toBe(1);
    expect(c.overdue).toBe(1);
    expect(c.open).toBe(1);
  });
});

describe('dropActions', () => {
  it('shiftBlockToDay keeps time of day and survives month boundaries', () => {
    const block: Block = {
      id: 'b1',
      start: '2026-08-31T22:30:00',
      end: '2026-09-01T00:30:00',
      type: 'DEEP_WORK',
      source: 'USER',
      taskIds: [],
      status: 'PLANNED',
    };
    const moved = shiftBlockToDay(block, '2026-09-05');
    expect(moved.start).toBe('2026-09-05T22:30:00');
    expect(moved.end).toBe('2026-09-06T00:30:00');
  });

  it('handleTaskUnschedule reports when the task is in no block', async () => {
    const task: Task = { id: 't1', title: '自由任务', estimateMinutes: 30, priority: 'LOW', status: 'READY', createdAt: '' };
    const res = await handleTaskUnschedule(task, []);
    expect(res.message).toContain('不在任何时间块里');
  });
});

describe('scheduler', () => {
  it('detects overlapping blocks', () => {
    const a: Block = { id: 'a', start: '2026-09-03T14:00:00', end: '2026-09-03T16:00:00', type: 'DEEP_WORK', source: 'USER', taskIds: [], status: 'PLANNED' };
    const b: Block = { id: 'b', start: '2026-09-03T15:00:00', end: '2026-09-03T17:00:00', type: 'COURSE', source: 'USER', taskIds: [], status: 'PLANNED' };
    const c: Block = { id: 'c', start: '2026-09-03T17:00:00', end: '2026-09-03T18:00:00', type: 'COURSE', source: 'USER', taskIds: [], status: 'PLANNED' };
    expect(findConflicts([a, b, c])).toHaveLength(1);
    expect(conflictsWith({ start: a.start, end: a.end }, [b, c])).toEqual([b]);
  });
  it('finds free windows in a day', () => {
    const busy: Block[] = [
      { id: 'a', start: '2026-09-03T10:00:00', end: '2026-09-03T12:00:00', type: 'COURSE', source: 'SCHEDULE', taskIds: [], status: 'PLANNED' },
    ];
    const wins = freeWindows('2026-09-03T08:00:00', '2026-09-03T18:00:00', busy, 45);
    expect(wins).toHaveLength(2);
    expect(wins[0].minutes).toBe(120);
    expect(wins[1].minutes).toBe(360);
  });
  it('ranks overdue + high-priority + risky-course tasks first', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const courses: Course[] = [
      { id: 'c1', name: 'RED 课', schedule: [], health: 'RED', debt: { understanding: 2, assignment: 1, review: 0, exam: 0 } },
    ];
    const projects: Project[] = [
      { id: 'p1', name: 'AS', status: 'ACTIVE', priority: 'HIGH' },
    ];
    const base = { estimateMinutes: 60, createdAt: '' };
    const tasks: Task[] = [
      { id: 't1', title: '低优先级', ...base, priority: 'LOW', status: 'READY' },
      { id: 't2', title: '逾期任务', ...base, priority: 'MEDIUM', status: 'READY', dueDate: yesterday },
      { id: 't3', title: '红色课程任务', ...base, priority: 'MEDIUM', status: 'READY', courseId: 'c1' },
      { id: 't4', title: 'active 项目任务', ...base, priority: 'MEDIUM', status: 'READY', projectId: 'p1' },
    ];
    const ranked = rankTasks(tasks, { courses, projects, contextMinutesThisWeek: {}, now: new Date() });
    expect(ranked[0].task.id).toBe('t2');
    expect(ranked[1].task.id).toBe('t3');
    expect(ranked.find((r) => r.task.id === 't4')!.reasons).toContain('AS 是进行中项目');
    expect(ranked.at(-1)!.task.id).toBe('t1');
  });
});

describe('timeService', () => {
  it('computes minutes between ISO datetimes', () => {
    expect(minutesBetween('2026-09-03T14:00:00', '2026-09-03T16:30:00')).toBe(150);
  });
});
