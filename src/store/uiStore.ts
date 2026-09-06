import { create } from 'zustand';

export type QuickAddKind = 'task' | 'block' | 'project' | 'course' | null;

interface QuickAddState {
  kind: QuickAddKind;
  /** Pre-fill when opening from a specific context (e.g. project page). */
  presetProjectId?: string;
  presetCourseId?: string;
  open: (kind: Exclude<QuickAddKind, null>, preset?: { projectId?: string; courseId?: string }) => void;
  close: () => void;
}

export const useQuickAdd = create<QuickAddState>((set) => ({
  kind: null,
  open: (kind, preset) =>
    set({
      kind,
      presetProjectId: preset?.projectId,
      presetCourseId: preset?.courseId,
    }),
  close: () => set({ kind: null, presetProjectId: undefined, presetCourseId: undefined }),
}));

interface ToastState {
  message: string | null;
  tone: 'info' | 'error';
  show: (message: string, tone?: 'info' | 'error') => void;
  clear: () => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  tone: 'info',
  show: (message, tone = 'info') => set({ message, tone }),
  clear: () => set({ message: null }),
}));

// ── Global undo ──────────────────────────────────────────────────────

export interface UndoEntry {
  /** Toast label shown when the action happens, e.g. 「拖入时间块」. */
  label: string;
  /** Inverse operation. Must be self-contained (capture snapshots, not live refs). */
  undo?: () => Promise<void> | void;
}

interface UndoState {
  stack: UndoEntry[];
  push: (entry: UndoEntry) => void;
  /** Pop and execute the last inverse op. Returns its label, or null if empty. */
  undo: () => Promise<string | null>;
}

/**
 * Global undo (Cmd/Ctrl+Z). Mutation sites push an inverse closure right
 * after committing — the stack is deliberately dumb: no data model coupling,
 * any caller that can describe "how to go back" participates.
 */
export const useUndo = create<UndoState>((set, get) => ({
  stack: [],
  push: (entry) =>
    set((s) => ({ stack: [...s.stack.slice(-29), entry] })),
  undo: async () => {
    const { stack } = get();
    const last = stack[stack.length - 1];
    if (!last) return null;
    set({ stack: stack.slice(0, -1) });
    if (last.undo) await last.undo();
    return last.label;
  },
}));

// ── Dismissed suggestions (persisted) ────────────────────────────────

const DISMISSED_KEY = 'semester-os.dismissed-suggestions';
const DISMISSED_TTL_MS = 7 * 24 * 3600 * 1000; // 7 天后自动失效，避免任务变化后被永久屏蔽

function loadDismissed(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

interface DismissedState {
  dismissed: Record<string, number>;
  dismiss: (taskId: string) => void;
  isDismissed: (taskId: string) => boolean;
}

/** 「忽略」一条建议 = 按任务 ID 持久化屏蔽（7 天过期），刷新后依然生效。 */
export const useDismissedSuggestions = create<DismissedState>((set, get) => ({
  dismissed: loadDismissed(),
  dismiss: (taskId) => {
    const next = { ...get().dismissed, [taskId]: Date.now() };
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    set({ dismissed: next });
  },
  isDismissed: (taskId) => {
    const ts = get().dismissed[taskId];
    return ts != null && Date.now() - ts < DISMISSED_TTL_MS;
  },
}));
