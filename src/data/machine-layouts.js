// 元像素零件·第二批：六局机关（D102 ③）。
// 首位用户与 Matt 在拆 OTCA metapixel 的机制，这六局把第一批那些零件拼起来，
// 演示其中几条：互相抵消、撞出新东西、火线、开门 / 关门、拐弯的信号。
//
// **每一局的摆位都是引擎搜出来的**，判据写在各自的搜索里（湮灭要全空、造物要定型成静物、
// 火线要两台枪都还在开火、开关门要看下游有没有东西过去、拐弯要反射器完好且出射线上有东西）。
// 生平一律在**默认盘（200 环形）**上实测 —— 那正是用户点开这一局时所在的盘。

/** fav.mp.annihilate */
const ANNIHILATE = `x = 31, y = 28, rule = B3/S23
bo$2bo$3o23$28b3o$28bo$29bo!`

/** fav.mp.create */
const CREATE = `x = 22, y = 22, rule = B3/S23
bo$2bo$3o17$19b3o$19bo$20bo!`

/** fav.mp.crossfire */
const CROSSFIRE = `x = 72, y = 45, rule = B3/S23
24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4b
obo$10bo5bo7bo$11bo3bo$12b2o28$58b2o$56bo3bo$47bo7bo5bo$47bobo4b2obo3b
o8b2o$50b2o3bo5bo8b2o$36b2o12b2o4bo3bo$36b2o12b2o6b2o$47bobo$47bo!`

/** fav.mp.doorShut */
const DOOR_SHUT = `x = 51, y = 37, rule = B3/S23
24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4b
obo$10bo5bo7bo$11bo3bo$12b2o25$47b2o$47bobo$49bo$49b2o!`

/** fav.mp.doorOpen */
const DOOR_OPEN = `x = 52, y = 37, rule = B3/S23
24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4b
obo$10bo5bo7bo$11bo3bo$12b2o25$48b2o$48bobo$50bo$50b2o!`

/** fav.mp.turn */
const TURN = `x = 82, y = 56, rule = B3/S23
30b2o$29bobo15b2o$29bo17b2o$17bo11b3o$2o15b2o$2o16b2o$13b2o2b2o$29b3o$
29bo17b2o$29bobo15b2o$13b2o2b2o11b2o$2o16b2o$2o15b2o$17bo26$72bo$70b3o
$69bo$69b2o3$77b2ob2o$78bob2o$78bo$70b2o4b3o$70b2o3bo3b2o$75b4o2bo$61b
2o15bob2o$60bobo12b3o2bo$60bo13bo5bo$59b2o14b5o$77bo!`

/** 六局机关。都摆得进默认的 200 盘，所以不声明 board */
export const MACHINE_LAYOUTS = Object.freeze([
  {
    id: 'builtin:mp-annihilate', nameKey: 'fav.mp.annihilate', rle: ANNIHILATE, full: true,
    // 实测（默认盘 200 环形）：10 格起步，第 53 代峰值 14 格，**第 60 代全空**。
    // 两架正对头撞上，谁也没留下 —— 元像素里「互相抵消」就是这么一回事。
    life: { end: 'extinction', board: 200, boundary: 'torus', start: 10, gen: 60, peak: 14, peakGen: 53, final: 0 }
  },
  {
    id: 'builtin:mp-create', nameKey: 'fav.mp.create', rle: CREATE, full: true,
    // 实测：10 格起步，**第 39 代定型为一块 4 格方块**。
    // 死边界 60 盘与 200 环形盘上量出来一模一样 —— 这是撞出来的，不是墙造的。
    life: { end: 'still', board: 200, boundary: 'torus', start: 10, gen: 39, peak: 10, peakGen: 0, final: 4 }
  },
  {
    id: 'builtin:mp-crossfire', nameKey: 'fav.mp.crossfire', rle: CROSSFIRE, full: true,
    // 实测（默认盘）：72 格起步，第 68 代峰值 142，**第 45 代起严格周期 30，人口 94**。
    // 两台枪对射，两条流在中间互相打掉 —— 一条稳定的火线。
    life: { end: 'cycle', board: 200, boundary: 'torus', start: 72, gen: 75, period: 30, peak: 142, peakGen: 68, final: 94 }
  },
  {
    id: 'builtin:mp-door-shut', nameKey: 'fav.mp.doorShut', rle: DOOR_SHUT, full: true,
    // 实测（默认盘）：43 格起步，第 98 代峰值 83，**周期 30、人口 64**。
    // 吞食者正对着弹道：每一架都被吃掉，下游一格不剩。
    life: { end: 'cycle', board: 200, boundary: 'torus', start: 43, gen: 117, period: 30, peak: 83, peakGen: 98, final: 64 }
  },
  {
    id: 'builtin:mp-door-open', nameKey: 'fav.mp.doorOpen', rle: DOOR_OPEN, full: true,
    // **与上一局只差一格**：吞食者右移一格，那条流就全部通过。
    // 实测（默认盘）：滑翔机一架不落地飞出去，绕回来越积越多，第 2351 代峰值 437，跑满 3000 代未定型。
    // 后半段的数字是盘子给的（环形盘上飞出去的会绕回来），这一局要看的是**前一百代：过，还是不过**。
    life: { end: 'capped', board: 200, boundary: 'torus', start: 43, gen: 3000, peak: 437, peakGen: 2351, final: 223 }
  },
  {
    id: 'builtin:mp-turn', nameKey: 'fav.mp.turn', rle: TURN, full: true,
    // 周期 46 的枪（Bill Gosper 的 p46 gun）对着 Snark 反射器。
    // **为什么非得用 p46 而不是常见的那台 p30**：实测 Snark 的恢复时间是 43 代，
    // 而 Gosper 枪每 30 代吐一架 —— 第二架会撞在还没恢复的它身上。46 ≥ 43，才喂得动。
    // 实测（240 死边界跑 700 代）：直行方向一架不剩、拐弯方向 35 格在飞、**反射器逐格完好**。
    life: { end: 'capped', board: 200, boundary: 'torus', start: 102, gen: 3000, peak: 647, peakGen: 1878, final: 436 }
  },
])
