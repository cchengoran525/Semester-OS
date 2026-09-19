import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AIError, chat, extractJSON, probe } from './client';
import { aiConfig, deepAIConfig, normalizeBaseUrl } from './config';
import { draftWeeklyReview, reviewGap, suggestTaskBreakdown, suggestWeeklyPlan } from './features';
import type { AIConfig } from './config';

const config: AIConfig = {
  baseUrl: 'https://ai.test/v4',
  apiKey: 'sk-test',
  model: 'test-model',
};

const baseAI = { baseUrl: 'https://x.test/v4', apiKey: 'k1', model: 'fast-model' };

describe('deepAIConfig', () => {
  it('falls back to the fast profile entirely when deep is absent', () => {
    expect(deepAIConfig({ ai: baseAI } as never)).toEqual(baseAI);
  });

  it('merges field by field (e.g. only swapping the model)', () => {
    expect(deepAIConfig({ ai: { ...baseAI, deep: { model: 'deep-model' } } } as never)).toEqual({
      baseUrl: 'https://x.test/v4',
      apiKey: 'k1',
      model: 'deep-model',
    });
    expect(
      deepAIConfig({ ai: { ...baseAI, deep: { baseUrl: 'https://deep.test', model: 'deep-model' } } } as never),
    ).toEqual({ baseUrl: 'https://deep.test', apiKey: 'k1', model: 'deep-model' });
  });

  it('returns null when the fast profile is not configured', () => {
    expect(deepAIConfig(null)).toBeNull();
    expect(deepAIConfig({ ai: { baseUrl: '', apiKey: '', model: '', deep: baseAI } } as never)).toBeNull();
  });
});

/** OpenAI 兼容响应包装。 */
function completion(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200 },
  );
}

describe('aiConfig', () => {
  it('returns null unless all three fields are filled', () => {
    expect(aiConfig(null)).toBeNull();
    expect(aiConfig({ id: 'app' } as never)).toBeNull();
    expect(
      aiConfig({ ai: { baseUrl: 'https://x.test', apiKey: '', model: 'm' } } as never),
    ).toBeNull();
    expect(
      aiConfig({ ai: { baseUrl: 'https://x.test', apiKey: 'k', model: 'm' } } as never),
    ).toEqual({ baseUrl: 'https://x.test', apiKey: 'k', model: 'm' });
  });

  it('normalizes trailing slash and full chat/completions path', () => {
    expect(normalizeBaseUrl('https://x.test/v4/')).toBe('https://x.test/v4');
    expect(normalizeBaseUrl('https://x.test/v4/chat/completions')).toBe('https://x.test/v4');
  });

  it('passes through personal context when present', () => {
    const withContext = aiConfig({
      ai: { ...baseAI, context: '  某大学计算机大二  ' },
    } as never);
    expect(withContext).toEqual({ ...baseAI, context: '某大学计算机大二' });
    expect(aiConfig({ ai: baseAI } as never)).toEqual(baseAI);
  });
});

describe('ai client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => completion('你好')));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts bearer auth, model and messages to /chat/completions', async () => {
    await chat(config, { system: 's', user: 'u' });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ai.test/v4/chat/completions');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-test' });
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('test-model');
    expect(body.messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ]);
    expect(body.response_format).toBeUndefined();
  });

  it('appends personal context to the system prompt when configured', async () => {
    await chat({ ...config, context: '某大学计算机大二，两个进行中的项目' }, { system: 's', user: 'u' });
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.messages[0].content).toContain('关于用户');
    expect(body.messages[0].content).toContain('某大学计算机大二，两个进行中的项目');
    // 没有 context 时保持原样
    await chat(config, { system: 's', user: 'u' });
    const body2 = JSON.parse(
      (vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string,
    );
    expect(body2.messages[0].content).toBe('s');
  });

  it('passes response_format when json requested', async () => {
    await chat(config, { system: 's', user: 'u', json: true });
    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('sends reasoning_effort=low by default and degrades to most-compatible form on 400', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('unknown param', { status: 400 }))
      .mockResolvedValueOnce(completion('{"ok":1}'));
    vi.stubGlobal('fetch', fetchMock);
    const content = await chat(config, { system: 's', user: 'u', json: true });
    expect(content).toBe('{"ok":1}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const b1 = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    const b2 = JSON.parse(fetchMock.mock.calls[1][1]!.body as string);
    expect(b1.reasoning_effort).toBe('low');
    expect(b1.response_format).toEqual({ type: 'json_object' });
    expect(b2.reasoning_effort).toBeUndefined();
    expect(b2.response_format).toBeUndefined();
  });

  it('falls back to reasoning_content when content is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: '', reasoning_content: '{"title":"思考通道里的结果"}' } },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const out = await chat(config, { system: 's', user: 'u' });
    expect(out).toBe('{"title":"思考通道里的结果"}');
  });

  it('probe returns ok on 2xx, reachable on 401, unreachable on network error', async () => {
    expect(await probe(config)).toBe('ok');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    expect(await probe(config)).toBe('reachable');

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
    expect(await probe(config)).toBe('unreachable');
  });

  it('extractJSON strips markdown fences', () => {
    expect(extractJSON<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractJSON('not json')).toThrow(AIError);
  });
});

describe('suggestTaskBreakdown', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('validates, clamps and filters AI output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        completion(
          JSON.stringify([
            { title: '读第一章', estimateMinutes: 55, priority: 'URGENT' },
            { title: '  ', estimateMinutes: 30 },
            { estimateMinutes: 30 },
            { title: '写实验报告', estimateMinutes: 90, priority: 'HIGH', notes: '用模板' },
          ]),
        ),
      ),
    );
    const result = await suggestTaskBreakdown(config, {
      projectName: '实验报告',
      milestones: ['初稿'],
      existingTaskTitles: [],
    });
    // 空标题条目被丢弃；55 就近夹取到 60；非法 priority 落回 MEDIUM
    expect(result).toEqual([
      { title: '读第一章', estimateMinutes: 60, priority: 'MEDIUM', notes: undefined },
      { title: '写实验报告', estimateMinutes: 90, priority: 'HIGH', notes: '用模板' },
    ]);
  });

  it('throws when the model returns no usable tasks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => completion('{"tasks": []}')));
    await expect(
      suggestTaskBreakdown(config, { projectName: 'x', milestones: [], existingTaskTitles: [] }),
    ).rejects.toBeInstanceOf(AIError);
  });
});

describe('draftWeeklyReview', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps only known question keys and non-empty strings', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        completion(
          JSON.stringify({
            advanced: '我完成了数据管道。',
            bogusKey: 'hack',
            courseRisk: '',
            nextWeekTop3: '补作业。',
          }),
        ),
      ),
    );
    const draft = await draftWeeklyReview(config, {
      weekLabel: '第 1 周',
      completedTasks: [],
      deepWorkMinutes: 0,
      deepWorkByContext: {},
      allocation: [],
      courses: [],
      activeProjects: [],
      warnings: [],
    });
    expect(draft).toEqual({ advanced: '我完成了数据管道。', nextWeekTop3: '补作业。' });
  });

  it('throws when nothing usable remains', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => completion('{"advanced": ""}')));
    await expect(
      draftWeeklyReview(config, {
        weekLabel: '第 1 周',
        completedTasks: [],
        deepWorkMinutes: 0,
        deepWorkByContext: {},
        allocation: [],
        courses: [],
        activeProjects: [],
        warnings: [],
      }),
    ).rejects.toBeInstanceOf(AIError);
  });
});

describe('reviewGap', () => {
  const gapInput = {
    weekLabel: '第 2 周',
    outcomes: [
      { title: '完成数据结构复习', status: '未完成', linkedTasks: 2, scheduledMinutes: 0, completedLinked: 0 },
    ],
    completedTasks: [],
    deepWorkMinutes: 150,
    deepWorkByContext: [],
    allocation: [],
    courses: [],
    warnings: [],
  };

  afterEach(() => vi.unstubAllGlobals());

  it('keeps valid findings and drops malformed ones', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        completion(
          JSON.stringify({
            deviations: [
              { fact: '计划完成数据结构复习，实际没有为它排任何时间块', action: '下周排两个块' },
              { action: '没有 fact 应被丢弃' },
              { fact: '   ' },
            ],
          }),
        ),
      ),
    );
    const gaps = await reviewGap(config, gapInput);
    expect(gaps).toEqual([
      { fact: '计划完成数据结构复习，实际没有为它排任何时间块', action: '下周排两个块' },
    ]);
  });

  it('returns an empty array when plan and reality match', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => completion('{"deviations":[]}')));
    expect(await reviewGap(config, gapInput)).toEqual([]);
  });

  it('throws when the response is not an object with deviations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => completion('[1,2]')));
    await expect(reviewGap(config, gapInput)).rejects.toBeInstanceOf(AIError);
  });
});

describe('suggestWeeklyPlan', () => {
  const planInput = {
    weekLabel: '第 3 周',
    focusSource: {
      outcomes: [{ title: '完成数据结构复习', status: '未完成' }],
      projectMilestones: [{ project: '课程大作业', milestone: 'M2 里程碑' }],
    },
    tasks: [
      { key: 'T1', title: '写实验报告', estimateMinutes: 90, priority: 'HIGH', dueInDays: 1 },
      { key: 'T2', title: '复习 2.3 节', estimateMinutes: 60, priority: 'MEDIUM', dueInDays: null },
    ],
    windows: [
      { date: '2026-09-08', start: '14:00', end: '17:00', minutes: 180 },
      { date: '2026-09-09', start: '09:00', end: '11:00', minutes: 120 },
    ],
    projects: ['课程大作业'],
    courseHints: [],
    warnings: [],
  };

  afterEach(() => vi.unstubAllGlobals());

  it('keeps valid placements, clips to windows, drops junk and overlaps', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        completion(
          JSON.stringify({
            focus: '先清线性代数债务，课程大作业只保留一个块',
            placements: [
              // 完全落在窗口内 → 原样保留
              { taskId: 'T1', date: '2026-09-08', start: '14:30', end: '16:00', type: 'ENGINEERING', reason: '明天截止' },
              // 未知任务 → 丢弃
              { taskId: 'T9', date: '2026-09-08', start: '14:00', end: '15:00', type: 'ADMIN', reason: '' },
              // 不在任何窗口内 → 丢弃
              { taskId: 'T2', date: '2026-09-08', start: '10:00', end: '11:00', type: 'DEEP_WORK', reason: '' },
              // 尾部超出窗口但与 T1 不重叠（T1 到 16:00）→ 裁剪到 16:30–17:00 保留
              { taskId: 'T2', date: '2026-09-08', start: '16:30', end: '18:30', type: 'ADMIN', reason: '' },
              // 与 T1 重叠 → 去重丢弃
              { taskId: 'T2', date: '2026-09-08', start: '15:30', end: '16:30', type: 'DEEP_WORK', reason: '' },
              // COURSE 不允许 → 回落 DEEP_WORK
              { taskId: 'T2', date: '2026-09-09', start: '09:00', end: '10:30', type: 'COURSE', reason: '上午清醒' },
            ],
          }),
        ),
      ),
    );
    const plan = await suggestWeeklyPlan(config, planInput);
    expect(plan.focus).toBe('先清线性代数债务，课程大作业只保留一个块');
    expect(plan.placements).toEqual([
      { taskId: 'T1', date: '2026-09-08', start: '14:30', end: '16:00', type: 'ENGINEERING', reason: '明天截止' },
      { taskId: 'T2', date: '2026-09-08', start: '16:30', end: '17:00', type: 'ADMIN', reason: '' },
      { taskId: 'T2', date: '2026-09-09', start: '09:00', end: '10:30', type: 'DEEP_WORK', reason: '上午清醒' },
    ]);
  });

  it('accepts a legacy bare array (no focus) for robustness', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        completion(
          JSON.stringify([
            { taskId: 'T1', date: '2026-09-08', start: '14:00', end: '15:00', type: 'DEEP_WORK', reason: '' },
          ]),
        ),
      ),
    );
    const plan = await suggestWeeklyPlan(config, planInput);
    expect(plan.focus).toBe('');
    expect(plan.placements).toHaveLength(1);
  });

  it('drops everything when no placement fits a window', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        completion(
          JSON.stringify([
            { taskId: 'T1', date: '2026-09-10', start: '14:00', end: '15:00', type: 'ADMIN', reason: '' },
          ]),
        ),
      ),
    );
    await expect(suggestWeeklyPlan(config, planInput)).rejects.toBeInstanceOf(AIError);
  });
});
