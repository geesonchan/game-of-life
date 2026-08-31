// 临界实验室 · 锁定时刻（D86 ③）。
//
// 问一个问题，只回一个数字：**最后一个还能翻盘的代数**。
// 到了那一代之后，随便翻哪一格（在抽样范围内）都改不了这一局的结局分类了 ——
// 这一局的命运在那时就锁定了。
//
// 穷举是跑不动的：64×64 跑 300 代要 4096 × 300 ≈ 120 万次整局重跑，约三小时（D86 §4）。
// 所以按方案里写好的形状做抽样剪枝：
//   · 只试**活格与它们的 8 邻域**（真空里翻一格必然自灭，试它是白花钱 —— 双宇宙那一节实测过）；
//   · 每代只抽 `sampleCells` 个候选，抽样用种子化 PRNG，**同一 spec 必得同一答案**；
//   · 代数上二分，而不是逐代扫。
//
// **原方案里的"代数上二分"被实测否掉了。** 二分要求"越晚越难翻盘"这个单调性，
// 而实测它不成立：同一局里第 971 代翻不动，第 975、980、1000、1029 代又翻得动。
// 二分在这种性质上给出的答案是运气，不是事实。改成**从最后一代往回扫，
// 遇到的第一个"还翻得动"就是答案** —— 不需要任何单调假设，在抽样范围内是精确的。
//
// **口径取死边界，不是环形盘。** 这也是实测逼出来的：环形盘上一格扰动能生出一架滑翔机，
// 绕着盘面一圈圈撞下去，于是**永远翻得动** —— 两个结局不同的基准局，
// 在它们各自的最后一代都仍然翻得动，"锁定"根本不存在。
// 死边界上滑翔机飞出去就没了，命运才谈得上锁定。理由写进图注，别让人以为口径是随手挑的。
import { LifeEngine } from '../engine/board.js'
import { lifeRule } from '../engine/rules.js'
import { TerminationDetector } from './detector.js'
import { mulberry32 } from '../engine/prng.js'
import { classifyRun, relativeVariation } from './explorer.js'
import { CRITICAL_CLASSIFY } from './critical.js'

/**
 * 口径。小盘短局是有意的：这是"一次性勘探任务"，要在几十秒内出一个数字，
 * 而不是把主界面卡住（D86 §4）。
 */
export const LOCKIN_SPEC = Object.freeze({
  board: 48,            // 小盘：基准局几百代就定型，整件事才跑得进几十秒
  boundary: 'dead',     // 死边界，理由见文件头：环形盘上命运永不锁定（实测）
  density: 0.30,
  seed: 4271,
  genCap: 1200,         // 基准局的代数上限（死边界下实测 586 代定型，留足余量）
  // **试翻之后的上限是量出来的**：抽样跑过 48 组"翻一格再跑"，
  // 放到 3 万代的上限下，最长的一组第 2672 代定型 —— 没有一组跑掉。
  // 4000 = 2672 再留五成。第一版取 2000，于是大量试翻被记成「跑满未定型」，
  // 分类跟着变成 complex，"还翻得动"就成了假的 —— 又是 D86 §9 那个跟头（时间窗口）。
  trialCap: 4000,
  // 每代抽多少个候选格。实测这条数字**没起作用**：末尾那几代的候选集（活格∪8 邻域）
  // 本身不足 400 格，200 / 400 / 5000 三种上限跑出来的答案与试格数完全一样 ——
  // 也就是说尾部其实是穷举的。留着它是给早期那些几百上千格的代数兜底。
  sampleCells: 400,
  scanBack: 150         // 从最后一代往回最多扫多少代（扫不到就如实说"这一段里都翻不动"）
})

/** 跑一局到终止，返回观测与结局分类。`from` 给了就从那盘继续跑。 */
export function runToEnd(cells, spec) {
  const n = spec.board
  const e = new LifeEngine(n, n, { rule: lifeRule(), boundary: spec.boundary })
  e.cur.set(cells)
  e.stats.alive = e.countAlive()
  const total = n * n
  const start = e.stats.alive
  const det = new TerminationDetector({ genLimit: spec.trialCap })
  let peak = start, maxFill = start / total, end = null
  const tail = []
  for (let g = 1; g <= spec.trialCap; g++) {
    const s = e.step()
    if (s.alive > peak) peak = s.alive
    const fill = s.alive / total
    if (fill > maxFill) maxFill = fill
    tail.push(s.alive)
    if (tail.length > 200) tail.shift()
    const hit = det.observe(s.gen, e.hash(), s.alive)
    if (hit) { end = hit; break }
  }
  const capped = !end || end.type === 'capped'
  const observed = {
    end: capped ? null : end, gens: e.generation, cells: total, peak,
    initialAlive: start, finalAlive: e.stats.alive, maxFill,
    variation: relativeVariation(tail),
    initialFill: start / total, finalFill: e.stats.alive / total,
    growth: start ? peak / start : 0
  }
  return { outcome: classifyRun(observed, CRITICAL_CLASSIFY), gens: e.generation, final: e.stats.alive, capped }
}

/** 基准局逐代的盘面（快照表）。到终止或上限为止。 */
export function baselineStates(spec) {
  const n = spec.board
  const e = new LifeEngine(n, n, { rule: lifeRule(), boundary: spec.boundary })
  e.randomize(spec.seed >>> 0, spec.density)
  const states = [e.cur.slice()]
  const det = new TerminationDetector({ genLimit: spec.genCap })
  for (let g = 1; g <= spec.genCap; g++) {
    e.step()
    states.push(e.cur.slice())
    if (det.observe(e.generation, e.hash(), e.stats.alive)) break
  }
  return states
}

/**
 * 某一代的候选格：活格与它们的 8 邻域，用种子化 PRNG 抽到 `limit` 个。
 * 抽样必须可复现 —— 同一 spec 同一代，抽出来的必须是同一批格子，
 * 否则"最后一个还能翻盘的代数"每跑一次都不一样，那就不是一个数字，是一团噪音。
 */
export function candidateCells(cells, n, limit, seed) {
  const set = new Set()
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== 1) continue
    const x = i % n, y = (i / n) | 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      set.add(((y + dy + n) % n) * n + ((x + dx + n) % n))
    }
  }
  const all = [...set]
  if (all.length <= limit) return all.sort((a, b) => a - b)
  // 种子化的 Fisher–Yates，取前 limit 个
  const rnd = mulberry32(seed >>> 0)
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const t = all[i]; all[i] = all[j]; all[j] = t
  }
  return all.slice(0, limit).sort((a, b) => a - b)
}

/**
 * 第 gen 代还翻得动吗：在抽样范围内，有没有哪一格翻过去会改掉结局分类。
 * @returns {{flippable:boolean, tried:number, at:number|null, to:string|null}}
 */
export function canFlipAt(states, gen, baselineOutcome, spec) {
  const n = spec.board
  const cells = states[gen]
  if (!cells) return { flippable: false, tried: 0, at: null, to: null }
  // 抽样种子把代数掺进去：每一代抽的是不同的一批，但同一代永远是同一批
  const list = candidateCells(cells, n, spec.sampleCells, (spec.seed >>> 0) + gen * 7919)
  let tried = 0
  for (const idx of list) {
    const trial = cells.slice()
    trial[idx] = trial[idx] === 1 ? 0 : 1
    tried++
    const r = runToEnd(trial, spec)
    if (r.outcome !== baselineOutcome) return { flippable: true, tried, at: idx, to: r.outcome }
  }
  return { flippable: false, tried, at: null, to: null }
}

/**
 * 找"最后一个还能翻盘的代数"：**从最后一代往回扫，第一个还翻得动的就是它。**
 *
 * 不用二分 —— 二分要单调性，而实测这条性质不单调（见文件头）。
 * 倒扫在抽样范围内是精确的：它直接就是"最后一个"的定义。
 *
 * @param {object} spec
 * @param {(done:number, total:number)=>void} [onProgress] 每往回扫一代报一次
 * @returns {{gen:number, settleGen:number, baseline:string, states:number, probes:number,
 *            scanned:number, flip:{at:number|null, to:string|null}, spec:object}}
 */
export function findLockIn(spec = {}, onProgress) {
  const o = { ...LOCKIN_SPEC, ...spec }
  const states = baselineStates(o)
  const base = runToEnd(states[0], o)
  const last = states.length - 1
  const stop = Math.max(0, last - o.scanBack)

  let probes = 0, scanned = 0
  for (let gen = last; gen >= stop; gen--) {
    const r = canFlipAt(states, gen, base.outcome, o)
    probes += r.tried
    scanned++
    onProgress && onProgress(scanned, o.scanBack + 1)
    if (r.flippable) {
      return {
        gen, settleGen: base.gens, baseline: base.outcome, states: states.length,
        probes, scanned, flip: { at: r.at, to: r.to }, spec: o
      }
    }
  }
  // 往回扫了 scanBack 代都没找到 —— 如实回 -1，别编一个数字出来
  return {
    gen: -1, settleGen: base.gens, baseline: base.outcome, states: states.length,
    probes, scanned, flip: { at: null, to: null }, spec: o
  }
}
