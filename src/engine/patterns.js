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
.O.`,

  // 「吞食者」（Eater 1）—— 社区经典，第二个用户注册图案，也是第一个**互动型**图案（D64）。
  // 原始 RLE（本朝向）：x = 4, y = 4, rule = B3/S23 / 2o$obo$2bo$2b2o!
  //
  // 它的本职不是自己怎么变，而是**别的东西撞上来会怎样**：
  // 独放是 7 格静物，一动不动；而滑翔机撞进那个凹口会被吃掉，它自己一格不少。
  //
  // **朝向选的是 SE**，因为玩具盒里那架滑翔机实测朝 SE 飞（40 代质心位移 +10,+10）——
  // 两个都从盒里拖出来就能直接配上，不必先旋转（D81 的"开箱即配对"原则）。
  // 其余三个朝向按 R 键旋转即可，四朝向的实测表见 docs/patterns.md。
  eater: `
OO..
O.O.
..O.
..OO`,

  /* ---------------- 元像素零件·第一批（D96） ----------------
     背景：首位用户和 Matt 在研究 OTCA metapixel 的内部机制，先把它依赖的经典零件集齐。
     六个都从 LifeWiki 的镜像集合取（署名见 docs/patterns.md），再用自家引擎实跑鉴定。

     **为什么排在最后而不是插到 lwss 旁边**：飞船族确实该挨着，但插进去会把
     matt、吞食者这些已有卡片往后推 —— 取用区的位置恒定是按着手指的记忆定的（D75 ③）。
     顺序仍然在表达来源：经典 5 个 → 用户注册 2 个 → 元像素零件 6 个。 */

  // 中量级飞船（MWSS）。原始 RLE：x = 6, y = 5, rule = B3/S23 / 3bo2b$bo3bo$o5b$o4bo$5o!
  // 实测：40 代质心位移 (-20, 0) —— 每 4 代往西走 2 格（c/2），与盒里的轻量飞船同向，
  // 两个一起拖出来就是同一条航线上的一队（D81 开箱即配）。
  mwss: `
...O..
.O...O
O.....
O....O
OOOOO.`,

  // 重量级飞船（HWSS）。原始 RLE：x = 7, y = 5, rule = B3/S23 / 3b2o2b$bo4bo$o6b$o5bo$6o!
  // 实测：40 代质心位移 (-20, 0)，同样是 c/2 往西。飞船族到此齐了：轻/中/重三条。
  hwss: `
...OO..
.O....O
O......
O.....O
OOOOOO.`,

  // Snark 反射器（Mike Playle, 2013）—— 已知最小最快的 90° 稳定滑翔机反射器。
  // 原始 RLE 含一架演示用的滑翔机，**入册的是减掉那架之后的反射器本体（52 格）**：
  // x = 17, y = 23, rule = B3/S23
  // 6b2o3b2o$6b2o2bob3o$10bo4bo$6b4ob2o2bo$6bo2bobobob2o$9bobobobo$10b2obo
  // bo$14bo2$2o$bo7b2o$bobo5b2o$2b2o7$12b2o$3b2o7bo$2bobo8b3o$4bo10bo!
  //
  // **朝向是搜出来的，不是转着看着顺眼**（D98）：八个朝向逐个量，挑那个
  // "对应滑翔机 = 盒里那架原样不动"的。**光看方向会挑错** —— 同一个方向上有两种手性的
  // 滑翔机，反射器只接其中一种；第一版按方向挑了朝向，用户拖出默认那架照样撞爆它。
  // 实测（互动型入册，D64）：入射 SE、出射 NE（拐 90°），第 29 代反射器逐格复原，
  // 对应滑翔机就是盒里默认那架（rot=0, flip=false）。
  snark: `
...............O.
.............OOO.
............O....
............OO...
.................
.................
.................
.................
.................
.................
..OO.............
.O.O.....OO......
.O.......OO......
OO...............
.................
..............O..
..........OO.O.O.
.........O.O.O.O.
......O..O.O.O.OO
......OOOO.OO..O.
..........O....O.
......OO..O.OOO..
......OO...OO....`,

  // 蜂后穿梭机（Bill Gosper）。原始 RLE：x = 22, y = 7, rule = b3/s23
  // 9bo12b$7bobo12b$6bobo13b$2o3bo2bo11b2o$2o4bobo11b2o$7bobo12b$9bo!
  // 两端那两块方块是稳定器，不是装饰：没有它们，蜂后爬到头会炸成一团。
  // 实测：周期 30，逐格回到起始盘面。滑翔机枪就是拿两台这个拼出来的 —— 所以它在零件表里。
  qbshuttle: `
.........O............
.......O.O............
......O.O.............
OO...O..O...........OO
OO....O.O...........OO
.......O.O............
.........O............`,

  // 方块（Block）。原始 RLE：x = 2, y = 2, rule = B3/S23 / 2o$2o!
  // 4 格静物，实测 200 代逐格不变 —— 在观塔里就是一根笔直的柱子。
  // 元像素里到处是它：当稳定器、当反射墙、当"记住一位"的存储。
  block: `
OO
OO`,

  // 闪灯（Blinker）。原始 RLE：x = 3, y = 1, rule = B3/S23 / 3o!
  // **三格横排，实测周期 2** —— 全宇宙最小的振荡子。
  //
  // 它是**第二幕那三条规矩里的两条**，两代之内演完（实测，不是抄来的）：
  //   · 两端那两格各只有 **1** 个邻居 → 下一代死（规则一：朋友太少会孤单死掉）；
  //   · 上下那两个空位各**刚好 3** 个邻居 → 下一代生（规则三：刚好三个会诞生）。
  // 它之所以是最小的振荡子，正因为同时踩中这两条并闭合。
  //
  // 引导第一幕的舞台上本来就有它（那台戏里"一开一合的"就是它）——
  // 从前舞台是手写坐标，库里却没有这个图案：**演示了一样东西，然后拿不出来**（§12 第六面）。
  blinker: `
OOO`,

  // 蟾蜍（Toad）。原始 RLE：x = 4, y = 2, rule = B3/S23 / b3o$3o!
  // 6 格，实测周期 2。收它不是为了凑数，是为了让"会呼吸的"读起来是**一类**而不是一个孤例 ——
  // 只有闪灯一个的话，用户会以为那是个特例。
  toad: `
.OOO
OOO.`,

  // 蜂巢（Beehive）。原始 RLE：x = 4, y = 3, rule = B3/S23 / b2ob$o2bo$b2o!
  // 6 格静物，实测 200 代逐格不变。与方块并列是因为它是第二常见的静物 ——
  // 随机盘跑完之后剩下的那些残骸，多半就是这两样。
  beehive: `
.OO.
O..O
.OO.`
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
 * 分组（D97 ③）。**登记表只此一份**：竖条的小标题、卡片的排序、守卫的核对，
 * 三处读的都是它 —— 分组信息一旦有第二份，迟早会出现"标题说是飞船、卡片排在静物里"。
 *
 * 名字按"它是干什么的"分，不按"它长什么样"：
 *   · `ship` 会走的 —— 滑翔机与轻/中/重三条飞船（滑翔机也是飞船，只是走斜线）；
 *   · `machine` 会干活的 —— 枪、穿梭机、反射器、吞食者。**吞食者归这里而不是静物**：
 *     它确实是静物，但反射器也是；把这两个按"长相"拆开，等于把同一件事说成两件。
 *     D64 早就给它们起过名字叫"互动型"，这一组就是那个意思。
 *   · `still` 不动的 —— 方块、蜂巢，它们的本事就是"待着"；
 *   · `oscillator` 会呼吸的 —— 闪灯、蟾蜍、脉冲星：**周期性地重复自己**，可预测。
 *     **这一组是 D130 补的，脉冲星从 restless 移过来**：那一组原先同时装着
 *     周期 3 的脉冲星与乱上千代的 R-五连体 —— 从 3 格到 48 格、从周期 2 到混沌，
 *     组内不一致就等于没分组。两者对用户是**两种不同的承诺**：
 *     一个是"你可以看它呼吸"，一个是"你可以看它失控"。
 *   · `restless` 自己变个不停、**而且说不准会变成什么** —— R-五连体（乱上一千代）。
 *   · `original` 用户原创 —— Matt（D64 那一条界线，它自己就该单独站着）。
 *
 * 顺序也是判据：由简到繁、由静到乱 —— 第一次进来的人从左上角读起。
 */
export const PATTERN_GROUPS = Object.freeze(['ship', 'machine', 'still', 'oscillator', 'restless', 'original'])

const GROUP_OF = Object.freeze({
  glider: 'ship', lwss: 'ship', mwss: 'ship', hwss: 'ship',
  gun: 'machine', qbshuttle: 'machine', snark: 'machine', eater: 'machine',
  block: 'still', beehive: 'still',
  blinker: 'oscillator', toad: 'oscillator', pulsar: 'oscillator',
  rpentomino: 'restless',
  matt: 'original'
})

/**
 * 图案清单。名称与说明不在这里 —— 走 i18n 词典的 pattern.<key> / pattern.<key>.desc。
 * @type {Array<{key:string, group:string, w:number, h:number, cells:number[][]}>}
 */
export const PATTERNS = Object.keys(SOURCES).map(key => ({ key, group: GROUP_OF[key], ...parseAscii(SOURCES[key]) }))

/**
 * 按分组排好的清单：竖条照它分段显示，窄屏横滑带照它排序（只是不显示小标题）。
 * **两处同一个顺序**，免得同一个盒子在两个屏上是两种排法。
 *
 * **组内按活格数由少到多**（D130）：分组的顺序判据是"由简到繁"，
 * 组内不排就等于只做了一半 —— 会呼吸的那一组里，用户先看到的该是 3 格的闪灯，
 * 不是 48 格的脉冲星。排序键取活格数而不是手写顺序：
 * 加新图案时不必回来插队，也就不会插错。
 */
export function groupedPatterns() {
  return PATTERN_GROUPS.map(group => ({
    group,
    items: PATTERNS.filter(p => p.group === group).sort((a, b) => a.cells.length - b.cells.length)
  }))
}

export function getPattern(key) {
  const p = PATTERNS.find(x => x.key === key)
  if (!p) throw new Error(`未知图案：${key}`)
  return p
}

/**
 * 图案的朝向变换（D81）。纯数据，不碰引擎也不碰 DOM，可直接测。
 *
 * 8 种朝向构成一个群（正方形的对称群）：4 个旋转 × 是否镜像。
 * 用 {rot, flip} 两个量表示，而不是存 8 份坐标 —— 存 8 份就有 8 处要同步。
 *
 * 顺序固定为**先镜像后旋转**。顺序反了得到的是另一半陪集，
 * 于是"按 F 再按 R 两次"和"按 R 两次再按 F"会给出不同结果，用户按不出规律。
 *
 * @param {{key:string,w:number,h:number,cells:number[][]}} p
 * @param {{rot?:number, flip?:boolean}} o rot 为 90° 的个数（取模 4），flip 为水平镜像
 */
export function transformPattern(p, o = {}) {
  const rot = ((o.rot | 0) % 4 + 4) % 4
  const flip = !!o.flip
  let cells = p.cells.map(([x, y]) => [x, y])
  if (flip) cells = cells.map(([x, y]) => [-x, y])
  for (let i = 0; i < rot; i++) cells = cells.map(([x, y]) => [-y, x])
  // 归一到左上角 (0,0)，让 w/h 与 cells 始终自洽
  const minX = Math.min(...cells.map(c => c[0]))
  const minY = Math.min(...cells.map(c => c[1]))
  cells = cells.map(([x, y]) => [x - minX, y - minY])
  return {
    key: p.key,
    label: p.label,
    w: Math.max(...cells.map(c => c[0])) + 1,
    h: Math.max(...cells.map(c => c[1])) + 1,
    cells
  }
}

/** 朝向的规范形式，用来比对两个 {rot,flip} 是不是同一个朝向 */
export function normalizeOrientation(o = {}) {
  return { rot: ((o.rot | 0) % 4 + 4) % 4, flip: !!o.flip }
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

/**
 * 这个图案摆在 (ox, oy) 时，**活格是不是全都落在盘内**（D113）。
 *
 * 判据看的是**活格**不是外接框：图案四角常常是空的，
 * 按外接框判会把"其实放得下"的位置误判成放不下。
 *
 * 有了它，界外放置就能**挡在发生之前**（按钮变灰 + 幽灵变色），
 * 而不是让用户按下去、失败、再解释。`placePattern` 那边照旧裁剪 ——
 * 它是最后一道，不是第一道。
 */
export function fitsInBoard(pattern, ox, oy, boardW, boardH) {
  for (const [dx, dy] of pattern.cells) {
    const x = ox + dx, y = oy + dy
    if (x < 0 || y < 0 || x >= boardW || y >= boardH) return false
  }
  return true
}

/** 让图案在 (cx, cy) 居中时的左上角坐标 */
export function centerOrigin(pattern, cx, cy) {
  return { x: cx - (pattern.w >> 1), y: cy - (pattern.h >> 1) }
}
