import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'

// 版本印记（D92 ②）：把 package.json 的版本号编译进页面的 <meta>。
// 为什么要有它 —— 上一轮真机复验对着的是**上一版**（修好的那次提交我没推），
// 而我和用户都没有一眼能核对"线上到底是哪一版"的东西。
// 现在 `curl 线上页面 | grep app-version` 就能对，一条命令的事。
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

// 无后端，纯静态站点；engine 层不依赖 DOM，测试在 Node 环境跑
export default defineConfig({
  root: '.',
  // 相对路径，而不是 '/game-of-life/'：GitHub Pages 把站点放在
  // 用户名.github.io/<仓库名>/ 这样的子目录下，写死绝对路径的话，
  // 仓库一改名、或者换个地方托管（本地 dist 直接双击打开）就全是 404。
  // './' 让所有资源相对于页面自己找，放哪儿都对。
  base: './',
  // 构建时把版本号写进 index.html 的 <meta>：**要的是静态 HTML 里就有**，
  // 这样 `curl 线上页面 | grep app-version` 一条命令就能核对，不必执行 JS。
  // 开发服务器上它保持 "dev" —— 那也是准的：那本来就不是某个发布版本。
  plugins: [{
    name: 'stamp-app-version',
    transformIndexHtml(html) {
      return html.replace('name="app-version" content="dev"', `name="app-version" content="${pkgVersion}"`)
    }
  }],
  build: { outDir: 'dist', target: 'es2020' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js']
  }
})
