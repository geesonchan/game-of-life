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
  chartGen: -1
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
  app.el.play.textContent = on ? '⏸ 暂停' : '▶ 播放'
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
  app.toast('已清空')
}

app.randomize = function () {
  const seed = readSeedInput(app)
  app.engine.randomize(seed, app.density)
  app.visual.sync(app.engine)
  app.series.clear()
  app.series.push(app.engine.stats.alive)
  app.dirty = true
  app.updateHud()
  app.toast(`已用种子 ${seed} · 密度 ${app.density.toFixed(2)} 初始化`)
}

app.resizeBoard = function (w, h) {
  app.setRunning(false)
  app.engine.resize(w, h)
  app.visual.sync(app.engine)
  app.series.clear()
  app.fitView()
  app.updateHud()
  app.toast(`棋盘 ${w} × ${h}`)
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
  hud.scale.textContent = `缩放 ${app.viewport.scale.toFixed(1)}×` + (c ? ` · 格 (${c.x}, ${c.y})` : '')

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

app.engine.randomize(4271, app.density)
app.visual.sync(app.engine)
app.series.push(app.engine.stats.alive)
app.el.seed.value = '4271'
app.fitView()
app.setRunning(false)

// 容器尺寸变化时只重设画布像素，不改动用户的缩放/平移
app.handleResize = function () {
  app.renderer.resize()
  if (app.needsFit) app.fitView()
  app.dirty = true
}
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

// 便于在浏览器控制台里做手工验证
window.__lab = app
