import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfWeek,
  format,
  isValid,
  parse,
  startOfWeek,
} from 'date-fns';
import type { ScheduleSlot } from '../domain/types';

/**
 * Central date/time service. All components import from here — no ad-hoc
 * date math scattered in the UI. Everything works in the browser's local
 * timezone (user sets Asia/Shanghai in the OS); ISO datetime strings are
 * local wall-clock time.
 */

export const ISO_DATETIME = "yyyy-MM-dd'T'HH:mm:ss";
export const ISO_DATE = 'yyyy-MM-dd';

export function todayDate(): Date {
  return new Date();
}

export function toDate(iso: string): Date {
  return parse(iso, ISO_DATETIME, new Date());
}

export function toISODateTime(d: Date): string {
  return format(d, ISO_DATETIME);
}

export function toISODate(d: Date): string {
  return format(d, ISO_DATE);
}

/** Combine a date and "HH:mm" into a local ISO datetime string. */
export function atTime(dateISO: string, time: string): string {
  return `${dateISO}T${time.length === 5 ? time : `${time}:00`}:00`;
}

export function formatTime(iso: string): string {
  return isValid(toDate(iso)) ? format(toDate(iso), 'HH:mm') : '—';
}

export function formatDateShort(iso: string): string {
  return format(toDate(iso), 'MM/dd');
}

export function formatDateLong(d: Date): string {
  return format(d, 'yyyy-MM-dd EEE');
}

export function minutesBetween(startISO: string, endISO: string): number {
  return Math.round(
    (toDate(endISO).getTime() - toDate(startISO).getTime()) / 60000,
  );
}

export function durationLabel(minutes: number): string {
  if (minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function weekStart(d: Date, weekStartsOn: 0 | 1 = 1): Date {
  return startOfWeek(d, { weekStartsOn });
}

export function weekEnd(d: Date, weekStartsOn: 0 | 1 = 1): Date {
  return endOfWeek(d, { weekStartsOn });
}

export interface WeekInfo {
  id: string; // ISO week id like "2026-W36"
  year: number;
  weekNumber: number;
  startDate: string;
  endDate: string;
}

export function getWeekInfo(d: Date, weekStartsOn: 0 | 1 = 1): WeekInfo {
  const start = weekStart(d, weekStartsOn);
  const end = weekEnd(d, weekStartsOn);
  // ISO week numbering (weeks start Monday regardless of display preference)
  const iso = startOfWeek(d, { weekStartsOn: 1 });
  const jan4 = new Date(iso.getFullYear(), 0, 4);
  const week1 = startOfWeek(jan4, { weekStartsOn: 1 });
  const weekNumber =
    Math.floor((iso.getTime() - week1.getTime()) / (7 * 86400000)) + 1;
  return {
    id: `${iso.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`,
    year: iso.getFullYear(),
    weekNumber,
    startDate: toISODate(start),
    endDate: toISODate(end),
  };
}

export function daysOfWeek(d: Date, weekStartsOn: 0 | 1 = 1): Date[] {
  return eachDayOfInterval({
    start: weekStart(d, weekStartsOn),
    end: weekEnd(d, weekStartsOn),
  });
}

/** Teaching week number (1-based) relative to semester start. */
export function teachingWeek(semesterStartISO: string, d: Date): number {
  const start = parse(semesterStartISO, ISO_DATE, new Date());
  return Math.floor(differenceInCalendarDays(d, start) / 7) + 1;
}

export function slotOccursOn(
  slot: ScheduleSlot,
  date: Date,
  semesterStartISO: string,
): boolean {
  const isoWeekday = ((date.getDay() + 6) % 7) + 1; // 1=Mon..7=Sun
  if (slot.weekday !== isoWeekday) return false;
  const tw = teachingWeek(semesterStartISO, date);
  if (slot.recurrence === 'WEEKLY') return true;
  if (slot.recurrence === 'ODD_WEEK') return tw % 2 === 1;
  return tw % 2 === 0;
}

export function expandSlot(
  slot: ScheduleSlot,
  date: Date,
): { start: string; end: string } {
  const dateISO = toISODate(date);
  const [sh, sm] = slot.startTime.split(':').map(Number);
  const endMin =
    Number(slot.endTime.split(':')[0]) * 60 +
    Number(slot.endTime.split(':')[1]);
  const startMin = sh * 60 + sm;
  return {
    start: toISODateTime(addMinutes(parse(`${dateISO}T00:00:00`, ISO_DATETIME, new Date()), startMin)),
    end: toISODateTime(addMinutes(parse(`${dateISO}T00:00:00`, ISO_DATETIME, new Date()), endMin)),
  };
}

export function isSameDay(a: Date, b: Date): boolean {
  return toISODate(a) === toISODate(b);
}

export function addDaysISO(iso: string, days: number): string {
  return toISODate(addDays(toDate(`${iso}T00:00:00`), days));
}

export function nowISODateTime(): string {
  return toISODateTime(new Date());
}

export function parseDateInput(iso: string): Date | null {
  const d = parse(iso, ISO_DATE, new Date());
  return isValid(d) ? d : null;
}
