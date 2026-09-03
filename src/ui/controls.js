// 侧栏控件绑定。所有控件只调用 app 上的方法或改 app 的视觉开关，不直接碰引擎内部。
import { normalizeSeed, randomSeed } from '../engine/prng.js'
import { isTyping } from './input.js'
import { t, setLang, getLang } from '../i18n/index.js'
import { prefs } from './prefs.js'
import { attachNumericEntry, NUMERIC_SLIDERS, CODEC_SLIDERS } from './numeric-entry.js'
import { isBigBoard, costOf } from '../data/board-sizes.js'
import { resizePlan, cellBounds } from '../data/session.js'
import { onTap } from './tap.js'

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
    undo: $('btn-undo'), draw: $('btn-draw'),
    lblSpeed: $('lbl-speed'), lblDensity: $('lbl-density'),
    lblNotation: $('lbl-notation'), lblFingerprint: $('lbl-fingerprint'),
    age: $('in-age'), glow: $('in-glow'),
    glowFrames: $('in-glow-frames'), lblGlow: $('lbl-glow'),
    trails: $('in-trails'), trailLen: $('in-trail-len'), lblTrail: $('lbl-trail'),
    motionRay: $('in-motion-ray')
  }
  app.el = el

  el.play.addEventListener('click', () => app.setRunning(!app.running))
  el.step.addEventListener('click', () => { app.setRunning(false); app.stepOnce() })
  el.clear.addEventListener('click', () => app.clear())
  // 撤销只有这一个入口（D116：临时条已撤销 —— 它压在画布上，挡视线也挡操作）
  el.undo.addEventListener('click', () => app.undo())

  /**
   * **手指画笔开关**（D123）。
   *
   * 只管**触屏**那条路：鼠标那条一个字没动 —— 桌面本来就有"移过去不算按下"这个中间态，
   * 手指没有。所以这不是"两端两套心智模型"，是**同一个模型**（按下去才画）
   * 在一个缺了中间态的设备上补回那个中间态。
   *
   * **记住它**（作者定）：它属于"看的人自己的偏好"那一档，与色带、语言同族，
   * 不是这一局的一部分 —— 所以进 prefs，不进 captureSession。
   */
  app.drawOn = prefs.get('touchDraw', '0') === '1'
  app.setDrawOn = function (on) {
    app.drawOn = !!on
    // 开画笔与手上举着图案是**互斥的意图**（D126）：点开画笔就是"我要一点一点画"，
    // 那一刻还举着上一个图案，下一次点棋盘就又放了它 —— 正是作者报的那个"黏住"。
    if (app.drawOn && app.stamp) app.setStamp(null)
    prefs.set('touchDraw', app.drawOn ? '1' : '0')
    el.draw.setAttribute('aria-pressed', app.drawOn ? 'true' : 'false')
    app.toast(t(app.drawOn ? 'draw.on' : 'draw.off'))
  }
  el.draw.setAttribute('aria-pressed', app.drawOn ? 'true' : 'false')
  // 浮在画布上、又贴着屏幕边 —— 按「抬手」算点击，别等浏览器合成 click（D128）
  onTap(el.draw, () => app.setDrawOn(!app.drawOn))

  // 刷新的实现在 main.js（`app.refreshUndo` 那一处）——
  // 压栈发生在启动段，那时 setupControls 还没跑，实现放这儿就得先垫一个空函数，
  // 那又是"同一件事两份实现"。这里只接线。
  app.refreshUndo()
  el.fit.addEventListener('click', () => app.fitView())
  // 窄屏那两颗复本走同一个动作，不另写逻辑
  $('btn-fit-m').addEventListener('click', () => app.fitView())
  $('btn-step-m').addEventListener('click', () => { app.setRunning(false); app.stepOnce() })
  el.random.addEventListener('click', () => app.randomize())

  el.speed.addEventListener('input', () => {
    app.speed = Number(el.speed.value)
    el.lblSpeed.textContent = app.speed
    // 你自己动了手：**只把这一项的还原目标改成你刚选的**，别的照旧还给你（D105）。
    // 原先是整份快照丢掉 —— 那样你只改了速度，边界也跟着不还了。
    if (app.showEnv) app.showEnv.speed = app.speed
  })

  el.density.addEventListener('input', () => {
    app.density = Number(el.density.value)
    el.lblDensity.textContent = app.density.toFixed(2)
  })

  el.boundary = setupBtnGroup('in-boundary', app.engine.boundary, v => {
    app.engine.setBoundary(v)
    if (app.showEnv) app.showEnv.boundary = v   // 同上：只改这一项的还原目标（D105）
    app.toast(t(v === 'torus' ? 'toast.boundaryTorus' : 'toast.boundaryDead'))
  })

  /**
   * 从代码里换边界（D103）：复现某些局要跟着换（整台机器要死边界）。
   * **按钮组也要跟着变** —— 引擎换了而按钮还停在原处，就又是两份状态了。
   * 用户自己点按钮那条路照旧，这里只是另一个入口，最终都落到同一处。
   */
  /**
   * 从代码里改速度（D104）：Show 自带的建议速度、以及退出时还原用户原速度都走它。
   * **滑块与数字跟着变** —— 又是那条老规矩：一个量只许有一个来源。
   */
  app.setSpeed = function (v) {
    const n = Math.max(1, Math.min(60, Math.round(v)))
    if (app.speed === n) return
    app.speed = n
    el.speed.value = String(n)
    el.lblSpeed.textContent = String(n)
  }

  app.setBoundary = function (v) {
    if (app.engine.boundary === v) return
    app.engine.setBoundary(v)
    el.boundary.set(v)
    app.dirty = true
  }

  el.size = setupBtnGroup('in-size', String(app.engine.w), v => {
    const n = Number(v)
    // 改尺寸会把盘上的东西**搬**过去（D110 §10）。变大一定装得下；
    // 变小则可能有活格子掉在外面 —— 那是"会毁掉用户劳动"的一步，必须先问（D93）。
    // 问在这儿、不在 resizeBoard 里：那个函数还被换局/收链接调用，那些路不该弹框。
    const e = app.engine
    const plan = e.stats.alive > 0
      ? resizePlan({ w: e.w, h: e.h }, { w: n, h: n }, cellBounds(e.cur, e.w, e.h), e.cur)
      : { lost: false }
    if (!plan.lost) { app.resizeBoard(n, n, { plan }); return }
    // 数字与动作**同一个 plan**（D110 §12）：说"会裁掉 {n} 个"，
    // 裁的就是这个 plan 的偏移裁出来的那一批 —— 不是另算一遍的估计值
    app.confirmAction({
      title: t('size.shrink.title'),
      body: t('size.shrink.body', { w: n, n: plan.lostCount }),
      yes: t('size.shrink.yes')
    }, () => app.resizeBoard(n, n, { plan }))
    el.size.set(String(e.w))     // 先把按钮弹回去；用户点了「继续」再跟着变
  })



  /**
   * 大盘下把三个视觉开关置灰，并说明为什么（D94）。
   * **不动用户的设置** —— 只是让它们在这一档上不生效，换回小盘原样恢复。
   * 置灰而不是隐藏：隐藏会让人以为这个功能没了。
   */
  const bigNote = document.getElementById('big-board-note')
  app.syncBigBoard = function () {
    const n = app.engine.w
    const big = isBigBoard(n)
    for (const box of [el.age, el.glow, el.trails]) {
      box.disabled = big
      const field = box.closest('.check')
      if (field) field.classList.toggle('disabled', big)
    }
    bigNote.hidden = !big
    if (big) {
      // **先用这台机器量出来的**（D110 §16）。用别人机器的数字加一句免责声明，
      // 是缓解不是解法 —— 而本机标定的东西本来就在手上（app.measuredStepMs）。
      // 还没跑过才退回 board-sizes 那张桌面实测表，并且那时明说它是**预告**。
      const live = app.measuredStepMs ? app.measuredStepMs() : null
      // 报的是**这一档实际会跑出来的**成本：视觉层已经关了，就别把它算进去
      const cost = live !== null ? live : costOf(n, false)
      bigNote.textContent = t(live !== null ? 'board.bigNoteMeasured' : 'board.bigNote', {
        n, ms: cost ? cost.toFixed(0) : '?', gps: cost ? (1000 / cost).toFixed(0) : '?'
      })
    }
    app.dirty = true
  }
  app.syncBigBoard()

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
  // 动向线（D88 ②）：默认开着，关掉的话连量都不量
  el.motionRay.checked = prefs.get('motionRay', '1') !== '0'
  app.visualOpts.motionRay = el.motionRay.checked
  el.motionRay.addEventListener('change', () => {
    app.visualOpts.motionRay = el.motionRay.checked
    prefs.set('motionRay', el.motionRay.checked ? '1' : '0')
    app.dirty = true
  })
  el.lblTrail.textContent = trailLabel(Number(el.trailLen.value))
  el.lblGlow.textContent = el.glowFrames.value
  app.renderer.setGlowFrames(Number(el.glowFrames.value))
  el.glowFrames.parentElement.classList.toggle('disabled', !el.glow.checked)
  el.trailLen.parentElement.classList.toggle('disabled', !el.trails.checked)

  /* ---------- 图案朝向按钮（窄屏；桌面走 R / F 键） ---------- */
  $('btn-rotate').addEventListener('click', () => app.rotateStamp(1))
  $('btn-flip').addEventListener('click', () => app.flipStamp())
  $('btn-drop').addEventListener('click', () => app.confirmStamp())   // 两步放置的第二步（D89 ①）

  /* ---------- 滑块数值直接输入（点数字变输入框） ---------- */
  // 登记表里的滑块一次接完，包括观塔与勘探视图里的 —— 它们的元素在开机时就在 DOM 里。
  // 唯独缩放滑条例外：它的滑块单位（对数档位）与用户读写的量（几倍）不是一回事，
  // 要带一层换算，由 zoom-bar.js 自己接（D84 ③）。接两遍会插出两个输入框。
  for (const [rangeId, labelId] of NUMERIC_SLIDERS) {
    if (Object.values(CODEC_SLIDERS).includes(rangeId)) continue
    attachNumericEntry($(rangeId), $(labelId), { ariaLabel: rangeId })
  }

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
  const show = $('show-strip')
  const showHint = $('show-hint')
  const tabs = [...document.querySelectorAll('.tb-tabs .tab')]

  // 页签名 → 它管的那块取用区。三个页签共用一套开合逻辑，别再各写各的
  const PICKERS = { pattern: rail, world: strip, show: show }

  function syncTabs() {
    tabs.forEach(b => {
      const el = PICKERS[b.dataset.tab]
      b.classList.toggle('on', !!el && !el.hidden)
    })
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

  /** 顶部精彩局横条。与世界横条占同一条边，所以两者永不同时开 */
  app.setShows = function (open) {
    show.hidden = !open
    syncTabs()
    app.handleResize()
  }

  // 窄屏断点。与 style.css 里的 max-width:767px 是同一个数 ——
  // 这是 JS 与 CSS 之间唯一的耦合点，所以只写一处、写明白。
  const NARROW = window.matchMedia('(max-width: 767px)')

  /**
   * 窄屏放大上限（D77 ①）。桌面 40 设备像素/格，在手机上按 dpr 2 折算只有 20 CSS 像素，
   * 一个格子还没指尖大，画细节时凑不近。窄屏抬到 120（60 CSS 像素/格），
   * 一格比 44px 的触控下限还宽一截，点得准也看得清。
   * 值写在 UI 层而不是改 viewport 的默认 —— 这是"手机上要多近"的界面策略，
   * 不是渲染器的固有属性，render 目录因此保持零改动。
   */
  const NARROW_MAX_SCALE = 120
  const DESKTOP_MAX_SCALE = app.viewport.maxScale
  const applyZoomLimit = () => {
    app.viewport.maxScale = NARROW.matches ? NARROW_MAX_SCALE : DESKTOP_MAX_SCALE
  }
  applyZoomLimit()
  NARROW.addEventListener('change', applyZoomLimit)

  /**
   * 取用区选择（D75 ③）：窄屏下图案与世界共用第 5 行那一个位置，
   * 互斥且恒有其一 —— 切换只换内容，不换位置也不换形态。
   */
  app.setPicker = function (name) {
    app.setRail(name === 'pattern')
    app.setWorlds(name === 'world')
    app.setShows(name === 'show')
  }

  app.toggleTab = function (name) {
    if (NARROW.matches) {
      // 窄屏：点已选中的那个不关闭（关了那一行就空着，位置反而不恒定了）
      app.setPicker(name)
      return
    }
    // 桌面照旧：图案在左缘，与顶部横条占不同的边，可以同时开着；
    // 世界与精彩局都是顶部横条，占同一条边，开一个就关掉另一个
    if (name === 'pattern') { app.setRail(rail.hidden); return }
    if (name === 'world') { const open = strip.hidden; app.setShows(false); app.setWorlds(open); return }
    const open = show.hidden
    app.setWorlds(false)
    app.setShows(open)
  }

  app.refreshTabHint = function () {
    railHint.textContent = t('pattern.hint')
    stripHint.textContent = t('world.hint')
    // 精彩局那行提示有两种内容（通用提示 / 选中那一局的完整说明，D95 ①），
    // 所以**写入者只能有一个** —— 交给收藏那边，这里只在它还没建好时兜个底
    if (app.syncShowHint) app.syncShowHint()
    else showHint.textContent = t('fav.showHint')
  }
  app.refreshTabHint()
  tabs.forEach(b => b.addEventListener('click', () => app.toggleTab(b.dataset.tab)))

  // 窄屏开机默认展示图案；转屏进出窄屏时重新落位，免得留下一个空行或两个都开着
  const applyNarrow = () => { if (NARROW.matches) app.setPicker('pattern') }
  applyNarrow()
  NARROW.addEventListener('change', applyNarrow)

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
    // R 和 F 在"选中图案"时归图案所有（旋转 / 镜像，Golly 惯例），
    // 否则才是全局的随机填充 / 适配视图。
    // 不加这一条的话，按 R 转朝向会顺手把整盘随机填充掉 —— 实测踩到过。
    if (app.stamp && (k === 'r' || k === 'f')) return
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
