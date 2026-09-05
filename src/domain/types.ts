// ── Core domain model ────────────────────────────────────────────────

export type ID = string;

export type Health = 'GREEN' | 'YELLOW' | 'RED';
export type ProjectStatus = 'BACKLOG' | 'ACTIVE' | 'PAUSED' | 'DONE';
export type TaskStatus = 'BACKLOG' | 'READY' | 'DOING' | 'DONE';
export type BlockType =
  | 'COURSE'
  | 'DEEP_WORK'
  | 'ENGINEERING'
  | 'ADMIN'
  | 'ENGLISH'
  | 'RECOVERY';
export type BlockSource = 'SCHEDULE' | 'USER' | 'SUGGESTED';
export type Recurrence = 'WEEKLY' | 'ODD_WEEK' | 'EVEN_WEEK';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface CourseDebt {
  understanding: number;
  assignment: number;
  review: number;
  exam: number;
}

/** A single recurring class meeting, e.g. Wednesday 09:00-10:00 biweekly. */
export interface ScheduleSlot {
  /** 1 = Monday … 7 = Sunday (ISO weekday) */
  weekday: number;
  startTime: string; // "09:00"
  endTime: string; // "10:00"
  recurrence: Recurrence;
}

export interface Course {
  id: ID;
  name: string;
  teacher?: string;
  credits?: number;
  schedule: ScheduleSlot[];
  /** User-confirmed health. System only *suggests*. */
  health: Health;
  debt: CourseDebt;
  notes?: string;
}

export type MilestoneStatus = 'TODO' | 'DOING' | 'DONE';

export interface Milestone {
  id: ID;
  projectId: ID;
  name: string;
  order: number;
  status: MilestoneStatus;
}

export interface Project {
  id: ID;
  name: string;
  description?: string;
  status: ProjectStatus;
  priority: Priority;
  currentMilestoneId?: ID;
  notes?: string;
}

export interface Task {
  id: ID;
  title: string;
  projectId?: ID;
  courseId?: ID;
  milestoneId?: ID;
  /** Estimated minutes. 0 = not estimated. */
  estimateMinutes: number;
  priority: Priority;
  status: TaskStatus;
  dueDate?: string; // ISO date (yyyy-MM-dd)
  notes?: string;
  createdAt: string;
  completedAt?: string;
  /** Actual minutes, only set when user explicitly records it. */
  actualMinutes?: number;
}

export interface Block {
  id: ID;
  /** ISO datetime strings (local, e.g. 2026-09-03T14:00:00) */
  start: string;
  end: string;
  type: BlockType;
  source: BlockSource;
  /** Context label: project id, course id, or free text like "AS". */
  context?: string;
  taskIds: ID[];
  /** 1–5, optional state variable. */
  energy?: number;
  status: 'PLANNED' | 'ACTIVE' | 'DONE';
  notes?: string;
  plannedMinutes?: number;
  actualMinutes?: number;
}

export interface Week {
  id: ID; // "2026-W36"
  year: number;
  weekNumber: number;
  startDate: string;
  endDate: string;
}

export interface WeeklyOutcome {
  id: ID;
  weekId: ID;
  title: string;
  linkedTaskIds: ID[];
  status: 'OPEN' | 'DONE';
}

export interface WeeklyReview {
  id: ID; // same as weekId
  weekId: ID;
  answers: Partial<Record<ReviewQuestionKey, string>>;
  createdAt: string;
}

export type ReviewQuestionKey =
  | 'advanced'
  | 'courseRisk'
  | 'overAttention'
  | 'unnecessary'
  | 'nextWeekTop3';

export const REVIEW_QUESTIONS: { key: ReviewQuestionKey; text: string }[] = [
  { key: 'advanced', text: '本周真正推进了什么？' },
  { key: 'courseRisk', text: '哪个课程风险上升？' },
  { key: 'overAttention', text: '哪个项目占用了过多注意力？' },
  { key: 'unnecessary', text: '什么事情实际上没有必要做？' },
  { key: 'nextWeekTop3', text: '下周最重要的 3 件事情？' },
];

export interface Settings {
  id: 'app';
  semesterStart: string; // yyyy-MM-dd
  semesterEnd: string;
  timezone: string;
  weekStartDay: 0 | 1; // 0 = Sunday, 1 = Monday
  wipLimit: number;
  defaultTaskEstimate: number;
  theme: 'DARK' | 'LIGHT' | 'SYSTEM';
  initialized: boolean;
}

export interface ExportBundle {
  schemaVersion: 1;
  exportedAt: string;
  data: {
    courses: Course[];
    projects: Project[];
    milestones: Milestone[];
    tasks: Task[];
    blocks: Block[];
    weeklyOutcomes: WeeklyOutcome[];
    reviews: WeeklyReview[];
    settings: Settings | null;
  };
}

export const ESTIMATE_OPTIONS = [15, 30, 45, 60, 90, 120, 180];

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  COURSE: 'COURSE',
  DEEP_WORK: 'DEEP WORK',
  ENGINEERING: 'ENGINEERING',
  ADMIN: 'ADMIN',
  ENGLISH: 'ENGLISH',
  RECOVERY: 'RECOVERY',
};

export const ESTIMATES_ALLOWED = [15, 30, 45, 60, 90, 120, 180] as const;
