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
  /** 上课地点（教室），可选 */
  location?: string;
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
  /** 全局字体缩放（zoom），1 = 标准。可选，向后兼容。 */
  fontScale?: number;
  initialized: boolean;
  /** 自定义路线图备注，key = "2026-09" 月份标签。可选，向后兼容。 */
  roadmapNotes?: Record<string, string>;
  /**
   * AI 助手配置（OpenAI 兼容接口）。可选：未配置时所有 AI 功能自动停用。
   * Key 保存在本地 IndexedDB，不进构建产物、不随 Export 泄露给第三方服务
   * （只有在用户主动触发 AI 功能时才会把汇总数据发给所配置的服务商）。
   */
  ai?: {
    /** 快速模型（简报 / 复盘起草 / 任务拆解等轻任务）。OpenAI 兼容 Base URL */
    baseUrl: string;
    apiKey: string;
    model: string;
    /**
     * 深度模型（周计划等深度规划），可选。逐字段回落到快速模型：
     * 只填模型名 = 同 Key 同地址换个更强的模型。
     */
    deep?: {
      baseUrl?: string;
      apiKey?: string;
      model?: string;
    };
  };
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
  COURSE: '课程',
  DEEP_WORK: '深度工作',
  ENGINEERING: '工程',
  ADMIN: '事务',
  ENGLISH: '英语',
  RECOVERY: '休息',
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  HIGH: '高',
  MEDIUM: '中',
  LOW: '低',
};

export const HEALTH_LABELS: Record<Health, string> = {
  GREEN: '良好',
  YELLOW: '需注意',
  RED: '告急',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  BACKLOG: '待启动',
  ACTIVE: '进行中',
  PAUSED: '已暂停',
  DONE: '已完成',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  BACKLOG: '待定',
  READY: '待办',
  DOING: '进行中',
  DONE: '已完成',
};

export const BLOCK_SOURCE_LABELS: Record<BlockSource, string> = {
  SCHEDULE: '课程表',
  USER: '手动',
  SUGGESTED: '建议',
};

export const ESTIMATES_ALLOWED = [15, 30, 45, 60, 90, 120, 180] as const;
