import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { db } from './storage/db';
import { seedIfFirstLaunch } from './storage/seed';
import * as repos from './storage/repositories';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedIfFirstLaunch();
});

describe('Semester OS App', () => {
  it('renders dashboard with seeded data', async () => {
    render(<App />);
    await waitFor(
      () => expect(screen.getByText('Dashboard')).toBeInTheDocument(),
      { timeout: 5000 },
    );
    await waitFor(() =>
      expect(screen.getAllByText('电路基础').length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/AS \/ Aeroshield/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Active Projects/).length).toBeGreaterThan(0);
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
      expect(screen.getByText('UI 集成测试任务')).toBeInTheDocument(),
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
