// 阶段 5 的界面层：存档下载/读取（带重放进度条）、RLE 导入、框选导出。
// 引擎与数据层只管纯逻辑；这里负责文件、进度、以及把错误码翻成人话。
import { buildSave, parseSave, saveToText, restoreInitial, boardBaseline } from '../engine/save.js'
import { parseRLE, boardToRLE } from '../engine/rle.js'
import { centerOrigin, placePattern } from '../engine/patterns.js'
import { liveBounds } from '../data/favorites.js'
import { t } from '../i18n/index.js'
import { runReplay, REPLAY_CHUNK } from './replay-driver.js'

const $ = id => document.getElementById(id)
// 分片重放的驱动器搬到了 replay-driver.js：读档与链接里的 `g=` 走**同一份**（D110 §18）。
// 这里保留 re-export，老的引用（测试、其它模块）不必跟着改名。
export { shouldShowProgress, REPLAY_CHUNK, PROGRESS_THRESHOLD_MS } from './replay-driver.js'

/**
 * 浮出菜单的落点：默认贴在选区右下角外侧，越出画布就往内翻转，保证整块菜单可见。
 * 抽成纯函数是为了能直接测 —— 鼠标事件里的定位逻辑最容易写错又最难复现（D48）。
 * @param {{left:number,top:number,right:number,bottom:number}} sel 选区（画布内的 CSS 像素）
 * @param {{w:number,h:number}} menu 菜单尺寸
 * @param {{w:number,h:number}} stage 画布尺寸
 * @param {number} [gap]
 */
export function placeSelectionMenu(sel, menu, stage, gap = 8) {
  let x = sel.right + gap
  if (x + menu.w > stage.w) x = sel.left - gap - menu.w          // 往左翻
  if (x < gap) x = Math.min(sel.left, Math.max(gap, stage.w - menu.w - gap))
  let y = sel.bottom + gap
  if (y + menu.h > stage.h) y = sel.top - gap - menu.h           // 往上翻
  if (y < gap) y = Math.min(sel.top, Math.max(gap, stage.h - menu.h - gap))
  return { x: Math.round(x), y: Math.round(y) }
}

function download(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 存档/RLE 的错误码 → 人话。错误码由引擎层抛出，形如 "version:99" */
function explain(err) {
  const code = String(err && err.message ? err.message : err).split(':')[0]
  const key = `io.err.${code}`
  const text = t(key)
  return text === key ? t('io.err.unknown') : text
}

export function setupIO(app) {
  const el = {
    save: $('btn-save'), load: $('btn-load'), file: $('in-save-file'),
    progress: $('load-progress'), progressBar: $('load-progress-bar'), progressText: $('load-progress-text'),
    rleText: $('in-rle'), rleImport: $('btn-rle-import'),
    rleCenter: $('btn-rle-center'), rleStamp: $('btn-rle-stamp'),
    rleExport: $('btn-rle-export'), rleCopy: $('btn-rle-copy'), rleInfo: $('rle-info')
  }

  let parsed = null   // 最近一次成功解析的 RLE 图案

  /* ---------------- 存档 ---------------- */

  el.save.addEventListener('click', () => {
    // 手绘/贴过图案的局没法"从种子重放"，改用当前棋盘做 RLE 基线、重放 0 代
    // 手改过的局用"最后一次编辑时"的基线，这样存档里还留着那之后的可重放段落，
    // 读档时年龄着色与统计才回得来；万一没抓到基线（理论上不会）就退回当前棋盘
    const origin = app.runDirty
      ? (app.baseline || { rle: boardBaseline(app.engine), gen: app.engine.generation })
      : { type: 'random', seed: app.engine.seed, density: app.engine.density }
    if (app.runDirty) origin.type = 'pattern'
    const save = buildSave({ engine: app.engine, density: app.density, origin })
    download(`life-${save.seed}-gen${save.generation}.json`, saveToText(save))
    app.toast(t('io.saved', { gen: save.generation }))
  })

  el.load.addEventListener('click', () => el.file.click())
  el.file.addEventListener('change', () => {
    const f = el.file.files && el.file.files[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => { applySave(String(reader.result)); el.file.value = '' }
    reader.onerror = () => { app.toast(t('io.loadFail', { reason: t('io.err.unknown') })); el.file.value = '' }
    reader.readAsText(f)
  })

  function applySave(text) {
    let restored
    try {
      restored = restoreInitial(parseSave(text))
    } catch (e) {
      app.toast(t('io.loadFail', { reason: explain(e) }))
      return
    }
    app.setRunning(false)
    const { engine, replayFrom, replayTo } = restored
    const total = Math.max(0, replayTo - replayFrom)

    // 先把引擎换上，再走**和正常运行完全相同的那条流水线**重放：
    // engine.step → series.push → records.onGeneration → visual.advance。
    // 否则读档回来年龄全是新生白、统计与折线全空 —— 重放本来就在逐代跑，顺路记账几乎不额外花钱。
    engine.generation = replayFrom
    app.adoptEngine(engine)
    if (total === 0) { finishLoad(replayTo); return }

    app.records.setReplaying(true)
    // 短局不弹进度条、秒数按本机实测外推 —— 这两件事都在驱动器里，读档与 g= 共用
    runReplay({
      total,
      chunk: REPLAY_CHUNK,
      step: remaining => app.replayStep(remaining),
      onProgress: p => showProgress(p.done, p.total, p.etaSec),
      onDone: () => {
        app.records.setReplaying(false)
        hideProgress()
        finishLoad(replayTo)
      }
    })
  }

  function finishLoad(gen) {
    app.engine.generation = gen
    app.records.renderPanel()
    app.chart.draw(app.series, app.renderer.flat)
    app.updateHud()
    app.dirty = true
    app.toast(t('io.loaded', { gen }))
  }

  function showProgress(gen, total, etaSec) {
    el.progress.hidden = false
    const pct = total === 0 ? 100 : Math.round((gen / total) * 100)
    el.progressBar.style.width = pct + '%'
    // 那个秒数与驱动器判断"要不要弹条"用的是**同一个外推**（D110 §12）
    el.progressText.textContent = etaSec === null || etaSec === undefined
      ? t('io.replaying', { gen, total })
      : t('io.replayingEta', { gen, total, sec: Math.max(1, Math.round(etaSec)) })
  }
  function hideProgress() { el.progress.hidden = true }

  /* ---------------- RLE 导入 ---------------- */

  function setButtons(on) {
    el.rleCenter.disabled = !on
    el.rleStamp.disabled = !on
  }
  setButtons(false)

  /* ---------- 供收藏用的三个能力（D82）---------- */

  /** 把整盘（或当前选区）导成带 rule 头行的 RLE。没有活格时返回 null。 */
  app.currentLayoutRle = function () {
    const sel = app.selection
    const box = sel
      ? { x: sel.x0, y: sel.y0, w: sel.w, h: sel.h }
      : { x: 0, y: 0, w: app.engine.w, h: app.engine.h }
    // 裁到活细胞的外接框：存下来的是"这个局长什么样"，不是"当时棋盘多大"。
    // 不裁的话整盘收藏会带上 200×200 的头行，日后把棋盘调小就再也复现不了了。
    const b = liveBounds((x, y) => app.engine.get(x, y), box)
    if (!b) return null
    // rule 头行必须带上 —— 「复现」时要按它切规则，没有它保证不了是同一个世界
    return boardToRLE(app.engine, b.x, b.y, b.w, b.h, {
      rule: app.engine.rule.notation || 'B3/S23'
    })
  }

  /** 把一段 RLE 填进面板的输入框并解析（收藏里的「填入 RLE」） */
  app.fillRleBox = function (text) {
    el.rleText.value = text
    el.rleImport.click()
    app.openPanelGroupOf(el.rleText)
  }

  /** 解析一段 RLE 并居中铺到棋盘上（收藏里的「复现」） */
  app.importRleText = function (text, opts = {}) {
    app.assertBoardUnlocked('importRleText')
    let p
    try { p = parseRLE(text) } catch (e) { app.toast(t('io.rleFail', { reason: String(e.message) })); return false }
    if (p.w > app.engine.w || p.h > app.engine.h) { app.toast(t('io.rleTooBig', { w: p.w, h: p.h })); return false }
    // **压栈放在两处拒绝之后**：解析失败 / 装不下的时候什么都没发生，
    // 压一条进去就等于给了一颗撤不出东西的后悔药（§12 第三面那一族：亮着但点了没反应）。
    // `undo: false` 是复合流程用的（载入内置局那条路自己压过一次了）。
    if (opts.undo !== false) app.pushUndoSnapshot('loadFile', { dropPatches: true })
    const ox = opts.center ? ((app.engine.w - p.w) >> 1) : 0
    const oy = opts.center ? ((app.engine.h - p.h) >> 1) : 0
    for (const [x, y] of p.cells) app.engine.set(ox + x, oy + y, 1)
    app.engine.stats.alive = app.engine.countAlive()
    app.visual.reconcile(app.engine)
    app.records.noteEdit()
    app.markDirtyRun()
    app.captureBaseline()
    app.dirty = true
    app.updateHud()
    return true
  }

  /** 下载一段文本（收藏导出用；与存档走同一个下载实现） */
  app.downloadText = function (text, filename) { download(filename, text) }

  el.rleImport.addEventListener('click', () => {
    try {
      parsed = parseRLE(el.rleText.value)
    } catch (e) {
      parsed = null
      setButtons(false)
      el.rleInfo.className = 'note warn'
      el.rleInfo.textContent = t('io.rleFail', { reason: String(e.message) })
      return
    }
    setButtons(true)
    const notes = [t('io.rleParsed', {
      name: parsed.name || t('io.rleNamed'), w: parsed.w, h: parsed.h, n: parsed.cells.length
    })]
    if (parsed.w > app.engine.w || parsed.h > app.engine.h) {
      notes.push(t('io.rleTooBig', { w: parsed.w, h: parsed.h }))
    }
    const cur = app.engine.rule.notation
    if (parsed.rule && cur && parsed.rule.replace(/\s/g, '').toLowerCase() !== cur.toLowerCase()) {
      notes.push(t('io.rleRuleMismatch', { rule: parsed.rule }))
    }
    el.rleInfo.className = notes.length > 1 ? 'note warn' : 'note ok'
    el.rleInfo.textContent = notes.join(' · ')
  })

  el.rleCenter.addEventListener('click', () => {
    if (!parsed) return
    const o = centerOrigin(parsed, app.engine.w >> 1, app.engine.h >> 1)
    const n = placePattern(app.engine, parsed, o.x, o.y)
    afterPlace(n)
  })

  el.rleStamp.addEventListener('click', () => {
    if (!parsed) return
    // 复用图案盒子那套"跟着鼠标走再点一下放下"的机制
    app.setStamp({ key: 'rle', w: parsed.w, h: parsed.h, cells: parsed.cells,
      label: parsed.name || t('io.rleNamed') })
  })

  function afterPlace(n) {
    app.engine.stats.alive = app.engine.countAlive()
    app.visual.reconcile(app.engine)
    app.records.noteEdit()
    app.markDirtyRun()
    app.dirty = true
    app.updateHud()
    app.toast(t('pattern.placed', { name: parsed.name || t('io.rleNamed') }) + ` (${n})`)
  }

  /* ---------------- RLE 框选导出 ---------------- */

  // 侧栏按钮降级为"预备一次框选"的入口之一，不再是常驻模式（D47）
  el.rleExport.addEventListener('click', () => {
    const on = !app.selectArmed
    app.armSelection(on)
    el.rleExport.classList.toggle('on', on)
    if (on) app.toast(t('sel.armed'))
  })

  const menu = { root: $('sel-menu'), size: $('sel-size'), export: $('sel-export'), cancel: $('sel-cancel') }

  function liveCount(sel) {
    let n = 0
    for (let y = 0; y < sel.h; y++) {
      for (let x = 0; x < sel.w; x++) if (app.engine.get(sel.x0 + x, sel.y0 + y) === 1) n++
    }
    return n
  }

  /** 框选松手：选区留着，菜单浮到它旁边 */
  app.onSelectionDone = function (sel) {
    el.rleExport.classList.remove('on')
    menu.size.textContent = t('sel.size', { w: sel.w, h: sel.h, n: liveCount(sel) })
    menu.root.hidden = false

    const vp = app.viewport
    const dpr = app.renderer.dpr
    const stage = app.canvas.getBoundingClientRect()
    const tl = vp.boardToScreen(sel.x0, sel.y0)
    const br = vp.boardToScreen(sel.x0 + sel.w, sel.y0 + sel.h)
    const rect = { left: tl.x / dpr, top: tl.y / dpr, right: br.x / dpr, bottom: br.y / dpr }
    const box = menu.root.getBoundingClientRect()
    const at = placeSelectionMenu(rect, { w: box.width, h: box.height },
      { w: stage.width, h: stage.height })
    menu.root.style.left = at.x + 'px'
    menu.root.style.top = at.y + 'px'
    app.dirty = true
  }

  app.hideSelectionMenu = function () { menu.root.hidden = true }

  menu.cancel.addEventListener('click', () => app.clearSelection())
  menu.export.addEventListener('click', () => {
    const sel = app.selection
    if (!sel) return
    el.rleText.value = boardToRLE(app.engine, sel.x0, sel.y0, sel.w, sel.h, {
      rule: app.engine.rule.notation || 'B3/S23'
    })
    el.rleInfo.className = 'note ok'
    el.rleInfo.textContent = t('io.rleExported', { w: sel.w, h: sel.h, n: liveCount(sel) })
    app.toast(t('io.rleExported', { w: sel.w, h: sel.h, n: liveCount(sel) }))
    parsed = null
    setButtons(false)
    app.clearSelection()
  })

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && app.selection) { app.clearSelection(); e.preventDefault() }
  })

  el.rleCopy.addEventListener('click', async () => {
    const text = el.rleText.value
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      app.toast(t('io.copied'))
    } catch (e) {
      el.rleText.select()
      app.toast(t('io.copyFail'))
    }
  })

  return { applySave }
}
