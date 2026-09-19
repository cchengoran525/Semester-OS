import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { db } from './storage/db';
import { seedIfFirstLaunch } from './storage/seed';
import * as repos from './storage/repositories';
import { atTime, toISODate, todayDate } from './services/timeService';

/**
 * 详情弹窗编辑链路：各页面打开详情 → 高自由度修改 → 落库生效。
 * 覆盖任务详情（标题/备注/优先级/截止）与时间块详情（时间/类型/挂摘任务），
 * 以及日历、复盘两个页面的新增入口。
 *
 * 注：项目未开启 vitest globals，需手动 cleanup。
 */

beforeEach(async () => {
  window.location.hash = '';
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedIfFirstLaunch();
  const now = new Date().toISOString();
  await db.tasks.bulkPut([
    { id: 't1', title: '完成课程大作业的开题调研', projectId: 'p1', estimateMinutes: 90, priority: 'HIGH', status: 'READY', createdAt: now },
    { id: 't2', title: '修复个人网站的登录问题', projectId: 'p2', estimateMinutes: 60, priority: 'HIGH', status: 'READY', createdAt: now },
    { id: 't3', title: '整理数据结构第一章例题', courseId: 'c6', estimateMinutes: 45, priority: 'MEDIUM', status: 'READY', createdAt: now },
  ]);
});

afterEach(cleanup);

async function renderApp() {
  render(<App />);
  await waitFor(() => expect(screen.getByText('下一步建议')).toBeInTheDocument(), { timeout: 15000 });
}

async function expectToast(re: RegExp) {
  await waitFor(() => expect(screen.getByText(re)).toBeInTheDocument());
}

describe('任务详情弹窗：高自由度修改', () => {
  it('任务页打开详情 → 改标题/备注/优先级/截止 → 保存落库', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole('link', { name: '任务' }));
    const dialog = await screen.findByRole('dialog', { name: '任务详情' }).catch(() => null);
    if (!dialog) {
      // 打开 t1 详情
      await user.click(screen.getAllByText('完成课程大作业的开题调研')[0]);
    }
    const dlg = await screen.findByRole('dialog', { name: '任务详情' });

    const title = within(dlg).getByLabelText('标题') as HTMLInputElement;
    await user.clear(title);
    await user.type(title, '完成课程大作业的开题调研（修订）');
    await user.type(within(dlg).getByLabelText('备注'), '记得附上参考书目');
    await user.selectOptions(within(dlg).getByLabelText('优先级'), 'MEDIUM');
    fireEvent.change(within(dlg).getByLabelText('截止日期（可选）'), { target: { value: '2026-09-25' } });
    await user.click(within(dlg).getByRole('button', { name: '保存' }));
    await expectToast(/已保存/);

    const t1 = await repos.taskRepo.get('t1');
    expect(t1).toMatchObject({
      title: '完成课程大作业的开题调研（修订）',
      notes: '记得附上参考书目',
      priority: 'MEDIUM',
      dueDate: '2026-09-25',
      status: 'READY',
    });
  });

  it('日历页待排任务点击 → 打开任务详情（新入口）', async () => {
    const user = userEvent.setup();
    await renderApp();
    await user.click(screen.getByRole('link', { name: '日历' }));
    await screen.findByText('待排任务 · 拖到日历');
    await user.click(screen.getAllByText('修复个人网站的登录问题')[0]);
    expect(await screen.findByRole('dialog', { name: '任务详情' })).toBeInTheDocument();
  });

  it('复盘页已完成任务点击 → 打开任务详情（新入口）', async () => {
    const user = userEvent.setup();
    await repos.taskRepo.complete('t2');
    await renderApp();
    await user.click(screen.getByRole('link', { name: '复盘' }));
    await screen.findByText('每周复盘');
    const sticky = screen.getAllByText(/修复个人网站的登录问题/)[0];
    await user.click(sticky);
    expect(await screen.findByRole('dialog', { name: '任务详情' })).toBeInTheDocument();
  });
});

describe('时间块详情弹窗：高自由度修改', () => {
  it('总览点块卡 → 弹窗 → 改时间/类型/备注/挂任务 → 保存落库', async () => {
    const user = userEvent.setup();
    const today = toISODate(todayDate());
    await repos.blockRepo.create({
      start: atTime(today, '15:00'),
      end: atTime(today, '17:00'),
      type: 'DEEP_WORK',
      source: 'USER',
      context: 'p1',
      taskIds: [],
      energy: 3,
      status: 'PLANNED',
      plannedMinutes: 120,
    });
    await renderApp();

    // 块卡显示时间段，点击打开详情（总览新入口）
    await user.click(screen.getAllByText('15:00–17:00')[0]);
    const dlg = await screen.findByRole('dialog', { name: '时间块详情' });

    // 挂任务（离散操作，立即生效）
    await user.selectOptions(within(dlg).getByLabelText('选择要挂上的任务'), 't2');
    await user.click(within(dlg).getByRole('button', { name: '挂上' }));
    await expectToast(/已挂上任务/);

    // 改结束时间 / 类型 / 精力 / 备注
    fireEvent.change(within(dlg).getByLabelText('结束'), { target: { value: '18:00' } });
    await user.selectOptions(within(dlg).getByLabelText('类型'), 'ENGINEERING');
    await user.selectOptions(within(dlg).getByLabelText('精力 (1–5)'), '5');
    await user.type(within(dlg).getByLabelText('备注'), '先画装配图');
    await user.click(within(dlg).getByRole('button', { name: '保存' }));
    await expectToast(/已保存/);

    const blocks = await repos.blockRepo.list();
    const b = blocks.find((x) => x.start.slice(11, 16) === '15:00');
    expect(b).toBeDefined();
    expect(b).toMatchObject({
      end: `${today}T18:00:00`,
      type: 'ENGINEERING',
      energy: 5,
      notes: '先画装配图',
      plannedMinutes: 180,
    });
    expect(b?.taskIds).toContain('t2');
  });

  it('块详情移出任务 → 立即生效；删除块 → 可撤销', async () => {
    const user = userEvent.setup();
    const today = toISODate(todayDate());
    await repos.blockRepo.create({
      start: atTime(today, '19:00'),
      end: atTime(today, '20:00'),
      type: 'ADMIN',
      source: 'USER',
      taskIds: ['t3'],
      status: 'PLANNED',
      plannedMinutes: 60,
    });
    await renderApp();

    await user.click(screen.getAllByText('19:00–20:00')[0]);
    const dlg = await screen.findByRole('dialog', { name: '时间块详情' });
    await user.click(within(dlg).getByRole('button', { name: '移出' }));
    await waitFor(async () => {
      const blocks = await repos.blockRepo.list();
      expect(blocks[0]?.taskIds).not.toContain('t3');
    });

    await user.click(within(dlg).getByRole('button', { name: '删除' }));
    await expectToast(/已删除时间块|时间块已删除/);
    await waitFor(async () => {
      expect((await repos.blockRepo.list()).filter((b) => b.start.slice(11, 16) === '19:00')).toHaveLength(0);
    });
  });
});
