// 看展模式的运行时（D110 §14）。判据在 src/data/show.js，这里只负责接线。
import { t } from '../i18n/index.js'
import { showPlaylist, nextShowIndex, shouldAutoStart, exitPlan, IDLE_MS } from '../data/show.js'
import { captureSession } from '../data/session.js'
import { prefs } from './prefs.js'

const $ = id => document.getElementById(id)

export function createShow(app) {
  const el = { bar: $('show-bar'), name: $('show-name'), note: $('show-note'),
    next: $('show-next'), exit: $('show-exit'), open: $('btn-show'), never: $('show-never') }

  let on = false
  let paused = false
  let list = []
  let at = -1
  let dueAt = 0
  let snapshot = null        // 进来之前那一刻：格子 + 环境 + 取景
  let loading = false        // 看展自己在换局（这期间的写盘不算"用户动了手"）
  let lastActivity = Date.now()
  let auto = false           // 这一场是自动开的还是他自己点的

  /** 现在在不在看展 —— 别处（写盘入口、自动开演）都问它 */
  function isOn() { return on }
  /** 看展自己写盘的那一小段：写盘入口据此不把它当成用户的动作 */
  function isLoading() { return loading }

  function render() {
    el.bar.hidden = !on
    if (!on) return
    const cur = list[at]
    // rowsForShow() 出来的 name 已经是翻译好的字符串（layoutRows 里就翻过了），
    // 这里再 t() 一次是双重翻译 —— 词典里没这个键，返回的正好是原串，看着像"能用"，
    // 但语言一换就不跟着变了。所以直接用。
    el.name.textContent = cur ? cur.entry.name : '—'
    el.note.textContent = t(paused ? 'show.paused' : 'show.noRecord')
    el.next.textContent = t(paused ? 'show.resume' : 'show.next')
    el.exit.textContent = t('show.exit')
    // 自动开演才给"别再自动开演" —— 自动行为必须在**发生的那一刻**就能关掉，
    // 而不是让人去设置里翻。他自己点进来的那一场不需要这颗。
    el.never.hidden = !auto
  }

  /**
   * 开演。`reason` 只用于说清是谁开的（auto / user）——
   * 两者在优先级表里是**两行**：自动排在链接之前并被链接抑制，手动是用户动作排最后。
   */
  function start(reason) {
    if (on) return false
    list = showPlaylist(app.favorites ? app.favorites.rowsForShow() : [])
    if (!list.length) return false
    // **先存这一刻**：格子 + 环境 + 取景。退出时还的就是它（D110 §11）
    snapshot = captureSession(app.engine, {
      speed: app.speed, view: app.viewIntentNow(), runDirty: app.runDirty, running: app.running
    })
    on = true
    auto = reason === 'auto'
    paused = false
    at = -1
    app.records.setShowing(true)     // **真的不记账**，横幅上那句是它的兑现
    app.toast(t(reason === 'auto' ? 'show.startedAuto' : 'show.started'))
    advance()
    return true
  }

  /** 换到下一局 */
  function advance() {
    if (!on) return
    at = nextShowIndex(at, list.length)
    const cur = list[at]
    loading = true
    try {
      app.replayLayout(cur.entry, { silent: true })
      app.setRunning(true)
    } finally {
      loading = false
    }
    dueAt = Date.now() + cur.dwellMs
    render()
  }

  /**
   * 退出。**只有一种退法：还原那一份快照**（D110 §11）——
   * 不是退回空盘，也不是退回链接那一局。用户没动过时那一刻恰好就是链接那一局，
   * 那是这条规则的特例，不是规则本身。
   */
  function stop(reason) {
    if (!on) return false
    on = false
    paused = false
    const plan = exitPlan(snapshot)
    app.records.setShowing(false)
    if (plan.restore) app.restoreSession(plan.snapshot)
    snapshot = null
    render()
    if (reason !== 'silent') app.toast(t('show.exited'))
    return true
  }

  /** 用户在看展期间自己动手了：先把他那一局还回来，他的动作再落在自己的局上 */
  function yieldToUser() {
    if (!on || loading) return
    stop('silent')
  }

  function pause() {
    if (!on || paused) return
    paused = true
    app.setRunning(false)
    render()
  }

  function resume() {
    if (!on || !paused) return
    paused = false
    app.setRunning(true)
    dueAt = Date.now() + (list[at] ? list[at].dwellMs : 0)
    render()
  }

  /** 主循环每帧问一次：该换下一局了吗；没在看展时它负责数空闲时间 */
  function tick(now) {
    if (on) {
      if (!paused && now >= dueAt) advance()
      return
    }
    if (prefs.get('autoShow') === '0') return      // 用户关掉了自动开演
    const idleMs = now - lastActivity
    const ok = shouldAutoStart(app.initialIntent, {
      enabled: true,
      idleMs,
      idleAfterMs: IDLE_MS,
      running: app.running,
      boardTouched: app.engine.stats.alive > 0 || app.runDirty,
      viewOpen: !!document.querySelector('.modal:not([hidden])')
    })
    if (ok) start('auto')
  }

  /** 任何用户操作都刷新空闲计时；看展开着时，动画布只是暂停，不退出 */
  function noteActivity() { lastActivity = Date.now() }

  el.open.addEventListener('click', () => { if (!stop('user')) start('user') })
  el.next.addEventListener('click', () => { if (paused) resume(); else advance() })
  el.exit.addEventListener('click', () => stop('user'))
  el.never.addEventListener('click', () => {
    prefs.set('autoShow', '0')
    stop('user')
    app.toast(t('show.neverAgain'))
  })
  for (const ev of ['pointerdown', 'keydown', 'wheel']) {
    window.addEventListener(ev, e => {
      noteActivity()
      if (!on) return
      // 画布上的手势：暂停让他看，不退出（退出要么点那颗按钮，要么他真的动了棋盘）
      if (e.target && e.target.id === 'board') pause()
    }, { passive: true })
  }

  return { isOn, isLoading, start, stop, pause, resume, tick, yieldToUser, noteActivity,
    relocalize: render, _internals: { get list() { return list }, get at() { return at } } }
}
