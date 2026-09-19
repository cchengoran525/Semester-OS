import { useEffect, useRef, useState } from 'react';
import { useApp } from '../components/AppProvider';
import { db } from '../storage/db';
import { SEED_PROJECT_NAMES, seedIfFirstLaunch } from '../storage/seed';
import * as repos from '../storage/repositories';
import { useToast } from '../store/uiStore';
import type { ScheduleOverride, Settings } from '../domain/types';
import { downloadJSON, exportAll, ImportError, importAll, parseImport } from '../services/importExport';
import { plankaConfig, type PlankaConfig } from '../services/planka/config';
import { PlankaClient, type ProbeResult } from '../services/planka/client';
import { pullCardsAsTasks, pushTaskAsCard } from '../services/planka/sync';
import { aiConfig, deepAIConfig, normalizeBaseUrl } from '../services/ai/config';
import { probe, type AIProbeResult } from '../services/ai/client';
import {
  backupDirName,
  lastBackupAt,
  localBackupDir,
  pickBackupDir,
  probeServerDetail,
  writeLocalBackup,
  pullSnapshot,
  pushSnapshot,
  supportsFileBackup,
  writeBackupFile,
} from '../services/backup';

const PROBE_LABEL: Record<ProbeResult, string> = {
  ok: '已连接，令牌有效',
  reachable: '服务可达，但令牌或 Board ID 配置有误',
  unreachable: '无法连接（检查 URL 或网络）',
};

const AI_PROBE_LABEL: Record<AIProbeResult, string> = {
  ok: '已连接，配置有效',
  reachable: '服务可达，但 API Key 或模型名有误',
  unreachable: '无法连接（检查地址或网络）',
};

interface AIForm {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface DeepForm {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

const EMPTY_DEEP: DeepForm = { baseUrl: '', apiKey: '', model: '' };

const deepFormOf = (ai: Settings['ai']): DeepForm => ai?.deep ?? EMPTY_DEEP;

/** 默认接入智谱 GLM：地址 / 模型名有内置默认值（输入框留空时回车写入），Key 必填。 */
const ZHIPU_DEFAULTS = {
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  model: 'glm-5.3-flash',
};

export function SettingsPage() {
  const { settings, tasks } = useApp();
  const show = useToast((s) => s.show);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<ReturnType<typeof parseImport> | null>(null);
  const [plankaStatus, setPlankaStatus] = useState<ProbeResult | 'testing' | null>(null);
  const [aiForm, setAiForm] = useState<AIForm>(() => settings?.ai ?? { baseUrl: '', apiKey: '', model: '' });
  const [aiStatus, setAiStatus] = useState<AIProbeResult | 'testing' | null>(null);
  const [deepForm, setDeepForm] = useState<DeepForm>(() => deepFormOf(settings?.ai));
  const [contextForm, setContextForm] = useState<string>(() => settings?.ai?.context ?? '');
  const [deepStatus, setDeepStatus] = useState<AIProbeResult | 'testing' | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupDir, setBackupDir] = useState<string | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncDetail, setSyncDetail] = useState<string | null>(null);
  const supported = supportsFileBackup();
  const [showFileBackup, setShowFileBackup] = useState(false);
  const [localDir, setLocalDir] = useState<string | null>(null);
  const planka: PlankaConfig | null = plankaConfig();

  useEffect(() => {
    void backupDirName().then(setBackupDir);
    void lastBackupAt().then(setLastBackup);
    void localBackupDir().then(setLocalDir);
  }, []);

  // settings 异步加载晚于首帧：AI 表单可能以空值初始化。若用户此后编辑任一字段，
  // 会把空表单整体写回、清掉已有配置（已真实发生过）。在"用户尚未编辑过"时，
  // 让表单跟随已加载的设置；一旦编辑过就以表单为准。
  const aiTouchedRef = useRef(false);
  const aiKey = settings?.ai ? JSON.stringify(settings.ai) : '';
  useEffect(() => {
    if (aiTouchedRef.current || !settings?.ai) return;
    setAiForm({
      baseUrl: settings.ai.baseUrl,
      apiKey: settings.ai.apiKey,
      model: settings.ai.model,
    });
    setDeepForm(deepFormOf(settings.ai));
    setContextForm(settings.ai.context ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiKey]);

  if (!settings) return null;

  const aiCfg = aiConfig({ ...settings, ai: aiForm });
  const deepCfg = deepAIConfig({ ...settings, ai: { ...aiForm, context: contextForm, deep: deepForm } });

  const set = (patch: Partial<Settings>) => repos.settingsRepo.save(patch);

  const doExport = async () => {
    const json = await exportAll();
    downloadJSON(`semester-os-${new Date().toISOString().slice(0, 10)}.json`, json);
    show('已导出 JSON');
  };

  const onFile = async (file: File) => {
    try {
      const text = await file.text();
      const bundle = parseImport(text);
      setPendingImport(bundle);
    } catch (e) {
      show(e instanceof ImportError ? e.message : '导入失败：文件无法读取', 'error');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>设置</h1>
      </div>

      <section className="panel" style={{ marginBottom: 14, maxWidth: 560 }}>
        <h2>学期</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field">
            <span>学期开始</span>
            <input
              type="date"
              value={settings.semesterStart}
              onChange={(e) => set({ semesterStart: e.target.value })}
            />
          </label>
          <label className="field">
            <span>学期结束</span>
            <input
              type="date"
              value={settings.semesterEnd}
              onChange={(e) => set({ semesterEnd: e.target.value })}
            />
          </label>
        </div>
        <div className="small faint">
          当前教学周根据学期开始日期自动推算（用于单双周课程判断）。
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 14, maxWidth: 560 }}>
        <h2>偏好设置</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field">
            <span>每周起始日</span>
            <select
              value={settings.weekStartDay}
              onChange={(e) => set({ weekStartDay: Number(e.target.value) as 0 | 1 })}
            >
              <option value={1}>周一</option>
              <option value={0}>周日</option>
            </select>
          </label>
          <label className="field">
            <span>WIP 上限</span>
            <input
              type="number"
              min={1}
              max={10}
              value={settings.wipLimit}
              onChange={(e) => set({ wipLimit: Math.max(1, Number(e.target.value) || 1) })}
            />
          </label>
          <label className="field">
            <span>默认任务预估（分钟）</span>
            <input
              type="number"
              min={15}
              step={15}
              value={settings.defaultTaskEstimate}
              onChange={(e) => set({ defaultTaskEstimate: Number(e.target.value) || 60 })}
            />
          </label>
          <label className="field">
            <span>主题</span>
            <select value={settings.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}>
              <option value="DARK">深色</option>
              <option value="LIGHT">浅色</option>
              <option value="SYSTEM">跟随系统</option>
            </select>
          </label>
          <label className="field">
            <span>字体大小</span>
            <select
              value={String(settings.fontScale ?? 1)}
              onChange={(e) => set({ fontScale: Number(e.target.value) })}
            >
              <option value="0.8">特小</option>
              <option value="0.85">小</option>
              <option value="1">标准</option>
              <option value="1.1">大</option>
              <option value="1.25">特大</option>
            </select>
          </label>
        </div>
        <div className="small faint">侧栏也有明暗快捷切换；字体大小即时生效。</div>
      </section>

      <section className="panel" style={{ marginBottom: 14, maxWidth: 560 }}>
        <h2>备份与同步</h2>
        <div className="small faint" style={{ marginBottom: 10 }}>
          数据在浏览器 IndexedDB 里，清站点数据会一起没。两条保险可以同时开：
          ① 落盘备份——写进你选的本地文件夹（主文件 + history/ 每日快照）；
          ② 服务器同步——整库快照推到你自己的服务器，启动时比对拉取。
          自动模式：改完 15 秒内保存（最长 60 秒必存一次，离开页面立即补存）。
          自动推送带空数据保护——数据量骤降时会拒绝推送并提醒，防止误清空覆盖好数据。
        </div>

        {/* ① 本机文件夹备份：由本机开发服务器直接写盘，无需浏览器授权 */}
        <div style={{ marginTop: 10, borderTop: '1px dashed var(--border)', paddingTop: 10 }}>
          <strong className="small">本机文件夹备份</strong>
          <div className="small faint" style={{ margin: '4px 0 8px' }}>
            把 JSON 写进你 Mac 上的文件夹（主文件 + history/ 每日留档，保留最近 100 份），
            经本机开发服务器落盘，不依赖浏览器授权，清浏览器数据也不受影响。
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mono small faint">{localDir ? localDir : '未检测到本机备份端点（开发服务器需重启）'}</span>
            <button
              className="btn small primary"
              disabled={!localDir}
              onClick={async () => {
                const r = await writeLocalBackup();
                show(
                  r ? `已备份到 ${r.dir}` : '本机备份失败：端点不可用（确认开发服务器已重启）',
                  r ? 'info' : 'error',
                );
                setLastBackup(await lastBackupAt());
              }}
            >
              立即备份到本机
            </button>
            <label className="small" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={settings.sync?.autoBackup ?? false}
                onChange={(e) => repos.settingsRepo.patchSync({ autoBackup: e.target.checked })}
              />
              数据变更后自动备份
            </label>
          </div>
          <div className="faint small" style={{ marginTop: 4 }}>
            {lastBackup ? `最近一次备份：${lastBackup.slice(0, 19).replace('T', ' ')}` : '还没有备份记录'}
          </div>

          {/* 浏览器授权式备份（部署到别处时用） */}
          <div style={{ marginTop: 8 }}>
            <button className="btn small subtle" onClick={() => setShowFileBackup(!showFileBackup)}>
              {showFileBackup ? '收起：浏览器文件夹备份' : '▸ 浏览器文件夹备份（部署到其它环境时用）'}
            </button>
            {showFileBackup && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {!supported && <span className="tag">当前浏览器不支持（需 Chrome/Edge）</span>}
                  {supported && (
                    <>
                      <button
                        className="btn small"
                        onClick={async () => {
                          try {
                            const name = await pickBackupDir();
                            setBackupDir(name);
                            show(`备份文件夹：${name}`);
                          } catch (e) {
                            if ((e as Error).name !== 'AbortError') show('选择文件夹失败', 'error');
                          }
                        }}
                      >
                        {backupDir ? `更换文件夹（当前：${backupDir}）` : '选择备份文件夹'}
                      </button>
                      <button
                        className="btn small"
                        disabled={!backupDir}
                        onClick={async () => {
                          const r = await writeBackupFile();
                          show(r ? `已备份到 ${r.dir}` : '备份失败：文件夹不可用', r ? 'info' : 'error');
                          setLastBackup(await lastBackupAt());
                        }}
                      >
                        立即备份
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ② 服务器同步 */}
        <div style={{ marginTop: 14 }}>
          <strong className="small">服务器同步</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginTop: 6 }}>
            <label className="field">
              <span>服务器地址</span>
              <input
                value={settings.sync?.url ?? ''}
                placeholder="如 http://192.168.1.10:8787"
                onChange={(e) => repos.settingsRepo.patchSync({ url: e.target.value.trim() })}
              />
            </label>
            <label className="field">
              <span>令牌（可选，与服务器端约定）</span>
              <input
                type="password"
                value={settings.sync?.token ?? ''}
                placeholder="Bearer token"
                onChange={(e) => repos.settingsRepo.patchSync({ token: e.target.value })}
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
            <button
              className="btn small subtle"
              onClick={async () => {
                // 快捷地址不在源码里硬编码：从构建期环境变量读取（见 .env.example）
                const env = import.meta.env as Record<string, string | undefined>;
                await repos.settingsRepo.patchSync({
                  url: '/api',
                  ...(env.VITE_SYNC_TOKEN ? { token: env.VITE_SYNC_TOKEN } : {}),
                });
                show('已切换为该本机代理（浏览器不会拦）');
              }}
            >
              用开发服务器代理（推荐）
            </button>
            {(import.meta.env as Record<string, string | undefined>).VITE_SYNC_DIRECT_URL && (
              <button
                className="btn small subtle"
                onClick={async () => {
                  const env = import.meta.env as Record<string, string | undefined>;
                  await repos.settingsRepo.patchSync({
                    url: env.VITE_SYNC_DIRECT_URL ?? '',
                    ...(env.VITE_SYNC_TOKEN ? { token: env.VITE_SYNC_TOKEN } : {}),
                  });
                  show('已填入直连地址（如被浏览器拦截，改用代理）');
                }}
              >
                直连局域网服务器
              </button>
            )}
            <button
              className="btn small"
              disabled={!settings.sync?.url || syncBusy}
              onClick={async () => {
                setSyncBusy(true);
                try {
                  const r = await probeServerDetail({ ...(settings.sync ?? {}) });
                  setSyncDetail(r.detail);
                  show(r.detail, r.ok ? 'info' : 'error');
                } finally {
                  setSyncBusy(false);
                }
              }}
            >
              测试连接
            </button>
            <button
              className="btn small primary"
              disabled={!settings.sync?.url || syncBusy}
              onClick={async () => {
                setSyncBusy(true);
                try {
                  const r = await pushSnapshot({ ...(settings.sync ?? {}) }, settings, { manual: true });
                  show(
                    r.status === 'pushed'
                      ? `已推送快照（${(r.updatedAt ?? '').slice(0, 19).replace('T', ' ')}）`
                      : r.status === 'skipped-unchanged'
                        ? '内容与上次一致，无需推送'
                        : (r.detail ?? '已跳过'),
                  );
                } catch (e) {
                  show(`推送失败：${(e as Error).message}`, 'error');
                } finally {
                  setSyncBusy(false);
                }
              }}
            >
              立即推送
            </button>
            <button
              className="btn small"
              disabled={!settings.sync?.url || syncBusy}
              onClick={async () => {
                setSyncBusy(true);
                try {
                  const r = await pullSnapshot({ ...(settings.sync ?? {}) });
                  show(r.applied ? '已从服务器恢复' : r.reason ?? '无需拉取');
                } catch (e) {
                  show(`拉取失败：${(e as Error).message}`, 'error');
                } finally {
                  setSyncBusy(false);
                }
              }}
            >
              从服务器恢复
            </button>
            <label className="small" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={settings.sync?.autoSync ?? false}
                onChange={(e) => repos.settingsRepo.patchSync({ autoSync: e.target.checked })}
              />
              数据变更后自动推送
            </label>
            {syncDetail && <span className="tag">{syncDetail}</span>}
          </div>
          <div className="faint small" style={{ marginTop: 6 }}>
            {settings.sync?.lastSyncedAt
              ? `最近同步：${settings.sync.lastSyncedAt.slice(0, 19).replace('T', ' ')}`
              : '还没有同步记录'}
            {' · '}
            参考服务端脚本见项目里的 <span className="mono">server/snapshot-server.mjs</span>
          </div>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 14, maxWidth: 560 }}>
        <h2>调休与假期</h2>
        <div className="small faint" style={{ marginBottom: 8 }}>
          放假 = 当天无课；调休 = 当天按指定星期几的课表上课（可限定单/双周口径）。日历上会标「休」「调」。
        </div>
        {(settings.scheduleOverrides ?? []).length === 0 && (
          <div className="faint small">还没有例外日。</div>
        )}
        {(settings.scheduleOverrides ?? [])
          .slice()
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((o) => (
            <div key={o.date} className="modal-task-row small">
              <span className="mono" style={{ width: 96 }}>{o.date}</span>
              <span className="modal-task-title">
                {o.off ? '放假' : `上周${'一二三四五六日'[(o.weekday ?? 1) - 1]}的课`}
                {o.recurrence === 'ODD_WEEK' ? '（单周）' : o.recurrence === 'EVEN_WEEK' ? '（双周）' : ''}
                {o.label && !o.off ? ` · ${o.label}` : ''}
              </span>
              <button
                className="btn small subtle"
                onClick={() =>
                  set({
                    scheduleOverrides: (settings.scheduleOverrides ?? []).filter((x) => x.date !== o.date),
                  })
                }
              >
                删除
              </button>
            </div>
          ))}
        <OverrideAdder
          onAdd={(ov) =>
            set({
              scheduleOverrides: [
                ...(settings.scheduleOverrides ?? []).filter((x) => x.date !== ov.date),
                ov,
              ],
            })
          }
        />
      </section>

      <section className="panel" style={{ marginBottom: 14, maxWidth: 560 }}>
        <h2>数据</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={doExport}>
            导出 JSON
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            导入 JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = '';
            }}
          />
        </div>
        <div className="small faint" style={{ marginTop: 8 }}>
          数据保存在本地浏览器 IndexedDB。Import 会覆盖现有数据，导入前会校验 schema。
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn small subtle"
            onClick={async () => {
              if (
                !window.confirm(
                  '清理内置演示数据？将删除：示例任务（t1–t5）、示例本周成果、内置里程碑、内置项目描述。你自己创建的内容不受影响。',
                )
              )
                return;
              const isDemoTask = (id: string) => /^t\d+$/.test(id);
              const isDemoOutcome = (id: string) => /^wo\d+$/.test(id);
              const isDemoMilestone = (id: string) => /^p\d+m\d+$/.test(id);
              const tasks = await db.tasks.toArray();
              await db.tasks.bulkDelete(tasks.filter((t) => isDemoTask(t.id)).map((t) => t.id));
              const outs = await db.weeklyOutcomes.toArray();
              await db.weeklyOutcomes.bulkDelete(outs.filter((o) => isDemoOutcome(o.id)).map((o) => o.id));
              const mss = await db.milestones.toArray();
              await db.milestones.bulkDelete(mss.filter((m) => isDemoMilestone(m.id)).map((m) => m.id));
              const projects = await db.projects.toArray();
              for (const p of projects.filter((x) => SEED_PROJECT_NAMES.includes(x.name))) {
                await db.projects.put({
                  ...p,
                  description: undefined,
                  notes: undefined,
                  currentMilestoneId: undefined,
                });
              }
              show('演示数据已清理');
            }}
          >
            清理内置演示数据
          </button>
          <button
            className="btn small danger"
            onClick={async () => {
              if (!window.confirm('清空全部数据并重新初始化？将保留课程表和项目名称，清空任务/时间块/复盘/里程碑/项目描述。建议先导出备份。')) return;
              await Promise.all(db.tables.map((t) => t.clear()));
              await seedIfFirstLaunch();
              // 第一周全新体验：只留课程 + 项目名称 + 设置；
              // 项目的描述/里程碑/状态/优先级全部清空，任务与本周成果不保留
              await Promise.all([db.tasks.clear(), db.weeklyOutcomes.clear()]);
              const projects = await db.projects.toArray();
              for (const p of projects) {
                await db.projects.put({
                  ...p,
                  description: undefined,
                  notes: undefined,
                  currentMilestoneId: undefined,
                  status: 'BACKLOG',
                  priority: 'MEDIUM',
                });
              }
              const milestones = await db.milestones.toArray();
              await db.milestones.bulkDelete(milestones.map((m) => m.id));
              window.location.reload();
            }}
          >
            清空数据并重新初始化
          </button>
        </div>
        {pendingImport && (
          <div className="warning-banner" style={{ marginTop: 10 }}>
            <span style={{ flex: 1 }}>
              即将导入 {pendingImport.data.tasks.length} 个任务、{pendingImport.data.blocks.length} 个时间块，
              并覆盖现有全部数据。确定继续？
            </span>
            <button
              className="btn small"
              onClick={async () => {
                await importAll(pendingImport);
                setPendingImport(null);
                show('导入完成');
              }}
            >
              确认导入
            </button>
            <button className="btn small danger" onClick={() => setPendingImport(null)}>
              取消
            </button>
          </div>
        )}
      </section>

      <section className="panel" style={{ marginBottom: 14, maxWidth: 560 }}>
        <h2>AI 助手</h2>
        <div className="small muted" style={{ marginBottom: 4 }}>
          快速模型（简报 / 复盘起草 / 任务拆解）—— OpenAI 兼容接口：
          {!aiCfg && <span className="tag">未配置</span>}
          {aiCfg && aiStatus === 'testing' && <span className="tag">检测中…</span>}
          {aiCfg && aiStatus && aiStatus !== 'testing' && (
            <span className="tag">{AI_PROBE_LABEL[aiStatus]}</span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            <span>接口地址（Base URL）</span>
            <input
              value={aiForm.baseUrl}
              placeholder={`回车填入智谱默认 · ${ZHIPU_DEFAULTS.baseUrl}`}
              onChange={(e) => {
                aiTouchedRef.current = true;
                const baseUrl = e.target.value;
                setAiForm({ ...aiForm, baseUrl });
                set({ ai: { ...aiForm, context: contextForm, baseUrl: normalizeBaseUrl(baseUrl), deep: deepForm } });
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.key !== 'Enter' || aiForm.baseUrl.trim()) return;
                aiTouchedRef.current = true;
                const baseUrl = ZHIPU_DEFAULTS.baseUrl;
                setAiForm({ ...aiForm, baseUrl });
                set({ ai: { ...aiForm, context: contextForm, baseUrl, deep: deepForm } });
                (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
          <label className="field">
            <span>模型名</span>
            <input
              value={aiForm.model}
              placeholder={`回车填入默认 · ${ZHIPU_DEFAULTS.model}`}
              onChange={(e) => {
                aiTouchedRef.current = true;
                const model = e.target.value;
                setAiForm({ ...aiForm, model });
                set({ ai: { ...aiForm, context: contextForm, model, deep: deepForm } });
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || aiForm.model.trim()) return;
                aiTouchedRef.current = true;
                const model = ZHIPU_DEFAULTS.model;
                setAiForm({ ...aiForm, model });
                set({ ai: { ...aiForm, context: contextForm, model, deep: deepForm } });
                (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              value={aiForm.apiKey}
              placeholder="sk-…"
              onChange={(e) => {
                aiTouchedRef.current = true;
                const apiKey = e.target.value;
                setAiForm({ ...aiForm, apiKey });
                set({ ai: { ...aiForm, context: contextForm, apiKey, deep: deepForm } });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
        </div>
        <label className="field" style={{ marginTop: 10 }}>
          <span>个人长期背景（可选 · 注入所有 AI 请求）</span>
          <textarea
            rows={5}
            value={contextForm}
            placeholder="你是谁、在做什么项目、长期目标。例如：某大学计算机大二；在做一个课程大作业和一个开源项目；本学期想养成每天复习的习惯。AI 周计划会据此定焦点。"
            onChange={(e) => {
              aiTouchedRef.current = true;
              setContextForm(e.target.value);
              set({ ai: { ...aiForm, context: e.target.value, deep: deepForm } });
            }}
          />
        </label>
        <div className="small faint" style={{ marginTop: 8 }}>
          默认接入智谱 GLM：地址和模型名留空时按回车即可写入默认值，通常只需再填
          API Key。Key 与背景只保存在本地浏览器 IndexedDB，不进构建产物、不随
          导出 JSON 离开设备；仅在点击时把当次所需的摘要数据发给所填服务。
        </div>
        <div style={{ marginTop: 10 }}>
          <button
            className="btn small"
            disabled={!aiCfg || aiStatus === 'testing'}
            onClick={async () => {
              if (!aiCfg) return;
              setAiStatus('testing');
              setAiStatus(await probe(aiCfg));
            }}
          >
            测试连接
          </button>
        </div>

        <h2 style={{ marginTop: 18, fontSize: 15 }}>深度模型（可选 · 用于 AI 周计划）</h2>
        <div className="small muted" style={{ marginBottom: 10 }}>
          需要全局取舍的深度规划会走这里（思考档位更高，响应更慢）。
          留空的字段自动沿用快速模型 —— 比如同一个 Key 只换个更强的模型名：
          {deepCfg && deepCfg.model !== aiCfg?.model && deepStatus === 'testing' && (
            <span className="tag">检测中…</span>
          )}
          {deepCfg && deepCfg.model !== aiCfg?.model && deepStatus && deepStatus !== 'testing' && (
            <span className="tag">{AI_PROBE_LABEL[deepStatus]}</span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            <span>接口地址（留空沿用快速模型）</span>
            <input
              value={deepForm.baseUrl ?? ''}
              placeholder={aiCfg ? aiCfg.baseUrl : '默认与快速模型相同'}
              onChange={(e) => {
                aiTouchedRef.current = true;
                const baseUrl = e.target.value;
                setDeepForm({ ...deepForm, baseUrl });
                set({ ai: { ...aiForm, context: contextForm, deep: { ...deepForm, baseUrl: normalizeBaseUrl(baseUrl) } } });
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || (deepForm.baseUrl ?? '').trim()) return;
                aiTouchedRef.current = true;
                const baseUrl = ZHIPU_DEFAULTS.baseUrl;
                setDeepForm({ ...deepForm, baseUrl });
                set({ ai: { ...aiForm, context: contextForm, deep: { ...deepForm, baseUrl } } });
                (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
          <label className="field">
            <span>模型名</span>
            <input
              value={deepForm.model ?? ''}
              placeholder={aiCfg ? `默认 ${aiCfg.model}` : '默认与快速模型相同'}
              onChange={(e) => {
                aiTouchedRef.current = true;
                const model = e.target.value;
                setDeepForm({ ...deepForm, model });
                set({ ai: { ...aiForm, context: contextForm, deep: { ...deepForm, model } } });
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || (deepForm.model ?? '').trim()) return;
                aiTouchedRef.current = true;
                const model = aiForm.model.trim() || ZHIPU_DEFAULTS.model;
                setDeepForm({ ...deepForm, model });
                set({ ai: { ...aiForm, context: contextForm, deep: { ...deepForm, model } } });
                (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
          <label className="field">
            <span>API Key（留空沿用快速模型）</span>
            <input
              type="password"
              value={deepForm.apiKey ?? ''}
              placeholder="默认与快速模型相同"
              onChange={(e) => {
                aiTouchedRef.current = true;
                const apiKey = e.target.value;
                setDeepForm({ ...deepForm, apiKey });
                set({ ai: { ...aiForm, context: contextForm, deep: { ...deepForm, apiKey } } });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
        </div>
        <div style={{ marginTop: 10 }}>
          <button
            className="btn small"
            disabled={
              !deepCfg || deepCfg.model === aiCfg?.model || deepStatus === 'testing'
            }
            title={
              deepCfg && deepCfg.model === aiCfg?.model
                ? '深度模型与快速模型相同，无需单独测试'
                : undefined
            }
            onClick={async () => {
              if (!deepCfg) return;
              setDeepStatus('testing');
              setDeepStatus(await probe(deepCfg));
            }}
          >
            测试深度连接
          </button>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 14, maxWidth: 560 }}>
        <h2>集成</h2>
        <div className="small muted" style={{ marginBottom: 10 }}>
          Planka（执行层）：
          {!planka && <span className="tag">未配置</span>}
          {planka && plankaStatus === 'testing' && <span className="tag">检测中…</span>}
          {planka && plankaStatus && plankaStatus !== 'testing' && (
            <span className="tag">{PROBE_LABEL[plankaStatus]}</span>
          )}
        </div>
        {!planka ? (
          <div className="small faint">
            复制 <span className="mono">.env.example</span> 为 <span className="mono">.env</span>，
            填入 <span className="mono">VITE_PLANKA_URL</span> 和{' '}
            <span className="mono">VITE_PLANKA_TOKEN</span> 后重启开发服务器即可启用。
            不配置不影响任何功能。
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn small"
              disabled={busy}
              onClick={async () => {
                setPlankaStatus('testing');
                const result = await new PlankaClient(planka).probe();
                setPlankaStatus(result);
              }}
            >
              测试连接
            </button>
            <button
              className="btn small"
              disabled={busy || !planka.boardId}
              title={planka.boardId ? undefined : '需要在 .env 里配置 VITE_PLANKA_BOARD_ID'}
              onClick={async () => {
                setBusy(true);
                try {
                  const report = await pullCardsAsTasks(new PlankaClient(planka), tasks, (input) =>
                    repos.taskRepo.create({ ...input, priority: 'MEDIUM', estimateMinutes: settings.defaultTaskEstimate }),
                  );
                  show(`已从 Planka 导入 ${report.imported} 个任务（跳过 ${report.skipped} 个同名）`);
                } catch (e) {
                  show(`拉取失败：${(e as Error).message}`, 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              从 Planka 拉取卡片
            </button>
            <button
              className="btn small"
              disabled={busy || !planka.boardId}
              onClick={async () => {
                const open = tasks.filter((t) => t.status === 'READY' || t.status === 'DOING');
                if (open.length === 0) {
                  show('没有可推送的待办任务');
                  return;
                }
                if (!window.confirm(`把 ${open.length} 个待办任务推送到 Planka？`)) return;
                setBusy(true);
                try {
                  const client = new PlankaClient(planka);
                  for (const t of open) {
                    await pushTaskAsCard(client, t);
                  }
                  show(`已推送 ${open.length} 个任务到 Planka`);
                } catch (e) {
                  show(`推送失败：${(e as Error).message}`, 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              推送待办任务
            </button>
          </div>
        )}
      </section>
    </div>
  );
}


/** 调休/假期新增：日期 + 类型（放假 / 上周几的课）+ 单双周口径。 */
function OverrideAdder({ onAdd }: { onAdd: (o: ScheduleOverride) => void }) {
  const [date, setDate] = useState('');
  const [kind, setKind] = useState<'OFF' | 'MAKEUP'>('OFF');
  const [weekday, setWeekday] = useState(5);
  const [parity, setParity] = useState<'WEEKLY' | 'ODD_WEEK' | 'EVEN_WEEK'>('WEEKLY');
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10, flexWrap: 'wrap' }}>
      <label className="field">
        <span>日期</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field">
        <span>类型</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as 'OFF' | 'MAKEUP')}>
          <option value="OFF">放假（无课）</option>
          <option value="MAKEUP">上周几的课</option>
        </select>
      </label>
      {kind === 'MAKEUP' && (
        <>
          <label className="field">
            <span>星期</span>
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>
                  周{'一二三四五六日'[d - 1]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>单双周</span>
            <select
              value={parity}
              onChange={(e) => setParity(e.target.value as 'WEEKLY' | 'ODD_WEEK' | 'EVEN_WEEK')}
            >
              <option value="WEEKLY">只上每周的课</option>
              <option value="ODD_WEEK">按单周口径</option>
              <option value="EVEN_WEEK">按双周口径</option>
            </select>
          </label>
        </>
      )}
      <button
        className="btn primary"
        onClick={() => {
          if (!date) return;
          onAdd(
            kind === 'OFF'
              ? { date, off: true, label: '放假' }
              : { date, weekday, recurrence: parity, label: '调休' },
          );
          setDate('');
        }}
      >
        添加
      </button>
    </div>
  );
}
