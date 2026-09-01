// 收藏界面：布局页签（新）＋规则页签（勘探器候选名单迁入，行为不变）。
// 逻辑尽量薄 —— 校验、预算、导入导出都在 src/data/favorites.js 里，那边可测。
import { t } from '../i18n/index.js'
import {
  validateLayout, ruleOf, exportFavorites, importFavorites, addLayout, normalizeRule,
  mergeFavorites, byteLength, layoutRows, foldRows, showEntryPlan, MAX_BYTES, MAX_NOTE
} from '../data/favorites.js'
import { parseRLE } from '../engine/rle.js'
import { compileNotation } from '../engine/rules.js'
import { neededBoard, BIG_FROM } from '../data/board-sizes.js'
import { createLifeProbe, PROBE_CHUNK } from '../data/life-probe.js'
import { prefs } from './prefs.js'

const $ = id => document.getElementById(id)

export function createFavorites(app) {
  const el = {
    tabs: $('fav-tabs'), list: $('fav-list'), budget: $('fav-budget'),
    add: $('btn-fav-add'), exp: $('btn-fav-export'), imp: $('btn-fav-import'), file: $('fav-file'),
    showStrip: $('show-strip'), showList: $('show-list'), showMore: $('show-more')
  }
  /**
   * 桌面网格一次露几张（D95 ③）。卡片还会涨（元像素零件六局在路上），
   * 按 15–20 张的量设计：宽屏上这是两到三行，还看得过来；超出就折起来。
   * 与侧栏那条折叠是同一个做法，只是那边按"最近 N 条"，这边按"前 N 张"。
   */
  const SHOW_FOLD = 18
  let tab = 'layout'
  let expanded = false      // 侧栏是否展开了全部自存条目（本次会话内有效，不落盘）
  let showAll = false       // 取用区网格是否展开了全部卡片（同样只活在本次会话里）
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
    // **这一局自带的环境**（D104）：边界、速度先切过去，用户原来的设置替他存着，
    // 清空 / 读档 / 换局时再还回去。这些局的生平都是在各自的环境里量出来的 ——
    // 繁殖者那几个数是 2048² 死边界上的数，摆到 200 环形盘上，卡片那行字就成了假话。
    app.enterShowEnv(entry)
    // 中量级经典要更大的盘才摆得下（D94 ②）。换盘会清盘，所以顺序是"先换盘再铺"，
    // 而且这一步之前必须已经问过用户 —— 问在 openShowEntry 那里，不在这里。
    const need = boardNeededBy(entry)
    if (need && app.engine.w < need) app.resizeBoard(need, need, { silent: true })
    // keepShowEnv：这次清空是"铺这一局"的一部分，不是"退出这一局"（D104）
    app.clear({ silent: true, keepShowEnv: true })
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
          <button data-fav-link="${esc(r.id)}">${t('share.copy')}</button>
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

  /**
   * 「精彩局」卡片带。**点一张卡不再等于清盘**（D93）：同规则的拿在手上放，
   * 异规则的才换整盘，换之前还要问一句。卡片上标出它是哪一种，别让人点了才知道。
   *
   * 桌面是网格、手机是横滑（D95 ①），但**只有一份 DOM** —— 形态差异全在 CSS 里。
   * 卡片上只放名称 + 一行短语 + 小标；完整说明（作者/年份/机制）走两处：
   * 悬停 title，以及选中之后下面那行提示（见 syncShowHint）。
   */
  function renderShowStrip() {
    const rows = rowsNow()
    el.showList.innerHTML = rows.map(r => {
      const on = !!(app.stamp && app.stamp.key === stampKey(r.id))
      // 三枚小标各带自己的类，**由 CSS 决定哪一枚在哪个屏上出现**：
      // 「换世界」两边都要；「1024² 起」桌面才有意义；「建议电脑」只在窄屏 ——
      // 在电脑上说"建议在电脑上看"是废话（D95 ②）。
      const tags = []
      if (!sameRuleAsBoard(r)) tags.push(`<b class="tag-swap">${esc(t('fav.show.swapTag'))}</b>`)
      if (r.board >= BIG_FROM) {
        tags.push(`<b class="tag-scale">${esc(t('fav.scale.note', { n: r.board }))}</b>`)
        tags.push(`<b class="tag-adv">${esc(t('fav.scale.big'))}</b>`)
      }
      return `
      <button class="card show-card ${on ? 'on' : ''}" data-show="${esc(r.id)}" title="${esc(r.full || r.note || r.name)}">
        <span class="card-text"><b>${esc(r.name)}</b><em>${esc(r.note || '')}</em></span>
        ${tags.length ? `<i class="show-swap">${tags.join('')}</i>` : ''}
      </button>`
    }).join('')
    // 折叠（D95 ③）：DOM 一张不少，桌面靠 CSS 藏 —— 这样手机那条横滑带一字不动
    const over = rows.length - SHOW_FOLD
    el.showList.classList.toggle('folded', over > 0 && !showAll)
    el.showMore.hidden = over <= 0
    if (over > 0) el.showMore.textContent = showAll ? t('fav.foldUp') : t('fav.showAll', { n: over })
    syncShowHint()
  }

  /**
   * 卡片带下面那行字。平时是通用提示；**选中一张之后换成那一局的完整说明** ——
   * 瘦卡片放不下作者与机制，但选中的那一刻恰恰是他想知道这些的时候（D95 ①）。
   */
  function syncShowHint() {
    const hint = document.getElementById('show-hint')
    if (!hint) return
    const held = app.stamp && String(app.stamp.key || '').startsWith('show:')
    const row = held ? rowsNow().find(r => stampKey(r.id) === app.stamp.key) : null
    hint.textContent = row ? (row.full || row.note || '') : t('fav.showHint')
    hint.classList.toggle('on', !!row)
  }

  function find(id) { return rowsNow().find(r => r.id === id) }

  /* ---------------- 精彩局的进入方式（D93） ---------------- */

  /** 拿在手上的那个图案用什么 key —— 与卡片高亮共用一处，免得两边算法不一样 */
  function stampKey(id) { return 'show:' + id }

  /**
   * 解出来的尺寸。**缓存**：深胞那条 RLE 有 16KB，每次重画卡片带都解一遍太浪费，
   * 而 RLE 是常量，解出来的尺寸不会变。
   */
  const dimCache = new Map()
  function dimsOf(entry) {
    // 声明了尺寸的直接用（整台机器那条：格子还没取回来，但卡片已经要判摆不摆得下了）
    if (entry.w && entry.h) return { w: entry.w, h: entry.h }
    if (!dimCache.has(entry.id)) {
      try { const p = parseRLE(entry.rle); dimCache.set(entry.id, { w: p.w, h: p.h }) }
      catch (e) { dimCache.set(entry.id, null) }
    }
    return dimCache.get(entry.id)
  }

  /**
   * 取回这一局的格子。绝大多数局的 RLE 就在条目里；
   * 只有"整台机器"那条是 161 KB 的静态文件，等到点开才去拿（D103）。
   * 取回来的存在内存里，同一次会话不再取第二遍。
   */
  const rleCache = new Map()
  async function rleOf(entry) {
    if (entry.rle) return entry.rle
    if (!entry.rleUrl) return null
    if (rleCache.has(entry.id)) return rleCache.get(entry.id)
    const res = await fetch(entry.rleUrl)
    if (!res.ok) throw new Error(String(res.status))
    const text = await res.text()
    rleCache.set(entry.id, text)
    return text
  }

  /** 这一局至少要多大的盘：条目自己声明的档位优先，否则按它的包围盒算 */
  function boardNeededBy(entry) {
    const d = dimsOf(entry)
    const byDims = d ? neededBoard(d.w, d.h) : null
    return Math.max(entry.board || 0, byDims || 0) || null
  }

  /** 现在这个盘摆不摆得下 */
  function fitsBoard(entry) {
    const d = dimsOf(entry)
    if (!d) return true                    // 解不出来的交给后面的报错路径，别在这里拦
    return d.w <= app.engine.w && d.h <= app.engine.h && (!entry.board || app.engine.w >= entry.board)
  }

  /**
   * 这一局的规则与当前棋盘是不是同一个世界。**比指纹，不比字符串** ——
   * b3/s23 和 B3/S23 写法不同、世界相同，照字符串比会把同规则误判成异规则，
   * 于是白白清一次盘（库里已有 worldFingerprints 这个先例，口径统一）。
   */
  function sameRuleAsBoard(entry) {
    const notation = ruleOf(entry.rle)
    if (!notation) return true          // 没头行 = 不知道；拿不准时走不破坏的那条路
    try { return compileNotation(notation).fingerprint === app.engine.rule.fingerprint }
    catch (e) { return false }          // 规则都编不出来，那更不能悄悄替换
  }

  /** 把一局 RLE 变成"拿在手上的图案"，后面全套走两步放置（幽灵/拖/⟳⇋/「放这」） */
  function stampOf(entry) {
    const p = parseRLE(entry.rle)
    return { key: stampKey(entry.id), label: entry.name, w: p.w, h: p.h, cells: p.cells }
  }

  /** 点一张精彩局卡片。返回走了哪条路（测试与守卫要看它） */
  /** 这一局自带的环境与当前是不是一回事（D104 ①） */
  function sameEnvAsBoard(entry) {
    if (entry.boundary && entry.boundary !== app.engine.boundary) return false
    if (entry.board && entry.board !== app.engine.w) return false
    return true
  }

  app.openShowEntry = function (entry) {
    const sameRule = sameRuleAsBoard(entry)
    const fits = fitsBoard(entry)
    const sameEnv = sameEnvAsBoard(entry)
    const plan = showEntryPlan({
      sameRule, fits, sameEnv,
      boardEmpty: app.engine.stats.alive === 0,
      running: !!app.running
    })
    if (plan === 'stamp') {
      let p
      try { p = stampOf(entry) } catch (e) { app.toast(t('io.rleFail', { reason: String(e.message) })); return 'error' }
      app.setStamp(p)               // 到此为止：引擎一格没动，棋盘一格没清
      return plan
    }
    // 异规则 / 摆不下：整盘替换。空盘时一点即开，有东西时先问一句（D82：劳动不得被静默清掉）
    const go = () => {
      if (!entry.rle && entry.rleUrl) {
        // 161 KB 要走一趟网络：先说一句，别让人以为点了没反应
        app.toast(t('fav.show.loading', { name: entry.name }))
        rleOf(entry).then(rle => {
          if (app.replayLayout({ ...entry, rle })) app.setRunning(true)
        }).catch(err => app.toast(t('fav.show.loadFail', { name: entry.name, reason: String(err.message || err) })))
        return
      }
      if (app.replayLayout(entry)) app.setRunning(true)
    }
    if (plan === 'replace') { go(); return plan }
    // 换的是什么，就说什么：规则、环境、还是两样都换。
    // 三句独立成条而不是拼字符串 —— 拼出来的句子在另一种语言里往往不成话。
    const need = Math.max(boardNeededBy(entry) || 0, entry.board || 0) || app.engine.w
    const envDiffers = !fits || !sameEnv
    const which = !sameRule && envDiffers ? 'needBoth' : (!sameRule ? 'needRule' : 'needEnv')
    app.confirmAction({
      title: t('fav.show.' + which + '.title'),
      body: t('fav.show.' + which + '.body', {
        name: entry.name, rule: ruleOf(entry.rle), n: need,
        edge: t(entry.boundary === 'dead' ? 'board.dead' : 'board.torus')
      }),
      yes: t('fav.show.' + which + '.yes')
    }, go)
    return plan
  }

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
    const link = e.target.closest('[data-fav-link]')
    const useRule = e.target.closest('[data-fav-rule]')
    const delRule = e.target.closest('[data-fav-rule-del]')
    if (link) {
      // 复制这一条的链接：**带上它自己的环境**（边界与盘），不是当前棋盘的 ——
      // 别人打开时该看到的是这一局该在的世界（D104 / D106）
      const r = find(link.dataset.favLink)
      if (r) {
        rleOf(r).then(rle => app.copyShareLink({
          rle, rule: ruleOf(rle), boundary: r.boundary || app.engine.boundary, board: r.board || app.engine.w
        })).catch(() => app.toast(t('fav.show.loadFail', { name: r.name, reason: '' })))
      }
    } else if (play) { const r = find(play.dataset.favPlay); if (r) app.replayLayout(r) }
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

  app.syncShowHint = syncShowHint      // 语言切换时由 refreshTabHint 调它，别再各写一份

  el.showMore.addEventListener('click', () => { showAll = !showAll; renderShowStrip() })

  el.showList.addEventListener('click', e => {
    const b = e.target.closest('[data-show]')
    if (!b) return
    const r = find(b.dataset.show)
    if (r) app.openShowEntry(r)
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
    renderShow: renderShowStrip,      // 拿起/放下图案时只重画卡片带，不动整个收藏面板
    syncShowHint,
    relocalize: render,
    addLayout: entry => { state.layouts = addLayout(state.layouts, entry).list; save(); render(); pump() }
  }
}
