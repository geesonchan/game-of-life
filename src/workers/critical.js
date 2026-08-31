// 临界实验室的密度扫描 Worker。与勘探器、时间之塔同样的做法：
// 只做搬运与分片汇报，逻辑全在 data/critical.js 里（放进 Worker 就测不到了）。
//
// 一档一报：界面能边跑边填小多图带，不必等整条轴跑完。
// 细化轮次也在这里跑 —— 跨越点是**夹**出来的，夹几轮由数据说了算（planRefinements）。
import { observeDensity, densityAxis, planRefinements, REFINE_WIDTH } from '../data/critical.js'

const MAX_ROUNDS = 8      // 二分的轮数上限：每轮把区间对折，8 轮足够从 0.05 夹到 0.0002

self.onmessage = e => {
  const msg = e.data
  if (!msg || msg.type !== 'sweep') return
  try {
    const list = Array.isArray(msg.densities) && msg.densities.length
      ? msg.densities
      : densityAxis(msg.axis)
    const width = msg.width ?? REFINE_WIDTH
    const samples = []
    let total = list.length

    const one = (d, refined) => {
      const sample = observeDensity(d, msg.spec)
      samples.push(sample)
      self.postMessage({ type: 'sample', sample, done: samples.length, total, refined: !!refined })
    }

    for (const d of list) one(d, false)

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const plan = planRefinements(samples, width)
      if (!plan.length) break
      total += plan.length
      for (const d of plan) one(d, true)
      samples.sort((a, b) => a.density - b.density)
    }

    self.postMessage({ type: 'done', total: samples.length })
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) })
  }
}
