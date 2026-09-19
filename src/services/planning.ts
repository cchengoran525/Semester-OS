import type { Block, Course, Settings } from '../domain/types';
import { scheduleBlocksForDate } from './scheduleService';
import { freeWindows } from './scheduler';
import { atTime, toISODate, toISODateTime } from './timeService';

/**
 * 排期用的未来空闲窗口。与 scheduler.freeWindows 的区别：
 * **今天的窗口从"现在"开始**（向上取整到下一个 15 分钟），绝不返回已经过去的时段 ——
 * 计划的意义是不把任务排到过去。
 */

export interface UpcomingWindow {
  date: string; // yyyy-MM-dd
  start: string; // HH:mm
  end: string; // HH:mm
  minutes: number;
}

const DAY_START = '08:00';
const DAY_END = '22:00';
const ROUND_STEP_MS = 15 * 60 * 1000;

/** 向上取整到下一个 15 分钟（正好在刻度上则不变）。 */
export function roundUpToQuarter(now: Date): Date {
  return new Date(Math.ceil(now.getTime() / ROUND_STEP_MS) * ROUND_STEP_MS);
}

/**
 * 未来 N 天的空闲窗口集合：
 * - 今天：起始 = max(08:00, 现在向上取整)；已过 22:00 则今天不产生窗口
 * - 之后：整天 08:00–22:00，扣除课程块与已有块
 */
export function collectUpcomingWindows(
  now: Date,
  courses: Course[],
  settings: Settings,
  blocks: Block[],
  days = 7,
  minMinutes = 30,
): UpcomingWindow[] {
  const out: UpcomingWindow[] = [];
  const todayISO = toISODate(now);
  const dayStartISO = atTime(todayISO, DAY_START);
  const roundedISO = toISODateTime(roundUpToQuarter(now));
  const startToday = roundedISO > dayStartISO ? roundedISO : dayStartISO;

  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const dateISO = toISODate(d);
    const sched = scheduleBlocksForDate(d, courses, settings);
    const dayBlocks = [...blocks.filter((b) => b.start.slice(0, 10) === dateISO), ...sched];
    const dayEnd = atTime(dateISO, DAY_END);
    const from = dateISO === todayISO ? startToday : atTime(dateISO, DAY_START);
    if (from >= dayEnd) continue;
    for (const w of freeWindows(from, dayEnd, dayBlocks, minMinutes)) {
      out.push({
        date: dateISO,
        start: w.start.slice(11, 16),
        end: w.end.slice(11, 16),
        minutes: w.minutes,
      });
    }
  }
  return out;
}
