// 存档格式（规格 3.1）：极简，靠重放恢复。
// 读档 = 按种子（或初始图案）重建初始盘 → 重放到 generation 代。
//
// 对规格 3.1 的一处扩展：多了一个可选的 initGeneration（默认 0）。
// 原因：手绘改盘会让"从种子重放"这条路断掉 —— 轨迹已经不是那个种子生成的了。
// 这时把当时的棋盘存成 RLE 作为新基线，重放代数就是 generation - initGeneration。
// 纯种子局里 initGeneration 恒为 0，文件与规格 3.1 逐字段一致。

import { LifeEngine } from './board.js'
import { compileRule } from './rules.js'
import { parseRLE, boardToRLE } from './rle.js'

export const SAVE_VERSION = 1

/**
 * @param {{engine:object, density:number, origin:{type:string, seed?:number,
 *          density?:number, rle?:string, gen?:number}}} state
 */
export function buildSave(state) {
  const e = state.engine
  const o = state.origin
  const save = {
    version: SAVE_VERSION,
    seed: o.type === 'random' ? (o.seed >>> 0) : (e.seed >>> 0),
    initType: o.type,
    initDensity: o.type === 'random' ? o.density : state.density,
    rule: {
      type: 'clauses',
      clauses: e.rule.clauses,
      agingLayers: e.rule.agingLayers,
      fingerprint: e.rule.fingerprint,
      notation: e.rule.notation
    },
    boundary: e.boundary,
    boardSize: [e.w, e.h],
    generation: e.generation
  }
  if (o.type === 'pattern') {
    save.initPattern = o.rle
    save.initGeneration = o.gen | 0
  }
  return save
}

export function saveToText(save) { return JSON.stringify(save, null, 2) }

/** 解析并校验存档；有问题就抛出人话能读懂的错误（文案由界面层包装） */
export function parseSave(text) {
  let obj
  try {
    obj = typeof text === 'string' ? JSON.parse(text) : text
  } catch (e) {
    throw new Error(`not-json:${e.message}`)
  }
  if (!obj || typeof obj !== 'object') throw new Error('not-object')
  if (obj.version !== SAVE_VERSION) throw new Error(`version:${obj.version}`)
  if (!Array.isArray(obj.boardSize) || obj.boardSize.length !== 2
    || !Number.isInteger(obj.boardSize[0]) || !Number.isInteger(obj.boardSize[1])
    || obj.boardSize[0] < 1 || obj.boardSize[1] < 1) throw new Error('boardSize')
  if (obj.boundary !== 'torus' && obj.boundary !== 'dead') throw new Error('boundary')
  if (!obj.rule || !Array.isArray(obj.rule.clauses)) throw new Error('rule')
  if (!Number.isFinite(obj.generation) || obj.generation < 0) throw new Error('generation')
  if (obj.initType !== 'random' && obj.initType !== 'pattern') throw new Error('initType')
  if (obj.initType === 'pattern' && typeof obj.initPattern !== 'string') throw new Error('initPattern')
  if (obj.initType === 'random' && !Number.isFinite(obj.initDensity)) throw new Error('initDensity')
  return obj
}

/**
 * 按存档重建**第 0 代**（或 initGeneration 代）的棋盘，还不做重放。
 * 重放交给界面层分片跑，好显示进度条。
 * @returns {{engine:LifeEngine, rule:object, replayFrom:number, replayTo:number}}
 */
export function restoreInitial(save) {
  const rule = compileRule({
    name: save.rule.notation || '存档规则',
    agingLayers: save.rule.agingLayers | 0,
    clauses: save.rule.clauses
  })
  if (save.rule.fingerprint && rule.fingerprint !== save.rule.fingerprint) {
    // 规则重编译后指纹对不上 ⇒ 存档里的条款与它自称的规则不是一回事，不能装作没看见
    throw new Error(`fingerprint:${save.rule.fingerprint}:${rule.fingerprint}`)
  }

  const [w, h] = save.boardSize
  const engine = new LifeEngine(w, h, { rule, boundary: save.boundary })

  let from = 0
  if (save.initType === 'random') {
    engine.randomize(save.seed >>> 0, save.initDensity)
  } else {
    const pat = parseRLE(save.initPattern)
    engine.clear()
    for (const [x, y] of pat.cells) engine.set(x, y, 1)
    engine.seed = save.seed >>> 0
    engine.initType = 'pattern'
    engine.stats.alive = engine.countAlive()
    from = save.initGeneration | 0
  }
  return { engine, rule, replayFrom: from, replayTo: save.generation }
}

/** 把整块棋盘导成 RLE，用作手绘局的存档基线 */
export function boardBaseline(engine) {
  return boardToRLE(engine, 0, 0, engine.w, engine.h, {
    rule: engine.rule.notation || 'B3/S23',
    name: 'baseline'
  })
}
