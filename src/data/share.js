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
 * @param {{rule:string, boundary:string, board:number, seed?:number, density?:number, rle?:string}} state
 * @param {number} [budget] 除 hash 之外这条链接还占多少字符（页面地址本身）
 * @returns {{hash:string, droppedPattern:boolean}}
 */
export function encodeShare(state, budget = 0) {
  const parts = [
    'v=' + SHARE_VERSION,
    'r=' + encodeURIComponent(state.rule || 'B3/S23'),
    'b=' + (state.boundary === 'dead' ? 'd' : 't'),
    'n=' + (state.board | 0)
  ]
  if (Number.isFinite(state.seed)) parts.push('s=' + (state.seed >>> 0))
  if (Number.isFinite(state.density)) parts.push('d=' + Number(state.density).toFixed(2))
  let droppedPattern = false
  if (state.rle) {
    const p = 'p=' + toBase64url(state.rle)
    if (budget + parts.join('&').length + 1 + p.length + 1 <= MAX_URL) parts.push(p)
    else droppedPattern = true      // 带不下就不带，并且要让上层说出来
  }
  return { hash: '#' + parts.join('&'), droppedPattern }
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
  if (q.p !== undefined) {
    const rle = fromBase64url(q.p)
    if (!rle) return { ok: false, reason: 'pattern' }
    state.rle = rle
  }
  return { ok: true, state }
}
