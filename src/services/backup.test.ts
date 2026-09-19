import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../storage/db';
import { seedIfFirstLaunch } from '../storage/seed';
import * as repos from '../storage/repositories';
import { buildPayload, probeServer, pullSnapshot, pushSnapshot } from './backup';

/**
 * 备份/同步：只测与服务器交互的部分（File System Access 在 jsdom 里不可用，
 * 落盘能力靠浏览器手测）。原则：只读库 + HTTP，不改业务逻辑。
 */

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedIfFirstLaunch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('服务器快照同步', () => {
  it('buildPayload 打包整库并带 schemaVersion', async () => {
    const base = (await repos.settingsRepo.get())!;
    const payload = await buildPayload({ ...base, id: 'app', sync: { ...(base.sync ?? {}), deviceId: 'dev-1' } });
    expect(payload.schemaVersion).toBe(1);
    expect(payload.deviceId).toBe('dev-1');
    const data = payload.data as { courses: unknown[]; tasks: unknown[] };
    expect(data.courses.length).toBe(8);
    expect(data.tasks.length).toBe(0);
  });

  it('推送使用 PUT + Bearer 令牌（自动推送先探测服务器，404 视为空服务器）', async () => {
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : new Response('no snapshot', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await pushSnapshot({ url: 'http://server.local:8787/', token: 'tok' });
    expect(r.status).toBe('pushed');
    const putCall = fetchMock.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'PUT') as unknown as [
      string,
      RequestInit,
    ];
    expect(putCall[0]).toBe('http://server.local:8787/snapshot'); // 末尾斜杠被规范化
    expect(putCall[1].method).toBe('PUT');
    expect((putCall[1].headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('多设备护栏：服务器比本机上次同步点新时，跳过自动推送；手动可强制', async () => {
    const older = new Date(Date.now() - 60_000).toISOString();
    await repos.settingsRepo.patchSync({ lastSyncedAt: older });
    const newer = new Date().toISOString();
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : new Response(
            JSON.stringify({ schemaVersion: 1, updatedAt: newer, data: { courses: [], tasks: [] } }),
            { status: 200 },
          ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const auto = await pushSnapshot({ url: 'http://server.local' });
    expect(auto.status).toBe('skipped-server-newer');
    expect(auto.updatedAt).toBe(newer);
    expect(fetchMock.mock.calls.filter(([, i]) => (i as RequestInit)?.method === 'PUT')).toHaveLength(0);

    const forced = await pushSnapshot({ url: 'http://server.local' }, undefined, { manual: true });
    expect(forced.status).toBe('pushed');
  });

  it('多设备护栏：服务器时间与本地同步点一致（自己推的）→ 正常推送', async () => {
    const same = new Date().toISOString();
    await repos.settingsRepo.patchSync({ lastSyncedAt: same });
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) =>
      init?.method === 'PUT'
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : new Response(JSON.stringify({ schemaVersion: 1, updatedAt: same, data: {} }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await pushSnapshot({ url: 'http://server.local' });
    expect(r.status).toBe('pushed');
  });

  it('远端更新时导入，远端较旧时跳过', async () => {
    // 造一份"远端"数据：把课程清空后导出，模拟远端与本地不同
    const localCourses = await repos.courseRepo.list();
    await db.courses.clear();
    await repos.courseRepo.create({
      name: '远端课程',
      schedule: [],
      health: 'GREEN',
      debt: { understanding: 0, assignment: 0, review: 0, exam: 0 },
    });
    const remoteJson = JSON.parse(
      await (await import('./importExport')).exportAll(),
    ) as { data: unknown; schemaVersion: number };
    await db.courses.clear();
    for (const c of localCourses) await db.courses.put(c);

    const newer = new Date(Date.now() + 60_000).toISOString();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ schemaVersion: remoteJson.schemaVersion, updatedAt: newer, data: remoteJson.data }),
          { status: 200 },
        ),
      ),
    );
    const applied = await pullSnapshot({ url: 'http://server.local:8787' });
    expect(applied.applied).toBe(true);
    expect((await repos.courseRepo.list()).map((c) => c.name)).toContain('远端课程');

    // 本地时间戳已是最新 → 再拉取时跳过
    const again = await pullSnapshot({ url: 'http://server.local:8787' });
    expect(again.applied).toBe(false);
    expect(again.reason).toBe('本地已是最新');
  });

  it('空数据保护：数据骤降时拒绝自动推送，手动推送可强制', async () => {
    // 先建立"上次推送有 6 条用户数据"的记录
    const { summarize } = await import('./backup');
    await db.meta.put({
      key: 'lastPush',
      value: {
        checksum: 'seed',
        summary: summarize({ tasks: [1, 2, 3], blocks: [1, 2], weeklyOutcomes: [1], reviews: [] }),
        at: new Date().toISOString(),
      },
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const auto = await pushSnapshot({ url: 'http://server.local' });
    expect(auto.status).toBe('blocked-empty');
    expect(fetchMock).not.toHaveBeenCalled(); // 一个字都没发出去

    const forced = await pushSnapshot({ url: 'http://server.local' }, undefined, { manual: true });
    expect(forced.status).toBe('pushed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('内容未变时跳过推送（去重）', async () => {
    const { summarize } = await import('./backup');
    const data = JSON.parse(await (await import('./importExport')).exportAll()).data;
    await db.meta.put({
      key: 'lastPush',
      value: { checksum: (await import('./backup')).checksumForTest(data), summary: summarize(data), at: new Date().toISOString() },
    });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await pushSnapshot({ url: 'http://server.local' });
    expect(r.status).toBe('skipped-unchanged');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('服务器 404 与网络故障的探测结果', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no snapshot', { status: 404 })));
    expect(await probeServer({ url: 'http://server.local' })).toBe('ok');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down'); }));
    expect(await probeServer({ url: 'http://server.local' })).toBe('unreachable');
  });
});

describe('新设备自动恢复', () => {
  it('本机为空 + 从未同步 + 服务器有数据 → 自动恢复并武装 lastPush 基线', async () => {
    // 造一份"服务器"数据（含任务）
    const { exportAll } = await import('./importExport');
    await repos.taskRepo.create({ title: '来自服务器的任务', estimateMinutes: 30, priority: 'MEDIUM', status: 'READY' });
    const remoteJson = JSON.parse(await exportAll()) as { data: unknown; schemaVersion: number };
    const newer = new Date().toISOString();
    // 清掉本地任务，回到"空"状态
    await db.tasks.clear();
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ schemaVersion: remoteJson.schemaVersion, updatedAt: newer, data: remoteJson.data }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { maybeAutoRestore } = await import('./backup');
    const applied = await maybeAutoRestore({ url: 'http://server.local' });
    expect(applied).toBe(true);
    expect((await repos.taskRepo.list()).map((t) => t.title)).toContain('来自服务器的任务');
    expect((await repos.settingsRepo.get())?.sync?.lastSyncedAt).toBe(newer);
    // 恢复后基线已武装：再次推送（内容一致）会被去重跳过
    const r = await pushSnapshot({ url: 'http://server.local' });
    expect(r.status).toBe('skipped-unchanged');
  });

  it('本地已有用户产出 → 绝不自动恢复；服务器 404 → 不做任何事', async () => {
    await repos.taskRepo.create({ title: '本地任务', estimateMinutes: 30, priority: 'MEDIUM', status: 'READY' });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const { maybeAutoRestore } = await import('./backup');
    // 本地有数据：一个请求都不该发
    expect(await maybeAutoRestore({ url: 'http://server.local' })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    // 本地为空但服务器 404：探测后放弃
    await db.tasks.clear();
    expect(await maybeAutoRestore({ url: 'http://server.local' })).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
