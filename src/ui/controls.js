// 侧栏控件绑定。所有控件只调用 app 上的方法或改 app 的视觉开关，不直接碰引擎内部。
import { normalizeSeed, randomSeed } from '../engine/prng.js'
import { isTyping } from './input.js'
import { t, setLang, getLang } from '../i18n/index.js'
import { prefs } from './prefs.js'

const $ = id => document.getElementById(id)

/**
 * 按钮组：取代选项少的 select（见 docs/decisions.md D33）。
 * 对外暴露 .value 与 .set(v)，调用处写法与原来的 el.xxx.value 基本一致。
 */
function setupBtnGroup(id, initial, onChange) {
  const root = $(id)
  const sync = v => root.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.val === v))
  let value = initial
  sync(value)
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-val]')
    if (!b || b.dataset.val === value) return
    value = b.dataset.val
    sync(value)
    onChange(value)
  })
  return {
    get value() { return value },
    set(v) { value = v; sync(v) }
  }
}

/** 拖尾滑块（1–20）→ 每帧叠加的底色不透明度。越小残留越久。 */
export function trailAlphaOf(v) { return 0.45 * Math.pow(0.85, v - 1) }
function trailLabel(v) { return t(v <= 6 ? 'vis.trail.short' : v <= 13 ? 'vis.trail.mid' : 'vis.trail.long') }

export function setupControls(app) {
  const el = {
    play: $('btn-play'), step: $('btn-step'), random: $('btn-random'), clear: $('btn-clear'),
    fit: $('btn-fit'), speed: $('in-speed'), density: $('in-density'), seed: $('in-seed'),
    lblSpeed: $('lbl-speed'), lblDensity: $('lbl-density'),
    lblNotation: $('lbl-notation'), lblFingerprint: $('lbl-fingerprint'),
    age: $('in-age'), glow: $('in-glow'),
    glowFrames: $('in-glow-frames'), lblGlow: $('lbl-glow'),
    trails: $('in-trails'), trailLen: $('in-trail-len'), lblTrail: $('lbl-trail')
  }
  app.el = el

  el.play.addEventListener('click', () => app.setRunning(!app.running))
  el.step.addEventListener('click', () => { app.setRunning(false); app.stepOnce() })
  el.clear.addEventListener('click', () => app.clear())
  el.fit.addEventListener('click', () => app.fitView())
  // 窄屏那两颗复本走同一个动作，不另写逻辑
  $('btn-fit-m').addEventListener('click', () => app.fitView())
  $('btn-step-m').addEventListener('click', () => { app.setRunning(false); app.stepOnce() })
  el.random.addEventListener('click', () => app.randomize())

  el.speed.addEventListener('input', () => {
    app.speed = Number(el.speed.value)
    el.lblSpeed.textContent = app.speed
  })

  el.density.addEventListener('input', () => {
    app.density = Number(el.density.value)
    el.lblDensity.textContent = app.density.toFixed(2)
  })

  el.boundary = setupBtnGroup('in-boundary', app.engine.boundary, v => {
    app.engine.setBoundary(v)
    app.toast(t(v === 'torus' ? 'toast.boundaryTorus' : 'toast.boundaryDead'))
  })

  el.size = setupBtnGroup('in-size', String(app.engine.w), v => {
    const n = Number(v)
    app.resizeBoard(n, n)
  })

  /* ---------- 视觉效果（全部只影响渲染层） ---------- */

  el.palette = setupBtnGroup('in-palette', app.renderer.paletteKey, v => {
    app.renderer.setPalette(v)
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
  app.renderer.setGlowFrames(Number(el.glowFrames.value))
  el.glowFrames.parentElement.classList.toggle('disabled', !el.glow.checked)
  el.trailLen.parentElement.classList.toggle('disabled', !el.trails.checked)

  /* ---------- 右栏分组折叠 ---------- */

  document.querySelectorAll('.panel .group-head').forEach(h => {
    h.addEventListener('click', () => h.parentElement.classList.toggle('collapsed'))
  })

  /* ---------- 顶栏「图案 / 世界」标签 ---------- */

  // 图案走左缘竖排工具条，世界走顶部横条 —— 占的是不同的边，可以同时开着
  const rail = $('tool-rail')
  const railHint = $('rail-hint')
  const strip = $('card-strip')
  const stripHint = $('strip-hint')
  const tabs = [...document.querySelectorAll('.tb-tabs .tab')]

  function syncTabs() {
    tabs.forEach(b => b.classList.toggle('on',
      b.dataset.tab === 'pattern' ? !rail.hidden : !strip.hidden))
  }

  /** 左缘工具条：展开会让画布变窄，而不是盖在画布上 */
  app.setRail = function (open) {
    rail.hidden = !open
    syncTabs()
    app.handleResize()
  }

  /** 顶部世界横条 */
  app.setWorlds = function (open) {
    strip.hidden = !open
    syncTabs()
    app.handleResize()
  }

  app.toggleTab = function (name) {
    if (name === 'pattern') app.setRail(rail.hidden)
    else app.setWorlds(strip.hidden)
  }

  app.refreshTabHint = function () {
    railHint.textContent = t('pattern.hint')
    stripHint.textContent = t('world.hint')
  }
  app.refreshTabHint()
  tabs.forEach(b => b.addEventListener('click', () => app.toggleTab(b.dataset.tab)))

  /* ---------- 窄屏：「更多」浮层与底部抽屉（D66） ---------- */

  // 两个按钮在桌面是 display:none，点不到，所以这里不需要判断屏宽。
  const moreBtn = $('btn-more')
  const drawerHandle = $('drawer-handle')

  app.setMore = function (open) {
    document.body.classList.toggle('more-open', open)
  }
  app.setDrawer = function (open) {
    document.body.classList.toggle('drawer-open', open)
  }

  moreBtn.addEventListener('click', () => app.setMore(!document.body.classList.contains('more-open')))
  drawerHandle.addEventListener('click', () => app.setDrawer(!document.body.classList.contains('drawer-open')))

  // 点「更多」里的任何一个按钮就收起浮层 —— 那些控件都是一次性的，
  // 点完还杵在那儿盖着棋盘，用户得再点一次才能看见效果
  for (const seg of ['tb-tabs', 'tb-right']) {   // 清空已挪出「更多」，不在此列
    const el = document.querySelector('.' + seg)
    if (el) el.addEventListener('click', e => { if (e.target.closest('button')) app.setMore(false) })
  }

  // 点棋盘就把两个浮层都收掉
  app.canvas.addEventListener('pointerdown', () => { app.setMore(false); app.setDrawer(false) })

  // 转屏后重新适配视图：横竖屏的可视区差得远，保中心点会让棋盘跑出画面
  window.addEventListener('orientationchange', () => {
    setTimeout(() => { app.handleResize(); app.fitView() }, 250)
  })

  /* ---------- 语言与模式开关 ---------- */

  const langSwitch = $('lang-switch')
  const modeSwitch = $('mode-switch')

  /** 把两个开关的高亮同步到当前状态（开机恢复偏好后也要调一次） */
  app.syncSwitches = function () {
    langSwitch.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.lang === getLang()))
    modeSwitch.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.modeVal === app.mode))
  }

  langSwitch.addEventListener('click', e => {
    const b = e.target.closest('[data-lang]')
    if (!b) return
    setLang(b.dataset.lang)
    prefs.set('lang', getLang())     // 用户明确表达的偏好才落盘
    app.syncSwitches()
  })

  modeSwitch.addEventListener('click', e => {
    const b = e.target.closest('[data-mode-val]')
    if (!b) return
    app.setMode(b.dataset.modeVal)
    prefs.set('mode', app.mode)
    app.syncSwitches()
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
