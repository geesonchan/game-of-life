// 规则勘探器界面（阶段 6）。批量在 Worker 里跑，这里只管参数、进度、结果表与候选名单。
import { sampleBSRules, sortResults, OUTCOMES } from '../data/explorer.js'
import { compileRule } from '../engine/rules.js'
import { t } from '../i18n/index.js'

const $ = id => document.getElementById(id)

export function createExplorerView(app) {
  const el = {
    view: $('explorer-view'), back: $('exp-back'), stat: $('exp-stat'),
    progress: $('exp-progress'), bar: $('exp-progress-bar'), progressText: $('exp-progress-text'),
    empty: $('exp-empty'), table: $('exp-table'), favs: $('exp-favs'),
    count: $('exp-count'), lblCount: $('exp-lbl-count'),
    runs: $('exp-runs'), lblRuns: $('exp-lbl-runs'),
    cap: $('exp-cap'), lblCap: $('exp-lbl-cap'),
    board: $('exp-board'), lblBoard: $('exp-lbl-board'),
    start: $('exp-start'), stop: $('exp-stop')
  }

  let worker = null
  let results = []
  // 候选名单不再是这里的局部状态：它已迁入收藏（规则页签），由 app 持有并落书签通道。
  // 这里只读它、改它，星标与列表的行为一个字没变（见 docs/decisions.md D82）。
  // 条目形状仍是 {notation, fingerprint, clauses, agingLayers, seed, outcome}。
  const getFavs = () => app.getRuleFavorites()
  const putFavs = next => { app.setRuleFavorites(next); renderTable(); renderFavs() }
  let ledgerCount = 0
  let open = false
  let runSeq = 0

  /* ---------------- 跑一批 ---------------- */

  function start() {
    const spec = {
      runsPerRule: Number(el.runs.value),
      genCap: Number(el.cap.value),
      boardSize: Number(el.board.value),
      baseSeed: 1000
    }
    const rules = sampleBSRules(Number(el.count.value), 20260829 + (runSeq++))
    results = []
    ledgerCount = 0
    renderTable()
    showProgress(0, rules.length)
    el.start.disabled = true
    el.stop.disabled = false

    if (worker) worker.terminate()
    worker = new Worker(new URL('../workers/explorer.js', import.meta.url), { type: 'module' })
    worker.onmessage = ev => {
      const m = ev.data
      if (m.type === 'result') {
        results.push(m.result)
        toLedger(m.result)
        showProgress(results.length, m.total)
        // 边跑边填表，不必等全部跑完
        renderTable()
      } else if (m.type === 'done') {
        finish()
        app.toast(t('exp.doneMsg', { total: m.total, ledger: ledgerCount }))
      } else if (m.type === 'error') {
        finish()
        app.toast(m.message)
      }
    }
    worker.postMessage({ type: 'explore', rules, spec })
  }

  function stop() {
    if (worker) { worker.terminate(); worker = null }
    finish()
  }

  function finish() {
    hideProgress()
    el.start.disabled = false
    el.stop.disabled = true
    if (worker) { worker.terminate(); worker = null }
  }

  /** 勘探记录并入实验台账：每局一条，字段与规格 3.4 一致 */
  function toLedger(rule) {
    for (const run of rule.runs) {
      app.records.addExternalRun({
        runId: `probe-${rule.fingerprint}-${run.seed}`,
        timestamp: new Date().toISOString(),
        seed: run.seed,
        ruleFingerprint: rule.fingerprint,
        ruleNotation: rule.notation || 'clauses',
        boundary: 'torus',
        boardSize: `${Number(el.board.value)}x${Number(el.board.value)}`,
        initDensity: 0.1,
        endType: run.end ? run.end.type : 'capped',
        endGen: run.gens,
        peakPop: run.peak,
        note: `probe:${run.outcome}`
      })
      ledgerCount++
    }
  }

  function showProgress(done, total) {
    el.empty.hidden = true
    el.progress.hidden = false
    el.bar.style.width = (total ? Math.round(done / total * 100) : 0) + '%'
    el.progressText.textContent = t('exp.progress', { done, total })
    el.stat.textContent = t('exp.progress', { done, total })
  }
  function hideProgress() { el.progress.hidden = true }

  /* ---------------- 结果表 ---------------- */

  function outcomeChip(o) { return `<span class="out out-${o}">${t('out.' + o)}</span>` }

  function renderTable() {
    if (!results.length) { el.table.innerHTML = ''; el.empty.hidden = false; return }
    el.empty.hidden = true
    const rows = sortResults(results)
    el.table.innerHTML = `
      <thead><tr>
        <th></th><th>${t('exp.colRule')}</th><th>${t('exp.colOutcome')}</th>
        <th>${t('exp.colRuns')}</th><th>${t('exp.colAvg')}</th><th></th>
      </tr></thead>
      <tbody>${rows.map(r => `
        <tr data-fp="${r.fingerprint}">
          <td><button class="star ${getFavs().some(f => f.fingerprint === r.fingerprint) ? 'on' : ''}"
            data-star="${r.fingerprint}" title="${t('exp.fav')}">★</button></td>
          <td class="mono">${r.notation || '—'}</td>
          <td>${outcomeChip(r.outcome)}</td>
          <td>${r.runs.map(x => outcomeChip(x.outcome)).join(' ')}</td>
          <td class="num">${r.avgEndGen}</td>
          <td><button data-jump="${r.fingerprint}">${t('exp.jump')}</button></td>
        </tr>`).join('')}
      </tbody>`
  }

  function renderFavs() {
    const favs = getFavs()
    el.favs.innerHTML = favs.length
      ? favs.map(f => `
          <div class="fav-row">
            <b class="mono">${f.notation || '—'}</b> ${outcomeChip(f.outcome)}
            <span class="fav-meta mono">${f.fingerprint} · seed ${f.seed}</span>
            <button data-jump="${f.fingerprint}">${t('exp.jump')}</button>
          </div>`).join('')
      : `<p class="note">${t('exp.favEmpty')}</p>`
  }

  /** 一键回主界面复现：换规则 + 用那一局的种子重开 */
  function jumpTo(fp) {
    const r = results.find(x => x.fingerprint === fp) || getFavs().find(x => x.fingerprint === fp)
    if (!r) return
    const seed = r.seed ?? (r.runs && r.runs[0].seed)
    const rule = compileRule({ name: r.notation || t('rule.custom'), agingLayers: r.agingLayers | 0, clauses: r.clauses })
    hide()
    app.el.boundary.set('torus')
    app.engine.setBoundary('torus')
    app.applyRule(rule)
    app.density = 0.1
    app.el.density.value = '0.1'
    app.el.lblDensity.textContent = '0.10'
    app.el.seed.value = String(seed)
    app.randomize()
    app.toast(t('exp.jumped', { notation: r.notation || '', seed }))
  }

  el.table.addEventListener('click', e => {
    const star = e.target.closest('[data-star]')
    const jump = e.target.closest('[data-jump]')
    if (star) {
      const fp = star.dataset.star
      const favs = getFavs()
      const i = favs.findIndex(f => f.fingerprint === fp)
      if (i >= 0) favs.splice(i, 1)
      else {
        const r = results.find(x => x.fingerprint === fp)
        if (r) favs.push({ notation: r.notation, fingerprint: r.fingerprint, clauses: r.clauses,
          agingLayers: r.agingLayers, seed: r.runs[0].seed, outcome: r.outcome })
      }
      putFavs(favs)
    } else if (jump) jumpTo(jump.dataset.jump)
  })
  el.favs.addEventListener('click', e => {
    const jump = e.target.closest('[data-jump]')
    if (jump) jumpTo(jump.dataset.jump)
  })

  /* ---------------- 开关 ---------------- */

  function show() { open = true; el.view.hidden = false; renderTable(); renderFavs() }
  function hide() { open = false; el.view.hidden = true }

  el.back.addEventListener('click', hide)
  el.start.addEventListener('click', start)
  el.stop.addEventListener('click', stop)
  for (const [input, label] of [[el.count, el.lblCount], [el.runs, el.lblRuns], [el.cap, el.lblCap], [el.board, el.lblBoard]]) {
    input.addEventListener('input', () => { label.textContent = input.value })
    label.textContent = input.value
  }
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && open) { hide(); e.preventDefault() } })

  return {
    show, hide,
    get isOpen() { return open },
    relocalize() { if (results.length) renderTable(); renderFavs() },
    // 收藏页删掉一条规则后，这边的星标与名单要跟着变 —— 同一份名单，两个入口
    refreshFavs() { if (results.length) renderTable(); renderFavs() },
    useRule: jumpTo,
    _internals: { get results() { return results }, get favs() { return getFavs() }, start, stop }
  }
}
