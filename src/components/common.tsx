import { type ReactNode } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  BLOCK_TYPE_LABELS,
  type Block,
  type BlockType,
  type Health,
  type Priority,
  type Task,
} from '../domain/types';
import { durationLabel, formatTime } from '../services/timeService';

export function HealthDot({ health }: { health: Health }) {
  return (
    <span role="img" aria-label={health} title={health}>
      <span className={`dot ${health}`} />
    </span>
  );
}

export function TypeTag({ type }: { type: BlockType }) {
  return <span className={`tag ${type}`}>{BLOCK_TYPE_LABELS[type]}</span>;
}

export function PriorityTag({ priority }: { priority: Priority }) {
  return <span className={`tag priority-${priority}`}>{priority}</span>;
}

export function Bar({ percent }: { percent: number }) {
  return (
    <div className="bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div>{children}</div>
      {action}
    </div>
  );
}

/** Task row that is draggable (when `draggable`) via dnd-kit. */
export function TaskRow({
  task,
  contextLabel,
  onToggle,
  onClick,
  draggable,
}: {
  task: Task;
  contextLabel?: string;
  onToggle: () => void;
  onClick?: () => void;
  draggable?: boolean;
}) {
  const drag = useDraggable({
    id: `task-${task.id}`,
    data: { kind: 'task', taskId: task.id },
    disabled: !draggable,
  });

  return (
    <div
      ref={drag.setNodeRef}
      className={`task-row ${task.status === 'DONE' ? 'done' : ''} ${draggable ? 'draggable' : ''} ${drag.isDragging ? 'dragging' : ''}`}
      {...drag.listeners}
      {...drag.attributes}
    >
      <button
        className={`checkbox ${task.status === 'DONE' ? 'checked' : ''}`}
        aria-label={task.status === 'DONE' ? '重新打开任务' : '完成任务'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        {task.status === 'DONE' ? '✓' : ''}
      </button>
      <span
        className="title"
        onClick={onClick}
        style={{ cursor: onClick ? 'pointer' : 'default' }}
      >
        {task.title}
      </span>
      {contextLabel && <span className="tag">{contextLabel}</span>}
      <PriorityTag priority={task.priority} />
      <span className="mono faint small">
        {task.actualMinutes != null
          ? `${durationLabel(task.estimateMinutes)}→${durationLabel(task.actualMinutes)}`
          : durationLabel(task.estimateMinutes)}
      </span>
    </div>
  );
}

/** Block card that accepts dropped tasks. */
export function BlockCard({
  block,
  label,
  tasks,
  current,
  onClick,
  droppable,
}: {
  block: Block;
  label: string;
  tasks: Task[];
  current?: boolean;
  onClick?: () => void;
  droppable?: boolean;
}) {
  const drop = useDroppable({
    id: `block-${block.id}`,
    data: { kind: 'block', blockId: block.id },
    disabled: !droppable,
  });
  const dragging = drop.isOver && droppable;

  return (
    <div
      ref={drop.setNodeRef}
      className={`block-card ${current ? 'current' : ''} ${dragging ? 'drag-over' : ''}`}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="time">
          {formatTime(block.start)}–{formatTime(block.end)}
        </span>
        <TypeTag type={block.type} />
      </div>
      <div className="label">{label}</div>
      {tasks.length > 0 && (
        <ul>
          {tasks.map((t) => (
            <li key={t.id}>
              {t.status === 'DONE' ? '☑' : '□'} {t.title}
            </li>
          ))}
        </ul>
      )}
      {block.source === 'SCHEDULE' && (
        <div className="faint small" style={{ marginTop: 2 }}>
          固定课程
        </div>
      )}
    </div>
  );
}

/** A day cell that accepts dropped tasks (creates a new block). */
export function DropDay({
  dateISO,
  children,
  className,
}: {
  dateISO: string;
  children: ReactNode;
  className?: string;
}) {
  const drop = useDroppable({
    id: `day-${dateISO}`,
    data: { kind: 'day', dateISO },
  });
  return (
    <div
      ref={drop.setNodeRef}
      className={`${className ?? ''} ${drop.isOver ? 'drag-over' : ''}`}
    >
      {children}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}
