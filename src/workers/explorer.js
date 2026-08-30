// 规则勘探的批量 Worker。与时间之塔同样的做法：只做搬运与分片汇报，
// 逻辑全在 data/explorer.js 里（放进 Worker 就测不到了）。
import { exploreRule } from '../data/explorer.js'

self.onmessage = e => {
  const msg = e.data
  if (!msg || msg.type !== 'explore') return
  const { rules, spec } = msg
  try {
    for (let i = 0; i < rules.length; i++) {
      const result = exploreRule(rules[i], spec)
      // 一条一条回报：界面能边跑边填表，不用等全部跑完
      self.postMessage({ type: 'result', index: i, total: rules.length, result })
    }
    self.postMessage({ type: 'done', total: rules.length })
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) })
  }
}
