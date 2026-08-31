// 收藏界面：布局页签（新）＋规则页签（勘探器候选名单迁入，行为不变）。
// 逻辑尽量薄 —— 校验、预算、导入导出都在 src/data/favorites.js 里，那边可测。
import { t } from '../i18n/index.js'
import {
  validateLayout, ruleOf, exportFavorites, importFavorites, addLayout, normalizeRule,
  mergeFavorites, byteLength, layoutRows, foldRows, MAX_BYTES, MAX_NOTE
} from '../data/favorites.js'
import { createLifeProbe, PROBE_CHUNK } from '../data/life-probe.js'
import { prefs } from './prefs.js'

const $ = id => document.getElementById(id)

export function createFavorites(app) {
  const el = {
    tabs: $('fav-tabs'), list: $('fav-list'), budget: $('fav-budget'),
    add: $('btn-fav-add'), exp: $('btn-fav-export'), imp: $('btn-fav-import'), file: $('fav-file'),
    showStrip: $('show-strip'), showList: $('show-list')
  }
  let tab = 'layout'
  let expanded = false      // 侧栏是否展开了全部自存条目（本次会话内有效，不落盘）
  let probing = null        // 正在跑生平的那一条：{id, probe}
  let state = load()

  /** 从书签通道读；坏数据不让它废掉整个界面 */
  function load() {
    const raw = prefs.getBookmark('favorites', null)
    if (!raw) return { layouts: [], rules: [] }
    const r = importFavorites(raw)
    return r.ok ? { layouts: r.layouts, rules: r.rules } : { layouts: [], rules: [] }
  }

  /** 写回书签通道。写失败要说出来 —— 收藏是用户的劳动，静默丢掉最难受。 */
  function save() {
    const r = prefs.setBookmark('favorites', exportFavorites(state))
    if (!r.ok) app.toast(t(r.key))
    return r.ok
  }

  /* ---------------- 复现 ---------------- */

  /**
   * 复现一条布局：清盘 → 按 RLE 头行切规则 → 居中铺上。
   * 顺序不能反：先切规则再铺格子，否则新规则的可达性钳制会把刚铺的格子削掉（见 board.setRule）。
   */
  app.replayLayout = function (entry) {
    const rule = ruleOf(entry.rle)
    app.clear({ silent: true })
    if (rule) app.applyNotation(rule)
    const ok = app.importRleText(entry.rle, { center: true })
    if (ok) app.toast(t('fav.replayed', { name: entry.name || t(entry.nameKey) }))
    return ok
  }

  /* ---------------- 渲染 ---------------- */

  /**
   * 卡片数据。内置与自存走 layoutRows() 这**同一个出口** —— 卡片长得一样，
   * 是因为喂给模板的东西本来就是同一种形状，而不是因为我在两处各写了一遍（D83 §1）。
   * 正在跑生平的那一条临时顶上"正在跑"，这个状态只活在内存里，不落盘。
   */
  function rowsNow() {
    const rows = layoutRows(state, t)
    if (!probing) return rows
    return rows.map(r => (r.id === probing.id ? { ...r, life: t('fav.life.running') } : r))
  }

  function render() {
    el.tabs.querySelectorAll('button').forEach(b =>
      b.classList.toggle('on', b.dataset.favTab === tab))
    el.list.innerHTML = tab === 'layout' ? renderLayouts() : renderRules()
    const used = byteLength(exportFavorites(state))
    el.budget.textContent = t('fav.budget', {
      used: (used / 1024).toFixed(1), max: (MAX_BYTES / 1024).toFixed(0), n: state.layouts.length
    })
    renderShowStrip()
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  }

  function renderLayouts() {
    const all = rowsNow()
    if (!all.length) return `<p class="note">${t('fav.emptyLayout')}</p>`
    // 长了就折起来。侧栏本身就是一根滚动的柱子，在它里面再开一个定高滚动区，
    // 滚轮和手指都要先喂饱内层才轮到外层 —— 折叠没有这层麻烦（D83 §3）。
    const { rows, hidden } = foldRows(all, expanded)
    const list = rows.map(r => `
      <div class="fav-row">
        <b>${esc(r.name)}</b>
        ${r.note ? `<span class="fav-meta">${esc(r.note)}</span>` : ''}
        ${r.life ? `<span class="fav-meta mono">${esc(r.life)}</span>` : ''}
        <div class="row">
          <button data-fav-play="${esc(r.id)}">${t('fav.replay')}</button>
          <button data-fav-fill="${esc(r.id)}">${t('fav.fill')}</button>
          ${r.builtin ? '' : `<button class="danger" data-fav-del="${esc(r.id)}">${t('fav.del')}</button>`}
        </div>
      </div>`).join('')
    if (!hidden && !expanded) return list
    return list + `<button class="fav-more" data-fav-more>${
      expanded ? t('fav.foldUp') : t('fav.showAll', { n: hidden })}</button>`
  }

  function renderRules() {
    if (!state.rules.length) return `<p class="note">${t('fav.emptyRule')}</p>`
    return state.rules.map(r => `
      <div class="fav-row">
        <b class="mono">${esc(r.notation)}</b>
        <span class="fav-meta mono">${esc(r.fingerprint)}${r.seed !== undefined ? ' · seed ' + esc(r.seed) : ''}</span>
        <div class="row">
          <button data-fav-rule="${esc(r.fingerprint)}">${t('fav.useRule')}</button>
          <button class="danger" data-fav-rule-del="${esc(r.fingerprint)}">${t('fav.del')}</button>
        </div>
      </div>`).join('')
  }

  /** 简洁模式的「精彩局」卡片：孩子一点就开演 */
  function renderShowStrip() {
    el.showList.innerHTML = rowsNow().map(r => `
      <button class="card show-card" data-show="${esc(r.id)}" title="${esc(r.note || r.name)}">
        <span class="card-text"><b>${esc(r.name)}</b><em>${esc(r.note || '')}</em></span>
      </button>`).join('')
  }

  function find(id) { return rowsNow().find(r => r.id === id) }

  /* ---------------- 生平：按内置局同一口径实跑 ---------------- */

  /**
   * 谁还没有生平就给谁跑一条，一次只跑一条。
   * 跑的口径写死在 life-probe.js 里，与三条内置局用的是同一套（默认盘 + 自家检测器）——
   * 卡片上两种来源的数字因此可以并排读（D83 §2）。
   * 也顺带补上导入进来的、以及上次没跑完就关掉页面的那些。
   */
  function pump() {
    if (probing) return
    // 新存的排在前面先跑 —— 用户刚存完正盯着那一张卡看
    const target = state.layouts.slice().reverse().find(e => !e.life)
    if (!target) return
    probing = { id: target.id, probe: createLifeProbe(target.rle) }
    render()
    tick()
  }

  /**
   * 跑一小段就把控制权交回去。200×200 跑满上限要两秒多，
   * 一口气跑完就是在用户刚点完「收藏」的那一刻冻住界面 —— 最不该卡的时刻。
   */
  function tick() {
    const cur = probing
    if (!cur) return
    const entry = state.layouts.find(x => x.id === cur.id)
    if (!entry) { probing = null; render(); pump(); return }   // 跑到一半被删了
    if (!cur.probe.run(PROBE_CHUNK)) { setTimeout(tick, 0); return }
    entry.life = cur.probe.result
    probing = null
    save()
    render()
    pump()
  }

  /* ---------------- 接线 ---------------- */

  el.tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-fav-tab]')
    if (!b) return
    tab = b.dataset.favTab
    render()
  })

  el.list.addEventListener('click', e => {
    if (e.target.closest('[data-fav-more]')) { expanded = !expanded; render(); return }
    const play = e.target.closest('[data-fav-play]')
    const fill = e.target.closest('[data-fav-fill]')
    const del = e.target.closest('[data-fav-del]')
    const useRule = e.target.closest('[data-fav-rule]')
    const delRule = e.target.closest('[data-fav-rule-del]')
    if (play) { const r = find(play.dataset.favPlay); if (r) app.replayLayout(r) }
    else if (fill) { const r = find(fill.dataset.favFill); if (r) app.fillRleBox(r.rle) }
    else if (del) {
      state.layouts = state.layouts.filter(x => x.id !== del.dataset.favDel)
      save(); render()
    } else if (useRule) {
      // 走勘探器那条现成的复现路径（换规则 + 用那一局的种子重开），
      // 免得同一件事在两处各写一遍、各错一处
      app.explorer.useRule(useRule.dataset.favRule)
    } else if (delRule) {
      state.rules = state.rules.filter(x => x.fingerprint !== delRule.dataset.favRuleDel)
      save(); render()
      app.explorer.refreshFavs()
    }
  })

  el.showList.addEventListener('click', e => {
    const b = e.target.closest('[data-show]')
    if (!b) return
    const r = find(b.dataset.show)
    if (r) { app.replayLayout(r); app.setRunning(true) }   // 孩子一点就开演
  })

  el.add.addEventListener('click', () => {
    const rle = app.currentLayoutRle()
    if (!rle) { app.toast(t('fav.err.emptyBoard')); return }
    const name = (window.prompt(t('fav.namePrompt'), t('fav.defaultName', { n: state.layouts.length + 1 })) || '').trim()
    if (!name) return
    // 说明是可选的：直接回车就没有。留空不该拦人 —— 存这一局才是他要做的事。
    // 生平那一行不问用户，系统自己跑（见 pump()）：他答不上来，而机器答得上来。
    const note = (window.prompt(t('fav.notePrompt', { max: MAX_NOTE }), '') || '').trim()
    const entry = { name, rle, note, life: '' }
    const v = validateLayout(entry)
    if (!v.ok) { app.toast(t(v.key)); return }
    const r = addLayout(state.layouts, entry)
    if (!r.ok) { app.toast(t(r.key)); return }
    state.layouts = r.list
    if (save()) app.toast(t('fav.added', { name }))
    render()
    pump()
  })

  el.exp.addEventListener('click', () => app.downloadText(exportFavorites(state), 'favorites.json'))
  el.imp.addEventListener('click', () => el.file.click())
  el.file.addEventListener('change', async () => {
    const f = el.file.files && el.file.files[0]
    if (!f) return
    const r = importFavorites(await f.text())
    el.file.value = ''
    if (!r.ok) { app.toast(t(r.key)); return }
    // 合并而不是覆盖：导入别人的收藏不该洗掉自己的（理由见 D82 §3）
    const m = mergeFavorites(state, r)
    state = { layouts: m.layouts, rules: m.rules }
    save()
    render()
    app.explorer.refreshFavs()
    app.toast(t('fav.imported', { n: m.added, skipped: r.skipped + m.skipped }))
    pump()
  })

  /** 勘探器把候选名单交过来（迁入，行为不变） */
  app.setRuleFavorites = function (rules) {
    state.rules = rules.map(normalizeRule)
    save()
    render()
  }
  app.getRuleFavorites = function () { return state.rules.slice() }

  render()
  pump()      // 上次没跑完的、导入进来的，开机顺手补上
  return {
    render,
    relocalize: render,
    addLayout: entry => { state.layouts = addLayout(state.layouts, entry).list; save(); render(); pump() }
  }
}
