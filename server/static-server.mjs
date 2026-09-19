import { createServer, request as httpRequest } from 'node:http';
import { readFile, stat, mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Semester OS 部署服务器（零依赖，和 snapshot-server 同款风格）：
 *   - 静态托管 dist/（HashRouter，无需 history fallback，但兜底回 index.html）
 *   - /api/*        → 反向代理到快照服务器（UPSTREAM，默认 127.0.0.1:8787），同源无 CORS/PNA 问题
 *   - /api-local-backup → 落盘备份端点，语义与开发服务器一致（BACKUP_DIR，默认 ./backup）
 * 环境变量：PORT（默认 8788）、UPSTREAM、BACKUP_DIR、KEEP_HISTORY（默认 200）
 */

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 8788);
const UPSTREAM = process.env.UPSTREAM || 'http://127.0.0.1:8787';
const BACKUP_DIR = process.env.BACKUP_DIR || join(ROOT, 'backup');
const KEEP_HISTORY = Number(process.env.KEEP_HISTORY || 200);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function send(res, code, body, headers = {}) {
  res.statusCode = code;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function proxy(req, res) {
  const target = new URL(UPSTREAM);
  const upstreamReq = httpRequest(
    {
      hostname: target.hostname,
      port: target.port || 80,
      path: req.url.replace(/^\/api/, '') || '/', // 与 dev 代理同款 rewrite：/api/xxx → /xxx
      method: req.method,
      headers: { ...req.headers, host: `${target.hostname}:${target.port || 80}` },
    },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    },
  );
  upstreamReq.on('error', (e) => send(res, 502, JSON.stringify({ error: `upstream: ${e.message}` }), { 'Content-Type': 'application/json' }));
  req.pipe(upstreamReq);
}

async function handleLocalBackup(req, res) {
  const sendJson = (code, body) => send(res, code, JSON.stringify(body), { 'Content-Type': 'application/json' });
  if (req.method === 'GET') return sendJson(200, { ok: true, dir: BACKUP_DIR });
  if (req.method !== 'POST') return sendJson(405, { error: 'method not allowed' });
  const body = await readBody(req);
  try {
    JSON.parse(body.toString('utf8'));
  } catch {
    return sendJson(400, { error: 'invalid json' });
  }
  const guarded = String(req.headers['x-backup-guarded'] ?? '') === 'true';
  try {
    const historyDir = join(BACKUP_DIR, 'history');
    await mkdir(historyDir, { recursive: true });
    if (!guarded) await writeFile(join(BACKUP_DIR, 'semester-os.json'), body);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeFile(join(historyDir, `${stamp}.json`), body);
    const files = (await readdir(historyDir)).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_HISTORY))) {
      await unlink(join(historyDir, f));
    }
    sendJson(200, { ok: true, dir: BACKUP_DIR, file: 'semester-os.json' });
  } catch (e) {
    sendJson(500, { error: String(e) });
  }
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/api-local-backup') return await handleLocalBackup(req, res);
    if (urlPath === '/api' || urlPath.startsWith('/api/')) return proxy(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');

    // 静态文件（限制在 DIST 内，防目录穿越）
    let filePath = join(DIST, normalize(urlPath).replace(/^([.][.][/\\])+/, ''));
    if (!filePath.startsWith(DIST)) return send(res, 403, 'forbidden');
    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info) {
      filePath = join(DIST, 'index.html'); // SPA 兜底
      info = await stat(filePath).catch(() => null);
      if (!info) return send(res, 404, 'dist not built');
    }
    const body = await readFile(filePath);
    send(res, 200, req.method === 'HEAD' ? undefined : body, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=86400',
    });
  } catch (e) {
    send(res, 500, String(e));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`semester-os app: http://0.0.0.0:${PORT} (dist=${DIST}, api→${UPSTREAM}, backup=${BACKUP_DIR})`);
});
