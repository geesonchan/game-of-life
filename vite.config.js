import { defineConfig } from 'vite'

// 无后端，纯静态站点；engine 层不依赖 DOM，测试在 Node 环境跑
export default defineConfig({
  root: '.',
  // 相对路径，而不是 '/game-of-life/'：GitHub Pages 把站点放在
  // 用户名.github.io/<仓库名>/ 这样的子目录下，写死绝对路径的话，
  // 仓库一改名、或者换个地方托管（本地 dist 直接双击打开）就全是 404。
  // './' 让所有资源相对于页面自己找，放哪儿都对。
  base: './',
  build: { outDir: 'dist', target: 'es2020' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js']
  }
})
