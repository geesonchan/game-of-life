// 看展模式：把内置精彩局一局接一局地放给人看（D110 §14）。
//
// 三条定死的规矩，都是前面几轮吵出来的：
//
// 1. **明说不记账。** 放的是别人的局，记进用户的编年史与台账，就是把不属于他的东西
//    塞进他的记录里。界面横幅上写着这句，`records.setShowing(true)` 真的不记。
// 2. **自动进入排在链接之前，且有链接就不启动。** 它是**周期性写盘**者 ——
//    排序救不了它（排在链接前只管得住第一帧，第二帧照样盖掉），只能靠不启动（D110 §1）。
//    抑制的判断**问 resolver 要意图**，不许自己去读 hash：
//    压缩落地后 decodeShare 变异步，自己读 hash 的那一处会悄悄错，而且没人会红。
// 3. **退出退回进入前那一刻。** 不是退回空盘，也不是退回链接那一局 ——
//    是 `captureSession()` 存下的那一份（格子 + 环境 + 取景）。
//    用户没动过时，那一刻恰好就是链接那一局：那是特例，不是规则。

/** 每一局停留多久。够看清它在干什么，又不至于让人等 */
export const DWELL_MS = 12000

/** 空转多久之后自动开演（无参数、空盘、没在跑） */
export const IDLE_MS = 120000

/** 看展只放小盘的局：大盘那几档每代十几毫秒，放起来是幻灯片不是展览 */
export const SHOW_MAX_BOARD = 500

/**
 * 排片：从精彩局里挑出适合连放的那些。
 * 规则写在这里而不是手抄一张名单 —— 名单会跟卡片改动分叉（D83 §1 同一个出口）。
 */
export function showPlaylist(rows, opts = {}) {
  const max = opts.maxBoard || SHOW_MAX_BOARD
  return rows
    .filter(r => r && r.builtin !== false && r.rle)
    .filter(r => !(r.board && r.board > max))
    .map(r => ({ id: r.id || r.key || r.nameKey || r.name, entry: r, dwellMs: opts.dwellMs || DWELL_MS }))
}

/** 下一局是谁（转一圈回到头） */
export function nextShowIndex(i, len) {
  if (!len) return 0
  return (i + 1) % len
}

/**
 * 自动看展该不该开演。
 *
 * **只接受意图对象**（`resolveInitialBoard()` 的返回值），不接受 hash、不自己读 location ——
 * 这是硬要求：意图从哪儿来、是同步还是异步解出来的，看展一概不管，
 * 也就不会在压缩落地那天悄悄失灵（用户定的）。
 */
export function shouldAutoStart(intent, ctx = {}) {
  if (!intent) return false
  if (intent.autoShowcase === false) return false      // 有链接：不启动，不是"启动后被盖过"
  if (!ctx.enabled) return false
  if (ctx.running) return false                        // 人家自己的局正在跑
  if (ctx.boardTouched) return false                   // 盘上有他自己的东西
  if (ctx.viewOpen) return false                       // 正开着别的视图/弹层
  return (ctx.idleMs || 0) >= (ctx.idleAfterMs || IDLE_MS)
}

/**
 * 退出看展时该做什么：**永远是"还原那一份快照"**。
 * 抽成函数是为了让守卫钉得住"没有第二种退法"。
 */
export function exitPlan(snapshot) {
  return snapshot ? { restore: true, snapshot } : { restore: false, snapshot: null }
}
