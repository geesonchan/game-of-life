// 侧栏控件绑定。所有控件只调用 app 上的方法，不直接碰引擎内部。
import { normalizeSeed, randomSeed } from '../engine/prng.js'
import { isTyping } from './input.js'

const $ = id => document.getElementById(id)

export function setupControls(app) {
  const el = {
    play: $('btn-play'), step: $('btn-step'), random: $('btn-random'), clear: $('btn-clear'),
    fit: $('btn-fit'), speed: $('in-speed'), density: $('in-density'), seed: $('in-seed'),
    boundary: $('in-boundary'), size: $('in-size'),
    lblSpeed: $('lbl-speed'), lblDensity: $('lbl-density'),
    lblNotation: $('lbl-notation'), lblFingerprint: $('lbl-fingerprint')
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

  // 规则信息（阶段 1 固定为 Life）
  el.lblNotation.textContent = app.engine.rule.notation || '（条款规则）'
  el.lblFingerprint.textContent = app.engine.rule.fingerprint

  return el
}

/** 读取种子输入框：留空则生成随机种子并回填显示 */
export function readSeedInput(app) {
  const raw = app.el.seed.value.trim()
  const seed = raw === '' ? randomSeed() : normalizeSeed(raw)
  app.el.seed.value = String(seed)
  return seed
}
