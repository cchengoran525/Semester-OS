import { useMemo, useState } from 'react';
import { useApp } from '../components/AppProvider';
import { Bar, EmptyState } from '../components/common';
import * as repos from '../storage/repositories';
import { useToast } from '../store/uiStore';
import type { Project, ProjectStatus } from '../domain/types';
import { currentMilestone, milestoneProgress, taskStats, wipStatus } from '../services/projectService';

const STATUSES: ProjectStatus[] = ['BACKLOG', 'ACTIVE', 'PAUSED', 'DONE'];

export function ProjectsPage() {
  const { projects, milestones, tasks, settings } = useApp();
  const show = useToast((s) => s.show);
  const [expanded, setExpanded] = useState<string | null>(null);

  const wip = wipStatus(projects, settings?.wipLimit ?? 2);

  const byStatus = useMemo(() => {
    const m = new Map<ProjectStatus, Project[]>();
    for (const s of STATUSES) m.set(s, []);
    for (const p of projects) m.get(p.status)?.push(p);
    return m;
  }, [projects]);

  const changeStatus = async (p: Project, status: ProjectStatus) => {
    if (status === 'ACTIVE' && wip.atLimit && p.status !== 'ACTIVE') {
      show(`WIP Limit reached: ${wip.activeCount}/${wip.limit}。已设为 ACTIVE，建议暂停其他项目或将某项目移回 Backlog。`);
    }
    await repos.projectRepo.update(p.id, { status });
  };

  return (
    <div>
      <div className="page-header">
        <h1>Projects</h1>
        <span className="sub">WIP {wip.activeCount}/{wip.limit}</span>
      </div>

      {STATUSES.map((status) => (
        <section className="panel" key={status} style={{ marginBottom: 14 }}>
          <h2>
            {status} · {byStatus.get(status)?.length ?? 0}
          </h2>
          {(byStatus.get(status) ?? []).length === 0 && (
            <EmptyState>没有{status}状态的项目。</EmptyState>
          )}
          {(byStatus.get(status) ?? []).map((p) => {
            const own = milestones
              .filter((m) => m.projectId === p.id)
              .sort((a, b) => a.order - b.order);
            const pct = milestoneProgress(own);
            const cm = currentMilestone(p, own);
            const stats = taskStats(p.id, tasks);
            const open = expanded === p.id;
            return (
              <div key={p.id} className="row-item" style={{ display: 'block' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <button
                    className="btn subtle small"
                    style={{ fontWeight: 600 }}
                    onClick={() => setExpanded(open ? null : p.id)}
                    aria-expanded={open}
                  >
                    {p.name}
                    <span className="mono faint" style={{ marginLeft: 8 }}>
                      {cm ? `· ${cm.name}` : ''}
                    </span>
                  </button>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="mono small faint">{pct}%</span>
                    <select
                      value={p.status}
                      onChange={(e) => changeStatus(p, e.target.value as ProjectStatus)}
                      aria-label={`${p.name} status`}
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <Bar percent={pct} />

                {open && (
                  <div style={{ marginTop: 8 }}>
                    {p.description && (
                      <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{p.description}</p>
                    )}
                    <div className="small muted" style={{ marginBottom: 6 }}>
                      Tasks: {stats.done}/{stats.total} done（进度主要由 Milestone 决定）
                    </div>
                    {own.map((m) => (
                      <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
                        <select
                          value={m.status}
                          onChange={(e) => repos.milestoneRepo.update(m.id, { status: e.target.value as typeof m.status })}
                          aria-label={`${m.name} status`}
                          className="small"
                        >
                          <option value="TODO">○ TODO</option>
                          <option value="DOING">● DOING</option>
                          <option value="DONE">✓ DONE</option>
                        </select>
                        <span className="small">{m.name}</span>
                        {cm?.id === m.id && <span className="tag">current</span>}
                      </div>
                    ))}
                    {own.length === 0 && (
                      <button
                        className="btn small"
                        onClick={() =>
                          repos.milestoneRepo.create({ projectId: p.id, name: 'M0', order: 0, status: 'TODO' })
                        }
                      >
                        + 添加 Milestone
                      </button>
                    )}
                    <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
                      <button
                        className="btn small subtle"
                        onClick={() => {
                          const name = window.prompt('Milestone 名称');
                          if (name?.trim()) {
                            repos.milestoneRepo.create({
                              projectId: p.id,
                              name: name.trim(),
                              order: own.length,
                              status: 'TODO',
                            });
                          }
                        }}
                      >
                        + Milestone
                      </button>
                      <button
                        className="btn small danger"
                        onClick={() => {
                          if (window.confirm(`确定删除项目「${p.name}」？其 Milestone 也会被删除。`)) {
                            repos.projectRepo.remove(p.id);
                            show('项目已删除');
                          }
                        }}
                      >
                        Delete Project
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
