import type { Block, Course, Settings } from '../domain/types';
import { expandSlot, slotOccursOn } from './timeService';

/**
 * Class schedules expand into virtual read-only Blocks (source: SCHEDULE).
 * They are computed on demand, never persisted, so the calendar always
 * reflects the current course schedule.
 */
export function scheduleBlocksForDate(date: Date, courses: Course[], settings: Pick<Settings, "semesterStart">): Block[] {
  const out: Block[] = [];
  for (const course of courses) {
    for (const slot of course.schedule) {
      if (!slotOccursOn(slot, date, settings.semesterStart)) continue;
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

export function scheduleBlocksForRange(
  dates: Date[],
  courses: Course[],
  settings: Pick<Settings, "semesterStart">,
): Block[] {
  return dates.flatMap((d) => scheduleBlocksForDate(d, courses, settings));
}
