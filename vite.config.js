import { defineConfig } from 'vite'

// 无后端，纯静态站点；engine 层不依赖 DOM，测试在 Node 环境跑
export default defineConfig({
  root: '.',
  build: { outDir: 'dist', target: 'es2020' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js']
  }
})
