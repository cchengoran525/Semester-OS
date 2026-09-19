import { useState } from 'react';
import { useApp } from './AppProvider';
import { Modal } from './common';
import * as repos from '../storage/repositories';
import { useToast } from '../store/uiStore';
import {
  ESTIMATES_ALLOWED,
  PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  type Priority,
  type Task,
} from '../domain/types';
import { durationLabel } from '../services/timeService';

/**
 * 任务详情弹窗：任务页 / 总览 / 项目页 / 日历 / 复盘共用。整卡点击即可打开。
 * 编辑用本地草稿 + 「保存」整体提交，避免输入法逐键写库；
 * 保存走 patch 语义，只覆盖表单里出现过的字段，不会清掉并发修改。
 */
export function TaskDetailModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const { projects, courses, tasks } = useApp();
  const show = useToast((s) => s.show);
  // 打开期间底层任务若变化（比如在块里被勾完成），只读区以库里最新为准
  const fresh = tasks.find((t) => t.id === task.id) ?? task;

  const [title, setTitle] = useState(fresh.title);
  const [projectId, setProjectId] = useState(fresh.projectId ?? '');
  const [courseId, setCourseId] = useState(fresh.courseId ?? '');
  const [estimate, setEstimate] = useState(
    (ESTIMATES_ALLOWED as readonly number[]).includes(fresh.estimateMinutes)
      ? fresh.estimateMinutes
      : 60,
  );
  const [priority, setPriority] = useState<Priority>(fresh.priority);
  const [dueDate, setDueDate] = useState(fresh.dueDate ?? '');
  const [notes, setNotes] = useState(fresh.notes ?? '');
  const [actualInput, setActualInput] = useState(
    fresh.actualMinutes != null ? String(fresh.actualMinutes) : '',
  );

  const saveFields = async (): Promise<boolean> => {
    if (!title.trim()) {
      show('标题不能为空', 'error');
      return false;
    }
    await repos.taskRepo.update(task.id, {
      title: title.trim(),
      projectId: projectId || undefined,
      courseId: courseId || undefined,
      estimateMinutes: estimate,
      priority,
      dueDate: dueDate || undefined,
      notes: notes.trim() || undefined,
      ...(fresh.status === 'DONE'
        ? { actualMinutes: actualInput ? Number(actualInput) : undefined }
        : {}),
    });
    return true;
  };

  const save = async () => {
    if (!(await saveFields())) return;
    show('已保存');
    onClose();
  };

  return (
    <Modal title="任务详情" onClose={onClose}>
      <label className="field">
        <span>标题</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field">
          <span>项目</span>
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              if (e.target.value) setCourseId('');
            }}
          >
            <option value="">—</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>课程</span>
          <select
            value={courseId}
            onChange={(e) => {
              setCourseId(e.target.value);
              if (e.target.value) setProjectId('');
            }}
          >
            <option value="">—</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>预估用时</span>
          <select value={estimate} onChange={(e) => setEstimate(Number(e.target.value))}>
            {ESTIMATES_ALLOWED.map((m) => (
              <option key={m} value={m}>
                {m} 分钟
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>优先级</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {(['HIGH', 'MEDIUM', 'LOW'] as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>截止日期（可选）</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label className="field">
          <span>实际用时·分钟{fresh.status === 'DONE' ? '' : '（完成时记录）'}</span>
          <input
            type="number"
            value={actualInput}
            onChange={(e) => setActualInput(e.target.value)}
            placeholder={fresh.status === 'DONE' ? '实际用了多久？' : '留空 = 不记录'}
          />
        </label>
      </div>
      <label className="field">
        <span>备注</span>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="补充说明、验收标准…" />
      </label>

      <div className="small muted" style={{ marginBottom: 8 }}>
        状态：{TASK_STATUS_LABELS[fresh.status]}
        {fresh.status !== 'DONE' && ' · 完成请用下面的「完成」按钮（会记录实际用时）'}
        {fresh.estimateMinutes > 0 && (
          <span className="mono"> · 预估 {durationLabel(fresh.estimateMinutes)}</span>
        )}
      </div>

      <div className="actions">
        {fresh.status !== 'DONE' && (
          <button
            className="btn subtle"
            onClick={async () => {
              await repos.taskRepo.update(task.id, { status: 'BACKLOG' });
              onClose();
              show('已移回待定');
            }}
          >
            移回待定
          </button>
        )}
        <button
          className="btn subtle"
          onClick={async () => {
            await repos.taskRepo.remove(task.id);
            onClose();
            show('任务已删除');
          }}
        >
          删除
        </button>
        {fresh.status === 'DONE' ? (
          <button
            className="btn primary"
            onClick={async () => {
              if (!(await saveFields())) return;
              await repos.taskRepo.reopen(task.id);
              onClose();
              show('已重新打开');
            }}
          >
            重新打开
          </button>
        ) : (
          <button
            className="btn primary"
            onClick={async () => {
              if (!(await saveFields())) return;
              await repos.taskRepo.complete(task.id, actualInput ? Number(actualInput) : undefined);
              onClose();
            }}
          >
            完成
          </button>
        )}
        {fresh.status !== 'DONE' && (
          <button className="btn" onClick={save}>
            保存
          </button>
        )}
      </div>
    </Modal>
  );
}
