// 滑块的数值直接输入：点数字变输入框，回车生效，滑块同步，越界钳位。
//
// 取值以**滑块本身**为准，不解析标签文字 —— 12 个滑块里有好几个标签不是纯数字
// （拖尾显示「短/中/长」、衰老显示「0 · 0 = 只有生/死两态」、切片显示「第 200 步」）。
// 解析显示文字会在这些地方立刻崩掉，而且每加一个新滑块都得再想一次。

/**
 * 把用户键入的东西钳到滑块的合法范围。纯函数，不碰 DOM。
 * @param {string|number} raw 用户输入
 * @param {{min:string|number, max:string|number, step?:string|number, value:string|number}} range
 * @returns {number|null} 合法值；输入完全不是数字时返回 null（调用方应当放弃这次修改）
 */
export function clampToRange(raw, range) {
  const text = String(raw).trim()
  // 空串必须单独挡掉：Number('') 是 0，会被钳成 min ——
  // 用户清空输入框再回车，本意是"算了不改"，不是"设成最小值"。
  if (text === '') return null
  const n = Number(text)
  if (!Number.isFinite(n)) return null
  const min = Number(range.min)
  const max = Number(range.max)
  const step = Number(range.step) || 1
  const lo = Number.isFinite(min) ? min : -Infinity
  const hi = Number.isFinite(max) ? max : Infinity
  // 先按步长对齐到 min 的格点，再钳range —— 顺序反了会在 max 不是整步长时越界。
  // 例：min=1 max=60 step=1 输入 3.7 → 对齐得 4；输入 999 → 钳到 60。
  let v = n
  if (Number.isFinite(min) && step > 0) v = min + Math.round((n - min) / step) * step
  v = Math.min(hi, Math.max(lo, v))
  // 浮点步长（密度那个 0.01）会积累误差，按步长的小数位数收一下
  const decimals = (String(range.step || '').split('.')[1] || '').length
  return decimals ? Number(v.toFixed(decimals)) : v
}

/**
 * 给一个滑块 + 它的数值标签接上「点一下直接输入」。
 * 提交后走 dispatchEvent('input')，让既有的 oninput 监听器照常更新界面 ——
 * 不复制一份更新逻辑，就不会有两份逻辑对不上的那天。
 *
 * `opts.toDisplay` / `opts.fromDisplay`：滑块的值与用户看到的数**不是同一个量**时用
 * （缩放滑条是这样：滑块存的是对数档位，用户读写的是"几倍"，见 D84）。
 * 转换只在这一层做，钳位仍旧在滑块单位里进行 —— 映射是单调的，钳完再换算回去照样落在两端。
 * `fromDisplay` 认不出就回 null，当作"这次不改"，与空串走同一条路。
 */
export function attachNumericEntry(range, label, opts = {}) {
  if (!range || !label) return
  const toDisplay = opts.toDisplay || (v => String(v))
  const fromDisplay = opts.fromDisplay || (text => text)
  label.classList.add('num-editable')
  label.tabIndex = 0
  label.setAttribute('role', 'button')

  let input = null
  const close = () => {
    if (!input) return
    input.remove()
    input = null
    label.hidden = false
  }
  const commit = () => {
    if (!input) return
    const raw = fromDisplay(input.value)
    const v = raw === null ? null : clampToRange(raw, range)
    close()
    if (v === null) return                  // 输入不是数字：当作没改过
    range.value = String(v)
    range.dispatchEvent(new Event('input', { bubbles: true }))
    range.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const openEditor = () => {
    if (input) return
    input = document.createElement('input')
    input.type = 'text'
    input.inputMode = 'decimal'             // 手机上唤起数字键盘
    input.className = 'num-input'
    // 初值取自**滑块**，不解析标签文字 —— 有几个标签压根不是数字（拖尾的「短/中/长」）
    input.value = toDisplay(range.value)
    input.setAttribute('aria-label', opts.ariaLabel || range.id)
    label.hidden = true
    label.parentNode.insertBefore(input, label)
    input.focus()
    input.select()
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commit() }
      else if (e.key === 'Escape') { e.preventDefault(); close() }
      e.stopPropagation()                   // 别让方向键/空格触发画布快捷键
    })
    input.addEventListener('blur', commit)
  }

  label.addEventListener('click', openEditor)
  label.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditor() }
  })
}

/**
 * 自带换算、因此**不由通用循环接线**的滑块。
 * 列在这里而不是在 controls.js 里写死一个 id，是为了让"为什么它是例外"有个落点：
 * 这些滑块的值与用户读写的量不是同一个量（缩放：档位 vs 倍数），要带 toDisplay/fromDisplay。
 */
export const CODEC_SLIDERS = Object.freeze({ zoom: 'in-zoom', density: 'crit-density' })

/** 全部带数值标签的滑块：滑块 id → 标签 id。新增滑块必须登记，守卫会查。 */
export const NUMERIC_SLIDERS = Object.freeze([
  ['in-speed', 'lbl-speed'],
  ['in-density', 'lbl-density'],
  ['in-glow-frames', 'lbl-glow'],
  ['in-trail-len', 'lbl-trail'],
  ['exp-count', 'exp-lbl-count'],
  ['exp-runs', 'exp-lbl-runs'],
  ['exp-cap', 'exp-lbl-cap'],
  ['exp-board', 'exp-lbl-board'],
  ['tower-gens', 'tower-lbl-gens'],
  ['tower-height', 'tower-lbl-height'],
  ['tower-slice', 'tower-lbl-slice'],
  ['re-aging', 're-lbl-aging'],
  ['in-zoom', 'hud-scale'],       // 缩放滑条：它的"数值标签"就是 HUD 上那一项（D84 ③）
  ['crit-density', 'crit-lbl-density']   // 临界滑块：滑块存千分位，用户读写 0.xxx（D86 ①）
])
