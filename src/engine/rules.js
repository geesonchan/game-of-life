// 规则条款 → 查找表的预编译器
// 架构约束（2.2）：引擎每代只查表，绝不在热循环里解释规则。

/** 状态编码：0=死亡，1=存活，2..(1+agingLayers)=衰老态 aging_1..aging_N */
export const DEAD = 0
export const ALIVE = 1

/** 状态名 → 状态码（需要知道衰老层数才能校验范围） */
export function stateFromName(name, agingLayers = 0) {
  if (name === 'dead') return DEAD
  if (name === 'alive') return ALIVE
  const m = /^aging_(\d+)$/.exec(name)
  if (m) {
    const k = Number(m[1])
    if (k < 1 || k > agingLayers) throw new Error(`衰老态 ${name} 超出层数 ${agingLayers}`)
    return 1 + k
  }
  throw new Error(`未知状态名：${name}`)
}

/** 状态码 → 状态名 */
export function stateName(s) {
  if (s === DEAD) return 'dead'
  if (s === ALIVE) return 'alive'
  return `aging_${s - 1}`
}

/** 邻居条件求值（op 为 any 时恒真） */
function matchNeighbors(cond, n) {
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
    default: throw new Error(`未知邻居条件 op：${cond.op}`)
  }
}

/** FNV-1a 哈希，用于规则指纹 */
function fnv1a(bytes, seed = 0x811c9dc5) {
  let h = seed >>> 0
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * 把条款列表编译成查找表。
 * @param {{clauses: Array, agingLayers?: number, name?: string}} def
 * @returns {{lookup: Uint8Array, numStates: number, agingLayers: number,
 *            aliveMap: Uint8Array, clauses: Array, clauseHits: Int32Array,
 *            fingerprint: string, name: string, notation: string|null}}
 *
 * lookup 的索引方式：lookup[当前状态 * 9 + 活邻居数] = 下一状态。
 * 条款自上而下匹配，第一条命中生效；全不命中时隐含兜底"维持原状"。
 */
export function compileRule(def) {
  const agingLayers = def.agingLayers | 0
  if (agingLayers < 0 || agingLayers > 8) throw new Error('衰老层数必须在 0–8 之间')
  const clauses = def.clauses || []
  const numStates = 2 + agingLayers
  const lookup = new Uint8Array(numStates * 9)
  // clauseHits[i] = 第 i 条条款在整张表里命中的格数，为 0 说明该条款永不可达
  const clauseHits = new Int32Array(clauses.length)

  for (let s = 0; s < numStates; s++) {
    const whenName = stateName(s)
    for (let n = 0; n <= 8; n++) {
      let next = s // 兜底：维持原状
      for (let ci = 0; ci < clauses.length; ci++) {
        const c = clauses[ci]
        if (c.when !== whenName) continue
        if (!matchNeighbors(c.neighbors, n)) continue
        next = stateFromName(c.then, agingLayers)
        clauseHits[ci]++
        break
      }
      lookup[s * 9 + n] = next
    }
  }

  // 存活判定表（只有 ALIVE 计入邻居数；衰老态不算活邻居）
  const aliveMap = new Uint8Array(256)
  aliveMap[ALIVE] = 1

  const fp = fnv1a(lookup, fnv1a(new Uint8Array([numStates])))
  const reachable = reachableStates(lookup, numStates)
  const notation = toBSNotation(lookup, reachable)
  return {
    lookup,
    numStates,
    agingLayers,
    aliveMap,
    clauses,
    clauseHits,
    reachable,                       // Uint8Array(numStates)，1 = 从 {死,活} 出发可达
    bsExpressible: notation !== null,
    fingerprint: fp.toString(16).padStart(8, '0'),
    name: def.name || '自定义规则',
    notation
  }
}

/**
 * 可达状态闭包（见 docs/decisions.md D18）。
 * 从任何棋盘都必然拥有的 {死亡, 存活} 出发，反复把 lookup 的结果并入集合，直到不动点。
 * @returns {Uint8Array} 长度 numStates，1 表示可达
 */
export function reachableStates(lookup, numStates) {
  const r = new Uint8Array(numStates)
  r[DEAD] = 1
  if (numStates > ALIVE) r[ALIVE] = 1
  for (let round = 0; round < numStates; round++) {
    let grew = false
    for (let s = 0; s < numStates; s++) {
      if (!r[s]) continue
      for (let n = 0; n <= 8; n++) {
        const t = lookup[s * 9 + n]
        if (!r[t]) { r[t] = 1; grew = true }
      }
    }
    if (!grew) break
  }
  return r
}

/** 从查找表反解出 B/S 的出生集合与存活集合（调用前应确认 bsExpressible） */
export function bsSetsOf(lookup) {
  const born = [], survive = []
  for (let n = 0; n <= 8; n++) {
    if (lookup[DEAD * 9 + n] === ALIVE) born.push(n)
    if (lookup[ALIVE * 9 + n] === ALIVE) survive.push(n)
  }
  return { born, survive }
}

/**
 * 判定查找表能否用 B/S 记法表达，能则返回记法字符串，否则返回 null。
 * 判据是"可达状态闭包是否越出 {死亡, 存活}"（D18），而不是"衰老层数是否为 0"：
 * 用户把层数调大又把条款改回两状态时，那些衰老行没人指向，规则实际上仍然是 B/S 规则。
 * @param {Uint8Array} reachable reachableStates() 的结果
 */
export function toBSNotation(lookup, reachable) {
  for (let s = 2; s < reachable.length; s++) if (reachable[s]) return null
  const { born, survive } = bsSetsOf(lookup)
  return `B${born.join('')}/S${survive.join('')}`
}

/**
 * B/S 记法 → 条款列表（B/S 勾选框只是条款列表的语法糖）。
 * 例："B3/S23" → 3 条条款。
 */
export function parseBS(notation) {
  const m = /^\s*B([0-8]*)\s*\/\s*S([0-8]*)\s*$/i.exec(notation)
  if (!m) throw new Error(`无法解析 B/S 记法：${notation}`)
  const born = [...new Set(m[1].split('').map(Number))].sort((a, b) => a - b)
  const survive = [...new Set(m[2].split('').map(Number))].sort((a, b) => a - b)
  return bsToClauses(born, survive)
}

/** 出生集合 + 存活集合 → 条款列表 */
export function bsToClauses(born, survive) {
  const clauses = []
  if (born.length) clauses.push({ when: 'dead', neighbors: { op: 'in', values: born.slice() }, then: 'alive' })
  if (survive.length) clauses.push({ when: 'alive', neighbors: { op: 'in', values: survive.slice() }, then: 'alive' })
  clauses.push({ when: 'alive', neighbors: { op: 'any' }, then: 'dead' })
  return clauses
}

/**
 * B/S 记法 → 可用的规则对象。解析失败照常抛。
 * 单独抽出来是因为它曾被写在 UI 的回调里，且写错过一次
 * （把已经是条款的 parseBS 结果又喂给 bsToClauses，整条复现路径静默失灵）——
 * 纯函数才测得动（见 docs/decisions.md D82 §4）。
 *
 * 与 data/explorer.js 的 ruleFromNotation 别混：那个只造**规则说明**（未编译，要发给 Worker），
 * 这个直接给**编译好的规则对象**。名字分开就是为了不让人接错。
 */
export function compileNotation(notation) {
  return compileRule({ name: String(notation), agingLayers: 0, clauses: parseBS(notation) })
}

/** 默认规则：标准生命游戏 B3/S23，恰好 3 条条款 */
export function lifeRule() {
  return compileRule({ name: 'Life', agingLayers: 0, clauses: parseBS('B3/S23') })
}
