import { REVIEW_QUESTIONS, type ReviewQuestionKey } from '../../domain/types';

/**
 * Prompt 调教：把 Semester OS 的产品哲学固化进 system prompt，
 * 三个能力各自叠加任务约束与输出格式。所有输出强制简体中文。
 */

export const BASE_SYSTEM = `你是 Semester OS 的内置顾问。Semester OS 是一个本地优先的「学期操作系统」，帮助同时承担课程、项目、科研的大学生分配有限的注意力。核心理念：
- Calendar ≠ Task ≠ Block：日历回答"什么时候有时间"，任务是可执行的工作单元，时间块回答"这段注意力用来干什么"。
- 注意力是稀缺资源：一切建议都要帮用户把注意力放在最重要的事上，识别占用过多注意力的事情。
- 系统只建议、用户决定：你永远不替用户做决定，只输出带理由的建议。
- 未完成 ≠ 失败：不评判、不制造焦虑；指出风险时必须给出可执行的下一步。

始终使用简体中文，简洁、具体、可执行，不空谈。`;

// ── 任务拆解 ─────────────────────────────────────────────────────────

export const BREAKDOWN_SYSTEM = `${BASE_SYSTEM}

当前任务：把一个项目拆解为可直接执行的任务列表。

要求：
- 每个任务都是 15 分钟到 3 小时内能完成的具体工作单元；不用"研究 / 了解 / 考虑"这类无法验收的动词。
- 不与已有任务重复；优先覆盖当前里程碑及之后的剩余工作。
- 顺序即建议的执行顺序。

只输出 JSON 数组，不要输出任何其他文字，元素格式：
{"title": "任务标题（不超过 30 字）", "estimateMinutes": 60, "priority": "MEDIUM", "notes": "一句话说明怎么做"}
estimateMinutes 只能取 15/30/45/60/90/120/180；priority 只能取 LOW/MEDIUM/HIGH；最多 8 条。`;

export interface BreakdownInput {
  projectName: string;
  description?: string;
  milestones: string[];
  existingTaskTitles: string[];
}

export function breakdownUser(input: BreakdownInput): string {
  const parts: string[] = [`项目名称：${input.projectName}`];
  if (input.description) parts.push(`项目描述：${input.description}`);
  if (input.milestones.length > 0) {
    parts.push(
      `里程碑（按顺序）：\n${input.milestones.map((m, i) => `${i + 1}. ${m}`).join('\n')}`,
    );
  }
  if (input.existingTaskTitles.length > 0) {
    parts.push(
      `已有任务（不要重复）：\n${input.existingTaskTitles.map((t) => `- ${t}`).join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

// ── 周复盘起草 ────────────────────────────────────────────────────────

export const REVIEW_SYSTEM = `${BASE_SYSTEM}

当前任务：根据本周真实数据，为每周复盘问卷起草答案。

要求：
- 用第一人称"我"起草，像用户自己在写复盘，而不是 AI 在汇报。
- 每条 1–3 句，必须引用数据中的具体事实（完成的任务、时间分配、风险课程、预估偏差），绝不编造数据里没有的内容。
- 语气平实；"下周最重要的 3 件事"要具体到可以直接执行。

只输出 JSON 对象，不要输出任何其他文字，键必须是且仅是：
${REVIEW_QUESTIONS.map((q) => `"${q.key}"（${q.text}）`).join('、')}
值为字符串。`;

export interface ReviewDraftInput {
  weekLabel: string;
  completedTasks: { title: string; context?: string; estimateMinutes: number; actualMinutes?: number }[];
  deepWorkMinutes: number;
  deepWorkByContext: Record<string, number>;
  allocation: { label: string; percent: number }[];
  courses: { name: string; health: string; debt: string }[];
  activeProjects: { name: string; progress: string }[];
  warnings: string[];
}

export function reviewUser(input: ReviewDraftInput): string {
  const parts: string[] = [`${input.weekLabel}的真实数据如下。`];
  parts.push(
    `本周完成的任务：${
      input.completedTasks.length > 0
        ? input.completedTasks
            .map(
              (t) =>
                `${t.title}（${t.context ?? '未关联'}${
                  t.actualMinutes != null ? `，预估 ${t.estimateMinutes} 分钟 / 实际 ${t.actualMinutes} 分钟` : ''
                }）`,
            )
            .join('；')
        : '无'
    }`,
  );
  parts.push(`深度工作总时长：${input.deepWorkMinutes} 分钟。`);
  const ctx = Object.entries(input.deepWorkByContext);
  if (ctx.length > 0) {
    parts.push(`深度工作分布：${ctx.map(([k, v]) => `${k} ${v} 分钟`).join('，')}。`);
  }
  if (input.allocation.length > 0) {
    parts.push(
      `注意力分配：${input.allocation.map((a) => `${a.label} ${a.percent}%`).join('，')}。`,
    );
  }
  parts.push(
    `课程状态：${input.courses.map((c) => `${c.name}[${c.health}]${c.debt ? `（${c.debt}）` : ''}`).join('；') || '无'}`,
  );
  if (input.activeProjects.length > 0) {
    parts.push(
      `进行中项目：${input.activeProjects.map((p) => `${p.name}（${p.progress}）`).join('；')}`,
    );
  }
  if (input.warnings.length > 0) {
    parts.push(`系统风险提示：${input.warnings.join('；')}`);
  }
  return parts.join('\n');
}

// ── 计划 vs 实际对照 ──────────────────────────────────────────────────

export const GAP_SYSTEM = `${BASE_SYSTEM}

当前任务：对照"你计划做的事"和"你实际投入的时间"，只指出最值得注意的偏离。

要求：
- 只输出 1–2 条偏离，宁缺毋滥。如果计划与实际基本一致，就返回空数组，不要硬找问题。
- 每条必须引用数据中的具体事实（目标原文、投入分钟数、债务数字），绝不编造。
- 判断偏离的标准：写了要做但投入为 0 或很少；没写却投入很多；债务最高的课程没拿到任何时间；注意力几乎全押在单一项目上。
- fact 用一句平实的话说清"计划 vs 实际"的落差，不评判、不制造焦虑。
- action 只给一个下周能直接执行的动作（排几个块 / 砍掉什么），不喊口号。

只输出 JSON 对象，不要输出任何其他文字：
{"deviations": [{"fact": "计划要完成 X，实际没有为它安排任何时间块", "action": "下周给 X 排两个块"}]}`;

export interface GapInput {
  weekLabel: string;
  outcomes: {
    title: string;
    status: string;
    linkedTasks: number;
    scheduledMinutes: number;
    completedLinked: number;
  }[];
  completedTasks: { title: string; context?: string }[];
  deepWorkMinutes: number;
  deepWorkByContext: { label: string; minutes: number }[];
  allocation: { label: string; percent: number }[];
  courses: { name: string; health: string; debt: string }[];
  warnings: string[];
}

export function gapUser(input: GapInput): string {
  const parts: string[] = [`${input.weekLabel}的计划与实际数据如下。`];
  parts.push(
    `本周设定的目标（Outcomes）：${
      input.outcomes.length > 0
        ? input.outcomes
            .map(
              (o) =>
                `${o.title}[${o.status}] — 关联任务 ${o.linkedTasks} 个，已排时间 ${o.scheduledMinutes} 分钟，已完成关联任务 ${o.completedLinked} 个`,
            )
            .join('；')
        : '未设定'
    }`,
  );
  parts.push(
    `本周完成的任务：${
      input.completedTasks.length > 0
        ? input.completedTasks.map((t) => `${t.title}（${t.context ?? '未关联'}）`).join('；')
        : '无'
    }`,
  );
  parts.push(`深度工作总时长：${input.deepWorkMinutes} 分钟。`);
  if (input.deepWorkByContext.length > 0) {
    parts.push(
      `深度工作投入分布：${input.deepWorkByContext.map((d) => `${d.label} ${d.minutes} 分钟`).join('，')}。`,
    );
  }
  if (input.allocation.length > 0) {
    parts.push(`注意力分配：${input.allocation.map((a) => `${a.label} ${a.percent}%`).join('，')}。`);
  }
  parts.push(
    `课程状态：${input.courses.map((c) => `${c.name}[${c.health}]（${c.debt}）`).join('；') || '无'}`,
  );
  if (input.warnings.length > 0) {
    parts.push(`系统风险提示：${input.warnings.join('；')}`);
  }
  return parts.join('\n');
}

// ── 一键周计划 ────────────────────────────────────────────────────────

export const WEEK_PLAN_SYSTEM = `${BASE_SYSTEM}

当前任务：为未来 7 天做一份有取舍的排期草稿 —— 先定焦点，再排时间块。

要求：
- focus：一句话说清未来 7 天最重要的事，以及为了让位而暂缓/降级的事（引用给出的目标或债务）。这是整个输出的重点。
- 只能使用给出的任务编号（T1、T2…），不能发明新任务。
- 时间块必须完全落在给出的空闲窗口内，且不得与同一天的其他块重叠；单块建议 30–180 分钟；最多 10 条。
- 类型映射：写代码/建模/实验/调试→ENGINEERING；复习/写作业/写作/读文献→DEEP_WORK；缴费/跑腿/邮件/行政→ADMIN；英语学习→ENGLISH；休息恢复→RECOVERY。
- 排期优先级：未完成的本周目标 > 截止日近的 > 课程债务 > 进行中项目里程碑 > 其他；同一任务可拆多块，但不要把一天塞满，给突发留白。
- reason 必须回答"为什么是它、而不是别的"：说清它推进了哪个目标/债务，以及因此暂缓了什么。

只输出 JSON 对象，不要输出任何其他文字：
{"focus": "未来 7 天先推进 X，Y 暂缓（不超过 60 字）", "placements": [{"taskId": "T3", "date": "2026-09-08", "start": "14:00", "end": "15:30", "type": "ENGINEERING", "reason": "推进课程大作业里程碑；本周不给个人网站排更多块"}]}
date 必须取自窗口列表里出现的日期；start/end 为 24 小时制 HH:mm。`;

export interface WeekPlanInput {
  weekLabel: string;
  focusSource: {
    outcomes: { title: string; status: string }[];
    projectMilestones: { project: string; milestone: string }[];
  };
  tasks: {
    key: string;
    title: string;
    estimateMinutes: number;
    priority: string;
    dueInDays: number | null;
    context?: string;
  }[];
  windows: { date: string; start: string; end: string; minutes: number }[];
  projects: string[];
  courseHints: string[];
  warnings: string[];
}

export function weekPlanUser(input: WeekPlanInput): string {
  const parts: string[] = [`${input.weekLabel}的排期数据如下。`];
  parts.push(
    `本周目标（Outcomes）：${
      input.focusSource.outcomes.length > 0
        ? input.focusSource.outcomes.map((o) => `${o.title}[${o.status}]`).join('；')
        : '未设定'
    }`,
  );
  if (input.focusSource.projectMilestones.length > 0) {
    parts.push(
      `进行中项目的当前里程碑：${input.focusSource.projectMilestones
        .map((m) => `${m.project} → ${m.milestone}`)
        .join('；')}`,
    );
  }
  parts.push(
    `待排任务（编号即引用 ID）：\n${input.tasks
      .map(
        (t) =>
          `${t.key}. ${t.title}（预估 ${t.estimateMinutes} 分钟，优先级 ${t.priority}${
            t.dueInDays != null ? `，${t.dueInDays <= 0 ? '今天' : `${t.dueInDays} 天后`}截止` : ''
          }${t.context ? `，归属 ${t.context}` : ''}）`,
      )
      .join('\n') || '无'}`,
  );
  parts.push(
    `空闲窗口（date + HH:mm）：\n${input.windows
      .map((w) => `${w.date} ${w.start}–${w.end}（${w.minutes} 分钟）`)
      .join('\n') || '无'}`,
  );
  if (input.projects.length > 0) {
    parts.push(`进行中项目：${input.projects.join('；')}`);
  }
  if (input.courseHints.length > 0) {
    parts.push(`课程状态：${input.courseHints.join('；')}`);
  }
  if (input.warnings.length > 0) {
    parts.push(`系统风险提示：${input.warnings.join('；')}`);
  }
  return parts.join('\n\n');
}

export type { ReviewQuestionKey };
