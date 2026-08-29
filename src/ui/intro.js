// 三幕介绍卡 + 规矩实验角。
// 迷你棋盘用的就是真正的 LifeEngine 与 Renderer —— 不是画死的示意图，
// 孩子点上去摆的格子，走出来的结果和主棋盘一模一样。
import { LifeEngine } from '../engine/board.js'
import { lifeRule } from '../engine/rules.js'
import { Renderer } from '../render/renderer.js'
import { Viewport } from '../render/viewport.js'
import { VisualState } from '../render/visual-state.js'
import { getPattern, placePattern, centerOrigin } from '../engine/patterns.js'
import { t } from '../i18n/index.js'

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

export function createIntro(app) {
  const modal = document.getElementById('intro-modal')
  const bodyEl = document.getElementById('intro-body')
  const stepEl = document.getElementById('intro-step')
  const dotsEl = document.getElementById('intro-dots')
  const backBtn = document.getElementById('intro-back')
  const nextBtn = document.getElementById('intro-next')
  const moreBtn = document.getElementById('intro-more')
  const skipBtn = document.getElementById('intro-skip')

  let page = 0
  let stageBoard = null
  let stageTimer = 0
  let miniBoards = []

  /** 完整模式多两页参考；简洁模式只有三幕 */
  function pageCount() { return app.mode === 'full' ? 5 : 3 }

  function open(startPage = 0) {
    page = startPage
    modal.hidden = false
    render()
  }

  function close() {
    stopStage()
    modal.hidden = true
  }

  function stopStage() {
    if (stageTimer) { clearInterval(stageTimer); stageTimer = 0 }
    stageBoard = null
    miniBoards = []
  }

  function render() {
    stopStage()
    const total = pageCount()
    stepEl.textContent = t('intro.step', { n: page + 1, total })
    dotsEl.innerHTML = Array.from({ length: total }, (_, i) =>
      `<span class="dot ${i === page ? 'on' : ''}"></span>`).join('')
    backBtn.hidden = page === 0
    backBtn.textContent = t('intro.back')
    skipBtn.textContent = t('intro.skip')

    // 第三幕的主按钮是「开始玩」；完整模式下另给一个通往参考页的次按钮
    const isAct3 = page === 2
    const isLast = page === total - 1
    nextBtn.textContent = isAct3 ? t('intro.start') : (isLast ? t('intro.close') : t('intro.next'))
    moreBtn.hidden = !(isAct3 && total > 3)
    if (!moreBtn.hidden) moreBtn.textContent = t('help.age.title') + ' / ' + t('help.bs.title')

    const renderers = [act1, act2, act3, helpAge, helpBS]
    bodyEl.innerHTML = ''
    renderers[page]()
    // 画布要等布局算完才有尺寸
    requestAnimationFrame(() => { for (const b of miniBoards) b.draw() })
  }

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
      <p class="gift">${t('intro.act3.gift')}</p>`
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

  // 第二幕的「走一步 / 摆回去」用事件委托，只绑一次（bodyEl 一直在，每页只换内容）
  bodyEl.addEventListener('click', e => {
    const s = e.target.closest('[data-demo-step]')
    const r = e.target.closest('[data-demo-reset]')
    if (s) { const b = miniBoards.find(x => x.key === s.dataset.demoStep); if (b) b.step() }
    if (r) { const b = miniBoards.find(x => x.key === r.dataset.demoReset); if (b) b.reset() }
  })

  /* ---------------- 导航 ---------------- */

  nextBtn.addEventListener('click', () => {
    if (page === 2) { finish(); return }              // 第三幕的主按钮 = 开始玩
    if (page >= pageCount() - 1) { close(); return }
    page++
    render()
  })
  backBtn.addEventListener('click', () => { if (page > 0) { page--; render() } })
  moreBtn.addEventListener('click', () => { page = 3; render() })
  skipBtn.addEventListener('click', close)
  document.getElementById('intro-backdrop').addEventListener('click', close)
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) { close(); e.preventDefault() }
  })

  /** 开始玩：关掉卡片，并送一个滑翔机（棋盘是空的时候才送，免得盖掉已有作品） */
  function finish() {
    close()
    if (app.engine.countAlive() === 0) {
      const g = getPattern('glider')
      const o = centerOrigin(g, Math.floor(app.engine.w / 2), Math.floor(app.engine.h / 2))
      placePattern(app.engine, g, o.x, o.y)
      app.engine.stats.alive = app.engine.countAlive()
      app.visual.reconcile(app.engine)
      app.dirty = true
      app.updateHud()
    }
  }

  return { open, close, relocalize() { if (!modal.hidden) render() } }
}
