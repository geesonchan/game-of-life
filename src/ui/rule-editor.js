// 条款规则编辑器（模态窗）。
// 与校验器同期交付：每一次改动都立刻重新走一遍
// 结构校验 → 编译 → 语义校验（可达性 / 遮蔽 / 冗余 / B/S 表达力），结果直接显示在界面上。
// 判定规则见 docs/decisions.md D17–D21。
import { compileRule, bsToClauses } from '../engine/rules.js'
import { validateClauses, validateRule } from '../engine/validate.js'
import { PRESETS, presetRule } from '../engine/presets.js'
import { exportRule, importRule } from '../engine/rule-io.js'
import { t, stateLabel } from '../i18n/index.js'

const OP_KEYS = ['in', 'not_in', 'eq', 'range', 'lte', 'gte', 'any']

/** 把 {key, params} 渲染成本地化句子；状态名参数要再过一次本地化 */
function msg(rep) {
  if (!rep || !rep.key) return ''
  const params = { ...(rep.params || {}) }
  if (params.state !== undefined) params.state = stateLabel(params.state)
  return t(rep.key, params)
}

function joinList(items) { return items.join(t('list.sep')) }

export function createRuleEditor(app) {
  const $ = id => document.getElementById(id)
  const el = {
    modal: $('rule-modal'), close: $('re-close'), cancel: $('re-cancel'), apply: $('re-apply'),
    presets: $('re-presets'), aging: $('re-aging'), agingLabel: $('re-lbl-aging'), chain: $('re-gen-chain'),
    bs: $('re-bs'), bsReason: $('re-bs-reason'), clauses: $('re-clauses'), add: $('re-add'),
    validation: $('re-validation'), table: $('re-table'),
    notation: $('re-notation'), fingerprint: $('re-fingerprint'),
    io: $('re-io'), ioText: $('re-io-text'), ioMsg: $('re-io-msg'),
    exportBtn: $('re-export'), importBtn: $('re-import'), ioClose: $('re-io-close')
  }

  // 草稿：改动只作用在这里，点「应用规则」才写回引擎
  let draft = { agingLayers: 0, clauses: [] }
  let compiled = null
  let structural = { ok: true, errors: [] }
  let report = null
  let dragFrom = -1

  /* ---------------- 打开 / 关闭 ---------------- */

  function open() {
    // 模态压在所有常驻浮层之上（D79），但退出后不该撞见一个半开的抽屉
    document.body.classList.remove('drawer-open', 'more-open')
    const r = app.engine.rule
    draft = { agingLayers: r.agingLayers, clauses: deepClone(r.clauses) }
    el.io.hidden = true
    el.modal.hidden = false
    refresh()
  }
  function close() { el.modal.hidden = true }

  /* ---------------- 核心：改动 → 校验 → 渲染 ---------------- */

  function refresh() {
    // 1) 结构校验必须在编译之前 —— compileRule 对 then 越界会抛异常，
    //    对 when 越界则静默忽略，两种都得在这里拦下来（D19）
    structural = validateClauses(draft.clauses, draft.agingLayers)
    compiled = null
    report = null
    if (structural.ok) {
      try {
        compiled = compileRule({ name: t('rule.custom'), agingLayers: draft.agingLayers, clauses: draft.clauses })
        report = validateRule(compiled)
      } catch (e) {
        structural = { ok: false, errors: [{ clause: null, key: 'e.compileFail', params: { msg: e.message } }] }
      }
    }
    renderAging()
    renderClauses()
    renderBS()
    renderValidation()
    renderTable()
    el.notation.textContent = compiled ? (compiled.notation || t('rule.beyondBS')) : '—'
    el.fingerprint.textContent = compiled ? compiled.fingerprint : '—'
    el.apply.disabled = !compiled
  }

  function renderAging() {
    el.aging.value = draft.agingLayers
    el.agingLabel.textContent = draft.agingLayers
    el.chain.disabled = draft.agingLayers === 0
  }

  /* ---------------- 条款列表 ---------------- */

  function renderClauses() {
    const states = stateOptions(draft.agingLayers)
    el.clauses.innerHTML = draft.clauses.map((c, i) => {
      const rep = report ? report.clauses[i] : null
      const structErr = structural.errors.filter(e => e.clause === i)
      const status = structErr.length ? 'invalid' : (rep ? rep.status : 'ok')
      const text = structErr.length ? joinList(structErr.map(e => t(e.key, e.params))) : msg(rep)
      return `
        <div class="clause ${status !== 'ok' ? 'is-' + status : ''}" draggable="true" data-i="${i}">
          <div class="clause-main">
            <span class="drag" title="${t('editor.dragTitle')}">⠿</span>
            <span class="idx">${i + 1}</span>
            <select data-act="when" data-i="${i}">${options(states, c.when)}</select>
            <select data-act="op" data-i="${i}">${options(OP_KEYS.map(o => [o, t('op.' + o)]), (c.neighbors && c.neighbors.op) || 'any')}</select>
            <span class="cond">${condEditor(c.neighbors, i)}</span>
            <span class="arrow">→</span>
            <select data-act="then" data-i="${i}">${options(states, c.then)}</select>
            <span class="clause-btns">
              <button data-act="up" data-i="${i}" title="${t('editor.up')}" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button data-act="down" data-i="${i}" title="${t('editor.down')}" ${i === draft.clauses.length - 1 ? 'disabled' : ''}>↓</button>
              <button data-act="del" data-i="${i}" title="${t('editor.delete')}">✕</button>
            </span>
          </div>
          ${text ? `<div class="clause-msg"><b>${status === 'ok' ? '' : t('validate.badge.' + status)}</b> ${text}</div>` : ''}
        </div>`
    }).join('') + `<div class="clause fallback"><div class="clause-main">
        <span class="drag"></span><span class="idx">${t('editor.fallbackIdx')}</span>
        <span class="fallback-text">${t('editor.fallback')}</span>
      </div></div>`
  }

  function condEditor(cond, i) {
    const op = (cond && cond.op) || 'any'
    if (op === 'any') return '<span class="cond-none">—</span>'
    if (op === 'in' || op === 'not_in') {
      const vals = (cond.values || [])
      return `<span class="chips">${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(n =>
        `<button class="chip ${vals.includes(n) ? 'on' : ''}" data-act="chip" data-i="${i}" data-n="${n}">${n}</button>`).join('')}</span>`
    }
    if (op === 'range') {
      return `<input type="number" min="0" max="8" value="${cond.min ?? 0}" data-act="num" data-i="${i}" data-field="min">
              <span class="tilde">–</span>
              <input type="number" min="0" max="8" value="${cond.max ?? 8}" data-act="num" data-i="${i}" data-field="max">`
    }
    return `<input type="number" min="0" max="8" value="${cond.value ?? 0}" data-act="num" data-i="${i}" data-field="value">`
  }

  // 事件委托：列表每次改动都整体重绘，所以只在容器上绑一次
  el.clauses.addEventListener('click', e => {
    const b = e.target.closest('[data-act]')
    if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return
    const i = Number(b.dataset.i)
    const act = b.dataset.act
    if (act === 'del') draft.clauses.splice(i, 1)
    else if (act === 'up' && i > 0) swap(i, i - 1)
    else if (act === 'down' && i < draft.clauses.length - 1) swap(i, i + 1)
    else if (act === 'chip') {
      const cond = draft.clauses[i].neighbors
      const n = Number(b.dataset.n)
      const k = cond.values.indexOf(n)
      if (k === -1) cond.values.push(n); else cond.values.splice(k, 1)
      cond.values.sort((x, y) => x - y)
    } else return
    refresh()
  })

  el.clauses.addEventListener('change', e => {
    const t = e.target
    if (!t.dataset || !t.dataset.act) return
    const i = Number(t.dataset.i)
    const c = draft.clauses[i]
    if (t.dataset.act === 'when') c.when = t.value
    else if (t.dataset.act === 'then') c.then = t.value
    else if (t.dataset.act === 'op') c.neighbors = defaultCond(t.value, c.neighbors)
    else if (t.dataset.act === 'num') {
      const v = clampInt(t.value, 0, 8)
      c.neighbors[t.dataset.field] = v
    }
    refresh()
  })

  // 拖动排序
  el.clauses.addEventListener('dragstart', e => {
    const row = e.target.closest('.clause[data-i]')
    if (!row) return
    dragFrom = Number(row.dataset.i)
    row.classList.add('dragging')
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(dragFrom))
  })
  el.clauses.addEventListener('dragover', e => {
    const row = e.target.closest('.clause[data-i]')
    if (!row || dragFrom < 0) return
    e.preventDefault()
    row.classList.add('drop-target')
  })
  el.clauses.addEventListener('dragleave', e => {
    const row = e.target.closest('.clause[data-i]')
    if (row) row.classList.remove('drop-target')
  })
  el.clauses.addEventListener('drop', e => {
    const row = e.target.closest('.clause[data-i]')
    if (!row || dragFrom < 0) return
    e.preventDefault()
    const to = Number(row.dataset.i)
    if (to !== dragFrom) {
      const [moved] = draft.clauses.splice(dragFrom, 1)
      draft.clauses.splice(to, 0, moved)
    }
    dragFrom = -1
    refresh()
  })
  el.clauses.addEventListener('dragend', () => { dragFrom = -1; refresh() })

  el.add.addEventListener('click', () => {
    draft.clauses.push({ when: 'alive', neighbors: { op: 'in', values: [3] }, then: 'alive' })
    refresh()
  })

  /* ---------------- B/S 快捷视图（双向同步，D18） ---------------- */

  function renderBS() {
    const bs = report ? report.bs : null
    const enabled = !!(bs && bs.expressible)
    const born = enabled ? bs.born : []
    const survive = enabled ? bs.survive : []
    el.bs.classList.toggle('disabled', !enabled)
    el.bs.innerHTML = ['B', 'S'].map(kind => `
      <div class="bs-row">
        <span class="bs-label">${kind}</span>
        ${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => {
          const on = kind === 'B' ? born.includes(n) : survive.includes(n)
          return `<label class="bs-cell ${on ? 'on' : ''}">
            <input type="checkbox" data-kind="${kind}" data-n="${n}" ${on ? 'checked' : ''} ${enabled ? '' : 'disabled'}>
            <span>${n}</span></label>`
        }).join('')}
      </div>`).join('')
    if (enabled) {
      el.bsReason.className = 'note'
      el.bsReason.textContent = t('editor.bsSync')
    } else {
      el.bsReason.className = 'note warn'
      el.bsReason.textContent = bs
        ? t('editor.bsGreyed', { reason: msg({ key: bs.reasonKey, params: bs.reasonParams }) })
        : t('editor.bsUnknown')
    }
  }

  el.bs.addEventListener('change', e => {
    const box = e.target
    if (!box.dataset || !box.dataset.kind || !report || !report.bs.expressible) return
    const born = new Set(report.bs.born)
    const survive = new Set(report.bs.survive)
    const set = box.dataset.kind === 'B' ? born : survive
    const n = Number(box.dataset.n)
    if (box.checked) set.add(n); else set.delete(n)
    // 只重写生死两态的条款，保留用户手写的衰老态条款
    const agingClauses = draft.clauses.filter(c => c.when !== 'dead' && c.when !== 'alive')
    draft.clauses = bsToClauses([...born].sort((a, b) => a - b), [...survive].sort((a, b) => a - b)).concat(agingClauses)
    refresh()
  })

  /* ---------------- 衰老层数与衰老链 ---------------- */

  el.aging.addEventListener('input', () => {
    draft.agingLayers = Number(el.aging.value)
    refresh()
  })

  el.chain.addEventListener('click', () => {
    const n = draft.agingLayers
    if (n === 0) return
    // 删掉所有衰老态条款，换成标准链：aging_1 → aging_2 → … → dead
    const kept = draft.clauses.filter(c => c.when === 'dead' || c.when === 'alive')
    const chain = []
    for (let k = 1; k < n; k++) chain.push({ when: `aging_${k}`, neighbors: { op: 'any' }, then: `aging_${k + 1}` })
    chain.push({ when: `aging_${n}`, neighbors: { op: 'any' }, then: 'dead' })
    // 若没有任何条款能产生 aging_1，把最后一条"活细胞兜底死亡"改成进入衰老
    const producesAging1 = kept.some(c => c.then === 'aging_1')
    if (!producesAging1) {
      for (let i = kept.length - 1; i >= 0; i--) {
        if (kept[i].when === 'alive' && kept[i].then === 'dead') { kept[i] = { ...kept[i], then: 'aging_1' }; break }
      }
    }
    draft.clauses = kept.concat(chain)
    refresh()
  })

  /* ---------------- 预设 ---------------- */

  function renderPresets() {
    el.presets.innerHTML = PRESETS.map(p =>
      `<button class="preset" data-key="${p.key}"><b>${p.name}</b><span>${p.notation}</span><em>${t('preset.' + p.key)}</em></button>`).join('')
  }
  renderPresets()
  el.presets.addEventListener('click', e => {
    const b = e.target.closest('.preset')
    if (!b) return
    const p = PRESETS.find(x => x.key === b.dataset.key)
    draft = { agingLayers: p.agingLayers, clauses: p.clauses() }
    refresh()
  })

  /* ---------------- 校验结果与编译表 ---------------- */

  function renderValidation() {
    const parts = []
    if (!structural.ok) {
      parts.push(`<div class="v-line v-error"><b>${t('validate.structErrors', { n: structural.errors.length })}</b><ul>` +
        structural.errors.map(e => `<li>${e.clause === null ? '' : t('validate.clausePrefix', { n: e.clause + 1 })}${t(e.key, e.params)}</li>`).join('') + '</ul></div>')
    } else if (report) {
      const bad = report.clauses.filter(c => c.status === 'shadowed' || c.status === 'unreachable-state')
      const red = report.clauses.filter(c => c.status === 'redundant')
      if (bad.length === 0 && red.length === 0) {
        parts.push(`<div class="v-line v-ok">${t('validate.ok')}</div>`)
      }
      if (bad.length) parts.push(`<div class="v-line v-warn">${t('validate.unreachableList', { list: joinList(bad.map(c => c.index + 1)) })}</div>`)
      if (red.length) parts.push(`<div class="v-line v-info">${t('validate.redundantList', { list: joinList(red.map(c => c.index + 1)) })}</div>`)
      for (const w of report.warnings) {
        const params = { ...w.params }
        if (params.states) params.list = joinList(params.states.map(s => stateLabel(s)))
        parts.push(`<div class="v-line v-warn">⚠ ${t(w.key, params)}</div>`)
      }
      parts.push(`<div class="v-line v-info">${t('validate.reachable', { list: joinList(report.reachable.map(s => stateLabel(s))) })}</div>`)
    }
    el.validation.innerHTML = parts.join('')
  }

  function renderTable() {
    if (!report) { el.table.innerHTML = `<p class="note">${t('editor.noTable')}</p>`; return }
    el.table.innerHTML = `
      <table class="lut">
        <thead><tr><th>${t('editor.tableHead')}</th>${[0, 1, 2, 3, 4, 5, 6, 7, 8].map(n => `<th>${n}</th>`).join('')}</tr></thead>
        <tbody>${report.table.map(row => `
          <tr><th>${stateLabel(row.state)}</th>${row.cells.map(c =>
            `<td class="s-${c.next.startsWith('aging') ? 'aging' : c.next} ${c.fallback ? 'fb' : ''}">${stateLabel(c.next, true)}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>
      <p class="note">${t('editor.tableNote')}</p>`
  }

  /* ---------------- 导入 / 导出（D21） ---------------- */

  el.exportBtn.addEventListener('click', () => {
    if (!compiled) return
    el.io.hidden = false
    el.ioText.value = exportRule(compiled)
    el.ioMsg.className = 'note'
    el.ioMsg.textContent = t(compiled.bsExpressible ? 'editor.exportedBS' : 'editor.exportedJSON')
    el.ioText.select()
  })
  el.importBtn.addEventListener('click', () => {
    if (el.io.hidden) {
      el.io.hidden = false
      el.ioMsg.className = 'note'
      el.ioMsg.textContent = t('editor.importHint')
      el.ioText.value = ''
      el.ioText.focus()
      return
    }
    try {
      const r = importRule(el.ioText.value)
      draft = { agingLayers: r.agingLayers, clauses: deepClone(r.clauses) }
      el.ioMsg.className = 'note ok'
      el.ioMsg.textContent = t('editor.importOk', { fp: r.fingerprint })
      refresh()
    } catch (err) {
      el.ioMsg.className = 'note warn'
      el.ioMsg.textContent = t('editor.importFail', { msg: err.message })
    }
  })
  el.ioClose.addEventListener('click', () => { el.io.hidden = true })

  /* ---------------- 应用 / 取消 ---------------- */

  el.apply.addEventListener('click', () => {
    if (!compiled) return
    app.applyRule(compiled)
    close()
  })
  el.close.addEventListener('click', close)
  el.cancel.addEventListener('click', close)
  document.getElementById('rule-backdrop').addEventListener('click', close)
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !el.modal.hidden) close()
  })

  /** 切语言时调用：预设列表与所有动态文案重绘 */
  function relocalize() {
    renderPresets()
    if (!el.modal.hidden) refresh()
  }

  return { open, relocalize }

  /* ---------------- 小工具 ---------------- */

  function swap(a, b) {
    const t = draft.clauses[a]
    draft.clauses[a] = draft.clauses[b]
    draft.clauses[b] = t
  }
}

function stateOptions(agingLayers) {
  const out = [['dead', stateLabel('dead')], ['alive', stateLabel('alive')]]
  for (let k = 1; k <= agingLayers; k++) out.push([`aging_${k}`, stateLabel(`aging_${k}`)])
  return out
}

function options(pairs, selected) {
  const html = pairs.map(([v, label]) =>
    `<option value="${v}" ${v === selected ? 'selected' : ''}>${label}</option>`).join('')
  // 草稿里存的值可能已经越界（比如把衰老层数调小之后），此时 select 会默默显示第一项，
  // 界面就会和下面的错误提示自相矛盾。补一个禁用选项，把真实的值显示出来。
  if (selected !== undefined && !pairs.some(([v]) => v === selected)) {
    return `<option value="${selected}" selected disabled>⚠ ${selected}</option>` + html
  }
  return html
}

function defaultCond(op, prev) {
  switch (op) {
    case 'any': return { op: 'any' }
    case 'in': case 'not_in': return { op, values: (prev && prev.values) ? prev.values.slice() : [3] }
    case 'range': return { op, min: prev?.min ?? 2, max: prev?.max ?? 3 }
    default: return { op, value: prev?.value ?? 3 }
  }
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)) }
