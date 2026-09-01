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
//
// **除了方向，还得量"线画在哪儿"（D98）。** 真机对线失败暴露了这一条：
// 线从图案的包围盒中心画出去，而反射器真正能接收的航道在质心侧向 4 格外 ——
// 两条线对齐了，滑翔机却撞在别处。吞食者一直没暴露，只因为它的质心恰好落在包围盒中心上。
// 所以每一类的量测都返回一个 `lane`：**这条线必须穿过的那个点，写在图案自己的坐标系里**
// （相对左上角），画的时候加上落点原点即可 —— 锚点歧义就此消失。
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
  mwss: 'ship',
  hwss: 'ship',
  gun: 'gun',
  eater: 'eater',
  snark: 'reflector'
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
const PROBE_SIZE = Object.freeze({ ship: 60, gun: 120, eater: 60, reflector: 70 })

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
  if (kind === 'ship') return withNormalLane(measureShip(pattern), pattern)
  if (kind === 'gun') return withNormalLane(measureGun(pattern), pattern)
  if (kind === 'eater') return withLandings(withNormalLane(measureEater(pattern), pattern), pattern)
  if (kind === 'reflector') return withLandings(withNormalLane(measureReflector(pattern), pattern), pattern)
  return null
}

/**
 * 可落点（D98 ②）。**线对上了还不够**：航道上并不是每一格都能放。
 * 实测两件事逼出了这一条：
 *   · 落点只能落在格子上，而图案自己的航道点带小数 ——
 *     于是沿线可用的位置是一串**间隔一格、但起点带零头**的点，不是"整数格"；
 *   · 就算落在线上，也有死点：反射器实测在上游 7.1 格处放下会撞爆它，而 6.4 与 8.5 都好。
 *
 * 所以这些点不是算出来的，是**一个一个试出来的**：沿线取候选，逐个跑一遍，
 * 成的才留下。守卫再反过来断言"标出来的点全都成"—— 画的和能发生的必须是一回事。
 */
function withLandings(motion, pattern) {
  if (!motion || !motion.lane || !motion.via) return motion
  const size = motion.kind === 'reflector' ? PROBE_SIZE.reflector : PROBE_SIZE.eater
  return { ...motion, landings: findLandings(pattern, motion, size) }
}

/** 沿线的候选点里，真能成的那些（返回"上游多少格"，可为小数） */
export function findLandings(pattern, motion, size, range = LANDING_RANGE) {
  const glider = orientedGlider(motion.via)
  const ux = motion.dx / Math.hypot(motion.dx, motion.dy)
  const uy = motion.dy / Math.hypot(motion.dx, motion.dy)
  const gLane = laneOfGlider(motion.via)
  if (!gLane) return []
  const ox = originOf(size, pattern.w), oy = originOf(size, pattern.h)
  const A = { x: ox + motion.lane.x, y: oy + motion.lane.y }
  const before = fresh(pattern, size).cur.slice()
  const pop = pattern.cells.length
  const out = []
  const seen = new Set()
  // 候选：沿线往上游走，每步一格；**取那一步附近的九个格子逐个看**，而不是只取四舍五入
  // 的那一个 —— 两个图案各自的航道点都带零头，最贴线的格子常常是邻居而不是它。
  // （吞食者身上实测过：只取四舍五入那个，最近的也差 0.57 格，于是一个落点都找不出来。）
  for (let step = range.from; step <= range.to; step++) {
    const bx = Math.round(A.x - motion.dx * step - gLane.x)
    const by = Math.round(A.y - motion.dy * step - gLane.y)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const gx = bx + dx, gy = by + dy
      const tag = gx + ',' + gy
      if (seen.has(tag)) continue
      const ax = gx + gLane.x, ay = gy + gLane.y
      const rx = ax - A.x, ry = ay - A.y
      if (Math.abs(rx * -uy + ry * ux) > 0.5) continue      // 没落在线上就不算候选
      const along = -(rx * ux + ry * uy)
      if (along < range.from || along > range.to + 6) continue
      seen.add(tag)
      if (interactionWorks(pattern, before, pop, glider, gx, gy, size, motion.kind)) {
        // 两个都写在**图案自己的坐标系**里（相对它的左上角）：
        //   · `dot` 是那架滑翔机的航道点 —— 画出来的小圈就在这儿；
        //   · `at`  是它左上角该落的格 —— 守卫照这个放，跑一遍必须成。
        // 两者相差的是滑翔机自己那点零头，所以**画的位置与试的位置是同一处**。
        out.push({
          along: Math.round(along * 100) / 100,
          dot: { x: ax - ox, y: ay - oy },
          at: { x: gx - ox, y: gy - oy }
        })
      }
    }
  }
  return out.sort((a, b) => a.along - b.along)
}

/** 沿线试多远。近处会撞进图案自己身上，远处只是白跑 */
const LANDING_RANGE = Object.freeze({ from: 5, to: 14 })

/** 按记下来的朝向取那架对应的滑翔机 */
function orientedGlider(via) {
  const g = getPattern('glider')
  return (via.rot || via.flip) ? transformPattern(g, via) : g
}

/** 那架滑翔机自己的航道点（相对它的左上角） */
function laneOfGlider(via) {
  const m = measureShip(orientedGlider(via))
  if (!m) return null
  return withNormalLane(m, orientedGlider(via)).lane
}

/** 放上去跑一遍，成没成。判据与各自的量测完全一致，不另写一套 */
function interactionWorks(pattern, before, pop, glider, gx, gy, size, kind) {
  if (gx < 0 || gy < 0 || gx + glider.w >= size || gy + glider.h >= size) return false
  const e = fresh(pattern, size)
  placePattern(e, glider, gx, gy)
  e.stats.alive = e.countAlive()
  if (e.stats.alive !== pop + 5) return false        // 与图案重叠了，不算落点
  for (let g = 1; g <= 160; g++) {
    e.step()
    if (kind === 'eater') {
      if (e.stats.alive !== pop) continue
      if (g > 3 && sameBoard(e.cur, before)) return true
    } else {
      if (e.stats.alive !== pop + 5) continue
      const extra = extraCells(e.cur, before)
      if (g > 20 && extra && extra.length === 5) return true
    }
  }
  return false
}

/**
 * 把航道点**沿着航道自己滑到离图案最近处**。
 *
 * 一条直线由"一个点 + 方向"定住，点在线上滑动不改变这条线 ——
 * 所以这一步不动几何，只挑一个好看的代表点。为什么要挑：
 * 枪量出来的航道点在枪口外十几格（那是弹道上的一点，没错，但线从那儿起画就凌空了），
 * 而滑到离枪身最近处，线仍在同一条弹道上，起点却贴着枪。
 *
 * 这一步是纯几何，不重新实测 —— 实测的是"哪条线"，这里只决定"从线上哪一点开始画"。
 */
function withNormalLane(motion, pattern) {
  if (!motion || !motion.lane) return motion
  const out = { ...motion, lane: slideToPattern(motion.lane, motion, pattern) }
  // 出射那条同样要滑回来：不然线从图案外十几格才起头，中间断一截（D100）
  if (motion.exit && motion.exit.lane) {
    out.exit = { ...motion.exit, lane: slideToPattern(motion.exit.lane, motion.exit, pattern) }
  }
  return out
}

/** 把线上的一点沿着这条线自己滑到离图案最近处。纯几何，不动方向也不动这条线 */
function slideToPattern(lane, dir, pattern) {
  const n = Math.hypot(dir.dx, dir.dy) || 1
  const ux = dir.dx / n, uy = dir.dy / n
  const cx = (pattern.w - 1) / 2, cy = (pattern.h - 1) / 2
  const t = (cx - lane.x) * ux + (cy - lane.y) * uy
  return { x: lane.x + ux * t, y: lane.y + uy * t }
}

/** 飞船：多代质心位移 */
export function measureShip(pattern, gens = SHIP_GENS) {
  const n = PROBE_SIZE.ship
  const e = fresh(pattern, n)
  const a = centroid(e)
  e.run(gens)
  const b = centroid(e)
  if (!a || !b) return null
  const dx = Math.round(b.x - a.x), dy = Math.round(b.y - a.y)
  if (dx === 0 && dy === 0) return null          // 没走 = 不是飞船，别编方向
  // 航道：飞船自己走的那条线，穿过它的质心。用质心而不是包围盒中心 ——
  // 稀疏图案的包围盒中心可能根本不在它的航道上（D98）
  return { ...reduce(dx, dy, gens), kind: 'ship', lane: localOf(a, pattern, n) }
}

/** 把探针盘上的一个点换算成图案自己的坐标（相对左上角） */
function localOf(pt, pattern, size) {
  return { x: pt.x - originOf(size, pattern.w), y: pt.y - originOf(size, pattern.h) }
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
  // 航道：弹道本身。取**射出去那团东西**第二次采样时的位置 —— 它就在弹道上；
  // 枪身的包围盒中心不在（子弹从枪口出来，不从枪的正中出来，D98）
  return { dx: dx / g, dy: dy / g, gens: null, kind: 'gun', lane: localOf(b, pattern, n) }
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
        if (hit) {
          // **对应图案的朝向也要记下来**（D98）：光有方向不够 —— 同一个方向上有两种手性的
          // 滑翔机，吞食者只吃其中一种。只报方向，等于让用户在两者之间猜。
          return {
            dx: ship.dx, dy: ship.dy, gens: ship.gens, kind: 'eater', eatenAt: hit, side,
            via: { rot: o.rot, flip: o.flip },
            lane: laneOf(pattern, PROBE_SIZE.eater, ship, side)
          }
        }
      }
    }
  }
  return null
}

/**
 * 反射器（D96）：它自己不动，方向是**可接收的那条来路** —— 与吞食者同类，
 * 差别只在判据：吞食者吃掉滑翔机（盘上只剩它自己），反射器把滑翔机**拐 90° 送走**
 * （盘上仍有一架，方向变了）。所以三条都要，缺一条就会把别的现象当成反射：
 *   ① 反射器**逐格复原**（不是"人口对得上"——撞坏了同时别处多出几格也能凑数）；
 *   ② 盘上另有且仅有 5 格，且它们**在动**；
 *   ③ 出射方向 ≠ 入射方向（否则那是"从旁边飞过去了"，不是反射）；
 *      也不许是 0（那是被吃掉了，那是吞食者的行当）。
 * 还有一条更朴素的：过程中人口必须偏离过（`touched`）——**没碰上就不算数**。
 *
 * **锚点用质心，不用包围盒左上角。** 这是被实测逼出来的：转 90° 之后包围盒的角
 * 相对图案内部会挪好几格，同一条巷道的 (back, side) 就跟着漂，于是有些朝向搜不到 ——
 * 而质心跟着图案一起转。改成质心之后，八个朝向量出来的都是 back=4 / side=±4，
 * 这才是"同一条巷道"该有的样子。
 */
export function measureReflector(pattern, gens = 70) {
  const n = PROBE_SIZE.reflector
  const before = fresh(pattern, n).cur.slice()
  const pop = pattern.cells.length
  const anchor = centroid(fresh(pattern, n))
  if (!anchor) return null
  for (const o of ORIENTS) {
    const glider = (o.rot || o.flip) ? transformPattern(getPattern('glider'), o) : getPattern('glider')
    const ship = measureShip(glider)
    if (!ship) continue
    for (const side of REFLECT_SIDES) {
      for (const back of REFLECT_BACKS) {
        const hit = reflectOnce(pattern, before, pop, glider, ship, anchor, back, side, gens, n)
        if (hit) {
          return {
            dx: ship.dx, dy: ship.dy, gens: ship.gens, kind: 'reflector',
            restoredAt: hit.restoredAt, outDx: hit.outDx, outDy: hit.outDy, back, side,
            via: { rot: o.rot, flip: o.flip },
            lane: laneOf(pattern, n, ship, side),
            // 出射航道（D100）：方向与航道点都是实测的 —— 那架滑翔机往哪飞、飞在哪条线上
            exit: { dx: hit.outDx, dy: hit.outDy, lane: localOf(hit.outAt, pattern, n) }
          }
        }
      }
    }
  }
  return null
}

/** 搜索窗口。近处优先 —— 巷道就在贴着它的那几格上，远了滑翔机根本碰不到它 */
const REFLECT_BACKS = Object.freeze([4, 5, 6])
const REFLECT_SIDES = Object.freeze([0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6])

/** 出射之后再跑这么多代来量它往哪儿走 */
const REFLECT_OUT_GENS = 20

/** 射一次：顺着来向退开 back 格、侧向错开 side 格放滑翔机，看它有没有被拐 90° 送走 */
function reflectOnce(refl, before, pop, glider, ship, anchor, back, side, gens, n) {
  const e = fresh(refl, n)
  const gx = Math.round(anchor.x - ship.dx * back - ship.dy * side) - (glider.w >> 1)
  const gy = Math.round(anchor.y - ship.dy * back + ship.dx * side) - (glider.h >> 1)
  if (gx < 0 || gy < 0 || gx + glider.w >= n || gy + glider.h >= n) return null
  placePattern(e, glider, gx, gy)
  e.stats.alive = e.countAlive()
  let touched = false
  for (let g = 1; g <= gens; g++) {
    if (g > REFLECT_MISS_GENS && !touched) return null    // 这么久还没碰上 = 从旁边飞过去了
    e.step()
    if (e.stats.alive !== pop + 5) { touched = true; continue }
    if (!touched) continue
    const extra = extraCells(e.cur, before)
    if (!extra || extra.length !== 5) continue
    const c0 = meanOf(extra, n)
    for (let k = 0; k < REFLECT_OUT_GENS; k++) e.step()
    const after = extraCells(e.cur, before)
    if (!after || after.length !== 5) continue
    const c1 = meanOf(after, n)
    const outDx = Math.round((c1.x - c0.x) / (REFLECT_OUT_GENS / 4))
    const outDy = Math.round((c1.y - c0.y) / (REFLECT_OUT_GENS / 4))
    if (!outDx && !outDy) return null                     // 没了 = 被吃掉，那是吞食者的行当
    if (outDx === ship.dx && outDy === ship.dy) return null // 方向没变 = 没拐弯
    // 出射航道上的一点：**就是那架滑翔机自己所在的位置**（D100）。
    // 方向与点都取自同一次推演，出口线因此画在它真正飞过的那条线上。
    return { restoredAt: g, outDx, outDy, outAt: c0 }
  }
  return null
}

/** 多久没碰上就判定这一组是空枪 */
const REFLECT_MISS_GENS = 40

/**
 * 盘上"不属于原图案"的那些格子。原图案的每一格都必须还在（逐格复原），
 * 少一格就直接判失败 —— 返回 null。
 */
function extraCells(cur, before) {
  const out = []
  for (let i = 0; i < before.length; i++) {
    if (before[i] === 1) { if (cur[i] !== 1) return null }
    else if (cur[i] === 1) out.push(i)
  }
  return out
}

function meanOf(idxs, n) {
  let sx = 0, sy = 0
  for (const i of idxs) { sx += i % n; sy += (i / n) | 0 }
  return { x: sx / idxs.length, y: sy / idxs.length }
}

/** 八个朝向：四个旋转 × 两种镜像 */
const ORIENTS = Object.freeze([
  { rot: 0, flip: false }, { rot: 1, flip: false }, { rot: 2, flip: false }, { rot: 3, flip: false },
  { rot: 0, flip: true }, { rot: 1, flip: true }, { rot: 2, flip: true }, { rot: 3, flip: true }
])

/**
 * 可接收航道穿过的那个点，写在图案自己的坐标系里（相对左上角）。
 *
 * 摆位是"从锚点沿来路退 back 格、再侧向错开 side 格"，锚点是**质心**。
 * 于是航道就是"过 `质心 + 垂线 × side`、方向为来路"的那条直线 ——
 * 退多远只决定站在线上的哪一点，不影响是哪条线（实测 back 4..14 全可行，见 D98）。
 * 垂线取 (-dy, dx)，与摆位算式里用的是同一个：两处若不同，量出来的线就不是试出来的线。
 */
function laneOf(pattern, size, ship, side) {
  const c = centroid(fresh(pattern, size))
  if (!c) return null
  return localOf({ x: c.x - ship.dy * side, y: c.y + ship.dx * side }, pattern, size)
}

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
  // 锚点用**质心**，与反射器、与 laneOf 同一个（D98）：原先用包围盒左上角，
  // 吞食者身上碰巧差不多，反射器身上就差了四格 —— 于是"试出来的摆位"与"画出来的线"不是同一条。
  const c = centroid(fresh(eater, n))
  if (!c) return 0
  // 来路方向的垂直方向：(dx,dy) 转 90° 就是 (-dy,dx)
  const gx = Math.round(c.x - ship.dx * back - ship.dy * side) - (glider.w >> 1)
  const gy = Math.round(c.y - ship.dy * back + ship.dx * side) - (glider.h >> 1)
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
 * `solidEnd` 说的是"图案在哪一端" —— 渐变的浓端要落在那里（D89 ②）。
 * @returns {{from:{x,y}, to:{x,y}, arrowAt:'to'|'from', solidEnd:'to'|'from'}}
 */
/**
 * 这条线该穿过哪个点（棋盘坐标）。**唯一出口** —— 待放线、参照线、守卫复核都走它，
 * 免得"画出来的"与"试出来的"各算一份（D98）。
 */
export function rayAnchor(pattern, origin, motion) {
  if (motion && motion.lane) return { x: origin.x + motion.lane.x, y: origin.y + motion.lane.y }
  // 没量到航道点的退回包围盒中心，至少画得出一条线
  return { x: origin.x + (pattern.w - 1) / 2, y: origin.y + (pattern.h - 1) / 2 }
}

/**
 * 可落点在棋盘上的位置（D98 ②）：从锚点沿来路退开实测出来的那几段距离。
 * 只有互动型才有 —— 飞船与枪不需要"放在哪一点"。
 */
export function landingDots(origin, motion) {
  if (!motion || !motion.landings || !motion.landings.length) return []
  return motion.landings.map(l => ({ x: origin.x + l.dot.x, y: origin.y + l.dot.y }))
}

/**
 * 入口线（D100）：**从哪儿进来**。只有互动型有 —— 吞食者、反射器。
 * 画成实线、箭头指向图案，因为它是"你要瞄的那条"。
 * @returns {{from,to,arrowAt,solidEnd,center,dx,dy}|null}
 */
export function entryEnds(pattern, origin, motion, bounds) {
  if (!motion || (motion.kind !== 'eater' && motion.kind !== 'reflector')) return null
  const center = rayAnchor(pattern, origin, motion)
  return { ...rayEnds(motion.kind, center, motion, bounds), center, dx: motion.dx, dy: motion.dy }
}

/**
 * 出口线（D100）：**它会往哪儿去**。三种图案有：
 *   · 反射器 —— 拐出去的那架滑翔机的实测轨迹；
 *   · 枪 —— 弹道（与反射器**同一个口径**：都是"从我这儿出去的东西走哪条线"）；
 *   · 飞船 —— 它自己的航线。
 * 吞食者没有出口：进去的东西没再出来，画一条线就是在编（所以返回 null）。
 * 画成虚线、更淡、箭头朝外。
 */
export function exitEnds(pattern, origin, motion, bounds) {
  if (!motion) return null
  const spec = motion.exit || (motion.kind === 'gun' || motion.kind === 'ship' ? motion : null)
  if (!spec || !spec.lane) return null
  const center = { x: origin.x + spec.lane.x, y: origin.y + spec.lane.y }
  // 出口一律按"图案在起点、箭头在远端"画 —— 与飞船/枪本来的画法是同一套
  return { ...rayEnds('ship', center, spec, bounds), center, dx: spec.dx, dy: spec.dy }
}

export function rayEnds(kind, center, dir, bounds) {
  const n = Math.hypot(dir.dx, dir.dy) || 1
  const ux = dir.dx / n, uy = dir.dy / n
  // 一路画到棋盘边缘（D89 ②）：截一段固定长度等于替用户决定"看这么远就够了"，
  // 而他要判断的恰恰是"这条线会不会撞上那个东西"——那条线该有多长，由棋盘说了算。
  const away = distanceToEdge(center, ux, uy, bounds)
  const back = distanceToEdge(center, -ux, -uy, bounds)
  if (kind === 'eater' || kind === 'reflector') {
    // 来路在反方向上：图案在 to 这一端，箭头也在这一端（指向嘴 / 指向接口）。
    // 反射器画的是**入射那条巷道**，不是出射的：用户要瞄的是"从哪儿射进来"，
    // 出射往哪儿拐是它替你决定的事（出射线留给第二批那几局机关去讲）。
    return {
      from: { x: center.x - ux * back, y: center.y - uy * back },
      to: { x: center.x, y: center.y },
      arrowAt: 'to', solidEnd: 'to'
    }
  }
  // 飞船/枪：图案在 from 这一端，箭头在远端
  return {
    from: { x: center.x, y: center.y },
    to: { x: center.x + ux * away, y: center.y + uy * away },
    arrowAt: 'to', solidEnd: 'from'
  }
}

/**
 * 从 center 沿 (ux,uy) 走到棋盘边还有多远（格）。
 * 没给棋盘尺寸时退回一个够用的默认长度 —— 宁可短一点，也不画出盘外去。
 */
export function distanceToEdge(center, ux, uy, bounds) {
  if (!bounds || !(bounds.w > 0) || !(bounds.h > 0)) return RAY_FALLBACK
  let d = Infinity
  if (ux > 0) d = Math.min(d, (bounds.w - center.x) / ux)
  else if (ux < 0) d = Math.min(d, (0 - center.x) / ux)
  if (uy > 0) d = Math.min(d, (bounds.h - center.y) / uy)
  else if (uy < 0) d = Math.min(d, (0 - center.y) / uy)
  return Number.isFinite(d) ? Math.max(0, d) : RAY_FALLBACK
}

/** 拿不到棋盘尺寸时的兜底长度（格） */
export const RAY_FALLBACK = 26

/**
 * 一次落子留下的**参照线**（D91）：把"放下时的位置与朝向"冻在这里。
 *
 * 它是一张**静态贴纸** —— 记的是落子那一刻的中心与方向，此后引擎怎么跑都不改它。
 * 之所以不跟着引擎走：放下去的东西下一秒就变形、移动、甚至被吃掉，
 * 而这条线要回答的是"我刚才把它对着哪儿放的"，那是历史，不是现状。
 *
 * @param {object} pattern 落子用的图案（当前朝向）
 * @param {{x:number,y:number}} origin 左上角落点
 * @param {{dx:number,dy:number,kind:string}|null} motion 实测出来的动向
 * @returns {{kind:string, center:{x,y}, dx:number, dy:number}|null} 没方向就没有参照线
 */
/** 出口线的静态形态：一个点 + 一个方向，够画了 */
function exitSticker(pattern, origin, motion) {
  const spec = motion.exit || (motion.kind === 'gun' || motion.kind === 'ship' ? motion : null)
  if (!spec || !spec.lane) return null
  return { center: { x: origin.x + spec.lane.x, y: origin.y + spec.lane.y }, dx: spec.dx, dy: spec.dy }
}

export function refFromPlacement(pattern, origin, motion) {
  if (!pattern || !origin || !motion) return null
  return {
    kind: motion.kind,
    center: rayAnchor(pattern, origin, motion),   // 与待放那条同一个锚点（D98）
    dx: motion.dx, dy: motion.dy,
    // 参照线上也标可落点：拿起下一架时，照着这些小圈放即可。
    // 落子那一刻就换算成棋盘坐标 —— 参照线是张静态贴纸（D91），不该再依赖图案对象
    dots: landingDots(origin, motion),
    // 出口线同样冻在落子那一刻（D100）：它记的是"这一台当时会把东西送往哪儿"
    exit: exitSticker(pattern, origin, motion)
  }
}

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
