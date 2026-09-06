import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useApp } from '../components/AppProvider';
import { AIThinking, Bar, EmptyState } from '../components/common';
import * as repos from '../storage/repositories';
import { useToast, useUndo } from '../store/uiStore';
import { PRIORITY_LABELS, PROJECT_STATUS_LABELS, type Milestone, type Project, type ProjectStatus } from '../domain/types';
import { currentMilestone, milestoneProgress, taskStats, wipStatus } from '../services/projectService';
import { aiConfig } from '../services/ai/config';
import { suggestTaskBreakdown, type SuggestedTask } from '../services/ai/features';

const STATUSES: ProjectStatus[] = ['BACKLOG', 'ACTIVE', 'PAUSED', 'DONE'];

function ProjectCard({
  project,
  milestones,
  tasks,
  expanded,
  onToggle,
}: {
  project: Project;
  milestones: Milestone[];
  tasks: import('../domain/types').Task[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const show = useToast((s) => s.show);
  const { settings } = useApp();
  const aiCfg = aiConfig(settings);
  const [aiBusy, setAiBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedTask[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const runBreakdown = async () => {
    if (!aiCfg) return;
    setAiBusy(true);
    try {
      const list = await suggestTaskBreakdown(aiCfg, {
        projectName: project.name,
        description: project.description,
        milestones: own.map((m) => m.name),
        existingTaskTitles: tasks
          .filter((t) => t.projectId === project.id && t.status !== 'DONE')
          .map((t) => t.title),
      });
      setSuggestions(list);
      setSelected(new Set(list.map((_, i) => i)));
    } catch (e) {
      show(`AI 拆解失败：${(e as Error).message}`, 'error');
    } finally {
      setAiBusy(false);
    }
  };

  const importSelected = async () => {
    if (!suggestions) return;
    const picked = suggestions.filter((_, i) => selected.has(i));
    if (picked.length === 0) return;
    for (const s of picked) {
      await repos.taskRepo.create({
        title: s.title,
        projectId: project.id,
        estimateMinutes: s.estimateMinutes,
        priority: s.priority,
        status: 'BACKLOG',
        notes: s.notes,
      });
    }
    setSuggestions(null);
    show(`已导入 ${picked.length} 个建议任务（待定状态，可在任务页调整）`);
  };
  const drag = useDraggable({
    id: `project-${project.id}`,
    data: { kind: 'project', projectId: project.id },
  });
  const own = useMemo(
    () => milestones.filter((m) => m.projectId === project.id).sort((a, b) => a.order - b.order),
    [milestones, project.id],
  );
  const pct = milestoneProgress(own);
  const cm = currentMilestone(project, own);
  const stats = taskStats(project.id, tasks);
  const doneList = own.filter((m) => m.status === 'DONE');
  const todoList = own.filter((m) => m.status !== 'DONE');

  return (
    <div
      ref={drag.setNodeRef}
      {...drag.listeners}
      {...drag.attributes}
      className={`project-card ${drag.isDragging ? 'dragging' : ''}`}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}
        onClick={onToggle}
        role="button"
      >
        <strong className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.name}
        </strong>
        <span className="mono small faint" style={{ flexShrink: 0 }}>
          {doneList.length}/{own.length} · {pct}%
        </span>
      </div>
      <div className="faint small" onClick={onToggle}>
        {cm ? cm.name : '—'}
      </div>
      <Bar percent={pct} />

      {expanded && (
        <div style={{ marginTop: 8 }} onPointerDown={(e) => e.stopPropagation()}>
          {project.description && (
            <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{project.description}</p>
          )}
          <div className="small muted" style={{ marginBottom: 6 }}>
            任务：{stats.done}/{stats.total} 已完成（进度主要由里程碑决定）
          </div>
          {/* 做完的 / 要做的 分两列，框内滚动 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div className="faint small" style={{ marginBottom: 2 }}>要做的（{todoList.length}）</div>
              <div className="kanban-scroll">
                {todoList.length === 0 && <div className="faint small">全部完成 🎉</div>}
                {todoList.map((m) => (
                  <div key={m.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                    <select
                      value={m.status}
                      onChange={(e) =>
                        repos.milestoneRepo.update(m.id, { status: e.target.value as typeof m.status })
                      }
                      aria-label={`${m.name} 状态`}
                      className="small"
                    >
                      <option value="TODO">○ 待办</option>
                      <option value="DOING">● 进行中</option>
                      <option value="DONE">✓ 已完成</option>
                    </select>
                    <span className="small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.name}
                    </span>
                    {cm?.id === m.id && <span className="tag">当前</span>}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="faint small" style={{ marginBottom: 2 }}>做完的（{doneList.length}）</div>
              <div className="kanban-scroll">
                {doneList.length === 0 && <div className="faint small">还没有完成的里程碑</div>}
                {doneList.map((m) => (
                  <div key={m.id} className="small" style={{ marginBottom: 3 }}>
                    ✓ {m.name}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            <button
              className="btn small subtle"
              disabled={aiBusy}
              title={aiCfg ? undefined : '先在 设置 → AI 助手 里配置接口'}
              onClick={runBreakdown}
            >
              {aiBusy ? 'AI 思考中…' : 'AI 拆解任务'}
            </button>
            <button
              className="btn small subtle"
              onClick={() => {
                const name = window.prompt('里程碑名称');
                if (name?.trim()) {
                  repos.milestoneRepo.create({
                    projectId: project.id,
                    name: name.trim(),
                    order: own.length,
                    status: 'TODO',
                  });
                }
              }}
            >
              + 里程碑
            </button>
            <button
              className="btn small danger"
              onClick={() => {
                if (window.confirm(`确定删除项目「${project.name}」？其里程碑也会被删除。`)) {
                  repos.projectRepo.remove(project.id);
                }
              }}
            >
              删除项目
            </button>
          </div>
          <AIThinking active={aiBusy} />
          {suggestions && (
            <div style={{ marginTop: 10 }}>
              <div className="faint small" style={{ marginBottom: 4 }}>
                AI 建议的任务（勾选后导入，进入「待定」）：
              </div>
              {suggestions.map((s, i) => (
                <label
                  key={i}
                  className="task-row"
                  style={{ paddingLeft: 0, cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => {
                      const next = new Set(selected);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      setSelected(next);
                    }}
                  />
                  <span className="title" style={{ flex: 1 }}>
                    {s.title}
                  </span>
                  <span className="mono faint small">
                    {s.estimateMinutes} 分钟 · {PRIORITY_LABELS[s.priority]}
                  </span>
                </label>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button className="btn small primary" onClick={importSelected}>
                  导入所选（{selected.size}）
                </button>
                <button className="btn small subtle" onClick={() => setSuggestions(null)}>
                  收起
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ProjectsPage() {
  const { projects, milestones, tasks, settings } = useApp();
  const show = useToast((s) => s.show);
  const push = useUndo((s) => s.push);
  const [expanded, setExpanded] = useState<string | null>(null);

  const wip = wipStatus(projects, settings?.wipLimit ?? 2);

  const byStatus = useMemo(() => {
    const m = new Map<ProjectStatus, Project[]>();
    for (const s of STATUSES) m.set(s, []);
    for (const p of projects) m.get(p.status)?.push(p);
    return m;
  }, [projects]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [dragging, setDragging] = useState<Project | null>(null);

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current;
    if (data?.kind === 'project') setDragging(projects.find((p) => p.id === data.projectId) ?? null);
  };

  const changeStatus = async (p: Project, status: ProjectStatus) => {
    if (p.status === status) return;
    if (status === 'ACTIVE' && wip.atLimit && p.status !== 'ACTIVE') {
      show(`已达到 WIP 上限：${wip.activeCount}/${wip.limit}。已设为进行中，建议暂停其他项目或将某项目移回待启动。`);
    }
    const previous = p.status;
    await repos.projectRepo.update(p.id, { status });
    push({
      label: `${p.name} → ${PROJECT_STATUS_LABELS[status]}`,
      undo: () => repos.projectRepo.update(p.id, { status: previous }),
    });
    show(`${p.name} → ${PROJECT_STATUS_LABELS[status]} · ⌘Z 可撤销`);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setDragging(null);
    const data = e.active.data.current;
    const overData = e.over?.data.current;
    if (!data || data.kind !== 'project' || !overData || overData.kind !== 'project-status') return;
    const p = projects.find((x) => x.id === data.projectId);
    if (!p) return;
    await changeStatus(p, overData.status as ProjectStatus);
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="page-header">
        <h1>项目</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span className="sub">WIP {wip.activeCount}/{wip.limit} · 拖卡片切换状态</span>
        </div>
      </div>

      <div className="kanban">
        {STATUSES.map((status) => {
          const list = byStatus.get(status) ?? [];
          return (
            <KanbanColumn key={status} status={status} count={list.length}>
              {list.length === 0 && (
                <EmptyState>拖项目到这里</EmptyState>
              )}
              {list.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  milestones={milestones}
                  tasks={tasks}
                  expanded={expanded === p.id}
                  onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
                />
              ))}
            </KanbanColumn>
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="tag" style={{ padding: '4px 10px' }}>{dragging.name}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function KanbanColumn({
  status,
  count,
  children,
}: {
  status: ProjectStatus;
  count: number;
  children: React.ReactNode;
}) {
  const drop = useDroppable({
    id: `col-${status}`,
    data: { kind: 'project-status', status },
  });
  return (
    <div
      ref={drop.setNodeRef}
      className={`kanban-col col-${status} ${drop.isOver ? 'drag-over' : ''}`}
    >
      <h2>{PROJECT_STATUS_LABELS[status]} · {count}</h2>
      {children}
    </div>
  );
}
