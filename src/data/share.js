// 可分享链接（D106）。把"这一局在什么世界里跑"编进 URL 的 hash，打开即复现。
//
// **为什么放 hash 而不是查询串**：GitHub Pages 是静态托管，查询串会原样发到服务器
// （多一次没意义的往返，也可能被缓存层当成另一个页面）；hash 压根不出浏览器。
//
// **为什么没上通用压缩**：浏览器里的 CompressionStream 是异步的，而"复制链接"这个动作
// 要在点击那一刻就把字符串交出去；为一条链接引入一个压缩库又太重。
// RLE 本身就是跑长编码 —— 够用；**不够的就明说不支持**，而不是塞一条打不开的链接给人。

/** 编码版本。格式一变就加一 —— 老链接打开时能认出"这是哪一版"，而不是解出一堆乱码 */
export const SHARE_VERSION = 1

/**
 * 链接长度上限。2000 是各家浏览器与聊天软件都稳的那条线
 * （IE 的 2083 是历史下限，微信/Slack 之类转发时也大多在两千上下开始截断）。
 * 超了就不带格子 —— 环境照带，并明确告诉用户"这一局太大，链接里带不下"。
 */
export const MAX_URL = 2000

/** base64url：自己写，避免 btoa / Buffer 在两个运行器里不一样 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
export function toBase64url(text) {
  let out = ''
  const bytes = utf8Bytes(text)
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2]
    out += B64[a >> 2]
    out += B64[((a & 3) << 4) | ((b === undefined ? 0 : b) >> 4)]
    out += b === undefined ? '' : B64[((b & 15) << 2) | ((c === undefined ? 0 : c) >> 6)]
    out += c === undefined ? '' : B64[c & 63]
  }
  return out
}
export function fromBase64url(s) {
  const bytes = []
  let acc = 0, bits = 0
  for (const ch of String(s)) {
    const v = B64.indexOf(ch)
    if (v < 0) continue
    acc = (acc << 6) | v
    bits += 6
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255) }
  }
  return utf8String(bytes)
}
function utf8Bytes(text) {
  const out = []
  for (const ch of String(text)) {
    let c = ch.codePointAt(0)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return out
}
function utf8String(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]
    if (b < 0x80) { out += String.fromCodePoint(b); i += 1 }
    else if (b < 0xe0) { out += String.fromCodePoint(((b & 31) << 6) | (bytes[i + 1] & 63)); i += 2 }
    else if (b < 0xf0) {
      out += String.fromCodePoint(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63)); i += 3
    } else {
      out += String.fromCodePoint(((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) |
        ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63)); i += 4
    }
  }
  return out
}

/**
 * 编码一局。字段刻意短，但**不缩写到看不懂** —— 链接是给人看也给人改的。
 *   v 版本 · r 规则记法 · b 边界(t/d) · n 盘边长 · s 种子 · d 密度 · p 图案（base64url 的 RLE）
 *   cx cy 看的是哪儿（视野中心的格坐标）· w 看多宽（视野短边跨过多少格）· sp 播放速度
 *
 * **视图为什么编成"中心 + 跨度"而不是"缩放倍率"**（D108）：倍率是屏幕的属性，不是这一局的。
 * 发的人 33.5×（在他那块屏上正好框住三架滑翔机），收的人屏幕不一样，照抄那个数就框不住同一片东西。
 * 编"看哪儿、看多宽"，让收的人自己算出他那块屏上对应的倍率 —— 传过去的才是**取景**，不是数字。
 *
 * **加字段不升版本位**：老链接没有这几个字段 → 当作"没指定"，照旧自动适配视图；
 * 新链接给老版本打开 → 多出来的字段被忽略，仍然打得开。**两个方向都退化得干净，就不必升版本。**
 * 版本位留给"改变已有字段的含义 / 去掉字段"那种真正不兼容的改动。
 * @param {{rule:string, boundary:string, board:number, seed?:number, density?:number, rle?:string}} state
 * @param {number} [budget] 除 hash 之外这条链接还占多少字符（页面地址本身）
 * @returns {{hash:string, droppedPattern:boolean}}
 */
export function encodeShare(state, budget = 0) {
  const parts = [
    'r=' + encodeURIComponent(state.rule || 'B3/S23'),
    'b=' + (state.boundary === 'dead' ? 'd' : 't'),
    'n=' + (state.board | 0)
  ]
  if (Number.isFinite(state.seed)) parts.push('s=' + (state.seed >>> 0))
  if (Number.isFinite(state.density)) parts.push('d=' + Number(state.density).toFixed(2))
  if (state.view && Number.isFinite(state.view.cx)) {
    parts.push('cx=' + Math.round(state.view.cx))
    parts.push('cy=' + Math.round(state.view.cy))
    parts.push('w=' + Math.max(1, Math.round(state.view.span)))
  }
  if (Number.isFinite(state.speed)) parts.push('sp=' + Math.max(1, Math.min(60, Math.round(state.speed))))
  let droppedPattern = false
  if (state.rle) {
    const p = 'p=' + toBase64url(state.rle)
    if (budget + parts.join('&').length + 1 + p.length + 1 <= MAX_URL) parts.push(p)
    else droppedPattern = true      // 带不下就不带，并且要让上层说出来
  }
  // **完整性字段放在头部**（D110 §9）：截断只切得掉尾巴，切不掉它。
  // L 记的是它后面那一截的长度 —— 转发通道把链接截短，收的人这边一比就对不上，
  // 于是"静默拿到半张图"变成"明确拒绝"。老链接没有 L，照旧当"没这一层保护"接受。
  const rest = parts.join('&')
  const hash = '#v=' + SHARE_VERSION + '&L=' + rest.length + '&' + rest
  // URL 里出现换行/空白，转发通道的链接识别会在那儿断掉（微信实测）。
  // 编码器现在不会产生它们，但这道断言留着 —— 以后谁加了带空白的字段，这里当场就炸。
  if (/\s/.test(hash)) throw new Error('分享链接里不许出现空白字符：' + JSON.stringify(hash.slice(0, 80)))
  return { hash, droppedPattern }
}

/**
 * 解码。**外来输入一律不可信**：认不出的版本、缺字段、坏数字，都回一个带原因的失败，
 * 而不是拿默认值凑一局出来 —— 那样用户以为自己打开的是别人那一局，其实不是。
 * @returns {{ok:true, state:object}|{ok:false, reason:string}}
 */
export function decodeShare(hash) {
  const raw = String(hash || '').replace(/^#/, '')
  if (!raw) return { ok: false, reason: 'empty' }
  const q = {}
  for (const kv of raw.split('&')) {
    const i = kv.indexOf('=')
    if (i > 0) q[kv.slice(0, i)] = kv.slice(i + 1)
  }
  const v = Number(q.v)
  if (!Number.isFinite(v)) return { ok: false, reason: 'noVersion' }
  if (v > SHARE_VERSION) return { ok: false, reason: 'newer' }
  // 完整性：L 说了后面该有多长，对不上就是被截断（或被接了尾巴）——
  // 宁可明说"这条链接不完整"，也不能让人拿着半张图以为看到的是发的人那一局。
  if (q.L !== undefined) {
    const want = Number(q.L)
    const at = raw.indexOf('&L=' + q.L + '&')
    const rest = at >= 0 ? raw.slice(at + ('&L=' + q.L + '&').length) : null
    if (!Number.isFinite(want) || rest === null || rest.length !== want) {
      return { ok: false, reason: 'truncated' }
    }
  }
  const board = Number(q.n)
  if (!Number.isFinite(board) || board < 8 || board > 4096) return { ok: false, reason: 'board' }
  const state = {
    version: v,
    rule: decodeURIComponent(q.r || 'B3/S23'),
    boundary: q.b === 'd' ? 'dead' : 'torus',
    board: Math.round(board)
  }
  if (q.s !== undefined) {
    const seed = Number(q.s)
    if (!Number.isFinite(seed)) return { ok: false, reason: 'seed' }
    state.seed = seed >>> 0
  }
  if (q.d !== undefined) {
    const den = Number(q.d)
    if (!Number.isFinite(den) || den < 0 || den > 1) return { ok: false, reason: 'density' }
    state.density = den
  }
  if (q.cx !== undefined || q.cy !== undefined || q.w !== undefined) {
    const cx = Number(q.cx), cy = Number(q.cy), span = Number(q.w)
    // 三个一起才算数：缺一个就说不清"看哪儿、看多宽"，宁可当没给（照旧自动适配）
    if (![cx, cy, span].every(Number.isFinite) || span <= 0 || span > 65536) return { ok: false, reason: 'view' }
    state.view = { cx, cy, span }
  }
  if (q.sp !== undefined) {
    const sp = Number(q.sp)
    if (!Number.isFinite(sp) || sp < 1 || sp > 60) return { ok: false, reason: 'speed' }
    state.speed = Math.round(sp)
  }
  if (q.p !== undefined) {
    const rle = fromBase64url(q.p)
    if (!rle) return { ok: false, reason: 'pattern' }
    // **RLE 以 `!` 收尾**。缺尾就是没传完 —— 而半截 RLE 是能解析的：
    // 实测砍到 85% 仍然解出 7 格（本该 15 格），收的人一点提示都没有。
    // 这道检查独立于 L：手抄漏一截、编辑器折行截断，L 不一定发现，这里发现。
    if (rle.indexOf('!') < 0) return { ok: false, reason: 'truncated' }
    state.rle = rle
  }
  return { ok: true, state }
}

/**
 * 图案带不下时，**种子还能不能替它把这一局说清楚**。
 * 三条都成立才算：这一局是种子随机来的、没被手改过、还停在第 0 代。
 * 少一条，收的人看到的就不是发的人那一局 —— 而且没有任何迹象。
 */
export function seedCanTell(ctx) {
  return !!ctx && ctx.initType === 'random' && !ctx.runDirty && (ctx.generation | 0) === 0
}

/**
 * 这一局到底能不能用链接分享（D110 §8）。
 *
 * `'ok'`      —— 图案带得下，或者盘上本来就没东西
 * `'seedOnly'` —— 图案带不下，但种子 + 密度足以完整复现（稠密随机局的正常路）
 * `'refuse'`  —— 三条路全断：种子说不清、图案又装不进链接。
 *   **这时不生成链接**。降级给一张空盘或第 0 代，等于把失败推给收的人，
 *   而且他看不出来 —— 失败必须发生在分享的人这边，看得见（用户定的原则）。
 */
export function shareVerdict(ctx) {
  if (!ctx || !ctx.droppedPattern) return 'ok'
  if ((ctx.alive | 0) <= 0) return 'ok'
  if (seedCanTell(ctx)) return 'seedOnly'
  // **两档，不是一档**（用户修正）：
  //  · 手改过（或压根不是种子来的）→ 种子指向的是另一局，硬拒；
  //  · 只是跑过代、种子干净 → 链接带得回第 0 代，**这不是废链接，只是不是这一帧**。
  //    那是分享的人自己的取舍，把决定还给他 —— 信息已经摆在他面前了。
  //    硬拒是替用户做决定。（`g=` 落地后这一档自动消失。）
  if (ctx.initType === 'random' && !ctx.runDirty) return 'askGen'
  return 'refuse'
}
