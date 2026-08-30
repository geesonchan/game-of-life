// 阶段 5 的界面层：存档下载/读取（带重放进度条）、RLE 导入、框选导出。
// 引擎与数据层只管纯逻辑；这里负责文件、进度、以及把错误码翻成人话。
import { buildSave, parseSave, saveToText, restoreInitial, boardBaseline } from '../engine/save.js'
import { parseRLE, boardToRLE } from '../engine/rle.js'
import { centerOrigin, placePattern } from '../engine/patterns.js'
import { t } from '../i18n/index.js'

const $ = id => document.getElementById(id)
const REPLAY_CHUNK = 400          // 每帧最多重放多少代，保证进度条能画出来
const PROGRESS_THRESHOLD_MS = 1000 // 预计一秒内跑完的重放不弹进度条

/**
 * 要不要弹进度条：跑完第一片之后按实测速度外推总耗时，超过阈值才弹。
 * 这样判据与棋盘大小、机器快慢自动挂钩 —— 500×500 上的两千代和 100×100 上的两千代
 * 不是一回事，写死一个"多少代以上才弹"是不对的。
 * 抽成纯函数是为了能直接测，不用去戳异步的 rAF 分片。
 * @param {number} elapsedMs 已经花掉的毫秒 @param {number} done 已重放代数
 * @param {number} total 总代数 @param {number} [thresholdMs]
 */
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

export function shouldShowProgress(elapsedMs, done, total, thresholdMs = PROGRESS_THRESHOLD_MS) {
  if (done <= 0 || done >= total) return false
  return (elapsedMs / done) * total > thresholdMs
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
    let done = 0
    let barShown = false
    const startedAt = performance.now()

    const stepChunk = () => {
      const n = Math.min(REPLAY_CHUNK, total - done)
      for (let i = 0; i < n; i++) app.replayStep(total - done - i)
      done += n

      // 短局不弹进度条：跑完第一片之后按实测速度估算总耗时，
      // 预计一秒内能完事就干脆不弹，免得闪一下反而像出了故障
      if (!barShown && shouldShowProgress(performance.now() - startedAt, done, total)) {
        barShown = true
        showProgress(done, total)
      } else if (barShown) {
        showProgress(done, total)
      }

      if (done < total) { requestAnimationFrame(stepChunk); return }
      app.records.setReplaying(false)
      hideProgress()
      finishLoad(replayTo)
    }
    requestAnimationFrame(stepChunk)
  }

  function finishLoad(gen) {
    app.engine.generation = gen
    app.records.renderPanel()
    app.chart.draw(app.series, app.renderer.flat)
    app.updateHud()
    app.dirty = true
    app.toast(t('io.loaded', { gen }))
  }

  function showProgress(gen, total) {
    el.progress.hidden = false
    const pct = total === 0 ? 100 : Math.round((gen / total) * 100)
    el.progressBar.style.width = pct + '%'
    el.progressText.textContent = t('io.replaying', { gen, total })
  }
  function hideProgress() { el.progress.hidden = true }

  /* ---------------- RLE 导入 ---------------- */

  function setButtons(on) {
    el.rleCenter.disabled = !on
    el.rleStamp.disabled = !on
  }
  setButtons(false)

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
