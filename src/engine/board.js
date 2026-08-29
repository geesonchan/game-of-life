// 生命游戏引擎核心：纯逻辑，零 DOM 依赖，可在 Node 里直接跑测试。
// 架构约束：双缓冲（cur/next 交替），禁止每代新建数组。

import { mulberry32 } from './prng.js'
import { lifeRule, ALIVE } from './rules.js'

export class LifeEngine {
  /**
   * @param {number} width 棋盘宽（格）
   * @param {number} height 棋盘高（格）
   * @param {{rule?: object, boundary?: 'torus'|'dead'}} [opts]
   */
  constructor(width, height, opts = {}) {
    this.w = width | 0
    this.h = height | 0
    if (this.w < 1 || this.h < 1) throw new Error('棋盘尺寸非法')
    this.rule = opts.rule || lifeRule()
    this.boundary = opts.boundary || 'torus'

    this.cur = new Uint8Array(this.w * this.h)
    this.next = new Uint8Array(this.w * this.h)
    // 竖直列和缓冲，两端各留一格放环形环绕列 → 内层循环彻底无分支
    this._colSum = new Uint16Array(this.w + 2)

    this.generation = 0
    this.seed = 0
    this.density = 0
    this.initType = 'empty'
    this.stats = emptyStats()
  }

  /** 更换棋盘尺寸（会清空棋盘并重置代数） */
  resize(width, height) {
    this.w = width | 0
    this.h = height | 0
    this.cur = new Uint8Array(this.w * this.h)
    this.next = new Uint8Array(this.w * this.h)
    this._colSum = new Uint16Array(this.w + 2)
    this.generation = 0
    this.stats = emptyStats()
  }

  /**
   * 更换规则（已编译的查找表对象）。
   * 棋盘上所有"新规则下不可达"的状态一律清成死亡：既避免查表越界，
   * 也保证「可达闭包」这个判定对棋盘成立（见 docs/decisions.md D18 的健全性前提）——
   * 否则旧规则遗留的衰老细胞会一直按衰老行演化，"这条规则等价于某个 B/S 规则"就不再成立。
   */
  setRule(rule) {
    this.rule = rule
    const max = rule.numStates - 1
    const reachable = rule.reachable
    const cur = this.cur
    for (let i = 0; i < cur.length; i++) {
      const s = cur[i]
      if (s > max || (reachable && !reachable[s])) cur[i] = 0
    }
  }

  setBoundary(b) {
    if (b !== 'torus' && b !== 'dead') throw new Error('未知边界类型：' + b)
    this.boundary = b
  }

  index(x, y) { return y * this.w + x }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0
    return this.cur[y * this.w + x]
  }

  set(x, y, v) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    this.cur[y * this.w + x] = v
  }

  clear() {
    this.cur.fill(0)
    this.next.fill(0)
    this.generation = 0
    this.initType = 'empty'
    this.stats = emptyStats()
  }

  /**
   * 种子化随机初始化。同种子 + 同密度 + 同尺寸 ⇒ 棋盘逐格相同。
   * @param {number} seed 32 位整数种子
   * @param {number} density 0–1 的活细胞密度
   */
  randomize(seed, density) {
    const rng = mulberry32(seed >>> 0)
    const cur = this.cur
    for (let i = 0; i < cur.length; i++) cur[i] = rng() < density ? ALIVE : 0
    this.next.fill(0)
    this.generation = 0
    this.seed = seed >>> 0
    this.density = density
    this.initType = 'random'
    this.stats = emptyStats()
    this.stats.alive = this.countAlive()
    return this
  }

  countAlive() {
    const cur = this.cur
    let n = 0
    for (let i = 0; i < cur.length; i++) if (cur[i] === ALIVE) n++
    return n
  }

  /** 棋盘内容哈希（FNV-1a），用于静止/循环检测与回归基线 */
  hash() {
    const cur = this.cur
    let h = 0x811c9dc5
    for (let i = 0; i < cur.length; i++) {
      h ^= cur[i]
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16).padStart(8, '0')
  }

  /**
   * 演进一代。返回本代统计（数据层的挂钩点，渲染层对其无感知）。
   * @returns {{gen:number, alive:number, births:number, deathsLonely:number,
   *            deathsCrowded:number, deathsOther:number, activeArea:number}}
   */
  step() {
    const w = this.w, h = this.h
    const cur = this.cur, next = this.next
    const lut = this.rule.lookup
    const av = this.rule.aliveMap
    const torus = this.boundary === 'torus'
    const cs = this._colSum

    let alive = 0, births = 0, dLonely = 0, dCrowded = 0, dOther = 0
    let minX = w, minY = h, maxX = -1, maxY = -1

    for (let y = 0; y < h; y++) {
      const rowY = y * w
      // 第一步：算三行的竖直列和，写进 cs[1..w]
      for (let x = 0; x < w; x++) cs[x + 1] = av[cur[rowY + x]]
      let ym = y - 1, yp = y + 1
      if (ym < 0) ym = torus ? h - 1 : -1
      if (yp >= h) yp = torus ? 0 : -1
      if (ym >= 0) {
        const b = ym * w
        for (let x = 0; x < w; x++) cs[x + 1] += av[cur[b + x]]
      }
      if (yp >= 0) {
        const b = yp * w
        for (let x = 0; x < w; x++) cs[x + 1] += av[cur[b + x]]
      }
      // 两端哨兵：环形边界时补对侧列，死边界时补 0
      cs[0] = torus ? cs[w] : 0
      cs[w + 1] = torus ? cs[1] : 0

      // 第二步：横向三列求和 - 自身，查表得下一状态
      for (let x = 0; x < w; x++) {
        const i = rowY + x
        const s = cur[i]
        const selfAlive = av[s]
        const n = cs[x] + cs[x + 1] + cs[x + 2] - selfAlive
        const ns = lut[s * 9 + n]
        next[i] = ns
        if (ns === ALIVE) alive++
        if (ns !== s) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
          if (selfAlive === 0 && ns === ALIVE) births++
          else if (selfAlive === 1 && ns !== ALIVE) {
            if (n < 2) dLonely++
            else if (n > 3) dCrowded++
            else dOther++
          }
        }
      }
    }

    // 双缓冲交换
    this.cur = next
    this.next = cur
    this.generation++

    this.stats = {
      gen: this.generation,
      alive,
      births,
      deathsLonely: dLonely,
      deathsCrowded: dCrowded,
      deathsOther: dOther,
      activeArea: maxX < 0 ? 0 : (maxX - minX + 1) * (maxY - minY + 1)
    }
    return this.stats
  }

  /** 连续演进 n 代（读档重放用），返回最后一代统计 */
  run(n) {
    let s = this.stats
    for (let i = 0; i < n; i++) s = this.step()
    return s
  }

  /** 拷贝当前棋盘（测试与比对用，非热路径） */
  snapshot() { return this.cur.slice() }
}

function emptyStats() {
  return { gen: 0, alive: 0, births: 0, deathsLonely: 0, deathsCrowded: 0, deathsOther: 0, activeArea: 0 }
}
