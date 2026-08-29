// 内置规则预设。全部以条款列表定义 —— B/S 记法只是条款列表的语法糖。
import { bsToClauses, parseBS, compileRule } from './rules.js'

export const PRESETS = [
  {
    key: 'life', name: 'Life', notation: 'B3/S23', agingLayers: 0,
    note: '标准生命游戏',
    clauses: () => parseBS('B3/S23')
  },
  {
    key: 'highlife', name: 'HighLife', notation: 'B36/S23', agingLayers: 0,
    note: '多一个 6 邻居出生，会自我复制',
    clauses: () => parseBS('B36/S23')
  },
  {
    key: 'seeds', name: 'Seeds', notation: 'B2/S', agingLayers: 0,
    note: '存活集合为空 —— 任何活细胞下一代必死',
    clauses: () => bsToClauses([2], [])
  },
  {
    key: 'brain', name: "Brian's Brain", notation: 'B2/S/C2', agingLayers: 1,
    note: '三态：存活 → 衰老 1 → 死亡；衰老态不计入活邻居',
    clauses: () => ([
      { when: 'dead', neighbors: { op: 'in', values: [2] }, then: 'alive' },
      { when: 'alive', neighbors: { op: 'any' }, then: 'aging_1' },
      { when: 'aging_1', neighbors: { op: 'any' }, then: 'dead' }
    ])
  },
  {
    key: 'daynight', name: 'Day & Night', notation: 'B3678/S34678', agingLayers: 0,
    note: '生死对称规则',
    clauses: () => parseBS('B3678/S34678')
  }
]

/** 按 key 取预设并编译 */
export function presetRule(key) {
  const p = PRESETS.find(x => x.key === key)
  if (!p) throw new Error(`未知预设：${key}`)
  return compileRule({ name: p.name, agingLayers: p.agingLayers, clauses: p.clauses() })
}
