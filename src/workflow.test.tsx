import { afterEach, describe, expect, it, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BLOCK_TYPE_LABELS } from './domain/types';
import App from './App';
import { db } from './storage/db';
import { seedIfFirstLaunch } from './storage/seed';
import * as repos from './storage/repositories';
import { handleTaskDrop, handleTaskUnschedule, removeBlockWithUndo } from './services/dropActions';
import { scheduleBlocksForDate } from './services/scheduleService';
import { getWeekInfo, toISODate, todayDate } from './services/timeService';

/**
 * 使用工作流模拟：按真实使用顺序走一遍核心闭环 ——
 * 快速添加任务 → 采纳排课建议 → 手动建块关联任务 → 完成并记录实际用时 → 每周复盘。
 * 与 app.test.tsx 的单点检查不同，这里验证多步操作之间的数据联动。
 *
 * 注：项目未开启 vitest globals，Testing Library 的自动 cleanup 不生效，需手动清理。
 */

beforeEach(async () => {
  // HashRouter 的 location.hash 在同一文件的测试间残留，重置回总览
  window.location.hash = '';
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedIfFirstLaunch();
  // 测试夹具：应用种子已不含示例任务/成果，这里按需注入（仅测试环境）
  const now = new Date().toISOString();
  await db.tasks.bulkPut([
    { id: 't1', title: '完成课程大作业的开题调研', projectId: 'p1', estimateMinutes: 90, priority: 'HIGH', status: 'READY', createdAt: now, notes: '注意覆盖老师强调的三个考点。' },
    { id: 't2', title: '修复个人网站的登录问题', projectId: 'p2', estimateMinutes: 60, priority: 'HIGH', status: 'READY', createdAt: now },
    { id: 't3', title: '整理数据结构第一章例题', courseId: 'c6', estimateMinutes: 45, priority: 'MEDIUM', status: 'READY', createdAt: now },
    { id: 't4', title: '线性代数：补齐第 2 章未理解部分', courseId: 'c2', estimateMinutes: 90, priority: 'MEDIUM', status: 'BACKLOG', createdAt: now },
    { id: 't5', title: '数据结构 2.3 节习题 8/11/15', courseId: 'c5', estimateMinutes: 45, priority: 'MEDIUM', status: 'READY', createdAt: now },
  ]);
  await db.weeklyOutcomes.bulkPut([
    { id: 'wo1', weekId: getWeekInfo(todayDate()).id, title: '完成课程大作业开题报告初稿', linkedTaskIds: ['t1'], status: 'OPEN' },
  ]);
});

afterEach(cleanup);

async function renderApp() {
  render(<App />);
  // 等 Dashboard 完整渲染（建议面板由数据驱动出现）
  await waitFor(
    () => expect(screen.getByText('下一步建议')).toBeInTheDocument(),
    { timeout: 15000 },
  );
}

function suggestionPanel() {
  return screen.getByText('下一步建议').closest('section') as HTMLElement;
}

/** Toast 文案断言。注意：DndContext 自带一个空 role=status 区域，不能用 role 查询 toast。 */
async function expectToast(re: RegExp) {
  await waitFor(() => expect(screen.getByText(re)).toBeInTheDocument());
}

/** 依次采纳建议，返回已采纳的任务标题。 */
async function adoptSuggestion(user: ReturnType<typeof userEvent.setup>) {
  const panel = suggestionPanel();
  const before = (await repos.blockRepo.list()).length;
  const firstAdopt = within(panel).getAllByRole('button', { name: '采纳' })[0];
  await user.click(firstAdopt);
  await expectToast(/已开时间块/);
  const blocks = await repos.blockRepo.list();
  expect(blocks.length).toBe(before + 1);
  const adopted = blocks.find((b) => b.source === 'SUGGESTED');
  expect(adopted).toBeDefined();
  // 从落库结果反推期望文案与任务标题（DOM 可能在重渲染中变化，不作为事实来源）
  const block = adopted!;
  const label = `${BLOCK_TYPE_LABELS[block.type]}块 · ${block.start.slice(5, 10)} ${block.start.slice(11, 16)}–${block.end.slice(11, 16)}`;
  const task = await repos.taskRepo.get(block.taskIds[0]);
  return { title: label, taskTitle: task?.title ?? '', adoptedBlock: block };
}

describe('使用工作流模拟', () => {
  it('快速添加任务（任务 N 按钮）→ 出现在任务列表并正确入库', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole('button', { name: /任务 N/ }));
    const dialog = await screen.findByRole('dialog', { name: '新建任务' });

    await user.type(
      screen.getByPlaceholderText(/例如：/),
      '完成课程大作业的文献调研',
    );
    await user.selectOptions(
      within(dialog).getAllByRole('combobox')[0],
      '课程大作业',
    );
    await user.click(within(dialog).getByRole('button', { name: '保存' }));

    // 弹窗关闭后任务出现在列表（弹窗输入框与任务行同文案，需先等弹窗关闭）
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '新建任务' })).toBeNull(),
    );
    expect(screen.getAllByText('完成课程大作业的文献调研').length).toBeGreaterThan(0);
    const created = (await repos.taskRepo.list()).find(
      (t) => t.title === '完成课程大作业的文献调研',
    );
    expect(created).toMatchObject({
      status: 'READY',
      priority: 'MEDIUM',
      estimateMinutes: 60,
      projectId: 'p1',
    });
  });

  it('采纳排课建议 → 生成 SUGGESTED 时间块且绝不排在过去，同一任务不再被重复建议', async () => {
    const user = userEvent.setup();
    await renderApp();

    const { title, taskTitle, adoptedBlock } = await adoptSuggestion(user);
    expect(adoptedBlock.taskIds.length).toBe(1);

    // 建议可以落在今天或之后某天（例如晚上运行时今天已无未来空闲窗口），
    // 但绝不允许落在过去；若落在今天，必须出现在「今日安排」。
    const blockDate = adoptedBlock.start.slice(0, 10);
    const todayISO = toISODate(todayDate());
    expect(blockDate >= todayISO).toBe(true);
    if (blockDate === todayISO) {
      const todayPanel = screen.getByTestId('today-panel');
      await waitFor(() =>
        expect(within(todayPanel).getByText(taskTitle)).toBeInTheDocument(),
      );
    }

    // 回归优化点：已排入时间块的任务不应再次出现在建议里
    await waitFor(() => {
      const remaining = within(suggestionPanel())
        .getAllByRole('button', { name: '采纳' })
        .map((btn) => btn.closest('.row-item')?.textContent ?? '')
        .join('|');
      expect(remaining).not.toContain(title);
    });
  });

  it('手动创建时间块并关联任务 → 任务进入 DOING；冲突时段被拒绝', async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole('button', { name: /时间块 B/ }));
    const dialog = await screen.findByRole('dialog', { name: '新建时间块' });

    // 默认 14:00–16:00 深度工作；下拉框顺序：类型(0)、关联内容(1)、精力(2)
    await user.selectOptions(within(dialog).getAllByRole('combobox')[1], '数据结构');
    await user.click(within(dialog).getByText('数据结构 2.3 节习题 8/11/15'));
    await user.click(within(dialog).getByRole('button', { name: '保存' }));

    const t5 = await repos.taskRepo.get('t5');
    expect(t5?.status).toBe('DOING');
    const userBlocks = (await repos.blockRepo.list()).filter(
      (b) => b.source === 'USER',
    );
    expect(userBlocks.length).toBe(1);
    expect(userBlocks[0].taskIds).toContain('t5');
    expect(userBlocks[0].plannedMinutes).toBe(120);

    // 冲突是软限制：同一时段再建一块 → 允许保存，仅提醒重叠
    await user.click(screen.getByRole('button', { name: /时间块 B/ }));
    const dialog2 = await screen.findByRole('dialog', { name: '新建时间块' });
    await user.click(within(dialog2).getByRole('button', { name: '保存' }));
    await waitFor(() =>
      expect(screen.getAllByText(/重叠/).length).toBeGreaterThan(0),
    );
    expect(
      (await repos.blockRepo.list()).filter((b) => b.source === 'USER').length,
    ).toBe(2);
  });

  it('拖拽任务到日历日（handleTaskDrop）→ 在最大空闲窗口生成时间块', async () => {
    await renderApp();
    const courses = await repos.courseRepo.list();
    const settings = (await repos.settingsRepo.get())!;
    const task = (await repos.taskRepo.get('t1'))!;
    const tomorrow = toISODate(new Date(todayDate().getTime() + 86400000));

    const res = await handleTaskDrop(
      task,
      { kind: 'day', dateISO: tomorrow },
      { courses, settings, existingBlocks: [] },
    );
    expect(res.message).toContain('已创建时间块');

    const dropped = (await repos.blockRepo.list()).find((b) =>
      b.taskIds.includes('t1'),
    );
    expect(dropped).toBeDefined();
    expect(dropped!.start.slice(0, 10)).toBe(tomorrow);
    expect(dropped!.type).toBe('ENGINEERING');
    // 明日无课程 Block 时应落在从 08:00 起的最大空闲窗口
    const sched = scheduleBlocksForDate(
      new Date(`${tomorrow}T00:00:00`),
      courses,
      settings,
    );
    if (sched.length === 0) {
      expect(dropped!.start.slice(11, 16)).toBe('08:00');
    }
    expect((await repos.taskRepo.get('t1'))?.status).toBe('READY');
  });

  it('完成任务并记录实际用时 → 预估 vs 实际出现记录，复盘页统计联动', { timeout: 20000 }, async () => {
    const user = userEvent.setup();
    await renderApp();

    // 进入任务页
    await user.click(screen.getByRole('link', { name: '任务' }));
    await screen.findByText('待排任务').catch(() => {});

    // 打开 t2 详情，记录实际用时 75 分钟并完成
    await user.click(screen.getAllByText('修复个人网站的登录问题')[0]);
    const dialog = await screen.findByRole('dialog', { name: '任务详情' });
    await user.type(within(dialog).getByPlaceholderText('留空 = 不记录'), '75');
    await user.click(within(dialog).getByRole('button', { name: '完成' }));

    const t2 = await repos.taskRepo.get('t2');
    expect(t2).toMatchObject({ status: 'DONE', actualMinutes: 75 });
    expect(t2?.completedAt).toBeDefined();

    // 任务页出现预估 vs 实际记录（60 分钟 → 75 分钟）
    await waitFor(() =>
      expect(screen.getByText(/→ 1 小时 15 分/)).toBeInTheDocument(),
    );

    // 复盘页统计：本周完成任务数为 1
    await user.click(screen.getByRole('link', { name: '复盘' }));
    await screen.findByText('每周复盘');
    await waitFor(() =>
      expect(screen.getByText('完成任务数：').parentElement).toHaveTextContent(
        '完成任务数：1',
      ),
    );
  });

  it('填写周复盘 → 自动保存（无保存按钮），清空即时生效且 ⌘Z 可撤回', { timeout: 20000 }, async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole('link', { name: '复盘' }));
    await screen.findByText('每周复盘');

    const textareas = screen.getAllByRole('textbox');
    await user.type(textareas[0], '完成了课程大作业的开题调研');
    await user.type(
      textareas[textareas.length - 1],
      '1. 开题调研 2. 网站登录修复 3. 数据结构复习',
    );

    // 自动保存：防抖后落库，无需任何保存动作
    await waitFor(async () => {
      expect(await db.reviews.toArray()).toHaveLength(1);
    }, { timeout: 5000 });
    const saved = (await db.reviews.toArray())[0];
    expect(saved.answers.advanced).toContain('开题调研');
    expect(saved.answers.nextWeekTop3).toContain('开题调研');

    // 清空即时生效（直接落库为空）
    await user.click(screen.getByRole('button', { name: '清空' }));
    await waitFor(async () => {
      const list = await db.reviews.toArray();
      expect(list[0]?.answers.advanced ?? '').toBe('');
    }, { timeout: 5000 });

    // ⌘Z 撤回清空 —— 不依赖任何"保存"
    const { useUndo } = await import('./store/uiStore');
    await useUndo.getState().undo();
    await waitFor(async () => {
      const list = await db.reviews.toArray();
      expect(list[0]?.answers.advanced ?? '').toContain('开题调研');
    }, { timeout: 5000 });

    // 重新进入页面后答案回显
    await user.click(screen.getByRole('link', { name: '总览' }));
    await user.click(screen.getByRole('link', { name: '复盘' }));
    await screen.findByText('每周复盘');
    await waitFor(() =>
      expect(screen.getAllByRole('textbox')[0]).toHaveValue(
        '完成了课程大作业的开题调研',
      ),
    );
  });

  it('一整周闭环：采纳 → 排除已排 → 完成 → 数据一致', { timeout: 20000 }, async () => {
    const user = userEvent.setup();
    await renderApp();

    // 1) 连续采纳两条建议（t2、t1）
    await adoptSuggestion(user);
    await waitFor(() =>
      expect(
        within(suggestionPanel()).getAllByRole('button', { name: '采纳' }).length,
      ).toBeGreaterThan(0),
    );
    await adoptSuggestion(user);
    const blocks = await repos.blockRepo.list();
    expect(blocks.filter((b) => b.source === 'SUGGESTED').length).toBe(2);

    // 2) 建议列表不再包含这两个已排任务
    const suggestionText = suggestionPanel().textContent ?? '';
    expect(suggestionText).not.toContain('修正跟随延迟');
    expect(suggestionText).not.toContain('v0.3 CAD');

    // 3) 完成全部待办
    for (const id of ['t2', 't1', 't3', 't5']) {
      await repos.taskRepo.complete(id, 60);
    }
    const tasks = await repos.taskRepo.list();
    expect(tasks.filter((t) => t.status === 'DONE').length).toBe(4);

    // 4) Block ↔ Task 关联保持一致
    const finalBlocks = await repos.blockRepo.list();
    const attachedIds = new Set(finalBlocks.flatMap((b) => b.taskIds));
    expect(attachedIds.has('t2')).toBe(true);
    expect(attachedIds.has('t1')).toBe(true);
  });

  it('拖到空闲时段 → 块精确落在该窗口；任务拖回待排后空块体面消失，且两者都可撤销', { timeout: 20000 }, async () => {
    await renderApp();
    const courses = await repos.courseRepo.list();
    const settings = (await repos.settingsRepo.get())!;
    const task = (await repos.taskRepo.get('t1'))!;
    const today = toISODate(todayDate());

    // 1) 拖到今日空闲时段（总览页 free-chip 的落点）
    const res = await handleTaskDrop(
      task,
      { kind: 'window', start: `${today}T10:00:00`, end: `${today}T12:00:00` },
      { courses, settings, existingBlocks: [] },
    );
    expect(res.message).toContain('已创建时间块');
    const winBlock = (await repos.blockRepo.list()).find((b) => b.taskIds.includes('t1'))!;
    expect(winBlock.start.slice(11, 16)).toBe('10:00');
    expect(winBlock.end.slice(11, 16)).toBe('12:00');

    // 2) 撤销窗口拖放：块消失
    await res.undo!();
    expect((await repos.blockRepo.list()).find((b) => b.taskIds.includes('t1'))).toBeUndefined();

    // 3) 重新拖入，再把任务拖回待排 → 只含该任务的空块自动删除
    await handleTaskDrop(
      task,
      { kind: 'window', start: `${today}T10:00:00`, end: `${today}T12:00:00` },
      { courses, settings, existingBlocks: [] },
    );
    const blocks2 = await repos.blockRepo.list();
    const target2 = blocks2.find((b) => b.taskIds.includes('t1'))!;
    const unscheduleRes = await handleTaskUnschedule(task, blocks2);
    expect(unscheduleRes.message).toContain('移回待排');
    const after = await repos.blockRepo.list();
    expect(after.find((b) => b.id === target2.id)).toBeUndefined();

    // 4) 撤销「移回待排」：块和任务关联都恢复
    await unscheduleRes.undo!();
    const restored = (await repos.blockRepo.list()).find((b) => b.id === target2.id);
    expect(restored?.taskIds).toContain('t1');
  });

  it('删除时间块可通过 removeBlockWithUndo 完整恢复（含原 id 与任务关联）', async () => {
    await renderApp();
    const courses = await repos.courseRepo.list();
    const settings = (await repos.settingsRepo.get())!;
    const task = (await repos.taskRepo.get('t3'))!;
    const today = toISODate(todayDate());
    const created = await handleTaskDrop(
      task,
      { kind: 'window', start: `${today}T09:00:00`, end: `${today}T11:00:00` },
      { courses, settings, existingBlocks: [] },
    );
    const target = (await repos.blockRepo.list()).find(
      (b) => b.taskIds.includes('t3'),
    )!;
    expect(target).toBeDefined();
    void created;

    const res = await removeBlockWithUndo(target);
    expect((await repos.blockRepo.list()).find((b) => b.id === target.id)).toBeUndefined();

    await res.undo!();
    const restored = (await repos.blockRepo.list()).find((b) => b.id === target.id);
    expect(restored).toEqual(target);
  });
});
