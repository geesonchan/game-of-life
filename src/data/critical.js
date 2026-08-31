// 临界实验室 · 参数轴（D86 ①）。
//
// 同一条规则、同一颗种子，只把初始密度推过某处，"涌现"就换成了"没涌现"。
// 这个模块负责把那条轴跑出来：每一档一个事实单位，跨越点由二分**夹**出来，不靠撞上。
//
// 口径写死在 CRITICAL_SPEC 里，与内置精选局、自存收藏的生平**同一把尺子**（D82 §8）：
// 默认 200×200 环形盘 + 应用自己的终止检测器。图注直接读这几个字段，
// 所以每个数都答得上来"它是被什么裁出来的"。
//
// 纯数据层，零 DOM，可在 Node 里测；Worker 只负责搬运（workers/critical.js）。
import { LifeEngine } from '../engine/board.js'
import { lifeRule } from '../engine/rules.js'
import { TerminationDetector } from './detector.js'
import { classifyRun, relativeVariation } from './explorer.js'

/** 口径三件套 + 种子。改这里就等于改这个专题里的每一个数。 */
export const CRITICAL_SPEC = Object.freeze({
  board: 200, boundary: 'torus', genCap: 5000, seed: 4271
})

/**
 * 分类判据的**重标定**（D86 §1）。
 *
 * 勘探器的默认阈值是按"扫规则、密度固定在 0.10"标定的，直接拿来扫密度会说谎：
 * 实测 0.45 以上全被判成 explosion，连"第 2 代就全灭"的 0.90 也是 ——
 * 因为 `explosionFlood` 判的是**绝对占比**，而这条轴上密度正是自变量。
 * 所以停用那一条（1.01 = 永不触发），只保留"相对起点的增长"那一条。
 * 有一条反面断言钉着这件事：拿默认参数跑 0.90 必然得到 explosion。
 *
 * **这里只放分类判据，绝不能把 boardSize / density / genCap 一起带上。**
 * 第一版图省事写成 `{...DEFAULTS, explosionFlood: 1.01}`，结果它把 density 也带成了 0.10 ——
 * 谁把它当 spec 传给 probeRule，被测的那一局就被悄悄换掉了，而分类结果看着还挺合理。
 * 是那条反面断言把它抓出来的。
 */
export const CRITICAL_CLASSIFY = Object.freeze({ explosionFlood: 1.01 })

/** 轴：低端走细步，高端走粗步。低端那几档每档只要 1–5ms，细下去几乎不花钱。 */
export const AXIS = Object.freeze({ from: 0.01, fineTo: 0.10, fineStep: 0.01, to: 0.95, coarseStep: 0.05 })

/** 跨越点要夹到多窄。0.01 是"再细也看不出差别"的量级。 */
export const REFINE_WIDTH = 0.01

/** 算"有戏"的三类结局。still / extinct / quickDeath / explosion 都不是"涌现"。 */
export const EMERGENT_OUTCOMES = Object.freeze(['complex', 'longCycle', 'shortCycle'])

/**
 * 涌现的最低代数门槛。
 * 第 4 代就定住的十来个格子在分类上也是 shortCycle，但那不是涌现，那是余烬 ——
 * 门槛把它挡在窗口外面。100 代是量出来的：实测轴上"有戏"的最低一档跑了 3089 代，
 * "没戏"的最高一档只跑了 7 代，两边差着两个数量级，门槛落在中间怎么取都一样。
 */
export const EMERGENCE_MIN_GENS = 100

/** 密度轴。返回升序、去重、按 3 位小数收敛的密度列表。 */
export function densityAxis(opts = {}) {
  const o = { ...AXIS, ...opts }
  const out = []
  for (let d = o.from; d <= o.fineTo + 1e-9; d += o.fineStep) out.push(round3(d))
  for (let d = o.fineTo + o.coarseStep; d <= o.to + 1e-9; d += o.coarseStep) out.push(round3(d))
  return [...new Set(out)].sort((a, b) => a - b)
}

/** 浮点密度收敛到 3 位小数 —— 0.1+0.05 那种尾巴不能进数据，图注上会露出来 */
export function round3(v) { return Math.round(Number(v) * 1000) / 1000 }

/**
 * 跑一档。这是这个专题的最小事实单位。
 * @param {number} density
 * @param {object} spec 覆盖口径（只在测试里用小盘）
 * @returns {object} CriticalSample
 */
export function observeDensity(density, spec = {}) {
  const o = { ...CRITICAL_SPEC, ...spec }
  const n = o.board
  const engine = new LifeEngine(n, n, { rule: lifeRule(), boundary: o.boundary })
  engine.randomize(o.seed >>> 0, density)

  const cells = n * n
  const start = engine.stats.alive
  const detector = new TerminationDetector({ genLimit: o.genCap })
  let peak = start, peakGen = 0, maxFill = start / cells, end = null
  const tail = []
  const TAIL = 200                      // 与勘探器同一个窗口，"波动"才可比

  for (let g = 1; g <= o.genCap; g++) {
    const s = engine.step()
    if (s.alive > peak) { peak = s.alive; peakGen = s.gen }
    const fill = s.alive / cells
    if (fill > maxFill) maxFill = fill
    tail.push(s.alive)
    if (tail.length > TAIL) tail.shift()
    const hit = detector.observe(s.gen, engine.hash(), s.alive)
    if (hit) { end = hit; break }
  }

  const capped = !end || end.type === 'capped'
  const final = engine.stats.alive
  const observed = {
    end: capped ? null : end,           // 跑满上限不算"终止"（与勘探器口径一致）
    gens: engine.generation,
    cells, peak, initialAlive: start, finalAlive: final, maxFill,
    variation: relativeVariation(tail),
    initialFill: start / cells, finalFill: final / cells,
    growth: start ? peak / start : 0
  }
  return {
    density: round3(density),
    seed: o.seed >>> 0, board: n, boundary: o.boundary, genCap: o.genCap,
    start, gens: engine.generation, capped,
    end: capped ? null : { type: end.type, gen: end.gen, period: end.period },
    peak, peakGen, final,
    variation: observed.variation,
    outcome: classifyRun(observed, CRITICAL_CLASSIFY),
    finalCells: liveIndices(engine)
  }
}

/** 末态活细胞的下标表 —— 主线程照它画缩略图。缩略图的亮格数必须等于 final。 */
export function liveIndices(engine) {
  const out = []
  const cur = engine.cur
  for (let i = 0; i < cur.length; i++) if (cur[i] === 1) out.push(i)
  return Uint32Array.from(out)
}

/**
 * 这一档算不算"涌现"。两条都要满足：结局是有结构的那几类，且它**撑了足够久**。
 * 跑满上限的一律算数（它比任何门槛都久）。
 */
export function isEmergent(sample) {
  if (!sample) return false
  if (!EMERGENT_OUTCOMES.includes(sample.outcome)) return false
  return sample.capped || sample.gens >= EMERGENCE_MIN_GENS
}

/**
 * 长暂态：跑满代数上限仍未定型。
 * 0.82 那一档就是（32736 格起步，5000 代还没定下来，此时仍有 1081 格）——
 * 疑似临界慢化，作为待研究记在 D86 补记里，图上单独标出来。
 */
export function isLongTransient(sample) { return !!(sample && sample.capped) }

/**
 * 跨越点：相邻两档"有戏/没戏"翻面的那一段。
 * 这是这个专题真正要给的东西，所以它判的是涌现与否，而不是七类标签的任何一次变动。
 * @returns {Array<{lo:number, hi:number, from:boolean, to:boolean}>}
 */
export function findCrossings(samples) {
  const rows = [...samples].sort((a, b) => a.density - b.density)
  const out = []
  for (let i = 1; i < rows.length; i++) {
    const a = isEmergent(rows[i - 1]), b = isEmergent(rows[i])
    if (a !== b) out.push({ lo: rows[i - 1].density, hi: rows[i].density, from: a, to: b })
  }
  return out
}

/**
 * 下一轮要补跑哪几档：每个还太宽的跨越区间取中点。
 * 纯函数 —— Worker 照它决定跑什么，测试可以不跑仿真就验二分收敛。
 */
export function planRefinements(samples, width = REFINE_WIDTH) {
  const have = new Set(samples.map(s => s.density))
  const out = []
  for (const c of findCrossings(samples)) {
    if (c.hi - c.lo <= width + 1e-9) continue
    const mid = round3((c.lo + c.hi) / 2)
    if (mid > c.lo && mid < c.hi && !have.has(mid)) out.push(mid)
  }
  return out
}

/**
 * 涌现窗口：连续"有戏"的密度段。图上按段加阴影。
 * @returns {Array<{from:number, to:number, count:number}>}
 */
export function emergenceWindows(samples) {
  const rows = [...samples].sort((a, b) => a.density - b.density)
  const out = []
  let cur = null
  for (const s of rows) {
    if (isEmergent(s)) {
      if (!cur) cur = { from: s.density, to: s.density, count: 1 }
      else { cur.to = s.density; cur.count++ }
    } else if (cur) { out.push(cur); cur = null }
  }
  if (cur) out.push(cur)
  return out
}

/** 曲线的三种纵轴。key 直接是 sample 上的字段名，图注照它写口径。 */
export const CURVE_METRICS = Object.freeze(['final', 'gens', 'peak'])
