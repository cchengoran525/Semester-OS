import { useState } from 'react';
import { useApp } from '../components/AppProvider';
import { EmptyState, HealthDot } from '../components/common';
import * as repos from '../storage/repositories';
import { useQuickAdd, useToast } from '../store/uiStore';
import { HEALTH_LABELS, type Course, type Health } from '../domain/types';
import { debtSummary, suggestHealth } from '../services/courseService';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const REC = { WEEKLY: '每周', ODD_WEEK: '单周', EVEN_WEEK: '双周' } as const;

const DEBT_FIELDS = [
  { key: 'understanding', label: '理解' },
  { key: 'assignment', label: '作业' },
  { key: 'review', label: '复习' },
  { key: 'exam', label: '考试' },
] as const;

export function CoursesPage() {
  const { courses } = useApp();
  const show = useToast((s) => s.show);
  const openQuickAdd = useQuickAdd((s) => s.open);
  const [openId, setOpenId] = useState<string | null>(null);

  const updateDebt = (c: Course, key: (typeof DEBT_FIELDS)[number]['key'], delta: number) => {
    const next = Math.max(0, c.debt[key] + delta);
    repos.courseRepo.update(c.id, { debt: { ...c.debt, [key]: next } });
  };

  return (
    <div>
      <div className="page-header">
        <h1>课程</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span className="sub">共 {courses.length} 门课程</span>
          <button className="btn primary" onClick={() => openQuickAdd('course')}>
            + 新建课程
          </button>
        </div>
      </div>

      {courses.length === 0 && <EmptyState>这里还没有课程。点右上角「+ 新建课程」开始。</EmptyState>}

      {courses.map((c) => {
        const suggested = suggestHealth(c.debt);
        const open = openId === c.id;
        return (
          <section
            className="panel"
            key={c.id}
            style={{ marginBottom: 10, cursor: open ? 'default' : 'pointer' }}
            onClick={open ? undefined : () => setOpenId(c.id)}
          >
            {/* 整个面板可点；展开后不再劫持内部按钮 */}
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
            >
              <span style={{ fontWeight: 600 }}>
                <HealthDot health={c.health} />
                {c.name}
              </span>
              <span className="small muted">{debtSummary(c.debt)}</span>
            </div>

            <div className="faint small" style={{ marginTop: 4 }}>
              {c.schedule
                .map(
                  (s) =>
                    `周${WEEKDAYS[s.weekday - 1]} ${s.startTime}–${s.endTime} ${REC[s.recurrence]}${s.location ? ` · ${s.location}` : ''}`,
                )
                .join('　·　')}
              {c.schedule.length === 0 && '无固定时间'}
            </div>

            {open && (
              <div style={{ marginTop: 10 }}>
                <div className="small muted" style={{ marginBottom: 6 }}>
                  健康度（手动确认）· 系统建议:{' '}
                  <span className="mono">{HEALTH_LABELS[suggested]}</span>
                  {suggested !== c.health && (
                    <span className="faint">（当前为 {HEALTH_LABELS[c.health]}，可根据债务情况调整）</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  {(['GREEN', 'YELLOW', 'RED'] as Health[]).map((h) => (
                    <button
                      key={h}
                      className={`btn small ${c.health === h ? 'primary' : 'subtle'}`}
                      onClick={() => repos.courseRepo.update(c.id, { health: h })}
                    >
                      {HEALTH_LABELS[h]}
                    </button>
                  ))}
                  {/* 健康度是手动确认的；系统只建议，一键采纳 */}
                  {suggested !== c.health && (
                    <button
                      className="btn small"
                      onClick={() => {
                        repos.courseRepo.update(c.id, { health: suggested });
                        show(`已采纳系统建议：${HEALTH_LABELS[suggested]}`);
                      }}
                    >
                      采用系统建议（{HEALTH_LABELS[suggested]}）
                    </button>
                  )}
                </div>

                {DEBT_FIELDS.map(({ key, label }) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span className="mono small muted" style={{ width: 120 }}>
                      {label}债务
                    </span>
                    <button className="btn small" onClick={() => updateDebt(c, key, -1)} aria-label={`减少 ${label} 债务`}>
                      −
                    </button>
                    <span className="mono">{c.debt[key]}</span>
                    <button className="btn small" onClick={() => updateDebt(c, key, 1)} aria-label={`增加 ${label} 债务`}>
                      +
                    </button>
                  </div>
                ))}

                <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                  <button
                    className="btn small danger"
                    onClick={() => {
                      if (window.confirm(`确定删除课程「${c.name}」？`)) {
                        repos.courseRepo.remove(c.id);
                        show('课程已删除');
                      }
                    }}
                  >
                    删除课程
                  </button>
                </div>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
