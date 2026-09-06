import type { Task } from '../../domain/types';
import type { PlankaClient, PlankaCard } from './client';

/**
 * Execution-layer adapter: maps between Semester OS tasks and Planka cards.
 * This is the seam described in the README — swap this implementation to
 * connect a different execution tool without touching UI or storage.
 *
 * Field mapping (only what has an equivalent on both sides):
 *   Task.title        ↔ card.name
 *   Task.notes        ↔ card.description
 *   Task.status=DONE  ↔ card.isCompleted
 * Estimate / priority / schedule stay local — Planka has no direct equivalent.
 */

export interface ExecutionTask {
  id: string; // remote card id
  title: string;
  notes?: string;
  done: boolean;
}

/** The same surface as the local taskRepo — a future adapter must implement this. */
export interface ExecutionLayer {
  fetchTasks(): Promise<ExecutionTask[]>;
  createTask(input: { title: string; notes?: string }): Promise<ExecutionTask>;
  updateTask(id: string, patch: Partial<Pick<ExecutionTask, 'title' | 'notes' | 'done'>>): Promise<void>;
  completeTask(id: string): Promise<void>;
  removeTask(id: string): Promise<void>;
}

export function cardToTask(card: PlankaCard): ExecutionTask {
  return {
    id: card.id,
    title: card.name,
    notes: card.description || undefined,
    done: Boolean(card.isCompleted),
  };
}

export function executionPatchToCardPatch(patch: Partial<ExecutionTask>): {
  name?: string;
  description?: string;
  isCompleted?: boolean;
} {
  const card: { name?: string; description?: string; isCompleted?: boolean } = {};
  if (patch.title !== undefined) card.name = patch.title;
  if (patch.notes !== undefined) card.description = patch.notes;
  if (patch.done !== undefined) card.isCompleted = patch.done;
  return card;
}

export class PlankaAdapter implements ExecutionLayer {
  private client: PlankaClient;
  private resolveListId: () => Promise<string>;

  constructor(client: PlankaClient, resolveListId: () => Promise<string>) {
    this.client = client;
    this.resolveListId = resolveListId;
  }

  async fetchTasks(): Promise<ExecutionTask[]> {
    const boardId = await this.requireBoardId();
    const { lists } = await this.client.getBoard(boardId);
    return lists.flatMap((list) => (list.cards ?? []).map(cardToTask));
  }

  async createTask(input: { title: string; notes?: string }): Promise<ExecutionTask> {
    const listId = await this.resolveListId();
    const card = await this.client.createCard(listId, {
      name: input.title,
      description: input.notes,
    });
    return cardToTask(card);
  }

  async updateTask(id: string, patch: Partial<ExecutionTask>): Promise<void> {
    await this.client.updateCard(id, executionPatchToCardPatch(patch));
  }

  async completeTask(id: string): Promise<void> {
    await this.client.updateCard(id, { isCompleted: true });
  }

  async removeTask(id: string): Promise<void> {
    await this.client.deleteCard(id);
  }

  private async requireBoardId(): Promise<string> {
    const boardId = this.client.config.boardId;
    if (!boardId) {
      throw new Error('未配置 VITE_PLANKA_BOARD_ID，无法确定要同步的看板');
    }
    return boardId;
  }
}

/** Default list = the one configured via env, else the board's first list. */
export function makeListIdResolver(client: PlankaClient): () => Promise<string> {
  return async () => {
    if (client.config.listId) return client.config.listId;
    const boardId = client.config.boardId;
    if (!boardId) {
      throw new Error('未配置 VITE_PLANKA_BOARD_ID / VITE_PLANKA_LIST_ID，无法确定目标列表');
    }
    const { lists } = await client.getBoard(boardId);
    const first = lists[0];
    if (!first) throw new Error('看板里没有任何列表，无法推送任务');
    return first.id;
  };
}

/** Local Task → ExecutionTask projection (the fields the execution layer sees). */
export function taskToExecution(task: Task): ExecutionTask {
  return {
    id: '', // assigned by the remote on create
    title: task.title,
    notes: task.notes,
    done: task.status === 'DONE',
  };
}
