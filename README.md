# Semester OS — Personal Operating System

一个本地优先（local-first）的「学期操作系统」：帮一个同时承担课程、工程项目、科研和杂务的大学生，
在有限注意力下动态决定"现在应该把什么事情放进哪个时间 Block"。

核心概念：**Calendar ≠ Task ≠ Block**。
- Calendar 回答"什么时候有时间"
- Task 回答"做什么"（可执行的工作单元）
- Block 回答"这段注意力用来干什么"

## Tech Stack

- React 19 + TypeScript (strict) + Vite
- Zustand（UI 状态）、Dexie / IndexedDB（数据持久化）
- React Router、dnd-kit（拖拽）、date-fns、lucide-react
- Vitest + Testing Library（测试，fake-indexeddb）

## Architecture

```
src/
  domain/        纯类型定义（Course / Project / Milestone / Task / Block / Week / WeeklyOutcome / Settings）
  services/      业务逻辑（与 UI 完全分离）
    timeService        统一日期/时间/教学周计算
    scheduleService    课程表 → 虚拟 SCHEDULE Block
    courseService      Course Health 建议、债务汇总、风险提示
    projectService     Milestone 进度、WIP 计算
    statistics         Deep Work / 注意力分配 / Estimate vs Actual
    scheduler          确定性任务排序、空闲窗口、可解释排课建议、冲突检测
    dropActions        拖拽落点处理（Task → Block / Task → 日历日）
    importExport       带 schemaVersion 校验的导出/导入
  storage/       Dexie 数据库 + Repository 层 + 首次启动 Seed
  store/         Zustand UI 状态（快捷添加、Toast）
  hooks/         useAppData（Dexie liveQuery 数据层）
  components/    布局、通用组件、快捷添加
  pages/         Dashboard / Calendar / Tasks / Projects / Courses / Semester / Review / Settings
```

关键设计：
- 所有数据库访问走 Repository 层，UI 不直接碰 Dexie
- 课程表按 WEEKLY / ODD_WEEK / EVEN_WEEK 递归规则展开为只读 Block（source: SCHEDULE）
- Task ↔ Block 为多对多（block.taskIds[]）
- Scheduler 只做确定性推荐（附 reasons），从不自动修改用户数据
- Course Health 由用户手动确认，系统只给建议
- WIP Limit 为软限制（默认 2 个 Active Project），不阻止创建
- 未完成 ≠ 失败：支持 reschedule，可记录 Estimated vs Actual

## Install & Run

```bash
npm install
npm run dev      # http://localhost:5173
```

首次打开会自动录入 seed 数据（真实课程表 + 6 个项目），之后不会再覆盖你的数据。

## Build / Test

```bash
npm run build       # 生产构建（tsc + vite build）
npm run lint        # oxlint
npm run typecheck   # tsc --noEmit
npm run test        # vitest（单元 + 集成 + UI 测试）
```

## Data Storage

数据全部保存在浏览器本地 IndexedDB（数据库 `semester-os`），断网可完整使用，
不上传任何数据。Settings 页支持 Export / Import JSON（带 schemaVersion: 1 与字段校验）。

## Import / Export

Settings → Data → Export JSON / Import JSON。导入会先解析校验（schema 版本、必填字段），
确认后覆盖写入。

## Environment Variables

复制 `.env.example` 为 `.env`（可选，仅 Planka 集成需要；不配置不影响任何功能）：

```
VITE_PLANKA_URL=
VITE_PLANKA_TOKEN=
```

## Planka Integration

Planka 定位为 Execution Layer。当前 MVP 显示 Not Connected，
`storage/repositories.ts` 的 Repository 抽象即为未来 `PlankaAdapter` 的接缝
（createTask / updateTask / completeTask / fetchTasks 一一对应）。

## Keyboard

- `N` 新建 Task，`B` 新建 Block（输入框聚焦时自动失效）
- Task 行内复选框快速完成；Tasks 页可 Move to Tomorrow / Backlog，无惩罚
