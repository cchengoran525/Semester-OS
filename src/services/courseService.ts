import type { Course, CourseDebt, Health } from '../domain/types';

/**
 * Course health is user-owned. These functions only compute a *suggestion*
 * from debt numbers; they never write back to the database.
 */

export function suggestHealth(debt: CourseDebt): Health {
  const total = totalDebt(debt);
  if (debt.exam >= 2 || debt.understanding >= 3 || total >= 5) return 'RED';
  if (total >= 1) return 'YELLOW';
  return 'GREEN';
}

export function totalDebt(debt: CourseDebt): number {
  return debt.understanding + debt.assignment + debt.review + debt.exam;
}

export function debtSummary(debt: CourseDebt): string {
  const parts: string[] = [];
  if (debt.understanding) parts.push(`理解债务 ${debt.understanding}`);
  if (debt.assignment) parts.push(`作业债务 ${debt.assignment}`);
  if (debt.review) parts.push(`复习债务 ${debt.review}`);
  if (debt.exam) parts.push(`考试债务 ${debt.exam}`);
  return parts.length ? parts.join(' · ') : '无积压';
}

export interface CourseWarning {
  courseId: string;
  courseName: string;
  health: Health;
  message: string;
}

export function courseWarnings(courses: Course[]): CourseWarning[] {
  return courses
    .filter((c) => c.health !== 'GREEN')
    .map((c) => ({
      courseId: c.id,
      courseName: c.name,
      health: c.health,
      message:
        c.health === 'RED'
          ? `${c.name}：理解/复习债务严重，建议尽快安排补课 Block`
          : `${c.name}：${debtSummary(c.debt)}`,
    }));
}

/** Warn (gently) when a confirmed health is worse than what debt implies. */
export function healthDrift(courses: Course[]): CourseWarning[] {
  const out: CourseWarning[] = [];
  for (const c of courses) {
    const suggested = suggestHealth(c.debt);
    const order: Health[] = ['GREEN', 'YELLOW', 'RED'];
    if (order.indexOf(c.health) < order.indexOf(suggested)) {
      out.push({
        courseId: c.id,
        courseName: c.name,
        health: c.health,
        message: `${c.name}：债务正在增加（建议 ${suggested}）`,
      });
    }
  }
  return out;
}
