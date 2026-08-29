// 应用装配与主循环。
// 节拍解耦：引擎按目标速度推进，渲染每帧最多一次（高速时自然跳帧）。
import { LifeEngine } from './engine/board.js'
import { lifeRule } from './engine/rules.js'
import { Viewport } from './render/viewport.js'
import { Renderer } from './render/renderer.js'
import { setupControls, readSeedInput } from './ui/controls.js'
import { setupCanvasInput } from './ui/input.js'

const DEFAULT_SIZE = 200

const canvas = document.getElementById('board')
const app = {
  canvas,
  engine: new LifeEngine(DEFAULT_SIZE, DEFAULT_SIZE, { rule: lifeRule(), boundary: 'torus' }),
  viewport: new Viewport(),
  renderer: new Renderer(canvas),
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
  needsFit: false
}

/* ---------------- 行为 ---------------- */

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
  app.engine.step()
  app.recordStepCost(performance.now() - t0, 1)
  app.dirty = true
  app.updateHud()
}

app.clear = function () {
  app.setRunning(false)
  app.engine.clear()
  app.dirty = true
  app.updateHud()
  app.toast('已清空')
}

app.randomize = function () {
  const seed = readSeedInput(app)
  app.engine.randomize(seed, app.density)
  app.dirty = true
  app.updateHud()
  app.toast(`已用种子 ${seed} · 密度 ${app.density.toFixed(2)} 初始化`)
}

app.resizeBoard = function (w, h) {
  app.setRunning(false)
  app.engine.resize(w, h)
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
  scale: document.getElementById('hud-scale')
}
app.updateHud = function () {
  hud.gen.textContent = app.engine.generation
  hud.alive.textContent = app.engine.stats.alive
  hud.gps.textContent = app.running ? app.gps.toFixed(0) : '0'
  const c = app.hoverCell
  hud.scale.textContent = `缩放 ${app.viewport.scale.toFixed(1)}×` + (c ? ` · 格 (${c.x}, ${c.y})` : '')
}

/* ---------------- 装配 ---------------- */

setupControls(app)
setupCanvasInput(app)

app.engine.randomize(4271, app.density)
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
      for (let i = 0; i < n; i++) app.engine.step()
      app.recordStepCost(performance.now() - t0, n)
      app.gensInWindow += n
      app.dirty = true
    }
    // 每 500ms 统计一次实际代/秒
    if (now - app.windowStart >= 500) {
      app.gps = (app.gensInWindow * 1000) / (now - app.windowStart)
      app.windowStart = now
      app.gensInWindow = 0
    }
  }

  if (app.dirty) {
    app.renderer.draw(app.engine, app.viewport)
    app.dirty = false
    app.updateHud()
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// 便于在浏览器控制台里做手工验证
window.__lab = app
