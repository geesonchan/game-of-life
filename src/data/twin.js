// 临界实验室 · 分岔时刻（D86 ②）。
//
// 两个宇宙只差一格，并排跑。差异格数逐代记下来，两件事各有一个可判的判据：
//
//   **分道扬镳** = 差异格的外接框首次越出被翻那一格的 ±2 窗口。
//                  差异不再是那一格自身的余波，而开始向外传播。
//   **合并**     = 差异格数连续 8 代为 0。那一格的扰动被彻底吸收，两个宇宙从此是同一个。
//
// 之所以要这么定，是因为 A/B 只差一格意味着**第 0 代的差异恒为 1** ——
// "差异从零抬头"这句话得先落到一个判得动的量上（D86 §3）。
//
// 纯数据层，零 DOM。界面拿两台引擎自己去画，判据与曲线都在这里。
import { LifeEngine } from '../engine/board.js'
import { lifeRule } from '../engine/rules.js'
import { getPattern } from '../engine/patterns.js'

/** 两个阈值 + 默认口径。改这里就等于改"分道扬镳"这个词的意思。 */
export const TWIN = Object.freeze({
  escapeRadius: 2,     // 逃逸半径：差异外接框越出这个窗口就算分道
  mergeGens: 8,        // 连续多少代差异为 0 才算合并（少了会把一瞬间的巧合当合并）
  board: 200, boundary: 'torus', gens: 1200
})

/**
 * 三个内置示例。同样是"只差一格"，位置决定它是历史的开端还是一声没响。
 * 坐标是**相对图案左上角**的；`inside` 表示这一格本来在图案里（翻它 = 去掉它）。
 */
export const TWIN_EXAMPLES = Object.freeze([
  { key: 'lonely', pattern: 'matt', dx: 1, dy: 3, nameKey: 'crit.twin.lonely' },   // Matt 那颗孤立格
  { key: 'edge', pattern: 'matt', dx: 3, dy: 1, nameKey: 'crit.twin.edge' },       // 贴着图案的空格
  { key: 'vacuum', pattern: 'matt', dx: 40, dy: 40, nameKey: 'crit.twin.vacuum' }  // 真空里一格
])

/**
 * 造一对双宇宙。
 * @param {{pattern?:string, cells?:Array<[number,number]>, dx:number, dy:number, board?:number,
 *          boundary?:string, gens?:number}} o
 * @returns {{a:LifeEngine, b:LifeEngine, flip:{x:number,y:number}, gen:number,
 *           diff:number[], diverged:{gen:number}|null, merged:{gen:number}|null,
 *           done:boolean, step:Function, run:Function}}
 */
export function createTwin(o = {}) {
  const spec = { ...TWIN, ...o }
  const n = spec.board
  const cells = o.cells || getPattern(o.pattern || 'matt').cells
  const w = Math.max(...cells.map(c => c[0])) + 1
  const h = Math.max(...cells.map(c => c[1])) + 1
  const ox = (n - w) >> 1, oy = (n - h) >> 1         // 与「复现」同一条居中算法
  const flip = { x: wrap(ox + o.dx, n), y: wrap(oy + o.dy, n) }

  const mk = flipIt => {
    const e = new LifeEngine(n, n, { rule: lifeRule(), boundary: spec.boundary })
    for (const [x, y] of cells) e.set(ox + x, oy + y, 1)
    if (flipIt) e.set(flip.x, flip.y, e.get(flip.x, flip.y) === 1 ? 0 : 1)
    e.stats.alive = e.countAlive()
    return e
  }

  const twin = {
    spec, flip, a: mk(false), b: mk(true),
    gen: 0,
    diff: [1],                    // 第 0 代恒为 1：两个宇宙就差这一格，这是构造出来的
    diverged: null, merged: null, done: false,
    step, run
  }
  let zeros = 0

  function step() {
    if (twin.done) return twin
    twin.a.step(); twin.b.step()
    twin.gen++
    const m = measure(twin.a, twin.b, n)
    twin.diff.push(m.count)

    if (m.count === 0) {
      zeros++
      if (!twin.merged && zeros >= spec.mergeGens) twin.merged = { gen: twin.gen }
    } else {
      zeros = 0
      // 逃逸：差异外接框越出"被翻那格 ±r"的窗口
      const r = spec.escapeRadius
      if (!twin.diverged &&
        (m.x0 < flip.x - r || m.x1 > flip.x + r || m.y0 < flip.y - r || m.y1 > flip.y + r)) {
        twin.diverged = { gen: twin.gen }
      }
    }
    if (twin.gen >= spec.gens || twin.merged) twin.done = true
    return twin
  }

  function run(k = 1) { for (let i = 0; i < k && !twin.done; i++) step(); return twin }

  return twin
}

/** 差异格数与外接框。热路径，写成一趟扫描。 */
export function measure(a, b, n) {
  const ca = a.cur, cb = b.cur
  let count = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < ca.length; i++) {
    if (ca[i] === cb[i]) continue
    count++
    const x = i % n, y = (i / n) | 0
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return { count, x0, y0, x1, y1 }
}

/** 差异格的下标集合（渲染高亮与光锥断言用；不在热路径上） */
export function diffCells(a, b) {
  const out = []
  for (let i = 0; i < a.cur.length; i++) if (a.cur[i] !== b.cur[i]) out.push(i)
  return out
}

function wrap(v, n) { return ((v % n) + n) % n }
