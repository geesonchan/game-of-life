// 图案盒子与世界卡片。
// 图案盒子：点一张卡 → 图案跟随鼠标 → 点画布放下。
// 世界卡片：简洁模式下规则预设的另一种呈现（同一批 PRESETS，只是换了说法）。
import { PATTERNS, groupedPatterns } from '../engine/patterns.js'
import { PRESETS, presetRule } from '../engine/presets.js'
import { t } from '../i18n/index.js'

/** 用内联 SVG 画一张图案缩略图，比手搓格子省事，也天然跟着 CSS 变色 */
function miniArt(p) {
  return `<svg class="card-art" viewBox="0 0 ${p.w} ${p.h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">` +
    p.cells.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1"/>`).join('') + '</svg>'
}

export function setupLibrary(app) {
  const patternList = document.getElementById('pattern-list')
  const worldList = document.getElementById('world-list')

  // 预设指纹只算一次，用来高亮"当前所在的世界"
  const worldFingerprints = new Map(PRESETS.map(p => [p.key, presetRule(p.key).fingerprint]))

  /** 一张卡。分组标题由 renderPatterns 插在段首（D97 ③） */
  function cardHtml(p) {
    const on = !!(app.stamp && app.stamp.key === p.key)
    // 缩略图即状态（D87 ②）：选中的那张按**当前朝向**画。
    // 用的是 app.stampPattern() —— 与落子用的是同一个函数，
    // 所以"卡上显示的"与"放下去的"不可能不一致（D87 ④，D70 类的承诺对账）。
    // 这里绝不许自己再调一次 transformPattern：那就是第二份实现，迟早对不上。
    const shown = on ? (app.stampPattern() || p) : p
    return `
      <button class="card ${on ? 'on' : ''}" data-pattern="${p.key}" title="${t('pattern.' + p.key + '.desc')}">
        ${miniArt(shown)}
        <span class="card-text">
          <b>${t('pattern.' + p.key)}</b>
          <em>${t('pattern.' + p.key + '.desc')}</em>
        </span>
        <i class="card-size">${shown.w}×${shown.h}</i>
      </button>`
  }

  /**
   * 玩具盒。**按分组渲染，两个屏一个顺序**（D97 ③）：
   * 竖条上分段显示小标题，窄屏横滑带把标题藏掉（那里没地方摆），但排序照旧 ——
   * 同一个盒子在两个屏上是两种排法，才是真让人找不着东西。
   */
  function renderPatterns() {
    patternList.innerHTML = groupedPatterns().map(({ group, items }) => {
      if (!items.length) return ''
      return `<h3 class="rail-group">${t('pattern.group.' + group)}</h3>` + items.map(cardHtml).join('')
    }).join('')
  }

  function renderWorlds() {
    const fp = app.engine.rule.fingerprint
    worldList.innerHTML = PRESETS.map(p => `
      <button class="card world ${worldFingerprints.get(p.key) === fp ? 'on' : ''}" data-world="${p.key}" title="${t('tip.world')}">
        <span class="card-text">
          <b>${t('world.' + p.key)}</b>
          <em>${t('world.' + p.key + '.desc')}</em>
        </span>
      </button>`).join('')
  }

  patternList.addEventListener('click', e => {
    const b = e.target.closest('[data-pattern]')
    if (!b) return
    const p = PATTERNS.find(x => x.key === b.dataset.pattern)
    // 再点一次同一张卡 = 取消选择
    app.setStamp(app.stamp && app.stamp.key === p.key ? null : p)
  })

  worldList.addEventListener('click', e => {
    const b = e.target.closest('[data-world]')
    if (!b) return
    const key = b.dataset.world
    app.applyRule(presetRule(key), t('world.switched', { name: t('world.' + key) }))
    renderWorlds()
  })

  /** 当前棋盘用的规则对应哪个世界；手搓的自定义规则返回 null */
  function currentWorldKey() {
    const fp = app.engine.rule.fingerprint
    for (const [key, f] of worldFingerprints) if (f === fp) return key
    return null
  }

  return {
    renderPatterns, renderWorlds, currentWorldKey,
    render() { renderPatterns(); renderWorlds() }
  }
}
