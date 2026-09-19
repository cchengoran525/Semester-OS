import type {
  Block,
  Course,
  Milestone,
  Project,
  ScheduleOverride,
  ScheduleSlot,
  Settings,
  Task,
  WeeklyOutcome,
} from '../domain/types';
import { db } from './db';

/**
 * First-launch seed. Only runs when settings.initialized is false —
 * never re-seeds over user data.
 */

const slot = (
  weekday: number,
  startTime: string,
  endTime: string,
  recurrence: ScheduleSlot['recurrence'] = 'WEEKLY',
  location?: string,
): ScheduleSlot => ({ weekday, startTime, endTime, recurrence, location });

const noDebt = { understanding: 0, assignment: 0, review: 0, exam: 0 };

/** 示例项目名（首次启动 seed 与"清理演示数据"共用的单一来源）。 */
export const SEED_PROJECT_NAMES = [
  '课程大作业',
  '个人网站',
  '读书计划',
  '健身计划',
  '竞赛准备',
  '兴趣项目',
];

/**
 * 示例课表（首次启动演示数据，可在课程页随意修改）。课节时间：
 * 1-2: 08:00–09:50 · 3-4: 10:20–12:10 · 5-6: 14:00–15:50 · 7-8: 16:20–18:10 · 9-10: 19:00–20:50
 * 「双周」= 教学偶数周（2,4,…,16）。
 */
export function seedCourses(): Omit<Course, 'id'>[] {
  return [
    {
      name: '高等数学',
      teacher: '张老师',
      schedule: [slot(1, '14:00', '15:50', 'WEEKLY', '教一101')],
      health: 'GREEN',
      debt: { ...noDebt },
    },
    {
      name: '线性代数',
      teacher: '王老师',
      schedule: [
        slot(1, '16:20', '18:10', 'WEEKLY', '教二208'),
        slot(3, '19:00', '20:50', 'WEEKLY', '教二208'),
      ],
      health: 'GREEN',
      debt: { ...noDebt },
    },
    {
      name: '大学英语',
      teacher: '李老师',
      schedule: [slot(2, '10:20', '12:10', 'WEEKLY', '教一302')],
      health: 'GREEN',
      debt: { ...noDebt },
    },
    {
      name: '大学物理',
      teacher: '赵老师',
      schedule: [
        slot(2, '14:00', '15:50', 'WEEKLY', '教二208'),
        slot(5, '08:00', '09:50', 'EVEN_WEEK', '教二208'),
      ],
      health: 'GREEN',
      debt: { ...noDebt },
    },
    {
      name: '数据结构',
      teacher: '陈老师',
      schedule: [slot(2, '16:20', '18:10', 'WEEKLY', '教一306')],
      health: 'GREEN',
      debt: { ...noDebt },
    },
    {
      name: '操作系统',
      teacher: '刘老师',
      schedule: [
        slot(3, '08:00', '09:50', 'EVEN_WEEK', '教一107'),
        slot(5, '10:20', '12:10', 'WEEKLY', '教一107'),
      ],
      health: 'GREEN',
      debt: { ...noDebt },
    },
    {
      name: '程序设计实践',
      teacher: '孙老师',
      schedule: [
        slot(3, '14:00', '15:50', 'WEEKLY', '教二108'),
        slot(5, '19:00', '20:50', 'WEEKLY', '实验楼机房'),
      ],
      health: 'GREEN',
      debt: { ...noDebt },
    },
    {
      name: '大学物理实验',
      teacher: '赵老师/周老师',
      schedule: [slot(5, '14:00', '15:50', 'WEEKLY', '实验楼402')],
      health: 'GREEN',
      debt: { ...noDebt },
    },
  ];
}

export interface SeedBundle {
  courses: Course[];
  projects: Project[];
  milestones: Milestone[];
  tasks: Task[];
  blocks: Block[];
  weeklyOutcomes: WeeklyOutcome[];
  settings: Settings;
}

export async function seedIfFirstLaunch(): Promise<boolean> {
  const settings = await db.settings.get('app');
  if (settings?.initialized) return false;

  const now = new Date();
  // Semester: current September -> December
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based; September = 8
  const semesterYear = month >= 8 ? year : year - 1;
  const semesterStart = `${semesterYear}-09-07`; // first Monday of September
  const semesterEnd = `${semesterYear}-12-27`;

  // 教学日历例外：调休上课 + 假期
  const off = (date: string, label: string): ScheduleOverride => ({ date, off: true, label });
  const scheduleOverrides: ScheduleOverride[] = [
    { date: '2026-09-20', weekday: 5, recurrence: 'ODD_WEEK', label: '调休：上周五（单周）的课' },
    { date: '2026-10-10', weekday: 3, recurrence: 'ODD_WEEK', label: '调休：上周三（单周）的课' },
    off('2026-09-25', '放假'),
    off('2026-09-26', '放假'),
    off('2026-09-27', '放假'),
    ...Array.from({ length: 7 }, (_, i) => off(`2026-10-0${i + 1}`, '国庆假期')),
  ];

  const newSettings: Settings = {
    id: 'app',
    semesterStart,
    semesterEnd,
    timezone: 'Asia/Shanghai',
    weekStartDay: 1,
    wipLimit: 2,
    defaultTaskEstimate: 60,
    theme: 'DARK',
    initialized: true,
    scheduleOverrides,
  };
  // 服务器部署构建可预置同步地址（VITE_DEFAULT_SYNC_URL），本地开发不受影响。
  // 新设备首次推送受"服务器更新"护栏保护，不会拿种子数据覆盖服务器。
  const defaultSyncUrl = (import.meta.env.VITE_DEFAULT_SYNC_URL as string | undefined)?.trim();
  if (defaultSyncUrl) {
    newSettings.sync = { url: defaultSyncUrl, autoSync: true };
  }

  const courses: Course[] = seedCourses().map((c, i) => ({
    ...c,
    id: `c${i + 1}`,
  }));

  // 只保留项目名字：不带描述、里程碑、示例任务（这些都由你自己建）
  const projectNames = SEED_PROJECT_NAMES;
  const projects: Project[] = projectNames.map((name, i) => ({
    id: `p${i + 1}`,
    name,
    status: 'BACKLOG',
    priority: 'MEDIUM',
  }));

  await db.transaction(
    'rw',
    [
      db.courses,
      db.projects,
      db.milestones,
      db.tasks,
      db.blocks,
      db.weeklyOutcomes,
      db.settings,
    ],
    async () => {
      await db.courses.bulkPut(courses);
      await db.projects.bulkPut(projects);
      await db.settings.put(newSettings);
      // blocks left empty on first launch — user plans their own
    },
  );
  return true;
}
