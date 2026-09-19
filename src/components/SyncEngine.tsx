import { useEffect, useRef } from 'react';
import Dexie from 'dexie';
import { db } from '../storage/db';
import { useApp } from './AppProvider';
import { ensureDeviceId, maybeAutoRestore, pushSnapshot, writeBackupFile, writeLocalBackup } from '../services/backup';
import { useToast } from '../store/uiStore';

const DEBOUNCE_MS = 15_000;   // 停止编辑 15 秒后保存
const MAX_WAIT_MS = 60_000;    // 持续编辑时，最长 60 秒必存一次

/**
 * 备份/同步引擎：监听数据库变更（Dexie storagemutated），防抖后
 * 落盘备份 + 推送服务器。挂在 Layout 上，全局生效。
 * 不改变任何业务数据，只读库 + 外部写文件/HTTP。
 */
export function SyncEngine() {
  const { settings } = useApp();
  const show = useToast((s) => s.show);
  const timer = useRef<number | null>(null);
  const warnedRef = useRef(false);
  const serverWarnedRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // 保证有设备标识
  useEffect(() => {
    if (settings && !settings.sync?.deviceId) void ensureDeviceId();
  }, [settings?.sync?.deviceId, settings]);

  // 新设备开箱即用：地址已配置 + 本机没有用户数据 + 服务器有数据 → 静默恢复一次。
  // 依赖 url 而不是空数组：首次挂载时 settings 往往还没从 IndexedDB 读出来，
  // 等它加载完成（url 出现）后再跑。maybeAutoRestore 自带幂等护栏。
  const syncUrl = settings?.sync?.url;
  useEffect(() => {
    const sync = settingsRef.current?.sync;
    if (!sync?.url) return;
    let cancelled = false;
    void (async () => {
      try {
        if (!db.isOpen()) await db.open();
        const applied = await maybeAutoRestore(sync);
        if (applied && !cancelled) show('已从服务器恢复最新数据');
      } catch {
        /* 静默失败：仍可手动「从服务器恢复」 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [syncUrl, show]);

  // 变更 → 防抖 → 双通道保存（带最长等待，避免长时间不落盘）
  useEffect(() => {
    let firstChangeAt = 0;
    const run = async () => {
      const sync = settingsRef.current?.sync;
      if (!sync) return;
      try {
        if (sync.autoBackup) {
          const local = await writeLocalBackup();
          if (!local) {
            const r = await writeBackupFile();
            if (!r) show('自动备份未生效：本机文件夹写入失败，且浏览器备份目录不可用', 'error');
          }
        }
        if (sync.autoSync && sync.url) {
          const r = await pushSnapshot(sync, settingsRef.current);
          if (r.status === 'blocked-empty') {
            // 空数据保护：只提醒一次，避免刷屏
            if (!warnedRef.current) {
              warnedRef.current = true;
              show(r.detail ?? '已跳过自动推送', 'error');
            }
          } else if (r.status === 'skipped-server-newer') {
            // 多设备保护：别的设备刚推过 → 提示先恢复，只提醒一次
            if (!serverWarnedRef.current) {
              serverWarnedRef.current = true;
              show(r.detail ?? '服务器上有更新的数据，已跳过自动推送', 'error');
            }
          }
        }
      } catch (e) {
        show(`自动同步失败：${(e as Error).message}`, 'error');
      }
    };

    const schedule = () => {
      const sync = settingsRef.current?.sync;
      if (!sync?.autoBackup && !sync?.autoSync) return;
      const now = Date.now();
      if (firstChangeAt === 0) firstChangeAt = now;
      if (timer.current != null) clearTimeout(timer.current);
      // 距首次变更已超过上限 → 立刻保存；否则按防抖延后
      const delay = now - firstChangeAt >= MAX_WAIT_MS ? 0 : DEBOUNCE_MS;
      timer.current = window.setTimeout(() => {
        timer.current = null;
        firstChangeAt = 0;
        void run();
      }, delay);
    };

    const flushNow = () => {
      if (timer.current == null) return;
      clearTimeout(timer.current);
      timer.current = null;
      void run();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };

    let unsubscribe: (() => void) | undefined;
    const attach = async () => {
      try {
        if (!db.isOpen()) await db.open();
        // Dexie 4：storagemutated 是全局事件，任意写入（含其他标签页）都会触发
        const off = (
          Dexie as unknown as { on: (ev: string, cb: () => void) => unknown }
        ).on('storagemutated', schedule);
        if (typeof off === 'function') unsubscribe = off as () => void;
      } catch {
        unsubscribe = undefined;
      }
    };
    void attach();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer.current != null) clearTimeout(timer.current);
      try {
        unsubscribe?.();
      } catch {
        /* 忽略 */
      }
    };
  }, [show]);

  return null;
}
