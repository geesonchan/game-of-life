// 侧栏控件绑定。所有控件只调用 app 上的方法或改 app 的视觉开关，不直接碰引擎内部。
import { normalizeSeed, randomSeed } from '../engine/prng.js'
import { isTyping } from './input.js'

const $ = id => document.getElementById(id)

/** 拖尾滑块（1–20）→ 每帧叠加的底色不透明度。越小残留越久。 */
export function trailAlphaOf(v) { return 0.45 * Math.pow(0.85, v - 1) }
function trailLabel(v) { return v <= 6 ? '短' : v <= 13 ? '中' : '长' }

export function setupControls(app) {
  const el = {
    play: $('btn-play'), step: $('btn-step'), random: $('btn-random'), clear: $('btn-clear'),
    fit: $('btn-fit'), speed: $('in-speed'), density: $('in-density'), seed: $('in-seed'),
    boundary: $('in-boundary'), size: $('in-size'),
    lblSpeed: $('lbl-speed'), lblDensity: $('lbl-density'),
    lblNotation: $('lbl-notation'), lblFingerprint: $('lbl-fingerprint'),
    palette: $('in-palette'), age: $('in-age'), glow: $('in-glow'),
    glowFrames: $('in-glow-frames'), lblGlow: $('lbl-glow'),
    trails: $('in-trails'), trailLen: $('in-trail-len'), lblTrail: $('lbl-trail')
  }
  app.el = el

  el.play.addEventListener('click', () => app.setRunning(!app.running))
  el.step.addEventListener('click', () => { app.setRunning(false); app.stepOnce() })
  el.clear.addEventListener('click', () => app.clear())
  el.fit.addEventListener('click', () => app.fitView())
  el.random.addEventListener('click', () => app.randomize())

  el.speed.addEventListener('input', () => {
    app.speed = Number(el.speed.value)
    el.lblSpeed.textContent = app.speed
  })

  el.density.addEventListener('input', () => {
    app.density = Number(el.density.value)
    el.lblDensity.textContent = app.density.toFixed(2)
  })

  el.boundary.addEventListener('change', () => {
    app.engine.setBoundary(el.boundary.value)
    app.toast(el.boundary.value === 'torus' ? '边界：环形' : '边界：死边界')
  })

  el.size.addEventListener('change', () => {
    const n = Number(el.size.value)
    app.resizeBoard(n, n)
  })

  /* ---------- 视觉效果（全部只影响渲染层） ---------- */

  el.palette.addEventListener('change', () => {
    app.renderer.setPalette(el.palette.value)
    app.chart.draw(app.series, app.renderer.flat)  // 折线图主色跟随色带
    app.dirty = true
  })

  el.age.addEventListener('change', () => {
    app.visualOpts.ageColoring = el.age.checked
    app.dirty = true
  })

  el.glow.addEventListener('change', () => {
    app.visualOpts.glow = el.glow.checked
    el.glowFrames.parentElement.classList.toggle('disabled', !el.glow.checked)
    app.dirty = true
  })

  el.glowFrames.addEventListener('input', () => {
    const n = Number(el.glowFrames.value)
    el.lblGlow.textContent = n
    app.renderer.setGlowFrames(n)
    app.visual.clampDecay(n)   // 调小长度时把超出的残影钳回来
    app.dirty = true
  })

  el.trails.addEventListener('change', () => {
    app.visualOpts.trails = el.trails.checked
    el.trailLen.parentElement.classList.toggle('disabled', !el.trails.checked)
    app.dirty = true
  })

  el.trailLen.addEventListener('input', () => {
    const v = Number(el.trailLen.value)
    app.visualOpts.trailAlpha = trailAlphaOf(v)
    el.lblTrail.textContent = trailLabel(v)
    app.dirty = true
  })

  // 初始同步一次控件与状态
  app.visualOpts.ageColoring = el.age.checked
  app.visualOpts.glow = el.glow.checked
  app.visualOpts.trails = el.trails.checked
  app.visualOpts.trailAlpha = trailAlphaOf(Number(el.trailLen.value))
  el.lblTrail.textContent = trailLabel(Number(el.trailLen.value))
  el.lblGlow.textContent = el.glowFrames.value
  app.renderer.setPalette(el.palette.value)
  app.renderer.setGlowFrames(Number(el.glowFrames.value))
  el.glowFrames.parentElement.classList.toggle('disabled', !el.glow.checked)
  el.trailLen.parentElement.classList.toggle('disabled', !el.trails.checked)

  // 键盘快捷键
  window.addEventListener('keydown', e => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey) return
    const k = e.key.toLowerCase()
    if (k === 'p') { app.setRunning(!app.running); e.preventDefault() }
    else if (k === 'n') { app.setRunning(false); app.stepOnce(); e.preventDefault() }
    else if (k === 'f') { app.fitView(); e.preventDefault() }
    else if (k === 'r') { app.randomize(); e.preventDefault() }
    else if (k === 'c') { app.clear(); e.preventDefault() }
  })

  // 规则信息由 app.updateRuleInfo() 统一维护（规则可在编辑器里换）
  return el
}

/** 读取种子输入框：留空则生成随机种子并回填显示 */
export function readSeedInput(app) {
  const raw = app.el.seed.value.trim()
  const seed = raw === '' ? randomSeed() : normalizeSeed(raw)
  app.el.seed.value = String(seed)
  return seed
}
