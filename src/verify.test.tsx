import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { db } from './storage/db';
import { seedIfFirstLaunch } from './storage/seed';
import * as repos from './storage/repositories';

beforeEach(async () => {
  window.location.hash = '';
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedIfFirstLaunch();
});
afterEach(cleanup);

describe('验证交互修复', () => {
  it('总览点待排任务整行 → 打开任务详情弹窗', async () => {
    const user = userEvent.setup();
    await repos.taskRepo.create({
      title: '修复个人网站的登录问题',
      estimateMinutes: 60,
      priority: 'HIGH',
      status: 'READY',
    });
    render(<App />);
    await waitFor(() => expect(screen.getAllByText('数据结构').length).toBeGreaterThan(0));
    // 课程健康行展开仍然可用（对照）
    const courseBtn = screen.getAllByRole('button', { name: /数据结构/ })[0];
    await user.click(courseBtn);
    await new Promise((r) => setTimeout(r, 200));
    expect(document.body.textContent).toContain('Understanding Debt');
    // 对照实验 2：点待排任务行
    await waitFor(async () => {
      const targets = screen.getAllByText('修复个人网站的登录问题');
      await user.click(targets[0]);
      expect(screen.getByRole('dialog', { name: '任务详情' })).toBeInTheDocument();
    }, { timeout: 5000 });
  });
});

describe('验证本轮三项改动', () => {
  it('1) 侧栏明暗切换：点击后 dataset.theme 翻转', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getAllByText('数据结构').length).toBeGreaterThan(0));
    await waitFor(async () => {
      const btn = screen.getByRole('button', { name: /浅色|深色/ });
      await user.click(btn);
      await new Promise((r) => setTimeout(r, 150));
      const stored = (await repos.settingsRepo.get())?.theme;
      expect(stored).toBe('LIGHT');
    }, { timeout: 8000 });
    await waitFor(
      () => expect(document.documentElement.dataset.theme).toBe('light'),
      { timeout: 3000 },
    );
  });

  it('2) 清空重置：保留课程/项目，清空预设任务与成果', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getAllByText('数据结构').length).toBeGreaterThan(0));

    await user.click(screen.getByRole('link', { name: '设置' }));
    await screen.findByText('数据');
    await user.click(screen.getByRole('button', { name: '清空数据并重新初始化' }));
    // reload 不会真的发生在 jsdom；手动等待清空完成
    await waitFor(async () => {
      const tasks = await db.tasks.toArray();
      const outcomes = await db.weeklyOutcomes.toArray();
      expect(tasks.length).toBe(0);
      expect(outcomes.length).toBe(0);
    }, { timeout: 5000 });
    // 等重置完整落库（项目裁剪是最后一步）
    await waitFor(async () => {
      expect(await db.milestones.toArray()).toHaveLength(0);
    }, { timeout: 5000 });
    const courses = await db.courses.toArray();
    const projects = await db.projects.toArray();
    expect(courses.map((c) => c.name)).toContain('大学物理实验');
    expect(courses.length).toBe(8);
    expect(projects.length).toBeGreaterThan(0);
    // 项目只保留名字：描述/里程碑/状态/优先级全部清空
    for (const p of projects) {
      expect(p.description).toBeUndefined();
      expect(p.notes).toBeUndefined();
      expect(p.currentMilestoneId).toBeUndefined();
      expect(p.status).toBe('BACKLOG');
      expect(p.priority).toBe('MEDIUM');
    }
  });

  it('3) 字体档位：设置 fontScale 后应用 --font-scale 变量', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getAllByText('数据结构').length).toBeGreaterThan(0));
    await user.click(screen.getByRole('link', { name: '设置' }));
    await screen.findByText('字体大小');
    await user.selectOptions(screen.getByLabelText('字体大小'), '1.1');
    await waitFor(async () => {
      expect((await repos.settingsRepo.get())?.fontScale).toBe(1.1);
    });
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--font-scale')).toBe('1.1');
    });
  });
});
