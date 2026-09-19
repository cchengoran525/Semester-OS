import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from './db';
import * as repos from './repositories';
import { seedIfFirstLaunch } from './seed';
import { exportAll, importAll, parseImport } from '../services/importExport';

async function resetDb() {
  await Promise.all(db.tables.map((t) => t.clear()));
}

beforeEach(async () => {
  await resetDb();
});

describe('seed', () => {
  it('seeds courses and projects on first launch only', async () => {
    const seeded = await seedIfFirstLaunch();
    expect(seeded).toBe(true);

    const courses = await repos.courseRepo.list();
    const projects = await repos.projectRepo.list();
    expect(courses.map((c) => c.name)).toContain('数据结构');
    expect(courses.map((c) => c.name)).toContain('操作系统');
    expect(projects.map((p) => p.name)).toContain('课程大作业');
    expect(projects.map((p) => p.name)).toContain('个人网站');
    expect(projects.filter((p) => p.status === 'ACTIVE')).toHaveLength(0); // 只留名字，全部待启动
    expect(await repos.milestoneRepo.list()).toHaveLength(0); // 里程碑由用户自建
    expect(await repos.taskRepo.list()).toHaveLength(0); // 无示例任务

    // Second launch must NOT re-seed (would wipe user edits)
    const course = courses[0];
    await repos.courseRepo.update(course.id, { name: '改名测试' });
    const again = await seedIfFirstLaunch();
    expect(again).toBe(false);
    const after = await repos.courseRepo.list();
    expect(after.find((c) => c.id === course.id)?.name).toBe('改名测试');
  });
});

describe('task & block workflow', () => {
  it('create → assign to block → complete → reschedule', async () => {
    const task = await repos.taskRepo.create({
      title: '完成课程大作业的开题调研',
      projectId: 'p1',
      estimateMinutes: 90,
      priority: 'HIGH',
      status: 'READY',
    });
    expect(task.id).toMatch(/^task_/);

    const block = await repos.blockRepo.create({
      start: '2026-09-03T14:00:00',
      end: '2026-09-03T16:00:00',
      type: 'DEEP_WORK',
      source: 'USER',
      context: 'p1',
      taskIds: [],
      status: 'PLANNED',
    });

    await repos.blockRepo.attachTask(block.id, task.id);
    let b = await repos.blockRepo.get(block.id);
    expect(b?.taskIds).toContain(task.id);

    // Same task can live in a second block (many-to-many)
    const block2 = await repos.blockRepo.create({
      start: '2026-09-04T14:00:00',
      end: '2026-09-04T15:30:00',
      type: 'DEEP_WORK',
      source: 'USER',
      taskIds: [],
      status: 'PLANNED',
    });
    await repos.blockRepo.attachTask(block2.id, task.id);
    b = await repos.blockRepo.get(block2.id);
    expect(b?.taskIds).toContain(task.id);

    // Complete with actual minutes (estimate 90 → actual 170)
    await repos.taskRepo.complete(task.id, 170);
    const done = await repos.taskRepo.get(task.id);
    expect(done?.status).toBe('DONE');
    expect(done?.actualMinutes).toBe(170);
    expect(done?.completedAt).toBeTruthy();

    // Reschedule: reopen and move due date — no penalty, just a new plan
    await repos.taskRepo.reopen(task.id);
    await repos.taskRepo.update(task.id, { dueDate: '2026-09-10' });
    const reopened = await repos.taskRepo.get(task.id);
    expect(reopened?.status).toBe('READY');
    expect(reopened?.dueDate).toBe('2026-09-10');

    // Deleting a task detaches it from blocks
    await repos.taskRepo.remove(task.id);
    const bAfter = await repos.blockRepo.get(block.id);
    expect(bAfter?.taskIds).not.toContain(task.id);
  });
});

describe('import / export', () => {
  it('round-trips data with schema version and validates', async () => {
    await seedIfFirstLaunch();
    await repos.taskRepo.create({
      title: '测试任务',
      estimateMinutes: 30,
      priority: 'LOW',
      status: 'READY',
    });

    const json = await exportAll();
    const bundle = parseImport(json);
    expect(bundle.schemaVersion).toBe(1);
    expect(bundle.data.courses.length).toBeGreaterThan(0);
    expect(bundle.data.tasks.some((t) => t.title === '测试任务')).toBe(true);

    // Wipe, then import restores
    await resetDb();
    await importAll(bundle);
    const tasks = await repos.taskRepo.list();
    expect(tasks.some((t) => t.title === '测试任务')).toBe(true);
    const settings = await repos.settingsRepo.get();
    expect(settings?.initialized).toBe(true);
  });

  it('rejects invalid payloads', () => {
    expect(() => parseImport('not json')).toThrow();
    expect(() => parseImport('{"schemaVersion":99,"data":{}}')).toThrow(/版本/);
    expect(() =>
      parseImport('{"schemaVersion":1,"data":{"courses":[{}],"projects":[],"milestones":[],"tasks":[],"blocks":[],"weeklyOutcomes":[],"reviews":[]}}'),
    ).toThrow(/缺少字段/);
  });

  it('strips AI config (key / personal context) from exports', async () => {
    await seedIfFirstLaunch();
    await repos.settingsRepo.save({
      ai: { baseUrl: 'https://x.test', apiKey: 'sk-secret', model: 'm', context: '我的背景' },
    });
    const json = await exportAll();
    expect(json).not.toContain('sk-secret');
    expect(json).not.toContain('我的背景');
    const bundle = parseImport(json);
    expect(bundle.data.settings?.ai).toBeUndefined();
  });
});
