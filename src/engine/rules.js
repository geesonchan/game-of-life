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
  return {
    lookup,
    numStates,
    agingLayers,
    aliveMap,
    clauses,
    clauseHits,
    fingerprint: fp.toString(16).padStart(8, '0'),
    name: def.name || '自定义规则',
    notation: toBSNotation(lookup, numStates)
  }
}

/**
 * 若查找表能用 B/S 记法表达（无衰老态、结果只有生/死），返回记法字符串；否则返回 null。
 */
export function toBSNotation(lookup, numStates) {
  if (numStates !== 2) return null
  const b = []
  const s = []
  for (let n = 0; n <= 8; n++) {
    const fromDead = lookup[DEAD * 9 + n]
    const fromAlive = lookup[ALIVE * 9 + n]
    if (fromDead > 1 || fromAlive > 1) return null
    if (fromDead === ALIVE) b.push(n)
    if (fromAlive === ALIVE) s.push(n)
  }
  return `B${b.join('')}/S${s.join('')}`
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

/** 默认规则：标准生命游戏 B3/S23，恰好 3 条条款 */
export function lifeRule() {
  return compileRule({ name: 'Life', agingLayers: 0, clauses: parseBS('B3/S23') })
}
