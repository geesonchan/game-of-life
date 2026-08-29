// 应用装配与主循环。
// 节拍解耦：引擎与视觉状态按代推进（每代必录），渲染每帧最多一次（高速时自然跳帧）。
import { LifeEngine } from './engine/board.js'
import { lifeRule } from './engine/rules.js'
import { Viewport } from './render/viewport.js'
import { Renderer } from './render/renderer.js'
import { VisualState } from './render/visual-state.js'
import { Chart } from './render/chart.js'
import { RingSeries } from './data/series.js'
import { setupControls, readSeedInput } from './ui/controls.js'
import { setupCanvasInput } from './ui/input.js'
import { createRuleEditor } from './ui/rule-editor.js'
import { setupLibrary } from './ui/library.js'
import { createIntro } from './ui/intro.js'
import { placePattern, centerOrigin } from './engine/patterns.js'
import { t, applyStatic, onLangChange, setRegister, setLang, getLang } from './i18n/index.js'
import { prefs } from './ui/prefs.js'

const DEFAULT_SIZE = 200
const HISTORY_LEN = 500   // 折线图窗口：最近 500 代

const canvas = document.getElementById('board')
const engine = new LifeEngine(DEFAULT_SIZE, DEFAULT_SIZE, { rule: lifeRule(), boundary: 'torus' })

const app = {
  canvas,
  engine,
  viewport: new Viewport(),
  renderer: new Renderer(canvas),
  visual: new VisualState(engine.cur.length),
  chart: new Chart(document.getElementById('chart')),
  series: new RingSeries(HISTORY_LEN),
  visualOpts: { ageColoring: true, glow: true, trails: false, trailAlpha: 0.104 },
  running: false,
  speed: 10,             // 目标代/秒
  density: 0.35,
  dirty: true,
  hoverCell: null,
  stepMsEma: 0,          // 单代耗时滑动平均，用于帧率保护
  throttled: false,
  autoPaused: false,
  gensInWindow: 0,
  windowStart: 0,
  gps: 0,
  framesInWindow: 0,
  fpsWindowStart: 0,
  fps: 0,
  needsFit: false,
  chartGen: -1,
  mode: 'full',       // 'simple' | 'full'
  stamp: null         // 当前选中的图案（跟随鼠标待放置）
}

/* ---------------- 行为 ---------------- */

/** 推进一代：引擎 → 视觉状态 → 数据记录，三者严格同拍 */
app.tick = function () {
  const s = app.engine.step()
  app.visual.advance(app.engine, app.visualOpts.glow ? app.renderer.glowFrames : 0)
  app.series.push(s.alive)
  return s
}

app.setRunning = function (on) {
  app.running = on
  app.autoPaused = false
  app.el.play.textContent = t(on ? 'ctrl.pause' : 'ctrl.play')
  app.el.play.title = t(on ? 'tip.pause' : 'tip.play')
  app.el.play.classList.toggle('primary', !on)
  app.windowStart = performance.now()
  app.gensInWindow = 0
  if (!on) app.gps = 0
  app.updateHud()
}

app.stepOnce = function () {
  const t0 = performance.now()
  app.tick()
  app.recordStepCost(performance.now() - t0, 1)
  app.dirty = true
  app.updateHud()
}

app.clear = function () {
  app.setRunning(false)
  app.engine.clear()
  app.visual.sync(app.engine)
  app.series.clear()
  app.dirty = true
  app.updateHud()
  app.toast(t('toast.cleared'))
}

app.randomize = function () {
  const seed = readSeedInput(app)
  app.engine.randomize(seed, app.density)
  app.visual.sync(app.engine)
  app.series.clear()
  app.series.push(app.engine.stats.alive)
  app.dirty = true
  app.updateHud()
  app.toast(t('toast.randomized', { seed, density: app.density.toFixed(2) }))
}

/** 应用一条新编译的规则（引擎会把不可达状态的细胞清成死亡，见 D18） */
app.applyRule = function (rule, message) {
  app.engine.setRule(rule)
  app.renderer.setAgingLayers(rule.agingLayers)
  app.visual.sync(app.engine)   // 被清掉的衰老细胞不该留下年龄或残影
  app.updateRuleInfo()
  if (app.library) app.library.renderWorlds()
  app.dirty = true
  app.updateHud()
  app.toast(message || t('toast.ruleApplied', {
    notation: rule.notation || t('rule.beyondBS'), fp: rule.fingerprint
  }))
}

app.updateRuleInfo = function () {
  const r = app.engine.rule
  document.getElementById('lbl-rule-name').textContent = r.name
  document.getElementById('lbl-notation').textContent = r.notation || t('rule.beyondBS')
  document.getElementById('lbl-fingerprint').textContent = r.fingerprint
  let n = 0
  for (let i = 0; i < r.reachable.length; i++) if (r.reachable[i]) n++
  document.getElementById('lbl-states').textContent = n
}

app.resizeBoard = function (w, h) {
  app.setRunning(false)
  app.engine.resize(w, h)
  app.visual.sync(app.engine)
  app.series.clear()
  app.fitView()
  app.updateHud()
  app.toast(t('toast.resized', { w, h }))
}

/** 简洁 / 完整模式切换：只改 body 上的 class，具体哪些区块显示由 CSS 的 data-mode 决定 */
app.setMode = function (mode, opts = {}) {
  app.mode = mode === 'simple' ? 'simple' : 'full'
  document.body.classList.toggle('mode-simple', app.mode === 'simple')
  document.body.classList.toggle('mode-full', app.mode === 'full')
  // 语域跟着模式走：简洁模式优先取 key + '.simple' 的大白话文案
  setRegister(app.mode)
  if (app.mode === 'simple' && app.stamp) app.setStamp(null)
  app.handleResize()
  if (!opts.silent) app.toast(t(app.mode === 'simple' ? 'mode.toSimple' : 'mode.toFull'))
}

/** 选中 / 取消选中一个待放置的图案 */
app.setStamp = function (pattern) {
  app.stamp = pattern
  app.library.renderPatterns()
  app.canvas.classList.toggle('stamping', !!pattern)
  app.dirty = true
  if (pattern) app.toast(t('pattern.selected', { name: t('pattern.' + pattern.key) }))
  else app.toast(t('pattern.cancelled'))
}

/** 在某个格子放下当前图案（以光标为中心） */
app.placeStampAt = function (cell) {
  const p = app.stamp
  if (!p) return
  if (p.w > app.engine.w || p.h > app.engine.h) {
    app.toast(t('pattern.tooBig', { name: t('pattern.' + p.key) }))
    return
  }
  const o = centerOrigin(p, cell.x, cell.y)
  placePattern(app.engine, p, o.x, o.y)
  app.engine.stats.alive = app.engine.countAlive()
  app.visual.reconcile(app.engine)
  app.dirty = true
  app.updateHud()
  app.toast(t('pattern.placed', { name: t('pattern.' + p.key) }))
}

app.fitView = function () {
  const { w, h } = app.renderer.resize()
  if (w <= 1 || h <= 1) {
    // 布局还没算出来（首帧之前），推迟到主循环里再适配
    app.needsFit = true
    return
  }
  app.needsFit = false
  app.viewport.fit(w, h, app.engine.w, app.engine.h)
  app.dirty = true
  app.updateHud()
}

/**
 * 容器尺寸变化：保持缩放不变，但让原本在画布正中的那个格子仍然在正中。
 * 顶栏的卡片条一展一收就会改变画布高度，若只改像素不动视口，棋盘会被裁掉一截；
 * 重新 fit 又会把用户的缩放冲掉。折中就是"锚住中心点"。
 */
app.handleResize = function () {
  const vp = app.viewport
  const oldW = app.canvas.width, oldH = app.canvas.height
  const cx = vp.originX + oldW / (2 * vp.scale)
  const cy = vp.originY + oldH / (2 * vp.scale)
  const { w, h } = app.renderer.resize()
  if (app.needsFit) { app.fitView(); return }
  if (oldW > 1 && oldH > 1 && w > 1 && h > 1) {
    vp.originX = cx - w / (2 * vp.scale)
    vp.originY = cy - h / (2 * vp.scale)
  }
  app.dirty = true
}

/** 记录单代耗时；超过 16ms 触发自动降速 */
app.recordStepCost = function (totalMs, count) {
  const per = totalMs / count
  app.stepMsEma = app.stepMsEma === 0 ? per : app.stepMsEma * 0.8 + per * 0.2
  const shouldThrottle = app.stepMsEma > 16
  if (shouldThrottle !== app.throttled) {
    app.throttled = shouldThrottle
    document.getElementById('throttle-note').hidden = !shouldThrottle
  }
}

/** 实际生效的速度：单代太慢时按实测耗时压到能跑得动的水平 */
app.effectiveSpeed = function () {
  if (!app.throttled) return app.speed
  return Math.max(1, Math.min(app.speed, 1000 / app.stepMsEma))
}

let toastTimer = 0
app.toast = function (msg) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.hidden = true }, 1800)
}

const hud = {
  gen: document.getElementById('hud-gen'),
  alive: document.getElementById('hud-alive'),
  gps: document.getElementById('hud-gps'),
  fps: document.getElementById('hud-fps'),
  scale: document.getElementById('hud-scale')
}
const st = {
  gen: document.getElementById('st-gen'),
  alive: document.getElementById('st-alive'),
  births: document.getElementById('st-births'),
  area: document.getElementById('st-area'),
  lonely: document.getElementById('st-lonely'),
  crowded: document.getElementById('st-crowded')
}

app.updateHud = function () {
  const s = app.engine.stats
  hud.gen.textContent = app.engine.generation
  hud.alive.textContent = s.alive
  hud.gps.textContent = app.running ? app.gps.toFixed(0) : '0'
  hud.fps.textContent = app.running ? app.fps.toFixed(0) : '–'
  const c = app.hoverCell
  hud.scale.textContent = `${t('hud.zoom')} ${app.viewport.scale.toFixed(1)}×`
    + (c ? ` · ${t('hud.cell')} (${c.x}, ${c.y})` : '')

  st.gen.textContent = app.engine.generation
  st.alive.textContent = s.alive
  st.births.textContent = s.births
  st.area.textContent = s.activeArea
  st.lonely.textContent = s.deathsLonely
  st.crowded.textContent = s.deathsCrowded
}

/* ---------------- 装配 ---------------- */

setupControls(app)
setupCanvasInput(app)
app.ruleEditor = createRuleEditor(app)
document.getElementById('btn-rule').addEventListener('click', () => app.ruleEditor.open())
app.library = setupLibrary(app)
app.library.render()
app.intro = createIntro(app)
document.getElementById('btn-help').addEventListener('click', () => app.intro.open(0))
app.renderer.setAgingLayers(app.engine.rule.agingLayers)
app.updateRuleInfo()

// 恢复界面偏好（只有语言、模式、介绍卡看过没有这三样，见 docs/decisions.md D30）
const savedLang = prefs.get('lang')
if (savedLang === 'zh' || savedLang === 'en') setLang(savedLang)
const savedMode = prefs.get('mode')
if (savedMode === 'simple' || savedMode === 'full') app.setMode(savedMode, { silent: true })
app.syncSwitches()
applyStatic()
app.library.render()

// 切语言：静态文字整棵树重刷，动态生成的部分各自重绘
onLangChange(() => {
  applyStatic()
  app.el.play.textContent = t(app.running ? 'ctrl.pause' : 'ctrl.play')
  app.el.lblTrail.textContent = trailLabelOf(Number(app.el.trailLen.value))
  app.library.render()
  app.updateRuleInfo()
  app.updateHud()
  app.chart.draw(app.series, app.renderer.flat)
  app.ruleEditor.relocalize()
  app.intro.relocalize()
  app.refreshTabHint()
})
function trailLabelOf(v) {
  return t(v <= 6 ? 'vis.trail.short' : v <= 13 ? 'vis.trail.mid' : 'vis.trail.long')
}

app.engine.randomize(4271, app.density)
app.visual.sync(app.engine)
app.series.push(app.engine.stats.alive)
app.el.seed.value = '4271'
app.fitView()
app.setRunning(false)

new ResizeObserver(() => app.handleResize()).observe(canvas)

// 标签页切到后台自动暂停
document.addEventListener('visibilitychange', () => {
  if (document.hidden && app.running) {
    app.setRunning(false)
    app.autoPaused = true
  }
})

/* ---------------- 主循环 ---------------- */

let last = performance.now()
let acc = 0

function frame(now) {
  const dt = Math.min(now - last, 250)
  last = now

  if (app.needsFit) app.fitView()

  if (app.running) {
    const speed = app.effectiveSpeed()
    acc += (dt / 1000) * speed
    let n = Math.floor(acc)
    if (n > 0) {
      acc -= n
      n = Math.min(n, 30) // 单帧步数上限，避免卡顿后疯狂追帧
      const t0 = performance.now()
      for (let i = 0; i < n; i++) app.tick()
      app.recordStepCost(performance.now() - t0, n)
      app.gensInWindow += n
      app.dirty = true
    }
    // 拖尾模式下即使这一帧没换代，也要继续淡出残影
    if (app.visualOpts.trails) app.dirty = true
    // 每 500ms 统计一次实际代/秒
    if (now - app.windowStart >= 500) {
      app.gps = (app.gensInWindow * 1000) / (now - app.windowStart)
      app.windowStart = now
      app.gensInWindow = 0
    }
  }

  // 帧率统计（无论是否在跑都记，方便观察渲染负载）
  app.framesInWindow++
  if (now - app.fpsWindowStart >= 500) {
    app.fps = (app.framesInWindow * 1000) / (now - app.fpsWindowStart)
    app.fpsWindowStart = now
    app.framesInWindow = 0
  }

  if (app.dirty) {
    app.renderer.draw(app.engine, app.viewport, app.visual, app.visualOpts)
    if (app.stamp && app.hoverCell) {
      const o = centerOrigin(app.stamp, app.hoverCell.x, app.hoverCell.y)
      app.renderer.drawGhost(app.viewport, app.stamp, o.x, o.y, app.engine.w, app.engine.h)
    }
    app.dirty = false
    app.updateHud()
  }

  // 折线图按代数变化重绘，最多每 100ms 一次
  if (app.engine.generation !== app.chartGen && now - (app.chartAt || 0) >= 100) {
    app.chart.draw(app.series, app.renderer.flat)
    app.chartGen = app.engine.generation
    app.chartAt = now
  }

  requestAnimationFrame(frame)
}
app.chart.draw(app.series, app.renderer.flat)
requestAnimationFrame(frame)

// 首次进入自动弹出介绍卡。规格修订后（D30）"看过了"会记在 localStorage 里，
// 所以刷新页面不会再弹；存储不可用时（隐私模式）退化成每次打开都弹一次，不影响使用。
if (prefs.get('introSeen') !== '1') app.intro.open(0)

// 便于在浏览器控制台里做手工验证
window.__lab = app
