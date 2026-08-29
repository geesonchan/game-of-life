// i18n 运行时。
// 静态文字用 data-i18n 标记，切换语言时整棵树重刷；
// 动态生成的 HTML（规则编辑器、图表、提示条）调 t() 取词。
import { DICT } from './dict.js'

const listeners = []
let lang = 'zh'
let register = 'full'   // 'simple' 时优先取 key + '.simple' 的白话版本

/**
 * 语域（简洁 / 完整）。简洁模式下同一个 key 可以有一份大白话文案：
 * 只需在词典里加 `key + '.simple'`，没加的自动沿用通用词条，
 * 不必为每个 key 都写两遍。
 *
 * 约定：`.simple` 后缀被这套机制征用了，所以**不要**给普通词条起以 `.simple` 结尾的名字
 * （模式开关的按钮文字就因此叫 `mode.simpleLabel` 而不是 `mode.simple`）。
 * 有一条测试盯着这件事：每个 `X.simple` 都必须存在对应的基础词条 `X`。
 */
export function setRegister(next) {
  if (next === register) return
  register = next
  applyStatic()
  for (const f of listeners) f(lang)
}

export function getRegister() { return register }

/** 取词并替换 {占位符}；缺词时回落中文，再缺就把 key 原样吐出来（方便一眼看出漏翻） */
export function t(key, params) {
  const table = DICT[lang] || DICT.zh
  let s
  if (register === 'simple') {
    s = table[key + '.simple']
    if (s === undefined) s = DICT.zh[key + '.simple']
  }
  if (s === undefined) s = table[key]
  if (s === undefined) s = DICT.zh[key]
  if (s === undefined) return key
  if (params) {
    for (const k in params) s = s.split('{' + k + '}').join(String(params[k]))
  }
  return s
}

export function getLang() { return lang }

export function setLang(next) {
  if (!DICT[next] || next === lang) return
  lang = next
  document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'
  applyStatic()
  for (const f of listeners) f(lang)
}

/** 语言变化时需要重绘的东西（图表、编辑器、HUD…）在这里登记 */
export function onLangChange(fn) { listeners.push(fn) }

/**
 * 刷新所有静态文字。
 *   data-i18n            → textContent
 *   data-i18n-html       → innerHTML（提示里带 <b> 的那几条）
 *   data-i18n-title      → title 属性
 *   data-i18n-placeholder→ placeholder 属性
 */
export function applyStatic(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n) })
  root.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml) })
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle) })
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder) })
}

/** 状态码 → 本地化名称（供编辑器与校验文案用） */
export function stateLabel(name, short = false) {
  const m = /^aging_(\d+)$/.exec(String(name))
  if (m) return t(short ? 'state.short.aging' : 'state.aging', { n: m[1] })
  if (name === 'dead') return t(short ? 'state.short.dead' : 'state.dead')
  if (name === 'alive') return t(short ? 'state.short.alive' : 'state.alive')
  return String(name)
}
