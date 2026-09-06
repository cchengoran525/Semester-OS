/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// VITE_BASE 支持子路径托管（如 GitHub Pages 的 /semester-os/），
// 默认根路径；资源引用会自动带上前缀。
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
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
