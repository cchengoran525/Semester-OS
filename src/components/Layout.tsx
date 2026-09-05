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
import { useQuickAdd, useToast } from '../store/uiStore';
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
  }, [settings?.theme]);
  return null;
}

function Shortcuts() {
  const open = useQuickAdd((s) => s.open);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        open('task');
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault();
        open('block');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);
  return null;
}

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/tasks', label: 'Tasks', icon: ClipboardList },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/courses', label: 'Courses', icon: GraduationCap },
  { to: '/semester', label: 'Semester', icon: Map },
  { to: '/review', label: 'Review', icon: ClipboardCheck },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
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
        <button className="btn" onClick={() => open('task')}>
          <Plus size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
          Task <span className="kbd">N</span>
        </button>
        <button className="btn" style={{ marginTop: 6 }} onClick={() => open('block')}>
          <Plus size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
          Block <span className="kbd">B</span>
        </button>
      </aside>
      <main className="main">
        {loading ? (
          <div className="faint mono">Loading…</div>
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
