// **会话中途**谁能改棋盘与环境 —— D107 那张表的下半张（D110 §10）。
//
// 上半张（`startup.js` 的 `SOURCES`）管的是"开机那一刻棋盘从哪儿来"。
// 但用户手机上那个 bug 发生在**中途**：200×200 改成 300×300，格子全没了。
// 上半张表和它的守卫一条都管不着 —— 它们只看启动段。
//
// 这是同一族的第五次"验的不是同一个东西"：
// 不是同一版 / 不是同一条路 / 不是同一种人 / 不是同一个时刻 / **不是同一个会话阶段**。
//
// 两张表同源同数据：字段一样、守卫一样、文档那张表照它写。

/**
 * `writes` —— 它动什么：cells（格子）/ env（尺寸、边界、规则、速度）/ view（取景）
 * `keeps`  —— 对**已经在盘上的东西**怎么办：
 *   · `carry`   搬过去（用户的劳动不许被静默清掉，D82/D93 的老原则）
 *   · `replace` 明确换局（用户点的就是"换成另一局"）
 *   · `keep`    根本不碰格子
 * `asks`   —— 会不会先问一句（会毁掉东西的才问，D93）
 */
export const SESSION_WRITERS = Object.freeze([
  { name: 'stamp', writes: 'cells', keeps: 'carry', asks: false, desc: '落图案：在现有棋盘上添东西' },
  { name: 'draw', writes: 'cells', keeps: 'carry', asks: false, desc: '手画/擦除（可撤销）' },
  { name: 'randomize', writes: 'cells', keeps: 'replace', asks: false, desc: '随机填充：用户点的就是"换一盘"' },
  { name: 'clear', writes: 'cells', keeps: 'replace', asks: false, desc: '清空：用户点的就是"全没了"' },
  { name: 'resizeBoard', writes: 'env+view', keeps: 'carry', asks: true, desc: '改盘尺寸：内容搬过去；只有装不下时才问' },
  { name: 'setBoundary', writes: 'env', keeps: 'keep', asks: false, desc: '改边界：格子不动' },
  { name: 'applyNotation', writes: 'env', keeps: 'keep', asks: false, desc: '改规则：格子不动' },
  { name: 'setSpeed', writes: 'env', keeps: 'keep', asks: false, desc: '改速度' },
  { name: 'showcase', writes: 'cells+env+view', keeps: 'replace', asks: true, desc: '载入内置精彩局：同规则同环境走待放，否则确认（D93/D104）' },
  { name: 'loadFile', writes: 'cells+env+view', keeps: 'replace', asks: true, desc: '读档' },
  { name: 'pasteLink', writes: 'cells+env+view', keeps: 'replace', asks: false, desc: '页面开着时粘链接（hashchange）' },
  { name: 'enterShow', writes: 'cells+env+view', keeps: 'replace', asks: false, desc: '进看展：进之前先存整份快照' },
  { name: 'exitShow', writes: 'cells+env+view', keeps: 'replace', asks: false, desc: '退看展：还原进入前那一刻的快照' },
  { name: 'minimapJump', writes: 'view', keeps: 'keep', asks: false, desc: '点小地图跳视野' },
  { name: 'gesture', writes: 'view', keeps: 'keep', asks: false, desc: '缩放/平移手势、适配整盘' }
])

/**
 * 改盘尺寸时旧内容往哪儿搬：**居中**。
 *
 * 变大时"棋盘在四周长出来"，用户摆的东西留在原处（视觉上不动）；
 * 变小时居中裁切，掉在外面的活格子会没 —— 那种情况必须先问一句。
 *
 * 纯函数：只算偏移与会不会丢，谁都不碰。
 * @param {{w:number,h:number}} from 旧盘
 * @param {{w:number,h:number}} to   新盘
 * @param {{minX:number,minY:number,maxX:number,maxY:number}|null} bounds 活格子的包围盒
 */
export function resizePlan(from, to, bounds) {
  let offsetX = Math.floor((to.w - from.w) / 2)
  let offsetY = Math.floor((to.h - from.h) / 2)
  let lost = false
  if (bounds) {
    // 变小的时候，**能保住就保住**：包围盒装得进新盘的话，把居中偏移夹进
    // "刚好装得下"的那段区间里，而不是硬按盘心裁。
    // 不夹的话会出现这种事：用户确认了"那部分会没"，结果**全没了** ——
    // 提示说的是"部分"，做的却是"全部"，那句提示就成了假话。
    offsetX = clampOffset(offsetX, bounds.minX, bounds.maxX, to.w)
    offsetY = clampOffset(offsetY, bounds.minY, bounds.maxY, to.h)
    lost = bounds.minX + offsetX < 0 || bounds.minY + offsetY < 0 ||
           bounds.maxX + offsetX >= to.w || bounds.maxY + offsetY >= to.h
  }
  return { offsetX, offsetY, lost }
}

/** 把偏移夹进"包围盒完整落在新盘里"的那段区间；装不下（区间为空）就原样返回 */
function clampOffset(offset, min, max, size) {
  const lo = -min, hi = size - 1 - max
  if (lo > hi) return offset          // 本来就装不下，夹也没用
  return Math.max(lo, Math.min(hi, offset))
}

/**
 * 整份会话快照：**格子 + 环境 + 取景**。
 *
 * 用户问过一句要紧的：D104 的 `showEnv` 存的是环境**还是**环境 + 棋盘内容？
 * 答案是**只有环境**（board/boundary/speed 三个数），格子一个都没存。
 * 所以"退看展要退回进入前那一刻"用它做不到 —— 得用这一份。
 * 改尺寸搬内容与进出看展共用它，不做两套。
 */
export function captureSession(engine, extra = {}) {
  return {
    w: engine.w,
    h: engine.h,
    cells: engine.cur.slice(),
    generation: engine.generation,
    boundary: engine.boundary,
    rule: (engine.rule && engine.rule.notation) || 'B3/S23',
    speed: extra.speed,
    view: extra.view || null,
    runDirty: !!extra.runDirty
  }
}

/**
 * 把一份快照里的格子贴进目标数组（按偏移）。越界的直接丢 —— 调用方该先问过了。
 * 返回真正贴进去多少个活格子。
 */
export function pasteCells(cells, from, into, to, offsetX, offsetY) {
  let n = 0
  for (let y = 0; y < from.h; y++) {
    const ty = y + offsetY
    if (ty < 0 || ty >= to.h) continue
    for (let x = 0; x < from.w; x++) {
      const v = cells[y * from.w + x]
      if (!v) continue
      const tx = x + offsetX
      if (tx < 0 || tx >= to.w) continue
      into[ty * to.w + tx] = v
      n++
    }
  }
  return n
}

/**
 * 活格子的包围盒。**一处定义，两处用** —— 按钮那边拿它判断"会不会丢"，
 * `resizeBoard` 拿它算真正要用的偏移。两处各写一遍的话，
 * 问的那句话和做的那件事就可能对不上（问"会丢一点"，做出来"全丢"）。
 * @returns {{minX,minY,maxX,maxY}|null} 盘上没有活格子时返回 null
 */
export function cellBounds(cells, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (!cells[row + x]) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY }
}
