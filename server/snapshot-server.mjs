#!/usr/bin/env node
/**
 * Semester OS 快照服务端（零依赖）
 *
 * 用法：
 *   TOKEN=你的令牌 PORT=8787 node server/snapshot-server.mjs
 *   或：node server/snapshot-server.mjs --token=xxx --port=8787 --data=./data
 *
 * 端点：
 *   GET  /health            → 200 ok
 *   GET  /snapshot          → 最新快照 JSON（没有则 404）
 *   PUT  /snapshot          → 覆盖保存（带 Authorization: Bearer <TOKEN>，若设置了 TOKEN）
 *
 * 存储：
 *   <data>/snapshot.json            最新快照
 *   <data>/history/<时间戳>.json    每次写入留档（保留最近 200 份）
 */
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);

const PORT = Number(args.port ?? process.env.PORT ?? 8787);
const TOKEN = args.token ?? process.env.TOKEN ?? '';
const DATA_DIR = args.data ?? process.env.DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), 'data');
const SNAPSHOT = join(DATA_DIR, 'snapshot.json');
const HISTORY = join(DATA_DIR, 'history');
const KEEP = 200;

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

async function pruneHistory() {
  try {
    const files = (await readdir(HISTORY)).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP))) {
      await unlink(join(HISTORY, f));
    }
  } catch {
    /* 忽略 */
  }
}

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, hasSnapshot: Boolean(await readFile(SNAPSHOT).catch(() => null)) }));
    return;
  }

  if (url.pathname !== '/snapshot') {
    res.writeHead(404).end('not found');
    return;
  }

  if (req.method === 'GET') {
    const buf = await readFile(SNAPSHOT).catch(() => null);
    if (!buf) {
      res.writeHead(404).end('no snapshot');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(buf);
    return;
  }

  if (req.method === 'PUT') {
    if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401).end('unauthorized');
      return;
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString('utf8');
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400).end('invalid json');
      return;
    }
    if (!parsed?.data || typeof parsed.schemaVersion !== 'number') {
      res.writeHead(400).end('invalid snapshot shape');
      return;
    }
    await mkdir(HISTORY, { recursive: true });
    await writeFile(SNAPSHOT, body);
    await writeFile(join(HISTORY, `${stamp()}.json`), body);
    await pruneHistory();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, updatedAt: parsed.updatedAt ?? null }));
    return;
  }

  res.writeHead(405).end('method not allowed');
});

server.listen(PORT, () => {
  console.log(`Semester OS 快照服务已启动: http://0.0.0.0:${PORT}`);
  console.log(`  数据目录: ${DATA_DIR}`);
  console.log(`  令牌校验: ${TOKEN ? '开启' : '关闭（任何人可写，建议设置 TOKEN）'}`);
});
