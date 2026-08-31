// 三幕介绍卡 + 规矩实验角。
// 迷你棋盘用的就是真正的 LifeEngine 与 Renderer —— 不是画死的示意图，
// 孩子点上去摆的格子，走出来的结果和主棋盘一模一样。
import { LifeEngine } from '../engine/board.js'
import { lifeRule } from '../engine/rules.js'
import { Renderer } from '../render/renderer.js'
import { Viewport } from '../render/viewport.js'
import { VisualState } from '../render/visual-state.js'
import { getPattern, placePattern, centerOrigin } from '../engine/patterns.js'
import { t, setLang, getLang } from '../i18n/index.js'
import { prefs } from './prefs.js'

/** 一块可点、可走一步的迷你棋盘 */
class MiniBoard {
  constructor(w, h, setup, opts = {}) {
    this.setup = setup
    this.engine = new LifeEngine(w, h, { rule: lifeRule(), boundary: 'dead' })
    this.visual = new VisualState(w * h)
    this.viewport = new Viewport()
    this.renderer = null
    this.canvas = null
    this.interactive = opts.interactive !== false
    this.reset()
  }

  reset() {
    this.engine.clear()
    for (const [x, y] of this.setup) this.engine.set(x, y, 1)
    this.engine.stats.alive = this.engine.countAlive()
    this.visual.sync(this.engine)
    this.draw()
  }

  step() {
    this.engine.step()
    this.visual.advance(this.engine, 3)
    this.draw()
  }

  attach(canvas) {
    this.canvas = canvas
    this.renderer = new Renderer(canvas)
    if (this.interactive) {
      canvas.addEventListener('pointerdown', e => {
        const r = canvas.getBoundingClientRect()
        const dpr = this.renderer.dpr
        const c = this.viewport.screenToCell((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr)
        if (c.x < 0 || c.y < 0 || c.x >= this.engine.w || c.y >= this.engine.h) return
        this.engine.set(c.x, c.y, this.engine.get(c.x, c.y) === 1 ? 0 : 1)
        this.engine.stats.alive = this.engine.countAlive()
        this.visual.reconcile(this.engine)
        this.draw()
      })
    }
  }

  draw() {
    if (!this.renderer) return
    const { w, h } = this.renderer.resize()
    if (w <= 1 || h <= 1) return
    this.viewport.fit(w, h, this.engine.w, this.engine.h, 0.92)
    this.renderer.draw(this.engine, this.viewport, this.visual, { ageColoring: true, glow: true })
  }
}

/* 三条规矩各配一块地：摆法都挑最不会分心的 */
const DEMO_LONELY = [[2, 2], [3, 2]]                              // 各只有 1 个朋友 → 都会没
const DEMO_CROWDED = [[2, 1], [3, 1], [4, 1], [2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3]] // 实心块，中间闷死留个洞
const DEMO_BIRTH = [[2, 1], [3, 1], [2, 2]]                       // 空位 (3,2) 旁边刚好 3 个 → 冒出新的
const DEMO_STAGE = [                                              // 第一幕：会自己动的一小台戏
  [2, 1], [3, 2], [1, 3], [2, 3], [3, 3],                         // 会走路的（滑翔机）
  [12, 2], [13, 2], [14, 2],                                      // 一开一合的（闪灯）
  [16, 8], [17, 8], [16, 9], [17, 9],                             // 一动不动的（方块）
  [7, 7], [8, 7], [9, 7], [8, 8]                                  // 会变形几步的
]

/**
 * 介绍卡的页序与翻页决策 —— 纯函数，不碰 DOM，可以直接在测试里跑。
 *
 * 这两个函数是从 DOM 回调里抽出来的。抽出来的原因写在 docs/decisions.md D65：
 * 原本翻页逻辑写在 nextBtn 的 click 回调里，而这个项目的测试没有 DOM，
 * 回调体一行都执行不到 —— 于是里面既漏了一处改名（pageCount 已删还在调），
 * 又留了一个写死的下标（page === 2），两个都是上线才炸。
 * 逻辑搬到这里之后，回调只剩"把决策翻译成动作"，测试能把每条路径走一遍。
 *
 * 页用字符串标识，不用函数身份 —— 字符串能写进断言，函数身份不能。
 * @param {{chooser:boolean, mode:string}} o
 * @returns {string[]} 形如 ['act0','act1','act2','act3','helpAge','helpBS']
 */
export function introPages(o) {
  const list = o.chooser ? ['act0'] : []
  list.push('act1', 'act2', 'act3')
  if (o.mode === 'full') list.push('helpAge', 'helpBS', 'helpSave')
  return list
}

/** 附录页 = 主线三幕之外的那些。数附录的地方一律问这个函数，别再逐个列 key（D83 §4） */
export function appendixPages(list) {
  return list.filter(k => k.startsWith('help'))
}

/**
 * 点「下一幕」该干什么。
 * @returns {'finish'|'close'|number} 'finish' = 关卡片并送礼物；'close' = 只关；数字 = 跳到第几页
 */
export function introNext(list, page) {
  if (list[page] === 'act3') return 'finish'      // 第三幕的主按钮 = 开始玩
  if (page >= list.length - 1) return 'close'     // 已经在最后一页
  return page + 1
}

/**
 * 第三幕的见面礼：清盘 + 正中放一架滑翔机。纯逻辑，只吃一个 engine，可直接测。
 *
 * 抽出来是为了让"承诺"能被验证。第三幕的文案无条件写着"这就给你放一个会走路的小家伙"，
 * 而这个动作从前藏在 finish() 里、还带着"棋盘为空才放"的条件 ——
 * 首访棋盘是满的，于是那句话从写下那天起就没兑现过（D70）。
 * 现在动作无条件、文案无条件，两边对齐；这个函数则让"恰好 5 格且是滑翔机"成为断言。
 *
 * 自带 clear() 而不是依赖调用方先清 —— 契约要自足，否则测试测的就不是同一件事。
 * @returns {number} 放完之后的活细胞数（必然是 5）
 */
export function placeStarterGift(engine) {
  engine.clear()
  const g = getPattern('glider')
  const o = centerOrigin(g, Math.floor(engine.w / 2), Math.floor(engine.h / 2))
  placePattern(engine, g, o.x, o.y)
  engine.stats.alive = engine.countAlive()
  return engine.stats.alive
}

export function createIntro(app) {
  const modal = document.getElementById('intro-modal')
  const bodyEl = document.getElementById('intro-body')
  const act0El = document.getElementById('intro-act0')
  const pickKid = document.getElementById('intro-pick-kid')
  const pickStd = document.getElementById('intro-pick-std')
  const stepEl = document.getElementById('intro-step')
  const dotsEl = document.getElementById('intro-dots')
  const backBtn = document.getElementById('intro-back')
  const nextBtn = document.getElementById('intro-next')
  const skipBtn = document.getElementById('intro-skip')
  const langSeg = document.getElementById('intro-lang')

  // 卡片自带语言开关：首次打开时卡片盖住了侧栏那个开关，
  // 看不懂中文的人得先关掉卡片才能换语言 —— 那正是最不该设障碍的一刻。
  langSeg.addEventListener('click', e => {
    const b = e.target.closest('[data-lang]')
    if (!b) return
    setLang(b.dataset.lang)          // 会触发 onLangChange，卡片自己重绘
    prefs.set('lang', getLang())     // 记住，下次打开就是这个语言
    if (app.syncSwitches) app.syncSwitches()
  })

  let page = 0
  let chooser = false      // 是否包含第零幕（选版本）
  let stageBoard = null
  let stageTimer = 0
  let miniBoards = []

  /** 页 key → 画这一页的函数。页序本身由纯函数 introPages 决定（见文件顶部）。 */
  const RENDERERS = { act0: actZero, act1, act2, act3, helpAge, helpBS, helpSave }
  function pageList() { return introPages({ chooser, mode: app.mode }) }

  /**
   * @param {{chooser?:boolean, page?:number}} [opts]
   *   chooser: 是否先问"儿童版还是标准版"。开机时只有**没存过模式偏好**的新用户才问；
   *   点「?」进来时总是问，这样老用户也能重选。
   */
  function open(opts = {}) {
    chooser = !!opts.chooser
    page = opts.page ?? 0
    modal.hidden = false
    // 窄屏的抽屉把手和「更多」浮层是常驻元素，卡片打开时得让开（同 D68 里那个 view-open）
    document.body.classList.add('modal-open')
    render()
  }

  function close() {
    stopStage()
    modal.hidden = true
    document.body.classList.remove('modal-open')
    // 看过就记住 —— 无论是看完、跳过还是按 Esc 关掉
    prefs.set('introSeen', '1')
  }

  function stopStage() {
    if (stageTimer) { clearInterval(stageTimer); stageTimer = 0 }
    stageBoard = null
    miniBoards = []
  }

  function render() {
    stopStage()
    const list = pageList()
    const total = list.length
    if (page >= total) page = total - 1
    const cur = list[page]
    const onAct0 = cur === 'act0'

    // 第零幕的两张卡片写在 index.html 里（接线守卫扫得到），不是 innerHTML 拼出来的
    act0El.hidden = !onAct0
    bodyEl.hidden = onAct0

    // 第零幕是个分岔，不是一步：选儿童版之后总共只有三幕，
    // 在这一页就报「第 1 / 6 幕」是在骗人。所以进度指示在这页直接不显示。
    // 留着 stepEl 的位置（只清空文字），否则语言开关会往左塌一格
    dotsEl.hidden = onAct0
    stepEl.textContent = ''
    if (!onAct0) {
      // 主线是三幕，附录是另一组 —— 两者分开数（D76）。
      // 五个一样的点等于说"你还有两幕没看完"，那正是这次要纠正的误解。
      const ACTS = 3
      const shown = chooser ? page : page + 1        // 有第零幕时，第一幕才算第 1 幕
      const appendixCount = appendixPages(list).length
      const inAppendix = shown > ACTS
      stepEl.textContent = inAppendix
        ? t('intro.appendix.step', { n: shown - ACTS, total: appendixCount })
        : t('intro.step', { n: shown, total: ACTS })
      const dot = (i, cls) => `<span class="dot ${cls} ${i === shown ? 'on' : ''}"></span>`
      const acts = Array.from({ length: ACTS }, (_, i) => dot(i + 1, 'dot-act')).join('')
      const apx = Array.from({ length: appendixCount }, (_, i) => dot(ACTS + i + 1, 'dot-apx')).join('')
      dotsEl.innerHTML = acts + (appendixCount ? `<span class="dot-gap"></span>${apx}` : '')
    }
    backBtn.hidden = page === 0
    backBtn.textContent = t('intro.back')
    skipBtn.textContent = t('intro.skip')
    langSeg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.lang === getLang()))

    // 第三幕的主按钮是「开始玩」。附录入口不在这一排 —— 它是正文里的一行链接（D76）：
    // 次级入口塞进主键的位置，会同时坏掉语义、视觉和宽度三件事。
    const isAct3 = cur === 'act3'
    const isLast = page === total - 1
    // 第零幕的动作就是那两张卡片本身，不需要"下一幕"
    nextBtn.hidden = onAct0
    nextBtn.textContent = isAct3 ? t('intro.start') : (isLast ? t('intro.close') : t('intro.next'))

    bodyEl.innerHTML = ''
    if (!onAct0) RENDERERS[cur]()
    // 画布要等布局算完才有尺寸
    requestAnimationFrame(() => { for (const b of miniBoards) b.draw() })
  }

  /* ---------------- 第零幕：选版本 ---------------- */
  // 内容是静态的（写在 index.html，data-i18n 负责文案），这里只是个占位标记
  function actZero() {}

  /** 选版本 = 直接用现有的模式机制，不另起一套状态 */
  function pick(mode) {
    app.setMode(mode, { silent: true })
    prefs.set('mode', mode)          // 与侧栏开关同一个偏好键
    if (app.syncSwitches) app.syncSwitches()
    page = 1                         // 选完就进第一幕
    render()
  }
  pickKid.addEventListener('click', () => pick('simple'))
  pickStd.addEventListener('click', () => pick('full'))

  /* ---------------- 第一幕 ---------------- */
  function act1() {
    bodyEl.innerHTML = `
      <h3>${t('intro.act1.title')}</h3>
      <p class="lead">${t('intro.act1.body')}</p>
      <div class="mini-stage"><canvas id="intro-stage"></canvas></div>
      <p class="caption">${t('intro.act1.caption')}</p>`
    stageBoard = new MiniBoard(20, 12, DEMO_STAGE, { interactive: false })
    stageBoard.attach(document.getElementById('intro-stage'))
    miniBoards = [stageBoard]
    // 自己动起来；跑一阵就摆回去，免得跑空了没得看
    let ticks = 0
    stageTimer = setInterval(() => {
      if (!stageBoard) return
      stageBoard.step()
      if (++ticks >= 48) { stageBoard.reset(); ticks = 0 }
    }, 260)
  }

  /* ---------------- 第二幕：规矩实验角 ---------------- */
  function act2() {
    const demos = [
      { key: 'lonely', w: 7, h: 5, setup: DEMO_LONELY },
      { key: 'crowded', w: 7, h: 5, setup: DEMO_CROWDED },
      { key: 'birth', w: 7, h: 5, setup: DEMO_BIRTH }
    ]
    bodyEl.innerHTML = `
      <h3>${t('intro.act2.title')}</h3>
      <p class="lead">${t('intro.act2.body')}</p>
      <div class="demo-row">
        ${demos.map(d => `
          <div class="demo">
            <b>${t('intro.act2.' + d.key)}</b>
            <canvas class="demo-canvas" id="demo-${d.key}"></canvas>
            <p>${t('intro.act2.' + d.key + '.body')}</p>
            <div class="demo-btns">
              <button data-demo-step="${d.key}">${t('intro.act2.step')}</button>
              <button data-demo-reset="${d.key}">${t('intro.act2.reset')}</button>
            </div>
          </div>`).join('')}
      </div>
      <p class="caption">${t('intro.act2.hint')}</p>`

    miniBoards = demos.map(d => {
      const b = new MiniBoard(d.w, d.h, d.setup)
      b.attach(document.getElementById('demo-' + d.key))
      b.key = d.key
      return b
    })
  }

  /* ---------------- 第三幕 ---------------- */
  function act3() {
    bodyEl.innerHTML = `
      <h3>${t('intro.act3.title')}</h3>
      <p class="lead">${t('intro.act3.body')}</p>
      <p class="caption">${t('intro.act3.caption')}</p>
      <p class="gift">${t('intro.act3.gift')}</p>
      ${pageList().includes('helpAge')
        ? `<button class="appendix-link" data-appendix>${t('intro.appendix.entry')}</button>`
        : ''}`
  }

  /* ---------------- 完整模式的两页参考 ---------------- */
  function helpAge() {
    const r = app.renderer
    const swatch = (color, label) =>
      `<div class="swatch"><span style="background:rgb(${color[0]},${color[1]},${color[2]})"></span><em>${label}</em></div>`
    const ageColor = age => {
      const k = r.ageIdxLUT[Math.min(age, 511)] * 3
      return [r.ageColorLUT[k], r.ageColorLUT[k + 1], r.ageColorLUT[k + 2]]
    }
    const g = r.glowFrames * 3
    bodyEl.innerHTML = `
      <h3>${t('help.age.title')}</h3>
      <p class="lead">${t('help.age.body')}</p>
      <div class="swatch-row">
        ${swatch(ageColor(1), t('help.age.new'))}
        ${swatch(ageColor(6), t('help.age.mid'))}
        ${swatch(ageColor(60), t('help.age.old'))}
        ${swatch([r.glowLUT[g], r.glowLUT[g + 1], r.glowLUT[g + 2]], t('help.age.dead'))}
      </div>`
  }

  function helpBS() {
    const rule = app.engine.rule
    let detail
    if (rule.bsExpressible) {
      const m = /^B([0-8]*)\/S([0-8]*)$/.exec(rule.notation)
      const bDigits = m ? m[1] : ''
      const sDigits = m ? m[2] : ''
      const readable = d => d.split('').join(t('help.bs.or'))
      const bornLine = bDigits
        ? t('help.bs.born', { digits: bDigits, list: readable(bDigits) })
        : t('help.bs.bornNone')
      const survLine = sDigits
        ? t('help.bs.survive', { digits: sDigits, list: readable(sDigits) })
        : t('help.bs.surviveNone')
      detail = `<p class="lead">${t('help.bs.current', { notation: rule.notation })}</p>
        <ul class="bs-read"><li>${bornLine}</li><li>${survLine}</li></ul>`
    } else {
      detail = `<p class="lead">${t('help.bs.none')}</p>`
    }
    bodyEl.innerHTML = `<h3>${t('help.bs.title')}</h3><p class="lead">${t('help.bs.body')}</p>${detail}`
  }

  /**
   * 附录第三页：收藏存在哪儿。
   * 这一页讲的是**边界**，不是功能 —— 内置局人人都有，自存的只在这台设备的这个浏览器里。
   * 用户不该从"换了台电脑收藏没了"这件事上第一次知道它（D83 §4）。
   */
  function helpSave() {
    const line = key => `<li>${t(key)}</li>`
    bodyEl.innerHTML = `
      <h3>${t('help.save.title')}</h3>
      <p class="lead">${t('help.save.body')}</p>
      <ul class="bs-read">
        ${line('help.save.builtin')}
        ${line('help.save.mine')}
        ${line('help.save.move')}
        ${line('help.save.budget')}
        ${line('help.save.submit')}
      </ul>`
  }

  // 第二幕的「走一步 / 摆回去」用事件委托，只绑一次（bodyEl 一直在，每页只换内容）
  bodyEl.addEventListener('click', e => {
    const s = e.target.closest('[data-demo-step]')
    const r = e.target.closest('[data-demo-reset]')
    if (s) { const b = miniBoards.find(x => x.key === s.dataset.demoStep); if (b) b.step() }
    if (r) { const b = miniBoards.find(x => x.key === r.dataset.demoReset); if (b) b.reset() }
  })

  /* ---------------- 导航 ---------------- */

  // 回调只负责"把决策翻译成动作"，决策本身在 introNext 里（纯函数，测试覆盖）
  nextBtn.addEventListener('click', () => {
    const r = introNext(pageList(), page)
    if (r === 'finish') { finish(); return }
    if (r === 'close') { close(); return }
    page = r
    render()
  })
  backBtn.addEventListener('click', () => { if (page > 0) { page--; render() } })
  // 附录入口在正文里，用事件委托接（正文是 innerHTML 重建的，不能直接绑）
  bodyEl.addEventListener('click', e => {
    if (e.target.closest('[data-appendix]')) { page = pageList().indexOf('helpAge'); render() }
  })
  skipBtn.addEventListener('click', close)
  document.getElementById('intro-backdrop').addEventListener('click', close)
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) { close(); e.preventDefault() }
  })

  /** 开始玩：关掉卡片，并送一个滑翔机（棋盘是空的时候才送，免得盖掉已有作品） */
  /**
   * 「开始玩」：导演场到此为止 —— 前两幕已经把"这是个会自己动的世界"讲完了，
   * 第三幕的任务是把场子交给用户，所以收束到一个干净起点 + 一架滑翔机。
   * 无条件执行，因为第三幕的文案就是无条件承诺的（D70）。
   */
  function finish() {
    close()
    app.clear({ silent: true })   // 走既有的清空路径，记账与用户自己点清空完全一致
    placeStarterGift(app.engine)
    app.visual.reconcile(app.engine)
    app.records.noteEdit()        // 棋盘换了，之前攒的哈希作废
    app.markDirtyRun()            // 这局不是种子生成的，不能靠种子重放
    app.captureBaseline()
    app.dirty = true
    app.updateHud()
  }

  return { open, close, relocalize() { if (!modal.hidden) render() } }
}
