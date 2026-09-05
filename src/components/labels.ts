import type { Course, Project, Task } from '../domain/types';

export function makeLabelResolver(projects: Project[], courses: Course[]) {
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  return {
    contextLabel(context?: string): string {
      if (!context) return '—';
      return (
        projectById.get(context)?.name ??
        courseById.get(context)?.name ??
        context
      );
    },
    taskContext(task: Task): string | undefined {
      if (task.projectId) return projectById.get(task.projectId)?.name;
      if (task.courseId) return courseById.get(task.courseId)?.name;
      return undefined;
    },
    projectById,
    courseById,
  };
}
