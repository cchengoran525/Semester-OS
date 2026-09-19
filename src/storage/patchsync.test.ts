import { describe, expect, it, beforeEach } from 'vitest';
import { db } from './db';
import { seedIfFirstLaunch } from './seed';
import { settingsRepo } from './repositories';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedIfFirstLaunch();
});

describe('patchSync', () => {
  it('写入 url/token 并保留 deviceId', async () => {
    await settingsRepo.patchSync({ deviceId: 'dev-1' });
    await settingsRepo.patchSync({ url: 'http://192.168.1.10:8787' });
    await settingsRepo.patchSync({ token: 'abc' });
    const s = await settingsRepo.get();
    console.log('sync now:', JSON.stringify(s?.sync));
    expect(s?.sync?.url).toBe('http://192.168.1.10:8787');
    expect(s?.sync?.token).toBe('abc');
    expect(s?.sync?.deviceId).toBe('dev-1');
  });
});
