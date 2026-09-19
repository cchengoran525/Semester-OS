import type { Block, Course, Recurrence, ScheduleOverride, Settings } from '../domain/types';
import { expandSlot, slotOccursOn, toISODate } from './timeService';

/**
 * Class schedules expand into virtual read-only Blocks (source: SCHEDULE).
 * They are computed on demand, never persisted, so the calendar always
 * reflects the current course schedule.
 *
 * 教学日历例外（调休/放假）优先于常规规则：
 *   - off：整天无课
 *   - weekday + recurrence：按指定星期几的课表上课（可限定单/双周口径）
 */
export function scheduleBlocksForDate(
  date: Date,
  courses: Course[],
  settings: Pick<Settings, 'semesterStart' | 'scheduleOverrides'>,
): Block[] {
  const dateISO = toISODate(date);
  const override = settings.scheduleOverrides?.find((o) => o.date === dateISO);
  if (override?.off) return [];

  const out: Block[] = [];
  for (const course of courses) {
    for (const slot of course.schedule) {
      if (override?.weekday) {
        if (slot.weekday !== override.weekday) continue;
        if (!matchesParity(slot.recurrence, override.recurrence ?? 'WEEKLY')) continue;
      } else if (!slotOccursOn(slot, date, settings.semesterStart)) {
        continue;
      }
      const { start, end } = expandSlot(slot, date);
      out.push({
        id: `sched-${course.id}-${start}`,
        start,
        end,
        type: 'COURSE',
        source: 'SCHEDULE',
        context: course.id,
        taskIds: [],
        status: 'PLANNED',
        notes: slot.location,
      });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** 调休口径：WEEKLY 的课永远上；单/双周课只在口径匹配时上。 */
function matchesParity(slotRecurrence: Recurrence, target: Recurrence): boolean {
  if (slotRecurrence === 'WEEKLY') return true;
  if (target === 'ODD_WEEK') return slotRecurrence === 'ODD_WEEK';
  if (target === 'EVEN_WEEK') return slotRecurrence === 'EVEN_WEEK';
  return false;
}

export function scheduleBlocksForRange(
  dates: Date[],
  courses: Course[],
  settings: Pick<Settings, 'semesterStart' | 'scheduleOverrides'>,
): Block[] {
  return dates.flatMap((d) => scheduleBlocksForDate(d, courses, settings));
}

export type { ScheduleOverride };
