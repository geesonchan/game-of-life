// 锁定时刻的一次性勘探任务（D86 ③）。与其它 Worker 同样：只搬运，逻辑在 data/lockin.js 里。
// 倒扫每往回一代报一次进度 —— 这件事可能几百毫秒，也可能几十秒，用户得看得见它在动。
import { findLockIn } from '../data/lockin.js'

self.onmessage = e => {
  const msg = e.data
  if (!msg || msg.type !== 'lockin') return
  try {
    const result = findLockIn(msg.spec || {}, (done, total) => {
      self.postMessage({ type: 'progress', done, total })
    })
    self.postMessage({ type: 'done', result })
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) })
  }
}
