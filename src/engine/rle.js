// 标准 RLE 格式的解析与生成（LifeWiki / Golly 通用格式）。
// 纯字符串处理，零 DOM 依赖，可在 Node/jsc 里测。
//
// 格式要点：
//   #N name / #C comment   —— 以 # 开头的元信息行
//   x = 36, y = 9, rule = B3/S23
//   24bo$22bobo$…!         —— b 死 o 活 $ 换行 ! 结束，数字是前缀重复次数
// 正文里的换行与空白一律忽略（长图案会被折行，折点可能落在数字和字母中间）。

const HEADER_RE = /^\s*x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)\s*(?:,\s*rule\s*=\s*([^\n,]+?)\s*)?$/i

/**
 * @param {string} text
 * @returns {{w:number, h:number, rule:string|null, name:string|null,
 *            cells:number[][], truncated:boolean}}
 */
export function parseRLE(text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('RLE 内容为空')

  const lines = text.split(/\r?\n/)
  let name = null
  let header = null
  let bodyStart = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*#/.test(line)) {
      const m = /^\s*#N\s+(.*\S)/.exec(line)
      if (m && !name) name = m[1]
      continue
    }
    if (line.trim() === '') continue
    const h = HEADER_RE.exec(line)
    if (h) {
      header = { w: Number(h[1]), h: Number(h[2]), rule: h[3] ? h[3].trim() : null }
      bodyStart = i + 1
      break
    }
    // 没有头行的裸正文也收（有些地方复制出来会丢头行）
    bodyStart = i
    break
  }
  if (bodyStart === -1) throw new Error('找不到 RLE 正文')

  const body = lines.slice(bodyStart).join('')
  const cells = []
  let x = 0, y = 0, count = 0, maxX = 0
  let sawTerminator = false

  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c >= '0' && c <= '9') { count = count * 10 + (c.charCodeAt(0) - 48); continue }
    if (/\s/.test(c) || c === '#') continue
    const n = count === 0 ? 1 : count
    count = 0
    if (c === 'b' || c === 'B' || c === '.') {
      x += n
    } else if (c === 'o' || c === 'O' || c === '*' || (c >= 'A' && c <= 'X')) {
      // 大写字母是 Generations 族的衰老态编码；这里一律当作"有细胞"收下
      for (let k = 0; k < n; k++) cells.push([x + k, y])
      x += n
    } else if (c === '$') {
      if (x > maxX) maxX = x
      y += n
      x = 0
    } else if (c === '!') {
      sawTerminator = true
      break
    } else {
      throw new Error(`RLE 里出现无法识别的字符「${c}」`)
    }
  }
  if (x > maxX) maxX = x
  if (!sawTerminator && cells.length === 0) throw new Error('RLE 正文没有任何细胞')

  // 头行的尺寸只是声明值；以实际解出来的为准，两者不一致时取大的，免得裁掉内容
  const realW = cells.length ? Math.max(...cells.map(c => c[0])) + 1 : 0
  const realH = cells.length ? Math.max(...cells.map(c => c[1])) + 1 : 0
  const w = Math.max(header ? header.w : 0, realW, maxX)
  const h = Math.max(header ? header.h : 0, realH, y + (cells.length ? 1 : 0))

  return {
    w, h,
    rule: header ? header.rule : null,
    name,
    cells,
    declared: header ? [header.w, header.h] : null
  }
}

/**
 * 把一块矩形区域生成标准 RLE。
 * @param {(x:number,y:number)=>boolean} isAlive 取值函数，坐标是区域内的相对坐标
 * @param {number} w @param {number} h
 * @param {{rule?:string, name?:string, wrap?:number}} [opts]
 */
export function toRLE(isAlive, w, h, opts = {}) {
  const wrap = opts.wrap ?? 70
  const tokens = []
  let pendingBlankRows = 0   // 自上一次写出的行以来，跳过了多少个空行
  let wroteAnyRow = false
  const sep = n => (n > 1 ? `${n}$` : '$')

  for (let y = 0; y < h; y++) {
    // 先把这一行编码出来，行尾连续的死细胞一律省掉（标准做法）
    const row = []
    let runChar = null, runLen = 0
    let lastAliveEnd = 0
    for (let x = 0; x < w; x++) {
      const ch = isAlive(x, y) ? 'o' : 'b'
      if (ch === runChar) runLen++
      else {
        if (runChar) row.push([runChar, runLen])
        runChar = ch; runLen = 1
      }
      if (ch === 'o') lastAliveEnd = row.reduce((s, r) => s + r[1], 0) + runLen
    }
    if (runChar) row.push([runChar, runLen])

    if (lastAliveEnd === 0) { pendingBlankRows++; continue }   // 整行是空的，攒着
    // $ 是"换到下一行"，所以：行与行之间是 1 个 + 中间空行数；
    // 而**开头的空行**同样要写出来，否则整个图案会往上平移 —— 第一版就漏了这一支。
    if (wroteAnyRow) tokens.push(sep(pendingBlankRows + 1))
    else if (pendingBlankRows > 0) tokens.push(sep(pendingBlankRows))
    pendingBlankRows = 0

    let used = 0
    for (const [ch, len] of row) {
      if (used >= lastAliveEnd) break
      const take = Math.min(len, lastAliveEnd - used)
      tokens.push(take > 1 ? `${take}${ch}` : ch)
      used += take
    }
    wroteAnyRow = true
  }
  tokens.push('!')

  // 折行，且不在数字与字母之间断开（tokens 本身就是最小不可分单元）
  const head = `x = ${w}, y = ${h}, rule = ${opts.rule || 'B3/S23'}`
  const lines = []
  let line = ''
  for (const tok of tokens) {
    if (line.length + tok.length > wrap) { lines.push(line); line = '' }
    line += tok
  }
  if (line) lines.push(line)
  const nameLine = opts.name ? `#N ${opts.name}\n` : ''
  return `${nameLine}${head}\n${lines.join('\n')}\n`
}

/** 从引擎的一块矩形区域直接生成 RLE */
export function boardToRLE(engine, x0, y0, w, h, opts = {}) {
  return toRLE((x, y) => engine.get(x0 + x, y0 + y) === 1, w, h, opts)
}
