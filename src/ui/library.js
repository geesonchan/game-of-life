// 图案盒子与世界卡片。
// 图案盒子：点一张卡 → 图案跟随鼠标 → 点画布放下。
// 世界卡片：简洁模式下规则预设的另一种呈现（同一批 PRESETS，只是换了说法）。
import { PATTERNS } from '../engine/patterns.js'
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

  function renderPatterns() {
    patternList.innerHTML = PATTERNS.map(p => `
      <button class="card ${app.stamp && app.stamp.key === p.key ? 'on' : ''}" data-pattern="${p.key}" title="${t('pattern.' + p.key + '.desc')}">
        ${miniArt(p)}
        <span class="card-text">
          <b>${t('pattern.' + p.key)}</b>
          <em>${t('pattern.' + p.key + '.desc')}</em>
        </span>
        <i class="card-size">${p.w}×${p.h}</i>
      </button>`).join('')
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

  return { renderPatterns, renderWorlds, render() { renderPatterns(); renderWorlds() } }
}
