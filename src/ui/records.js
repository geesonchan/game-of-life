// 阶段 4 的界面层：把数据层的记录接到面板与总结卡片上。
// 数据层只产出 {key, params}，这里负责按词典渲染成句子（D22）。
import { SnapshotLog } from '../data/snapshots.js'
import { TerminationDetector } from '../data/detector.js'
import { Chronicle } from '../data/chronicle.js'
import { Ledger } from '../data/ledger.js'
import { toCSV, SNAPSHOT_COLUMNS, LEDGER_COLUMNS } from '../data/csv.js'
import { t } from '../i18n/index.js'

const $ = id => document.getElementById(id)
const MAX_TIMELINE = 40      // 时间线上最多显示多少条，太长了没人看
const MAX_LEDGER_ROWS = 20

/** 触发浏览器下载。游戏数据一律走显式文件导出，不进 localStorage（D30） */
function download(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function setupRecords(app) {
  const log = new SnapshotLog()
  const detector = new TerminationDetector()
  const chronicle = new Chronicle()
  const ledger = new Ledger()

  const el = {
    snapshots: $('lbl-snapshots'), snapshotInfo: $('lbl-snapshot-info'), hashInfo: $('lbl-hash-info'),
    timeline: $('chronicle-list'), ledgerList: $('ledger-list'),
    genLimit: $('in-gen-limit'),
    modal: $('summary-modal'), kicker: $('summary-kicker'), title: $('summary-title'),
    line: $('summary-line'), grid: $('summary-grid'), note: $('summary-note'), saved: $('summary-saved'),
    again: $('summary-again'), cont: $('summary-continue'), close: $('summary-close'),
    link: $('summary-link')
  }
  const boxes = {
    extinction: $('det-extinction'), still: $('det-still'), cycle: $('det-cycle'), capped: $('det-capped')
  }

  let replaying = false     // 读档重放期间：照常记账，但不做终止判定
  // 看展期间：**真的不记账**（D110 §14）。这与 replaying 不是一回事 ——
  // 那个只是不做终止判定，账照记。看展放的是别人的局，记进用户的编年史与台账
  // 就是把不属于他的东西塞进他的记录里；界面上也**明说**了不记（横幅那句）。
  let showing = false
  let runSeq = 0
  let currentRun = null      // {runId, startedAt}
  let lastEnd = null         // 最近一次终止，供总结卡片的按钮用
  let dirtyPanel = true

  /* ---------------- 一局的生命周期 ---------------- */

  function startRun() {
    if (showing) return       // 看展不开新的一局：那不是用户的局
    runSeq++
    currentRun = { runId: `run-${runSeq}-${Date.now().toString(36)}`, startedAt: new Date().toISOString() }
    lastEnd = null
    log.reset()
    detector.reset()
    chronicle.reset(app.engine.w * app.engine.h)
    chronicle.add(0, 'start', {
      seed: app.engine.seed, density: Number(app.density).toFixed(2)
    })
    observeInitial()
    dirtyPanel = true
  }

  /** 第 0 代也要进查重表，否则 blinker 这种"回到开局状态"的循环会漏掉 */
  function observeInitial() {
    if (needsHash()) detector.observe(0, app.engine.hash(), app.engine.countAlive())
  }

  /** 只有静止/循环两条需要棋盘哈希；都关掉时就别白算了 */
  function needsHash() { return detector.enabled.still || detector.enabled.cycle }

  /**
   * 每代调用一次。engine 已经跨到新一代。
   * @returns {object|null} 终止信息
   */
  function onGeneration(stats) {
    if (showing) return null  // 一格都不记
    log.push(stats)
    chronicle.observe(stats)
    dirtyPanel = true
    // 重放期间不做终止判定：既省掉每代一次全盘哈希，也避免"存档正好落在循环里"时
    // 重放到一半弹出总结卡片。重放结束后再把当前棋盘喂给检测器接上。
    if (replaying) return null
    // 即使本局已经终止过，也要继续喂给检测器 —— 历史留空洞会让之后算出的周期不准；
    // 只是不再重复落台账、重复弹卡片。
    const alreadyEnded = !!lastEnd     // 必须先取，finishRun 会把 lastEnd 设上
    const hit = detector.observe(stats.gen, needsHash() ? app.engine.hash() : '', stats.alive)
    if (hit && !alreadyEnded) {
      finishRun(hit)
      return hit
    }
    return null
  }

  /** 手绘改了棋盘 ⇒ 轨迹变了，之前攒的哈希不再代表这条轨迹 */
  function noteEdit() {
    detector.reset()
    observeInitial()
  }

  function finishRun(end) {
    lastEnd = end
    app.setRunning(false)
    chronicle.add(end.gen, 'end', { type: end.type, ...end })
    const e = app.engine
    ledger.add({
      runId: currentRun.runId,
      timestamp: currentRun.startedAt,
      seed: e.seed,
      ruleFingerprint: e.rule.fingerprint,
      ruleNotation: e.rule.notation || 'clauses',
      boundary: e.boundary,
      boardSize: `${e.w}x${e.h}`,
      initDensity: app.density,
      endType: end.type,
      endGen: end.gen,
      peakPop: chronicle.peak,
      note: ''
    })
    dirtyPanel = true
    renderPanel()
    showSummary(end)
  }

  /** 「结束本局」按钮：手动终止也要落台账（规格 3.4 的 manual） */
  function stopRun() {
    if (lastEnd) return
    finishRun({ type: 'manual', gen: app.engine.generation })
  }

  /* ---------------- 总结卡片 ---------------- */

  function showSummary(end) {
    const params = { gen: end.gen, from: end.from, period: end.period }
    const simple = app.mode === 'simple'
    el.kicker.textContent = t('chron.gen', { gen: end.gen })
    // 完整模式：标题是终止类型，正文是精确描述
    // 简洁模式：标题是"这局结束了"，正文走 end.<type>.simple 的大白话
    //（简洁语域下 t('end.cycle') 本身就会解析到 end.cycle.simple）
    el.title.textContent = simple ? t('sum.title') : t(`end.${end.type}`)
    el.line.textContent = simple ? t(`end.${end.type}`, params) : t(`end.${end.type}.body`, params)
    el.grid.innerHTML = [
      cell('sum.gens', end.gen),
      cell('sum.peak', chronicle.peak),
      cell('sum.alive', app.engine.stats.alive),
      cell('sum.seed', app.engine.seed, true),
      cell('sum.rule', app.engine.rule.notation || t('rule.beyondBS'), true)
    ].join('')
    el.note.value = ''
    el.saved.textContent = t('sum.saved')
    el.again.textContent = t('sum.newRun')
    el.link.textContent = t('share.copy')
    el.close.textContent = t('sum.close')
    el.cont.textContent = t('sum.continue')
    el.cont.title = t('sum.continue.tip')   // 括号里的说明挪到悬停提示（D77 ③）
    el.cont.hidden = end.type === 'manual' || end.type === 'extinction'
    el.modal.hidden = false
  }

  function cell(key, value, fullOnly) {
    return `<div class="sum-cell"${fullOnly ? ' data-mode="full"' : ''}>
      <span>${t(key)}</span><b>${value}</b></div>`
  }

  function closeSummary() {
    // 备注写回台账：卡片上填的就是这一局那条
    if (currentRun && el.note.value.trim()) ledger.updateNote(currentRun.runId, el.note.value.trim())
    el.modal.hidden = true
    renderPanel()
  }

  /* ---------------- 面板渲染 ---------------- */

  function renderPanel() {
    const info = log.info
    el.snapshots.textContent = info.kept
    el.snapshotInfo.textContent = t('rec.snapshotInfo', {
      kept: info.kept, full: info.full, stride: info.stride, thinned: info.thinned
    })
    el.hashInfo.textContent = t('rec.hashInfo', { n: detector.hashCount })

    // 时间线：只显示最近若干条，新的在下
    const evs = chronicle.events.slice(-MAX_TIMELINE)
    el.timeline.innerHTML = evs.length
      ? evs.map(ev => `<li class="tl-item tl-${ev.type}">
          <span class="tl-gen">${t('chron.gen', { gen: ev.gen })}</span>
          <span class="tl-body"><b>${eventTitle(ev)}</b>${eventBody(ev) ? ' · ' + eventBody(ev) : ''}</span>
        </li>`).join('')
      : `<li class="tl-empty">${t('chron.empty')}</li>`

    const rows = ledger.rows.slice(-MAX_LEDGER_ROWS).reverse()
    el.ledgerList.innerHTML = rows.length
      ? `<p class="note">${t('led.count', { n: ledger.length })}</p>` + rows.map(r => `
          <div class="led-row">
            <div class="led-head"><b>${t('end.' + r.endType)}</b>
              <span>${t('chron.gen', { gen: r.endGen })} · ${t('sum.peak')} ${r.peakPop}</span></div>
            <div class="led-meta mono">${r.ruleNotation} · ${r.boundary} · ${r.boardSize} · seed ${r.seed}</div>
            <input type="text" class="led-note" data-run="${r.runId}" value="${escapeAttr(r.note)}"
              data-i18n-placeholder="led.notePlaceholder" placeholder="${t('led.notePlaceholder')}" />
          </div>`).join('')
      : `<p class="note">${t('led.empty')}</p>`
    dirtyPanel = false
  }

  function escapeAttr(s) { return String(s).replace(/"/g, '&quot;') }

  function eventTitle(ev) {
    return ev.type === 'end' ? t('end.' + ev.params.type) : t('chron.' + ev.type)
  }
  function eventBody(ev) {
    if (ev.type === 'end') return ''
    const key = `chron.${ev.type}.body`
    const text = t(key, ev.params)
    return text === key ? '' : text
  }

  /* ---------------- 控件绑定 ---------------- */

  for (const [k, box] of Object.entries(boxes)) {
    box.addEventListener('change', () => {
      detector.enabled[k] = box.checked
      if (needsHash()) { detector.reset(); observeInitial() }
      renderPanel()
    })
  }

  el.genLimit.addEventListener('change', () => {
    const n = Math.max(1, Math.min(10000000, Math.round(Number(el.genLimit.value) || 10000)))
    detector.genLimit = n
    el.genLimit.value = String(n)
  })

  $('btn-export-snapshots').addEventListener('click', () => {
    download(`snapshots-${app.engine.seed}-${app.engine.generation}.csv`,
      toCSV(log.toArray(), SNAPSHOT_COLUMNS))
  })
  $('btn-export-ledger').addEventListener('click', () => {
    download('ledger.csv', toCSV(ledger.rows, LEDGER_COLUMNS))
  })
  $('btn-clear-ledger').addEventListener('click', () => { ledger.clear(); renderPanel() })
  $('btn-stop-run').addEventListener('click', stopRun)

  el.ledgerList.addEventListener('change', e => {
    const box = e.target.closest('.led-note')
    if (box) ledger.updateNote(box.dataset.run, box.value)
  })

  el.close.addEventListener('click', closeSummary)
  $('summary-backdrop').addEventListener('click', closeSummary)
  el.again.addEventListener('click', () => { closeSummary(); app.randomize() })
  // 复制链接：**不关卡片**（他多半还想看着那几个数字），复制完弹一句就够了（D106）
  el.link.addEventListener('click', () => { app.copyShareLink() })
  el.cont.addEventListener('click', () => {
    // 关掉刚触发的那一条，否则一恢复就会立刻再次命中
    if (lastEnd && boxes[lastEnd.type]) {
      boxes[lastEnd.type].checked = false
      detector.enabled[lastEnd.type] = false
    }
    lastEnd = null
    closeSummary()
    app.setRunning(true)
  })
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !el.modal.hidden) { closeSummary(); e.preventDefault() }
  })

  /**
   * 看展开关。**开着时一格都不记**：不开新局、不写编年史、不落台账。
   * 关掉时不自动补记 —— 看展期间发生的事本来就不该进用户的记录；
   * 退出看展会还原他自己那一局，那时由调用方重新 startRun。
   */
  function setShowing(on) { showing = !!on }

  /** 现在在不在看展（守卫与界面都要问得到） */
  function isShowing() { return showing }

  /** 读档重放开关；结束时把当前棋盘补进查重表，之后的循环检测才接得上 */
  function setReplaying(on) {
    replaying = !!on
    if (!on) { detector.reset(); observeInitial() }
  }

  /** 外部来源的一局（阶段 6 的勘探记录）并入实验台账 */
  function addExternalRun(entry) {
    const row = ledger.add(entry)
    dirtyPanel = true
    return row
  }

  return {
    startRun, onGeneration, noteEdit, renderPanel, setReplaying, addExternalRun,
    setShowing, isShowing,
    get needsPanel() { return dirtyPanel },
    relocalize() { renderPanel(); if (!el.modal.hidden && lastEnd) showSummary(lastEnd) },
    _internals: { log, detector, chronicle, ledger }
  }
}
