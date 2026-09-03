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
import { attachScrollHint } from './scroll-hint.js'

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
// **四条规矩，四张卡**（D131）。规则本来就是四条（B3/S23 的 S 是"2 或 3"两个数），
// 从前只讲三条，把"活下去"那一条漏了。
//
// **顺序：先生、再活、再讲两种死法**（作者定）：
//   · 从前是"死 / 死 / 生" —— 一上来两条都是死，读着压抑，
//     而最要紧的"生"被排在最不容易读到的位置；
//   · 现在前两条讲怎么留下来、后两条讲什么时候留不住，两两成对；
//   · 孤单与拥挤是同一件事的两端（少了 / 多了），相邻着讲，
//     "正合适是 2 到 3 个"这个区间自然浮出来；
//   · 而"存活"正是那个区间本身，排在两种死法之前，后面两条就是"低于它"和"高于它"。
const DEMO_BIRTH = [[2, 1], [3, 1], [2, 2]]                       // 空位 (3,2) 旁边刚好 3 个 → 冒出新的
// **存活那一张用方块**，而且从图案库里取（D130 那条：引导演示的东西面板里要拿得到）。
// **实测：方块每格有 3 个邻居**（不是 2）—— 3 落在"2 或 3"的**上沿**，
// 紧挨着下一张"多于 3 就死"的门槛，于是那个区间的两头在相邻两张卡上都看得见。
const DEMO_SURVIVE = getPattern('block').cells.map(([x, y]) => [x + 2, y + 1])
const DEMO_LONELY = [[2, 2], [3, 2]]                              // 各只有 1 个朋友 → 都会没
const DEMO_CROWDED = [[2, 1], [3, 1], [4, 1], [2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3]] // 实心块，中间闷死留个洞
/**
 * 第一幕：会自己动的一小台戏。
 *
 * **有名字的那几样，从图案库里取，不手抄坐标**（D130 / §12 第六面）。
 * 从前这里是三组手写坐标，注释里叫它们"滑翔机 / 闪灯 / 方块"——
 * 而**闪灯当时根本不在图案库里**：第一幕给你看它、第二幕讲完规矩、面板里却拿不到。
 * 那种缺口跨了两个模块，没有任何守卫会红。
 *
 * 现在这份清单是**真的依赖**：`pattern` 那几项从 `getPattern()` 取，
 * 库里没有就当场抛。守卫据此扫"引导演示过的东西，面板里是否拿得到"。
 * 最后那一样没有名字（只是"会变形几步的"），所以照旧写坐标，
 * 并**明写它不是库里的东西** —— 没被命名就不构成"给得了"的承诺。
 */
const STAGE_PIECES = [
  { pattern: 'glider', at: [1, 1] },        // 会走路的
  { pattern: 'blinker', at: [12, 2] },      // 一开一合的
  { pattern: 'block', at: [16, 8] },        // 一动不动的
  { raw: [[7, 7], [8, 7], [9, 7], [8, 8]], why: '会变形几步的 —— 没有名字，也不在图案库里' }
]

const DEMO_STAGE = STAGE_PIECES.flatMap(piece => piece.raw
  ? piece.raw
  : getPattern(piece.pattern).cells.map(([x, y]) => [x + piece.at[0], y + piece.at[1]]))

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
  // 「下面还有东西」的提示（D118）：换幕之后要手动 refresh —— 换内容不触发滚动事件
  const bodyHint = attachScrollHint(bodyEl)
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
    // 引导**彻底关掉之后**，才轮到"必须被读到"的那件事（D110 §31）。
    // 推迟一帧：两个弹层叠在一起谁也读不清，而这句话必须被读到。
    // 这里只发一个"我关了"的事件 —— 呈现由那个唯一的渲染者决定（不在这儿判断）。
    if (app.presentNotice) requestAnimationFrame(() => app.presentNotice())
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
    // 换幕之后重算"下面还有没有"（D118）—— 换内容不会触发滚动事件。
    // **同步算，不等 rAF**：读 scrollHeight 本来就会把待办的布局结算掉，所以此刻量得准；
    // 而"面板隐藏时 rAF 不跑"是这个项目踩过的坑，提示不该押在它身上。
    bodyHint.refresh()
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
    // 顺序即判据：生 → 活 → 孤单 → 拥挤（D131）。编号 i/n 里的 n 由长度来，自动变成 4。
    const demos = [
      { key: 'birth', w: 7, h: 5, setup: DEMO_BIRTH },
      { key: 'survive', w: 7, h: 5, setup: DEMO_SURVIVE },
      { key: 'lonely', w: 7, h: 5, setup: DEMO_LONELY },
      { key: 'crowded', w: 7, h: 5, setup: DEMO_CROWDED }
    ]
    bodyEl.innerHTML = `
      <h3>${t('intro.act2.title', { n: demos.length })}</h3>
      <p class="lead">${t('intro.act2.body')}</p>
      <div class="demo-row">
        ${demos.map((d, i) => `
          <div class="demo">
            <b><span class="demo-no">${t('intro.act2.no', { i: i + 1, n: demos.length })}</span>${t('intro.act2.' + d.key)}</b>
            <canvas class="demo-canvas" id="demo-${d.key}"></canvas>
            <p>${t('intro.act2.' + d.key + '.body')}</p>
            <div class="demo-btns">
              <button data-demo-step="${d.key}">${t('intro.act2.step')}</button>
              <button data-demo-reset="${d.key}">${t('intro.act2.reset')}</button>
            </div>
          </div>`).join('')}
      </div>
      <p class="caption">${t('intro.act2.hint')}</p>
      <!-- **把引导讲的东西接上手**（D130）：只**选中**闪灯，不替用户放下 ——
           动手那一下要是他做的（D124：应用别替用户做事）。
           收尾照旧送滑翔机：闪灯是"你试试"，滑翔机是"送你的"，
           合成一个两头都不像。 -->
      <p class="act2-try">
        <span>${t('intro.act2.try')}</span>
        <button id="intro-take-blinker" class="confirm">${t('intro.act2.tryBtn')}</button>
      </p>`

    const take = document.getElementById('intro-take-blinker')
    if (take) {
      take.addEventListener('click', () => {
        app.setStamp(getPattern('blinker'))   // 只选中，不落子
        close()
      })
    }

    miniBoards = demos.map(d => {
      const b = new MiniBoard(d.w, d.h, d.setup)
      b.attach(document.getElementById('demo-' + d.key))
      b.key = d.key
      return b
    })
  }

  /* ---------------- 第三幕 ---------------- */
  /**
   * 第三幕最后那一块：说什么、长什么样。
   * 与 `finish()` 的三条路是**同一个判据**（D70 / D110 §23）。
   *
   * **失败不许穿礼物的衣服**：`.gift` 是那个绿色的"送你一个小家伙"框，
   * 用户见过很多次。把"你的链接没打开"塞进同一个框里，它就读不出是坏消息 ——
   * 作者实测的反馈是"一句话都没有"，而那句话其实在屏幕上（v1.19.1 修）。
   */
  function act3Notice() {
    if (app.shareApplied) return { cls: 'gift', key: 'intro.act3.shared' }
    const intent = app.initialIntent || {}
    // **链接坏了这件事，引导一个字都不说**（D110 §31，作者定：B 案）。
    // 走引导的人正处在"了解这是什么"的状态，不是"处理一个坏消息"的状态；
    // 两件事挤在同一屏，无论怎么排版都会有一件被当成另一件的背景。
    // 换颜色、换排版、换位置都只是在**段落**这个层级做文章 —— 提级的解法是让它离开这一幕。
    // 这里只保留"不承诺送礼"这一半：返回 null = 这一幕不作任何承诺。
    if (intent.brokenLink) return null
    if (intent.starterGift === false) return { cls: 'gift', key: 'intro.act3.shared' }
    return { cls: 'gift', key: 'intro.act3.gift' }
  }

  function act3() {
    const n = act3Notice()
    // n 为 null = 这一幕不作任何承诺（链接坏了那条路，D110 §31）
    const block = n ? `<p class="${n.cls}">${t(n.key)}</p>` : ''
    bodyEl.innerHTML = `
      <h3>${t('intro.act3.title')}</h3>
      <p class="lead">${t('intro.act3.body')}</p>
      <p class="caption">${t('intro.act3.caption')}</p>
      ${block}
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
    // **链接优先**（D107 ③）：棋盘上这一局是别人分享来的，收尾就不能清盘、也不能送滑翔机 ——
    // 否则任何第一次收到链接的人，走完引导看到的都不是分享的那一局。
    // 第三幕的文案在这种情况下也换了一句（不能承诺放小家伙却不放，D70）。
    // **三条路，不是两条**（D110 §23）：
    //   有链接且有效 → 直接返回，不清盘不送礼；
    //   有链接但坏了 → 也不清盘不送礼（第三幕已经明说那条链接没打开）；
    //   没有链接     → 照旧清盘送礼。
    // 从前只分"有链接 / 没链接"，坏链接落进后者：引导清盘送礼，
    // 而"链接坏了"这件事对最需要知道的那个人（正在走引导的第一次访客）隐藏了。
    const intent = app.initialIntent || {}
    if (app.shareApplied || intent.starterGift === false || intent.brokenLink) return
    // **引导收尾是应用做的，不是用户做的**（D124）：清盘 + 送滑翔机整段圈起来，
    // 一个都不进撤销栈 —— 否则用户走完引导按撤销，会退到他从来没见过的导演场。
    app.asAppAction(() => {
      app.clear({ silent: true })   // 走既有的清空路径，记账与用户自己点清空完全一致
      placeStarterGift(app.engine)
    })
    app.visual.reconcile(app.engine)
    app.records.noteEdit()        // 棋盘换了，之前攒的哈希作废
    app.markDirtyRun()            // 这局不是种子生成的，不能靠种子重放
    app.captureBaseline()
    app.dirty = true
    app.updateHud()
  }

  return { open, close, relocalize() { if (!modal.hidden) render() } }
}
