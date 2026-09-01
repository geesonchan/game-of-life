// 盘尺寸档位与"大盘"政策（D94）。
//
// 加 1024²/2048² 是为了让中量级经典有地方施展：繁殖者（749×338）、深胞（499×516）
// 在 500 的盘上根本摆不下，Max 那个 27 格的填充器要有地方铺才看得出它在干什么。
//
// 代价是实打实的，所以下面那张表是**实测**的，不是估的（本机 Node，
// 密度 0.35 的随机盘，每档跑 20 代取均值）。它有两个用途：
// 一是给界面上的提示提供数字，二是让"为什么大盘要关视觉效果"这件事有据可查。
export const BOARD_SIZES = Object.freeze([100, 200, 300, 500, 1024, 2048, 2304])

/**
 * 「元像素档」（D102 ①）。2304 这个数不是凑的：OTCA 元像素本身 2058×2058，
 * 2304 给它四周各留 123 格 —— 够放几架滑翔机进出，又不多背一寸。
 *
 * 为什么不用 4096：实测 2304² 每代 25.2ms（39.8 代/秒），4096² 65.1ms（15.4 代/秒），
 * **快 2.59 倍**，过了拍板时定的 2.5 倍门槛。一个元代（35,328 代）因此从 38 分钟降到 15 分钟。
 */
export const METAPIXEL_BOARD = 2304

/** 从这一档起算"大盘" */
export const BIG_FROM = 1024

export function isBigBoard(n) { return (n | 0) >= BIG_FROM }

/**
 * 实测每代成本（毫秒）。step = 演化，hash+alive = 终止检测与记账要的两遍扫，
 * visual = 年龄/余晖那一层（它也是整盘一遍）。
 * 单位都是"每代毫秒"，桌面 Node 实测值；手机会更慢，慢多少由真机说了算。
 */
export const STEP_COST = Object.freeze({
  200: { step: 0.4, book: 0.2, visual: 0.2, mem: 0.2 },
  500: { step: 1.8, book: 0.6, visual: 1.0, mem: 1.2 },
  1024: { step: 6.7, book: 2.8, visual: 4.0, mem: 5.0 },
  2048: { step: 26.5, book: 9.9, visual: 15.5, mem: 20.0 },
  // 元像素档，实测在装着 OTCA 元像素的盘上取的（6.4 万活格，不是随机盘）
  2304: { step: 25.2, book: 7.5, visual: 19.6, mem: 25.0 }
})

/** 某一档满打满算每代多少毫秒（含视觉层）；表里没有的档回 null，别编 */
export function costOf(n, withVisual = true) {
  const c = STEP_COST[n | 0]
  if (!c) return null
  return c.step + c.book + (withVisual ? c.visual : 0)
}

/**
 * 大盘下的视觉选项：年龄着色、死亡余晖、拖尾一律关掉。
 *
 * **为什么是关掉而不是"慢一点"**：这三样共用 VisualState 那一层，
 * 而那一层每代要把整盘再扫一遍 —— 2048² 实测 15.5ms/代，
 * 占到那一档全部开销的四成（36.5 + 15.5 = 52ms/代）。
 * 关掉它，2048² 从 19 代/秒回到 27 代/秒。
 *
 * 用户的设置**不改**，只是在大盘上不生效：换回小盘，原样恢复。
 * 偷偷改掉用户的开关等于替他做决定还不告诉他（D82）。
 */
export function visualFor(opts, n) {
  if (!isBigBoard(n)) return opts
  return { ...opts, ageColoring: false, glow: false, trails: false }
}

/**
 * 摆下 w×h 至少要哪一档盘。**返回档位，不返回"差不多够"** ——
 * 摆不下时默默截断是最糟的一种处理：图案还在，但已经不是那个图案了。
 * 所有档位都不够就回 null，由调用方如实说"这个摆不下"。
 */
export function neededBoard(w, h) {
  const n = Math.max(w | 0, h | 0)
  return BOARD_SIZES.find(s => s >= n) ?? null
}
