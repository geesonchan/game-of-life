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
.O.`,

  // 「Matt」—— 首位用户的原创图案，第一个用户注册图案（见 docs/decisions.md D64）。
  // 原始 RLE：x = 10, y = 9, rule = B3/S23 / 3$6bo$4b3o2$5bo!
  //
  // 第 4 行那个格子是孤立的 —— 八个邻居全空，它自己第 1 代就死。
  // 但它不是可有可无的装饰：它压着的 (1,2) 那个空位本来正好有 3 个活邻居、
  // 该在第 1 代出生，多了它就变成 4 个，出生被挡掉了。
  // 实测：去掉这一格，整个图案第 4 代就安静成 6 格静物；留着它，能跑 1106 代。
  matt: `
..O
OOO
...
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
