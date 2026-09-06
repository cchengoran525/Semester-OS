import { useRef, useState } from 'react';
import { useApp } from '../components/AppProvider';
import { db } from '../storage/db';
import { seedIfFirstLaunch } from '../storage/seed';
import * as repos from '../storage/repositories';
import { useToast } from '../store/uiStore';
import type { Settings } from '../domain/types';
import { downloadJSON, exportAll, ImportError, importAll, parseImport } from '../services/importExport';
import { plankaConfig, type PlankaConfig } from '../services/planka/config';
import { PlankaClient, type ProbeResult } from '../services/planka/client';
import { pullCardsAsTasks, pushTaskAsCard } from '../services/planka/sync';
import { aiConfig, deepAIConfig, normalizeBaseUrl } from '../services/ai/config';
import { probe, type AIProbeResult } from '../services/ai/client';

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
  const [deepStatus, setDeepStatus] = useState<AIProbeResult | 'testing' | null>(null);
  const [busy, setBusy] = useState(false);
  const planka: PlankaConfig | null = plankaConfig();

  if (!settings) return null;

  const aiCfg = aiConfig({ ...settings, ai: aiForm });
  const deepCfg = deepAIConfig({ ...settings, ai: { ...aiForm, deep: deepForm } });

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
        <div style={{ marginTop: 10 }}>
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
                const baseUrl = e.target.value;
                setAiForm({ ...aiForm, baseUrl });
                set({ ai: { ...aiForm, baseUrl: normalizeBaseUrl(baseUrl), deep: deepForm } });
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || aiForm.baseUrl.trim()) return;
                const baseUrl = ZHIPU_DEFAULTS.baseUrl;
                setAiForm({ ...aiForm, baseUrl });
                set({ ai: { ...aiForm, baseUrl, deep: deepForm } });
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
                const model = e.target.value;
                setAiForm({ ...aiForm, model });
                set({ ai: { ...aiForm, model, deep: deepForm } });
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || aiForm.model.trim()) return;
                const model = ZHIPU_DEFAULTS.model;
                setAiForm({ ...aiForm, model });
                set({ ai: { ...aiForm, model, deep: deepForm } });
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
                const apiKey = e.target.value;
                setAiForm({ ...aiForm, apiKey });
                set({ ai: { ...aiForm, apiKey, deep: deepForm } });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
        </div>
        <div className="small faint" style={{ marginTop: 8 }}>
          默认接入智谱 GLM：地址和模型名留空时按回车即可写入默认值，通常只需再填
          API Key。Key 只保存在本地浏览器 IndexedDB，不进构建产物；仅在点击时把
          当次所需的摘要数据发给所填服务。
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
                const baseUrl = e.target.value;
                setDeepForm({ ...deepForm, baseUrl });
                set({ ai: { ...aiForm, deep: { ...deepForm, baseUrl: normalizeBaseUrl(baseUrl) } } });
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || (deepForm.baseUrl ?? '').trim()) return;
                const baseUrl = ZHIPU_DEFAULTS.baseUrl;
                setDeepForm({ ...deepForm, baseUrl });
                set({ ai: { ...aiForm, deep: { ...deepForm, baseUrl } } });
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
                const model = e.target.value;
                setDeepForm({ ...deepForm, model });
                set({ ai: { ...aiForm, deep: { ...deepForm, model } } });
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || (deepForm.model ?? '').trim()) return;
                const model = aiForm.model.trim() || ZHIPU_DEFAULTS.model;
                setDeepForm({ ...deepForm, model });
                set({ ai: { ...aiForm, deep: { ...deepForm, model } } });
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
                const apiKey = e.target.value;
                setDeepForm({ ...deepForm, apiKey });
                set({ ai: { ...aiForm, deep: { ...deepForm, apiKey } } });
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
