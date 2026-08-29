// 规则导出 / 导入（见 docs/decisions.md D21）。
// 能用 B/S 记法表达就输出记法字符串，否则退化成条款 JSON。
import { compileRule, parseBS } from './rules.js'

/** @param {object} rule compileRule() 的产物 @returns {string} */
export function exportRule(rule) {
  if (rule.bsExpressible) return rule.notation
  return JSON.stringify({
    version: 1,
    name: rule.name,
    agingLayers: rule.agingLayers,
    clauses: rule.clauses
  }, null, 2)
}

/**
 * 导入：按首字符判别是 JSON 还是 B/S 记法。
 * @returns {object} 已编译的规则
 */
export function importRule(text) {
  const s = String(text).trim()
  if (s === '') throw new Error('内容为空')
  if (s[0] === '{') {
    let obj
    try {
      obj = JSON.parse(s)
    } catch (e) {
      throw new Error(`不是合法的 JSON：${e.message}`)
    }
    if (!Array.isArray(obj.clauses)) throw new Error('JSON 里缺少 clauses 数组')
    return compileRule({
      name: obj.name || '导入的规则',
      agingLayers: obj.agingLayers | 0,
      clauses: obj.clauses
    })
  }
  return compileRule({ name: s, agingLayers: 0, clauses: parseBS(s) })
}
