// 分片重放：一件事，一处实现（D110 §18）。
//
// 读档回放走它，链接里的 `g=` 也走它。两处各写一遍的话，
// **提示里那句"约需 X 秒"就会与真正跑的那个循环分叉** —— 那正是 §12 要防的形状，
// 而且这是登记表升格之后的第一个实例，不该漏在自己脚下。
//
// 三条性质：
//   · **不冻结**：每帧跑一片（`REPLAY_CHUNK` 代），中间把控制权还给浏览器；
//   · **本机标定**：跑完第一片按**实测速度**外推总耗时，界面上那个秒数用的就是这一个；
//   · **可取消**：用户的动作永远是最后一票（启动优先级表第 5 行）。

/** 每帧最多重放多少代。够画出进度，又不至于一帧卡太久 */
export const REPLAY_CHUNK = 400

/** 预计一秒内跑得完就不弹进度条 —— 闪一下反而像出了故障 */
export const PROGRESS_THRESHOLD_MS = 1000

/**
 * 要不要弹进度条：跑完第一片之后按**实测速度**外推总耗时，超过阈值才弹。
 * 判据因此与棋盘大小、机器快慢自动挂钩 —— 500×500 上的两千代和 100×100 上的两千代
 * 不是一回事，写死一个"多少代以上才弹"是不对的。
 * 抽成纯函数是为了能直接测，不用去戳异步的 rAF 分片。
 */
export function shouldShowProgress(elapsedMs, done, total, thresholdMs = PROGRESS_THRESHOLD_MS) {
  if (done <= 0 || done >= total) return false
  return (elapsedMs / done) * total > thresholdMs
}

/**
 * **界面上那个"还要多久"的秒数**。与 `shouldShowProgress` 用的是同一个外推
 * （已跑代数 ÷ 已花时间 → 每代多少毫秒 → 乘剩下的代数），因此不会分叉（D110 §12）。
 * @returns {number|null} 还要多少秒；还没跑过一片时返回 null（那时谁也不知道）
 */
export function etaSeconds(elapsedMs, done, total) {
  if (done <= 0 || done >= total) return null
  const perGen = elapsedMs / done
  return Math.max(0, ((total - done) * perGen) / 1000)
}

/**
 * 跑一趟分片重放。
 * @param {{total:number, step:(remaining:number)=>void, onProgress?:Function,
 *          onDone?:Function, onCancel?:Function, chunk?:number, raf?:Function}} spec
 * @returns {{cancel:()=>void, isRunning:()=>boolean}}
 */
export function runReplay(spec) {
  const total = Math.max(0, spec.total | 0)
  const chunk = spec.chunk || REPLAY_CHUNK
  const raf = spec.raf || (fn => requestAnimationFrame(fn))
  const now = spec.now || (() => performance.now())
  let done = 0
  let cancelled = false
  let running = true
  let barShown = false
  const startedAt = now()

  if (total === 0) {
    running = false
    if (spec.onDone) spec.onDone(0)
    return { cancel() {}, isRunning: () => false }
  }

  const tick = () => {
    if (cancelled) return
    const n = Math.min(chunk, total - done)
    for (let i = 0; i < n; i++) spec.step(total - done - i)
    done += n
    const elapsed = now() - startedAt
    if (!barShown && shouldShowProgress(elapsed, done, total)) barShown = true
    if (barShown && spec.onProgress) {
      spec.onProgress({ done, total, etaSec: etaSeconds(elapsed, done, total) })
    }
    if (done < total) { raf(tick); return }
    running = false
    if (spec.onDone) spec.onDone(done)
  }
  raf(tick)

  return {
    cancel() {
      if (!running || cancelled) return
      cancelled = true
      running = false
      if (spec.onCancel) spec.onCancel(done)
    },
    isRunning: () => running
  }
}
