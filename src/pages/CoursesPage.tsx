import { useState } from 'react';
import { useApp } from '../components/AppProvider';
import { EmptyState, HealthDot } from '../components/common';
import * as repos from '../storage/repositories';
import { useToast } from '../store/uiStore';
import type { Course, Health } from '../domain/types';
import { debtSummary, suggestHealth } from '../services/courseService';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const REC = { WEEKLY: '每周', ODD_WEEK: '单周', EVEN_WEEK: '双周' } as const;

const DEBT_FIELDS = [
  { key: 'understanding', label: 'Understanding' },
  { key: 'assignment', label: 'Assignment' },
  { key: 'review', label: 'Review' },
  { key: 'exam', label: 'Exam' },
] as const;

export function CoursesPage() {
  const { courses } = useApp();
  const show = useToast((s) => s.show);
  const [openId, setOpenId] = useState<string | null>(null);

  const updateDebt = (c: Course, key: (typeof DEBT_FIELDS)[number]['key'], delta: number) => {
    const next = Math.max(0, c.debt[key] + delta);
    repos.courseRepo.update(c.id, { debt: { ...c.debt, [key]: next } });
  };

  return (
    <div>
      <div className="page-header">
        <h1>Courses</h1>
        <span className="sub">{courses.length} courses</span>
      </div>

      {courses.length === 0 && <EmptyState>这里还没有课程。</EmptyState>}

      {courses.map((c) => {
        const suggested = suggestHealth(c.debt);
        const open = openId === c.id;
        return (
          <section className="panel" key={c.id} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                className="btn subtle"
                style={{ fontWeight: 600 }}
                onClick={() => setOpenId(open ? null : c.id)}
                aria-expanded={open}
              >
                <HealthDot health={c.health} />
                {c.name}
                <span className="mono faint small" style={{ marginLeft: 8 }}>
                  {c.health}
                </span>
              </button>
              <span className="small muted">{debtSummary(c.debt)}</span>
            </div>

            <div className="faint small" style={{ marginTop: 4 }}>
              {c.schedule
                .map(
                  (s) =>
                    `周${WEEKDAYS[s.weekday - 1]} ${s.startTime}–${s.endTime} ${REC[s.recurrence]}`,
                )
                .join('　·　')}
              {c.schedule.length === 0 && '无固定时间'}
            </div>

            {open && (
              <div style={{ marginTop: 10 }}>
                <div className="small muted" style={{ marginBottom: 6 }}>
                  Health（手动确认）· 系统建议:{' '}
                  <span className="mono">{suggested}</span>
                  {suggested !== c.health && (
                    <span className="faint">（当前为 {c.health}，可根据债务情况调整）</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  {(['GREEN', 'YELLOW', 'RED'] as Health[]).map((h) => (
                    <button
                      key={h}
                      className={`btn small ${c.health === h ? 'primary' : 'subtle'}`}
                      onClick={() => repos.courseRepo.update(c.id, { health: h })}
                    >
                      {h}
                    </button>
                  ))}
                </div>

                {DEBT_FIELDS.map(({ key, label }) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span className="mono small muted" style={{ width: 120 }}>
                      {label} Debt
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
                    Delete Course
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
