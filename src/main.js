// 应用装配与主循环。
// 节拍解耦：引擎与视觉状态按代推进（每代必录），渲染每帧最多一次（高速时自然跳帧）。
import { LifeEngine } from './engine/board.js'
import { lifeRule, compileNotation } from './engine/rules.js'
import { createFavorites } from './ui/favorites-view.js'
import { createConfirm } from './ui/confirm.js'
import { visualFor, isBigBoard } from './data/board-sizes.js'
import { encodeShare, decodeShare, shareVerdict } from './data/share.js'
import { resolveInitialBoard } from './data/startup.js'
import { resizePlan, captureSession, pasteCells, cellBounds } from './data/session.js'
import { createShow } from './ui/show.js'
import { Viewport } from './render/viewport.js'
import { Renderer } from './render/renderer.js'
import { VisualState } from './render/visual-state.js'
import { Chart } from './render/chart.js'
import { RingSeries } from './data/series.js'
import { setupControls, readSeedInput } from './ui/controls.js'
import { setupCanvasInput } from './ui/input.js'
import { setupZoomBar, zoomLabel } from './ui/zoom-bar.js'
import { watchPageZoom } from './ui/page-zoom.js'
import { orientToastKey, orientLabel, shouldShowStampTip } from './ui/stamp-hint.js'
import { motionCached, rayEnds, entryEnds, exitEnds, landingDots, refFromPlacement } from './engine/motion.js'
import { placeSelectionMenu } from './ui/io.js'
import { createRuleEditor } from './ui/rule-editor.js'
import { setupLibrary } from './ui/library.js'
import { createIntro } from './ui/intro.js'
import { createMinimap } from './ui/minimap.js'
import { setupRecords } from './ui/records.js'
import { setupIO } from './ui/io.js'
import { createTowerView } from './ui/tower-view.js'
import { createExplorerView } from './ui/explorer-view.js'
import { createCriticalView } from './ui/critical-view.js'
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
  pendingView: null,      // 画布还没尺寸时欠着的取景意图（D110 §3）
  viewIntent: null,       // 用户最后一次自己决定的取景 { cx, cy, span, scale }（D110 §7）
  viewDerived: null,      // resize 上次把视口派生成什么样，用来认出"中间有人动过"
  chartGen: -1,
  mode: 'full',       // 'simple' | 'full'
  stamp: null,        // 当前选中的图案（跟随鼠标待放置）
  stampOrient: { rot: 0, flip: false },   // 当前图案的朝向（D81）
  /**
   * **待放态的唯一状态源**（D90 §4）：钉住的落点，或 null。
   * 幽灵画不画、动向线画不画、「放这」出不出现，三样全看它 ——
   * 上一版幽灵看 `stampAt`、按钮看 `pending`，两个源就有"清了一半"的那天（真机撞上了）。
   */
  pendingStamp: null,
  refRay: null,                          // 最近一次落子留下的参照线（D91）
  refSeq: 0,                             // 参照线的序号：挡住在途的旧量测回调
  runDirty: false,    // 本局是否被手动改过 ⇒ 存档不能再靠种子重放
  baseline: null,     // 手改之后的重放基线 {rle, gen}
  selectArmed: false, // 侧栏按钮预备的一次性框选（Shift+拖则随时可用）
  selection: null     // {x0,y0,w,h}，拖动过程中的选框
}

/* ---------------- 行为 ---------------- */

/** 推进一代：引擎 → 视觉状态 → 数据记录，三者严格同拍 */
/** 推进一代：引擎 → 视觉状态 → 数据记录，三者严格同拍。返回终止信息（没终止则为 null） */
/**
 * 当前这一档盘实际生效的视觉选项（D94）。大盘上年龄/余晖/拖尾一律不生效 ——
 * 它们那一层每代要把整盘再扫一遍，2048² 实测 15.5ms/代，占那一档四成开销。
 * **用户的设置不改**，只是在大盘上不起作用；换回小盘原样恢复。
 */
app.visualNow = function () { return visualFor(app.visualOpts, app.engine.w) }

app.tick = function () {
  const s = app.engine.step()
  app.visual.advance(app.engine, app.visualNow().glow ? app.renderer.glowFrames : 0)
  app.series.push(s.alive)
  return app.records ? app.records.onGeneration(s) : null
}

app.setRunning = function (on) {
  // **空盘不开跑**（D92 ①）：0 格的棋盘跑一代必然全灭，于是会弹一张"第 1 代 / 峰值 0 / 剩 0"
  // 的总结卡片，还往实验台账里落一条 —— 那不是一局，那是一次误触。
  // 从根上不启动，比"跑起来再想办法不记账"干净：终止检测与记账都不必知道有这么个特例。
  if (on && app.engine.stats.alive === 0) {
    app.toast(t('toast.emptyBoard'))
    return
  }
  // 一开跑，"我刚才把它对着哪儿放的"就成了旧闻：棋盘已经不是那一刻的棋盘了（D91）。
  // 待放态也一并退场：手上举着的那个幽灵，等棋盘跑起来之后已经对不上任何东西了（D90 §4）。
  if (on) app.cancelPending()
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
  if (app.zoomBar) app.zoomBar.onRunning()    // 播放中才淡出；暂停时永远留着（D84 ②）
  app.updateHud()
}

app.stepOnce = function () {
  // 空盘单步同理：一步之后仍是空盘，却会被判成"全灭"而落一条台账（D92 ①）
  if (app.engine.stats.alive === 0) {
    app.toast(t('toast.emptyBoard'))
    return
  }
  // 单步也让棋盘往前走了一格：手上那个幽灵与刚才那条参照线都对不上新盘了（D90 §4）
  app.cancelPending()
  const t0 = performance.now()
  app.tick()
  app.recordStepCost(performance.now() - t0, 1)
  app.dirty = true
  app.updateHud()
}

/**
 * Show 自带环境（D104）。每一局都声明自己该在什么盘、什么边界、多快跑 ——
 * **点开时切过去，退出时把用户原来的设置还回去**。
 *
 * 为什么要有这一层：这些局的生平都是在各自的环境里量出来的。
 * 繁殖者的数是 2048² 死边界上的数；把它放到 200 环形盘上，量到的是另一回事，
 * 而用户看到的却是同一张卡片上的同一行字 —— 那行字就成了假话。
 *
 * "退出"的定义与 D90 §4 那张退出表同一个思路：**清空、读档、换局**。
 * 换局时不改已经存下的那份 —— 存的是**用户自己的**设置，不是上一局的。
 */
app.showEnv = null

app.enterShowEnv = function (entry) {
  if (!entry) return
  if (!app.showEnv) {
    app.showEnv = { board: app.engine.w, boundary: app.engine.boundary, speed: app.speed }
  }
  if (entry.boundary) app.setBoundary(entry.boundary)
  if (entry.speed) app.setSpeed(entry.speed)
}

app.exitShowEnv = function () {
  const env = app.showEnv
  if (!env) return
  app.showEnv = null
  if (app.engine.boundary !== env.boundary) app.setBoundary(env.boundary)
  if (app.speed !== env.speed) app.setSpeed(env.speed)
  // 盘尺寸不在这里还原：换回去要重建整块棋盘，而用户此刻多半正想在这个盘上接着玩。
  // 尺寸按钮就在旁边，一眼看得见、一点就回去 —— 边界与速度不一样，它们藏在设置里，
  // 悄悄留着才是坑。
}

/**
 * **启动闸**（D110 §13）：意图解析完之前，谁都不许写盘。
 *
 * 现在"链接在任何人写盘之前就参与裁决"靠的是**解码是同步的** —— 这条同步性
 * 是启动正确性的地基，而它是隐式的：谁都没保证它，它只是碰巧成立。
 * 压缩（`pz=`）一落地，`decodeShare` 变异步，这条地基就自己没了，而且**没人会红**。
 *
 * 闸把它变成显式的：写盘的入口先问一句"闸开了没"。开闸的只有 `applyInitialBoard`。
 * 有闸就不在乎解码同步还是异步 —— 异步只是把开闸的时刻推后一点。
 * 看展也踩在同一块地基上（"有链接就不启动"靠的正是此刻已经知道有没有链接）。
 */
app.bootLocked = true

app.unlockBoard = function () { app.bootLocked = false }

/** 写盘之前问一句。闸没开就是**代码顺序错了**，不是用户干的 —— 所以抛，不是提示 */
app.assertBoardUnlocked = function (who) {
  if (app.bootLocked) {
    throw new Error(`启动意图还没裁决完，${who} 不许写盘（D110 §13）`)
  }
  // 看展期间用户自己动了手：**先把他那一局还回来**，他的动作再落在自己的局上（D110 §14）。
  // 直接接管的话，他进看展之前摆的东西就没了 —— 那正是这条规矩要防的。
  if (app.show && app.show.isOn() && !app.show.isLoading()) app.show.yieldToUser()
}

app.clear = function (opts = {}) {
  app.assertBoardUnlocked('clear')
  app.setRunning(false)
  if (!opts.keepShowEnv) app.exitShowEnv()   // 清空 = 退出这一局（D104）
  app.cancelPending()               // 待放态整体退场，参照线一并清（D90 §4）
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
  app.assertBoardUnlocked('randomize')
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
/** 按 B/S 记法切规则（收藏「复现」时按 RLE 头行调用） */
app.applyNotation = function (notation) {
  if (!notation) return false
  if (app.engine.rule.notation === notation) return true    // 已经是这个规则就别白折腾
  try {
    app.applyRule(compileNotation(notation))
    return true
  } catch (e) {
    app.toast(t('fav.err.badRule', { rule: notation }))
    return false
  }
}

/** 展开某个控件所在的侧栏分组并滚到它（收藏「填入 RLE」之后要让用户看得见） */
app.openPanelGroupOf = function (node) {
  const g = node && node.closest ? node.closest('.group') : null
  if (!g) return
  g.classList.remove('collapsed')
  if (g.scrollIntoView) g.scrollIntoView({ block: 'nearest' })
}

app.applyRule = function (rule, message) {
  // 换世界 = 换了规则，这一盘已经是另一盘：待放态整体退场，参照线一并清（D90 §4）
  app.cancelPending()
  app.engine.setRule(rule)
  app.renderer.setAgingLayers(rule.agingLayers)
  app.visual.sync(app.engine)   // 被清掉的衰老细胞不该留下年龄或残影
  app.records.startRun()        // 换了规则就是另一局，之前攒的哈希不再适用
  app.updateRuleInfo()
  if (app.library) app.library.renderWorlds()
  // 换了世界，精彩局卡片上的「换世界」小标也跟着变 —— 那个标说的是
  // "这一张与当前世界的关系"，关系变了标就得重算，否则它说的是上一刻的事
  if (app.favorites) app.favorites.renderShow()
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

app.resizeBoard = function (w, h, opts = {}) {
  app.assertBoardUnlocked('resizeBoard')
  app.setRunning(false)
  // **旧内容要搬过去**（D110 §10）。手机上那个 bug 就是这里：200→300 是变大，
  // 装不下的可能性为零，格子却全没了 —— `engine.resize` 重新分配数组，旧的一扔了之。
  // 用户摆的东西不许被静默清掉（D82 的老原则），改尺寸只是换了个更大的场地。
  const carry = opts.carry !== false && app.engine.stats.alive > 0
  const snap = carry ? captureSession(app.engine) : null
  app.engine.resize(w, h)
  if (snap) {
    // **问的那句话与做的这件事，同一个 plan**（D110 §12）。
    // 按钮那边算过一次（为了问"会裁掉几个"），就把那一个传进来，这里不重算 ——
    // 重算就是两处各算一遍，那正是"说会丢一点、做出来全丢"的来源。
    const plan = opts.plan || resizePlan({ w: snap.w, h: snap.h }, { w, h },
      cellBounds(snap.cells, snap.w, snap.h), snap.cells)
    // 居中搬：变大时视觉上"四周长出来"，用户摆的东西留在原处
    pasteCells(snap.cells, { w: snap.w, h: snap.h }, app.engine.cur, { w, h }, plan.offsetX, plan.offsetY)
    app.engine.generation = snap.generation
    app.engine.stats.alive = app.engine.countAlive()
    app.engine.initType = 'pattern'
  }
  app.visual.sync(app.engine)
  app.runDirty = !!snap          // 搬过内容的局面，种子重放不出来了
  app.baseline = null
  app.series.clear()
  app.records.startRun()
  app.fitView()
  app.updateHud()
  if (app.syncBigBoard) app.syncBigBoard()
  if (app.el && app.el.size && app.el.size.set) app.el.size.set(String(w))   // 按钮组跟着变
  // 复现一局时换盘是"这一步的一部分"，那一刻会另有一句话说明整件事，别抢在它前面
  if (!opts.silent) app.toast(isBigBoard(w) ? t('toast.resizedBig', { w, h }) : t('toast.resized', { w, h }))
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
  const gc = app.pendingStamp || app.hoverCell
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

/**
 * 旋转 / 镜像当前图案（D81）。改的是朝向状态，不改原始图案数据。
 * 每次变换都做三件事（D87 ②③）：卡片缩略图跟着转、轻弹一句、触屏上闪一下幽灵 ——
 * 桌面 R/F 与手机 ⟳/⇋ 走的是同一条路，所以三样反馈两边一模一样。
 */
app.rotateStamp = function (steps) {
  if (!app.stamp) return
  app.stampOrient = { rot: (app.stampOrient.rot + steps + 4) % 4, flip: app.stampOrient.flip }
  afterOrientChange('rotate')
}
app.flipStamp = function () {
  if (!app.stamp) return
  app.stampOrient = { rot: app.stampOrient.rot, flip: !app.stampOrient.flip }
  afterOrientChange('flip')
}

function afterOrientChange(kind) {
  app.library.renderPatterns()      // 缩略图即状态：卡片直接画成当前朝向
  app.placeStampConfirm()           // 转过之后外接框换了边，按钮跟着挪
  app.toast(t(orientToastKey(kind), { orient: orientLabel(app.stampOrient) }))
  app.markStampTipUsed()            // 用过一次，那个气泡从此不再冒（D88 ①）
  app.dirty = true
  app.updateHoverReadout()
}

/**
 * 首次选中图案时的指向性气泡（D88 ①）。
 * 它贴在 ⟳/⇋ 那两颗按钮旁边 —— **提示要长在动作发生的位置上**，
 * 而不是画布另一角：D87 那条提示条就是因为不在注意力所在处而没被看见。
 * 桌面没有那两颗按钮（走 R/F 键），所以改成把那一行提示短暂高亮一下。
 */
app.syncStampTip = function () {
  const show = shouldShowStampTip(prefs.get('stampTipSeen'), !!app.stamp)
  document.getElementById('stamp-tip').hidden = !show
  const hint = document.getElementById('stamp-hint')
  hint.classList.remove('flash')
  if (show) {
    // 重新触发一次动画：读一下 offsetWidth 强制回流，否则连续两次选中不会再闪
    void hint.offsetWidth
    hint.classList.add('flash')
  }
}

/** 用过一次（转过或翻过）就把气泡收起来，并记住 */
app.markStampTipUsed = function () {
  if (prefs.get('stampTipSeen') === '1') return
  prefs.set('stampTipSeen', '1')
  app.syncStampTip()
}

/**
 * 参照线：**最近一次落子留下的那一条**（D91）。
 * 它是静态贴纸 —— 记的是落子那一刻的位置与朝向，引擎此后怎么跑都不动它。
 * 传 null 就是清掉（画笔落子、播放、清空都会走到这里）。
 */
app.setRefRay = function (ref) {
  app.refRay = ref || null
  app.refSeq = (app.refSeq | 0) + 1     // 一改就作废所有在途的量测回调
  app.dirty = true
}

/* ---------------- 手机两步放置（D89 ①） ---------------- */
/**
 * 摆一个"待放"的幽灵：**只改锚点，引擎与记账一个字都不碰**（D67 那条原则）。
 * 确认之前，这一局的历史里什么也没发生 —— 撤销、编年史、台账全都不知道有过这一步。
 */
app.armStampAt = function (cell) {
  if (!app.stamp || !cell) return
  app.pendingStamp = { x: cell.x, y: cell.y }
  document.getElementById('btn-drop').hidden = false
  app.placeStampConfirm()           // 按钮跟着幽灵走（D90 ③）
  app.dirty = true
  app.updateHoverReadout()
}

/** 确认落子。这一步才动引擎 */
app.confirmStamp = function (cell) {
  const at = cell || app.pendingStamp
  if (!app.stamp || !at) return
  app.cancelPending({ keepRef: true })     // 先退出待放态，再落子（参照线由落子自己贴）
  app.placeStampAt(at)
}

/**
 * **待放态的唯一出口**（D90 §4）。幽灵、动向线、「放这」三样一起退场 ——
 * 它们本来就只有一个状态源，所以这里也只需要清那一个。
 *
 * 什么时候顺带清掉参照线，规则只有一句：**棋盘往前走了或整个换掉了就清，只换手上的图案不清。**
 *   · 清空、读档、换世界、播放、单步 → 连参照线一起清（那条线画的是另一盘棋了）
 *   · 换图案、Esc、点空白、进全屏视图 → 参照线留着（棋盘没变，它仍然说得准）
 * @param {{keepRef?:boolean}} opts
 */
app.cancelPending = function (opts = {}) {
  app.pendingStamp = null
  document.getElementById('btn-drop').hidden = true
  if (!opts.keepRef) app.setRefRay(null)
  app.dirty = true
  app.updateHoverReadout()
}

/**
 * 把「放这」摆到幽灵旁边（D90 ③）。**操作要跟着对象走** ——
 * 这与 D47 的框选菜单是同一条道理，所以用的也是同一个定位函数：
 * 贴着幽灵的外接框放，放不下就往内翻，永远不越出画布。
 *
 * 每帧调一次（只在待放态），但只有算出来的位置真的变了才写 style ——
 * 每帧写一次 style 会把布局搅得没完。
 */
app.placeStampConfirm = function () {
  const btn = document.getElementById('btn-drop')
  if (!app.pendingStamp) return
  const gp = app.stampPattern()
  const gc = app.pendingStamp
  if (!gp || !gc) return
  const o = centerOrigin(gp, gc.x, gc.y)
  const vp = app.viewport, dpr = app.renderer.dpr || 1
  // 幽灵在画布上的位置（CSS 像素）
  const left = (o.x - vp.originX) * vp.scale / dpr
  const top = (o.y - vp.originY) * vp.scale / dpr
  const w = gp.w * vp.scale / dpr, h = gp.h * vp.scale / dpr
  const stage = app.canvas.getBoundingClientRect()
  const pos = placeSelectionMenu(
    { left, top, right: left + w, bottom: top + h },
    { w: btn.offsetWidth || 72, h: btn.offsetHeight || 40 },
    { w: stage.width, h: stage.height }
  )
  const x = pos.x + 'px', y = pos.y + 'px'
  if (btn.style.left !== x) btn.style.left = x
  if (btn.style.top !== y) btn.style.top = y
}

app.setStamp = function (pattern) {
  app.stamp = pattern
  // 换图案（或取消选择）时，待放的那个幽灵一并收走；**参照线留着** ——
  // 棋盘没变，刚才那条线仍然说得准，而拿起下一个图案正是要拿它来对（D91）
  app.cancelPending({ keepRef: true })
  app.stampOrient = { rot: 0, flip: false }   // 换图案也复位朝向
  document.body.classList.toggle('stamp-active', !!pattern)
  document.getElementById('stamp-tools').hidden = !pattern
  app.syncStampTip()
  app.library.renderPatterns()
  // 精彩局卡片带也要跟着变（拿在手上的那张要高亮）—— 与图案卡同一时刻、同一处触发
  if (app.favorites) app.favorites.renderShow()
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
  // 放下之后把这一条动向线留成**参照线**（D91）：拿起下一个图案时两条线同屏，才对得上。
  // 只留最近一条 —— 留一堆线等于没有线。
  //
  // 量测是异步的（吞食者最慢两百毫秒），所以落子那一刻可能还没量完 ——
  // 那就等量完再贴。两处细节都不能省：
  //   · 图案与朝向在**落子那一刻**就抓下来，不能等回调时再读 app.stamp（那时用户可能已经换了图案）；
  //   · 用序号挡住"旧的盖掉新的"（连着放两个，先落的那个后量完，就会把后落的参照线冲掉）。
  const base = app.stamp
  const orient = { ...app.stampOrient }
  const seq = ++app.refSeq
  const applyRef = () => {
    const m = motionCached(base, orient, applyRef)
    if (m && seq === app.refSeq) app.setRefRay(refFromPlacement(p, o, m))
  }
  applyRef()
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
    app.visual.advance(app.engine, app.visualNow().glow ? app.renderer.glowFrames : 0)
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
  app.assertBoardUnlocked('adoptEngine')
  // 读档 / 换盘：整盘换掉，待放态与参照线一起退场（D90 §4）。
  // 放在这里而不是放在 io.js 的读档回调里 —— 凡是"整盘换掉"都走这个口，一处管住所有来路。
  app.cancelPending()
  app.exitShowEnv()          // 读档 = 退出这一局（D104）
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
  // 点了"适配整盘"就是不要那个框了：欠着的取景意图作废，免得布局一到又被兑现回去
  app.pendingView = null
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
  // **响应式写入者**（D110 §1 第三类）：随时触发、又不能禁用，排序和门禁都管不住它。
  // 治法是剥夺它的决定权 —— 它不许自己挑倍率，只能把**改动之前**的取景意图重算一遍。
  // 从前这里保的是像素倍率（scale 原样留着，只挪中心），于是 D108 那句
  // "w×w 方格在任何屏幕上完整可见"只在链接落地那一瞬成立：
  // 之后窗口一窄、工具条一收，画布小了而倍率没动，框里的东西就少了一圈，没人会发现。
  app.syncViewIntent()                     // 中间有人动过的话，先把新意图记下来
  const before = app.viewIntent
  const oldW = app.canvas.width, oldH = app.canvas.height
  const { w, h } = app.renderer.resize()
  if (app.needsFit) { app.settleView(); return }
  if (oldW > 1 && oldH > 1 && w > 1 && h > 1) app.applyViewIntent(before, 'atLeast')
  // 记下"这次是我派生成这样的"。下次进来若对不上，就是用户自己动过（见 syncViewIntent）
  const vp = app.viewport
  app.viewDerived = { scale: vp.scale, originX: vp.originX, originY: vp.originY }
  app.dirty = true
}

/**
 * 记录单代耗时；超过 16ms 自动降速。
 *
 * **大盘上不再弹那行黄字**（D104）：在 2048² 上"单代超过 16 毫秒"是预料之中的事，
 * 尺寸那一栏早就写着"预期约 N 代/秒"。把预料之中的事报成警告，
 * 会教用户把黄字当背景 —— 那样真正意外的那次也就没人看了。
 * **降速照旧生效**，只是不再嚷嚷。
 */
app.recordStepCost = function (totalMs, count) {
  const per = totalMs / count
  app.stepMsEma = app.stepMsEma === 0 ? per : app.stepMsEma * 0.8 + per * 0.2
  const shouldThrottle = app.stepMsEma > 16
  if (shouldThrottle !== app.throttled) {
    app.throttled = shouldThrottle
  }
  // 只有在"没预告过"的盘上才提示：大盘的慢是说好的，小盘的慢才是意外
  const shout = app.throttled && !isBigBoard(app.engine.w)
  const note = document.getElementById('throttle-note')
  if (note.hidden === shout) note.hidden = !shout
}

/** 实际生效的速度：单代太慢时按实测耗时压到能跑得动的水平 */
app.effectiveSpeed = function () {
  if (!app.throttled) return app.speed
  return Math.max(1, Math.min(app.speed, 1000 / app.stepMsEma))
}

/**
 * 可分享链接（D106）。
 *
 * `shareState()` 把"这一局在什么世界里跑"取出来：规则、边界、盘、种子/密度，
 * 以及棋盘上的格子（RLE）。**格子带不下就不带**，并且要说出来 ——
 * 塞一条打不开或者打开是另一局的链接，比不给链接更糟。
 */
app.shareState = function (opts = {}) {
  const e = app.engine
  const state = {
    rule: e.rule.notation || 'B3/S23',
    boundary: e.boundary,
    board: e.w,
    seed: e.seed,
    density: app.density
  }
  // **视图与速度也是这一局的一部分**（D108）：发的人在 33.5× 上框住了三架滑翔机，
  // 收的人若落在 6× 上，看到的是一片什么都分不出的灰。
  // 编的是"看哪儿 + 看多宽"，不是倍率 —— 倍率是屏幕的属性，不是这一局的。
  state.view = app.viewIntentNow()
  state.speed = app.speed
  if (opts.rle !== undefined) state.rle = opts.rle
  else if (e.stats.alive > 0) state.rle = app.currentLayoutRle() || undefined
  // 收藏里那一条要带**它自己的**环境，不是当前棋盘的（D106）
  if (opts.rule) state.rule = opts.rule
  if (opts.boundary) state.boundary = opts.boundary
  if (opts.board) state.board = opts.board
  return state
}

/** 生成整条链接（页面地址 + hash）。上层拿去复制 */
app.shareLink = function (opts = {}) {
  const base = location.origin + location.pathname
  const e = app.engine
  const { hash, droppedPattern } = encodeShare(app.shareState(opts), base.length)
  // 图案带不下时，种子未必替得了它 —— 手改过、或跑过代，种子指向的是另一局。
  // 那种情况下**不生成链接**（D110 §8）。
  const verdict = shareVerdict({
    droppedPattern,
    alive: opts.rle !== undefined ? 1 : e.stats.alive,
    initType: e.initType,
    runDirty: app.runDirty,
    generation: e.generation
  })
  return { url: base + hash, droppedPattern, verdict }
}

/**
 * **取景意图**：这一局"看哪儿 + 看多宽"（D108/D110）。
 * 倍率不在里面 —— 倍率是屏幕的属性，不是这一局的属性：
 * 同样的意图，在手机和 27 寸上算出来的倍率本就该不一样。
 * 发链接、收链接、改画布尺寸，三处都问这一个函数，不许各算各的。
 */
app.viewIntentNow = function () {
  const vp = app.viewport
  const cw = app.canvas.width, ch = app.canvas.height
  return {
    cx: vp.originX + cw / (2 * vp.scale),
    cy: vp.originY + ch / (2 * vp.scale),
    span: Math.min(cw, ch) / vp.scale        // 短边看得见多少格
  }
}

/**
 * 把取景意图落到视口上。
 *
 * `mode: 'exact'`（收链接）—— 倍率就按 span 算，发的人框住多宽就看多宽。
 * `mode: 'atLeast'`（画布尺寸变了）—— **只保证不少看**：
 *   窗口变窄、工具条收起，倍率必须退到让这片区域仍然完整可见；
 *   窗口变大则保留原倍率，多出来的地方多看一点。
 *   反过来做（变大就跟着放大）会让"拉宽窗口反而看得更少"，那不是人预期的。
 */
app.applyViewIntent = function (intent, mode = 'exact') {
  const vp = app.viewport
  // exact 是"照这个框来"，得按**当下真实**的画布算 —— 开机时链接落地那一刻，
  // 布局可能还没跑过（画布还是 300×150 的出厂值），照它算出来的倍率是错的。
  // atLeast 由 handleResize 调用，它自己刚量过，不重复量。
  if (mode === 'exact') app.renderer.resize()
  const cw = app.canvas.width, ch = app.canvas.height
  if (cw <= 1 || ch <= 1) {
    // 画布还没有尺寸（面板隐藏、首帧之前）。**把意图存着**，等布局到了照原样兑现 ——
    // 不存的话这里只会 needsFit，主循环随后 fitView，发的人那个 33.5× 的框就没了。
    if (mode === 'exact') app.pendingView = intent
    app.needsFit = true
    return
  }
  const wanted = Math.min(cw, ch) / Math.max(1e-6, intent.span)
  // atLeast 的参照是**意图里的倍率**（用户自己选的那一档），不是当前倍率 ——
  // 拿当前倍率当参照，就等于把上一次 resize 的结果当成新意图，那正是棘轮的来源。
  const ref = Number.isFinite(intent.scale) ? intent.scale : vp.scale
  const next = mode === 'atLeast' ? Math.min(ref, wanted) : wanted
  vp.scale = Math.max(vp.minScale, Math.min(vp.maxScale, next))
  vp.originX = intent.cx - cw / (2 * vp.scale)
  vp.originY = intent.cy - ch / (2 * vp.scale)
  if (mode === 'exact') app.pendingView = null
  app.needsFit = false
  app.dirty = true
}

/**
 * **用户自己决定的那次取景**（手势缩放、平移、适配整盘、按链接取景），
 * 与 resize 派生出来的结果分开存。
 *
 * resize 只能**从**它派生，不许**写回**它 —— 写回就是棘轮：
 * 拉窄一次倍率退一档，拉回来时那一档已经被当成新意图，于是视野只出不进。
 * 实测（改之前）：40 格的框拉窄再拉回，两个来回变成 160 格，且不回头。
 */
app.noteViewIntent = function () {
  const vi = app.viewIntentNow()
  app.viewIntent = { cx: vi.cx, cy: vi.cy, span: vi.span, scale: app.viewport.scale }
}

/**
 * 视口若不是 resize 上次留下的样子，说明这中间有人动过（手势、取景、适配）——
 * 那才是新的意图。这样就不必在六处手势代码里各插一句"记一下"，也就漏不掉。
 */
app.syncViewIntent = function () {
  const vp = app.viewport, d = app.viewDerived
  if (!d || Math.abs(vp.scale - d.scale) > 1e-9 ||
      Math.abs(vp.originX - d.originX) > 1e-6 || Math.abs(vp.originY - d.originY) > 1e-6) {
    app.noteViewIntent()
  }
}

/**
 * 布局终于有尺寸了，该看哪儿：**欠着的取景优先，没欠才自动适配整盘**。
 * 两处推迟点都走它 —— 少走一处，链接的取景就会在那条路上被 fitView 吃掉。
 */
app.settleView = function () {
  if (app.pendingView) app.applyViewIntent(app.pendingView, 'exact')
  else app.fitView()
}

/** 按链接给的取景（D108）。收的人的屏幕说了算，照抄发件人的倍率框住的是另一片东西 */
app.applySharedView = function (view) {
  app.applyViewIntent(view, 'exact')
}

/** 复制到剪贴板；剪贴板用不了时把链接摆出来让用户自己复制 */
app.copyShareLink = async function (opts = {}) {
  const { url, droppedPattern, verdict } = app.shareLink(opts)
  if (verdict === 'refuse') {
    // 手改过、图案又装不下：种子指向的是另一局。**失败发生在这一边，而且看得见** ——
    // 复制一条会给对方开出别的局面，是把失败悄悄转嫁出去。
    app.toast(t('share.refuse'))
    return null
  }
  if (verdict === 'askGen') {
    // 只是跑过代、种子干净：链接带得回第 0 代 —— 不是废链接，只是不是这一帧。
    // 这是分享的人自己的取舍，**把决定还给他**，别替他拒。
    app.confirmAction({
      title: t('share.askGen.title'),
      body: t('share.askGen.body', { n: app.engine.generation }),
      yes: t('share.askGen.yes')
    }, () => app.writeShareLink(url, droppedPattern))
    return null
  }
  return app.writeShareLink(url, droppedPattern)
}

/** 真正写剪贴板的那一步。上面那几条判据过了才走到这里 */
app.writeShareLink = async function (url, droppedPattern) {
  try {
    await navigator.clipboard.writeText(url)
    app.toast(droppedPattern ? t('share.copiedNoPattern') : t('share.copied'))
  } catch (err) {
    // 剪贴板可能被浏览器拒（非安全上下文、没有用户手势）——那就退回"选中让他自己复制"
    window.prompt(t('share.manual'), url)
  }
  return url
}

/**
 * 开机时按链接复现（D106）。**认不出就说认不出**，不拿默认值凑一局 ——
 * 那样用户以为自己打开的是别人那一局，其实不是。
 */
app.shareApplied = false     // 这一局是不是从链接来的（D107 ③：链接优先）

app.applyShareHash = function (hash) {
  const r = decodeShare(hash)
  if (!r.ok) {
    if (r.reason !== 'empty') app.toast(t('share.bad.' + r.reason) || t('share.bad.other'))
    return false
  }
  app.applyShareState(r.state)
  app.toast(t('share.opened'))
  return true
}

/** 把一份已解码的链接局面落到棋盘上。开机走 applyInitialBoard，粘链接走 applyShareHash */
app.applyShareState = function (st) {
  app.assertBoardUnlocked('applyShareState')
  // 链接是"换成另一局"：不搬旧内容（D110 §10）。不写 carry:false 的话，
  // 一条只带环境、不带图案也不带种子的链接会把上一局的格子留在盘上。
  if (st.board !== app.engine.w) app.resizeBoard(st.board, st.board, { silent: true, carry: false })
  if (st.boundary !== app.engine.boundary) app.setBoundary(st.boundary)
  app.applyNotation(st.rule)
  if (st.rle) {
    app.engine.clear()
    app.visual.sync(app.engine)
    app.importRleText(st.rle, { center: true })
  } else if (Number.isFinite(st.seed)) {
    app.density = Number.isFinite(st.density) ? st.density : app.density
    app.engine.randomize(st.seed, app.density)
    app.visual.sync(app.engine)
  }
  app.records.startRun()
  // 视图：链接里给了就照它取景，没给才自动适配（老链接就是没给的那一种）
  if (st.view) app.applySharedView(st.view)
  else app.fitView()
  if (Number.isFinite(st.speed)) app.setSpeed(st.speed)
  app.dirty = true
  app.updateHud()
  app.shareApplied = true      // 引导收尾时据此**不清盘、不送滑翔机**（D107 ③）
}

/**
 * **开机时唯一被允许写棋盘的函数**（D110 §2）。
 * 启动段里除它以外不许出现 randomize / clear / importRleText / placeStarterGift /
 * fitView / applySharedView —— 有守卫盯着（tests/cases.js「启动写盘唯一入口」）。
 * 从前那三处各写各的，谁在前谁在后靠读代码才知道；D107 那张表也就只是一句约定。
 */
/**
 * 把一份会话快照原样还回去：**格子 + 环境 + 取景**（D110 §11）。
 * 退看展走它；将来"撤销一次大动作"要是要做，也走它 —— 不做第二套。
 */
app.restoreSession = function (snap) {
  if (!snap) return false
  if (app.engine.w !== snap.w || app.engine.h !== snap.h) {
    app.resizeBoard(snap.w, snap.h, { silent: true, carry: false })
  }
  if (app.engine.boundary !== snap.boundary) app.setBoundary(snap.boundary)
  app.applyNotation(snap.rule)
  app.engine.cur.set(snap.cells)
  app.engine.generation = snap.generation
  app.engine.stats.alive = app.engine.countAlive()
  app.visual.sync(app.engine)
  app.runDirty = !!snap.runDirty
  if (Number.isFinite(snap.speed)) app.setSpeed(snap.speed)
  if (snap.view) app.applyViewIntent(snap.view, 'exact')
  app.setRunning(!!snap.running)
  app.records.startRun()
  app.dirty = true
  app.updateHud()
  return true
}

app.applyInitialBoard = function (intent) {
  app.initialIntent = intent
  app.unlockBoard()          // 裁决完了，闸开（唯一开闸处，D110 §13）
  if (intent.source === 'link') {
    app.applyShareState(intent)
  } else if (intent.source === 'firstVisitDemo') {
    app.engine.randomize(intent.seed, intent.density)
    app.visual.sync(app.engine)
    app.records.startRun()
    app.fitView()
  } else {
    app.visual.sync(app.engine)
    app.records.startRun()
    app.fitView()
  }
  app.series.push(app.engine.stats.alive)
  return intent
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
  // 「缩放」四个字是静态标签（data-i18n），这里只写数值 —— 因为它现在是可点击输入的那一格（D84 ③）
  hud.scale.textContent = zoomLabel(app.viewport.scale)
  // 滑条不持有自己的状态：捏合、滚轮、适配视图改了缩放，它跟着走（D84 ④）
  if (app.zoomBar) app.zoomBar.sync()

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
app.zoomBar = setupZoomBar(app)
app.pageZoom = watchPageZoom(app)     // 页面真被浏览器放大了就提示怎么还原（D85 ②c）
app.io = setupIO(app)
app.confirm = createConfirm(app)   // 先于收藏建好：精彩局换世界要用它问那一句（D93）
app.favorites = createFavorites(app)
app.library = setupLibrary(app)
app.library.render()
app.intro = createIntro(app)
app.minimap = createMinimap(app)   // 小地图（D109）：放大之后不至于迷路
// 看展（D110 §14）：手动进入是用户的动作（排最后），自动进入被链接抑制（排链接之前）。
// 建在 favorites 之后 —— 排片从收藏那同一个出口取行。
app.show = createShow(app)
// 点「?」总是带上第零幕，老用户也能在这里重选版本
document.getElementById('btn-help').addEventListener('click', () => app.intro.open({ chooser: true }))
// 顶栏分享钮（D107 ①）：编码当前这一局并复制，提示与另外两处同一套
document.getElementById('btn-share').addEventListener('click', () => app.copyShareLink())
app.tower = createTowerView(app)
app.explorer = createExplorerView(app)
app.critical = createCriticalView(app)

/**
 * 观塔与勘探都是整屏接管的独立视图，同一时刻只能开一个 ——
 * 两个都开会叠在一起，谁在上面取决于 DOM 顺序，用户完全无从预料。
 */
const VIEWS = { tower: () => app.tower, explorer: () => app.explorer, critical: () => app.critical }
app.openView = function (name) {
  // 进全屏视图：手上举着的幽灵不该在回来之后还举着（D90 §4）。
  // 参照线留着 —— 棋盘没变，回来还要拿它对线。
  if (VIEWS[name]) app.cancelPending({ keepRef: true })
  // 名单驱动，不逐个 if —— 加第四个视图时漏掉一处 hide 就会两块叠在一起（D86 ④）
  for (const key of Object.keys(VIEWS)) if (key !== name) VIEWS[key]().hide()
  if (VIEWS[name]) VIEWS[name]().show()
  // 窄屏下抽屉把手和「更多」浮层是常驻的，全屏视图打开时得让开，否则会压在上面
  document.body.classList.toggle('view-open', !!VIEWS[name])
  if (VIEWS[name]) document.body.classList.remove('more-open', 'drawer-open')
}
document.getElementById('btn-tower').addEventListener('click', () => app.openView('tower'))
document.getElementById('btn-explorer').addEventListener('click', () => app.openView('explorer'))
document.getElementById('btn-critical').addEventListener('click', () => app.openView('critical'))
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
  app.favorites.relocalize()
  app.critical.relocalize()
  app.zoomBar.relocalize()
  app.show.relocalize()
  app.refreshTabHint()
})
function trailLabelOf(v) {
  return t(v <= 6 ? 'vis.trail.short' : v <= 13 ? 'vis.trail.mid' : 'vis.trail.long')
}

// 开局状态：棋盘从哪儿来，由 resolveInitialBoard 一处裁决（D110）。
// 从前这里是三处各写各的（首访随机盘 / 链接 / 引导收尾），顺序全靠读代码才看得出来 ——
// D107 那张优先级表也就只是文档里的一句话。现在表在 src/data/startup.js 里是数据，
// 写盘只有 applyInitialBoard 一个出口，想绕也绕不过去。
//
// 首访给"导演场"，回访给"空场"（D69）：回访者的实际动作是"先清空再开始"，
// 那说明满盘随机不是他要的开场，是他每次都要先撤掉的东西。
//
// 链接**在这里就参与裁决**，不是先摆一局再被盖掉（D107 ③）：
// 别人发来的那一局，打开就该是那一局，中间不该闪一下别的。
const firstVisit = prefs.get('introSeen') !== '1'
const bootShare = location.hash ? decodeShare(location.hash) : { ok: false, reason: 'empty' }
if (location.hash && !bootShare.ok && bootShare.reason !== 'empty') {
  app.toast(t('share.bad.' + bootShare.reason) || t('share.bad.other'))
}
app.applyInitialBoard(resolveInitialBoard({
  share: bootShare.ok ? bootShare.state : null,
  firstVisit,
  density: app.density,
  // 自动看展开着没，在**裁决**里就定下来（D110 §14）：看展自己不许去读 hash，
  // 它只问意图。压缩落地那天 decodeShare 变异步，这条也不会悄悄错。
  autoShowcaseEnabled: prefs.get('autoShow') !== '0'
}))
if (app.shareApplied) app.toast(t('share.opened'))
app.setRunning(false)
// 不预填种子框：规格里"留空则随机生成种子并显示"意味着空 = 换一张新盘。
// 预填的话第一次点「随机填充」会用同一个种子重放出一模一样的棋盘，看上去就像按钮没反应。
// 开机这局的种子在编年史的「开局」一条里有记录，不会丢。

// 页面已经开着时把链接粘进地址栏，浏览器**不会重新加载**（只换了 hash）——
// 不听这个事件，那种情形下就是"粘了没反应"。本机就是这么发现的：
// 用工具换 hash 没重载，于是只看到上一次的状态。
window.addEventListener('hashchange', () => {
  if (location.hash) app.applyShareHash(location.hash)
})

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

  if (app.needsFit) app.settleView()

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
    if (app.visualNow().trails) app.dirty = true
    // 每 500ms 统计一次实际代/秒
    if (now - app.windowStart >= 500) {
      app.gps = (app.gensInWindow * 1000) / (now - app.windowStart)
      app.windowStart = now
      app.gensInWindow = 0
    }
  }

  // 小地图：每帧问一次，真正重画由它自己节流（250ms，且只在真变了时画）
  app.minimap.tick(now)
  app.show.tick(now)         // 看展：该换下一局了吗；没在看展时它数空闲时间

  // 帧率统计（无论是否在跑都记，方便观察渲染负载）
  app.framesInWindow++
  if (now - app.fpsWindowStart >= 500) {
    app.fps = (app.framesInWindow * 1000) / (now - app.fpsWindowStart)
    app.fpsWindowStart = now
    app.framesInWindow = 0
  }

  if (app.dirty) {
    app.renderer.draw(app.engine, app.viewport, app.visual, app.visualNow())
    // 参照线：最近一次落子留下的那条，画在最底下（D91）。
    // 它与待放的那条用的是同一套几何（rayEnds），只是样式退一档。
    if (app.visualOpts.motionRay && app.refRay) {
      const r = app.refRay
      const bounds = { w: app.engine.w, h: app.engine.h }
      // 入口线（互动型才有）：刚放下的那台从哪儿接东西
      if (r.kind === 'eater' || r.kind === 'reflector') {
        const ends = rayEnds(r.kind, r.center, r, bounds)
        app.renderer.drawMotionRay(app.viewport, ends.from, ends.to, ends.arrowAt, ends.solidEnd,
          { ref: true, dots: r.dots || [] })
      }
      // 出口线（D100）：反射器拐出去的那条、枪的弹道、飞船的航线，同一个口径
      if (r.exit) {
        const ex = rayEnds('ship', r.exit.center, r.exit, bounds)
        app.renderer.drawMotionRay(app.viewport, ex.from, ex.to, ex.arrowAt, ex.solidEnd,
          { ref: true, exit: true })
      }
    }
    // 方向键微调后幽灵脱离鼠标跟随（pendingStamp 非空即钉住）
    const gc = app.pendingStamp || app.hoverCell
    const gp = app.stampPattern()
    if (gp && gc) {
      const o = centerOrigin(gp, gc.x, gc.y)
      // 动向线画在幽灵下面：线是"接下来会怎样"，幽灵是"现在放在哪儿"，
      // 幽灵盖在线上才不会被线切开（D88 ②）
      if (app.visualOpts.motionRay) {
        // 没量过的先不画，量完了叫醒下一帧（量吞食者最慢要两百多毫秒，不能卡在这一帧里）
        const m = motionCached(app.stamp, app.stampOrient, () => { app.dirty = true })
        if (m) {
          // 两条线（D100）：入口"从哪儿进来"、出口"会往哪儿去"。
          // 各自穿过**实测出来的**航道点，不是包围盒中心（D98）——
          // 反射器能接收的航道在质心侧向四格外，从中心画出去的线对齐了也撞不上。
          // 线一路画到棋盘边（D89 ②），所以要把棋盘尺寸交给它。
          const bounds = { w: app.engine.w, h: app.engine.h }
          const en = entryEnds(gp, o, m, bounds)
          if (en) {
            app.renderer.drawMotionRay(app.viewport, en.from, en.to, en.arrowAt, en.solidEnd,
              { dots: landingDots(o, m) })
          }
          const ex = exitEnds(gp, o, m, bounds)
          if (ex) {
            app.renderer.drawMotionRay(app.viewport, ex.from, ex.to, ex.arrowAt, ex.solidEnd, { exit: true })
          }
        }
      }
      app.renderer.drawGhost(app.viewport, gp, o.x, o.y, app.engine.w, app.engine.h)
      if (app.pendingStamp) app.placeStampConfirm()   // 幽灵动了、转了、缩放了，按钮都要跟上
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
