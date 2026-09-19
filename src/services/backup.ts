import { db } from '../storage/db';
import { settingsRepo } from '../storage/repositories';
import { exportAll, importAll, parseImport } from './importExport';
import type { Settings, SyncSettings } from '../domain/types';

/**
 * 备份与同步引擎（本地优先的双保险）：
 *   1) 落盘备份 —— File System Access API，把 JSON 写进你指定的本地文件夹，
 *      主文件 + history/ 每日快照，浏览器数据被清也不怕。
 *   2) 服务器快照 —— 把整库 JSON PUT 到你自己的服务器，启动时比对拉取，
 *      last-write-wins（单设备场景足够；多设备需要 oplog，暂不做）。
 *
 * 触发时机：任意数据写入（Dexie storagemutated 事件）→ 防抖 3s → 落盘 + 推送。
 * 绝不自动覆盖本地：拉取只在远端 updatedAt 更新时执行，且先写一份本地快照。
 */

const META_DIR = 'backupDir';
const SNAPSHOT_FILE = 'semester-os.json';

// ── 工具 ─────────────────────────────────────────────────────────────

export function supportsFileBackup(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function ensureDeviceId(): Promise<string | null> {
  const current = (await db.settings.get('app'))?.sync;
  if (current?.deviceId) return current.deviceId;
  const id = `dev-${Math.random().toString(36).slice(2, 8)}`;
  await settingsRepo.patchSync({ deviceId: id });
  return id;
}

interface DirHandleLike {
  name: string;
  queryPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: 'readwrite' }) => Promise<PermissionState>;
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FileHandleLike>;
  getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<DirHandleLike>;
}

interface FileHandleLike {
  createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
}

// ── 落盘备份 ─────────────────────────────────────────────────────────

export async function pickBackupDir(): Promise<string> {
  const picker = (window as unknown as {
    showDirectoryPicker: (opts?: { mode?: 'readwrite' }) => Promise<DirHandleLike>;
  }).showDirectoryPicker;
  const handle = await picker({ mode: 'readwrite' });
  await db.meta.put({ key: META_DIR, value: handle });
  return handle.name;
}

export async function backupDirName(): Promise<string | null> {
  const row = await db.meta.get(META_DIR);
  return (row?.value as DirHandleLike | undefined)?.name ?? null;
}

export async function clearBackupDir(): Promise<void> {
  await db.meta.delete(META_DIR);
}

async function writableDir(): Promise<DirHandleLike | null> {
  const row = await db.meta.get(META_DIR);
  const handle = row?.value as DirHandleLike | undefined;
  if (!handle) return null;
  const opts = { mode: 'readwrite' as const };
  const state = (await handle.queryPermission?.(opts)) ?? 'granted';
  if (state === 'granted') return handle;
  const asked = (await handle.requestPermission?.(opts)) ?? 'denied';
  return asked === 'granted' ? handle : null;
}

/** 写一份快照：主文件 + history/YYYY-MM-DD.json（同日覆盖，跨天留档）。 */
export async function writeBackupFile(json?: string): Promise<{ dir: string; file: string } | null> {
  const dir = await writableDir();
  if (!dir) return null;
  const payload = json ?? (await exportAll());

  const main = await dir.getFileHandle(SNAPSHOT_FILE, { create: true });
  const mainWritable = await main.createWritable();
  await mainWritable.write(payload);
  await mainWritable.close();

  const history = await dir.getDirectoryHandle('history', { create: true });
  const day = new Date().toISOString().slice(0, 10);
  const daily = await history.getFileHandle(`${day}.json`, { create: true });
  const dailyWritable = await daily.createWritable();
  await dailyWritable.write(payload);
  await dailyWritable.close();

  await db.meta.put({ key: 'lastBackupAt', value: new Date().toISOString() });
  return { dir: dir.name, file: `${SNAPSHOT_FILE} + history/${day}.json` };
}

/** 本机文件夹备份（走开发服务器的同源端点，无需浏览器授权）。 */
export const LOCAL_BACKUP_ENDPOINT = '/api-local-backup';

export async function localBackupDir(): Promise<string | null> {
  try {
    const res = await fetch(LOCAL_BACKUP_ENDPOINT);
    if (!res.ok) return null;
    const data = (await res.json()) as { dir?: string };
    return data.dir ?? null;
  } catch {
    return null;
  }
}

/**
 * 把整库 JSON 写到本机文件夹；返回落盘位置。
 * 空数据保护：若"用户产出"相对上次骤降（浏览器被清空的典型特征），
 * 仍写入 history（留档可回溯），但不动主文件，避免主文件被空数据覆盖。
 */
export async function writeLocalBackup(
  json?: string,
): Promise<{ dir: string; file: string; guarded?: boolean } | null> {
  try {
    const payload = json ?? (await exportAll());
    const parsed = JSON.parse(payload) as { data?: unknown };
    const summary = summarize(parsed.data);
    const prev = await lastPushMeta();
    const before = prev ? userDataCount(prev.summary) : 0;
    const now = userDataCount(summary);
    const guarded = before >= 5 && now <= Math.max(1, Math.floor(before * 0.2));

    const res = await fetch(LOCAL_BACKUP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(guarded ? { 'X-Backup-Guarded': 'true' } : {}),
      },
      body: payload,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { dir: string; file: string };
    await db.meta.put({ key: 'lastBackupAt', value: new Date().toISOString() });
    return { ...data, guarded };
  } catch {
    return null;
  }
}

export async function lastBackupAt(): Promise<string | null> {
  const row = await db.meta.get('lastBackupAt');
  return (row?.value as string | undefined) ?? null;
}

// ── 服务器同步 ───────────────────────────────────────────────────────

export interface SnapshotPayload {
  schemaVersion: number;
  deviceId?: string;
  updatedAt: string;
  data: unknown;
}

/** 合并库内配置与调用方传入的字段（避免局部对象覆盖掉 autoBackup/deviceId 等）。 */
async function mergedSync(sync?: SyncSettings): Promise<SyncSettings> {
  const stored = (await db.settings.get('app'))?.sync ?? {};
  return { ...stored, ...sync };
}

async function syncHeaders(sync?: SyncSettings): Promise<HeadersInit> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sync?.token) headers.Authorization = `Bearer ${sync.token}`;
  return headers;
}

function requireUrl(sync?: SyncSettings): string {
  const url = sync?.url?.replace(/\/+$/, '');
  if (!url) throw new Error('未配置同步服务器地址');
  return url;
}

export async function buildPayload(settings?: Settings): Promise<SnapshotPayload> {
  const bundle = JSON.parse(await exportAll()) as { schemaVersion: number; data: unknown };
  return {
    schemaVersion: bundle.schemaVersion,
    deviceId: settings?.sync?.deviceId,
    updatedAt: new Date().toISOString(),
    data: bundle.data,
  };
}

// ── 安全护栏：防止"空状态覆盖好数据" ─────────────────────────────────

interface DataSummary {
  tasks: number;
  blocks: number;
  outcomes: number;
  reviews: number;
  milestones: number;
  courses: number;
}

/** 统计各类记录数，用于判断快照是否"可疑地变空"。 */
export function summarize(data: unknown): DataSummary {
  const d = (data ?? {}) as Record<string, unknown[]>;
  const n = (k: string) => (Array.isArray(d[k]) ? d[k].length : 0);
  return {
    tasks: n('tasks'),
    blocks: n('blocks'),
    outcomes: n('weeklyOutcomes'),
    reviews: n('reviews'),
    milestones: n('milestones'),
    courses: n('courses'),
  };
}

/** 用户产出（任务/块/成果/复盘）总量 —— 课程与项目属于内置骨架，不计入。 */
function userDataCount(s: DataSummary): number {
  return s.tasks + s.blocks + s.outcomes + s.reviews;
}

export function checksumForTest(obj: unknown): string {
  return checksum(obj);
}

function checksum(obj: unknown): string {
  const str = JSON.stringify(obj);
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0;
  return `${str.length}:${h}`;
}

interface LastPushMeta {
  checksum: string;
  summary: DataSummary;
  at: string;
}

export async function lastPushMeta(): Promise<LastPushMeta | null> {
  const row = await db.meta.get('lastPush');
  return (row?.value as LastPushMeta | undefined) ?? null;
}

export interface PushOutcome {
  status: 'pushed' | 'skipped-unchanged' | 'blocked-empty' | 'skipped-server-newer';
  updatedAt?: string;
  detail?: string;
}

/**
 * 推送整库快照到自建服务器。
 * - 内容与上次推送完全一致 → 跳过（去重，避免无意义流量）
 * - 自动推送时若"用户产出"骤降到接近 0（浏览器被清空/误重置的典型特征）→ 拒绝，
 *   避免用空数据覆盖服务器上的好数据。手动推送可加 { manual: true } 强制。
 * - 多设备护栏：自动推送前先看一眼服务器 —— 若别的设备在我们上次同步之后
 *   推送过（服务器 updatedAt 比本地 lastSyncedAt 新），跳过本次自动推送，
 *   先「从服务器恢复」再继续，避免落后设备用旧数据覆盖新数据。
 */
export async function pushSnapshot(
  sync: SyncSettings,
  settings?: Settings,
  opts?: { manual?: boolean },
): Promise<PushOutcome> {
  const url = requireUrl(sync);
  const payload = await buildPayload(settings);
  const summary = summarize(payload.data);
  const sum = checksum(payload.data);
  const prev = await lastPushMeta();

  if (prev && prev.checksum === sum) {
    return { status: 'skipped-unchanged', detail: '内容与上次推送一致' };
  }

  const before = prev ? userDataCount(prev.summary) : 0;
  const now = userDataCount(summary);
  if (!opts?.manual && before >= 5 && now <= Math.max(1, Math.floor(before * 0.2))) {
    return {
      status: 'blocked-empty',
      detail: `检测到数据量从 ${before} 条骤降到 ${now} 条，已拒绝自动推送以免覆盖服务器上的好数据。若确实是你要的状态，请在设置里点「立即推送」强制一次。`,
    };
  }

  // 多设备护栏（手动推送 = 用户明确要覆盖，不拦）
  if (!opts?.manual) {
    const guard = await serverNewerThanUs(url, sync);
    if (guard.serverNewer) {
      return {
        status: 'skipped-server-newer',
        updatedAt: guard.remoteUpdatedAt,
        detail: `服务器上有更新的快照（${guard.remoteUpdatedAt}），已跳过自动推送。请先在设置里「从服务器恢复」拿到最新数据，再继续编辑。`,
      };
    }
  }

  const res = await fetch(`${url}/snapshot`, {
    method: 'PUT',
    headers: await syncHeaders(sync),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`推送失败（${res.status}）`);
  await settingsRepo.patchSync({ lastSyncedAt: payload.updatedAt });
  await db.meta.put({
    key: 'lastPush',
    value: { checksum: sum, summary, at: payload.updatedAt } satisfies LastPushMeta,
  });
  return { status: 'pushed', updatedAt: payload.updatedAt };
}

/** 服务器快照是否比本机"上次同步点"更新（其他设备推过的信号）。探测失败不算新。 */
async function serverNewerThanUs(
  url: string,
  sync: SyncSettings,
): Promise<{ serverNewer: boolean; remoteUpdatedAt?: string }> {
  try {
    const res = await fetch(`${url}/snapshot`, { headers: await syncHeaders(sync) });
    if (res.status === 404) return { serverNewer: false }; // 服务器还没有快照
    if (!res.ok) return { serverNewer: false }; // 让后续 PUT 自己报错
    const remote = (await res.json()) as SnapshotPayload;
    const localAt = (await mergedSync(sync)).lastSyncedAt;
    const SKEW_MS = 2000; // 容忍设备间毫秒级时钟差
    const serverNewer =
      !localAt || new Date(remote.updatedAt).getTime() > new Date(localAt).getTime() + SKEW_MS;
    return { serverNewer, remoteUpdatedAt: remote.updatedAt };
  } catch {
    return { serverNewer: false };
  }
}



export interface PullReport {
  applied: boolean;
  remoteUpdatedAt?: string;
  reason?: string;
}

/**
 * 从服务器拉取快照。仅当远端比本地新时导入（避免覆盖本地新改动）。
 * 导入前会把当前本地内容写进一份 history 快照（若已配置落盘目录）。
 */
export async function pullSnapshot(sync: SyncSettings, opts?: { force?: boolean }): Promise<PullReport> {
  const url = requireUrl(sync);
  const res = await fetch(`${url}/snapshot`, { headers: await syncHeaders(sync) });
  if (res.status === 404) return { applied: false, reason: '服务器上还没有快照' };
  if (!res.ok) throw new Error(`拉取失败（${res.status}）`);
  const remote = (await res.json()) as SnapshotPayload;
  const cfg = await mergedSync(sync);

  const local = cfg.lastSyncedAt;
  const remoteNewer =
    opts?.force || !local || new Date(remote.updatedAt).getTime() > new Date(local).getTime();
  if (!remoteNewer) {
    return { applied: false, remoteUpdatedAt: remote.updatedAt, reason: '本地已是最新' };
  }

  // 覆盖前先落一份本地快照（双保险）
  await writeBackupFile().catch(() => null);

  const bundle = parseImport(
    JSON.stringify({
      schemaVersion: remote.schemaVersion,
      exportedAt: remote.updatedAt,
      data: remote.data,
    }),
  );
  await importAll(bundle);
  await settingsRepo.patchSync({ lastSyncedAt: remote.updatedAt });
  // 恢复后立即武装 lastPush 基线（按恢复后的库内容算校验和，lastSyncedAt 已含其中）：
  // 一来紧随其后的自动推送会被去重跳过，二来"恢复完突然清空"也立刻受空数据护栏保护。
  const restored = JSON.parse(await exportAll()) as { data: unknown };
  await db.meta.put({
    key: 'lastPush',
    value: {
      checksum: checksum(restored.data),
      summary: summarize(restored.data),
      at: remote.updatedAt,
    } satisfies LastPushMeta,
  });
  return { applied: true, remoteUpdatedAt: remote.updatedAt };
}

/**
 * 新设备自动恢复：地址已配置、本机从没同步过、本地没有任何用户产出，
 * 而服务器上有带数据的快照 → 直接拉取，让新设备打开就是完整数据。
 * 本地已有任何编辑时不做任何事（绝不覆盖本地产出）。
 */
export async function maybeAutoRestore(sync: SyncSettings): Promise<boolean> {
  const url = sync.url?.replace(/\/+$/, '');
  if (!url) return false;
  const cfg = await mergedSync(sync);
  if (cfg.lastSyncedAt) return false; // 同步过就交给手动恢复/自动推送
  const localSummary = summarize(JSON.parse(await exportAll()).data);
  if (userDataCount(localSummary) > 0) return false;
  try {
    const res = await fetch(`${url}/snapshot`, { headers: await syncHeaders(sync) });
    if (res.status === 404) return false;
    if (!res.ok) return false;
    const remote = (await res.json()) as SnapshotPayload;
    if (userDataCount(summarize(remote.data)) === 0) return false;
    const report = await pullSnapshot(sync);
    return report.applied;
  } catch {
    return false;
  }
}

/** 连通性探测：能读到快照或返回 404 都算通。 */
export async function probeServer(sync: SyncSettings): Promise<'ok' | 'unreachable'> {
  const r = await probeServerDetail(sync);
  return r.ok ? 'ok' : 'unreachable';
}

export interface ProbeDetail {
  ok: boolean;
  /** 给人看的具体原因（而不是笼统的"无法连接"） */
  detail: string;
}

/** 带原因的探测：地址为空 / 令牌被拒 / HTTP 状态 / 网络错误 分别说明。 */
export async function probeServerDetail(sync: SyncSettings): Promise<ProbeDetail> {
  const url = sync.url?.replace(/\/+$/, '');
  if (!url) return { ok: false, detail: '还没有填写服务器地址' };
  try {
    const res = await fetch(`${url}/snapshot`, { headers: await syncHeaders(sync) });
    if (res.ok) return { ok: true, detail: `连接正常 · 服务器已有快照（${url}）` };
    if (res.status === 404) return { ok: true, detail: `连接正常 · 服务器暂无快照（${url}）` };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, detail: `令牌被服务器拒绝（HTTP ${res.status}）` };
    }
    return { ok: false, detail: `服务器返回 HTTP ${res.status}` };
  } catch (e) {
    return {
      ok: false,
      detail: `请求没通：${(e as Error).message} · 检查地址端口、两台设备是否同一网络，以及服务器防火墙是否放行来源网段`,
    };
  }
}
