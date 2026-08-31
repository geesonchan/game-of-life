// 收藏：填补玩具盒（单图案）与勘探器（规则）之间的空位 —— 收藏"摆好的局"。
// 纯数据层，零 DOM，可在 Node 里测。

/** 收藏列表的体积上限。超了明确拒绝，不静默丢弃（见 docs/decisions.md D82）。 */
export const MAX_BYTES = 256 * 1024

/** 单条布局的体积上限：一条就撑爆整个列表的话，用户连删都不好删 */
export const MAX_ENTRY_BYTES = 32 * 1024

/** 说明字段的字数上限 */
export const MAX_NOTE = 200

/**
 * 侧栏里默认露出几条自存的。再多就折起来，给一颗「展开全部」——
 * 侧栏是一整根滚动的柱子，在里面再开一个定高滚动区，滚轮和手指都会被吃掉一层（D83 §3）。
 */
export const RECENT_SHOWN = 5

/**
 * 内置精选局：随代码发布，不进 localStorage，用户删不掉也不占配额。
 * 每条都按 D64 的互动型标准带实测生平，并配回归测试。
 * `nameKey` 走词典（含简洁语域）；`life` 是实测数字，测试会钉住。
 */
export const BUILTIN_LAYOUTS = Object.freeze([
  {
    id: 'builtin:wildfire',
    nameKey: 'fav.builtin.wildfire',
    rle: 'x = 18, y = 5, rule = B3/S23\nb3o11b3o$o2bo10bo2bo$3bo4b3o6bo$3bo4bo2bo5bo$2bo4bo8bo!',
    // 生平的口径是**用户实际会看到的那一局**：应用默认的 200×200 环形盘，
    // 用应用自己的终止检测器 —— 点「复现」再播放，总结卡片上就是这几个数。
    //
    // 不用"大盘 + 核心窗口"那套口径，是因为它在这个图案上不成立：
    // 末态残骸的包围盒到 ±199，比我最初取的 ±140 窗口还大，
    // 于是那组数（5185 / 1822 / 1243）是被窗口裁出来的，不是内禀性质 ——
    // 换个窗口就变（±210 时到 7000 代都还没定型）。教训见 D82。
    life: { board: 200, boundary: 'torus', start: 22, settle: 3640, peak: 1438, peakGen: 1470, final: 735 }
  },
  {
    id: 'builtin:feeding',
    nameKey: 'fav.builtin.feeding',
    rle: 'x = 14, y = 14, rule = B3/S23\nbo$2bo$3o8$10b2o$10bobo$12bo$12b2o!',
    // 滑翔机 + 吞食者，第 30 代吞完并逐格复原（docs/patterns.md 那一局）
    life: { start: 12, eatenAt: 30, after: 7 }
  },
  {
    id: 'builtin:feeder',
    nameKey: 'fav.builtin.feeder',
    rle: 'x = 42, y = 28, rule = B3/S23\n24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4b\nobo$10bo5bo7bo$11bo3bo$12b2o16$38b2o$38bobo$40bo$40b2o!',
    // 滑翔机枪对着吞食者：跑稳后整盘严格周期 30，人口恒为 65。永动喂食机。
    life: { start: 43, period: 30, steady: 65 }
  }
])

/** RLE 的头行里带 rule 才能"复现"时切规则；没有头行就没法保证复现的是同一个世界 */
export function ruleOf(rle) {
  const m = /rule\s*=\s*([^\s,]+)/i.exec(String(rle))
  return m ? m[1] : null
}

/**
 * 校验一条布局收藏。返回 {ok:true} 或 {ok:false, key}（只回 key，人话交给词典）。
 */
export function validateLayout(entry) {
  if (!entry || typeof entry !== 'object') return { ok: false, key: 'fav.err.shape' }
  const name = String(entry.name ?? '').trim()
  if (!name) return { ok: false, key: 'fav.err.noName' }
  if (name.length > 60) return { ok: false, key: 'fav.err.longName' }
  const rle = String(entry.rle ?? '')
  if (!rle.trim()) return { ok: false, key: 'fav.err.noRle' }
  if (!ruleOf(rle)) return { ok: false, key: 'fav.err.noRule' }
  if (byteLength(rle) > MAX_ENTRY_BYTES) return { ok: false, key: 'fav.err.tooBig' }
  // 说明是可选的，但不能长到把卡片撑变形 —— 明确拒绝，不静默截断：
  // 截断的是用户自己写的字，悄悄砍掉半句比不让存更难受（D83 §1）
  if (String(entry.note ?? '').length > MAX_NOTE) return { ok: false, key: 'fav.err.longNote' }
  return { ok: true }
}

/** UTF-8 字节数。localStorage 按字符算配额，但导出的 JSON 是按字节走的，取严的那个。 */
export function byteLength(s) {
  let n = 0
  for (const ch of String(s)) {
    const c = ch.codePointAt(0)
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
  }
  return n
}

/**
 * 整份收藏是否还在预算内。量的是导出后的那份 JSON —— 与 localStorage 里存的是同一串，
 * 口径只有一个，免得"面板说没满、存的时候却爆了"。
 */
export function fitsBudget(state, max = MAX_BYTES) {
  const s = Array.isArray(state) ? { layouts: state, rules: [] } : state
  return byteLength(exportFavorites(s)) <= max
}

/** 导出：一个自带版本号的信封，便于以后改格式时认得出旧文件 */
export function exportFavorites(state) {
  return JSON.stringify({
    kind: 'gol.favorites',
    version: 1,
    layouts: state.layouts || [],
    rules: state.rules || []
  }, null, 2)
}

/**
 * 导入。宽进严出：认版本号、逐条校验、坏条目跳过而不是整包拒绝 ——
 * 一条坏数据废掉整个收藏文件，对用户是最差的结果。
 * @returns {{ok:boolean, key?:string, layouts?:Array, rules?:Array, skipped?:number}}
 */
export function importFavorites(text) {
  let data
  try { data = JSON.parse(text) } catch { return { ok: false, key: 'fav.err.badJson' } }
  if (!data || data.kind !== 'gol.favorites') return { ok: false, key: 'fav.err.notFav' }
  if (data.version !== 1) return { ok: false, key: 'fav.err.version' }
  const layouts = [], rules = []
  let skipped = 0
  for (const e of Array.isArray(data.layouts) ? data.layouts : []) {
    if (validateLayout(e).ok) layouts.push(normalizeLayout(e)); else skipped++
  }
  for (const r of Array.isArray(data.rules) ? data.rules : []) {
    if (r && typeof r.fingerprint === 'string' && typeof r.notation === 'string') rules.push(normalizeRule(r))
    else skipped++
  }
  return { ok: true, layouts, rules, skipped }
}

/** 规整一条布局：只保留认识的字段，防止导入的文件夹带别的东西 */
export function normalizeLayout(e) {
  return {
    id: String(e.id || ('fav:' + byteLength(String(e.rle)) + ':' + String(e.name).slice(0, 8))),
    name: String(e.name).trim().slice(0, 60),
    rle: String(e.rle),
    note: String(e.note ?? '').slice(0, MAX_NOTE),
    life: normalizeLife(e.life)
  }
}

/** 生平的四种结局 + 一个"跑不出来" */
export const LIFE_ENDS = Object.freeze(['cycle', 'still', 'extinction', 'capped', 'error'])

/**
 * 规整生平。两种形态都认：
 * - **结构**（本机跑出来的）：数字是数据，措辞交给词典 —— 于是同一条收藏在中英两种界面里
 *   读到的是同一组数字、各自的句子。
 * - **字符串**（旧条目、或别人导出的文件）：原样留着，不改写也不翻译。
 * 外来文件是不可信输入，逐字段收敛，认不出的结论一律记为 error（卡片上留白，不编故事）。
 */
export function normalizeLife(life) {
  if (typeof life === 'string') return life.slice(0, MAX_NOTE)
  if (!life || typeof life !== 'object') return ''
  const n = v => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0)
  const end = LIFE_ENDS.includes(life.end) ? life.end : 'error'
  const out = {
    end,
    board: n(life.board),
    boundary: life.boundary === 'dead' ? 'dead' : 'torus',
    start: n(life.start), gen: n(life.gen),
    peak: n(life.peak), peakGen: n(life.peakGen), final: n(life.final)
  }
  if (end === 'cycle') out.period = n(life.period)
  return out
}

/**
 * 生平那一行的文字。数字来自实跑，措辞来自词典。
 * @param {object|string} life
 * @param {(key:string, params?:object)=>string} tr 取词函数（注入进来，数据层不认识 i18n 模块）
 */
export function lifeText(life, tr) {
  if (!life) return ''
  if (typeof life === 'string') return life          // 外来的：原样显示
  if (life.pending) return tr('fav.life.running')
  const key = {
    cycle: 'fav.life.cycle', still: 'fav.life.still',
    extinction: 'fav.life.extinct', capped: 'fav.life.capped'
  }[life.end]
  if (!key) return ''                                // error：本机复现不出来，留白
  // 峰值只在它真的发生过时才说。一架滑翔机的峰值是"第 0 代 5 格"——
  // 那不是峰值，那是起点，写出来只会让人以为它长过。
  return tr(key, life) + (life.peakGen > 0 ? tr('fav.life.peak', life) : '')
}

/**
 * 一条布局 → 一张卡片的数据。内置与自存**走同一个出口**，卡片才可能长得一样（D83 §1）。
 *
 * 内置的名称/说明/生平三样全走词典；自存的名称与说明**一个字都不过词典** ——
 * 那是用户自己写的内容，没有译文可给，改写它只会把他写的东西弄丢。
 * 只有生平那一行两边同源：数字是系统按同一口径跑出来的，措辞才走词典。
 */
export function layoutRow(entry, tr) {
  if (entry.nameKey) {
    return {
      id: entry.id, rle: entry.rle, builtin: true,
      name: tr(entry.nameKey), note: tr(entry.nameKey + '.desc'), life: tr(entry.nameKey + '.life')
    }
  }
  return {
    id: entry.id, rle: entry.rle, builtin: false,
    name: entry.name, note: entry.note || '', life: lifeText(entry.life, tr)
  }
}

/**
 * 整张卡片列表：内置在前（随代码发布、删不掉、不占配额），自存的**新的在前**。
 * 新的在前是为了取用区那条横条：刚存完的那一局就在开头，不必横滑到尽头去找（D83 §3）。
 */
export function layoutRows(state, tr) {
  const builtin = BUILTIN_LAYOUTS.map(b => layoutRow(b, tr))
  const mine = (state.layouts || []).slice().reverse().map(e => layoutRow(e, tr))
  return builtin.concat(mine)
}

/**
 * 侧栏的折叠：内置恒显示，自存的只露最近 `recent` 条，其余折起来。
 * @returns {{rows:Array, hidden:number}} hidden 是被折起来的条数（0 表示没折）
 */
export function foldRows(rows, expanded, recent = RECENT_SHOWN) {
  const mine = rows.reduce((n, r) => n + (r.builtin ? 0 : 1), 0)
  if (expanded || mine <= recent) return { rows, hidden: 0 }
  let seen = 0
  return { rows: rows.filter(r => r.builtin || ++seen <= recent), hidden: mine - recent }
}

/**
 * 规整一条规则收藏。留住的字段正是"复现那一局"要用的：
 * clauses/agingLayers 定世界，seed 定那一盘 —— 少一个就复现不出来。
 */
export function normalizeRule(r) {
  return {
    notation: String(r.notation || ''),
    fingerprint: String(r.fingerprint),
    clauses: Array.isArray(r.clauses) ? r.clauses : [],
    agingLayers: Number(r.agingLayers) | 0,
    seed: r.seed,
    outcome: r.outcome
  }
}

/**
 * 活细胞的外接框。收藏整盘时用它把 200×200 的空白削掉 ——
 * 存下来的是"这个局长什么样"，不是"当时棋盘多大"。
 * 只削外圈，框内相对间距一格不动。
 * @param {(x:number,y:number)=>number} get 取格子的函数
 * @param {{x:number,y:number,w:number,h:number}} box 搜索范围
 * @returns {{x:number,y:number,w:number,h:number}|null} 全空则 null
 */
export function liveBounds(get, box) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      if (get(x, y) !== 1) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/**
 * 合并导入的收藏，而不是覆盖。
 * 覆盖的话，导入一份别人的收藏就把自己的全洗掉了 —— 那是不可撤销的损失，
 * 而合并的反面（多出几条）用户删得掉。同 id / 同 fingerprint 的算已有，不重复添。
 * 超预算的条目明确记为跳过，不静默丢。
 */
export function mergeFavorites(state, incoming, max = MAX_BYTES) {
  const layouts = (state.layouts || []).slice()
  const rules = (state.rules || []).slice()
  let added = 0, skipped = 0
  for (const e of incoming.layouts || []) {
    if (layouts.some(x => x.id === e.id)) { skipped++; continue }
    const next = layouts.concat([e])
    if (!fitsBudget({ layouts: next, rules }, max)) { skipped++; continue }
    layouts.push(e)
    added++
  }
  for (const r of incoming.rules || []) {
    if (rules.some(x => x.fingerprint === r.fingerprint)) { skipped++; continue }
    const next = rules.concat([r])
    if (!fitsBudget({ layouts, rules: next }, max)) { skipped++; continue }
    rules.push(r)
    added++
  }
  return { layouts, rules, added, skipped }
}

/** 加一条，带预算检查。满了就明确拒绝，不悄悄丢最旧的。 */
export function addLayout(list, entry, max = MAX_BYTES) {
  const v = validateLayout(entry)
  if (!v.ok) return { ok: false, key: v.key, list }
  const next = list.concat([normalizeLayout(entry)])
  if (!fitsBudget(next, max)) return { ok: false, key: 'fav.err.full', list }
  return { ok: true, list: next }
}
