import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import * as repos from '../storage/repositories';
import {
  BLOCK_TYPE_LABELS,
  HEALTH_LABELS,
  PRIORITY_LABELS,
  type Block,
  type BlockType,
  type Health,
  type Priority,
  type Task,
} from '../domain/types';
import { durationLabel, formatTime } from '../services/timeService';

export function HealthDot({ health }: { health: Health }) {
  return (
    <span role="img" aria-label={HEALTH_LABELS[health]} title={HEALTH_LABELS[health]}>
      <span className={`dot ${health}`} />
    </span>
  );
}

/** AI 请求进行中的秒数计数；不活跃时归零。 */
export function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const t0 = Date.now();
    setSeconds(0);
    const id = setInterval(() => setSeconds(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [active]);
  return seconds;
}

/**
 * AI 思考中的显性状态条：脉冲圆点 + 已等待秒数。
 * 推理模型动辄等 1–2 分钟，没有这个用户会以为点击没生效。
 */
export function AIThinking({ active }: { active: boolean }) {
  const seconds = useElapsed(active);
  if (!active) return null;
  return (
    <div className="ai-thinking" role="status">
      <span className="ai-thinking-dot" aria-hidden />
      <span>AI 思考中…</span>
      <span className="ai-thinking-ms">
        已等待 {seconds} 秒 · 复杂请求可能要 1–2 分钟
      </span>
    </div>
  );
}

export function TypeTag({ type }: { type: BlockType }) {
  return <span className={`tag ${type}`}>{BLOCK_TYPE_LABELS[type]}</span>;
}

export function PriorityTag({ priority }: { priority: Priority }) {
  return <span className={`tag priority-${priority}`}>{PRIORITY_LABELS[priority]}</span>;
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
      onClick={() => {
        onClick?.();
      }}
      className={`task-row ${task.status === 'DONE' ? 'done' : ''} ${draggable ? 'draggable' : ''} ${drag.isDragging ? 'dragging' : ''}`}
      {...(draggable ? drag.listeners : {})}
      {...(draggable ? drag.attributes : {})}
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
        style={{ cursor: onClick ? 'pointer' : 'default' }}
      >
        <span className="task-title-main">{task.title}</span>
        {(task.notes || task.dueDate) && (
          <span className="task-title-sub faint small">
            {task.notes ?? ''}
            {task.notes && task.dueDate ? ' · ' : ''}
            {task.dueDate ? `截止 ${task.dueDate.slice(5)}` : ''}
          </span>
        )}
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

/** Deterministic hue from a context label so different contexts get stable colors. */
function contextHue(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) % 360;
  return h;
}

// ── Day timeline strip ───────────────────────────────────────────────

const DAY_TINTS: Record<BlockType, string> = {
  COURSE: 'rgba(59, 130, 246, 0.55)',
  DEEP_WORK: 'rgba(168, 85, 247, 0.55)',
  ENGINEERING: 'rgba(34, 197, 94, 0.55)',
  ADMIN: 'rgba(148, 163, 184, 0.55)',
  ENGLISH: 'rgba(20, 184, 166, 0.55)',
  RECOVERY: 'rgba(251, 146, 60, 0.55)',
};

function hmToMin(hm: string): number {
  return Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
}

/**
 * 一天的时间长条：固定课程灰、自建/建议块按类型着色、其余留空。
 * 视觉冗余——块卡片照常显示，长条负责"一天的全景"。
 */
export function DayTimeline({
  blocks,
  from = '08:00',
  to = '22:00',
  now,
  labelFor,
  interactive,
  preview,
}: {
  blocks: Block[];
  from?: string;
  to?: string;
  now?: Date;
  labelFor?: (context?: string) => string;
  /** true → 可作为拖放落点：拖任务到轴上某时刻即在该处开块 */
  interactive?: boolean;
  /** 拖动悬停时的落点预览段（百分比坐标） */
  preview?: { left: number; width: number } | null;
}) {
  const drop = useDroppable({
    id: 'day-timeline',
    data: { kind: 'timeline' },
    disabled: !interactive,
  });
  const startMin = hmToMin(from);
  const endMin = hmToMin(to);
  const total = Math.max(1, endMin - startMin);

  const segs = blocks
    .map((b) => {
      const s = Math.max(startMin, hmToMin(b.start.slice(11, 16)));
      const e = Math.min(endMin, hmToMin(b.end.slice(11, 16)));
      if (e <= s) return null;
      return {
        block: b,
        left: ((s - startMin) / total) * 100,
        width: ((e - s) / total) * 100,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const nowMin = now ? now.getHours() * 60 + now.getMinutes() : null;
  const nowPct =
    nowMin != null && nowMin >= startMin && nowMin <= endMin
      ? ((nowMin - startMin) / total) * 100
      : null;

  const ticks: string[] = [];
  for (let m = startMin; m <= endMin; m += 120) {
    ticks.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:00`);
  }

  return (
    <div className="day-timeline">
      <div
        ref={drop.setNodeRef}
        className={`dtl-track ${interactive ? 'dtl-interactive' : ''} ${drop.isOver ? 'dtl-over' : ''}`}
      >
        {segs.map(({ block, left, width }) => (
          <div
            key={block.id}
            className={`dtl-seg ${block.source === 'SCHEDULE' ? 'dtl-fixed' : ''} ${block.status === 'DONE' ? 'dtl-done' : ''}`}
            style={{
              left: `${left}%`,
              width: `${Math.max(width, 0.8)}%`,
              background:
                block.source === 'SCHEDULE'
                  ? 'rgba(120, 130, 145, 0.5)'
                  : DAY_TINTS[block.type],
            }}
            title={`${block.source === 'SCHEDULE' ? '固定课程' : BLOCK_TYPE_LABELS[block.type]} ${formatTime(block.start)}–${formatTime(block.end)}${
              labelFor && block.context ? ` · ${labelFor(block.context)}` : ''
            }${block.taskIds.length ? ` · ${block.taskIds.length} 个任务` : ''}`}
          />
        ))}
        {preview && <div className="dtl-preview" style={{ left: `${preview.left}%`, width: `${Math.max(preview.width, 0.8)}%` }} />}
        {nowPct != null && <div className="dtl-now" style={{ left: `${nowPct}%` }} />}
      </div>
      <div className="dtl-ticks">
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
    </div>
  );
}

/** Block card that accepts dropped tasks; `draggable` lets the whole card move days. */
export function BlockCard({
  block,
  label,
  tasks,
  current,
  onClick,
  droppable,
  draggable,
  onDelete,
  onComplete,
  onTaskOpen,
}: {
  block: Block;
  label?: string;
  tasks: Task[];
  current?: boolean;
  onClick?: () => void;
  droppable?: boolean;
  draggable?: boolean;
  /** Present → shows a ✕ button (except fixed course blocks). Receives the block. */
  onDelete?: (block: Block) => void | Promise<void>;
  /** Present → shows a ✓ button that closes this attention block (records actual minutes). */
  onComplete?: (block: Block) => void | Promise<void>;
  /** Present → 块里的任务行可点击打开任务详情 */
  onTaskOpen?: (task: Task) => void;
}) {
  const drop = useDroppable({
    id: `block-${block.id}`,
    data: { kind: 'block', blockId: block.id },
    disabled: !droppable,
  });
  const drag = useDraggable({
    id: `move-block-${block.id}`,
    data: { kind: 'block', blockId: block.id },
    disabled: !draggable,
  });
  const dragging = drop.isOver && droppable;

  return (
    <div
      ref={(node) => {
        drop.setNodeRef(node);
        drag.setNodeRef(node);
      }}
      {...(draggable ? drag.attributes : {})}
      {...(draggable ? drag.listeners : {})}
      className={`block-card type-${block.type} ${block.source === 'SCHEDULE' ? 'schedule' : ''} ${block.status === 'DONE' ? 'done' : ''} ${current ? 'current' : ''} ${dragging ? 'drag-over' : ''} ${drag.isDragging ? 'dragging' : ''}`}
      onClick={onClick}
      style={{ cursor: draggable ? 'grab' : onClick ? 'pointer' : 'default' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <span className="time">
          {formatTime(block.start)}–{formatTime(block.end)}
        </span>
        <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {onComplete && block.source !== 'SCHEDULE' && block.status !== 'DONE' && (
            <button
              className="block-del"
              aria-label="完成时间块"
              title="完成时间块（记录实际时长）"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void onComplete(block);
              }}
            >
              ✓
            </button>
          )}
          {onDelete && block.source !== 'SCHEDULE' && (
            <button
              className="block-del"
              aria-label="删除时间块"
              title="删除时间块"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                void onDelete(block);
              }}
            >
              ✕
            </button>
          )}
        </span>
      </div>
      {/* 主标题 = 颗粒度（类型）+ 上下文标签，同行换行共存，不与时间抢宽度 */}
      <div className="label" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <span>{BLOCK_TYPE_LABELS[block.type]}</span>
        {label && label !== '—' && (
          <span
            className="tag context-chip"
            style={{
              background: `hsl(${contextHue(label)} 35% 24%)`,
              color: `hsl(${contextHue(label)} 70% 82%)`,
            }}
          >
            {label}
          </span>
        )}
      </div>
      {tasks.length > 0 && (
        <ul>
          {tasks.map((t) => (
            <BlockTaskItem key={t.id} task={t} onOpen={onTaskOpen} />
          ))}
        </ul>
      )}
      {block.source === 'SCHEDULE' && (
        <div className="faint small" style={{ marginTop: 2 }}>
          固定课程{block.notes ? ` · ${block.notes}` : ''}
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

/** Generic droppable region carrying arbitrary drop data (e.g. the 待排 panel). */
export function DropZone({
  id,
  data,
  className,
  style,
  children,
}: {
  id: string;
  data: Record<string, unknown>;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data });
  return (
    <div
      ref={setNodeRef}
      className={`${className ?? ''} ${isOver ? 'drag-over' : ''}`}
      style={style}
    >
      {children}
    </div>
  );
}

/** A task line inside a block card — checkbox completes it, title drags it back out. */
function BlockTaskItem({
  task,
  onOpen,
}: {
  task: Task;
  onOpen?: (task: Task) => void;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { kind: 'task', taskId: task.id },
  });
  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen ? () => onOpen(task) : undefined}
      className={`block-task-item ${isDragging ? 'dragging' : ''}`}
      title={onOpen ? '点击查看详情，拖动可移回待排' : '拖动可移回待排'}
    >
      <button
        className={`checkbox ${task.status === 'DONE' ? 'checked' : ''}`}
        aria-label={task.status === 'DONE' ? '重新打开任务' : '完成任务'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (task.status === 'DONE') void repos.taskRepo.reopen(task.id);
          else void repos.taskRepo.complete(task.id);
        }}
      >
        {task.status === 'DONE' ? '✓' : ''}
      </button>
      <span
        className={`block-task-title ${task.status === 'DONE' ? 'done' : ''}`}
        style={{ cursor: onOpen ? 'pointer' : 'grab' }}
        title={onOpen ? '点击查看详情，拖动可移回待排' : '拖动可移回待排'}
        onClick={(e) => {
          if (!onOpen) return;
          e.stopPropagation();
          onOpen(task);
        }}
      >
        {task.title}
      </span>
    </li>
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
