import { useMemo, useState } from 'react';
import { useApp } from '../components/AppProvider';
import { EmptyState, Modal, PriorityTag, TaskRow } from '../components/common';
import { makeLabelResolver } from '../components/labels';
import * as repos from '../storage/repositories';
import { useToast } from '../store/uiStore';
import type { Task } from '../domain/types';
import { durationLabel } from '../services/timeService';
import { estimateVsActual, taskCounts } from '../services/statistics';

type Filter = 'ALL' | 'READY' | 'DOING' | 'DONE' | 'OVERDUE';

export function TasksPage() {
  const { tasks, projects, courses } = useApp();
  const show = useToast((s) => s.show);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [selected, setSelected] = useState<Task | null>(null);
  const [actualInput, setActualInput] = useState('');

  const labels = useMemo(() => makeLabelResolver(projects, courses), [projects, courses]);
  const counts = useMemo(() => taskCounts(tasks), [tasks]);

  const filtered = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return tasks
      .filter((t) => {
        if (filter === 'ALL') return true;
        if (filter === 'OVERDUE') return t.status !== 'DONE' && t.dueDate != null && t.dueDate < today;
        return t.status === filter;
      })
      .sort((a, b) => {
        const order = { DOING: 0, READY: 1, BACKLOG: 2, DONE: 3 } as const;
        if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
        return (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
      });
  }, [tasks, filter]);

  const accuracy = useMemo(() => estimateVsActual(tasks), [tasks]);

  const toggle = (t: Task) =>
    t.status === 'DONE' ? repos.taskRepo.reopen(t.id) : repos.taskRepo.complete(t.id);

  return (
    <div>
      <div className="page-header">
        <h1>Tasks</h1>
        <span className="sub">
          {counts.open} open · {counts.done} done · {counts.overdue} overdue
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['ALL', 'READY', 'DOING', 'DONE', 'OVERDUE'] as Filter[]).map((f) => (
          <button
            key={f}
            className={`btn small ${filter === f ? 'primary' : 'subtle'}`}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <section className="panel">
        {filtered.length === 0 && <EmptyState>这里还没有任务。</EmptyState>}
        {filtered.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            contextLabel={labels.taskContext(t)}
            onToggle={() => toggle(t)}
            onClick={() => {
              setSelected(t);
              setActualInput(t.actualMinutes != null ? String(t.actualMinutes) : '');
            }}
          />
        ))}
      </section>

      {accuracy.length > 0 && (
        <section className="panel" style={{ marginTop: 14 }}>
          <h2>Estimate vs Actual</h2>
          {accuracy.slice(0, 10).map((a, i) => (
            <div key={i} className="small" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                {a.title}
              </span>
              <span className="mono">
                {durationLabel(a.estimate)} → {durationLabel(a.actual)}{' '}
                <span className={a.actual > a.estimate ? 'faint' : ''}>
                  ({a.actual > a.estimate ? '+' : ''}
                  {a.actual - a.estimate}m)
                </span>
              </span>
            </div>
          ))}
        </section>
      )}

      {selected && (
        <Modal title="Task Detail" onClose={() => setSelected(null)}>
          <div className="stack" style={{ marginBottom: 12 }}>
            <div>
              <strong>{selected.title}</strong>
            </div>
            <div className="small muted">
              {selected.projectId
                ? `Project: ${labels.projectById.get(selected.projectId)?.name ?? '—'}`
                : selected.courseId
                  ? `Course: ${labels.courseById.get(selected.courseId)?.name ?? '—'}`
                  : '未关联'}
            </div>
            <div className="small muted mono">
              Estimate: {durationLabel(selected.estimateMinutes)} · Status: {selected.status}
            </div>
            <div>
              <PriorityTag priority={selected.priority} />
            </div>
            {selected.dueDate && <div className="small muted mono">Due: {selected.dueDate}</div>}
            {selected.notes && <div className="small muted">Notes: {selected.notes}</div>}
          </div>

          {selected.status === 'DONE' ? (
            <label className="field">
              <span>ACTUAL MINUTES（可选）</span>
              <input
                type="number"
                value={actualInput}
                onChange={(e) => setActualInput(e.target.value)}
                placeholder="实际用了多久？"
              />
            </label>
          ) : (
            <label className="field">
              <span>记录实际用时后完成（可选）</span>
              <input
                type="number"
                value={actualInput}
                onChange={(e) => setActualInput(e.target.value)}
                placeholder="留空 = 不记录"
              />
            </label>
          )}

          <div className="actions">
            <button
              className="btn subtle"
              onClick={() => {
                repos.taskRepo.update(selected.id, { status: 'BACKLOG' });
                setSelected(null);
                show('已移回 Backlog');
              }}
            >
              Back to Ready/Backlog
            </button>
            <button
              className="btn subtle"
              onClick={async () => {
                await repos.taskRepo.remove(selected.id);
                setSelected(null);
                show('任务已删除');
              }}
            >
              Delete
            </button>
            <button
              className="btn"
              onClick={() => {
                const nextDay = new Date();
                nextDay.setDate(nextDay.getDate() + 1);
                repos.taskRepo.update(selected.id, {
                  dueDate: nextDay.toISOString().slice(0, 10),
                });
                setSelected(null);
                show('已顺延到明天');
              }}
            >
              Move to Tomorrow
            </button>
            <button
              className="btn primary"
              onClick={() => {
                if (selected.status === 'DONE') {
                  repos.taskRepo.reopen(selected.id);
                } else {
                  repos.taskRepo.complete(selected.id, actualInput ? Number(actualInput) : undefined);
                }
                setSelected(null);
              }}
            >
              {selected.status === 'DONE' ? 'Reopen' : 'Complete'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
