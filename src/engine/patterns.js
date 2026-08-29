// 内置图案库。纯数据 + 一个放置函数，零 DOM 依赖，可在 Node 里测。
// 图案用 ASCII 写（O = 活，. = 死），编译期解析成坐标数组。
// 阶段 5 会接标准 RLE 格式，那时这里改成用 RLE 字符串即可，接口不变。

const SOURCES = {
  glider: `
.O.
..O
OOO`,

  // Gosper 滑翔机枪：每 30 代吐出一架滑翔机
  gun: `
........................O...........
......................O.O...........
............OO......OO............OO
...........O...O....OO............OO
OO........O.....O...OO..............
OO........O...O.OO....O.O...........
..........O.....O.......O...........
...........O...O....................
............OO......................`,

  pulsar: `
..OOO...OOO..
.............
O....O.O....O
O....O.O....O
O....O.O....O
..OOO...OOO..
.............
..OOO...OOO..
O....O.O....O
O....O.O....O
O....O.O....O
.............
..OOO...OOO..`,

  // 轻量飞船（LWSS），对应 LifeWiki 的 RLE：bo2bo$o4b$o3bo$4o!
  lwss: `
.O..O
O....
O...O
OOOO.`,

  rpentomino: `
.OO
OO.
.O.`
}

/** 把 ASCII 图案解析成 {w, h, cells:[[x,y],…]} */
function parseAscii(text) {
  const rows = text.trim().split('\n')
  const cells = []
  let w = 0
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]
    if (row.length > w) w = row.length
    for (let x = 0; x < row.length; x++) {
      if (row[x] === 'O') cells.push([x, y])
    }
  }
  return { w, h: rows.length, cells }
}

/**
 * 图案清单。名称与说明不在这里 —— 走 i18n 词典的 pattern.<key> / pattern.<key>.desc。
 * @type {Array<{key:string, w:number, h:number, cells:number[][]}>}
 */
export const PATTERNS = Object.keys(SOURCES).map(key => ({ key, ...parseAscii(SOURCES[key]) }))

export function getPattern(key) {
  const p = PATTERNS.find(x => x.key === key)
  if (!p) throw new Error(`未知图案：${key}`)
  return p
}

/**
 * 把图案放到棋盘上，左上角落在 (ox, oy)。
 * 越界的格子直接丢弃（环形边界下也不绕回 —— 放置是编辑操作，不该受演化边界影响）。
 * @returns {number} 实际写入的格子数
 */
export function placePattern(engine, pattern, ox, oy) {
  let placed = 0
  for (const [dx, dy] of pattern.cells) {
    const x = ox + dx, y = oy + dy
    if (x < 0 || y < 0 || x >= engine.w || y >= engine.h) continue
    engine.set(x, y, 1)
    placed++
  }
  return placed
}

/** 让图案在 (cx, cy) 居中时的左上角坐标 */
export function centerOrigin(pattern, cx, cy) {
  return { x: cx - (pattern.w >> 1), y: cy - (pattern.h >> 1) }
}
