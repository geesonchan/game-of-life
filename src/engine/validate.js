// 规则校验器。纯逻辑，可在 Node 里跑测试。
// 只返回「消息 key + 参数」，不返回任何人类语言的句子 —— 文字属于界面层（见 D22）。
// 分两段：
//   validateClauses() —— 结构校验，在编译之前跑，保证 compileRule 不会抛异常
//   validateRule()    —— 语义校验，在编译之后跑，报告永不可达条款、冗余条款、B/S 表达力
// 判定规则见 docs/decisions.md D18 / D19 / D20。

import { compileRule, stateName, DEAD, ALIVE } from './rules.js'

const STATE_RE = /^(alive|dead|aging_(\d+))$/

/**
 * 结构校验：只看条款写得合不合法，不看语义。
 * @returns {{ok: boolean, errors: Array<{clause: number|null, key: string, params: object}>}}
 */
export function validateClauses(clauses, agingLayers) {
  const errors = []
  const layers = agingLayers | 0
  if (layers < 0 || layers > 8) {
    errors.push({ clause: null, key: 'e.agingRange', params: { value: agingLayers } })
  }
  if (!Array.isArray(clauses)) {
    errors.push({ clause: null, key: 'e.notArray', params: {} })
    return { ok: false, errors }
  }

  clauses.forEach((c, i) => {
    for (const field of ['when', 'then']) {
      const v = c[field]
      const m = STATE_RE.exec(String(v))
      if (!m) {
        errors.push({ clause: i, key: 'e.badState', params: { field, value: JSON.stringify(v) } })
      } else if (m[2] !== undefined) {
        const k = Number(m[2])
        if (k < 1 || k > layers) {
          errors.push({ clause: i, key: 'e.agingOutOfRange', params: { field, k, layers } })
        }
      }
    }
    const cond = c.neighbors
    if (cond && cond.op !== 'any') {
      switch (cond.op) {
        case 'in':
        case 'not_in':
          if (!Array.isArray(cond.values) || cond.values.length === 0) {
            errors.push({ clause: i, key: 'e.emptySet', params: { op: cond.op } })
          } else if (cond.values.some(v => !Number.isInteger(v) || v < 0 || v > 8)) {
            errors.push({ clause: i, key: 'e.badNeighbor', params: {} })
          }
          break
        case 'eq': case 'lt': case 'lte': case 'gt': case 'gte':
          if (!Number.isInteger(cond.value) || cond.value < 0 || cond.value > 8) {
            errors.push({ clause: i, key: 'e.badNeighborOp', params: { op: cond.op } })
          }
          break
        case 'range':
          if (!Number.isInteger(cond.min) || !Number.isInteger(cond.max)) {
            errors.push({ clause: i, key: 'e.badRange', params: {} })
          } else if (cond.min > cond.max) {
            errors.push({ clause: i, key: 'e.rangeInverted', params: { min: cond.min, max: cond.max } })
          }
          break
        default:
          errors.push({ clause: i, key: 'e.unknownOp', params: { op: cond.op } })
      }
    }
  })

  return { ok: errors.length === 0, errors }
}

/**
 * 语义校验：在已编译的规则上做可达性分析。
 * @param {object} rule compileRule() 的产物
 * @returns {{
 *   clauses: Array<{index:number, status:string, hits:number, key:string|null, params:object}>,
 *   reachable: string[],
 *   bs: {expressible:boolean, notation:string|null, born:number[], survive:number[], reasonKey:string|null, reasonParams:object, culprit:number|null},
 *   table: Array<{state:string, cells:Array<{n:number, next:string, fallback:boolean}>}>,
 *   warnings: Array<{key:string, params:object}>
 * }}
 */
export function validateRule(rule) {
  const { lookup, numStates, clauses, clauseHits, reachable } = rule

  // ---- 逐条款诊断（顺序要紧：状态不可达优先于被遮蔽，见 D19）----
  const clauseReports = clauses.map((c, i) => {
    const whenState = stateIndexOf(c.when)
    const hits = clauseHits[i]
    if (whenState >= numStates || whenState < 0) {
      return { index: i, status: 'invalid', hits, key: 'v.invalid-state', params: { state: c.when } }
    }
    if (!reachable[whenState]) {
      return { index: i, status: 'unreachable-state', hits, key: 'v.unreachable-state', params: { state: c.when } }
    }
    if (hits === 0) {
      return { index: i, status: 'shadowed', hits, key: 'v.shadowed', params: {} }
    }
    if (isRemovable(rule, i)) {
      return { index: i, status: 'redundant', hits, key: 'v.redundant', params: {} }
    }
    return { index: i, status: 'ok', hits, key: null, params: {} }
  })

  // ---- B/S 表达力（D18）----
  const bs = { expressible: rule.bsExpressible, notation: rule.notation, born: [], survive: [], reasonKey: null, reasonParams: {}, culprit: null }
  if (bs.expressible) {
    for (let n = 0; n <= 8; n++) {
      if (lookup[DEAD * 9 + n] === ALIVE) bs.born.push(n)
      if (lookup[ALIVE * 9 + n] === ALIVE) bs.survive.push(n)
    }
  } else {
    // 找出第一条把状态引出 {死, 活} 的可达条款，给用户一个能下手的原因
    const culprit = clauses.findIndex((c, i) => {
      const w = stateIndexOf(c.when)
      return w >= 0 && w < numStates && reachable[w] && stateIndexOf(c.then) > ALIVE && clauseHits[i] > 0
    })
    bs.culprit = culprit >= 0 ? culprit : null
    if (culprit >= 0) {
      bs.reasonKey = 'v.bs.culprit'
      bs.reasonParams = { n: culprit + 1, state: clauses[culprit].then }
    } else {
      bs.reasonKey = 'v.bs.generic'
    }
  }

  // ---- 编译表预览：只列可达状态（D20）----
  const table = []
  for (let s = 0; s < numStates; s++) {
    if (!reachable[s]) continue
    const cells = []
    for (let n = 0; n <= 8; n++) {
      cells.push({ n, next: stateName(lookup[s * 9 + n]), fallback: !matchedByAnyClause(clauses, s, n, numStates) })
    }
    table.push({ state: stateName(s), cells })
  }

  // ---- 规则级提醒 ----
  const warnings = []
  // 任何邻居数都无法产生或维持存活 ⇒ 棋盘必然一代内全灭
  if (bsAllDead(lookup)) warnings.push({ key: 'v.warn.allDead', params: {} })
  const unreachableAging = []
  for (let s = 2; s < numStates; s++) if (!reachable[s]) unreachableAging.push(stateName(s))
  if (unreachableAging.length) {
    warnings.push({ key: 'v.warn.unreachableAging', params: { n: unreachableAging.length, states: unreachableAging } })
  }

  return {
    clauses: clauseReports,
    reachable: rangeStates(numStates).filter(s => reachable[s]).map(stateName),
    bs, table, warnings
  }
}

/* ---------------- 内部工具 ---------------- */

function rangeStates(n) { return Array.from({ length: n }, (_, i) => i) }

function stateIndexOf(name) {
  if (name === 'dead') return DEAD
  if (name === 'alive') return ALIVE
  const m = /^aging_(\d+)$/.exec(String(name))
  return m ? 1 + Number(m[1]) : -1
}

/**
 * 条款 i 是否可以删掉而不改变查找表。
 * 注意不能简单地判断"then === when"就算冗余 —— 隐含兜底只在**后面所有条款都不匹配**时才生效。
 * 例如 Life 的 `{存活, 邻居∈{2,3} → 存活}`，看起来是"维持原状"，
 * 但删掉它之后下一条 `{存活, 任意 → 死亡}` 就会接管，结果完全不同。
 * 所以直接重编译一次做逐格比对：这才是"删掉它指纹不变"的字面意思。
 * 代价是 numStates×9 ≤ 90 格的比对，条款数量级下完全不值一提。
 */
function isRemovable(rule, i) {
  let alt
  try {
    alt = compileRule({ agingLayers: rule.agingLayers, clauses: rule.clauses.filter((_, j) => j !== i) })
  } catch (e) {
    return false
  }
  const a = rule.lookup, b = alt.lookup
  if (a.length !== b.length) return false
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false
  return true
}

/** (状态, 邻居数) 这一格是否被某条条款显式命中；否则就是靠隐含兜底 */
function matchedByAnyClause(clauses, state, n, numStates) {
  const target = stateName(state)
  for (const c of clauses) {
    if (c.when !== target) continue
    if (matchCond(c.neighbors, n)) return true
  }
  return false
}

function matchCond(cond, n) {
  if (!cond || cond.op === 'any') return true
  switch (cond.op) {
    case 'in': return cond.values.indexOf(n) !== -1
    case 'not_in': return cond.values.indexOf(n) === -1
    case 'eq': return n === cond.value
    case 'lt': return n < cond.value
    case 'lte': return n <= cond.value
    case 'gt': return n > cond.value
    case 'gte': return n >= cond.value
    case 'range': return n >= cond.min && n <= cond.max
    default: return false
  }
}

/** 任何邻居数都无法产生或维持存活 */
function bsAllDead(lookup) {
  for (let n = 0; n <= 8; n++) {
    if (lookup[DEAD * 9 + n] === ALIVE) return false
    if (lookup[ALIVE * 9 + n] === ALIVE) return false
  }
  return true
}
