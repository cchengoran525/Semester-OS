import Dexie, { type Table } from 'dexie';
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

export class SemesterDB extends Dexie {
  courses!: Table<Course, string>;
  projects!: Table<Project, string>;
  milestones!: Table<Milestone, string>;
  tasks!: Table<Task, string>;
  blocks!: Table<Block, string>;
  weeklyOutcomes!: Table<WeeklyOutcome, string>;
  reviews!: Table<WeeklyReview, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('semester-os');
    this.version(1).stores({
      courses: 'id, name',
      projects: 'id, name, status',
      milestones: 'id, projectId, order',
      tasks: 'id, status, projectId, courseId, dueDate',
      blocks: 'id, start, end, type, status',
      weeklyOutcomes: 'id, weekId, status',
      reviews: 'id, weekId',
      settings: 'id',
    });
  }
}

export const db = new SemesterDB();
