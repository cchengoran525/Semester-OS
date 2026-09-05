import type {
  Block,
  Course,
  Milestone,
  Project,
  ScheduleSlot,
  Settings,
  Task,
  WeeklyOutcome,
} from '../domain/types';
import { db } from './db';
import { getWeekInfo, todayDate } from '../services/timeService';

/**
 * First-launch seed. Only runs when settings.initialized is false —
 * never re-seeds over user data.
 */

const slot = (
  weekday: number,
  startTime: string,
  endTime: string,
  recurrence: ScheduleSlot['recurrence'] = 'WEEKLY',
): ScheduleSlot => ({ weekday, startTime, endTime, recurrence });

const noDebt = { understanding: 0, assignment: 0, review: 0, exam: 0 };

export function seedCourses(): Omit<Course, 'id'>[] {
  return [
    {
      name: '电路基础',
      schedule: [slot(1, '17:00', '18:00')],
      health: 'GREEN',
      debt: { ...noDebt },
      teacher: '',
    },
    {
      name: '电子技术基础',
      schedule: [slot(2, '17:00', '18:00'), slot(5, '09:00', '10:00', 'EVEN_WEEK')],
      health: 'GREEN',
      debt: { ...noDebt },
    },
    {
      name: '控制工程数学基础',
      schedule: [slot(1, '19:00', '20:00'), slot(3, '21:00', '22:00')],
      health: 'YELLOW',
      debt: { understanding: 2, assignment: 0, review: 1, exam: 0 },
    },
    {
      name: '信号与线性系统分析',
      schedule: [slot(3, '09:00', '10:00', 'ODD_WEEK'), slot(5, '15:00', '16:00')],
      health: 'YELLOW',
      debt: { understanding: 1, assignment: 0, review: 1, exam: 0 },
    },
    {
      name: 'C/C++程序设计基础',
      schedule: [slot(3, '17:00', '18:00'), slot(5, '21:00', '22:00')],
      health: 'GREEN',
      debt: { ...noDebt },
    },
    {
      name: '习近平新时代中国特色社会主义思想概论',
      schedule: [slot(1, '15:00', '16:00')],
      health: 'GREEN',
      debt: { ...noDebt },
    },
    {
      name: 'EAP',
      schedule: [slot(2, '15:00', '16:00')],
      health: 'GREEN',
      debt: { ...noDebt },
    },
    {
      name: '中国近现代史纲要',
      schedule: [slot(2, '19:00', '20:00')],
      health: 'GREEN',
      debt: { ...noDebt },
    },
    {
      name: '体育 III',
      schedule: [slot(2, '21:00', '22:00')],
      health: 'GREEN',
      debt: { ...noDebt },
    },
    {
      name: '电子技术实验',
      schedule: [slot(5, '17:00', '18:00')],
      health: 'GREEN',
      debt: { ...noDebt },
    },
  ];
}

const AS_MILESTONES = [
  'M0 Concept',
  'M1 Single Wing Mechanism',
  'M2 Middle Wing',
  'M3 Six Wing',
  'M4 Sensing / Interaction',
  'M5 Demo',
];

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
  };

  const courses: Course[] = seedCourses().map((c, i) => ({
    ...c,
    id: `c${i + 1}`,
  }));

  const projectDefs: { p: Omit<Project, 'id' | 'currentMilestoneId'>; ms: string[] }[] = [
    {
      p: {
        name: 'AS / Aeroshield',
        description:
          '背负式六翼分布仿生机能系统。核心问题：拥有翅膀的幻想生物在城市日常环境中，不飞的时候翅膀能有什么实际功能？方向：遮阳 / 挡雨 / 交互 / 挂载 / 收纳 / 机械辅助。',
        status: 'ACTIVE',
        priority: 'HIGH',
      },
      ms: AS_MILESTONES,
    },
    {
      p: {
        name: 'Shadowcarrier',
        description:
          '低成本分布式机器人。ESP32 + RK + 摄像头 + YOLO 人体检测 + 跟随 + 分布式控制。核心 MVP：稳定跟随人。',
        status: 'ACTIVE',
        priority: 'HIGH',
      },
      ms: ['M0 原型', 'M1 感知', 'M2 跟随 MVP', 'M3 稳定性', 'M4 分布式'],
    },
    {
      p: {
        name: 'Happymac',
        description:
          '双雷达 TinyML / 感知项目。ESP32-S3 + ESP32-C3 + 双雷达 + 边缘计算。',
        status: 'BACKLOG',
        priority: 'MEDIUM',
      },
      ms: ['M0 雷达数据采集', 'M1 特征提取', 'M2 TinyML 部署', 'M3 应用'],
    },
    {
      p: {
        name: 'VTB',
        description:
          '聊天型 VTuber / 虚拟角色项目。Mediapipe + 多姿态 + 角色状态 + 聊天交互，避免传统 Live2D 皮套感。',
        status: 'BACKLOG',
        priority: 'LOW',
      },
      ms: ['M0 角色设计', 'M1 姿态驱动', 'M2 聊天交互', 'M3 状态机'],
    },
    {
      p: {
        name: 'RoboMaster',
        description: '长期工程活动。',
        status: 'BACKLOG',
        priority: 'MEDIUM',
      },
      ms: ['赛季任务'],
    },
    {
      p: {
        name: 'Smart Glasses',
        description: '未来探索项目。',
        status: 'BACKLOG',
        priority: 'LOW',
      },
      ms: ['探索'],
    },
  ];

  const projects: Project[] = [];
  const milestones: Milestone[] = [];
  projectDefs.forEach((def, i) => {
    const id = `p${i + 1}`;
    projects.push({ ...def.p, id });
    def.ms.forEach((name, j) => {
      milestones.push({
        id: `${id}m${j}`,
        projectId: id,
        name,
        order: j,
        status:
          def.p.status === 'ACTIVE' && i <= 1
            ? j === 1 && i === 0
              ? 'DONE'
              : j === 2 && i === 0
                ? 'DOING'
                : j === 1 && i === 1
                  ? 'DOING'
                  : j < 2
                    ? 'DONE'
                    : 'TODO'
            : 'TODO',
      });
    });
  });
  projects[0].currentMilestoneId = 'p1m2';
  projects[1].currentMilestoneId = 'p2m2';

  const tasks: Task[] = [
    {
      id: 't1',
      title: '给 AS 中翼舵机安装座建立 v0.3 CAD',
      projectId: 'p1',
      milestoneId: 'p1m2',
      estimateMinutes: 90,
      priority: 'HIGH',
      status: 'READY',
      createdAt: now.toISOString(),
      notes: '注意检查与折叠机构的干涉。',
    },
    {
      id: 't2',
      title: '给 Shadowcarrier 修正跟随延迟',
      projectId: 'p2',
      milestoneId: 'p2m2',
      estimateMinutes: 60,
      priority: 'HIGH',
      status: 'READY',
      createdAt: now.toISOString(),
    },
    {
      id: 't3',
      title: '整理信号系统第一章卷积例题',
      courseId: 'c4',
      estimateMinutes: 45,
      priority: 'MEDIUM',
      status: 'READY',
      createdAt: now.toISOString(),
    },
    {
      id: 't4',
      title: '控制工程数学：补齐第 2 章未理解部分',
      courseId: 'c3',
      estimateMinutes: 90,
      priority: 'MEDIUM',
      status: 'BACKLOG',
      createdAt: now.toISOString(),
    },
    {
      id: 't5',
      title: '电路基础 2.3 节习题 8/11/15',
      courseId: 'c1',
      estimateMinutes: 45,
      priority: 'MEDIUM',
      status: 'READY',
      createdAt: now.toISOString(),
    },
  ];

  const week = getWeekInfo(todayDate());
  const weeklyOutcomes: WeeklyOutcome[] = [
    {
      id: 'wo1',
      weekId: week.id,
      title: '完成 AS 中翼舵机安装座 v0.3',
      linkedTaskIds: ['t1'],
      status: 'OPEN',
    },
    {
      id: 'wo2',
      weekId: week.id,
      title: 'Shadowcarrier 修正跟随延迟',
      linkedTaskIds: ['t2'],
      status: 'OPEN',
    },
    {
      id: 'wo3',
      weekId: week.id,
      title: '完成一次信号系统复习',
      linkedTaskIds: ['t3'],
      status: 'OPEN',
    },
    {
      id: 'wo4',
      weekId: week.id,
      title: '电路基础完成当前章节作业',
      linkedTaskIds: ['t5'],
      status: 'OPEN',
    },
  ];

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
      await db.milestones.bulkPut(milestones);
      await db.tasks.bulkPut(tasks);
      await db.weeklyOutcomes.bulkPut(weeklyOutcomes);
      await db.settings.put(newSettings);
      // blocks left empty on first launch — user plans their own
    },
  );
  return true;
}
