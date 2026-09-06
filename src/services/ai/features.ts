import { REVIEW_QUESTIONS, type BlockType, type Priority, type ReviewQuestionKey } from '../../domain/types';
import { AIError, chat, extractJSON } from './client';
import type { AIConfig } from './config';
import {
  BREAKDOWN_SYSTEM,
  BRIEF_SYSTEM,
  REVIEW_SYSTEM,
  WEEK_PLAN_SYSTEM,
  breakdownUser,
  briefUser,
  reviewUser,
  weekPlanUser,
  type BriefInput,
  type BreakdownInput,
  type ReviewDraftInput,
  type WeekPlanInput,
} from './prompts';

/**
 * 三个 AI 能力。共同约定（与"系统只建议、用户决定"一致）：
 * 输出一律先经过白名单校验/夹取才交给 UI，UI 再由用户确认后落库。
 */

const ESTIMATES = [15, 30, 45, 60, 90, 120, 180];
const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH'];
const MAX_SUGGESTED = 8;

// ── 任务拆解 ─────────────────────────────────────────────────────────

export interface SuggestedTask {
  title: string;
  estimateMinutes: number;
  priority: Priority;
  notes?: string;
}

export async function suggestTaskBreakdown(
  config: AIConfig,
  input: BreakdownInput,
): Promise<SuggestedTask[]> {
  const raw = await chat(config, {
    system: BREAKDOWN_SYSTEM,
    user: breakdownUser(input),
    json: true,
    temperature: 0.4,
  });
  const parsed = extractJSON<unknown>(raw);
  if (!Array.isArray(parsed)) {
    throw new AIError('AI 返回格式异常：期望 JSON 数组', 0);
  }
  const valid = parsed
    .slice(0, 12)
    .map(validateSuggestedTask)
    .filter((t): t is SuggestedTask => t !== null)
    .slice(0, MAX_SUGGESTED);
  if (valid.length === 0) {
    throw new AIError('AI 没有给出可用的任务建议', 0);
  }
  return valid;
}

function validateSuggestedTask(item: unknown): SuggestedTask | null {
  if (typeof item !== 'object' || item === null) return null;
  const o = item as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim().slice(0, 60) : '';
  if (!title) return null;
  return {
    title,
    estimateMinutes: snapEstimate(o.estimateMinutes),
    priority: PRIORITIES.includes(o.priority as Priority) ? (o.priority as Priority) : 'MEDIUM',
    notes: typeof o.notes === 'string' && o.notes.trim() ? o.notes.trim().slice(0, 200) : undefined,
  };
}

function snapEstimate(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 60;
  return ESTIMATES.reduce((best, e) =>
    Math.abs(e - n) < Math.abs(best - n) ? e : best,
  );
}

// ── 周复盘起草 ────────────────────────────────────────────────────────

const QUESTION_KEYS = new Set(REVIEW_QUESTIONS.map((q) => q.key));

export async function draftWeeklyReview(
  config: AIConfig,
  input: ReviewDraftInput,
): Promise<Partial<Record<ReviewQuestionKey, string>>> {
  const raw = await chat(config, {
    system: REVIEW_SYSTEM,
    user: reviewUser(input),
    json: true,
    temperature: 0.5,
  });
  const parsed = extractJSON<Record<string, unknown>>(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new AIError('AI 返回格式异常：期望 JSON 对象', 0);
  }
  const draft: Partial<Record<ReviewQuestionKey, string>> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!QUESTION_KEYS.has(key as ReviewQuestionKey)) continue;
    if (typeof value !== 'string' || !value.trim()) continue;
    draft[key as ReviewQuestionKey] = value.trim().slice(0, 500);
  }
  if (Object.keys(draft).length === 0) {
    throw new AIError('AI 没有给出可用的复盘草稿', 0);
  }
  return draft;
}

// ── 下周简报 ──────────────────────────────────────────────────────────

export async function weeklyBrief(config: AIConfig, input: BriefInput): Promise<string> {
  const text = await chat(config, {
    system: BRIEF_SYSTEM,
    user: briefUser(input),
    temperature: 0.5,
  });
  const brief = text.trim();
  if (!brief) throw new AIError('AI 返回了空简报', 0);
  return brief.slice(0, 800);
}

// ── 一键周计划 ────────────────────────────────────────────────────────

/** 周计划允许的块类型：COURSE 块只能来自课程表，不归 AI 排。 */
const PLAN_TYPES: BlockType[] = ['DEEP_WORK', 'ENGINEERING', 'ADMIN', 'ENGLISH', 'RECOVERY'];
const MIN_PLAN_MINUTES = 15;
const MAX_PLAN_MINUTES = 240;

export interface PlanWindow {
  date: string; // yyyy-MM-dd
  start: string; // HH:mm
  end: string; // HH:mm
}

export interface PlannedBlock {
  taskId: string; // 调用方提供的任务 key（T1、T2…），映射回真实任务由 UI 完成
  date: string;
  start: string;
  end: string;
  type: BlockType;
  reason: string;
}

interface RawPlanItem {
  taskId: string;
  date: string;
  start: string;
  end: string;
  type: BlockType;
  reason: string;
}

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const pad = (n: number): string => String(n).padStart(2, '0');
const minToHHMM = (m: number): string => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const HHMM_RE = /^\d{1,2}:\d{2}$/;

export async function suggestWeeklyPlan(
  config: AIConfig,
  input: WeekPlanInput,
): Promise<PlannedBlock[]> {
  const raw = await chat(config, {
    system: WEEK_PLAN_SYSTEM,
    user: weekPlanUser(input),
    json: true,
    temperature: 0.3,
    // 周计划是跨 7 天的全局取舍，是唯一走"深度档"的能力：高思考档
    reasoningEffort: 'high',
  });
  const parsed = extractJSON<unknown>(raw);
  if (!Array.isArray(parsed)) {
    throw new AIError('AI 返回格式异常：期望 JSON 数组', 0);
  }
  const knownTasks = new Set(input.tasks.map((t) => t.key));
  const windowDates = new Set(input.windows.map((w) => w.date));

  // 1) 逐条校验 + 裁剪到最近的包含窗口
  const clipped: RawPlanItem[] = [];
  for (const item of parsed.slice(0, 16)) {
    const p = item as Record<string, unknown>;
    const taskId = typeof p.taskId === 'string' ? p.taskId.trim() : '';
    const date = typeof p.date === 'string' ? p.date.trim() : '';
    const start = typeof p.start === 'string' ? p.start.trim() : '';
    const end = typeof p.end === 'string' ? p.end.trim() : '';
    if (!knownTasks.has(taskId) || !windowDates.has(date)) continue;
    if (!HHMM_RE.test(start) || !HHMM_RE.test(end)) continue;
    if (toMin(end) - toMin(start) < MIN_PLAN_MINUTES) continue;
    const type = PLAN_TYPES.includes(p.type as BlockType) ? (p.type as BlockType) : 'DEEP_WORK';
    const reason = typeof p.reason === 'string' ? p.reason.trim().slice(0, 120) : '';

    let best: { start: number; end: number } | null = null;
    for (const w of input.windows.filter((x) => x.date === date)) {
      if (!HHMM_RE.test(w.start) || !HHMM_RE.test(w.end)) continue;
      const s = Math.max(toMin(start), toMin(w.start));
      const e = Math.min(toMin(end), toMin(w.end));
      if (e - s >= MIN_PLAN_MINUTES && (!best || e - s > best.end - best.start)) {
        best = { start: s, end: e };
      }
    }
    if (!best) continue;
    // 超长块按窗口硬截断（240 分钟上限）
    const endMin = Math.min(best.end, best.start + MAX_PLAN_MINUTES);
    clipped.push({
      taskId,
      date,
      start: minToHHMM(best.start),
      end: minToHHMM(endMin),
      type,
      reason,
    });
  }

  // 2) 同日去重叠：保留先出现的（数组顺序即 AI 的优先级顺序）
  const kept: RawPlanItem[] = [];
  for (const item of clipped.sort((a, b) =>
    a.date === b.date ? toMin(a.start) - toMin(b.start) : a.date.localeCompare(b.date),
  )) {
    const overlaps = kept.some(
      (k) =>
        k.date === item.date &&
        toMin(item.start) < toMin(k.end) &&
        toMin(k.start) < toMin(item.end),
    );
    if (!overlaps) kept.push(item);
  }

  if (kept.length === 0) {
    throw new AIError('AI 没有给出可行的排期方案（所有条目都落在空闲窗口之外）', 0);
  }
  return kept.slice(0, 10);
}
