// 缩放滑条（D84）：捏合既不可发现、也不精确，这里给它一份看得见、按得准的。
//
// 三件事在这个模块里合成一件：滑条本身、播放时的自动淡出、HUD 上那个可点击的倍数。
// 它们共用同一个真相 —— `app.viewport.scale`。滑条不持有自己的状态：
// 捏合、滚轮、适配视图改了缩放，滑条跟着走；反过来也一样。
// 两份状态互相同步是这个项目栽过的坑（幽灵与落子曾各算一份朝向，D81），不再犯第二次。
import { fitScaleOf, zoomFromSlider, sliderFromZoom, ZOOM_STEPS } from '../render/viewport.js'
import { attachNumericEntry } from './numeric-entry.js'
import { t } from '../i18n/index.js'
import { prefs } from './prefs.js'
import { onTap } from './tap.js'

/** 一按 ＋/－ 走全程的 10%。按的是**行程**不是倍数，于是和滑条是同一把刻度。 */
export const ZOOM_BUTTON_STEP = ZOOM_STEPS / 10

/** 播放后多久淡出。2 秒：够看清它在哪，又不至于一直挡着棋盘。 */
export const DIM_AFTER_MS = 2000

/** 拖完之后倍数还留多久。短了看不清最后落在哪一档，长了变成常驻标签。 */
export const READOUT_MS = 900

/**
 * 倍数文字。滑条与 HUD 用同一个函数 —— 两处显示同一个量，就不该有两种写法。
 */
export function zoomLabel(scale) {
  return `${Number(scale).toFixed(1)}×`
}

/**
 * 用户键入的倍数 → 数字。允许他把「×」一起打进去（他看到的就是「8.0×」）。
 * 认不出回 null：当作这次不改，而不是回落成某个值。
 */
export function parseZoomInput(text) {
  const s = String(text).replace(/[×xX*]/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function setupZoomBar(app) {
  const $ = id => document.getElementById(id)
  const el = {
    bar: $('zoombar'), range: $('in-zoom'), readout: $('zoom-readout'),
    zin: $('btn-zoom-in'), zout: $('btn-zoom-out'),
    toggle: $('in-zoombar'), hud: $('hud-scale')
  }

  let dragging = false        // 拖动中：别让每帧的 sync 把滑条从手底下拽走
  let dimTimer = 0
  let readoutTimer = 0

  /**
   * 这一刻的两端：最小档 = 适配视图（与 `fitView()` 同一个函数算出来的），
   * 最大档 = 视口本来就有的上限。棋盘大小、画布尺寸一变，两端跟着变 ——
   * 所以每次用都现算，不缓存。
   */
  function ends() {
    const c = app.canvas
    const fit = fitScaleOf(c.width, c.height, app.engine.w, app.engine.h)
    return { fit, max: app.viewport.maxScale }
  }

  /** 把缩放设成某个倍数，**以画布中心为锚**（滑条不在画布上，没有别的锚点可言） */
  function zoomTo(scale) {
    const vp = app.viewport
    const c = app.canvas
    if (!(c.width > 1 && c.height > 1) || !(vp.scale > 0)) return
    vp.zoomAt(c.width / 2, c.height / 2, scale / vp.scale)
    app.dirty = true
    app.updateHud()
  }

  /** 滑条动了 */
  function applySlider() {
    const { fit, max } = ends()
    zoomTo(zoomFromSlider(Number(el.range.value), fit, max))
    flashReadout()
  }

  /** 拖动时显示倍数。窄屏 HUD 上没有「缩放」那一项（第 4 项起就藏了），这是那里唯一的读数。 */
  function flashReadout() {
    el.readout.textContent = zoomLabel(app.viewport.scale)
    el.readout.hidden = false
    clearTimeout(readoutTimer)
    readoutTimer = setTimeout(() => { el.readout.hidden = true }, READOUT_MS)
  }

  /** 把滑条同步到当前缩放（捏合 / 滚轮 / 适配视图 / 改棋盘大小之后） */
  function sync() {
    if (dragging) return
    const { fit, max } = ends()
    const v = String(sliderFromZoom(app.viewport.scale, fit, max))
    if (el.range.value !== v) el.range.value = v
  }

  /* ---------------- 自动淡出（②） ---------------- */

  /**
   * 播放时 2 秒后淡出，只留 ＋/－ 微弱可见 —— 棋盘是主角，滑条不该一直压在上面。
   * 碰一下画布就浮回来：那正是"我又要动视图了"的信号。
   * 暂停时永远不淡出 —— 那时用户多半正在调构图。
   */
  function wake() {
    el.bar.classList.remove('dim')
    clearTimeout(dimTimer)
    if (app.running) dimTimer = setTimeout(() => el.bar.classList.add('dim'), DIM_AFTER_MS)
  }

  function onRunning() { wake() }

  /* ---------------- 开关（③） ---------------- */

  function applyEnabled(on) {
    el.bar.hidden = !on
    el.toggle.checked = on
    if (on) wake()
  }

  function setEnabled(on) {
    applyEnabled(on)
    // 这是界面偏好，允许落 localStorage（D30 白名单里新加的第四样，理由见 D84 ③）
    prefs.set('zoomBar', on ? '1' : '0')
  }

  /* ---------------- 接线 ---------------- */

  el.range.addEventListener('input', applySlider)
  el.range.addEventListener('pointerdown', () => { dragging = true; wake() })
  const stopDrag = () => { dragging = false; sync() }
  el.range.addEventListener('pointerup', stopDrag)
  el.range.addEventListener('pointercancel', stopDrag)
  el.range.addEventListener('blur', stopDrag)

  /**
   * 方向键的让位（④）。滑条是个 `input`，聚焦时方向键归它 ——
   * 而选中图案时方向键是**微调幽灵**的（D80 ③）。两个都想要同一组键，
   * 就得有一个显式让位，不能靠"谁先绑谁赢"（D81 §4 的规矩）。
   * 让位的是滑条：图案摆位是当下的动作，缩放不是。
   */
  el.range.addEventListener('keydown', e => {
    if (!app.stamp || !e.key.startsWith('Arrow')) return
    e.preventDefault()              // 滑条不动
    app.nudgeStamp(e.key)           // 走图案微调那条现成的路，不另写一份
  })

  const stepBy = d => () => {
    el.range.value = String(Math.min(ZOOM_STEPS, Math.max(0, Number(el.range.value) + d)))
    applySlider()
    wake()
  }
  // 同画笔开关：这两颗也浮在画布上、也贴着屏幕边 —— 按"抬手"算点击（D128）。
  // **这个毛病是老的**：它们一直靠合成 click，与画笔那批改动无关。
  onTap(el.zin, stepBy(ZOOM_BUTTON_STEP))
  onTap(el.zout, stepBy(-ZOOM_BUTTON_STEP))

  el.toggle.addEventListener('change', () => setEnabled(el.toggle.checked))

  // HUD 上的倍数：点一下直接输入（③）。用的是 D80 那套机制，只是多了一层换算 ——
  // 滑条存的是对数档位，用户读写的是"几倍"。
  attachNumericEntry(el.range, el.hud, {
    ariaLabel: 'zoom',
    toDisplay: () => zoomLabel(app.viewport.scale),
    fromDisplay: text => {
      const n = parseZoomInput(text)
      if (n === null) return null
      const { fit, max } = ends()
      return sliderFromZoom(n, fit, max)
    }
  })

  /** ＋/－ 与滑条本身没有可见的文字标签，无障碍名字只能从词典来 */
  function relocalize() {
    el.zin.setAttribute('aria-label', t('zoom.in'))
    el.zout.setAttribute('aria-label', t('zoom.out'))
    el.range.setAttribute('aria-label', t('hud.zoom'))
  }

  // 开机：偏好里存过就照办，没存过默认开着。开机这一次**只应用不回写** ——
  // 没设置过的人不该因为打开一次页面就多出一条偏好记录。
  applyEnabled(prefs.get('zoomBar', '1') !== '0')
  relocalize()
  sync()

  return { sync, wake, onRunning, setEnabled, relocalize }
}
