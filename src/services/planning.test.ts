import { describe, expect, it } from 'vitest';
import type { Block, Course, Settings } from '../domain/types';
import { collectUpcomingWindows, roundUpToQuarter } from './planning';

const settings: Settings = {
  id: 'app',
  semesterStart: '2026-09-01',
  semesterEnd: '2026-12-31',
  timezone: 'Asia/Shanghai',
  weekStartDay: 1,
  wipLimit: 2,
  defaultTaskEstimate: 60,
  theme: 'DARK',
  initialized: true,
};

const noCourses: Course[] = [];
const noBlocks: Block[] = [];

describe('roundUpToQuarter', () => {
  it('rounds up to the next 15-minute mark and keeps exact marks', () => {
    expect(roundUpToQuarter(new Date(2026, 8, 6, 17, 23, 40)).getMinutes()).toBe(30);
    expect(roundUpToQuarter(new Date(2026, 8, 6, 17, 30, 0)).getMinutes()).toBe(30);
    expect(roundUpToQuarter(new Date(2026, 8, 6, 17, 31, 0)).getHours()).toBe(17);
    expect(roundUpToQuarter(new Date(2026, 8, 6, 17, 31, 0)).getMinutes()).toBe(45);
  });
});

describe('collectUpcomingWindows', () => {
  it('never returns windows earlier than now on the current day', () => {
    const now = new Date(2026, 8, 6, 17, 23, 0); // 本地时间 17:23
    const windows = collectUpcomingWindows(now, noCourses, settings, noBlocks, 2, 30);
    const today = windows.filter((w) => w.date === '2026-09-06');
    expect(today.length).toBeGreaterThan(0);
    // 今天的窗口必须从 17:30 开始（向上取整），且一天中最晚不超过 22:00
    expect(today[0].start).toBe('17:30');
    expect(today[today.length - 1].end).toBe('22:00');
    for (const w of windows) {
      if (w.date === '2026-09-06') expect(w.start >= '17:30').toBe(true);
    }
  });

  it('keeps the full 08:00–22:00 window for future days', () => {
    const now = new Date(2026, 8, 6, 17, 23, 0);
    const windows = collectUpcomingWindows(now, noCourses, settings, noBlocks, 2, 30);
    const tomorrow = windows.find((w) => w.date === '2026-09-07');
    expect(tomorrow).toMatchObject({ start: '08:00', end: '22:00', minutes: 14 * 60 });
  });

  it('produces no window for today once the day is over', () => {
    const now = new Date(2026, 8, 6, 22, 30, 0);
    const windows = collectUpcomingWindows(now, noCourses, settings, noBlocks, 2, 30);
    expect(windows.some((w) => w.date === '2026-09-06')).toBe(false);
  });
});
