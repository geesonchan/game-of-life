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
import { setupRecords } from './ui/records.js'
import { setupIO } from './ui/io.js'
import { createTowerView } from './ui/tower-view.js'
import { createExplorerView } from './ui/explorer-view.js'
import { boardBaseline } from './engine/save.js'
import { AGE_MAX } from './render/palette.js'
import { placePattern, centerOrigin, transformPattern } from './engine/patterns.js'
import { t, applyStatic, onLangChange, setRegister, setLang, getLang } from './i18n/index.js'
import { prefs } from './ui/prefs.js'
import { setupAnalytics } from './analytics.js'

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
  stamp: null,        // 当前选中的图案（跟随鼠标待放置）
  stampOrient: { rot: 0, flip: false },   // 当前图案的朝向（D81）
  runDirty: false,    // 本局是否被手动改过 ⇒ 存档不能再靠种子重放
  baseline: null,     // 手改之后的重放基线 {rle, gen}
  selectArmed: false, // 侧栏按钮预备的一次性框选（Shift+拖则随时可用）
  selection: null     // {x0,y0,w,h}，拖动过程中的选框
}

/* ---------------- 行为 ---------------- */

/** 推进一代：引擎 → 视觉状态 → 数据记录，三者严格同拍 */
/** 推进一代：引擎 → 视觉状态 → 数据记录，三者严格同拍。返回终止信息（没终止则为 null） */
app.tick = function () {
  const s = app.engine.step()
  app.visual.advance(app.engine, app.visualOpts.glow ? app.renderer.glowFrames : 0)
  app.series.push(s.alive)
  return app.records ? app.records.onGeneration(s) : null
}

app.setRunning = function (on) {
  app.running = on
  app.autoPaused = false
  app.el.play.textContent = t(on ? 'ctrl.pause' : 'ctrl.play')
  app.el.play.title = t(on ? 'tip.pause' : 'tip.play')
  // 同一个按钮随状态换色：待播放 = 绿（primary），运行中 = 橙（running）
  app.el.play.classList.toggle('primary', !on)
  app.el.play.classList.toggle('running', on)
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

app.clear = function (opts = {}) {
  app.setRunning(false)
  app.engine.clear()
  app.visual.sync(app.engine)
  app.runDirty = false
  app.baseline = null
  app.series.clear()
  app.records.startRun()
  app.dirty = true
  app.updateHud()
  // 介绍卡收尾时要静默清盘 —— 用户刚点的是「开始玩」，弹一句「已清空」是答非所问
  if (!opts.silent) app.toast(t('toast.cleared'))
}

app.randomize = function () {
  const seed = readSeedInput(app)
  app.engine.randomize(seed, app.density)
  app.visual.sync(app.engine)
  app.runDirty = false
  app.baseline = null
  app.series.clear()
  app.series.push(app.engine.stats.alive)
  app.records.startRun()
  app.dirty = true
  app.updateHud()
  app.toast(t('toast.randomized', { seed, density: app.density.toFixed(2) }))
}

/** 应用一条新编译的规则（引擎会把不可达状态的细胞清成死亡，见 D18） */
app.applyRule = function (rule, message) {
  app.engine.setRule(rule)
  app.renderer.setAgingLayers(rule.agingLayers)
  app.visual.sync(app.engine)   // 被清掉的衰老细胞不该留下年龄或残影
  app.records.startRun()        // 换了规则就是另一局，之前攒的哈希不再适用
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
  // HUD 上常驻显示当前世界名 —— 切去烟花世界玩过之后，很容易忘了自己还没切回来
  if (app.library) {
    const key = app.library.currentWorldKey()
    document.getElementById('hud-world').textContent = key ? t('world.' + key) : t('rule.custom')
  }
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
  app.runDirty = false
  app.baseline = null
  app.series.clear()
  app.records.startRun()
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
  // 简洁模式下玩具条常驻展开 —— 常驻的东西不需要开关，所以那个标签也一并隐藏（data-mode）
  if (app.mode === 'simple') app.setRail(true)
  app.handleResize()
  if (!opts.silent) app.toast(t(app.mode === 'simple' ? 'mode.toSimple' : 'mode.toFull'))
}

/** 选中 / 取消选中一个待放置的图案 */
/** 选中图案时幽灵的锚点（左上角格）；没选中则返回 null */
app.stampAnchor = function () {
  const gc = app.stampAt || app.hoverCell
  const p = app.stampPattern()
  if (!p || !gc) return null
  return centerOrigin(p, gc.x, gc.y)
}

/** 当前朝向下的图案（幽灵与落子都用它，保证看到的就是放下的） */
app.stampPattern = function () {
  if (!app.stamp) return null
  const o = app.stampOrient
  return (o.rot || o.flip) ? transformPattern(app.stamp, o) : app.stamp
}

/** 旋转 / 镜像当前图案（D81）。改的是朝向状态，不改原始图案数据。 */
app.rotateStamp = function (steps) {
  if (!app.stamp) return
  app.stampOrient = { rot: (app.stampOrient.rot + steps + 4) % 4, flip: app.stampOrient.flip }
  app.dirty = true
  app.updateHoverReadout()
}
app.flipStamp = function () {
  if (!app.stamp) return
  app.stampOrient = { rot: app.stampOrient.rot, flip: !app.stampOrient.flip }
  app.dirty = true
  app.updateHoverReadout()
}

app.setStamp = function (pattern) {
  app.stamp = pattern
  app.stampAt = null          // 换图案就解除方向键的钉住
  app.stampOrient = { rot: 0, flip: false }   // 换图案也复位朝向
  document.body.classList.toggle('stamp-active', !!pattern)
  document.getElementById('stamp-tools').hidden = !pattern
  app.library.renderPatterns()
  app.canvas.classList.toggle('stamping', !!pattern)
  app.dirty = true
  if (pattern) app.toast(t('pattern.selected', { name: pattern.label || t('pattern.' + pattern.key) }))
  else app.toast(t('pattern.cancelled'))
}

/** 在某个格子放下当前图案（以光标为中心） */
app.placeStampAt = function (cell) {
  const p = app.stampPattern()      // 放下的必须与幽灵一致
  if (!p) return
  const label = p.label || t('pattern.' + p.key)
  if (p.w > app.engine.w || p.h > app.engine.h) {
    app.toast(t('pattern.tooBig', { name: label }))
    return
  }
  const o = centerOrigin(p, cell.x, cell.y)
  placePattern(app.engine, p, o.x, o.y)
  app.engine.stats.alive = app.engine.countAlive()
  app.visual.reconcile(app.engine)
  app.records.noteEdit()
  app.markDirtyRun()
  app.captureBaseline()
  app.dirty = true
  app.updateHud()
  app.toast(t('pattern.placed', { name: label }))
}

/**
 * 本局被手动改过：从种子重放这条路断了，改用"当时的棋盘 RLE"当新基线。
 * 基线在**每次编辑动作结束时**抓一次（抬笔、放下图案），不是每次 pointermove ——
 * 那样每笔要算几十次全盘 RLE。基线抓在编辑那一刻而不是存档那一刻，
 * 读档时才有 (存档代数 - 编辑代数) 这段可以重放，年龄和统计才回得来。
 */
app.markDirtyRun = function () { app.runDirty = true }

app.captureBaseline = function () {
  if (!app.runDirty) return
  app.baseline = { rle: boardBaseline(app.engine), gen: app.engine.generation }
}

/** 重放期间的一代：与正常运行走同一条流水线，只是年龄数组按需推进 */
const VISUAL_WARMUP = AGE_MAX + 16   // 年龄色阶在 AGE_MAX 代就饱和了，更早的推进对画面没有影响
app.replayStep = function (remaining) {
  const s = app.engine.step()
  app.series.push(s.alive)
  app.records.onGeneration(s)
  // 只在最后这一小段推进年龄/余晖：色阶到 AGE_MAX 代就封顶，
  // 所以"补跑 VISUAL_WARMUP 代"与"从头跑满"渲染出来的颜色逐格相同，代价却小得多。
  if (remaining === VISUAL_WARMUP) app.visual.sync(app.engine)
  if (remaining <= VISUAL_WARMUP) {
    app.visual.advance(app.engine, app.visualOpts.glow ? app.renderer.glowFrames : 0)
  }
}
app.VISUAL_WARMUP = VISUAL_WARMUP

/**
 * 预备一次框选（侧栏按钮用）。它不是常驻模式：拖完一次就自动失效，
 * 和 Shift+拖是同一件事的两个入口，而不是两套状态机（D47）。
 */
app.armSelection = function (on) {
  app.selectArmed = !!on
  app.clearSelection()
  app.canvas.classList.toggle('selecting', app.selectArmed)
  if (app.selectArmed && app.stamp) app.setStamp(null)
  app.dirty = true
}

app.clearSelection = function () {
  app.selection = null
  app.hideSelectionMenu()
  app.dirty = true
}

/** 读档后换上新引擎：所有跟棋盘尺寸/规则挂钩的东西都要重新对齐 */
app.adoptEngine = function (engine) {
  app.engine = engine
  app.visual.sync(engine)
  app.series.clear()
  app.series.push(engine.stats.alive)
  app.renderer.setAgingLayers(engine.rule.agingLayers)
  app.records.startRun()
  app.runDirty = engine.initType === 'pattern'
  app.el.boundary.set(engine.boundary)
  app.el.size.set(String(engine.w))
  app.updateRuleInfo()
  app.library.render()
  app.fitView()
  app.updateHud()
  app.dirty = true
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
  cell: document.getElementById('hud-cell'),
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

/**
 * 只刷新 HUD 里的坐标那一项。单独拆出来是因为它要挂在 pointermove 上 ——
 * 每次鼠标移动都跑整个 updateHud（十来处 DOM 写入）没必要。
 *
 * 坐标此前是拼在「缩放」那一项尾巴上的，于是有两个毛病：
 * 窄屏下连同缩放一起被藏掉；而且只在 updateHud 被调用时才刷新，
 * 光移动鼠标根本不触发 —— 所谓"实时"其实是陈旧的。
 *
 * 选中图案时显示的是**幽灵的锚点**（左上角），不是光标格 —— 放置对齐的是锚点。
 */
app.updateHoverReadout = function () {
  const c = app.stampAnchor() || app.hoverCell
  hud.cell.textContent = c ? `${c.x}, ${c.y}` : '–'
}

app.updateHud = function () {
  const s = app.engine.stats
  hud.gen.textContent = app.engine.generation
  hud.alive.textContent = s.alive
  hud.gps.textContent = app.running ? app.gps.toFixed(0) : '0'
  hud.fps.textContent = app.running ? app.fps.toFixed(0) : '–'
  app.updateHoverReadout()
  hud.scale.textContent = `${t('hud.zoom')} ${app.viewport.scale.toFixed(1)}×`

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
app.records = setupRecords(app)
app.io = setupIO(app)
app.library = setupLibrary(app)
app.library.render()
app.intro = createIntro(app)
// 点「?」总是带上第零幕，老用户也能在这里重选版本
document.getElementById('btn-help').addEventListener('click', () => app.intro.open({ chooser: true }))
app.tower = createTowerView(app)
app.explorer = createExplorerView(app)

/**
 * 观塔与勘探都是整屏接管的独立视图，同一时刻只能开一个 ——
 * 两个都开会叠在一起，谁在上面取决于 DOM 顺序，用户完全无从预料。
 */
app.openView = function (name) {
  if (name !== 'tower') app.tower.hide()
  if (name !== 'explorer') app.explorer.hide()
  if (name === 'tower') app.tower.show()
  if (name === 'explorer') app.explorer.show()
  // 窄屏下抽屉把手和「更多」浮层是常驻的，全屏视图打开时得让开，否则会压在上面
  document.body.classList.toggle('view-open', name === 'tower' || name === 'explorer')
  if (name === 'tower' || name === 'explorer') { document.body.classList.remove('more-open', 'drawer-open') }
}
document.getElementById('btn-tower').addEventListener('click', () => app.openView('tower'))
document.getElementById('btn-explorer').addEventListener('click', () => app.openView('explorer'))
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
// 恢复语言偏好时 setLang 会触发监听器，但下面那个 onLangChange 还没注册上，
// 所以这里必须再刷一次动态文字（HUD 的世界名就是这么变成中英混排的）
app.updateRuleInfo()

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
  app.records.relocalize()
  app.tower.relocalize()
  app.explorer.relocalize()
  app.refreshTabHint()
})
function trailLabelOf(v) {
  return t(v <= 6 ? 'vis.trail.short' : v <= 13 ? 'vis.trail.mid' : 'vis.trail.long')
}

// 开局状态：首访给"导演场"，回访给"空场"（依据见 docs/decisions.md D69）。
// 回访者的实际动作是"先清空再开始" —— 那说明满盘随机不是他要的开场，
// 是他每次都要先撤掉的东西。
const firstVisit = prefs.get('introSeen') !== '1'
if (firstVisit) app.engine.randomize(4271, app.density)
app.visual.sync(app.engine)
app.series.push(app.engine.stats.alive)
app.records.startRun()
// 不预填种子框：规格里"留空则随机生成种子并显示"意味着空 = 换一张新盘。
// 预填的话第一次点「随机填充」会用同一个种子重放出一模一样的棋盘，看上去就像按钮没反应。
// 开机这局的种子在编年史的「开局」一条里有记录，不会丢。
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
      let done = 0
      for (let i = 0; i < n; i++) { done++; if (app.tick()) break }
      app.recordStepCost(performance.now() - t0, done)
      app.gensInWindow += done
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
    // 方向键微调后幽灵脱离鼠标跟随（app.stampAt 非空即钉住）
    const gc = app.stampAt || app.hoverCell
    const gp = app.stampPattern()
    if (gp && gc) {
      const o = centerOrigin(gp, gc.x, gc.y)
      app.renderer.drawGhost(app.viewport, gp, o.x, o.y, app.engine.w, app.engine.h)
    }
    if (app.selection) app.renderer.drawSelection(app.viewport, app.selection)
    app.dirty = false
    app.updateHud()
  }

  // 折线图按代数变化重绘，最多每 100ms 一次
  if (app.engine.generation !== app.chartGen && now - (app.chartAt || 0) >= 100) {
    app.chart.draw(app.series, app.renderer.flat)
    app.chartGen = app.engine.generation
    app.chartAt = now
  }
  // 记录面板变动频繁但没人盯着看，压到每 250ms 一次
  if (app.records.needsPanel && now - (app.recAt || 0) >= 250) {
    app.records.renderPanel()
    app.recAt = now
  }

  requestAnimationFrame(frame)
}
app.chart.draw(app.series, app.renderer.flat)
requestAnimationFrame(frame)

// 首次进入自动弹出介绍卡。规格修订后（D30）"看过了"会记在 localStorage 里，
// 所以刷新页面不会再弹；存储不可用时（隐私模式）退化成每次打开都弹一次，不影响使用。
// 首次进入自动弹介绍卡。只有**没存过模式偏好**的新用户才先问"儿童版还是标准版"；
// 老用户已经选过了，不该再被问一遍。
if (prefs.get('introSeen') !== '1') {
  const savedMode = prefs.get('mode')
  app.intro.open({ chooser: savedMode !== 'simple' && savedMode !== 'full' })
}

// 便于在浏览器控制台里做手工验证
window.__lab = app

// 访问统计：只有配了 VITE_GOATCOUNTER 的正式构建才会真的加载（见 src/analytics.js）
setupAnalytics()
