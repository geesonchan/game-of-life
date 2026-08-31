// 临界实验室的界面（D86）。判据、扫描、分岔的逻辑全在 data/critical.js 与 data/twin.js 里，
// 这里只管：接线、画图、把"这个数是被什么裁出来的"写在图注上。
import {
  CRITICAL_SPEC, CURVE_METRICS, densityAxis, emergenceWindows, findCrossings,
  isEmergent, isLongTransient, round3
} from '../data/critical.js'
import { createTwin, TWIN, TWIN_EXAMPLES, diffCells } from '../data/twin.js'
import { attachNumericEntry } from './numeric-entry.js'
import { t } from '../i18n/index.js'

const $ = id => document.getElementById(id)

/** 七类结局的颜色。与勘探器表格里的 .out-* 同一套语义，这里取它们的主色。 */
const OUTCOME_COLOR = {
  complex: '#7ee787', longCycle: '#7aa2f7', shortCycle: '#9ece6a',
  still: '#8b93a7', explosion: '#e0925f', extinct: '#c98aa6', quickDeath: '#8a7480'
}

/** 缩略图的边长（格）。200 的棋盘按 2 格一像素折半，够看出"末态长什么样"。 */
const THUMB = 100

export function createCriticalView(app) {
  const el = {
    view: $('crit-view'), back: $('crit-back'), stat: $('crit-stat'),
    progress: $('crit-progress'), bar: $('crit-progress-bar'), progressText: $('crit-progress-text'),
    empty: $('crit-empty'), strip: $('crit-strip'), specNote: $('crit-spec-note'),
    metric: $('crit-metric'), curve: $('crit-curve'), curveNote: $('crit-curve-note'),
    density: $('crit-density'), lblDensity: $('crit-lbl-density'), preview: $('crit-preview'),
    start: $('crit-start'), stop: $('crit-stop'),
    twinPick: $('crit-twin-pick'), twinA: $('crit-twin-a'), twinB: $('crit-twin-b'),
    twinChart: $('crit-twin-chart'), twinNote: $('crit-twin-note'),
    twinRun: $('crit-twin-run'), twinReset: $('crit-twin-reset')
  }

  let worker = null
  let samples = []          // CriticalSample[]，按密度升序
  let metric = 'final'
  let open = false
  let twin = null, twinKey = 'lonely', twinTimer = 0

  /* ---------------- 扫描 ---------------- */

  function start() {
    samples = []
    render()
    showProgress(0, densityAxis().length)
    el.start.disabled = true
    el.stop.disabled = false
    if (worker) worker.terminate()
    worker = new Worker(new URL('../workers/critical.js', import.meta.url), { type: 'module' })
    worker.onmessage = ev => {
      const m = ev.data
      if (m.type === 'sample') {
        samples.push(m.sample)
        samples.sort((a, b) => a.density - b.density)
        showProgress(m.done, m.total)
        render()                       // 边跑边填，不必等整条轴跑完
      } else if (m.type === 'done') {
        finish()
        app.toast(t('crit.doneMsg', { n: m.total }))
      } else if (m.type === 'error') {
        finish()
        app.toast(m.message)
      }
    }
    worker.postMessage({ type: 'sweep' })
  }

  function stop() { if (worker) { worker.terminate(); worker = null } finish() }

  function finish() {
    el.progress.hidden = true
    el.start.disabled = false
    el.stop.disabled = true
    if (worker) { worker.terminate(); worker = null }
  }

  function showProgress(done, total) {
    el.progress.hidden = false
    el.bar.style.width = `${total ? Math.round(done / total * 100) : 0}%`
    el.progressText.textContent = t('crit.progress', { done, total })
  }

  /* ---------------- 小多图带 ---------------- */

  /** 末态画成缩略图。亮格数 = 该档的 final —— 缩略图不许撒谎，测试盯着这条。 */
  function thumbCanvas(sample) {
    const c = document.createElement('canvas')
    c.width = THUMB; c.height = THUMB
    c.className = 'crit-thumb'
    const ctx = c.getContext('2d')
    const img = ctx.createImageData(THUMB, THUMB)
    const px = img.data
    for (let i = 0; i < px.length; i += 4) { px[i] = 14; px[i + 1] = 16; px[i + 2] = 21; px[i + 3] = 255 }
    const n = sample.board
    const k = n / THUMB
    for (const idx of sample.finalCells) {
      const x = Math.floor((idx % n) / k), y = Math.floor(Math.floor(idx / n) / k)
      const o = (y * THUMB + x) * 4
      px[o] = 126; px[o + 1] = 231; px[o + 2] = 135
    }
    ctx.putImageData(img, 0, 0)
    return c
  }

  function renderStrip() {
    el.empty.hidden = samples.length > 0
    el.strip.innerHTML = ''
    for (const s of samples) {
      const card = document.createElement('figure')
      card.className = 'crit-card' + (isEmergent(s) ? ' emergent' : '')
      card.appendChild(thumbCanvas(s))
      const cap = document.createElement('figcaption')
      const dot = `<i class="crit-dot" style="background:${OUTCOME_COLOR[s.outcome] || '#888'}"></i>`
      cap.innerHTML = `<b>${s.density.toFixed(3)}</b>${dot}` +
        `<em>${t('crit.card', { gens: s.gens, final: s.final })}</em>` +
        (isLongTransient(s) ? `<em class="crit-long">${t('crit.longTransient')}</em>` : '')
      card.appendChild(cap)
      card.title = t('crit.cardTip', {
        density: s.density.toFixed(3), outcome: t('out.' + s.outcome),
        gens: s.gens, peak: s.peak, final: s.final
      })
      el.strip.appendChild(card)
    }
    el.specNote.textContent = t('crit.specNote', {
      board: CRITICAL_SPEC.board, seed: CRITICAL_SPEC.seed, cap: CRITICAL_SPEC.genCap
    })
  }

  /* ---------------- 曲线 ---------------- */

  function renderCurve() {
    const c = el.curve
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(320, c.clientWidth) , h = 220
    c.width = w * dpr; c.height = h * dpr
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#12151c'
    ctx.fillRect(0, 0, w, h)
    if (!samples.length) return

    const pad = { l: 46, r: 10, t: 12, b: 24 }
    const x0 = pad.l, x1 = w - pad.r, y0 = pad.t, y1 = h - pad.b
    const dMin = samples[0].density, dMax = samples[samples.length - 1].density
    const vals = samples.map(s => s[metric])
    const vMax = Math.max(1, ...vals)
    const px = d => x0 + (x1 - x0) * (dMax === dMin ? 0.5 : (d - dMin) / (dMax - dMin))
    const py = v => y1 - (y1 - y0) * (v / vMax)

    // 涌现窗口的阴影：连续"有戏"的那一段
    ctx.fillStyle = 'rgba(126, 231, 135, 0.10)'
    for (const win of emergenceWindows(samples)) {
      ctx.fillRect(px(win.from), y0, Math.max(2, px(win.to) - px(win.from)), y1 - y0)
    }
    // 跨越点：两条竖线，夹住那一段
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.setLineDash([3, 3])
    for (const cr of findCrossings(samples)) {
      for (const d of [cr.lo, cr.hi]) {
        ctx.beginPath(); ctx.moveTo(px(d), y0); ctx.lineTo(px(d), y1); ctx.stroke()
      }
    }
    ctx.setLineDash([])

    // 轴
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.beginPath(); ctx.moveTo(x0, y1); ctx.lineTo(x1, y1); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.stroke()
    ctx.fillStyle = '#8b93a7'
    ctx.font = '10px ui-monospace, Menlo, monospace'
    ctx.fillText(String(vMax), 4, y0 + 8)
    ctx.fillText('0', 4, y1)
    ctx.fillText(dMin.toFixed(2), x0, h - 6)
    ctx.fillText(dMax.toFixed(2), x1 - 22, h - 6)

    // 折线 + 逐点按结局上色
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.beginPath()
    samples.forEach((s, i) => { const X = px(s.density), Y = py(s[metric]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y) })
    ctx.stroke()
    for (const s of samples) {
      ctx.fillStyle = OUTCOME_COLOR[s.outcome] || '#888'
      ctx.beginPath(); ctx.arc(px(s.density), py(s[metric]), isLongTransient(s) ? 4.5 : 3, 0, Math.PI * 2); ctx.fill()
      if (isLongTransient(s)) {          // 长暂态：空心圈，与实心点分开
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(px(s.density), py(s[metric]), 7, 0, Math.PI * 2); ctx.stroke()
      }
    }

    const cr = findCrossings(samples)
    el.curveNote.textContent = t('crit.curveNote', {
      metric: t('crit.metric.' + metric),
      crossings: cr.length ? cr.map(c => `${c.lo.toFixed(3)}–${c.hi.toFixed(3)}`).join(' / ') : '—',
      long: samples.filter(isLongTransient).length
    })
  }

  /* ---------------- 临界滑块 ---------------- */

  /** 拖动时切到最近的那一档，显示它的末态与数字。没跑过就说没跑过。 */
  function renderPreview() {
    const want = round3(Number(el.density.value) / 1000)
    el.lblDensity.textContent = want.toFixed(3)
    el.preview.innerHTML = ''
    if (!samples.length) { el.preview.textContent = t('crit.preview.none'); return }
    let best = samples[0]
    for (const s of samples) if (Math.abs(s.density - want) < Math.abs(best.density - want)) best = s
    const big = thumbCanvas(best)
    big.classList.add('crit-thumb-big')
    el.preview.appendChild(big)
    const p = document.createElement('p')
    p.className = 'note'
    p.textContent = t('crit.preview', {
      density: best.density.toFixed(3), outcome: t('out.' + best.outcome),
      gens: best.gens, peak: best.peak, final: best.final
    })
    el.preview.appendChild(p)
  }

  /* ---------------- 分岔时刻 ---------------- */

  function resetTwin() {
    stopTwin()
    const ex = TWIN_EXAMPLES.find(x => x.key === twinKey) || TWIN_EXAMPLES[0]
    twin = createTwin({ pattern: ex.pattern, dx: ex.dx, dy: ex.dy })
    drawTwin()
  }

  function stopTwin() { if (twinTimer) { clearInterval(twinTimer); twinTimer = 0 } el.twinRun.classList.remove('running') }

  function runTwin() {
    if (twinTimer) { stopTwin(); return }
    el.twinRun.classList.add('running')
    twinTimer = setInterval(() => {
      if (!twin || twin.done) { stopTwin(); drawTwin(); return }
      twin.run(6)                    // 一帧走 6 代：看得清，又不至于等太久
      drawTwin()
    }, 60)
  }

  /** 两块小画布 + 差异曲线。差异格在 B 上另色高亮。 */
  function drawTwin() {
    if (!twin) return
    const n = twin.spec.board
    const hi = new Set(diffCells(twin.a, twin.b))
    paintBoard(el.twinA, twin.a, n, null)
    paintBoard(el.twinB, twin.b, n, hi)
    drawDiffChart()
    const d = twin.diff[twin.diff.length - 1]
    el.twinNote.textContent = t('crit.twinNote', {
      gen: twin.gen, diff: d,
      diverged: twin.diverged ? t('crit.diverged', { gen: twin.diverged.gen }) : t('crit.notDiverged'),
      merged: twin.merged ? t('crit.merged', { gen: twin.merged.gen }) : '—',
      r: TWIN.escapeRadius, m: TWIN.mergeGens
    })
  }

  /**
   * 一格一像素地画整盘，再交给 CSS 放大（image-rendering: pixelated）。
   * 不降采样是有意的：差异往往只有几格，一降采样就把"差在哪儿"抹平了 ——
   * 而这一节要看的正是那几格。
   */
  function paintBoard(canvas, engine, n, highlight) {
    canvas.width = n; canvas.height = n
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(n, n)
    const px = img.data
    const cur = engine.cur
    for (let i = 0; i < cur.length; i++) {
      const o = i * 4
      const on = cur[i] === 1
      px[o] = on ? 126 : 14; px[o + 1] = on ? 231 : 16; px[o + 2] = on ? 135 : 21; px[o + 3] = 255
    }
    if (highlight) {
      for (const i of highlight) {
        const o = i * 4
        px[o] = 255; px[o + 1] = 138; px[o + 2] = 96      // 差异格另色
      }
    }
    ctx.putImageData(img, 0, 0)
  }

  function drawDiffChart() {
    const c = el.twinChart
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(320, c.clientWidth), h = 120
    c.width = w * dpr; c.height = h * dpr
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#12151c'; ctx.fillRect(0, 0, w, h)
    const series = twin.diff
    const vMax = Math.max(1, ...series)
    // 横轴跟着已经跑到的代数走，而不是钉在上限上 ——
    // 钉在上限的话，前一百代全挤在最左边 3% 里，而那正是分道扬镳发生的地方
    const span = Math.max(120, twin.gen)
    const px = i => (w - 8) * (i / span) + 4
    const py = v => h - 12 - (h - 24) * (v / vMax)
    ctx.strokeStyle = '#ff8a60'
    ctx.beginPath()
    series.forEach((v, i) => { const X = px(i), Y = py(v); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y) })
    ctx.stroke()
    const mark = (gen, color) => {
      ctx.strokeStyle = color; ctx.setLineDash([3, 3])
      ctx.beginPath(); ctx.moveTo(px(gen), 4); ctx.lineTo(px(gen), h - 10); ctx.stroke()
      ctx.setLineDash([])
    }
    if (twin.diverged) mark(twin.diverged.gen, '#e0925f')
    if (twin.merged) mark(twin.merged.gen, '#7aa2f7')
    ctx.fillStyle = '#8b93a7'
    ctx.font = '10px ui-monospace, Menlo, monospace'
    ctx.fillText(String(vMax), 4, 12)
  }

  function renderTwinPick() {
    el.twinPick.innerHTML = TWIN_EXAMPLES.map(ex =>
      `<button data-twin="${ex.key}" class="${ex.key === twinKey ? 'on' : ''}">${t(ex.nameKey)}</button>`).join('')
  }

  /* ---------------- 渲染总入口 ---------------- */

  function render() {
    if (!open) return
    renderStrip()
    renderCurve()
    renderPreview()
    renderTwinPick()
    el.stat.textContent = samples.length
      ? t('crit.stat', { n: samples.length, windows: emergenceWindows(samples).map(x => `${x.from.toFixed(2)}–${x.to.toFixed(2)}`).join(' ') || '—' })
      : ''
  }

  /* ---------------- 接线 ---------------- */

  el.back.addEventListener('click', () => app.openView(null))
  el.start.addEventListener('click', start)
  el.stop.addEventListener('click', stop)
  el.metric.addEventListener('click', e => {
    const b = e.target.closest('[data-metric]')
    if (!b || !CURVE_METRICS.includes(b.dataset.metric)) return
    metric = b.dataset.metric
    el.metric.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.metric === metric))
    renderCurve()
  })
  el.density.addEventListener('input', renderPreview)
  attachNumericEntry(el.density, el.lblDensity, {
    ariaLabel: 'density',
    toDisplay: v => (Number(v) / 1000).toFixed(3),
    fromDisplay: text => {
      const n = Number(String(text).trim())
      return Number.isFinite(n) ? Math.round(n * 1000) : null
    }
  })
  el.twinPick.addEventListener('click', e => {
    const b = e.target.closest('[data-twin]')
    if (!b) return
    twinKey = b.dataset.twin
    renderTwinPick()
    resetTwin()
  })
  el.twinRun.addEventListener('click', runTwin)
  el.twinReset.addEventListener('click', resetTwin)

  return {
    show() { open = true; el.view.hidden = false; if (!twin) resetTwin(); render() },
    hide() { open = false; el.view.hidden = true; stopTwin() },
    relocalize() { if (open) render() },
    /** 供测试与调试：当前扫描结果 */
    samples: () => samples.slice()
  }
}
