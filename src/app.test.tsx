import { afterEach, describe, expect, it, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { db } from './storage/db';
import { seedIfFirstLaunch } from './storage/seed';
import * as repos from './storage/repositories';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedIfFirstLaunch();
});

// 项目未开 vitest globals，Testing Library 自动 cleanup 不生效，需手动清理
afterEach(cleanup);

describe('Semester OS App', () => {
  it('renders dashboard with seeded data', async () => {
    render(<App />);
    await waitFor(
      () => expect(screen.getByText('总览')).toBeInTheDocument(),
      { timeout: 15000 },
    );
    await waitFor(() =>
      expect(screen.getAllByText('电路基础').length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/AS \/ Aeroshield/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/进行中项目/).length).toBeGreaterThan(0);
  });

  it('dashboard reflects newly created tasks (live query)', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getAllByText('电路基础').length).toBeGreaterThan(0));

    await repos.taskRepo.create({
      title: 'UI 集成测试任务',
      estimateMinutes: 45,
      priority: 'HIGH',
      status: 'READY',
    });

    await waitFor(() =>
      expect(screen.getAllByText('UI 集成测试任务').length).toBeGreaterThan(0),
    );
  });

  it('persists a created task across a fresh render (refresh simulation)', async () => {
    const { unmount } = render(<App />);
    await waitFor(() => expect(screen.getAllByText('电路基础').length).toBeGreaterThan(0));
    await repos.taskRepo.create({
      title: '刷新后仍在的任务',
      estimateMinutes: 30,
      priority: 'MEDIUM',
      status: 'READY',
    });
    await waitFor(() => expect(screen.getByText('刷新后仍在的任务')).toBeInTheDocument());
    unmount();

    // New render = new React tree reading from the same IndexedDB
    render(<App />);
    await waitFor(() =>
      expect(screen.getAllByText('刷新后仍在的任务').length).toBeGreaterThan(0),
    );
  });
});
