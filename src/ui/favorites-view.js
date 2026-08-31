// 收藏界面：布局页签（新）＋规则页签（勘探器候选名单迁入，行为不变）。
// 逻辑尽量薄 —— 校验、预算、导入导出都在 src/data/favorites.js 里，那边可测。
import { t } from '../i18n/index.js'
import {
  BUILTIN_LAYOUTS, validateLayout, ruleOf, exportFavorites, importFavorites,
  addLayout, normalizeRule, mergeFavorites, byteLength, MAX_BYTES
} from '../data/favorites.js'
import { prefs } from './prefs.js'

const $ = id => document.getElementById(id)

export function createFavorites(app) {
  const el = {
    tabs: $('fav-tabs'), list: $('fav-list'), budget: $('fav-budget'),
    add: $('btn-fav-add'), exp: $('btn-fav-export'), imp: $('btn-fav-import'), file: $('fav-file'),
    showStrip: $('show-strip'), showList: $('show-list')
  }
  let tab = 'layout'
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

  function layoutRows() {
    // 内置在前、用户的在后。内置不可删（它们随代码发布，不占用户的配额）。
    const builtin = BUILTIN_LAYOUTS.map(b => ({
      id: b.id, name: t(b.nameKey), note: t(b.nameKey + '.desc'),
      life: t(b.nameKey + '.life'), rle: b.rle, builtin: true
    }))
    return builtin.concat(state.layouts.map(e => ({ ...e, builtin: false })))
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
    const rows = layoutRows()
    if (!rows.length) return `<p class="note">${t('fav.emptyLayout')}</p>`
    return rows.map(r => `
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
    el.showList.innerHTML = layoutRows().map(r => `
      <button class="card show-card" data-show="${esc(r.id)}" title="${esc(r.note || r.name)}">
        <span class="card-text"><b>${esc(r.name)}</b><em>${esc(r.note || '')}</em></span>
      </button>`).join('')
  }

  function find(id) { return layoutRows().find(r => r.id === id) }

  /* ---------------- 接线 ---------------- */

  el.tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-fav-tab]')
    if (!b) return
    tab = b.dataset.favTab
    render()
  })

  el.list.addEventListener('click', e => {
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
    const entry = { name, rle, note: '', life: '' }
    const v = validateLayout(entry)
    if (!v.ok) { app.toast(t(v.key)); return }
    const r = addLayout(state.layouts, entry)
    if (!r.ok) { app.toast(t(r.key)); return }
    state.layouts = r.list
    if (save()) app.toast(t('fav.added', { name }))
    render()
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
  })

  /** 勘探器把候选名单交过来（迁入，行为不变） */
  app.setRuleFavorites = function (rules) {
    state.rules = rules.map(normalizeRule)
    save()
    render()
  }
  app.getRuleFavorites = function () { return state.rules.slice() }

  render()
  return { render, relocalize: render, addLayout: entry => { state.layouts = addLayout(state.layouts, entry).list; save(); render() } }
}
