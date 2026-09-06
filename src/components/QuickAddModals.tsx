import { useEffect, useState } from 'react';
import {
  BLOCK_TYPE_LABELS,
  ESTIMATES_ALLOWED,
  PRIORITY_LABELS,
  type BlockType,
  type Priority,
  type ProjectStatus,
  type Recurrence,
} from '../domain/types';
import * as repos from '../storage/repositories';
import { useAppData } from '../hooks/useData';
import { useQuickAdd, useToast } from '../store/uiStore';
import { Modal } from './common';
import { atTime, toISODate } from '../services/timeService';
import { conflictsWith } from '../services/scheduler';
import { wipStatus } from '../services/projectService';

function Actions({ onCancel, onSave }: { onCancel: () => void; onSave: () => void }) {
  return (
    <div className="actions">
      <button className="btn subtle" onClick={onCancel}>
        取消
      </button>
      <button className="btn primary" onClick={onSave}>
        保存
      </button>
    </div>
  );
}

const MACRO_HINTS = ['学', '复习', '练习', '做', '写', '看'];
function isMacroTask(title: string): boolean {
  return title.trim().length <= 5 && MACRO_HINTS.some((h) => title.startsWith(h));
}

export function QuickAddModals() {
  const kind = useQuickAdd((s) => s.kind);
  return (
    <>
      {kind === 'task' && <TaskModal />}
      {kind === 'block' && <BlockModal />}
      {kind === 'project' && <ProjectModal />}
      {kind === 'course' && <CourseModal />}
    </>
  );
}

function TaskModal() {
  const close = useQuickAdd((s) => s.close);
  const show = useToast((s) => s.show);
  const { projects, courses } = useAppData();
  const presetProjectId = useQuickAdd((s) => s.presetProjectId);
  const presetCourseId = useQuickAdd((s) => s.presetCourseId);

  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState(presetProjectId ?? '');
  const [courseId, setCourseId] = useState(presetCourseId ?? '');
  const [estimate, setEstimate] = useState(60);
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    setTitle('');
    setProjectId(presetProjectId ?? '');
    setCourseId(presetCourseId ?? '');
    setEstimate(60);
    setPriority('MEDIUM');
    setDueDate('');
  }, [presetProjectId, presetCourseId]);

  const save = async () => {
    if (!title.trim()) {
      show('请填写任务标题', 'error');
      return;
    }
    if (isMacroTask(title)) {
      show('这个任务可能太大，建议拆成可执行的工作单元（如「完成 2.3 节习题 8/11/15」）');
    }
    await repos.taskRepo.create({
      title: title.trim(),
      projectId: projectId || undefined,
      courseId: courseId || undefined,
      estimateMinutes: estimate,
      priority,
      status: 'READY',
      dueDate: dueDate || undefined,
    });
    close();
  };

  return (
    <Modal title="新建任务" onClose={close}>
      <label className="field">
        <span>标题</span>
        <input
          autoFocus
          value={title}
          placeholder="例如：给 AS 中翼舵机安装座建立 v0.3 CAD"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field">
          <span>项目</span>
          <select value={projectId} onChange={(e) => { setProjectId(e.target.value); if (e.target.value) setCourseId(''); }}>
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
          <select value={courseId} onChange={(e) => { setCourseId(e.target.value); if (e.target.value) setProjectId(''); }}>
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
        <label className="field" style={{ gridColumn: '1 / -1' }}>
          <span>截止日期（可选）</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
      </div>
      <Actions onCancel={close} onSave={save} />
    </Modal>
  );
}

const BLOCK_TYPES: BlockType[] = ['DEEP_WORK', 'ENGINEERING', 'COURSE', 'ADMIN', 'ENGLISH', 'RECOVERY'];

function BlockModal() {
  const close = useQuickAdd((s) => s.close);
  const show = useToast((s) => s.show);
  const { projects, courses, blocks, settings } = useAppData();
  const [date, setDate] = useState(toISODate(new Date()));
  const [startTime, setStartTime] = useState('14:00');
  const [endTime, setEndTime] = useState('16:00');
  const [type, setType] = useState<BlockType>('DEEP_WORK');
  const [context, setContext] = useState('');
  const [energy, setEnergy] = useState(4);
  const [taskIds, setTaskIds] = useState<string[]>([]);

  const openTasks = useAppData().tasks.filter((t) => t.status === 'READY' || t.status === 'DOING');
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const save = async () => {
    if (endTime <= startTime) {
      show('结束时间需要晚于开始时间', 'error');
      return;
    }
    const start = atTime(date, startTime);
    const end = atTime(date, endTime);
    const clash = conflictsWith({ start, end }, blocks);
    if (clash.length > 0) {
      show(`时间冲突：已有 Block ${clash[0].start.slice(11, 16)}–${clash[0].end.slice(11, 16)}。可调整时间或保留冲突。`, 'error');
      return;
    }
    await repos.blockRepo.create({
      start,
      end,
      type,
      source: 'USER',
      context: context || undefined,
      taskIds,
      energy,
      status: 'PLANNED',
      plannedMinutes: Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000),
    });
    for (const id of taskIds) {
      await repos.taskRepo.update(id, { status: 'DOING' });
    }
    void settings;
    close();
  };

  return (
    <Modal title="新建时间块" onClose={close}>
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
        <span>关联任务（可选）</span>
        <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 5, padding: 4 }}>
          {openTasks.length === 0 && <span className="faint small">暂无待办任务</span>}
          {openTasks.map((t) => (
            <label key={t.id} className="small modal-task-row">
              <input
                type="checkbox"
                checked={taskIds.includes(t.id)}
                onChange={(e) =>
                  setTaskIds(e.target.checked ? [...taskIds, t.id] : taskIds.filter((x) => x !== t.id))
                }
              />
              <span className="modal-task-title">{t.title}</span>
              <span className="faint modal-task-context">
                {t.projectId ? projectById.get(t.projectId)?.name : courseById.get(t.courseId ?? '')?.name ?? ''}
              </span>
            </label>
          ))}
        </div>
      </label>
      <Actions onCancel={close} onSave={save} />
    </Modal>
  );
}

function ProjectModal() {
  const close = useQuickAdd((s) => s.close);
  const show = useToast((s) => s.show);
  const { projects, settings } = useAppData();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('BACKLOG');
  const [priority, setPriority] = useState<Priority>('MEDIUM');

  const wip = wipStatus(projects, settings?.wipLimit ?? 2);
  const hint =
    status === 'ACTIVE' && wip.atLimit
      ? `已有 ${wip.activeCount} 个进行中项目（WIP ${wip.activeCount}/${wip.limit}），建议新项目进入待启动。`
      : null;

  const save = async () => {
    if (!name.trim()) {
      show('请填写项目名称', 'error');
      return;
    }
    const p = await repos.projectRepo.create({
      name: name.trim(),
      description: description.trim() || undefined,
      status,
      priority,
    });
    if (status === 'ACTIVE') await repos.milestoneRepo.create({ projectId: p.id, name: 'M0', order: 0, status: 'TODO' });
    close();
  };

  return (
    <Modal title="新建项目" onClose={close}>
      <label className="field">
        <span>名称</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>描述</span>
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field">
          <span>状态</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
            <option value="BACKLOG">待启动</option>
            <option value="ACTIVE">进行中</option>
            <option value="PAUSED">已暂停</option>
            <option value="DONE">已完成</option>
          </select>
        </label>
        <label className="field">
          <span>优先级</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            <option value="HIGH">高</option>
            <option value="MEDIUM">中</option>
            <option value="LOW">低</option>
          </select>
        </label>
      </div>
      {hint && <div className="warning-banner">⚠ {hint}</div>}
      <Actions onCancel={close} onSave={save} />
    </Modal>
  );
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function CourseModal() {
  const close = useQuickAdd((s) => s.close);
  const show = useToast((s) => s.show);
  const [name, setName] = useState('');
  const [teacher, setTeacher] = useState('');
  const [weekday, setWeekday] = useState(1);
  const [startTime, setStartTime] = useState('15:00');
  const [endTime, setEndTime] = useState('16:00');
  const [recurrence, setRecurrence] = useState<Recurrence>('WEEKLY');

  const save = async () => {
    if (!name.trim()) {
      show('请填写课程名称', 'error');
      return;
    }
    await repos.courseRepo.create({
      name: name.trim(),
      teacher: teacher.trim() || undefined,
      schedule: [{ weekday, startTime, endTime, recurrence }],
      health: 'GREEN',
      debt: { understanding: 0, assignment: 0, review: 0, exam: 0 },
    });
    close();
  };

  return (
    <Modal title="新建课程" onClose={close}>
      <label className="field">
        <span>名称</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>教师（可选）</span>
        <input value={teacher} onChange={(e) => setTeacher(e.target.value)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
        <label className="field">
          <span>星期</span>
          <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
            {WEEKDAYS.map((d, i) => (
              <option key={i} value={i + 1}>
                周{d}
              </option>
            ))}
          </select>
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
          <span>重复</span>
          <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
            <option value="WEEKLY">每周</option>
            <option value="ODD_WEEK">单周</option>
            <option value="EVEN_WEEK">双周</option>
          </select>
        </label>
      </div>
      <Actions onCancel={close} onSave={save} />
    </Modal>
  );
}
