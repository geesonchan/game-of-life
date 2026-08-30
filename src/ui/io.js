// 阶段 5 的界面层：存档下载/读取（带重放进度条）、RLE 导入、框选导出。
// 引擎与数据层只管纯逻辑；这里负责文件、进度、以及把错误码翻成人话。
import { buildSave, parseSave, saveToText, restoreInitial, boardBaseline } from '../engine/save.js'
import { parseRLE, boardToRLE } from '../engine/rle.js'
import { centerOrigin, placePattern } from '../engine/patterns.js'
import { t } from '../i18n/index.js'

const $ = id => document.getElementById(id)
const REPLAY_CHUNK = 400   // 每帧最多重放多少代，保证进度条能画出来

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
    const origin = app.runDirty
      ? { type: 'pattern', rle: boardBaseline(app.engine), gen: app.engine.generation }
      : { type: 'random', seed: app.engine.seed, density: app.engine.density }
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

    // 分片重放，每帧一段，好让进度条真的动起来（一次性跑完的话浏览器只会卡住不刷新）
    showProgress(0, total)
    let done = 0
    const stepChunk = () => {
      const n = Math.min(REPLAY_CHUNK, total - done)
      for (let i = 0; i < n; i++) engine.step()
      done += n
      showProgress(done, total)
      if (done < total) { requestAnimationFrame(stepChunk); return }
      engine.generation = replayTo    // 图案基线局的代数从基线代数续上
      hideProgress()
      app.adoptEngine(engine)
      app.toast(t('io.loaded', { gen: engine.generation }))
    }
    if (total === 0) { engine.generation = replayTo; hideProgress(); app.adoptEngine(engine); app.toast(t('io.loaded', { gen: replayTo })) }
    else requestAnimationFrame(stepChunk)
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

  el.rleExport.addEventListener('click', () => {
    app.setSelecting(!app.selecting)
    el.rleExport.classList.toggle('on', app.selecting)
    app.toast(t(app.selecting ? 'io.rleExportOn' : 'io.rleExportOff'))
  })

  /** 由画布交互在框选完成时回调 */
  app.onSelection = function (x0, y0, w, h) {
    const text = boardToRLE(app.engine, x0, y0, w, h, {
      rule: app.engine.rule.notation || 'B3/S23'
    })
    el.rleText.value = text
    let n = 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (app.engine.get(x0 + x, y0 + y) === 1) n++
    el.rleInfo.className = 'note ok'
    el.rleInfo.textContent = t('io.rleExported', { w, h, n })
    app.setSelecting(false)
    el.rleExport.classList.remove('on')
    parsed = null
    setButtons(false)
  }

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
