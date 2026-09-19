/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { mkdir, writeFile, readdir, unlink, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 本地落盘备份：开发服务器提供一个同源端点，把整库 JSON 写到本机文件夹。
 * 不依赖浏览器文件授权（File System Access），Chrome 也不会拦。
 * 目录可用 LOCAL_BACKUP_DIR 覆盖，默认项目文件夹下的 SemesterOS备份/（与代码放一起，好找好备份）
 */
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url))

// 轻量加载 .env.local（gitignored，放个人地址/令牌）：注入 process.env，已存在的环境变量优先
try {
  const local = await readFile(join(PROJECT_ROOT, '.env.local'), 'utf8')
  for (const line of local.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch {
  // 没有 .env.local 时静默跳过
}

const BACKUP_DIR =
  process.env.LOCAL_BACKUP_DIR || join(PROJECT_ROOT, 'SemesterOS备份')
const KEEP_HISTORY = 100

function localBackupPlugin() {
  const handler = async (req: any, res: any) => {
    const send = (code: number, body: unknown) => {
      res.statusCode = code
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    }
    if (req.method === 'GET') {
      send(200, { ok: true, dir: BACKUP_DIR })
      return
    }
    if (req.method !== 'POST') {
      send(405, { error: 'method not allowed' })
      return
    }
    let body = ''
    for await (const chunk of req) body += chunk
    try {
      JSON.parse(body) // 只接受合法 JSON，避免写入垃圾
    } catch {
      send(400, { error: 'invalid json' })
      return
    }
    // 客户端判定"数据可疑地变空"时带此头：只写 history 留档，不覆盖主文件
    const guarded = String(req.headers['x-backup-guarded'] ?? '') === 'true'
    try {
      const historyDir = join(BACKUP_DIR, 'history')
      await mkdir(historyDir, { recursive: true })
      if (!guarded) await writeFile(join(BACKUP_DIR, 'semester-os.json'), body)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await writeFile(join(historyDir, `${stamp}.json`), body)
      const files = (await readdir(historyDir)).filter((f) => f.endsWith('.json')).sort()
      for (const f of files.slice(0, Math.max(0, files.length - KEEP_HISTORY))) {
        await unlink(join(historyDir, f))
      }
      send(200, { ok: true, dir: BACKUP_DIR, file: 'semester-os.json' })
    } catch (e) {
      send(500, { error: String(e) })
    }
  }

  return {
    name: 'semester-os-local-backup',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url && req.url.startsWith('/api-local-backup')) return handler(req, res)
        next()
      })
    },
  }
}

// https://vite.dev/config/
// VITE_BASE 支持子路径托管（如 GitHub Pages 的 /semester-os/），
// 默认根路径；资源引用会自动带上前缀。
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react(), localBackupPlugin()],
  // 开发服务器代理：浏览器请求 /api/* → 转发到快照服务器。
  // 同源请求，绕开 Chrome 的"本地网络访问"权限拦截与 CORS 限制。
  // 生产部署时改成你自己的反向代理（nginx location /api/ → 快照服务）。
  server: {
    proxy: {
      '/api': {
        // 快照服务器地址：默认本机；个人内网地址放 .env.local 的 SNAPSHOT_TARGET
        target: process.env.SNAPSHOT_TARGET || 'http://localhost:8787',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // 多步 UI 工作流用例（Dexie + React 渲染）在全量并行运行时负载较高，
    // 默认 5s 在慢机器上会误报超时
    testTimeout: 20_000,
    hookTimeout: 10_000,
  },
})
