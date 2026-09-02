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

/**
 * 排片的闸从"盘有多大"改成"**这一档时间里看得见东西吗**"（D110 §22）。
 *
 * 原来的闸是 `board ≤ 500`，理由写的是"大盘每代十几毫秒，放起来是幻灯片"。
 * 那个理由是对的，但**量错了对象**：真正的约束不是盘的尺寸，是
 * **一局要跑多少代才看得出它在干什么** ÷ **这台机器每秒跑多少代**。
 *
 * 换了判据之后：
 *   · 跑得快的大盘可以进（尺寸不再是天花板）；
 *   · 元像素**仍然进不来**，但现在说得出为什么 ——
 *     它一个元代 35,328 代，2304² 上实测约 20 代/秒 ≈ 半小时，
 *     12 秒里它是一张静止的图。把它塞进轮播是"放一张照片，叫它展览"。
 *     它该待的地方是链接与"整台机器"那一节（`id=builtin:` 已经让它一条 113 字符的链接就能开）。
 */
export const SHOW_MAX_BOARD = 4096          // 硬上限只挡"连一帧都画不动"的
export const VISIBLE_GENS = 60              // 没声明时按这个估：一局至少要跑这么多代才看得出动静

/**
 * 一局在停留时间里跑得完"看得见的那几代"吗。
 * @param {object} row 卡片行（可声明 `showGens`：这一局要多少代才看得出在干什么）
 * @param {number} gensPerSec 这台机器在这个盘上每秒跑多少代（本机实测，D110 §16）
 * @param {number} dwellMs 停留时间
 */
export function visibleInDwell(row, gensPerSec, dwellMs) {
  const need = row && Number.isFinite(row.showGens) && row.showGens > 0 ? row.showGens : VISIBLE_GENS
  return gensPerSec * (dwellMs / 1000) >= need
}

/**
 * 排片：从精彩局里挑出适合连放的那些。
 * 规则写在这里而不是手抄一张名单 —— 名单会跟卡片改动分叉（D83 §1 同一个出口）。
 * @param {Array} rows 卡片行
 * @param {{dwellMs?:number, gensPerSecFor?:(row)=>number, maxBoard?:number}} opts
 *   `gensPerSecFor` 由调用方给（它知道本机实测速度）；不给就退回一个保守估计。
 */
export function showPlaylist(rows, opts = {}) {
  const dwellMs = opts.dwellMs || DWELL_MS
  const max = opts.maxBoard || SHOW_MAX_BOARD
  const speedOf = opts.gensPerSecFor || (row => 1000 / Math.max(1, (row.board || 200) / 200))
  return rows
    .filter(r => r && r.builtin !== false && r.rle)
    .filter(r => !(r.board && r.board > max))
    .filter(r => visibleInDwell(r, speedOf(r), dwellMs))
    .map(r => ({ id: r.id || r.key || r.nameKey || r.name, entry: r, dwellMs }))
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
