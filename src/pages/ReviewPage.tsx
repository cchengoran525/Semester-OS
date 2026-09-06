import { useEffect, useMemo, useRef, useState } from 'react';
import { addWeeks } from 'date-fns';
import { useApp } from '../components/AppProvider';
import { EmptyState, HealthDot, AIThinking } from '../components/common';
import { makeLabelResolver } from '../components/labels';
import * as repos from '../storage/repositories';
import { useToast, useUndo } from '../store/uiStore';
import { BLOCK_TYPE_LABELS, HEALTH_LABELS, REVIEW_QUESTIONS, type ReviewQuestionKey } from '../domain/types';
import { attentionAllocation, deepWorkBreakdown, filterBlocks } from '../services/statistics';
import { atTime, durationLabel, formatDateShort, getWeekInfo, todayDate } from '../services/timeService';
import { courseWarnings, debtSummary } from '../services/courseService';
import { aiConfig } from '../services/ai/config';
import { draftWeeklyReview } from '../services/ai/features';

export function ReviewPage() {
  const { courses, projects, milestones, tasks, blocks, reviews, settings } = useApp();
  const show = useToast((s) => s.show);
  const push = useUndo((s) => s.push);
  const [weekOffset, setWeekOffset] = useState(0);
  const [answers, setAnswers] = useState<Partial<Record<ReviewQuestionKey, string>>>({});
  const [loadedWeekId, setLoadedWeekId] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const aiCfg = aiConfig(settings);

  const week = useMemo(
    () => getWeekInfo(addWeeks(todayDate(), weekOffset), settings?.weekStartDay ?? 1),
    [weekOffset, settings?.weekStartDay],
  );

  const review = reviews.find((r) => r.weekId === week.id);
  // 切周必须重置表单：没存过复盘的周显示空白，而不是残留上一周的答案
  if (loadedWeekId !== week.id) {
    setLoadedWeekId(week.id);
    setAnswers(review ? review.answers : {});
  }
  // ref 版本，供异步回调（撤销）判断"当前周"而不被闭包过期值误导
  const loadedWeekIdRef = useRef(loadedWeekId);
  loadedWeekIdRef.current = loadedWeekId;

  const weekFrom = atTime(week.startDate, '00:00');
  const weekTo = atTime(week.endDate, '23:59');
  const weekBlocks = useMemo(
    () => filterBlocks(blocks, { from: weekFrom, to: weekTo }),
    [blocks, weekFrom, weekTo],
  );

  const completedTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.status === 'DONE' &&
          t.completedAt != null &&
          t.completedAt.slice(0, 10) >= week.startDate &&
          t.completedAt.slice(0, 10) <= week.endDate,
      ),
    [tasks, week],
  );

  const deepWork = useMemo(() => deepWorkBreakdown(weekBlocks), [weekBlocks]);
  const allocation = useMemo(() => attentionAllocation(weekBlocks), [weekBlocks]);
  const warnings = useMemo(() => courseWarnings(courses), [courses]);
  const labels = useMemo(() => makeLabelResolver(projects, courses), [projects, courses]);

  const projectProgressLines = useMemo(
    () =>
      projects
        .filter((p) => p.status === 'ACTIVE')
        .map((p) => {
          const done = milestones.filter(
            (m) => m.projectId === p.id && m.status === 'DONE',
          ).length;
          const taskDone = tasks.filter((t) => t.projectId === p.id && t.status === 'DONE').length;
          return `${p.name} · 里程碑 +${done} / 任务 +${taskDone}`;
        }),
    [projects, milestones, tasks],
  );

  const save = async (weekId: string, snapshot: Partial<Record<ReviewQuestionKey, string>>) => {
    await repos.reviewRepo.save({
      id: weekId,
      weekId,
      answers: snapshot,
      createdAt: new Date().toISOString(),
    });
    setSavedAt(
      new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
    );
  };

  // ── 自动保存：填了就存（600ms 防抖），没有"保存"这个动作 ──
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<{ weekId: string; answers: Partial<Record<ReviewQuestionKey, string>> } | null>(null);

  const flushPending = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) void save(pending.weekId, pending.answers);
  };

  // 切周 / 离开页面前，把尚未落库的输入先写掉（按编辑时所属的周）
  useEffect(() => {
    return () => flushPending();
  }, [week.id]);

  const scheduleSave = (snapshot: Partial<Record<ReviewQuestionKey, string>>) => {
    const weekId = week.id;
    pendingRef.current = { weekId, answers: snapshot };
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(async () => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      timerRef.current = null;
      if (!pending) return;
      const prev = (await repos.reviewRepo.get(pending.weekId))?.answers ?? {};
      await save(pending.weekId, pending.answers);
      push({
        label: '修改复盘',
        undo: async () => {
          await repos.reviewRepo.save({
            id: pending.weekId,
            weekId: pending.weekId,
            answers: prev,
            createdAt: new Date().toISOString(),
          });
        },
      });
    }, 600);
  };

  const updateAnswer = (key: ReviewQuestionKey, value: string) => {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    scheduleSave(next);
  };

  const clearAnswers = async () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = null;
    const weekId = week.id;
    const prev = (await repos.reviewRepo.get(weekId))?.answers ?? {};
    setAnswers({});
    await save(weekId, {});
    push({
      label: '清空复盘',
      undo: async () => {
        await repos.reviewRepo.save({
          id: weekId,
          weekId,
          answers: prev,
          createdAt: new Date().toISOString(),
        });
        if (loadedWeekIdRef.current === weekId) setAnswers(prev);
      },
    });
    show('已清空本周问卷 · ⌘Z 可撤销');
  };

  const draftWithAI = async () => {
    if (!aiCfg) return;
    const hasContent = REVIEW_QUESTIONS.some((q) => (answers[q.key] ?? '').trim());
    if (hasContent && !window.confirm('AI 起草会覆盖当前问卷里已填写的内容，继续？')) return;
    setAiBusy(true);
    try {
      const draft = await draftWeeklyReview(aiCfg, {
        weekLabel: `第 ${week.weekNumber} 周（${week.startDate} → ${week.endDate}）`,
        completedTasks: completedTasks.map((t) => ({
          title: t.title,
          context: labels.taskContext(t) ?? undefined,
          estimateMinutes: t.estimateMinutes,
          actualMinutes: t.actualMinutes,
        })),
        deepWorkMinutes: deepWork.totalMinutes,
        deepWorkByContext: deepWork.byContext,
        allocation: allocation.map((a) => ({
          label: BLOCK_TYPE_LABELS[a.type],
          percent: a.percent,
        })),
        courses: courses.map((c) => ({
          name: c.name,
          health: HEALTH_LABELS[c.health],
          debt: debtSummary(c.debt),
        })),
        activeProjects: projects
          .filter((p) => p.status === 'ACTIVE')
          .map((p) => ({
            name: p.name,
            progress: `里程碑 ${
              milestones.filter((m) => m.projectId === p.id && m.status === 'DONE').length
            } 完成`,
          })),
        warnings: warnings.map((w) => w.message),
      });
      const next = { ...answers, ...draft };
      setAnswers(next);
      scheduleSave(next);
      show('AI 草稿已填入，自动保存中');
    } catch (e) {
      show(`AI 起草失败：${(e as Error).message}`, 'error');
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1>每周复盘</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span className="sub">第 {String(week.weekNumber).padStart(2, '0')} 周</span>
          <button className="btn small" onClick={() => setWeekOffset(weekOffset - 1)}>‹</button>
          <button className="btn small" onClick={() => setWeekOffset(0)}>本周</button>
          <button className="btn small" onClick={() => setWeekOffset(weekOffset + 1)}>›</button>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <h2>已完成 · {week.startDate} → {week.endDate}</h2>
          <div className="mono" style={{ marginBottom: 4 }}>
            完成任务数：<strong>{completedTasks.length}</strong>
          </div>
          <div className="mono">
            深度工作：<strong>{durationLabel(deepWork.totalMinutes)}</strong>
          </div>
          {completedTasks.length > 0 && (
            <div style={{ margin: '8px 0 4px' }}>
              <div className="faint small" style={{ marginBottom: 4 }}>
                这周做成了什么 · 左右滑动看更多
              </div>
              <div className="sticky-strip">
                {completedTasks.map((t) => (
                  <div key={t.id} className="sticky-note">
                    <div className="sticky-title">☑ {t.title}</div>
                    <div className="mono small">
                      {labels.taskContext(t) ?? '未关联'}
                      {t.actualMinutes != null && ` · ${durationLabel(t.actualMinutes)}`}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {Object.entries(deepWork.byContext)
            .sort((a, b) => b[1] - a[1])
            .map(([ctx, mins]) => (
              <div key={ctx} className="mono small muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{labels.contextLabel(ctx)}</span>
                <span>{durationLabel(mins)}</span>
              </div>
            ))}
          <h2 style={{ marginTop: 16 }}>预估 vs 实际</h2>
          <div className="faint small" style={{ marginBottom: 4 }}>
            系统预估的用时 vs 你完成后记录的真实用时 —— 差距越大，下次预估就该越保守。
          </div>
          {completedTasks.filter((t) => t.actualMinutes != null && t.estimateMinutes > 0).length === 0 && (
            <div className="faint small">这周还没有记录实际用时的任务。完成任务时填一下「实际用时」就会出现在这里。</div>
          )}
          {completedTasks
            .filter((t) => t.actualMinutes != null && t.estimateMinutes > 0)
            .slice(0, 8)
            .map((t) => (
              <div key={t.id} className="mono small muted">
                {t.title}：{t.estimateMinutes} 分钟 → {t.actualMinutes} 分钟
              </div>
            ))}
        </section>

        <section className="panel">
          <h2>课程</h2>
          {courses.map((c) => (
            <div key={c.id} className="small">
              <HealthDot health={c.health} />
              {c.name} <span className="mono faint">{HEALTH_LABELS[c.health]}</span>
            </div>
          ))}
          <h2 style={{ marginTop: 16 }}>项目</h2>
          {projectProgressLines.map((l) => (
            <div key={l} className="small muted">
              {l}
            </div>
          ))}
          <h2 style={{ marginTop: 16 }}>注意力分配</h2>
          {allocation.length === 0 && <EmptyState>本周没有时间块数据。</EmptyState>}
          {allocation.map((a) => (
            <div key={a.type} className="mono small muted">
              {BLOCK_TYPE_LABELS[a.type]} {a.percent}% ({durationLabel(a.minutes)})
            </div>
          ))}
          {warnings.length > 0 && (
            <div className="warning-banner" style={{ marginTop: 12 }}>
              风险课程：{warnings.map((w) => w.courseName).join('、')}
            </div>
          )}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 14 }}>
        <h2>复盘问卷 · {formatDateShort(atTime(week.startDate, '00:00'))}</h2>
        <AIThinking active={aiBusy} />
        {REVIEW_QUESTIONS.map((q) => (
          <label className="field" key={q.key}>
            <span>{q.text}</span>
            <textarea
              rows={2}
              value={answers[q.key] ?? ''}
              onChange={(e) => updateAnswer(q.key, e.target.value)}
            />
          </label>
        ))}
        <div className="actions">
          <button
            className="btn subtle"
            disabled={aiBusy}
            title={aiCfg ? undefined : '先在 设置 → AI 助手 里配置接口'}
            onClick={draftWithAI}
          >
            {aiBusy ? 'AI 思考中…' : 'AI 起草'}
          </button>
          <button className="btn subtle" onClick={clearAnswers}>
            清空
          </button>
          <span className="faint small" style={{ alignSelf: 'center' }}>
            {savedAt ? `已自动保存 ${savedAt}` : '填写后自动保存'}
          </span>
        </div>
      </section>
    </div>
  );
}
