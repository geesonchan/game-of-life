// 图案的"动向"：它往哪儿走、往哪儿打、从哪儿吃（D88 ②）。
//
// **方向一律由引擎实测产出，一个都不许手写。**
// 手写的方向会在两种时候骗人：图案本身改了（朝向换了、RLE 换了），
// 以及旋转镜像之后（写死的向量不会跟着转）。这个项目已经为"两份状态对不上"付过好几次学费
// （幽灵与落子各算一份朝向、勘探器候选名单与收藏各存一份），不再犯。
//
// 三种测法，各对应一类图案：
//   · **飞船**：跑若干代，量质心位移，再除以周期 —— 得到"每几代走几格"。
//   · **枪**：跑到第一架滑翔机射出来，量那架滑翔机的行进方向 —— 那就是弹道。
//   · **吞食者**：它自己不动，方向是"可吞食的那条斜线" ——
//     取 D81 实测验证过的喂食几何：吞食者朝 SE 时，吃的是从 NW 方向飞来的滑翔机。
//
// 登记表只写"这个图案有没有方向、是哪一类"，**向量本身永远是算出来的**。
import { LifeEngine } from './board.js'
import { lifeRule } from './rules.js'
import { getPattern, placePattern, transformPattern } from './patterns.js'

/**
 * 哪些图案有动向，各属哪一类。没登记的一律不画线（脉冲星在原地喘气、
 * 方块一动不动、R-五连体乱成一团 —— 给它们画箭头是在编方向）。
 */
export const MOTION_KINDS = Object.freeze({
  glider: 'ship',
  lwss: 'ship',
  gun: 'gun',
  eater: 'eater'
})

/** 飞船量多少代。够长，长到把周期里的抖动摊平；够短，短到别飞出小盘。 */
export const SHIP_GENS = 40

/** 枪量多少代：Gosper 枪每 30 代吐一架，跑到第 90 代那架已经飞出枪身了。 */
export const GUN_GENS = 90

/**
 * 量向量用的盘子边长（死边界）。**够大到这段时间飞不出去**，否则量到的是撞墙，不是飞行 ——
 * 第一版把盘子从 120 缩到 60 提速，结果轻量飞船 40 代走 20 格，从盘子四分之一处出发正好撞边，
 * 量出来的方向直接是错的（-13,3）。所以尺寸按类分开写，各自算清楚：
 *   · 飞船：40 代最多走 20 格，从正中出发，60 足够；
 *   · 枪：枪身 36 格宽，射出去的还要飞二十几格，仍用 120；
 *   · 吞食者：滑翔机最多退开 9 格，60 足够。
 * 图案一律**摆在正中**，不再摆四分之一处 —— 从正中出发，四个方向的余量才一样多。
 */
const PROBE_SIZE = Object.freeze({ ship: 60, gun: 120, eater: 60 })

/** 最简分数化：把 (10,10)/40 收成 (1,1)/4，读数才像话 */
function reduce(dx, dy, gens) {
  const g = gcd(gcd(Math.abs(dx), Math.abs(dy)), gens) || 1
  return { dx: dx / g, dy: dy / g, gens: gens / g }
}
function gcd(a, b) { return b ? gcd(b, a % b) : a }

/** 活细胞质心（浮点）。全空时返回 null。 */
export function centroid(engine) {
  let n = 0, sx = 0, sy = 0
  const cur = engine.cur, w = engine.w
  for (let i = 0; i < cur.length; i++) {
    if (cur[i] !== 1) continue
    n++; sx += i % w; sy += (i / w) | 0
  }
  return n ? { x: sx / n, y: sy / n, n } : null
}

/**
 * 实测一个图案的动向。
 * @param {object} pattern 已经是当前朝向的图案（转过就传转过的）
 * @param {'ship'|'gun'|'eater'} kind
 * @returns {{dx:number, dy:number, gens:number, kind:string}|null} 单位向量方向 + 走完它要几代
 */
export function measureMotion(pattern, kind) {
  if (kind === 'ship') return measureShip(pattern)
  if (kind === 'gun') return measureGun(pattern)
  if (kind === 'eater') return measureEater(pattern)
  return null
}

/** 飞船：多代质心位移 */
export function measureShip(pattern, gens = SHIP_GENS) {
  const e = fresh(pattern, PROBE_SIZE.ship)
  const a = centroid(e)
  e.run(gens)
  const b = centroid(e)
  if (!a || !b) return null
  const dx = Math.round(b.x - a.x), dy = Math.round(b.y - a.y)
  if (dx === 0 && dy === 0) return null          // 没走 = 不是飞船，别编方向
  return { ...reduce(dx, dy, gens), kind: 'ship' }
}

/**
 * 枪：弹道。跑到第一架滑翔机离开枪身之后，量**枪身之外那团东西**的质心位移 ——
 * 枪本身是原地循环的，位移全来自射出去的那架。
 */
export function measureGun(pattern, gens = GUN_GENS) {
  const n = PROBE_SIZE.gun
  const e = fresh(pattern, n)
  const box = { x0: originOf(n, pattern.w), y0: originOf(n, pattern.h), w: pattern.w, h: pattern.h }
  e.run(Math.floor(gens / 2))
  const a = centroidOutside(e, box)
  e.run(gens - Math.floor(gens / 2))
  const b = centroidOutside(e, box)
  if (!a || !b) return null
  const dx = Math.round(b.x - a.x), dy = Math.round(b.y - a.y)
  if (dx === 0 && dy === 0) return null
  // 枪只报**方向**，不报"几代走几格"：射出去的滑翔机会越攒越多，
  // 那团东西的质心速度不是任何一架滑翔机的速度。报一个算得出、但意思不对的数，
  // 比不报更糟 —— 弹道要的本来也只是方向。
  const g = gcd(Math.abs(dx), Math.abs(dy)) || 1
  return { dx: dx / g, dy: dy / g, gens: null, kind: 'gun' }
}

/**
 * 吞食者：它自己不动，方向是**可吞食的那条斜线**。
 * 做法仍是实测而不是写死：把一架滑翔机按 D81 验证过的喂食几何放上去，
 * 跑到它被吃掉，取滑翔机的来向 —— 箭头因此指向嘴。
 * 吃不掉就返回 null（说明这个朝向下没有可吞食的斜线，那就别画线）。
 */
export function measureEater(pattern, gens = 60) {
  // 八个朝向的滑翔机、几种退开距离，逐个喂一遍，**真被吃掉的那一条才是答案**。
  // 不预设"吞食者朝 SE 就吃 NW 来的"这种知识 —— 那是手写方向的另一种形式；
  // 转过的吞食者吃哪条斜线，同样由这一趟搜索回答（D81 那张四朝向表就是这么验出来的）。
  for (const o of ORIENTS) {
    const glider = (o.rot || o.flip) ? transformPattern(getPattern('glider'), o) : getPattern('glider')
    const ship = measureShip(glider)             // 这架滑翔机往哪儿飞，也是实测的
    if (!ship) continue
    // 沿来路退开多远、以及**垂直方向错开几格**，两个都要搜：
    // D81 那轮实测过，每一对朝向都有十来组可行偏移，只沿一条线试会漏掉一半朝向。
    for (const back of [4, 5, 6, 7, 8, 9]) {
      for (const side of [0, 1, -1, 2, -2]) {
        const hit = feedOnce(pattern, glider, ship, back, side, gens)
        if (hit) return { dx: ship.dx, dy: ship.dy, gens: ship.gens, kind: 'eater', eatenAt: hit }
      }
    }
  }
  return null
}

/** 八个朝向：四个旋转 × 两种镜像 */
const ORIENTS = Object.freeze([
  { rot: 0, flip: false }, { rot: 1, flip: false }, { rot: 2, flip: false }, { rot: 3, flip: false },
  { rot: 0, flip: true }, { rot: 1, flip: true }, { rot: 2, flip: true }, { rot: 3, flip: true }
])

/**
 * 喂一次：顺着来向退开 back 格放滑翔机，跑 gens 代。
 * **判据是"吞食者逐格复原"**，不是"活细胞数对得上"（D64 互动型标准里的那一条）——
 * 只看数目的话，吞食者被撞坏、同时别处多出几格，也会凑出同一个数。
 * @param {number} back 沿来路退开几格
 * @param {number} side 垂直于来路错开几格（相位）
 * @returns {number} 第几代吞完；没吃掉回 0
 */
function feedOnce(eater, glider, ship, back, side, gens) {
  const n = PROBE_SIZE.eater
  const before = fresh(eater, n).cur.slice()     // 只有吞食者的那盘，逐格比对的基准
  const e = fresh(eater, n)
  const ox = originOf(n, eater.w), oy = originOf(n, eater.h)
  // 来路方向的垂直方向：(dx,dy) 转 90° 就是 (-dy,dx)
  const gx = ox - ship.dx * back - ship.dy * side
  const gy = oy - ship.dy * back + ship.dx * side
  if (gx < 0 || gy < 0 || gx + glider.w >= n || gy + glider.h >= n) return 0
  placePattern(e, glider, gx, gy)
  e.stats.alive = e.countAlive()
  for (let g = 1; g <= gens; g++) {
    e.step()
    if (sameBoard(e.cur, before)) return g       // 滑翔机没了，吞食者一格不差
  }
  return 0
}

function sameBoard(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** 图案摆在正中时左上角的坐标 */
function originOf(size, extent) { return (size - extent) >> 1 }

/** 造一块干净的探针盘，把图案摆在**正中** */
function fresh(pattern, size) {
  const e = new LifeEngine(size, size, { rule: lifeRule(), boundary: 'dead' })
  placePattern(e, pattern, originOf(size, pattern.w), originOf(size, pattern.h))
  e.stats.alive = e.countAlive()
  return e
}

/** 枪身之外的质心（枪自己原地循环，位移全来自射出去的那架） */
function centroidOutside(engine, box) {
  let n = 0, sx = 0, sy = 0
  const cur = engine.cur, w = engine.w
  for (let i = 0; i < cur.length; i++) {
    if (cur[i] !== 1) continue
    const x = i % w, y = (i / w) | 0
    if (x >= box.x0 - 2 && x < box.x0 + box.w + 2 && y >= box.y0 - 2 && y < box.y0 + box.h + 2) continue
    n++; sx += x; sy += y
  }
  return n ? { x: sx / n, y: sy / n, n } : null
}

/**
 * 当前朝向下的动向。**转过的图案要重新实测**，而不是把向量自己转一遍 ——
 * 这样"线指的方向"与"放下去之后真会发生的事"是同一次计算的结果。
 * 有守卫比对两者：把向量按同一个朝向变换，必须与重新实测的结果一致。
 * @returns {{dx,dy,gens,kind}|null}
 */
export function motionOf(pattern) {
  const kind = MOTION_KINDS[pattern && pattern.key]
  if (!kind) return null
  return measureMotion(pattern, kind)
}

/**
 * 动向线的两端（棋盘格坐标，可为小数）。纯函数，几何写在测试里。
 *
 * · **飞船 / 枪**：从图案中心出发，顺着方向射出去，箭头在远端 —— 它要去那儿。
 * · **吞食者**：它自己不动，线画在**可吞食的那条来路**上，箭头指回嘴 ——
 *   要看的是"从哪儿来的能被吃掉"，不是"它要去哪儿"。
 *
 * @returns {{from:{x,y}, to:{x,y}, arrowAt:'to'|'from'}}
 */
export function rayEnds(kind, center, dir, len) {
  const n = Math.hypot(dir.dx, dir.dy) || 1
  const ux = dir.dx / n, uy = dir.dy / n
  if (kind === 'eater') {
    // 来路在反方向上，箭头落在图案这一端
    return { from: { x: center.x - ux * len, y: center.y - uy * len }, to: { x: center.x, y: center.y }, arrowAt: 'to' }
  }
  return { from: { x: center.x, y: center.y }, to: { x: center.x + ux * len, y: center.y + uy * len }, arrowAt: 'to' }
}

/** 动向线画多长（格）。够长到"一眼看出朝哪儿"，又不至于横穿整盘。 */
export const RAY_LEN = 26

/** 把一个方向向量按朝向变换（与 transformPattern 用的是同一套群运算） */
export function rotateVector(v, o = {}) {
  const rot = ((o.rot | 0) % 4 + 4) % 4
  let x = v.dx, y = v.dy
  if (o.flip) x = -x
  for (let i = 0; i < rot; i++) { const nx = -y, ny = x; x = nx; y = ny }
  return { dx: x, dy: y }
}

/* ---------------- 缓存与异步量测 ---------------- */

const cache = new Map()
const pending = new Set()

/** 缓存键：图案 + 朝向 */
export function motionKey(patternKey, orient) {
  const rot = ((orient && orient.rot) | 0 % 4 + 4) % 4
  return `${patternKey}:${rot}:${!!(orient && orient.flip)}`
}

/**
 * 取当前朝向的动向。**不阻塞**：没量过就先回 null，在下一个宏任务里量完再叫醒调用方。
 *
 * 为什么要异步：飞船和枪几毫秒就量完，而吞食者要把八个朝向的滑翔机、
 * 沿来路的六种距离、垂直方向的五种相位喂一遍才知道吃哪条斜线 ——
 * 最慢的一个朝向实测二百多毫秒。那是一次按键之后的卡顿，不能放在渲染这一帧里。
 * 量完的结果进缓存，同一个图案同一个朝向永远只量一次。
 *
 * @param {object} pattern 原始图案（未变换）
 * @param {{rot:number,flip:boolean}} orient
 * @param {Function} [onReady] 量完之后叫醒调用方（界面拿它置脏重画）
 */
export function motionCached(pattern, orient, onReady) {
  if (!pattern || !MOTION_KINDS[pattern.key]) return null
  const o = { rot: ((orient && orient.rot) | 0) % 4, flip: !!(orient && orient.flip) }
  const key = motionKey(pattern.key, o)
  if (cache.has(key)) return cache.get(key)
  if (!pending.has(key)) {
    pending.add(key)
    const run = () => {
      const shown = (o.rot || o.flip) ? transformPattern(getPattern(pattern.key), o) : getPattern(pattern.key)
      cache.set(key, motionOf(shown))
      pending.delete(key)
      if (onReady) onReady()
    }
    // 让出这一帧再量：先把画面交出去，几十毫秒后线自己出现
    if (typeof setTimeout === 'function') setTimeout(run, 0); else run()
  }
  return null
}

/** 同步版本：测试与预热用（界面不要用它，会卡帧） */
export function motionNow(pattern, orient) {
  const o = { rot: ((orient && orient.rot) | 0) % 4, flip: !!(orient && orient.flip) }
  const key = motionKey(pattern.key, o)
  if (!cache.has(key)) {
    const shown = (o.rot || o.flip) ? transformPattern(getPattern(pattern.key), o) : getPattern(pattern.key)
    cache.set(key, motionOf(shown))
  }
  return cache.get(key)
}
