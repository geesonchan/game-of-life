// 规则校验器。纯逻辑，可在 Node 里跑测试。
// 分两段：
//   validateClauses() —— 结构校验，在编译之前跑，保证 compileRule 不会抛异常
//   validateRule()    —— 语义校验，在编译之后跑，报告永不可达条款、冗余条款、B/S 表达力
// 判定规则见 docs/decisions.md D18 / D19 / D20。

import { compileRule, stateName, DEAD, ALIVE } from './rules.js'

const STATE_RE = /^(alive|dead|aging_(\d+))$/

/**
 * 结构校验：只看条款写得合不合法，不看语义。
 * @returns {{ok: boolean, errors: Array<{clause: number|null, message: string}>}}
 */
export function validateClauses(clauses, agingLayers) {
  const errors = []
  const layers = agingLayers | 0
  if (layers < 0 || layers > 8) {
    errors.push({ clause: null, message: `衰老层数必须在 0–8 之间，当前为 ${agingLayers}` })
  }
  if (!Array.isArray(clauses)) {
    errors.push({ clause: null, message: '条款列表必须是数组' })
    return { ok: false, errors }
  }

  clauses.forEach((c, i) => {
    for (const field of ['when', 'then']) {
      const v = c[field]
      const m = STATE_RE.exec(String(v))
      if (!m) {
        errors.push({ clause: i, message: `${field} 的状态名非法：${JSON.stringify(v)}` })
      } else if (m[2] !== undefined) {
        const k = Number(m[2])
        if (k < 1 || k > layers) {
          errors.push({ clause: i, message: `${field} 引用了 aging_${k}，但当前衰老层数为 ${layers}` })
        }
      }
    }
    const cond = c.neighbors
    if (cond && cond.op !== 'any') {
      switch (cond.op) {
        case 'in':
        case 'not_in':
          if (!Array.isArray(cond.values) || cond.values.length === 0) {
            errors.push({ clause: i, message: `${cond.op} 条件的邻居数集合不能为空` })
          } else if (cond.values.some(v => !Number.isInteger(v) || v < 0 || v > 8)) {
            errors.push({ clause: i, message: '邻居数必须是 0–8 的整数' })
          }
          break
        case 'eq': case 'lt': case 'lte': case 'gt': case 'gte':
          if (!Number.isInteger(cond.value) || cond.value < 0 || cond.value > 8) {
            errors.push({ clause: i, message: `${cond.op} 条件的邻居数必须是 0–8 的整数` })
          }
          break
        case 'range':
          if (!Number.isInteger(cond.min) || !Number.isInteger(cond.max)) {
            errors.push({ clause: i, message: 'range 条件的上下界必须是整数' })
          } else if (cond.min > cond.max) {
            errors.push({ clause: i, message: `range 条件的下界 ${cond.min} 大于上界 ${cond.max}` })
          }
          break
        default:
          errors.push({ clause: i, message: `未知的邻居条件 op：${cond.op}` })
      }
    }
  })

  return { ok: errors.length === 0, errors }
}

/**
 * 语义校验：在已编译的规则上做可达性分析。
 * @param {object} rule compileRule() 的产物
 * @returns {{
 *   clauses: Array<{index:number, status:string, hits:number, message:string}>,
 *   reachable: string[],
 *   bs: {expressible:boolean, notation:string|null, born:number[], survive:number[], reason:string|null, culprit:number|null},
 *   table: Array<{state:string, cells:Array<{n:number, next:string, fallback:boolean}>}>,
 *   warnings: string[]
 * }}
 */
export function validateRule(rule) {
  const { lookup, numStates, clauses, clauseHits, reachable } = rule

  // ---- 逐条款诊断（顺序要紧：状态不可达优先于被遮蔽，见 D19）----
  const clauseReports = clauses.map((c, i) => {
    const whenState = stateIndexOf(c.when)
    const hits = clauseHits[i]
    if (whenState >= numStates || whenState < 0) {
      return { index: i, status: 'invalid', hits, message: `条款引用了不存在的状态 ${c.when}` }
    }
    if (!reachable[whenState]) {
      return {
        index: i, status: 'unreachable-state', hits,
        message: `永不可达：状态「${zh(c.when)}」在这套规则下永远不会出现，本条款不会被执行`
      }
    }
    if (hits === 0) {
      return {
        index: i, status: 'shadowed', hits,
        message: '永不可达：它能匹配的邻居数已被上面的条款全部抢走，本条款不会被执行'
      }
    }
    if (isRemovable(rule, i)) {
      return {
        index: i, status: 'redundant', hits,
        message: '冗余：删掉它编译出的查找表逐格不变，指纹也不变'
      }
    }
    return { index: i, status: 'ok', hits, message: '' }
  })

  // ---- B/S 表达力（D18）----
  const bs = { expressible: rule.bsExpressible, notation: rule.notation, born: [], survive: [], reason: null, culprit: null }
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
    bs.reason = culprit >= 0
      ? `第 ${culprit + 1} 条条款会产生「${zh(clauses[culprit].then)}」，超出 B/S 记法只有生/死两态的表达力`
      : '规则中存在可达的衰老态，超出 B/S 记法只有生/死两态的表达力'
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
  if (!reachable[ALIVE] || bsAllDead(lookup)) {
    // 存活态无法从死态产生，且活细胞也无法存活 ⇒ 任何棋盘必然一代内全灭
    if (bsAllDead(lookup)) warnings.push('这条规则下没有任何邻居数能让细胞存活或出生，棋盘会在一代内全灭')
  }
  const unreachableAging = []
  for (let s = 2; s < numStates; s++) if (!reachable[s]) unreachableAging.push(stateName(s))
  if (unreachableAging.length) {
    warnings.push(`有 ${unreachableAging.length} 层衰老态永远不会出现（${unreachableAging.map(zh).join('、')}），衰老层数可以调小`)
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

/** 状态名的中文说法，只用于提示文案 */
export function zh(name) {
  if (name === 'dead') return '死亡'
  if (name === 'alive') return '存活'
  const m = /^aging_(\d+)$/.exec(String(name))
  return m ? `衰老 ${m[1]}` : String(name)
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
