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
import { EmptyState, Modal, PriorityTag, TaskRow } from '../components/common';
import { makeLabelResolver } from '../components/labels';
import * as repos from '../storage/repositories';
import { useToast, useUndo } from '../store/uiStore';
import { TASK_STATUS_LABELS, type Task, type TaskStatus } from '../domain/types';
import { durationLabel, todayDate, toISODate } from '../services/timeService';
import { estimateVsActual, taskCounts } from '../services/statistics';

const STATUSES: TaskStatus[] = ['BACKLOG', 'READY', 'DOING', 'DONE'];

/** One task card in the kanban — Planka 式：拖到哪列就是什么状态，卡片不携带任何时间安排。 */
function TaskCard({
  task,
  contextLabel,
  onClick,
}: {
  task: Task;
  contextLabel?: string;
  onClick: () => void;
}) {
  const drag = useDraggable({
    id: `task-${task.id}`,
    data: { kind: 'task', taskId: task.id },
  });
  const todayISO = toISODate(todayDate());
  const overdue = task.status !== 'DONE' && task.dueDate != null && task.dueDate < todayISO;
  return (
    <div
      ref={drag.setNodeRef}
      {...drag.listeners}
      {...drag.attributes}
      className={`project-card ${drag.isDragging ? 'dragging' : ''}`}
    >
      {/* 看板窄卡用便签阅读模式：标题/副标题换行完整显示 */}
      <div className="sticky-note kanban-note">
        <TaskRow
          task={task}
          contextLabel={contextLabel}
          onClick={onClick}
          onToggle={() =>
            task.status === 'DONE'
              ? repos.taskRepo.reopen(task.id)
              : repos.taskRepo.complete(task.id)
          }
        />
      </div>
      {overdue && <span className="tag" style={{ color: '#e5484d' }}>已逾期</span>}
    </div>
  );
}

function TaskColumn({
  status,
  count,
  children,
}: {
  status: TaskStatus;
  count: number;
  children: React.ReactNode;
}) {
  const drop = useDroppable({
    id: `task-col-${status}`,
    data: { kind: 'task-status', status },
  });
  return (
    <div
      ref={drop.setNodeRef}
      className={`kanban-col col-${status} ${drop.isOver ? 'drag-over' : ''}`}
    >
      <h2>
        {TASK_STATUS_LABELS[status]} · {count}
      </h2>
      {children}
    </div>
  );
}

export function TasksPage() {
  const { tasks, projects, courses } = useApp();
  const show = useToast((s) => s.show);
  const push = useUndo((s) => s.push);
  const [selected, setSelected] = useState<Task | null>(null);
  const [actualInput, setActualInput] = useState('');

  const labels = useMemo(() => makeLabelResolver(projects, courses), [projects, courses]);
  const counts = useMemo(() => taskCounts(tasks), [tasks]);

  const byStatus = useMemo(() => {
    const m = new Map<TaskStatus, Task[]>();
    for (const s of STATUSES) m.set(s, []);
    for (const t of tasks) m.get(t.status)?.push(t);
    return m;
  }, [tasks]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [dragging, setDragging] = useState<Task | null>(null);

  const onDragStart = (e: DragStartEvent) => {
    const data = e.active.data.current;
    if (data?.kind === 'task') setDragging(tasks.find((t) => t.id === data.taskId) ?? null);
  };

  const changeStatus = async (t: Task, status: TaskStatus) => {
    if (t.status === status) return;
    const previous = t.status;
    if (status === 'DONE') {
      await repos.taskRepo.complete(t.id);
    } else if (previous === 'DONE') {
      await repos.taskRepo.reopen(t.id);
      if (status !== 'READY') await repos.taskRepo.update(t.id, { status });
    } else {
      await repos.taskRepo.update(t.id, { status });
    }
    push({
      label: `${t.title} → ${TASK_STATUS_LABELS[status]}`,
      undo: async () => {
        if (previous === 'DONE') await repos.taskRepo.complete(t.id);
        else await repos.taskRepo.update(t.id, { status: previous });
      },
    });
    show(`「${t.title}」→ ${TASK_STATUS_LABELS[status]} · ⌘Z 可撤销`);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setDragging(null);
    const data = e.active.data.current;
    const overData = e.over?.data.current;
    if (!data || data.kind !== 'task' || !overData || overData.kind !== 'task-status') return;
    const t = tasks.find((x) => x.id === data.taskId);
    if (!t) return;
    await changeStatus(t, overData.status as TaskStatus);
  };

  const accuracy = useMemo(() => estimateVsActual(tasks), [tasks]);

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="page-header">
        <h1>任务</h1>
        <span className="sub">
          未完成 {counts.open} · 已完成 {counts.done} · 逾期 {counts.overdue} · 拖卡片切状态
        </span>
      </div>

      <div className="kanban">
        {STATUSES.map((status) => {
          const list = byStatus.get(status) ?? [];
          return (
            <TaskColumn key={status} status={status} count={list.length}>
              {list.length === 0 && <EmptyState>拖任务到这里</EmptyState>}
              {list.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  contextLabel={labels.taskContext(t)}
                  onClick={() => {
                    setSelected(t);
                    setActualInput(t.actualMinutes != null ? String(t.actualMinutes) : '');
                  }}
                />
              ))}
            </TaskColumn>
          );
        })}
      </div>

      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <div className="tag" style={{ padding: '4px 10px' }}>{dragging.title}</div>
        ) : null}
      </DragOverlay>

      {accuracy.length > 0 && (
        <section className="panel" style={{ marginTop: 14 }}>
          <h2>预估 vs 实际</h2>
          <div className="faint small" style={{ marginBottom: 4 }}>
            系统预估的用时 vs 你完成后记录的真实用时 —— 差距越大，下次预估就该越保守。
          </div>
          {accuracy.slice(0, 10).map((a, i) => (
            <div key={i} className="small" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                {a.title}
              </span>
              <span className="mono">
                {durationLabel(a.estimate)} → {durationLabel(a.actual)}{' '}
                <span className={a.actual > a.estimate ? 'faint' : ''}>
                  ({a.actual > a.estimate ? '+' : ''}
                  {a.actual - a.estimate} 分钟)
                </span>
              </span>
            </div>
          ))}
        </section>
      )}

      {selected && (
        <Modal title="任务详情" onClose={() => setSelected(null)}>
          <div className="stack" style={{ marginBottom: 12 }}>
            <div>
              <strong>{selected.title}</strong>
            </div>
            <div className="small muted">
              {selected.projectId
                ? `项目：${labels.projectById.get(selected.projectId)?.name ?? '—'}`
                : selected.courseId
                  ? `课程：${labels.courseById.get(selected.courseId)?.name ?? '—'}`
                  : '未关联'}
            </div>
            <div className="small muted mono">
              预估：{durationLabel(selected.estimateMinutes)} · 状态：{TASK_STATUS_LABELS[selected.status]}
            </div>
            <div>
              <PriorityTag priority={selected.priority} />
            </div>
            {selected.dueDate && <div className="small muted mono">截止：{selected.dueDate}</div>}
            {selected.notes && <div className="small muted">备注：{selected.notes}</div>}
          </div>

          {selected.status === 'DONE' ? (
            <label className="field">
              <span>实际用时·分钟（可选）</span>
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
                show('已移回待定');
              }}
            >
              移回待定
            </button>
            <button
              className="btn subtle"
              onClick={async () => {
                await repos.taskRepo.remove(selected.id);
                setSelected(null);
                show('任务已删除');
              }}
            >
              删除
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
              {selected.status === 'DONE' ? '重新打开' : '完成'}
            </button>
          </div>
        </Modal>
      )}
    </DndContext>
  );
}
