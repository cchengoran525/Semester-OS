import type { PlankaConfig } from './config';

/**
 * Minimal typed HTTP client for the Planka REST API (Bearer token auth).
 * Only covers what the execution-layer adapter needs: boards / cards.
 */

export class PlankaError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'PlankaError';
    this.status = status;
  }
}

/** The subset of a Planka card this integration understands. */
export interface PlankaCard {
  id: string;
  name: string;
  description?: string;
  isCompleted: boolean;
  listId: string;
}

export interface PlankaList {
  id: string;
  name: string;
  cards?: PlankaCard[];
}

export type ProbeResult = 'ok' | 'reachable' | 'unreachable';

export class PlankaClient {
  config: PlankaConfig;
  constructor(config: PlankaConfig) {
    this.config = config;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { json?: unknown } = {},
  ): Promise<T> {
    const { json, headers, ...rest } = init;
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/api${path}`, {
        ...rest,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: json !== undefined ? JSON.stringify(json) : rest.body,
      });
    } catch (e) {
      throw new PlankaError(`无法连接 Planka：${(e as Error).message}`, 0);
    }
    if (!res.ok) throw new PlankaError(`Planka 请求失败（${res.status}）：${path}`, res.status);
    if (res.status === 204) return undefined as T;
    // Some endpoints (and a bare connectivity probe) answer with an empty body.
    try {
      return (await res.json()) as T;
    } catch {
      return undefined as T;
    }
  }

  /**
   * Connectivity probe. `ok` = server answered 2xx; `reachable` = server answered
   * but rejected the token/path (401/403/404); `unreachable` = network failure.
   */
  async probe(): Promise<ProbeResult> {
    const path = this.config.boardId ? `/boards/${this.config.boardId}` : '/';
    try {
      await this.request(path);
      return 'ok';
    } catch (e) {
      if (e instanceof PlankaError && e.status >= 400 && e.status < 500) return 'reachable';
      return 'unreachable';
    }
  }

  /** Board with its lists (and usually cards) included. */
  async getBoard(boardId: string): Promise<{ lists: PlankaList[] }> {
    const json = await this.request<unknown>(`/boards/${boardId}`);
    // Planka 1.x inlines fields on the board object; 2.x wraps them in `items`.
    const board = ((json as { items?: { lists?: PlankaList[] } }).items ??
      json) as { lists?: PlankaList[] } | undefined;
    return { lists: Array.isArray(board?.lists) ? board.lists : [] };
  }

  async createCard(
    listId: string,
    input: { name: string; description?: string },
  ): Promise<PlankaCard> {
    // position: 'auto' appends to the end of the list (Planka ≥ 2.x)
    return this.request<PlankaCard>(`/lists/${listId}/cards`, {
      method: 'POST',
      json: { ...input, position: 'auto' },
    });
  }

  async updateCard(
    cardId: string,
    patch: { name?: string; description?: string; isCompleted?: boolean },
  ): Promise<void> {
    await this.request(`/cards/${cardId}`, { method: 'PATCH', json: patch });
  }

  async deleteCard(cardId: string): Promise<void> {
    await this.request(`/cards/${cardId}`, { method: 'DELETE' });
  }
}
