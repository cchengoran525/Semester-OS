import type { Milestone, Project, Task } from '../domain/types';

/**
 * 进度规则（用户指定）：每完成一个里程碑，进度固定 +1%。
 * 里程碑总数不影响单步大小；上限 100。
 */
export function milestoneProgress(milestones: Milestone[]): number {
  const done = milestones.filter((m) => m.status === 'DONE').length;
  return Math.min(100, done);
}

export function currentMilestone(
  project: Project,
  milestones: Milestone[],
): Milestone | undefined {
  const own = milestones
    .filter((m) => m.projectId === project.id)
    .sort((a, b) => a.order - b.order);
  if (project.currentMilestoneId) {
    const found = own.find((m) => m.id === project.currentMilestoneId);
    if (found) return found;
  }
  return own.find((m) => m.status !== 'DONE') ?? own.at(-1);
}

export interface WipStatus {
  activeCount: number;
  limit: number;
  atLimit: boolean;
  overLimit: boolean;
}

export function wipStatus(projects: Project[], limit: number): WipStatus {
  const activeCount = projects.filter((p) => p.status === 'ACTIVE').length;
  return {
    activeCount,
    limit,
    atLimit: activeCount >= limit,
    overLimit: activeCount > limit,
  };
}

/** Task completion within a project — auxiliary info only. */
export function taskStats(projectId: string, tasks: Task[]) {
  const own = tasks.filter((t) => t.projectId === projectId);
  const done = own.filter((t) => t.status === 'DONE').length;
  return { total: own.length, done, open: own.length - done };
}
