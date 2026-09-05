import { useRef, useState } from 'react';
import { useApp } from '../components/AppProvider';
import * as repos from '../storage/repositories';
import { useToast } from '../store/uiStore';
import type { Settings } from '../domain/types';
import { downloadJSON, exportAll, ImportError, importAll, parseImport } from '../services/importExport';

export function SettingsPage() {
  const { settings } = useApp();
  const show = useToast((s) => s.show);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<ReturnType<typeof parseImport> | null>(null);

  if (!settings) return null;

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
        <h1>Settings</h1>
      </div>

      <section className="panel" style={{ marginBottom: 14, maxWidth: 560 }}>
        <h2>Semester</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field">
            <span>SEMESTER START</span>
            <input
              type="date"
              value={settings.semesterStart}
              onChange={(e) => set({ semesterStart: e.target.value })}
            />
          </label>
          <label className="field">
            <span>SEMESTER END</span>
            <input
              type="date"
              value={settings.semesterEnd}
              onChange={(e) => set({ semesterEnd: e.target.value })}
            />
          </label>
        </div>
        <div className="small faint">
          当前教学周根据 Semester Start 自动推算（用于单双周课程判断）。
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 14, maxWidth: 560 }}>
        <h2>Preferences</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field">
            <span>WEEK START DAY</span>
            <select
              value={settings.weekStartDay}
              onChange={(e) => set({ weekStartDay: Number(e.target.value) as 0 | 1 })}
            >
              <option value={1}>Monday</option>
              <option value={0}>Sunday</option>
            </select>
          </label>
          <label className="field">
            <span>WIP LIMIT</span>
            <input
              type="number"
              min={1}
              max={10}
              value={settings.wipLimit}
              onChange={(e) => set({ wipLimit: Math.max(1, Number(e.target.value) || 1) })}
            />
          </label>
          <label className="field">
            <span>DEFAULT TASK ESTIMATE (min)</span>
            <input
              type="number"
              min={15}
              step={15}
              value={settings.defaultTaskEstimate}
              onChange={(e) => set({ defaultTaskEstimate: Number(e.target.value) || 60 })}
            />
          </label>
          <label className="field">
            <span>THEME</span>
            <select value={settings.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}>
              <option value="DARK">Dark</option>
              <option value="LIGHT">Light</option>
              <option value="SYSTEM">System</option>
            </select>
          </label>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 14, maxWidth: 560 }}>
        <h2>Data</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={doExport}>
            Export JSON
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Import JSON
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
        {pendingImport && (
          <div className="warning-banner" style={{ marginTop: 10 }}>
            <span style={{ flex: 1 }}>
              即将导入 {pendingImport.data.tasks.length} 个 Task、{pendingImport.data.blocks.length} 个 Block，
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

      <section className="panel" style={{ maxWidth: 560 }}>
        <h2>Integrations</h2>
        <div className="small muted">
          Planka: <span className="tag">Not Connected</span>{' '}
          <span className="faint">（Execution Layer 集成，接口已预留，可后续接入）</span>
        </div>
      </section>
    </div>
  );
}
