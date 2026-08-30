// 规则勘探器的核心逻辑（阶段 6）。纯逻辑、零 DOM，Worker 与测试跑的是同一份。
//
// 结局分类的七个类别与规格 4 阶段 6 的对应关系：
//   规格点名了五类 —— 速死 / 爆炸 / 静止 / 短周期循环 / 持续复杂。
//   另加两类：
//   · 长周期 —— 验收标准自己写的是"持续复杂**或长周期**"，不拆出来这条就没法判定；
//   · 灭绝   —— 规格把"速死"定义为"<50 代全灭"，那么"≥50 代才全灭"必须有个去处，
//              否则一局跑到 1500 代才死也会被贴上"速死"的标签，那是错的。

import { LifeEngine } from '../engine/board.js'
import { compileRule, parseBS, bsToClauses } from '../engine/rules.js'
import { TerminationDetector } from './detector.js'

/** 分类结果，按"有趣程度"从高到低排列 —— 结果表就按这个顺序排 */
export const OUTCOMES = ['complex', 'longCycle', 'shortCycle', 'still', 'explosion', 'extinct', 'quickDeath']

export const DEFAULTS = Object.freeze({
  // 棋盘与密度是标定过的：128×128 太小会让 Life 在两千代内就成环，
  // 起始密度必须**稀疏**，否则"人口增长"根本无从谈起（0.3 起步的盘一开始就占了三成）
  boardSize: 128,
  density: 0.10,
  runsPerRule: 3,
  genCap: 2000,
  quickDeathGens: 50,       // 速死的界限（规格明写）
  shortCycleMax: 30,        // 周期不超过这个数算短周期
  explosionGrowth: 2,       // 人口涨到起始的几倍
  explosionFill: 0.15,      // 且末尾仍占棋盘这么大比例
  explosionFlood: 0.45,     // 或者干脆淹了棋盘（起点再密也算爆炸）
  flatVariation: 0.01       // 人口起伏低于这个相对幅度就算"不波动"
})

/**
 * 给一局的观测结果分类。
 * @param {{end:object|null, gens:number, cells:number, peak:number, finalAlive:number,
 *          maxFill:number, variation:number}} r
 */
export function classifyRun(r, opts = {}) {
  const o = { ...DEFAULTS, ...opts }
  const end = r.end

  // 爆炸先判，且判的是**相对起点的增长**而不是绝对占比 ——
  // 第一版拿绝对占比当判据，结果起始密度 0.3 本身就越过了阈值，所有规则都成了"爆炸"。
  // 另留一条"淹了棋盘"的兜底：起点再密，占到四成半以上也是爆炸。
  const grew = r.growth >= o.explosionGrowth && r.finalFill >= o.explosionFill
  if (grew || r.maxFill >= o.explosionFlood) return 'explosion'

  if (end) {
    if (end.type === 'extinction') {
      return end.gen < o.quickDeathGens ? 'quickDeath' : 'extinct'
    }
    if (end.type === 'still') return 'still'
    if (end.type === 'cycle') {
      return end.period <= o.shortCycleMax ? 'shortCycle' : 'longCycle'
    }
  }
  // 跑满上限仍未终止：人口还在波动才算"持续复杂"，纹丝不动的另当别论
  return r.variation >= o.flatVariation ? 'complex' : 'longCycle'
}

/**
 * 跑一局并观测。
 * @param {{clauses:Array, agingLayers?:number}} ruleDef
 * @param {{seed:number, boardSize?:number, density?:number, genCap?:number, boundary?:string}} spec
 */
export function probeRule(ruleDef, spec = {}) {
  const o = { ...DEFAULTS, ...spec }
  const n = o.boardSize
  const rule = compileRule({ agingLayers: ruleDef.agingLayers | 0, clauses: ruleDef.clauses })
  const engine = new LifeEngine(n, n, { rule, boundary: o.boundary || 'torus' })
  engine.randomize(spec.seed >>> 0, o.density)

  const detector = new TerminationDetector({
    enabled: { extinction: true, still: true, cycle: true, capped: true },
    genLimit: o.genCap
  })
  detector.observe(0, engine.hash(), engine.countAlive())

  const cells = n * n
  const initialAlive = engine.countAlive()
  let peak = initialAlive
  let maxFill = peak / cells
  let end = null
  const tail = []                 // 最后一段人口，用来量"波动"
  const TAIL = 200

  for (let g = 1; g <= o.genCap; g++) {
    const s = engine.step()
    if (s.alive > peak) peak = s.alive
    const fill = s.alive / cells
    if (fill > maxFill) maxFill = fill
    tail.push(s.alive)
    if (tail.length > TAIL) tail.shift()
    const hit = detector.observe(s.gen, engine.hash(), s.alive)
    if (hit) { end = hit; break }
  }

  const variation = relativeVariation(tail)
  const finalAlive = engine.stats.alive
  const observed = {
    end: end && end.type === 'capped' ? null : end,   // 跑满上限不算"终止"
    gens: engine.generation,
    cells, peak, initialAlive, finalAlive, maxFill, variation,
    initialFill: initialAlive / cells,
    finalFill: finalAlive / cells,
    growth: initialAlive ? peak / initialAlive : 0
  }
  return {
    ...observed,
    seed: spec.seed >>> 0,
    fingerprint: rule.fingerprint,
    notation: rule.notation,
    outcome: classifyRun(observed, spec)
  }
}

/** 人口的相对起伏：标准差 / 均值。均值为 0 时记 0 */
export function relativeVariation(series) {
  if (!series.length) return 0
  let sum = 0
  for (const v of series) sum += v
  const mean = sum / series.length
  if (mean <= 0) return 0
  let sq = 0
  for (const v of series) sq += (v - mean) * (v - mean)
  return Math.sqrt(sq / series.length) / mean
}

/**
 * 一条规则跑若干局（默认 3 局不同种子），汇总。
 * @returns {{notation, fingerprint, runs:Array, outcome:string, avgEndGen:number}}
 */
export function exploreRule(ruleDef, spec = {}) {
  const o = { ...DEFAULTS, ...spec }
  const runs = []
  for (let i = 0; i < o.runsPerRule; i++) {
    runs.push(probeRule(ruleDef, { ...o, seed: (o.baseSeed ?? 1000) + i * 7919 }))
  }
  return {
    notation: runs[0].notation,
    fingerprint: runs[0].fingerprint,
    clauses: ruleDef.clauses,
    agingLayers: ruleDef.agingLayers | 0,
    runs,
    outcome: majorityOutcome(runs),
    avgEndGen: Math.round(runs.reduce((s, r) => s + r.gens, 0) / runs.length)
  }
}

/** 多局的总体判定：取出现最多的那一类；平手时取更"有趣"的（OUTCOMES 靠前的） */
export function majorityOutcome(runs) {
  const count = new Map()
  for (const r of runs) count.set(r.outcome, (count.get(r.outcome) || 0) + 1)
  let best = null, bestN = -1
  for (const o of OUTCOMES) {
    const n = count.get(o) || 0
    if (n > bestN) { best = o; bestN = n }
  }
  return best
}

/** 结果表排序：持续复杂优先 */
export function sortResults(rows) {
  const rank = o => OUTCOMES.indexOf(o)
  return rows.slice().sort((a, b) => rank(a.outcome) - rank(b.outcome) || b.avgEndGen - a.avgEndGen)
}

/* ---------------- 采样空间 ---------------- */

/** B/S 全空间共 2^9 × 2^9 = 262144 条；按种子随机抽 n 条 */
export function sampleBSRules(n, seed = 1) {
  const out = []
  let a = seed >>> 0
  const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296 }
  const seen = new Set()
  while (out.length < n) {
    const born = [], survive = []
    for (let k = 0; k <= 8; k++) {
      if (rnd() < 0.28) born.push(k)
      if (rnd() < 0.35) survive.push(k)
    }
    if (!born.length) continue                 // 没有出生条件的规则必然全灭，没意思
    const key = `B${born.join('')}/S${survive.join('')}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ notation: key, clauses: bsToClauses(born, survive), agingLayers: 0 })
  }
  return out
}

/** 从 B/S 记法字符串造规则定义 */
export function ruleFromNotation(notation) {
  return { notation, clauses: parseBS(notation), agingLayers: 0 }
}
