import type { Task } from '../../domain/types';
import type { PlankaClient } from './client';
import { makeListIdResolver, PlankaAdapter, type ExecutionTask } from './adapter';

/**
 * Manual sync helpers. Deliberately NOT auto-wired into the UI data flow:
 * the execution layer only acts when the user asks for it, matching the
 * app's "system recommends, user decides" principle.
 */

export interface PullReport {
  imported: number;
  skipped: number;
}

/**
 * Pull cards from the configured board and import them as local tasks.
 * Dedupe is naive (exact title match) — a real sync would need a
 * remote-id field on the local Task, which schemaVersion 1 doesn't have.
 */
export async function pullCardsAsTasks(
  client: PlankaClient,
  existingTasks: Task[],
  createTask: (input: { title: string; notes?: string; status: 'READY' | 'DONE' }) => Promise<unknown>,
): Promise<PullReport> {
  const adapter = new PlankaAdapter(client, makeListIdResolver(client));
  const remote = await adapter.fetchTasks();
  const knownTitles = new Set(existingTasks.map((t) => t.title));

  let imported = 0;
  let skipped = 0;
  for (const card of remote) {
    if (knownTitles.has(card.title)) {
      skipped++;
      continue;
    }
    await createTask({
      title: card.title,
      notes: card.notes,
      status: card.done ? 'DONE' : 'READY',
    });
    imported++;
  }
  return { imported, skipped };
}

/** Push one local task to the configured Planka list. Returns the remote card id. */
export async function pushTaskAsCard(
  client: PlankaClient,
  task: Task,
): Promise<{ cardId: string }> {
  const adapter = new PlankaAdapter(client, makeListIdResolver(client));
  const created = await adapter.createTask({
    title: task.title,
    notes: task.notes,
  });
  if (task.status === 'DONE') {
    await adapter.completeTask(created.id);
  }
  return { cardId: created.id };
}

export type { ExecutionTask };
