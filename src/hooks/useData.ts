import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type {
  Block,
  Course,
  Milestone,
  Project,
  Settings,
  Task,
  WeeklyOutcome,
  WeeklyReview,
} from '../domain/types';
import { db } from '../storage/db';
import * as repos from '../storage/repositories';
import { seedIfFirstLaunch } from '../storage/seed';

export interface AppData {
  courses: Course[];
  projects: Project[];
  milestones: Milestone[];
  tasks: Task[];
  blocks: Block[];
  outcomes: WeeklyOutcome[];
  reviews: WeeklyReview[];
  settings: Settings | undefined;
  loading: boolean;
}

/**
 * Seeding runs once in an effect (NOT inside a liveQuery — Dexie liveQuery
 * queriers are read-only transactions). All live queries below re-fire when
 * the seed transaction commits.
 */
function useSeeded(): boolean {
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    seedIfFirstLaunch()
      .then(() => setSeeded(true))
      .catch((err) => {
        console.error('Seed failed', err);
        setSeeded(true); // still render; user can import data
      });
  }, []);
  return seeded;
}

export function useAppData(): AppData {
  const seeded = useSeeded();

  const courses = useLiveQuery(() => repos.courseRepo.list(), [], []);
  const projects = useLiveQuery(() => repos.projectRepo.list(), [], []);
  const milestones = useLiveQuery(() => repos.milestoneRepo.list(), [], []);
  const tasks = useLiveQuery(() => repos.taskRepo.list(), [], []);
  const blocks = useLiveQuery(() => repos.blockRepo.list(), [], []);
  const outcomes = useLiveQuery(() => repos.outcomeRepo.list(), [], []);
  const reviews = useLiveQuery(() => db.reviews.toArray(), [], []);
  const settings = useLiveQuery(() => repos.settingsRepo.get(), [], undefined);

  const loading = !seeded || settings === undefined;
  return {
    courses,
    projects,
    milestones,
    tasks,
    blocks,
    outcomes,
    reviews,
    settings,
    loading,
  };
}

export function useTaskMap(tasks: Task[]): Map<string, Task> {
  return new Map(tasks.map((t) => [t.id, t]));
}
