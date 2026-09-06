import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import {
  CalendarDays,
  ClipboardList,
  FolderKanban,
  GraduationCap,
  LayoutDashboard,
  Map,
  Plus,
  ClipboardCheck,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useApp } from './AppProvider';
import { settingsRepo } from '../storage/repositories';
import { useQuickAdd, useToast, useUndo } from '../store/uiStore';
import { getWeekInfo, formatDateLong } from '../services/timeService';
import { QuickAddModals } from './QuickAddModals';

function ToastHost() {
  const { message, tone, clear } = useToast();
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(clear, 3500);
    return () => clearTimeout(t);
  }, [message, clear]);
  if (!message) return null;
  return (
    <div className={`toast ${tone}`} role="status">
      {message}
    </div>
  );
}

function ThemeSync() {
  const { settings } = useApp();
  useEffect(() => {
    const theme =
      settings?.theme === 'SYSTEM'
        ? window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'
        : settings?.theme === 'LIGHT'
          ? 'light'
          : 'dark';
    document.documentElement.dataset.theme = theme;
    // 字体缩放：只缩字体不缩布局（CSS 变量 × calc），无滚动/命中副作用
    const scale = settings?.fontScale ?? 1;
    document.documentElement.style.setProperty('--font-scale', String(scale));
  }, [settings?.theme, settings?.fontScale]);
  return null;
}

function Shortcuts() {
  const open = useQuickAdd((s) => s.open);
  const undo = useUndo((s) => s.undo);
  const show = useToast((s) => s.show);
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      // 撤销优先于快捷添加：Cmd/Ctrl+Z（无 Shift）
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        const label = await undo();
        show(label ? `已撤销：${label}` : '没有可撤销的操作');
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        open('task');
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        open('block');
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        open('course');
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        open('project');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, undo, show]);
  return null;
}

const NAV = [
  { to: '/', label: '总览', icon: LayoutDashboard },
  { to: '/calendar', label: '日历', icon: CalendarDays },
  { to: '/tasks', label: '任务', icon: ClipboardList },
  { to: '/projects', label: '项目', icon: FolderKanban },
  { to: '/courses', label: '课程', icon: GraduationCap },
  { to: '/semester', label: '学期', icon: Map },
  { to: '/review', label: '复盘', icon: ClipboardCheck },
  { to: '/settings', label: '设置', icon: SettingsIcon },
];

export function Layout() {
  const { settings, loading } = useApp();
  const open = useQuickAdd((s) => s.open);
  const week = getWeekInfo(new Date(), settings?.weekStartDay ?? 1);
  const teachingWeek = settings
    ? Math.max(
        1,
        Math.floor(
          (Date.now() - new Date(`${settings.semesterStart}T00:00:00`).getTime()) /
            (7 * 86400000),
        ) + 1,
      )
    : 1;

  return (
    <div className="app-shell">
      <ThemeSync />
      <Shortcuts />
      <aside className="sidebar">
        <div className="brand">
          SEMESTER OS
          <small>
            {week.id} · 教学周 {teachingWeek}
          </small>
        </div>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <Icon size={14} />
            {label}
          </NavLink>
        ))}
        <div className="spacer" />
        <button
          className="btn"
          title="切换明暗模式（更多选项在设置页）"
          onClick={() =>
            void settingsRepo.save({
              theme: settings?.theme === 'LIGHT' ? 'DARK' : 'LIGHT',
            })
          }
        >
          {settings?.theme === 'LIGHT' ? '🌙 深色' : '☀️ 浅色'}
        </button>
        <button className="btn" onClick={() => open('task')}>
          <Plus size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
          任务 <span className="kbd">N</span>
        </button>
        <button className="btn" style={{ marginTop: 6 }} onClick={() => open('block')}>
          <Plus size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
          时间块 <span className="kbd">B</span>
        </button>
        <button className="btn" style={{ marginTop: 6 }} onClick={() => open('course')}>
          <Plus size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
          课程 <span className="kbd">C</span>
        </button>
        <button className="btn" style={{ marginTop: 6 }} onClick={() => open('project')}>
          <Plus size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
          项目 <span className="kbd">P</span>
        </button>
      </aside>
      <main className="main">
        {loading ? (
          <div className="faint mono">加载中…</div>
        ) : (
          <>
            <div className="faint mono small" style={{ marginBottom: 14 }}>
              {formatDateLong(new Date())}
            </div>
            <Outlet />
          </>
        )}
      </main>
      <QuickAddModals />
      <ToastHost />
    </div>
  );
}
