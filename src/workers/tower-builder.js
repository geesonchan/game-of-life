// 时间之塔的构建 Worker。
// 它只是个搬运壳子：真正的构建逻辑在 data/tower.js 的 buildTower() 里，
// 主线程的测试跑的是同一个函数 —— 逻辑放进 Worker 就没法测了。

import { buildTower, packTower } from '../data/tower.js'

self.onmessage = e => {
  const spec = e.data
  if (!spec || spec.type !== 'build') return
  try {
    const { tower } = buildTower(
      spec,
      (done, total) => self.postMessage({ type: 'progress', done, total }),
      spec.chunk || 25
    )
    const packed = packTower(tower)
    // 层数据直接 transfer，不复制 —— 一座 200 层的塔可能有几十万个格索引
    self.postMessage({ type: 'done', packed }, packed.cells.map(c => c.buffer))
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) })
  }
}
