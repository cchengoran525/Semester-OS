import { describe, expect, it, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { db } from './db';
import { seedIfFirstLaunch } from './seed';
import * as repos from './repositories';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedIfFirstLaunch();
});

describe('自动备份/同步的触发链', () => {
  it('Dexie storagemutated 事件在写入后触发（自动保存的驱动源）', async () => {
    if (!db.isOpen()) await db.open();
    let fired = 0;
    const off = (
      Dexie as unknown as { on: (e: string, cb: () => void) => unknown }
    ).on('storagemutated', () => { fired += 1; });
    await repos.taskRepo.create({
      title: '触发测试任务',
      estimateMinutes: 30,
      priority: 'MEDIUM',
      status: 'READY',
    });
    await new Promise((r) => setTimeout(r, 50));
    if (typeof off === 'function') (off as () => void)();
    console.log('storagemutated 触发次数:', fired);
    expect(fired).toBeGreaterThan(0);
  });
});
