// 时间之塔的数据模型（阶段 5.5）。
// 一代 = 一层，层沿时间轴堆起来。**纯逻辑，零 DOM 零渲染依赖** ——
// 三条几何验收（滑翔机斜线 / blinker 麻花柱 / 静物直柱）本质上是对
// (x, y, 代数) 这组数据的断言，不需要任何渲染器就能测。

import { LifeEngine } from '../engine/board.js'
import { compileRule, lifeRule } from '../engine/rules.js'

export const TOWER_DEFAULT_HEIGHT = 200
export const TOWER_MAX_HEIGHT = 500

/**
 * 一层只存活细胞的**格索引**（y * width + x），不存死细胞 ——
 * 死细胞既不进内存也不进 InstancedMesh。
 */
export class Tower {
  constructor(opts = {}) {
    this.width = opts.width | 0
    this.height = opts.height | 0
    this.maxLayers = clampHeight(opts.maxLayers ?? TOWER_DEFAULT_HEIGHT)
    this.layers = []          // [{gen:number, cells:Uint32Array}]，按代数升序
    this.dropped = 0          // 因为滑动窗口被丢掉的层数，界面上如实显示
  }

  setMaxLayers(n) {
    this.maxLayers = clampHeight(n)
    this.trim()
    return this.maxLayers
  }

  /** 从引擎当前状态取一层 */
  pushFromEngine(engine) {
    const cur = engine.cur
    let n = 0
    for (let i = 0; i < cur.length; i++) if (cur[i] === 1) n++
    const cells = new Uint32Array(n)
    let k = 0
    for (let i = 0; i < cur.length; i++) if (cur[i] === 1) cells[k++] = i
    return this.pushLayer(engine.generation, cells)
  }

  pushLayer(gen, cells) {
    const layer = { gen, cells }
    this.layers.push(layer)
    this.trim()
    return layer
  }

  /** 滑动窗口：超出塔高就丢最老的层 */
  trim() {
    const over = this.layers.length - this.maxLayers
    if (over > 0) {
      this.layers.splice(0, over)
      this.dropped += over
    }
  }

  get length() { return this.layers.length }

  /** InstancedMesh 需要知道总共要画多少个方块 */
  get instanceCount() {
    let n = 0
    for (const l of this.layers) n += l.cells.length
    return n
  }

  /** 按代数取一层（切片滑块与 2D 小窗用） */
  layerAt(gen) {
    for (const l of this.layers) if (l.gen === gen) return l
    return null
  }

  /** 当前窗口覆盖的代数区间 */
  get genRange() {
    if (!this.layers.length) return null
    return [this.layers[0].gen, this.layers[this.layers.length - 1].gen]
  }

  clear() { this.layers = []; this.dropped = 0 }

  /* ---------------- 几何：三条验收断言都建立在这几个函数上 ---------------- */

  /** 一层的质心（格坐标，浮点） */
  centroidOf(layer) {
    if (!layer.cells.length) return null
    let sx = 0, sy = 0
    for (const i of layer.cells) { sx += i % this.width; sy += (i / this.width) | 0 }
    return { x: sx / layer.cells.length, y: sy / layer.cells.length }
  }

  /** 一层的包围盒 */
  bboxOf(layer) {
    if (!layer.cells.length) return null
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const i of layer.cells) {
      const x = i % this.width, y = (i / this.width) | 0
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  }

  /** 整座塔在平面上的投影足迹（并集）——直柱的足迹等于单层足迹，麻花柱的会更大 */
  footprintUnion() {
    const set = new Set()
    for (const l of this.layers) for (const i of l.cells) set.add(i)
    return set
  }

  /** 两层是否逐格相同 */
  sameLayer(a, b) {
    if (a.cells.length !== b.cells.length) return false
    for (let i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) return false
    return true
  }
}

function clampHeight(n) {
  // 别写成 Number(n) || DEFAULT —— 0 是假值，会被悄悄换成默认值 200 而不是夹到 1
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return TOWER_DEFAULT_HEIGHT
  return Math.max(1, Math.min(TOWER_MAX_HEIGHT, v))
}

/**
 * 构建一座塔。Worker 里跑的就是这个函数，主线程测试里也跑同一个 ——
 * Worker 只是个搬运壳子，逻辑不放在里面（放进去就没法测了）。
 *
 * @param {object} spec
 *   {boardSize:[w,h], boundary, rule:{clauses,agingLayers}|null,
 *    seed, density, initCells?:number[], gens, maxLayers}
 * @param {(done:number,total:number)=>void} [onProgress] 每 chunk 回调一次
 * @param {number} [chunk] 多少代回调一次进度
 */
export function buildTower(spec, onProgress, chunk = 25) {
  const [w, h] = spec.boardSize
  const rule = spec.rule ? compileRule({ agingLayers: spec.rule.agingLayers | 0, clauses: spec.rule.clauses }) : lifeRule()
  const engine = new LifeEngine(w, h, { rule, boundary: spec.boundary || 'torus' })

  if (Array.isArray(spec.initCells)) {
    engine.clear()
    for (const i of spec.initCells) engine.cur[i] = 1
    engine.stats.alive = engine.countAlive()
  } else {
    engine.randomize(spec.seed >>> 0, spec.density ?? 0.35)
  }

  const tower = new Tower({ width: w, height: h, maxLayers: spec.maxLayers ?? TOWER_DEFAULT_HEIGHT })
  const gens = Math.max(0, spec.gens | 0)
  tower.pushFromEngine(engine)                 // 第 0 代也是一层
  for (let g = 1; g <= gens; g++) {
    engine.step()
    tower.pushFromEngine(engine)
    if (onProgress && (g % chunk === 0 || g === gens)) onProgress(g, gens)
  }
  return { tower, engine }
}

/** 把塔打包成可以 transfer 给主线程的结构（Worker 用） */
export function packTower(tower) {
  return {
    width: tower.width, height: tower.height,
    maxLayers: tower.maxLayers, dropped: tower.dropped,
    gens: tower.layers.map(l => l.gen),
    cells: tower.layers.map(l => l.cells)
  }
}

/** 主线程侧还原 */
export function unpackTower(packed) {
  const t = new Tower({ width: packed.width, height: packed.height, maxLayers: packed.maxLayers })
  t.dropped = packed.dropped
  t.layers = packed.gens.map((gen, i) => ({ gen, cells: packed.cells[i] }))
  return t
}
