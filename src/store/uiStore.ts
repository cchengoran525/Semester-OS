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
