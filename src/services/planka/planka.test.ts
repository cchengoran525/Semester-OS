import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { PlankaClient, PlankaError, type PlankaCard } from './client';
import {
  cardToTask,
  executionPatchToCardPatch,
  makeListIdResolver,
} from './adapter';
import type { PlankaConfig } from './config';

const config: PlankaConfig = {
  baseUrl: 'https://planka.test',
  token: 'tok',
  boardId: 'board-1',
};

function card(overrides: Partial<PlankaCard> = {}): PlankaCard {
  return {
    id: 'card-1',
    name: '整理数据结构第一章积压例题',
    description: '',
    isCompleted: false,
    listId: 'list-1',
    ...overrides,
  };
}

describe('planka adapter mapping', () => {
  it('maps a card to an execution task', () => {
    const t = cardToTask(card({ name: '复习 2.3 节', description: '重点看例题', isCompleted: true }));
    expect(t).toEqual({ id: 'card-1', title: '复习 2.3 节', notes: '重点看例题', done: true });
  });

  it('maps empty description to undefined notes', () => {
    expect(cardToTask(card()).notes).toBeUndefined();
  });

  it('maps execution patch to card patch', () => {
    expect(executionPatchToCardPatch({ title: '新标题', done: true })).toEqual({
      name: '新标题',
      isCompleted: true,
    });
    expect(executionPatchToCardPatch({ notes: undefined })).toEqual({});
  });
});

describe('planka client', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ items: { lists: [] } }), { status: 200 })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends bearer token and json body on createCard', async () => {
    const client = new PlankaClient(config);
    await client.createCard('list-1', { name: '任务', description: '说明' });
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://planka.test/api/lists/list-1/cards',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
      }),
    );
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body).toEqual({ name: '任务', description: '说明', position: 'auto' });
  });

  it('probe returns ok on 2xx, reachable on 401, unreachable on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    expect(await new PlankaClient(config).probe()).toBe('ok');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    expect(await new PlankaClient(config).probe()).toBe('reachable');

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    expect(await new PlankaClient(config).probe()).toBe('unreachable');
  });

  it('throws PlankaError with status on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(new PlankaClient(config).getBoard('board-1')).rejects.toBeInstanceOf(PlankaError);
  });
});

describe('planka adapter list resolution', () => {
  it('prefers configured listId, falls back to first board list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ items: { lists: [{ id: 'first-list', name: '待办' }] } }),
          { status: 200 },
        ),
      ),
    );
    const client = new PlankaClient(config);
    const resolve = makeListIdResolver(client);
    expect(await resolve()).toBe('first-list');

    const withList = new PlankaClient({ ...config, listId: 'custom-list' });
    expect(await makeListIdResolver(withList)()).toBe('custom-list');
  });
});
