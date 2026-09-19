import { useMemo, useState } from 'react';
import { useApp } from './AppProvider';
import { Modal } from './common';
import * as repos from '../storage/repositories';
import { useToast, useUndo } from '../store/uiStore';
import {
  BLOCK_SOURCE_LABELS,
  BLOCK_TYPE_LABELS,
  type Block,
  type BlockType,
} from '../domain/types';
import { atTime } from '../services/timeService';
import { conflictsWith } from '../services/scheduler';
import { removeBlockWithUndo } from '../services/dropActions';

const BLOCK_TYPES: BlockType[] = ['DEEP_WORK', 'ENGINEERING', 'COURSE', 'ADMIN', 'ENGLISH', 'RECOVERY'];

/**
 * 时间块详情弹窗：日历页 / 总览共用（固定课程块不开放）。
 * 与任务详情同款约定：本地草稿 + 「保存」整体提交；挂上/移出任务是离散操作，点了立即生效。
 */
export function BlockDetailModal({ block, onClose }: { block: Block; onClose: () => void }) {
  const { projects, courses, blocks, tasks } = useApp();
  const show = useToast((s) => s.show);
  const push = useUndo((s) => s.push);
  const fresh = blocks.find((b) => b.id === block.id) ?? block;
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const [date, setDate] = useState(fresh.start.slice(0, 10));
  const [startTime, setStartTime] = useState(fresh.start.slice(11, 16));
  const [endTime, setEndTime] = useState(fresh.end.slice(11, 16));
  const [type, setType] = useState<BlockType>(fresh.type);
  const [context, setContext] = useState(fresh.context ?? '');
  const [energy, setEnergy] = useState(fresh.energy ?? 3);
  const [notes, setNotes] = useState(fresh.notes ?? '');
  const [attachId, setAttachId] = useState('');

  const draftStart = atTime(date, startTime);
  const draftEnd = atTime(date, endTime);
  const draftMinutes = Math.round((new Date(draftEnd).getTime() - new Date(draftStart).getTime()) / 60000);
  const draftClash = useMemo(
    () =>
      draftEnd > draftStart
        ? conflictsWith({ start: draftStart, end: draftEnd }, blocks.filter((b) => b.id !== fresh.id))
        : [],
    [draftStart, draftEnd, blocks, fresh.id],
  );

  // 可挂上的任务 = 未完成且还不在块里
  const attachable = tasks.filter(
    (t) => t.status !== 'DONE' && !fresh.taskIds.includes(t.id),
  );

  const save = async () => {
    if (draftEnd <= draftStart) {
      show('结束时间需要晚于开始时间', 'error');
      return;
    }
    await repos.blockRepo.update(fresh.id, {
      start: draftStart,
      end: draftEnd,
      type,
      context: context || undefined,
      energy,
      notes: notes.trim() || undefined,
      plannedMinutes: draftMinutes,
    });
    show(draftClash.length > 0 ? '已保存 · 与其他块时间重叠' : '已保存');
    onClose();
  };

  return (
    <Modal title="时间块详情" onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <label className="field">
          <span>日期</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>开始</span>
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </label>
        <label className="field">
          <span>结束</span>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </label>
        <label className="field">
          <span>类型</span>
          <select value={type} onChange={(e) => setType(e.target.value as BlockType)}>
            {BLOCK_TYPES.map((t) => (
              <option key={t} value={t}>
                {BLOCK_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>关联内容</span>
          <select value={context} onChange={(e) => setContext(e.target.value)}>
            <option value="">—</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {/* 原来是自由文本（如手输的「AS」）时保留原值，避免保存时丢掉 */}
            {fresh.context && !projectOrCourse(projects, courses, fresh.context) && (
              <option value={fresh.context}>自定义：{fresh.context}</option>
            )}
          </select>
        </label>
        <label className="field">
          <span>精力 (1–5)</span>
          <select value={energy} onChange={(e) => setEnergy(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>备注</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="这个时段要做什么…" />
      </label>

      <div className="small muted" style={{ marginBottom: 8 }}>
        {draftEnd > draftStart ? (
          <span className="mono">
            {draftMinutes} 分钟 · 来源：{BLOCK_SOURCE_LABELS[fresh.source]} · 状态：
            {fresh.status === 'DONE' ? '已完成' : fresh.status === 'ACTIVE' ? '进行中' : '已计划'}
          </span>
        ) : (
          <span className="mono">结束时间需要晚于开始时间</span>
        )}
      </div>
      {draftClash.length > 0 && (
        <div className="warning-banner">
          与其他块 {draftClash[0].start.slice(11, 16)}–{draftClash[0].end.slice(11, 16)} 重叠（仍可保存）
        </div>
      )}

      <div className="field">
        <span>块内任务 · {fresh.taskIds.length}</span>
        {fresh.taskIds.length === 0 && <span className="faint small">还没有挂任务</span>}
        <ul style={{ paddingLeft: 4, margin: '4px 0' }} className="small">
          {fresh.taskIds.map((id) => {
            const t = taskById.get(id);
            if (!t) return null;
            return (
              <li key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <button
                  className={`checkbox ${t.status === 'DONE' ? 'checked' : ''}`}
                  aria-label={t.status === 'DONE' ? '重新打开任务' : '完成任务'}
                  onClick={() =>
                    t.status === 'DONE'
                      ? void repos.taskRepo.reopen(t.id)
                      : void repos.taskRepo.complete(t.id)
                  }
                >
                  {t.status === 'DONE' ? '✓' : ''}
                </button>
                <span className={`block-task-title ${t.status === 'DONE' ? 'done' : ''}`}>{t.title}</span>
                <button
                  className="btn small subtle"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => {
                    void repos.blockRepo.detachTask(fresh.id, id);
                    show('已移出任务');
                  }}
                >
                  移出
                </button>
              </li>
            );
          })}
        </ul>
        {attachable.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <select
              value={attachId}
              onChange={(e) => setAttachId(e.target.value)}
              style={{ flex: 1 }}
              aria-label="选择要挂上的任务"
            >
              <option value="">选择任务挂到这个块…</option>
              {attachable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <button
              className="btn small"
              onClick={() => {
                if (!attachId) return;
                void repos.blockRepo.attachTask(fresh.id, attachId);
                setAttachId('');
                show('已挂上任务');
              }}
            >
              挂上
            </button>
          </div>
        )}
      </div>

      <div className="actions">
        <button
          className="btn subtle danger"
          onClick={async () => {
            const res = await removeBlockWithUndo(fresh);
            push({ label: res.message, undo: res.undo });
            onClose();
            show(`${res.message} · ⌘Z 可撤销`);
          }}
        >
          删除
        </button>
        {fresh.status !== 'DONE' && (
          <button
            className="btn"
            onClick={async () => {
              await repos.blockRepo.update(fresh.id, {
                status: 'DONE',
                actualMinutes: draftMinutes,
              });
              onClose();
              show(`时间块已完成 · 记录 ${draftMinutes} 分钟`);
            }}
          >
            完成时间块
          </button>
        )}
        <button className="btn primary" onClick={save}>
          保存
        </button>
      </div>
    </Modal>
  );
}

function projectOrCourse(
  projects: { id: string }[],
  courses: { id: string }[],
  context: string,
): boolean {
  return projects.some((p) => p.id === context) || courses.some((c) => c.id === context);
}
