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

首次打开会自动录入演示数据（一套示例课程表 + 6 个示例项目，都可在应用内随意修改），之后不会再覆盖你的数据。

## Deployment（通用化部署）

应用是纯静态产物（`dist/`），可托管到任何静态服务器 / CDN。产物内使用
HashRouter 与相对化的资源引用，无需服务端路由配置；数据全部在浏览器
IndexedDB，服务端不需要数据库。

**方式一：Docker（推荐）**

```bash
docker compose up -d --build            # http://localhost:8080
docker compose --profile planka up -d --build   # 连同可选的 Planka 一起部署
```

- 多阶段构建：Node 构建产物由 nginx 提供服务，`/healthz` 健康检查
- `VITE_PLANKA_*` 为构建期变量：在 `.env` 配置后 `--build` 重建即可启用集成
- 构建产物 `/assets/` 永久缓存、`index.html` 不缓存，发新版立即生效

**方式二：任意静态托管**

```bash
npm run build
# dist/ 上传到 nginx / Caddy / Vercel / GitHub Pages 等
VITE_BASE=/semester-os/ npm run build   # 子路径托管时加 base 前缀
```

本地预览生产产物：`npm run preview`。

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

## Backup & Sync（备份与同步）

数据在浏览器 IndexedDB 里，清站点数据会一起丢失。设置页提供两条互补的保险：

1. **落盘备份**（File System Access API，Chrome/Edge）
   选择一次本地文件夹，之后数据变更 3 秒内自动写出 `semester-os.json`，
   并按天留档到 `history/YYYY-MM-DD.json`。清浏览器数据也不影响这些文件。
2. **服务器同步**（自建）
   填服务器地址（可选令牌），整库快照 `PUT /snapshot`，应用启动时比对拉取，
   last-write-wins；覆盖本地前会先落一份本地快照。变更后 3 秒内自动推送。

参考服务端（零依赖 Node）：

```bash
TOKEN=你的令牌 PORT=8787 node server/snapshot-server.mjs
# 或 node server/snapshot-server.mjs --token=xxx --port=8787 --data=./data
```

- `GET /health` 健康检查；`GET /snapshot` 取最新快照；`PUT /snapshot` 覆盖保存（Bearer 校验）
- 存储：`data/snapshot.json` + `data/history/<时间戳>.json`（保留最近 200 份）

部署到自己的服务器/内网后，把地址填进 设置 → 备份与同步 即可；
如果服务器只在内网，手机等外部设备需要 VPN 或反向代理。

## Environment Variables

复制 `.env.example` 为 `.env`（可选，仅 Planka 集成需要；不配置不影响任何功能）：

```
# Planka 地址，如 https://planka.example.com（结尾不带斜杠）
VITE_PLANKA_URL=
# API 令牌：Planka → 个人设置 → API 令牌
VITE_PLANKA_TOKEN=
# 要同步的看板 ID（拉取/推送需要；仅测试连接可不填）
VITE_PLANKA_BOARD_ID=
# 推送任务的目标列表 ID（不填默认用看板第一个列表）
VITE_PLANKA_LIST_ID=
```

修改环境变量后需重启开发服务器（`npm run dev`）。

## Planka Integration

Planka 定位为 Execution Layer（执行层），实现在 `src/services/planka/`：

- `config.ts`   读取环境变量，缺 URL/TOKEN 时集成自动停用
- `client.ts`   精简的 Planka REST 客户端（Bearer 认证，boards/cards 端点，
  兼容 Planka 1.x 内联结构与 2.x 的 `items` 包装），`probe()` 三态探测：
  `ok` / `reachable`（令牌或路径有误）/ `unreachable`（网络不通）
- `adapter.ts`  `PlankaAdapter` 实现 `ExecutionLayer` 接口（fetchTasks /
  createTask / updateTask / completeTask / removeTask），字段映射：
  Task.title ↔ card.name、Task.notes ↔ card.description、DONE ↔ isCompleted；
  预估/优先级/排期保留在本地（Planka 无对应概念）
- `sync.ts`     手动同步：`pullCardsAsTasks`（按标题去重导入）、
  `pushTaskAsCard`（推送单个任务）

入口在 设置 → 集成：测试连接 / 从 Planka 拉取卡片 / 推送待办任务。
同步是手动触发的，不会自动改动本地数据，符合"系统只建议、用户决定"原则。
`storage/repositories.ts` 的 Repository 抽象仍是接缝，未来换其他执行工具
（如 Wekan、Todoist）只需替换 adapter 实现，UI 与存储层不动。

## AI Assistant（AI 助手）

AI 集成在 `src/services/ai/`，走 **OpenAI 兼容协议**（`/chat/completions`），
不绑定任何厂商——智谱 GLM、DeepSeek、Kimi、SiliconFlow、OpenRouter 等均可。
支持**双模型档位**：

- **快速模型**（必填）：简报 / 复盘起草 / 任务拆解，低思考档（`reasoning_effort: low`），
  秒级响应
- **深度模型**（可选，逐字段回落到快速模型）：AI 周计划等需要全局取舍的深度
  规划，高思考档。可以只填一个更强的模型名，Key / 地址自动沿用快速模型

各能力配置：

- `config.ts`   读取设置页配置（Base URL / API Key / 模型名 + 可选深度档），
  未配置即停用；`deepAIConfig()` 做逐字段回落解析
- `client.ts`   兼容客户端（Bearer 认证），`probe()` 三态探测，`extractJSON()`
  剥围栏解析；180s 超时；服务不支持 `response_format` / `reasoning_effort`
  时自动降级重试；content 为空时兜底取推理模型的 `reasoning_content`；
  **个人长期背景**（`settings.ai.context`）自动追加到所有请求的 system prompt
- `prompts.ts`  提示词调教：把「只建议不修改、注意力经济、不制造焦虑」的产品
  哲学写进 system prompt，每个能力单独约束输出 JSON 格式
- `features.ts` 五个能力：任务拆解 / 周复盘起草 / 计划对照 / 一键周计划
  （另有一个已删除的旧"简报"能力），输出经白名单校验与夹取（预估就近取
  15–180 分钟档、优先级回落 MEDIUM、丢弃无效条目、排期裁剪进空闲窗口并去重叠）
  才进 UI

四个功能入口（均需先在 设置 → AI 助手 配置，Key 只存本地 IndexedDB）：

- 项目卡片展开 → **AI 拆解任务**：生成建议子任务，勾选后导入为「待定」任务
- 每周复盘 → **AI 起草**：基于本周真实数据起草五个复盘问题，AI 只填草稿，
  用户核对修改后才保存
- 总览 → **AI 周计划**（深度模型）：先给出未来 7 天的**焦点与取舍**，再给排期
  草稿；输入包含本周目标（Outcomes）、进行中项目的当前里程碑、课程债务，
  reason 要求说明"为什么是它、因此暂缓了什么"。勾选采纳后创建 SUGGESTED 块
- 总览 → **AI 对照 · 计划 vs 实际**：不做数据汇总，只对照"本周设定的目标"与
  "实际投入的时间块"，指出 1–2 条最值得注意的偏离（例如目标写了却 0 分钟投入），
  计划与实际一致时明说没有偏离

**排期不落在过去**：所有窗口计算（下一步建议 / 今日空闲 / AI 周计划）都以
`services/planning.ts` 的 `collectUpcomingWindows` 为准——今天的窗口从"现在"
向上取整到下一个 15 分钟开始，已过 22:00 则今天不再产生窗口。

**本周目标（Outcomes）**：总览页「本周成果」可直接添加/删除，它是 AI 周计划定
焦点、AI 对照找偏离的数据来源。

**个人长期背景**：设置 → AI 助手 → 「个人长期背景」可写入身份、项目与长期目标
（例如在做的项目与长期计划），所有 AI 请求自动携带——周计划
据此定焦点、对照据此判断偏离。该字段与 API Key 均只存本地 IndexedDB，导出 JSON
时会剥离。

AI 只在用户点击时把当次所需的摘要数据发给所配置的服务，任何输出都不会
自动修改本地数据。

## Keyboard

- `N` 新建 Task，`B` 新建 Block（输入框聚焦时自动失效）
- Task 行内复选框快速完成；Tasks 页可 Move to Tomorrow / Backlog，无惩罚
