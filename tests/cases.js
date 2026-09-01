// 阶段 1 验收标准的自动化测试用例（单一事实来源）
// 同时被 Vitest（tests/engine.test.js）与 jsc 运行器（tests/run-jsc.js）复用。

import { LifeEngine } from '../src/engine/board.js'
import { lifeRule, compileRule, parseBS, bsToClauses, compileNotation } from '../src/engine/rules.js'
import { normalizeSeed } from '../src/engine/prng.js'
import { validateRule, validateClauses } from '../src/engine/validate.js'
import { presetRule, PRESETS } from '../src/engine/presets.js'
import { exportRule, importRule } from '../src/engine/rule-io.js'
import { PATTERNS, PATTERN_GROUPS, groupedPatterns, getPattern, centerOrigin, placePattern, transformPattern } from '../src/engine/patterns.js'
import { parseRLE, toRLE, boardToRLE } from '../src/engine/rle.js'
import { buildSave, parseSave, restoreInitial, saveToText, boardBaseline, SAVE_VERSION } from '../src/engine/save.js'
import { DICT } from '../src/i18n/dict.js'
import { createPrefs, PREF_KEYS, BOOKMARK_KEYS } from '../src/ui/prefs.js'
import { BIG_LAYOUTS } from '../src/data/big-layouts.js'
import { MACHINE_LAYOUTS } from '../src/data/machine-layouts.js'
import { METAPIXEL_LAYOUT } from '../src/data/metapixel-layout.js'
import { shouldCount } from '../src/analytics.js'
import { BOARD_SIZES, BIG_FROM, isBigBoard, costOf, visualFor, neededBoard } from '../src/data/board-sizes.js'
import { BUILTIN_LAYOUTS, validateLayout, ruleOf, exportFavorites, importFavorites, addLayout, byteLength, fitsBudget, liveBounds, mergeFavorites, normalizeRule, normalizeLife, layoutRow, layoutRows, foldRows, lifeText, showEntryPlan, MAX_BYTES, MAX_NOTE, RECENT_SHOWN } from '../src/data/favorites.js'
import { createLifeProbe, probeLife, PROBE_SPEC } from '../src/data/life-probe.js'
import { SnapshotLog } from '../src/data/snapshots.js'
import { TerminationDetector } from '../src/data/detector.js'
import { Chronicle } from '../src/data/chronicle.js'
import { Ledger } from '../src/data/ledger.js'
import { toCSV, SNAPSHOT_COLUMNS, LEDGER_COLUMNS } from '../src/data/csv.js'
import { VisualState } from '../src/render/visual-state.js'
import { buildAgeIndexLUT, AGE_MAX } from '../src/render/palette.js'
import { RingSeries } from '../src/data/series.js'
import { shouldShowProgress, placeSelectionMenu } from '../src/ui/io.js'
import { introPages, introNext, appendixPages, placeStarterGift } from '../src/ui/intro.js'
import { pinchDelta, strokeVerdict, PROMOTE_MS, nudgeCell, tapAction, insideGhostBox, setupCanvasInput } from '../src/ui/input.js'
import { clampToRange, NUMERIC_SLIDERS, CODEC_SLIDERS } from '../src/ui/numeric-entry.js'
import { Viewport, fitScaleOf, zoomFromSlider, sliderFromZoom, ZOOM_STEPS } from '../src/render/viewport.js'
import { zoomLabel, parseZoomInput, DIM_AFTER_MS, ZOOM_BUTTON_STEP } from '../src/ui/zoom-bar.js'
import { isPageZoomed, PAGE_ZOOM_THRESHOLD } from '../src/ui/page-zoom.js'
import { CRITICAL_SPEC, CRITICAL_CLASSIFY, EMERGENCE_MIN_GENS, REFINE_WIDTH, densityAxis,
  observeDensity, isEmergent, isLongTransient, findCrossings, planRefinements,
  emergenceWindows, round3, CURVE_METRICS, plainLife, crossingMarks } from '../src/data/critical.js'
import { createTwin, measure, diffCells, TWIN, TWIN_EXAMPLES } from '../src/data/twin.js'
import { LOCKIN_SPEC, findLockIn, baselineStates, canFlipAt, candidateCells, runToEnd } from '../src/data/lockin.js'
import { orientToastKey, orientLabel, shouldShowStampTip } from '../src/ui/stamp-hint.js'
import { MOTION_KINDS, motionOf, motionNow, motionCached, motionKey, rotateVector, rayAnchor, landingDots, entryEnds, exitEnds,
  rayEnds, RAY_FALLBACK, distanceToEdge, centroid, refFromPlacement } from '../src/engine/motion.js'
import { Tower, buildTower, packTower, unpackTower, TOWER_DEFAULT_HEIGHT, TOWER_MAX_HEIGHT } from '../src/data/tower.js'
import { classifyRun, probeRule, exploreRule, majorityOutcome, sortResults, sampleBSRules,
  ruleFromNotation, relativeVariation, OUTCOMES, DEFAULTS } from '../src/data/explorer.js'

/** 把 ASCII 图案（O=活，.=死）画到棋盘上，左上角落在 (ox,oy) */
export function place(engine, pattern, ox, oy) {
  const rows = pattern.trim().split('\n').map(r => r.trim())
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      engine.set(ox + x, oy + y, rows[y][x] === 'O' ? 1 : 0)
    }
  }
}

/** 取出所有活细胞坐标，按 y,x 排序 */
export function liveCells(engine) {
  const out = []
  for (let y = 0; y < engine.h; y++) {
    for (let x = 0; x < engine.w; x++) {
      if (engine.get(x, y) === 1) out.push([x, y])
    }
  }
  return out
}

/** 把活细胞坐标归一化到以包围盒左上角为原点，得到"形状签名" */
export function shapeSignature(cells) {
  if (cells.length === 0) return ''
  const minX = Math.min(...cells.map(c => c[0]))
  const minY = Math.min(...cells.map(c => c[1]))
  return cells.map(c => `${c[0] - minX},${c[1] - minY}`).sort().join(';')
}

const BLINKER = `
OOO
`
const GLIDER = `
.O.
..O
OOO
`

function eqArrays(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** 全部用例：{ name, run(assert) }，assert 抛错即失败 */
export const cases = [
  {
    name: 'Blinker 周期为 2',
    run(t) {
      const e = new LifeEngine(11, 11, { rule: lifeRule(), boundary: 'dead' })
      place(e, BLINKER, 4, 5)
      const gen0 = e.snapshot()
      e.step()
      const gen1 = e.snapshot()
      t.ok(!eqArrays(gen0, gen1), '第 1 代应与第 0 代不同（否则是静物，不是周期 2）')
      t.equal(shapeSignature(liveCells(e)), '0,0;0,1;0,2', '第 1 代应变成竖条')
      e.step()
      t.ok(eqArrays(e.snapshot(), gen0), '第 2 代应与第 0 代逐格相同 ⇒ 周期为 2')
    }
  },
  {
    name: 'Glider 4 代后整体平移 (1,1)',
    run(t) {
      const e = new LifeEngine(30, 30, { rule: lifeRule(), boundary: 'dead' })
      place(e, GLIDER, 5, 5)
      const before = liveCells(e)
      for (let i = 0; i < 4; i++) e.step()
      const after = liveCells(e)
      t.equal(after.length, before.length, '细胞数应保持 5')
      const expected = before.map(c => `${c[0] + 1},${c[1] + 1}`).sort().join(';')
      const actual = after.map(c => `${c[0]},${c[1]}`).sort().join(';')
      t.equal(actual, expected, '4 代后每个细胞坐标应恰好 +1,+1')
    }
  },
  {
    name: '环形边界：滑翔机穿过边缘后从对侧出现，形状不变',
    run(t) {
      const N = 20
      const e = new LifeEngine(N, N, { rule: lifeRule(), boundary: 'torus' })
      // 贴着右下角放，保证很快就会跨越边界
      place(e, GLIDER, N - 3, N - 3)
      const sig0 = shapeSignature(liveCells(e))
      const board0 = e.snapshot()

      // 跨越边界的过程中，形状签名必须始终是滑翔机的 4 个相位之一
      const phases = new Set()
      let straddled = false
      for (let i = 0; i < 4 * N; i++) {
        e.step()
        const cells = liveCells(e)
        t.equal(cells.length, 5, `第 ${e.generation} 代仍应是 5 个活细胞`)
        // 判断是否跨越了边界：活细胞同时出现在棋盘两端
        const xs = cells.map(c => c[0]), ys = cells.map(c => c[1])
        if (Math.max(...xs) - Math.min(...xs) > 3 || Math.max(...ys) - Math.min(...ys) > 3) straddled = true
        phases.add(shapeSignature(cells))
      }
      t.ok(straddled, '过程中滑翔机应确实跨越过边界（活细胞分布在棋盘两端）')
      // 每 4 代平移 (1,1)，跑 4N 代刚好回到原点
      t.ok(eqArrays(e.snapshot(), board0), `${4 * N} 代后应逐格回到初始棋盘`)
      t.equal(shapeSignature(liveCells(e)), sig0, '形状签名应与初始一致')
    }
  },
  {
    name: '同一种子 + 同一密度，两次初始化棋盘逐格相同',
    run(t) {
      const a = new LifeEngine(120, 90).randomize(4271, 0.35)
      const b = new LifeEngine(120, 90).randomize(4271, 0.35)
      t.ok(eqArrays(a.snapshot(), b.snapshot()), '同种子两次初始化应逐格相同')
      t.equal(a.hash(), b.hash(), '棋盘哈希应相同')
      const c = new LifeEngine(120, 90).randomize(4272, 0.35)
      t.ok(!eqArrays(a.snapshot(), c.snapshot()), '不同种子应产生不同棋盘')
      // 演化 200 代后仍然逐格一致（引擎确定性）
      a.run(200); b.run(200)
      t.equal(a.hash(), b.hash(), '演化 200 代后哈希仍应相同')
    }
  },
  {
    name: '500×500 随机盘（密度 0.3）单代计算 < 16ms',
    run(t) {
      const e = new LifeEngine(500, 500, { boundary: 'torus' }).randomize(20260828, 0.3)
      for (let i = 0; i < 5; i++) e.step() // 预热 JIT
      const samples = []
      for (let i = 0; i < 20; i++) {
        const t0 = now()
        e.step()
        samples.push(now() - t0)
      }
      samples.sort((x, y) => x - y)
      const median = samples[Math.floor(samples.length / 2)]
      t.info(`中位耗时 ${median.toFixed(2)}ms，最快 ${samples[0].toFixed(2)}ms，最慢 ${samples[samples.length - 1].toFixed(2)}ms`)
      t.ok(median < 16, `单代中位耗时应 < 16ms，实测 ${median.toFixed(2)}ms`)
    }
  },
  {
    name: '规则编译：B3/S23 查找表正确，指纹稳定',
    run(t) {
      const r = lifeRule()
      t.equal(r.clauses.length, 3, '标准生命游戏应为 3 条条款')
      t.equal(r.notation, 'B3/S23', '应能反解出 B/S 记法')
      for (let n = 0; n <= 8; n++) {
        t.equal(r.lookup[0 * 9 + n], n === 3 ? 1 : 0, `死细胞 ${n} 邻居`)
        t.equal(r.lookup[1 * 9 + n], (n === 2 || n === 3) ? 1 : 0, `活细胞 ${n} 邻居`)
      }
      const r2 = compileRule({ clauses: parseBS('B3/S23') })
      t.equal(r.fingerprint, r2.fingerprint, '同规则指纹应一致')
      const r3 = compileRule({ clauses: parseBS('B36/S23') })
      t.ok(r.fingerprint !== r3.fingerprint, '不同规则指纹应不同')
    }
  },
  {
    name: '死边界：边缘外一律按死细胞计算',
    run(t) {
      const e = new LifeEngine(6, 6, { boundary: 'dead' })
      // 左上角 2x2 方块（静物），死边界下应保持不变
      place(e, `
        OO
        OO
      `, 0, 0)
      const b0 = e.snapshot()
      e.run(5)
      t.ok(eqArrays(e.snapshot(), b0), '贴边方块在死边界下应保持静止')
      // 跨越左右边界的横向闪灯：环形边界下是振荡子，死边界下会解体
      const straddling = [[5, 2], [0, 2], [1, 2]]
      const e2 = new LifeEngine(6, 6, { boundary: 'torus' })
      for (const [x, y] of straddling) e2.set(x, y, 1)
      const s2 = e2.step()
      t.equal(s2.alive, 3, '环形边界下跨边界闪灯应继续振荡（仍是 3 个活细胞）')

      const e3 = new LifeEngine(6, 6, { boundary: 'dead' })
      for (const [x, y] of straddling) e3.set(x, y, 1)
      const s3 = e3.step()
      t.equal(s3.alive, 0, '死边界下这三个细胞互不相邻/成不了型，应全部死亡')
    }
  },
  {
    name: '统计钩子：出生 / 孤独死 / 拥挤死 计数正确',
    run(t) {
      const e = new LifeEngine(11, 11, { boundary: 'dead' })
      place(e, BLINKER, 4, 5)
      const s = e.step()
      t.equal(s.alive, 3, '闪灯下一代仍有 3 个活细胞')
      t.equal(s.births, 2, '上下各出生 1 个')
      t.equal(s.deathsLonely, 2, '两端细胞各只有 1 个邻居 ⇒ 孤独死')
      t.equal(s.deathsCrowded, 0, '不应有拥挤死')

      // 3x3 实心方块：中心 8 邻居 → 拥挤死
      const e2 = new LifeEngine(11, 11, { boundary: 'dead' })
      place(e2, `
        OOO
        OOO
        OOO
      `, 4, 4)
      const s2 = e2.step()
      t.equal(s2.deathsCrowded, 5, '中心 1 个 + 四边中点 4 个，共 5 个拥挤死')
    }
  }
]

/* ================= 阶段 3：条款规则编辑器 ================= */

cases.push(
  {
    name: '手工搭出的 B3/S23 与预设 Life 指纹完全一致',
    run(t) {
      const life = presetRule('life')
      t.equal(life.notation, 'B3/S23', '预设 Life 的记法')

      // 写法一：换成 eq / range，条款数相同
      const a = compileRule({
        agingLayers: 0,
        clauses: [
          { when: 'dead', neighbors: { op: 'eq', value: 3 }, then: 'alive' },
          { when: 'alive', neighbors: { op: 'range', min: 2, max: 3 }, then: 'alive' },
          { when: 'alive', neighbors: { op: 'any' }, then: 'dead' }
        ]
      })
      t.equal(a.fingerprint, life.fingerprint, 'eq/range 写法应与预设同指纹')

      // 写法二：只写 2 条，靠隐含兜底"维持原状"补齐存活
      const b = compileRule({
        agingLayers: 0,
        clauses: [
          { when: 'dead', neighbors: { op: 'in', values: [3] }, then: 'alive' },
          { when: 'alive', neighbors: { op: 'not_in', values: [2, 3] }, then: 'dead' }
        ]
      })
      t.equal(b.fingerprint, life.fingerprint, '靠兜底补齐的 2 条写法也应同指纹')
      t.equal(b.notation, 'B3/S23', '反解记法仍应是 B3/S23')

      // 反例：真的不是 Life 的规则，指纹必须不同
      const c = compileRule({ agingLayers: 0, clauses: parseBS('B36/S23') })
      t.ok(c.fingerprint !== life.fingerprint, 'HighLife 指纹应与 Life 不同')
    }
  },
  {
    name: 'Seeds 预设：任意活细胞下一代必死',
    run(t) {
      const seeds = presetRule('seeds')
      t.equal(seeds.notation, 'B2/S', 'Seeds 记法应为 B2/S')
      const e = new LifeEngine(60, 60, { rule: seeds, boundary: 'torus' }).randomize(999, 0.3)
      const before = e.snapshot()
      e.step()
      let survivors = 0
      for (let i = 0; i < before.length; i++) if (before[i] === 1 && e.cur[i] === 1) survivors++
      t.equal(survivors, 0, '上一代的活细胞不应有任何一个存活到下一代')
      // 逐个邻居数直接查表确认，不留死角
      for (let n = 0; n <= 8; n++) {
        t.equal(seeds.lookup[1 * 9 + n], 0, `活细胞在 ${n} 个邻居下都必须死`)
      }
    }
  },
  {
    name: '校验器能标出永不可达的条款（被遮蔽 / 状态不可达）',
    run(t) {
      // (a) 被遮蔽：第 2 条能匹配的 n=3 已被第 1 条抢走
      const shadowed = compileRule({
        agingLayers: 0,
        clauses: [
          { when: 'alive', neighbors: { op: 'in', values: [2, 3] }, then: 'alive' },
          { when: 'alive', neighbors: { op: 'in', values: [3] }, then: 'dead' },
          { when: 'alive', neighbors: { op: 'any' }, then: 'dead' },
          { when: 'dead', neighbors: { op: 'in', values: [3] }, then: 'alive' }
        ]
      })
      const rs = validateRule(shadowed)
      t.equal(rs.clauses[1].status, 'shadowed', '第 2 条应被标为被遮蔽')
      t.equal(rs.clauses[1].hits, 0, '被遮蔽的条款命中数应为 0')
      t.equal(rs.clauses[0].status, 'ok', '第 1 条应正常')
      t.equal(rs.clauses[3].status, 'ok', '第 4 条应正常')
      // 被遮蔽不改变语义：删掉它指纹不变
      const without = compileRule({
        agingLayers: 0,
        clauses: shadowed.clauses.filter((_, i) => i !== 1)
      })
      t.equal(without.fingerprint, shadowed.fingerprint, '删掉永不可达条款不应改变指纹')

      // (b) 状态不可达：没有任何条款产生 aging_2
      const unreachable = compileRule({
        agingLayers: 2,
        clauses: [
          { when: 'dead', neighbors: { op: 'in', values: [3] }, then: 'alive' },
          { when: 'alive', neighbors: { op: 'in', values: [2, 3] }, then: 'alive' },
          { when: 'alive', neighbors: { op: 'any' }, then: 'aging_1' },
          { when: 'aging_1', neighbors: { op: 'any' }, then: 'dead' },
          { when: 'aging_2', neighbors: { op: 'any' }, then: 'dead' }
        ]
      })
      const ru = validateRule(unreachable)
      t.equal(ru.clauses[4].status, 'unreachable-state', '第 5 条应被标为状态不可达')
      t.equal(ru.clauses[3].status, 'ok', '第 4 条（aging_1 可达）应正常')
      t.ok(ru.clauses[4].hits > 0, '状态不可达的条款在表里仍会"命中"，所以必须先判可达性再看命中数')

      // (c) 冗余：结果与维持原状一致
      const redundant = compileRule({
        agingLayers: 0,
        clauses: [
          { when: 'dead', neighbors: { op: 'in', values: [0, 1] }, then: 'dead' },
          { when: 'dead', neighbors: { op: 'in', values: [3] }, then: 'alive' },
          { when: 'alive', neighbors: { op: 'in', values: [2, 3] }, then: 'alive' },
          { when: 'alive', neighbors: { op: 'any' }, then: 'dead' }
        ]
      })
      const rr = validateRule(redundant)
      t.equal(rr.clauses[0].status, 'redundant', '结果等于维持原状的条款应标为冗余')
      t.equal(redundant.fingerprint, presetRule('life').fingerprint, '冗余条款不改变指纹')
    }
  },
  {
    name: 'B/S 表达力判定走可达闭包，而不是衰老层数',
    run(t) {
      // 层数调到 3，但没有任何条款指向衰老态 ⇒ 仍然可用 B/S 表达
      const padded = compileRule({ agingLayers: 3, clauses: parseBS('B3/S23') })
      t.ok(padded.bsExpressible, '衰老态不可达时应判定为可用 B/S 表达')
      t.equal(padded.notation, 'B3/S23', '应能反解出记法')
      const vp = validateRule(padded)
      t.equal(vp.reachable.join(','), 'dead,alive', '可达状态只应有死和活')
      t.ok(vp.warnings.some(w => w.key === 'v.warn.unreachableAging'), '应提醒有永不出现的衰老层')
      // 但指纹与 0 层的 Life 不同 —— 查找表尺寸不同，这是对的
      t.ok(padded.fingerprint !== presetRule('life').fingerprint, '层数不同则查找表不同，指纹应不同')

      // Brian's Brain：衰老态可达 ⇒ 不可表达，且要指出是哪一条条款
      const brain = presetRule('brain')
      t.ok(!brain.bsExpressible, "Brian's Brain 不应可用 B/S 表达")
      t.equal(brain.notation, null, '不可表达时记法应为 null')
      const vb = validateRule(brain)
      t.equal(vb.bs.culprit, 1, '应指出第 2 条条款（alive → 衰老 1）是原因')
      t.equal(vb.bs.reasonKey, 'v.bs.culprit', '置灰原因应以 key 形式返回，不含任何人类语言')
      t.equal(vb.bs.reasonParams.state, 'aging_1', '原因参数应带上出问题的状态')
      t.equal(vb.bs.reasonParams.n, 2, '原因参数应带上条款序号')
      t.equal(vb.reachable.length, 3, "Brian's Brain 应有 3 个可达状态")
    }
  },
  {
    name: '编译表预览正确标出靠隐含兜底决定的格子',
    run(t) {
      const v = validateRule(presetRule('life'))
      const deadRow = v.table.find(r => r.state === 'dead')
      const aliveRow = v.table.find(r => r.state === 'alive')
      t.equal(deadRow.cells[3].next, 'alive', '死细胞 3 邻居应出生')
      t.equal(deadRow.cells[3].fallback, false, '3 邻居这一格由条款显式决定')
      t.equal(deadRow.cells[0].fallback, true, '死细胞 0 邻居没有条款匹配，靠兜底维持原状')
      t.equal(deadRow.cells[0].next, 'dead', '兜底结果应是维持原状')
      t.equal(aliveRow.cells[2].fallback, false, '活细胞 2 邻居由条款显式决定')
      t.equal(v.table.length, 2, 'Life 只有 2 个可达状态，预览表只列可达状态')
    }
  },
  {
    name: '结构校验在编译前拦住非法条款',
    run(t) {
      const bad = validateClauses([
        { when: 'aging_3', neighbors: { op: 'any' }, then: 'dead' },
        { when: 'alive', neighbors: { op: 'in', values: [] }, then: 'dead' },
        { when: 'alive', neighbors: { op: 'range', min: 5, max: 2 }, then: 'dead' },
        { when: 'alive', neighbors: { op: 'wat' }, then: 'dead' }
      ], 1)
      t.ok(!bad.ok, '应判定为不合法')
      t.equal(bad.errors.length, 4, '四条问题应各报一条')
      t.equal(bad.errors[0].clause, 0, '第一条错误应指向第 1 条条款')
      t.ok(validateClauses(parseBS('B3/S23'), 0).ok, '合法条款应通过')
      // 为什么必须先跑结构校验：compileRule 对两类非法条款的反应完全不同
      // (1) then 越界 → 直接抛异常
      let threw = false
      try { compileRule({ agingLayers: 1, clauses: [{ when: 'alive', neighbors: { op: 'any' }, then: 'aging_3' }] }) }
      catch (e) { threw = true }
      t.ok(threw, 'then 引用越界衰老态时 compileRule 应抛异常')
      // (2) when 越界 → 静默忽略（没有任何状态叫 aging_3，永远匹配不上）
      const silent = compileRule({
        agingLayers: 1,
        clauses: [
          { when: 'aging_3', neighbors: { op: 'any' }, then: 'dead' },
          { when: 'dead', neighbors: { op: 'in', values: [3] }, then: 'alive' },
          { when: 'alive', neighbors: { op: 'in', values: [2, 3] }, then: 'alive' },
          { when: 'alive', neighbors: { op: 'any' }, then: 'dead' }
        ]
      })
      t.equal(silent.clauseHits[0], 0, 'when 越界的条款会被静默忽略 —— 界面上必须靠结构校验告诉用户，否则它会无声地什么都不做')
    }
  },
  {
    name: '换规则时棋盘上不可达的状态被清成死亡',
    run(t) {
      const e = new LifeEngine(10, 10, { rule: presetRule('brain'), boundary: 'dead' })
      e.set(5, 5, 2)   // 衰老 1
      e.set(6, 5, 1)   // 存活
      t.equal(e.get(5, 5), 2, '先确认棋盘上确实有衰老态细胞')
      e.setRule(presetRule('life'))
      t.equal(e.get(5, 5), 0, '换成 Life 后衰老态细胞应被清成死亡')
      t.equal(e.get(6, 5), 1, '活细胞不受影响')
      // 换成"层数够但不可达"的规则时同样要清
      const e2 = new LifeEngine(10, 10, { rule: presetRule('brain'), boundary: 'dead' })
      e2.set(5, 5, 2)
      e2.setRule(compileRule({ agingLayers: 3, clauses: parseBS('B3/S23') }))
      t.equal(e2.get(5, 5), 0, '衰老态在新规则下不可达，也应被清成死亡')
    }
  },
  {
    name: '规则导出 / 导入往返一致',
    run(t) {
      const life = presetRule('life')
      t.equal(exportRule(life), 'B3/S23', '可表达时应导出 B/S 记法字符串')
      t.equal(importRule('B3/S23').fingerprint, life.fingerprint, 'B/S 记法导入后指纹应一致')
      t.equal(importRule('  b3/s23  ').fingerprint, life.fingerprint, '应容忍大小写与空白')

      const brain = presetRule('brain')
      const text = exportRule(brain)
      t.equal(text[0], '{', '不可表达时应退化成条款 JSON')
      t.equal(importRule(text).fingerprint, brain.fingerprint, '条款 JSON 往返后指纹应一致')

      let threw = false
      try { importRule('B9/S23') } catch (e) { threw = true }
      t.ok(threw, '非法记法应抛出可读错误')
    }
  },
  {
    name: '五个内置预设都能编译，记法与声明一致',
    run(t) {
      t.equal(PRESETS.length, 5, '应有 5 个预设')
      for (const p of PRESETS) {
        const r = presetRule(p.key)
        t.ok(validateClauses(p.clauses(), p.agingLayers).ok, `${p.name} 的条款应通过结构校验`)
        if (p.agingLayers === 0) {
          t.equal(r.notation, p.notation, `${p.name} 反解出的记法应与声明一致`)
        } else {
          t.ok(!r.bsExpressible, `${p.name} 有可达衰老态，不应可用 B/S 表达`)
        }
        t.ok(validateRule(r).clauses.every(c => c.status === 'ok'), `${p.name} 的条款不应有永不可达或冗余`)
      }
    }
  }
)

/* ================= 阶段 3.5：i18n 与图案库 ================= */

/** 取出模板串里的 {占位符} 名字 */
function placeholders(str) {
  return (String(str).match(/\{[a-zA-Z]+\}/g) || []).sort().join(',')
}

cases.push(
  {
    name: 'i18n 词典：中英键集完全一致，无空值',
    run(t) {
      const zhKeys = Object.keys(DICT.zh).sort()
      const enKeys = Object.keys(DICT.en).sort()
      const missingInEn = zhKeys.filter(k => !(k in DICT.en))
      const missingInZh = enKeys.filter(k => !(k in DICT.zh))
      t.equal(missingInEn.join(','), '', `英文缺失的键：${missingInEn.join(', ')}`)
      t.equal(missingInZh.join(','), '', `中文缺失的键：${missingInZh.join(', ')}`)
      t.ok(zhKeys.length > 100, `词条数量应有规模，实际 ${zhKeys.length}`)
      for (const k of zhKeys) {
        t.ok(String(DICT.zh[k]).trim() !== '', `中文词条 ${k} 不应为空`)
        t.ok(String(DICT.en[k]).trim() !== '', `英文词条 ${k} 不应为空`)
      }
    }
  },
  {
    name: 'i18n 词典：中英占位符一一对应',
    run(t) {
      // 占位符对不上是最隐蔽的翻译 bug —— 界面上会直接漏出 {n} 之类的原文
      for (const k of Object.keys(DICT.zh)) {
        t.equal(placeholders(DICT.en[k]), placeholders(DICT.zh[k]), `词条 ${k} 的占位符中英不一致`)
      }
    }
  },
  {
    name: 'i18n 词典：校验器与图案库用到的 key 都有词条',
    run(t) {
      // 引擎只返回 key，词典里没有对应词条的话界面会直接吐出 key 本身
      const used = new Set()
      // 校验器可能产出的所有 key
      for (const k of ['v.unreachable-state', 'v.shadowed', 'v.redundant', 'v.invalid-state',
        'v.bs.culprit', 'v.bs.generic', 'v.warn.allDead', 'v.warn.unreachableAging',
        'e.agingRange', 'e.notArray', 'e.badState', 'e.agingOutOfRange', 'e.emptySet',
        'e.badNeighbor', 'e.badNeighborOp', 'e.badRange', 'e.rangeInverted', 'e.unknownOp',
        'e.compileFail']) used.add(k)
      // 每个图案与每个预设都要有名称、说明、世界卡片文案
      for (const p of PATTERNS) { used.add('pattern.' + p.key); used.add('pattern.' + p.key + '.desc') }
      for (const p of PRESETS) {
        used.add('preset.' + p.key); used.add('world.' + p.key); used.add('world.' + p.key + '.desc')
      }
      for (const k of used) {
        t.ok(k in DICT.zh, `词典缺少中文词条：${k}`)
        t.ok(k in DICT.en, `词典缺少英文词条：${k}`)
      }
    }
  },
  {
    name: '图案库：13 个图案的尺寸与活细胞数正确',
    run(t) {
      t.equal(PATTERNS.length, 13, '经典 5 + 用户注册 2 + 元像素零件 6')
      const expect = {
        glider: [3, 3, 5], gun: [36, 9, 36], pulsar: [13, 13, 48], lwss: [5, 4, 9], rpentomino: [3, 3, 5],
        matt: [3, 4, 5],  // 用户注册图案，包围盒 3×4：末行那个孤立格把高度撑到 4
        eater: [4, 4, 7], // 社区经典 Eater 1，4×4 的 7 格静物
        // 元像素零件·第一批（D96）
        mwss: [6, 5, 11], hwss: [7, 5, 13],
        snark: [17, 23, 52],   // 反射器本体（减掉演示滑翔机）；朝向按"对应滑翔机 = 盒里默认那架"挑（D98）
        qbshuttle: [22, 7, 20], block: [2, 2, 4], beehive: [4, 3, 6]
      }
      for (const key of Object.keys(expect)) {
        const p = getPattern(key)
        const [w, h, n] = expect[key]
        t.equal(p.w, w, `${key} 宽度`)
        t.equal(p.h, h, `${key} 高度`)
        t.equal(p.cells.length, n, `${key} 活细胞数`)
      }
    }
  },
  {
    name: '图案库：Matt 排在 R-五连体之后，是第一个用户注册图案',
    run(t) {
      const keys = PATTERNS.map(p => p.key)
      t.equal(keys.join(','), 'glider,gun,pulsar,lwss,rpentomino,matt,eater,mwss,hwss,snark,qbshuttle,block,beehive',
        `顺序在表达来源：经典 5 → 用户注册 2 → 元像素零件 6，实测顺序 ${keys.join(',')}`)
      // 新来的一律往后排，**不许插到 lwss 旁边** —— 飞船族确实该挨着，
      // 但插进去会把已有卡片往后推，而取用区的位置是按着手指的记忆定的（D75 ③）
      t.equal(keys.slice(0, 7).join(','), 'glider,gun,pulsar,lwss,rpentomino,matt,eater',
        '原有七张卡一张都没挪位')

      // 名称不翻译：中英两语、两个语域都得是「Matt」本身
      t.equal(DICT.zh['pattern.matt'], 'Matt', '中文名不翻译')
      t.equal(DICT.en['pattern.matt'], 'Matt', '英文名一致')
      t.equal(DICT.zh['pattern.matt.simple'], 'Matt', '简洁语域中文名也是 Matt')
      t.equal(DICT.en['pattern.matt.simple'], 'Matt', '简洁语域英文名也是 Matt')
    }
  },
  {
    name: '图案库：吞食者独放是静物（7 格直柱，20 代纹丝不动）',
    run(t) {
      const p = getPattern('eater')
      t.equal(p.cells.length, 7, '7 格')
      const e = new LifeEngine(40, 40, { rule: lifeRule(), boundary: 'dead' })
      for (const [x, y] of p.cells) e.set(10 + x, 10 + y, 1)
      e.stats.alive = e.countAlive()
      const snap = () => {
        const live = []
        for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (e.get(x, y)) live.push(x + ',' + y)
        return live.join('|')
      }
      const before = snap()
      for (let i = 0; i < 20; i++) {
        e.step()
        t.equal(snap(), before, `第 ${i + 1} 代应当与第 0 代逐格相同 —— 它是静物`)
      }
      t.equal(e.stats.alive, 7, '20 代后仍是 7 格')
    }
  },
  {
    name: '收藏：内置精选局的实测生平（D64 互动型标准）',
    run(t) {
      t.equal(BUILTIN_LAYOUTS.length, 3, '三条内置精选局')
      for (const b of BUILTIN_LAYOUTS) {
        t.ok(ruleOf(b.rle) === 'B3/S23', `${b.id} 的 RLE 必须带 rule 头行 —— 没有它就没法保证复现的是同一个世界`)
        t.ok(parseRLE(b.rle).cells.length > 0, `${b.id} 的 RLE 能解析`)
      }

      const byId = id => BUILTIN_LAYOUTS.find(b => b.id === id)
      const liveKey = (e, N) => {
        const o = []
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (e.get(x, y)) o.push(x + ',' + y)
        return o.sort().join('|')
      }

      // ---- 一号：野火。22 格起步的大号 methuselah ----
      // 口径是**用户实际会看到的那一局**：应用默认的 200×200 环形盘 + 应用自己的检测器。
      // 曾经用"大盘 + 核心窗口"量过，得到 5185 / 1822 / 1243 —— 那组数是错的：
      // 末态残骸包围盒到 ±199，比窗口 ±140 还大，数字是被窗口裁出来的（详见 D82）。
      {
        const w = byId('builtin:wildfire')
        const cells = parseRLE(w.rle).cells
        t.equal(cells.length, w.life.start, '起步 22 格')
        const N = w.life.board
        const e = new LifeEngine(N, N, { rule: lifeRule(), boundary: w.life.boundary })
        const pw = Math.max(...cells.map(c => c[0])) + 1
        const ph = Math.max(...cells.map(c => c[1])) + 1
        const ox = (N >> 1) - (pw >> 1), oy = (N >> 1) - (ph >> 1)
        for (const [x, y] of cells) e.set(ox + x, oy + y, 1)
        e.stats.alive = e.countAlive()
        const det = new TerminationDetector({ genCap: 20000 })
        let peak = e.stats.alive, peakGen = 0, end = null
        for (let i = 0; i < 20000; i++) {
          const st = e.step()
          if (st.alive > peak) { peak = st.alive; peakGen = st.gen }
          const r = det.observe(st.gen, e.hash(), st.alive)
          if (r) { end = r; break }
        }
        t.equal(end && end.type, 'cycle', '应当以循环收场')
        t.equal(end && end.period, 2, '周期 2')
        t.equal(end && end.gen, w.life.settle, `应在第 ${w.life.settle} 代定型`)
        t.equal(peak, w.life.peak, `峰值应为 ${w.life.peak}`)
        t.equal(peakGen, w.life.peakGen, `峰值应在第 ${w.life.peakGen} 代`)
        t.equal(e.stats.alive, w.life.final, `末代存活应为 ${w.life.final}`)
      }

      // ---- 二号：喂食局。与 docs/patterns.md 那一段是同一局 ----
      {
        const f = byId('builtin:feeding')
        const cells = parseRLE(f.rle).cells
        t.equal(cells.length, f.life.start, '起步 12 格')
        const N = 60, O = 20
        const e = new LifeEngine(N, N, { rule: lifeRule(), boundary: 'dead' })
        for (const [x, y] of cells) e.set(O + x, O + y, 1)
        e.stats.alive = e.countAlive()
        let ate = -1
        for (let g = 1; g <= 60; g++) { e.step(); if (e.stats.alive === f.life.after) { ate = g; break } }
        t.equal(ate, f.life.eatenAt, `应在第 ${f.life.eatenAt} 代吞完`)
        const after = liveKey(e, N)
        for (let i = 0; i < 20; i++) { e.step(); t.equal(liveKey(e, N), after, '吞完后应静止') }
      }

      // ---- 三号：永动喂食机。枪对着吞食者，跑稳后整盘严格周期 30 ----
      {
        const p = byId('builtin:feeder')
        const cells = parseRLE(p.rle).cells
        t.equal(cells.length, p.life.start, '起步 43 格')
        const N = 260, O = 10
        const e = new LifeEngine(N, N, { rule: lifeRule(), boundary: 'dead' })
        for (const [x, y] of cells) e.set(O + x, O + y, 1)
        e.stats.alive = e.countAlive()
        for (let i = 0; i < 700; i++) e.step()      // 先跑到稳态
        const a = liveKey(e, N)
        const steady = e.stats.alive
        t.equal(steady, p.life.steady, `稳态人口应为 ${p.life.steady}，实测 ${steady}`)
        for (let i = 0; i < p.life.period; i++) e.step()
        t.equal(liveKey(e, N), a, `跑稳后整盘应严格周期 ${p.life.period} —— 这正是"永动"的判据`)
      }
    }
  },
  {
    name: '收藏：数据层的校验、预算与导入导出（D82）',
    run(t) {
      const good = { name: '测试局', rle: 'x = 1, y = 1, rule = B3/S23\no!', note: '', life: '' }
      t.ok(validateLayout(good).ok, '合法条目')
      t.equal(validateLayout({ ...good, name: '' }).key, 'fav.err.noName', '空名字要拒')
      t.equal(validateLayout({ ...good, rle: 'o!' }).key, 'fav.err.noRule',
        'RLE 必须带 rule 头行 —— 复现时要按它切规则，没有就保证不了是同一个世界')
      t.equal(validateLayout({ ...good, rle: '' }).key, 'fav.err.noRle', '空 RLE 要拒')
      t.equal(validateLayout(null).key, 'fav.err.shape', '非对象要拒')

      // 体积上限：满了明确拒绝，不静默丢最旧的
      const r = addLayout([], good)
      t.ok(r.ok && r.list.length === 1, '加得进去')
      const fat = { name: 'x', rle: 'rule = B3/S23\n' + 'o'.repeat(40000) + '!' }
      t.equal(addLayout([], fat).key, 'fav.err.tooBig', '单条超限要拒')
      const many = []
      for (let i = 0; i < 400; i++) many.push({ id: 'i' + i, name: 'n' + i, rle: 'rule = B3/S23\n' + 'o'.repeat(900) + '!', note: '', life: '' })
      t.ok(!fitsBudget(many), '400 条大条目应当超预算')
      t.equal(addLayout(many, good).key, 'fav.err.full', '列表满了要明确拒绝')

      // 导出导入往返
      const state = { layouts: [{ id: 'a', name: '甲', rle: good.rle, note: '备注', life: '生平' }], rules: [{ notation: 'B3/S23', fingerprint: 'abc' }] }
      const json = exportFavorites(state)
      const back = importFavorites(json)
      t.ok(back.ok, '往返应成功')
      t.equal(back.layouts.length, 1, '布局回来了')
      t.equal(back.rules.length, 1, '规则回来了')
      t.equal(back.layouts[0].name, '甲', '名字保真')

      // 宽进严出：坏条目跳过而不是整包拒绝 —— 一条坏数据废掉整个收藏文件是最差的结果
      const mixed = JSON.stringify({ kind: 'gol.favorites', version: 1, layouts: [state.layouts[0], { name: '' }], rules: [] })
      const m = importFavorites(mixed)
      t.ok(m.ok && m.layouts.length === 1 && m.skipped === 1, '坏条目跳过，好的照收')

      t.equal(importFavorites('{').key, 'fav.err.badJson', '坏 JSON')
      t.equal(importFavorites('{"kind":"other"}').key, 'fav.err.notFav', '不是收藏文件')
      t.equal(importFavorites('{"kind":"gol.favorites","version":9}').key, 'fav.err.version', '版本不认')

      // 存储边界：书签走另一条通道，台账这类键仍旧被拒
      const store = {}
      const fake = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v }, removeItem: k => { delete store[k] } }
      const p = createPrefs(fake)
      t.ok(p.setBookmark('favorites', '[]').ok, '收藏可以落 localStorage')
      t.equal(p.getBookmark('favorites'), '[]', '读得回来')
      let threw = false
      try { p.setBookmark('ledger', 'x') } catch (e) { threw = true }
      t.ok(threw, '台账仍旧不许走书签通道 —— D30 的边界只是精修，不是取消')
      threw = false
      try { p.set('favorites', 'x') } catch (e) { threw = true }
      t.ok(threw, '书签也不许混进界面偏好的白名单')
      t.equal(BOOKMARK_KEYS.length, 1, '书签白名单只有 favorites 一个')
      // 写失败必须能被调用方看见（收藏是用户的劳动，静默丢掉比报错难受）
      const full = createPrefs({ getItem: () => null, setItem: () => { throw new Error('quota') }, removeItem: () => {} })
      t.equal(full.setBookmark('favorites', '[]').key, 'fav.err.quota', '配额满要报出来，不能静默')
    }
  },
  {
    name: '图案朝向：8 种朝向构成一个群（D81 ①）',
    run(t) {
      const g = getPattern('glider')
      const key = p => JSON.stringify(p.cells)

      // 转四次回原样
      let r = g
      for (let i = 0; i < 4; i++) r = transformPattern(r, { rot: 1 })
      t.equal(key(r), key(g), '旋转四次必须回到原样')
      // 翻两次回原样
      t.equal(key(transformPattern(transformPattern(g, { flip: true }), { flip: true })), key(g),
        '镜像两次必须回到原样')
      // 8 种朝向互不相同（滑翔机没有对称性，所以群作用是自由的）
      const set = {}
      for (let rot = 0; rot < 4; rot++) for (const flip of [false, true]) {
        set[key(transformPattern(g, { rot, flip }))] = true
      }
      t.equal(Object.keys(set).length, 8, '滑翔机的 8 种朝向应当互不相同')
      // rot 取模：-1 与 3 是同一个朝向
      t.equal(key(transformPattern(g, { rot: -1 })), key(transformPattern(g, { rot: 3 })), 'rot 取模 4')
      t.equal(key(transformPattern(g, { rot: 4 })), key(g), 'rot=4 即原样')
      // 格数不变、归一到原点
      for (let rot = 0; rot < 4; rot++) for (const flip of [false, true]) {
        const p = transformPattern(g, { rot, flip })
        t.equal(p.cells.length, g.cells.length, '变换不增减格子')
        t.equal(Math.min(...p.cells.map(c => c[0])), 0, '变换后归一到 x=0')
        t.equal(Math.min(...p.cells.map(c => c[1])), 0, '变换后归一到 y=0')
        t.equal(p.w, Math.max(...p.cells.map(c => c[0])) + 1, 'w 与 cells 自洽')
        t.equal(p.h, Math.max(...p.cells.map(c => c[1])) + 1, 'h 与 cells 自洽')
      }
      // 顺序固定为"先镜像后旋转" —— 顺序反了会给出另一半陪集，
      // 于是"F 再 R×2"和"R×2 再 F"结果不同，用户按不出规律
      const src = readSrc('src/engine/patterns.js')
      t.ok(/if \(flip\) cells = cells\.map[\s\S]{0,120}?for \(let i = 0; i < rot; i\+\+\)/.test(src),
        'transformPattern 必须先镜像后旋转')

      // 默认吞食者按 R 一次是 SW、两次 NW、三次 NE（文档里的旋转指南据此写）
      const eater = getPattern('eater')
      const norm = cs => {
        const mx = Math.min(...cs.map(c => c[0])), my = Math.min(...cs.map(c => c[1]))
        return JSON.stringify(cs.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0]))
      }
      const want = {
        0: '2o$obo$2bo$2b2o!', 1: '2b2o$3bo$3o$o!', 2: '2o$bo$bobo$2b2o!', 3: '3bo$b3o$o$2o!'
      }
      for (const rot of [0, 1, 2, 3]) {
        t.equal(norm(transformPattern(eater, { rot }).cells), norm(parseRLE(want[rot]).cells),
          `按 R ${rot} 次的朝向必须与文档写的一致`)
      }
    }
  },
  {
    name: '图案朝向：R / F 在选中图案时归图案所有（快捷键冲突）',
    run(t) {
      // 实测踩到过：R 已经是"随机填充"、F 是"适配视图"，
      // 不加这一条的话，按 R 转朝向会顺手把整盘随机填充掉。
      const ctl = readSrc('src/ui/controls.js')
      t.ok(/if \(app\.stamp && \(k === 'r' \|\| k === 'f'\)\) return/.test(ctl),
        '选中图案时全局的 R / F 必须让位给旋转 / 镜像')
      const inp = readSrc('src/ui/input.js')
      t.ok(/app\.rotateStamp\(1\)/.test(inp) && /app\.flipStamp\(\)/.test(inp),
        'R / F 应当接到 rotateStamp / flipStamp')
      // 幽灵与落子必须用同一个变换后的图案，否则"看到的不是放下的"
      const main = readSrc('src/main.js')
      t.ok(/const p = app\.stampPattern\(\)/.test(main), '落子必须用变换后的图案')
      t.ok(/const gp = app\.stampPattern\(\)/.test(main), '幽灵也必须用变换后的图案')
      // 手机上的两个按钮：44px，且只在选中图案时出现
      const html = readSrc('index.html')
      t.ok(html.indexOf('id="btn-rotate"') >= 0 && html.indexOf('id="btn-flip"') >= 0, '窄屏两个朝向按钮')
      const css = readSrc('src/style.css')
      t.ok(/\.stamp-tools button \{[^}]*width:\s*44px;\s*height:\s*44px/.test(css), '触控区 44px 不缩水')
    }
  },
  {
    name: '图案库：吞食者的默认朝向必须开箱即配盒里的滑翔机（D81）',
    run(t) {
      // 追加要求的核心：用户从玩具盒拖一个吞食者、再拖一个滑翔机放到它斜上方，
      // **不用旋转**就该喂成。所以先实测盒里滑翔机往哪飞，再断言默认吞食者配得上。
      const g = getPattern('glider')
      const N = 60
      const e = new LifeEngine(N, N, { rule: lifeRule(), boundary: 'dead' })
      for (const [x, y] of g.cells) e.set(25 + x, 25 + y, 1)
      e.stats.alive = e.countAlive()
      const cen = () => {
        let sx = 0, sy = 0, n = 0
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (e.get(x, y)) { sx += x; sy += y; n++ }
        return [sx / n, sy / n]
      }
      const c0 = cen()
      for (let i = 0; i < 40; i++) e.step()
      const c1 = cen()
      // 不采信任何说法，实跑取质心位移
      t.ok(c1[0] - c0[0] > 5, `盒里滑翔机应向右（+x）飞，实测 ${(c1[0] - c0[0]).toFixed(0)}`)
      t.ok(c1[1] - c0[1] > 5, `盒里滑翔机应向下（+y）飞，实测 ${(c1[1] - c0[1]).toFixed(0)}`)
    }
  },
  {
    name: '图案库：喂食标准摆位（默认朝向，文档里写给用户照做的那一组）',
    run(t) {
      // docs/patterns.md 里那段 RLE 就是这一组。摆位、代数、逐格复原都是断言 ——
      // 文档写给用户照做的东西必须有断言兜着，否则某次改动后它会悄悄失效，
      // 而用户照做一次不成功就再也不会试第二次（D64）。
      const EATER = getPattern('eater').cells
      const GLIDER = getPattern('glider').cells
      const DX = -10, DY = -10          // 滑翔机在吞食者的左上方
      const N = 60, OX = 25, OY = 25
      const e = new LifeEngine(N, N, { rule: lifeRule(), boundary: 'dead' })
      for (const [x, y] of EATER) e.set(OX + x, OY + y, 1)
      for (const [x, y] of GLIDER) e.set(OX + DX + x, OY + DY + y, 1)
      e.stats.alive = e.countAlive()
      t.equal(e.stats.alive, 12, '开局 7 + 5 = 12 格')

      const eaterKey = EATER.map(c => (OX + c[0]) + ',' + (OY + c[1])).sort().join('|')
      const liveKey = () => {
        const out = []
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (e.get(x, y)) out.push(x + ',' + y)
        return out.sort().join('|')
      }
      let ateAt = -1
      for (let gen = 1; gen <= 60; gen++) {
        e.step()
        if (e.stats.alive === 7 && liveKey() === eaterKey) { ateAt = gen; break }
      }
      t.equal(ateAt, 30, `应在第 30 代吞完，实测第 ${ateAt} 代`)
      t.equal(liveKey(), eaterKey, '必须逐格回到原位')
      const after = liveKey()
      for (let i = 0; i < 20; i++) { e.step(); t.equal(liveKey(), after, `吞完后第 ${i + 1} 代仍应静止`) }
    }
  },
  {
    name: '图案库：吞食者四朝向表（他处给的表，用自家引擎逐条实跑验证，不采信）',
    run(t) {
      // 关键发现：表里的 RLE 与配对全对，**偏移的符号是反的** ——
      // 它按"吞食者相对滑翔机"记，我们按"滑翔机相对吞食者"记。
      // 四条的代数分毫不差（6/12/4/10），正是这一点证明 RLE 本身没问题。
      const T = [
        { n: 'SE', eater: '2o$obo$2bo$2b2o!', glider: 'bo$2bo$3o!', dx: -4, dy: -4, gen: 6 },
        { n: 'SW', eater: '2b2o$3bo$3o$o!', glider: 'bo$o$3o!', dx: 6, dy: -6, gen: 12 },
        { n: 'NE', eater: '3bo$b3o$o$2o!', glider: '3o$2bo$bo!', dx: -3, dy: 5, gen: 4 },
        { n: 'NW', eater: '2o$bo$bobo$2b2o!', glider: '3o$o$bo!', dx: 6, dy: 6, gen: 10 }
      ]
      const norm = cs => {
        const mx = Math.min(...cs.map(c => c[0])), my = Math.min(...cs.map(c => c[1]))
        return cs.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[1] - b[1] || a[0] - b[0])
      }
      const run = (E, G, dx, dy) => {
        const N = 70, OX = 30, OY = 30
        const e = new LifeEngine(N, N, { rule: lifeRule(), boundary: 'dead' })
        for (const [x, y] of E) e.set(OX + x, OY + y, 1)
        for (const [x, y] of G) e.set(OX + dx + x, OY + dy + y, 1)
        e.stats.alive = e.countAlive()
        if (e.stats.alive !== E.length + G.length) return null
        const key = E.map(c => (OX + c[0]) + ',' + (OY + c[1])).sort().join('|')
        for (let gen = 1; gen <= 90; gen++) {
          e.step()
          if (e.stats.alive !== E.length) continue
          const out = []
          for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (e.get(x, y)) out.push(x + ',' + y)
          if (out.sort().join('|') === key) return gen
        }
        return null
      }
      for (const r of T) {
        const E = norm(parseRLE(r.eater).cells)
        const G = norm(parseRLE(r.glider).cells)
        t.equal(E.length, 7, `${r.n} 吞食者 7 格`)
        t.equal(G.length, 5, `${r.n} 滑翔机 5 格`)
        t.equal(run(E, G, r.dx, r.dy), r.gen, `${r.n}: 滑翔机置于 (${r.dx},${r.dy}) 应在第 ${r.gen} 代吞完并复原`)
        // 沿对角线加 (±1,±1) 相位不变：滑翔机 4 代走一格，所以每远一格 +4 代。
        // 各验两个距离 —— 这条"沿用规则"若不成立，文档里"想放远点就照对角线加"就是假话。
        const sx = Math.sign(r.dx) || 1, sy = Math.sign(r.dy) || 1
        t.equal(run(E, G, r.dx + sx, r.dy + sy), r.gen + 4, `${r.n} 远一格应 +4 代`)
        t.equal(run(E, G, r.dx + sx * 2, r.dy + sy * 2), r.gen + 8, `${r.n} 远两格应 +8 代`)
      }
    }
  },
  {
    name: '图案库：Matt 的实测生平（注册标准要求附生平，这里钉死）',
    run(t) {
      // 注册标准见 D64：用户原创图案要附 RLE + 实测生平，且生平必须可复现。
      // 盘子取 400×400 死边界、图案居中 —— 够大，核心定型之前滑翔机碰不到边。
      const N = 400, C = N >> 1
      const e = new LifeEngine(N, N, { rule: lifeRule(), boundary: 'dead' })
      const p = getPattern('matt')
      for (const [x, y] of p.cells) e.set(C + x, C + y, 1)
      e.stats.alive = e.countAlive()
      t.equal(e.stats.alive, 5, '起步 5 格')

      // 只看中心窗口：飞出去的滑翔机永远不停，全盘是不会"定型"的
      const R = 70
      const winHash = () => {
        let h = 2166136261
        for (let y = C - R; y <= C + R; y++) {
          for (let x = C - R; x <= C + R; x++) { h ^= e.get(x, y) ? 1 : 0; h = Math.imul(h, 16777619) }
        }
        return h >>> 0
      }
      const hs = [winHash()]
      let settled = 0, peak = 5, peakGen = 0
      for (let i = 0; i < 1400; i++) {
        const st = e.step()
        hs.push(winHash())
        if (st.alive > peak) { peak = st.alive; peakGen = st.gen }
        const g = hs.length - 1
        if (g >= 2 && hs[g] !== hs[g - 2]) settled = g   // 最后一次"与两代前不同"
      }
      t.info(`Matt：峰值 ${peak} @ 第 ${peakGen} 代，核心第 ${settled} 代进入周期 2`)
      t.equal(peakGen, 823, '人口峰值出现的代数')
      t.equal(peak, 319, '人口峰值')
      t.equal(settled, 1106, '核心定型代数')

      // 那个孤立格不是装饰：去掉它，第 4 代就安静了
      const e2 = new LifeEngine(N, N, { rule: lifeRule(), boundary: 'dead' })
      for (const [x, y] of p.cells.filter(c => c[1] < 3)) e2.set(C + x, C + y, 1)
      e2.stats.alive = e2.countAlive()
      t.equal(e2.stats.alive, 4, '去掉孤立格后剩 4 个格子')
      let last = 0
      const seen = []
      for (let i = 0; i < 50; i++) {
        e2.step()
        seen.push(e2.hash())
        if (seen.length >= 3 && seen[seen.length - 1] !== seen[seen.length - 3]) last = i + 1
      }
      t.equal(last, 4, `少了那一格，第 4 代就安定，实测第 ${last} 代`)
      t.equal(e2.stats.alive, 6, '安定成 6 格静物')
    }
  },
  {
    name: '图案库：滑翔机放上棋盘后确实是滑翔机',
    run(t) {
      const e = new LifeEngine(40, 40, { rule: lifeRule(), boundary: 'dead' })
      placePattern(e, getPattern('glider'), 10, 10)
      const before = liveCells(e)
      t.equal(before.length, 5, '放置后应有 5 个活细胞')
      for (let i = 0; i < 4; i++) e.step()
      const after = liveCells(e).map(c => `${c[0]},${c[1]}`).sort().join(';')
      const expected = before.map(c => `${c[0] + 1},${c[1] + 1}`).sort().join(';')
      t.equal(after, expected, '4 代后应整体平移 (1,1)')
    }
  },
  {
    name: '图案库：脉冲星周期为 3，轻量飞船 4 代平移 (2,0)',
    run(t) {
      const e = new LifeEngine(40, 40, { rule: lifeRule(), boundary: 'dead' })
      placePattern(e, getPattern('pulsar'), 12, 12)
      const g0 = e.snapshot()
      e.step()
      t.ok(!eqSnapshot(g0, e.snapshot()), '第 1 代应与初始不同')
      e.step(); e.step()
      t.ok(eqSnapshot(g0, e.snapshot()), '第 3 代应回到初始 ⇒ 周期为 3')

      const e2 = new LifeEngine(40, 40, { rule: lifeRule(), boundary: 'dead' })
      placePattern(e2, getPattern('lwss'), 20, 15)
      const c0 = liveCells(e2)
      t.equal(c0.length, 9, '轻量飞船应有 9 个活细胞')
      for (let i = 0; i < 4; i++) e2.step()
      const moved = liveCells(e2).map(c => `${c[0]},${c[1]}`).sort().join(';')
      // 这个朝向的 LWSS 向西飞：每 4 代平移 (-2, 0)
      const want = c0.map(c => `${c[0] - 2},${c[1]}`).sort().join(';')
      t.equal(moved, want, '轻量飞船 4 代应横向平移 2 格')
    }
  },
  {
    name: '图案库：越界裁剪与居中放置',
    run(t) {
      const e = new LifeEngine(10, 10, { boundary: 'dead' })
      // 左上角外放置：只有落在棋盘内的部分会写入
      const placed = placePattern(e, getPattern('pulsar'), -6, -6)
      t.ok(placed > 0 && placed < 48, `应部分裁剪，实际写入 ${placed} 格`)
      t.equal(e.countAlive(), placed, '写入格数应与返回值一致')

      const g = getPattern('glider')
      const o = centerOrigin(g, 20, 30)
      t.equal(o.x, 19, '3 宽的图案居中于 x=20 时左上角应在 19')
      t.equal(o.y, 29, '3 高的图案居中于 y=30 时左上角应在 29')
    }
  }
)

function eqSnapshot(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/* ================= 小阶段：文案与引导 ================= */

/** 简洁语域会用到的词条：key + '.simple' 的白话版，加上只在简洁模式露面的世界卡片与三幕卡 */
function simpleRegisterEntries(table) {
  const out = {}
  for (const k of Object.keys(table)) {
    if (k.endsWith('.simple') || k.startsWith('world.') || k.startsWith('intro.')) out[k] = table[k]
  }
  return out
}

cases.push(
  {
    name: '文案：每个 .simple 白话词条都有对应的通用词条兜底',
    run(t) {
      // t() 在简洁语域下先找 key+'.simple'，找不到才回落 key。
      // 若某个 .simple 没有对应的基础 key，说明它在完整模式下压根显示不出来。
      for (const lang of ['zh', 'en']) {
        for (const k of Object.keys(DICT[lang])) {
          if (!k.endsWith('.simple')) continue
          const base = k.slice(0, -'.simple'.length)
          t.ok(base in DICT[lang], `${lang} 的 ${k} 缺少基础词条 ${base}`)
        }
      }
    }
  },
  {
    name: '文案：简洁模式与三幕卡里不出现术语',
    run(t) {
      // 标准是"跟同学解释"，不是"哄小朋友"：可以有完整句子，但不能有行话。
      // help.* 是完整模式的参考页，本来就该讲 B/S 记法，所以不在检查范围内。
      const banned = {
        zh: ['振荡器', '周期', '密度', '记法', '指纹', '条款', '衰老', '邻居数', '代数', '查找表', '细胞', '种子'],
        en: ['oscillator', 'period', 'density', 'notation', 'fingerprint', 'clause', 'generation', 'cell', 'seed']
      }
      for (const lang of ['zh', 'en']) {
        const entries = simpleRegisterEntries(DICT[lang])
        for (const k of Object.keys(entries)) {
          // 先剥掉 {占位符} —— 它们是代码里的参数名，不是显示给人看的文字
          const v = String(entries[k]).replace(/\{[a-zA-Z]+\}/g, ' ').toLowerCase()
          for (const w of banned[lang]) {
            t.ok(v.indexOf(w.toLowerCase()) === -1, `${lang} 的 ${k} 里出现了术语「${w}」：${entries[k]}`)
          }
        }
      }
    }
  },
  {
    name: '文案：三幕卡与两页参考的词条齐全',
    run(t) {
      const need = [
        'intro.step', 'intro.skip', 'intro.next', 'intro.back', 'intro.start', 'intro.close', 'intro.reopen',
        'intro.act1.title', 'intro.act1.body', 'intro.act1.caption',
        'intro.act2.title', 'intro.act2.body', 'intro.act2.hint', 'intro.act2.step', 'intro.act2.reset',
        'intro.act2.lonely', 'intro.act2.lonely.body',
        'intro.act2.crowded', 'intro.act2.crowded.body',
        'intro.act2.birth', 'intro.act2.birth.body',
        'intro.act3.title', 'intro.act3.body', 'intro.act3.caption', 'intro.act3.gift',
        'help.age.title', 'help.age.body', 'help.age.new', 'help.age.mid', 'help.age.old', 'help.age.dead',
        'help.bs.title', 'help.bs.body', 'help.bs.born', 'help.bs.survive', 'help.bs.none', 'help.bs.current'
      ]
      for (const k of need) {
        t.ok(k in DICT.zh, `中文缺词条 ${k}`)
        t.ok(k in DICT.en, `英文缺词条 ${k}`)
      }
    }
  },
  {
    name: '文案：每个控件的悬停提示都有词条',
    run(t) {
      const need = [
        'tip.play', 'tip.pause', 'tip.step', 'tip.clear', 'tip.speed', 'tip.random', 'tip.density',
        'tip.seed', 'tip.boundary', 'tip.torus', 'tip.deadEdge', 'tip.size', 'tip.fit', 'tip.palette',
        'tip.age', 'tip.glow', 'tip.glowLen', 'tip.trails', 'tip.trailLen', 'tip.rule', 'tip.notation',
        'tip.fingerprint', 'tip.states', 'tip.chart', 'tip.mode', 'tip.lang', 'tip.help',
        'tip.pattern', 'tip.world',
        'tip.stat.gen', 'tip.stat.alive', 'tip.stat.births', 'tip.stat.area', 'tip.stat.lonely', 'tip.stat.crowded'
      ]
      for (const k of need) {
        t.ok(k in DICT.zh, `中文缺提示 ${k}`)
        t.ok(k in DICT.en, `英文缺提示 ${k}`)
      }
      // 完整模式的术语控件必须是「术语 + 一句人话」，中文用破折号、英文用 em dash 连接
      for (const k of ['tip.boundary', 'tip.torus', 'tip.deadEdge', 'tip.density', 'tip.seed',
        'tip.size', 'tip.palette', 'tip.age', 'tip.glow', 'tip.trails', 'tip.notation',
        'tip.fingerprint', 'tip.states']) {
        t.ok(DICT.zh[k].includes('——'), `中文提示 ${k} 应是「术语 —— 一句人话」的格式：${DICT.zh[k]}`)
        t.ok(DICT.en[k].includes('—'), `英文提示 ${k} 应是 "term — plain sentence" 的格式：${DICT.en[k]}`)
      }
    }
  },
  {
    name: '引导：三条规矩的迷你棋盘演的确实是那三件事',
    run(t) {
      // 介绍卡里的三块地不是画死的示意图，走的是真引擎。这里就用引擎把它们各验一遍。
      const mk = setup => {
        const e = new LifeEngine(7, 5, { rule: lifeRule(), boundary: 'dead' })
        for (const [x, y] of setup) e.set(x, y, 1)
        return e
      }

      // 朋友太少：两个相邻的格子，各只有 1 个朋友 → 走一步全没
      const lonely = mk([[2, 2], [3, 2]])
      const s1 = lonely.step()
      t.equal(s1.alive, 0, '两个孤零零的格子应该一步之内全没')
      t.equal(s1.deathsLonely, 2, '两个都应算孤独死')
      t.equal(s1.births, 0, '不该有新生命')

      // 挤得太满：3×3 实心块，中间那个被闷死，留下一个洞
      const crowded = mk([[2, 1], [3, 1], [4, 1], [2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3]])
      const s2 = crowded.step()
      t.equal(crowded.get(3, 2), 0, '中间那个应该被闷死，留出一个洞')
      t.equal(s2.deathsCrowded, 5, '中间 1 个加四条边中点 4 个，共 5 个闷死')
      t.equal(s2.deathsLonely, 0, '不该有孤独死来抢戏')

      // 刚好三个：空位 (3,2) 旁边刚好 3 个朋友 → 冒出新的，结果是个 2×2 方块
      const birth = mk([[2, 1], [3, 1], [2, 2]])
      const s3 = birth.step()
      t.equal(birth.get(3, 2), 1, '那个空位应该冒出新生命')
      t.equal(s3.births, 1, '应该只诞生 1 个，画面不会乱')
      t.equal(s3.alive, 4, '结果应该是个 2×2 方块')
      t.equal(s3.deathsLonely + s3.deathsCrowded, 0, '原来那三个都该活着')
    }
  }
)

/* ================= 规格修订：界面偏好可持久化，游戏数据不可 ================= */

/** 一个够用的假 localStorage */
function fakeStorage() {
  const map = new Map()
  return {
    map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: k => { map.delete(k) }
  }
}

cases.push(
  {
    name: '偏好：白名单只放界面偏好，逐个点名',
    run(t) {
      // 白名单挡的是**游戏数据**，不是键的数量。新加一个要同时满足三条（D84 ③）：
      // 是界面偏好而非实验数据、丢了不损失用户劳动、只影响这台设备的这个浏览器。
      // zoomBar（缩放滑条开关）是照这三条收进来的第四个。
      t.equal(PREF_KEYS.length, 6, '白名单里只有这几个')
      t.equal(PREF_KEYS.slice().sort().join(','), 'introSeen,lang,mode,motionRay,stampTipSeen,zoomBar', '逐个点名')
      // 反面照旧：游戏数据一个都不许进（下面那条用真存储撞过一遍）
      for (const k of ['board', 'save', 'ledger', 'snapshots'])
        t.ok(!PREF_KEYS.includes(k), `${k} 不许进白名单`)
    }
  },
  {
    name: '偏好：允许的键正常读写，且带命名空间前缀',
    run(t) {
      const st = fakeStorage()
      const p = createPrefs(st)
      t.equal(p.get('lang', 'zh'), 'zh', '没存过时回落到默认值')
      t.ok(p.set('lang', 'en'), '写入应成功')
      t.equal(p.get('lang', 'zh'), 'en', '读回应是刚写的值')
      t.ok(p.set('mode', 'simple') && p.set('introSeen', '1'), '另外两个键也能写')
      // 键必须带前缀，免得和页面上别的东西撞名
      const keys = [...st.map.keys()]
      t.equal(keys.length, 3, '存储里应恰好三条')
      t.ok(keys.every(k => k.indexOf('gol.pref.') === 0), `所有键都应带前缀，实际：${keys.join(', ')}`)
      p.clear()
      t.equal(st.map.size, 0, 'clear 应清空自己的键')
    }
  },
  {
    name: '偏好：任何游戏数据键都会被白名单拒绝',
    run(t) {
      const st = fakeStorage()
      const p = createPrefs(st)
      // 规格修订只放开了界面偏好；棋盘 / 存档 / 台账 / 快照仍走显式文件导出
      const forbidden = ['board', 'cells', 'save', 'savefile', 'ledger', 'snapshot', 'snapshots',
        'seed', 'rule', 'generation', 'pattern', 'history', 'runs']
      for (const k of forbidden) {
        let threwOnWrite = false, threwOnRead = false
        try { p.set(k, 'x') } catch (e) { threwOnWrite = true }
        try { p.get(k) } catch (e) { threwOnRead = true }
        t.ok(threwOnWrite, `写入「${k}」应被拒绝`)
        t.ok(threwOnRead, `读取「${k}」也应被拒绝`)
        t.ok(!p.isAllowed(k), `「${k}」不应在白名单里`)
      }
      t.equal(st.map.size, 0, '被拒绝的写入不应在存储里留下任何东西')
    }
  },
  {
    name: '偏好：存储不可用或抛异常时应用不受影响',
    run(t) {
      // 隐私模式 / 禁用 cookie：探测不到存储
      const none = createPrefs(null)
      t.equal(none.available, false, '应如实报告存储不可用')
      t.equal(none.get('lang', 'zh'), 'zh', '读应回落到默认值')
      t.equal(none.set('lang', 'en'), false, '写应返回 false 而不是抛异常')
      none.clear()   // 不该抛

      // 存储存在但每次调用都抛（配额满 / 被策略拦截）
      const hostile = createPrefs({
        getItem() { throw new Error('blocked') },
        setItem() { throw new Error('blocked') },
        removeItem() { throw new Error('blocked') }
      })
      t.equal(hostile.get('mode', 'full'), 'full', '读抛异常时应回落到默认值')
      t.equal(hostile.set('mode', 'simple'), false, '写抛异常时应返回 false')
      hostile.clear()   // 不该抛
      t.ok(true, '全程没有异常逃逸出来')
    }
  }
)

/* ================= 阶段 4：数据记录与编年史 ================= */

/** 够用的 CSV 解析器，只为把导出的东西读回来对账 */
function parseCSV(text) {
  const lines = text.trim().split('\n')
  const head = lines[0].split(',')
  return lines.slice(1).map(l => {
    const cells = l.split(',')
    const o = {}
    head.forEach((h, i) => { o[h] = cells[i] })
    return o
  })
}

/** 跑一局，把每代统计喂给记录组件 */
function runWith(engine, gens, { log, detector, chronicle } = {}) {
  const truth = []
  if (detector) detector.observe(0, engine.hash(), engine.countAlive())
  for (let i = 0; i < gens; i++) {
    const s = engine.step()
    truth.push({ ...s })
    if (log) log.push(s)
    if (chronicle) chronicle.observe(s)
    if (detector) {
      const end = detector.observe(s.gen, engine.hash(), s.alive)
      if (end) return { truth, end }
    }
  }
  return { truth, end: null }
}

cases.push(
  {
    name: '终止检测：blinker 独跑，第 2 代检测到 cycle，周期为 2',
    run(t) {
      const e = new LifeEngine(11, 11, { rule: lifeRule(), boundary: 'dead' })
      place(e, `
        OOO
      `, 4, 5)
      const d = new TerminationDetector()
      const { end } = runWith(e, 20, { detector: d })
      t.ok(!!end, '应该检测到终止')
      t.equal(end.type, 'cycle', '类型应为 cycle')
      t.equal(end.gen, 2, '应在第 2 代检测到')
      t.equal(end.period, 2, '周期应报告为 2')
      t.equal(end.from, 0, '应指出回到了第 0 代的状态')
    }
  },
  {
    name: '终止检测：3 个孤立细胞，检测到 extinction',
    run(t) {
      const e = new LifeEngine(30, 30, { rule: lifeRule(), boundary: 'dead' })
      // 三个互不相邻的孤立细胞，各自 0 个朋友，下一代必然全没
      e.set(3, 3, 1); e.set(15, 9, 1); e.set(24, 22, 1)
      const d = new TerminationDetector()
      const { end } = runWith(e, 20, { detector: d })
      t.ok(!!end, '应该检测到终止')
      t.equal(end.type, 'extinction', '类型应为 extinction')
      t.equal(end.gen, 1, '第 1 代就全灭')
      t.equal(e.countAlive(), 0, '棋盘确实空了')
    }
  },
  {
    name: '终止检测：静止（方块）报 still 而不是 cycle',
    run(t) {
      const e = new LifeEngine(10, 10, { rule: lifeRule(), boundary: 'dead' })
      place(e, `
        OO
        OO
      `, 3, 3)
      const d = new TerminationDetector()
      const { end } = runWith(e, 10, { detector: d })
      t.equal(end.type, 'still', '静物应报 still —— 它本质上是周期 1 的循环，但那样说没信息量')
      t.equal(end.gen, 1, '第 1 代就与上一代逐格相同')
    }
  },
  {
    name: '终止检测：四条件各自可单独关闭',
    run(t) {
      const e = new LifeEngine(10, 10, { rule: lifeRule(), boundary: 'dead' })
      e.set(3, 3, 1)
      const off = new TerminationDetector({ enabled: { extinction: false, still: false, cycle: false, capped: false } })
      t.equal(runWith(e, 10, { detector: off }).end, null, '四条全关时不该报任何终止')

      // 只开代数上限
      const e2 = new LifeEngine(10, 10, { rule: lifeRule(), boundary: 'dead' })
      place(e2, `
        OO
        OO
      `, 3, 3)
      const cap = new TerminationDetector({
        enabled: { extinction: false, still: false, cycle: false, capped: true }, genLimit: 7
      })
      const r = runWith(e2, 30, { detector: cap })
      t.equal(r.end.type, 'capped', '静物在只开上限时应跑到上限才停')
      t.equal(r.end.gen, 7, '应在第 7 代触发上限')
    }
  },
  {
    name: '终止检测：周期算的是"距上次多久"，不是"距第一次多久"',
    run(t) {
      // 静物：每一代棋盘都一样。关掉 still 之后，它应该被报成周期 1 的循环，
      // 而不是"从第 0 代到现在过了 N 代所以周期 N"。
      const d = new TerminationDetector({ enabled: { extinction: false, still: false, cycle: true, capped: false } })
      d.observe(0, 'H', 4)
      t.equal(d.observe(1, 'H', 4).period, 1, '第 1 代应报周期 1')
      t.equal(d.observe(2, 'H', 4).period, 1, '第 2 代仍应报周期 1，而不是 2')
      t.equal(d.observe(7, 'H', 4).from, 2, 'from 应指向最近一次出现，而不是第一次')

      // 命中之后继续喂：历史不能留空洞，否则放行后算出的周期会把空掉的代数算进去
      const d2 = new TerminationDetector({ enabled: { extinction: false, still: true, cycle: true, capped: false } })
      d2.observe(0, 'H', 4)
      t.equal(d2.observe(1, 'H', 4).type, 'still', '开着 still 时应先报静止')
      for (let g = 2; g <= 6; g++) d2.observe(g, 'H', 4)   // 命中期间照样喂
      d2.enabled.still = false                              // 相当于界面上点了「继续跑」
      const after = d2.observe(7, 'H', 4)
      t.equal(after.type, 'cycle', '放行后应报循环')
      t.equal(after.period, 1, `放行后周期仍应是 1，实测 ${after.period}`)

      // 真正的多代周期不能被这个改动带偏：blinker 仍然是 2
      const d3 = new TerminationDetector()
      d3.observe(0, 'A', 3); d3.observe(1, 'B', 3)
      const blink = d3.observe(2, 'A', 3)
      t.equal(blink.type, 'cycle', 'blinker 应报循环')
      t.equal(blink.period, 2, 'blinker 周期仍是 2')
      t.equal(blink.from, 0, 'blinker 的 from 仍是第 0 代')
    }
  },
  {
    name: '终止检测：查重用 Map，不是线性扫描历史',
    run(t) {
      const d = new TerminationDetector({ enabled: { extinction: false, still: false, cycle: true, capped: false } })
      t.ok(d.seen instanceof Map, '历史查重结构必须是 Map')

      // 复杂度守卫。这条测过两版都会偶发飘红，原因值得写下来：
      //   第一版 2000/10000（×5）：小样本只花 0.1ms，贴着计时器分辨率，量到的全是噪声。
      //   第二版 10000/50000（×5）+ 中位数：噪声压住了，但**判据本身余量太窄** ——
      //     Map 实测 6×、判据 10×、线性 25×，三个数挤在一起，一次 GC 停顿就够越界。
      // 根子在样本倍数只有 ×5。改成 ×10 之后：Map 应在 10× 附近，线性会是 100×，
      // 判据放在 30× —— 两边各留 3 倍余量，GC 停顿再也顶不动它。
      // 另一重保险是绝对耗时：真退化成线性扫描的话，20 万条要跑 2×10^10 次比较，
      // 那是分钟级，500ms 的上限根本轮不到倍率去判。
      const timeFor = n => {
        const det = new TerminationDetector({ enabled: { extinction: false, still: false, cycle: true, capped: false } })
        const t0 = now()
        for (let i = 0; i < n; i++) det.observe(i, 'h' + i, 1)
        return now() - t0
      }
      const medianTime = n => {
        const runs = [timeFor(n), timeFor(n), timeFor(n)].sort((a, b) => a - b)
        return runs[1]
      }
      timeFor(20000)                      // 预热
      const small = medianTime(20000)
      const big = medianTime(200000)
      const ratio = big / small
      t.info(`2 万条 ${small.toFixed(2)}ms，20 万条 ${big.toFixed(2)}ms，倍率 ${ratio.toFixed(1)}×（线性扫描应接近 100×）`)
      t.ok(small > 0.5, `小样本耗时应明显高于计时器分辨率，实测 ${small.toFixed(2)}ms`)
      t.ok(ratio < 30, `倍率应贴近 10 而不是 100，实测 ${ratio.toFixed(1)}×`)
      t.ok(big < 500, `二十万条查重应在 500ms 内，实测 ${big.toFixed(2)}ms`)
    }
  },
  {
    name: '终止检测：跑满 10,000 代，每代额外开销可忽略',
    run(t) {
      const gens = 10000
      const mk = () => new LifeEngine(100, 100, { rule: lifeRule(), boundary: 'torus' }).randomize(4271, 0.3)

      const bare = mk()
      for (let i = 0; i < 200; i++) bare.step()          // 预热
      const t0 = now()
      for (let i = 0; i < gens; i++) bare.step()
      const bareMs = now() - t0

      const withDet = mk()
      const d = new TerminationDetector({ enabled: { extinction: true, still: true, cycle: true, capped: false } })
      d.observe(0, withDet.hash(), withDet.countAlive())
      for (let i = 0; i < 200; i++) { withDet.step(); d.observe(withDet.generation, withDet.hash(), withDet.stats.alive) }
      // 不在命中后提前退出 —— 否则小棋盘上一千多代就收敛了，根本跑不到一万代规模
      const t1 = now()
      let firstHit = null
      for (let i = 0; i < gens; i++) {
        const s = withDet.step()
        const hit = d.observe(s.gen, withDet.hash(), s.alive)
        if (hit && !firstHit) firstHit = hit
      }
      const withMs = now() - t1
      const perGen = (withMs - bareMs) / gens
      t.info(`裸跑 ${(bareMs / gens).toFixed(3)}ms/代，带哈希+检测 ${(withMs / gens).toFixed(3)}ms/代，` +
        `额外 ${perGen.toFixed(3)}ms/代；查重表 ${d.hashCount} 条，` +
        `首次命中在第 ${firstHit ? firstHit.gen : '—'} 代（${firstHit ? firstHit.type : '未终止'}）`)
      t.equal(withDet.generation, gens + 200, '应确实跑满一万代（外加预热）')
      t.ok(perGen < 1, `每代额外开销应远小于 1ms，实测 ${perGen.toFixed(3)}ms`)
      t.ok(!!firstHit, '一万代里应当至少命中一次终止条件')
    }
  },
  {
    name: '快照表：CSV 各列数值与引擎统计逐代一致',
    run(t) {
      const e = new LifeEngine(60, 60, { rule: lifeRule(), boundary: 'torus' }).randomize(2024, 0.3)
      const log = new SnapshotLog()
      const { truth } = runWith(e, 120, { log })
      t.equal(log.length, 120, '应记满 120 代')

      const rows = parseCSV(toCSV(log.toArray(), SNAPSHOT_COLUMNS))
      t.equal(rows.length, 120, 'CSV 行数应与快照数一致')
      t.equal(Object.keys(rows[0]).join(','), SNAPSHOT_COLUMNS.join(','), '列名应与规格 3.3 一致')

      // 抽查 3 代，逐列比对
      for (const gen of [1, 60, 120]) {
        const want = truth[gen - 1]
        const got = rows[gen - 1]
        t.equal(Number(got.gen), gen, `第 ${gen} 代的 gen 列`)
        for (const col of SNAPSHOT_COLUMNS) {
          t.equal(Number(got[col]), want[col], `第 ${gen} 代的 ${col} 列`)
        }
      }
    }
  },
  {
    name: '快照表：按规格 3.3 抽稀，最近窗口保持全量',
    run(t) {
      // 缩小参数跑同一套逻辑：上限 500、最近 100 全量、更老的每 10 代留 1 条
      const log = new SnapshotLog({ cap: 500, recentFull: 100, stride: 10 })
      for (let g = 1; g <= 1000; g++) log.push({ gen: g, alive: g, births: 0, deathsLonely: 0, deathsCrowded: 0, activeArea: 0 })

      const all = log.toArray()
      t.ok(log.length < 1000, `总数应小于 1000，实测 ${log.length}`)
      t.equal(log.info.full, 100, '最近窗口应恰好 100 条')

      // 最近 100 代必须一条不落且连续
      const recent = log.recentRows()
      t.equal(recent[0].gen, 901, '最近窗口应从第 901 代开始')
      t.equal(recent[99].gen, 1000, '最近窗口应到第 1000 代')
      for (let i = 1; i < recent.length; i++) {
        t.equal(recent[i].gen - recent[i - 1].gen, 1, '最近窗口必须逐代连续，不能抽稀')
      }

      // 更老的部分只留 10 的倍数
      t.ok(log.archive.length > 0, '应该有归档数据')
      t.ok(log.archive.every(r => r.gen % 10 === 0), '归档里应只剩 10 的倍数')
      t.ok(log.info.thinned > 0, `应如实记录被丢弃的条数，实测 ${log.info.thinned}`)

      // 升序、无重复
      for (let i = 1; i < all.length; i++) t.ok(all[i].gen > all[i - 1].gen, '整体应按代数升序且无重复')
    }
  },
  {
    name: '快照表：总量越界时抽稀粒度自动放大，不突破上限',
    run(t) {
      const log = new SnapshotLog({ cap: 300, recentFull: 100, stride: 10 })
      for (let g = 1; g <= 40000; g++) log.push({ gen: g, alive: 1, births: 0, deathsLonely: 0, deathsCrowded: 0, activeArea: 0 })
      t.ok(log.length <= 300, `总数不应越过上限 300，实测 ${log.length}`)
      t.ok(log.stride > 10, `粒度应已自动放大，实测每 ${log.stride} 代 1 条`)
      t.equal(log.info.full, 100, '不论怎么抽稀，最近窗口始终是全量的')
      t.info(`4 万代压到 ${log.length} 条，粒度 1/${log.stride}，丢弃 ${log.info.thinned} 条`)
    }
  },
  {
    name: '编年史：记下人口峰值、崩塌与终止，且条数有上限',
    run(t) {
      const e = new LifeEngine(80, 80, { rule: lifeRule(), boundary: 'torus' }).randomize(7, 0.35)
      const c = new Chronicle()
      c.reset(80 * 80)
      c.add(0, 'start', { seed: 7 })
      runWith(e, 300, { chronicle: c })
      const types = new Set(c.events.map(ev => ev.type))
      t.ok(types.has('start'), '应有开局事件')
      t.ok(types.has('peak'), '应记下人口峰值')
      t.ok(types.has('collapse'), '密集随机盘会从峰值大幅回落，应记下崩塌')
      t.ok(c.peak > 0 && c.peakGen >= 0, '应保留峰值与它出现的代数')
      // 事件只带 key 与参数，不含任何人类语言
      for (const ev of c.events) {
        t.equal(typeof ev.type, 'string', '事件类型应是 key')
        t.ok(!('text' in ev) && !('message' in ev), '数据层不该产出成句的文案')
      }

      const small = new Chronicle({ max: 10 })
      small.reset(100)
      small.add(0, 'start', {})
      for (let i = 1; i <= 50; i++) small.add(i, 'peak', { alive: i })
      t.equal(small.events.length, 10, '应受条数上限约束')
      t.equal(small.events[0].type, 'start', '关键事件（开局）不该被挤掉')
    }
  },
  {
    name: '台账：按规格 3.4 落一条，备注可改，CSV 列名齐全',
    run(t) {
      const led = new Ledger()
      const row = led.add({
        runId: 'r1', timestamp: '2026-08-29T00:00:00Z', seed: 4271,
        ruleFingerprint: '9eba4f34', ruleNotation: 'B3/S23', boundary: 'torus',
        boardSize: '200x200', initDensity: 0.35, endType: 'cycle', endGen: 1847, peakPop: 14742
      })
      t.equal(row.note, '', '备注默认为空字符串')
      led.updateNote('r1', '这局很有意思, 带"引号"和,逗号')
      t.equal(led.find('r1').note, '这局很有意思, 带"引号"和,逗号', '备注应可回填')

      const csv = toCSV(led.rows, LEDGER_COLUMNS)
      t.equal(csv.split('\n')[0], LEDGER_COLUMNS.join(','), '表头应与规格 3.4 完全一致')
      t.ok(csv.includes('"这局很有意思, 带""引号""和,逗号"'), '含逗号与引号的备注必须被正确转义')

      const back = parseCSV(toCSV(led.rows, LEDGER_COLUMNS))
      t.equal(back.length, 1, '应能读回一行')
      t.equal(back[0].endType, 'cycle', 'endType 应原样保留')
    }
  },
  {
    name: '台账：endType 只用规格 3.4 允许的五个值',
    run(t) {
      const allowed = ['extinction', 'still', 'cycle', 'capped', 'manual']
      // 检测器能产出的四种，加上界面手动结束的一种，恰好覆盖
      const produced = ['extinction', 'still', 'cycle', 'capped']
      for (const p of produced) t.ok(allowed.includes(p), `检测器产出的 ${p} 应在允许集合里`)
      t.equal(allowed.length, 5, '规格 3.4 规定的正是这五个值')
    }
  }
)

/* ================= 界面接线守卫（首位用户报「随机初始化按钮没反应」后补） ================= */

/** 会碰 DOM 的源文件；jsc 没有目录遍历，所以显式列出来 */
const DOM_SOURCES = [
  'src/main.js', 'src/ui/controls.js', 'src/ui/records.js', 'src/ui/library.js',
  'src/ui/intro.js', 'src/ui/rule-editor.js', 'src/ui/input.js', 'src/ui/io.js',
  'src/ui/tower-view.js', 'src/ui/explorer-view.js', 'src/ui/favorites-view.js',
  'src/render/chart.js', 'src/analytics.js'
]

/**
 * 把注释、字符串、正则字面量剥掉，只留真正是代码的部分。
 * 模板字符串里的 ${...} 要保留 —— 界面文案基本都在那儿拼，里面是真代码。
 * 不剥的话误报能淹掉守卫：CSS 里的 rgb(、正则 /^B([0-8]*)\/S([0-8]*)$/ 里的 B( S(，
 * 都会被当成"调用了一个不存在的函数"。
 */
function stripLiterals(src) {
  let out = ''
  let i = 0
  const n = src.length
  const regexAfter = new Set(['=', '(', ',', ':', '[', '!', '&', '|', '?', '{', '}', ';', '\n', '+', '-', '*', '%', '<', '>', '~', '^'])
  const prevSig = () => {
    for (let k = out.length - 1; k >= 0; k--) {
      const c = out[k]
      if (c === ' ' || c === '\t') continue
      return c
    }
    return '\n'
  }
  const prevWord = () => { const m = /([A-Za-z_$][\w$]*)\s*$/.exec(out); return m ? m[1] : '' }
  while (i < n) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue }
    if (c === '/' && d === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; out += ' '; continue }
    if (c === "'" || c === '"') {
      const q = c; i++
      while (i < n && src[i] !== q) { if (src[i] === '\\') i++; i++ }
      i++; out += '""'; continue
    }
    if (c === '`') {
      i++
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2
          let depth = 1, inner = ''
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++
            else if (src[i] === '}') { depth--; if (!depth) break }
            inner += src[i]; i++
          }
          i++; out += '(' + stripLiterals(inner) + ')'
          continue
        }
        i++
      }
      i++; out += '""'; continue
    }
    if (c === '/') {
      const pw = prevWord()
      const isRegex = regexAfter.has(prevSig()) ||
        ['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'instanceof', 'new', 'do', 'else'].indexOf(pw) >= 0
      if (isRegex) {
        i++
        let cls = false
        while (i < n) {
          const ch = src[i]
          if (ch === '\\') { i += 2; continue }
          if (ch === '[') cls = true
          else if (ch === ']') cls = false
          else if (ch === '/' && !cls) break
          else if (ch === '\n') break
          i++
        }
        i++
        while (i < n && /[gimsuyd]/.test(src[i])) i++
        out += ' 0 '; continue
      }
    }
    out += c; i++
  }
  return out
}

/** 一个文件里所有"被声明过"的名字：导入、函数、变量、参数、解构、方法简写 */
function declaredNames(code) {
  const d = {}
  const add = x => { if (x && /^[A-Za-z_$][\w$]*$/.test(x)) d[x] = true }
  const addList = txt => txt.split(',').forEach(part => {
    const m = part.replace(/\.\.\./g, '').split(':').pop().split('=')[0]
    add(m.replace(/[{}[\]\s]/g, ''))
  })
  const each = (re, fn) => { let m; while ((m = re.exec(code)) !== null) fn(m) }
  each(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g, m => add(m[1]))
  each(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, m => add(m[1]))
  each(/\b(?:const|let|var)\s*([{[][\s\S]*?[}\]])\s*=/g, m => addList(m[1]))
  each(/import\s+([\s\S]*?)\s+from/g, m => addList(m[1].replace(/[*]|\bas\b/g, ',')))
  each(/\bfunction\s*[A-Za-z_$\w]*\s*\(([^()]*)\)/g, m => addList(m[1]))
  each(/\(([^()]*)\)\s*=>/g, m => addList(m[1]))
  each(/([A-Za-z_$][\w$]*)\s*=>/g, m => add(m[1]))
  each(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g, m => add(m[1]))
  each(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g, m => add(m[1]))
  // 方法/取值器简写：  name(args) {  —— 是定义，不是调用
  each(/(?:^|[{,;])\s*(?:async\s+|get\s+|set\s+|static\s+)*([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm, m => add(m[1]))
  return d
}

const JS_GLOBALS = ('Math JSON Object Array Number String Boolean Set Map WeakMap WeakSet Date Error TypeError RangeError ' +
  'Promise RegExp Symbol BigInt Proxy Reflect parseInt parseFloat isNaN isFinite encodeURIComponent decodeURIComponent ' +
  'Uint8Array Uint8ClampedArray Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array ' +
  'ArrayBuffer DataView ImageData Worker URL URLSearchParams Blob File FileReader FormData Image Audio ' +
  'document window location navigator console setTimeout clearTimeout setInterval clearInterval ' +
  'requestAnimationFrame cancelAnimationFrame requestIdleCallback fetch alert confirm prompt structuredClone ' +
  'performance localStorage sessionStorage CustomEvent Event MouseEvent KeyboardEvent PointerEvent ' +
  'TextEncoder TextDecoder atob btoa queueMicrotask getComputedStyle matchMedia DOMParser ' +
  'IntersectionObserver ResizeObserver MutationObserver AbortController globalThis self').split(' ')

const JS_KEYWORDS = ('async if for while switch catch return typeof function of in do else new delete void await yield ' +
  'throw case super this import export instanceof let const var class extends try finally break continue default ' +
  'null true false undefined').split(' ')

function readSrc(path) {
  if (typeof readTextFile !== 'function') throw new Error('运行器没有提供 readTextFile')
  return readTextFile(path)
}

cases.push(
  {
    name: '接线：<label> 里不许出现 <button>',
    run(t) {
      // 点 <label> 的文字或留白，浏览器会把「激活」转发给它里面第一个可关联控件。
      // 按钮组一旦被 label 包住，点标题「尺寸」两个字就等于点了第一个按钮 ——
      // 而「100 × 100」会调 engine.resize()，把整盘棋**静默清空**。
      // 这正是布局重构引入的那个 bug，必须钉死。
      const html = readSrc('index.html')
      const offenders = []
      const re = /<label\b[^>]*>([\s\S]*?)<\/label>/g
      let m
      while ((m = re.exec(html)) !== null) {
        if (/<button\b/.test(m[1])) offenders.push(m[0].replace(/\s+/g, ' ').slice(0, 100))
      }
      t.equal(offenders.length, 0,
        `这些 <label> 里包了 <button>，点标签文字会误触第一个按钮：\n  ${offenders.join('\n  ')}`)
    }
  },
  {
    name: '接线：代码里 getElementById 的 id 都在 index.html 里存在',
    run(t) {
      // 布局重构最容易出的事：元素被搬走或改名，绑定悄悄落空，按钮看着在、点了没反应。
      const html = readSrc('index.html')
      const declared = new Set()
      const idRe = /\sid="([^"]+)"/g
      let m
      while ((m = idRe.exec(html)) !== null) declared.add(m[1])
      t.ok(declared.size > 50, `index.html 里应有足够多的 id，实测 ${declared.size}`)

      // 有些节点是代码自己 innerHTML 造出来的（介绍卡的迷你棋盘），也算数
      for (const file of DOM_SOURCES) {
        const src = readSrc(file)
        let d
        const dynRe = /\bid="([A-Za-z][\w-]*)"/g
        while ((d = dynRe.exec(src)) !== null) declared.add(d[1])
      }

      const missing = []
      for (const file of DOM_SOURCES) {
        const src = readSrc(file)
        // 匹配 getElementById('x')、$('x')、querySelector('#x')
        const refRe = /(?:getElementById|\$)\(\s*'([A-Za-z][\w-]*)'\s*\)|querySelector\(\s*'#([\w-]+)'/g
        let r
        while ((r = refRe.exec(src)) !== null) {
          const id = r[1] || r[2]
          if (!declared.has(id)) missing.push(`${file} 引用了不存在的 #${id}`)
        }
      }
      t.equal(missing.length, 0, `绑定落空：\n  ${missing.join('\n  ')}`)
    }
  },
  {
    name: '触控：记账必须延后到收笔，否则回滚只还原了画面',
    run(t) {
      // D67：触控下"这一笔"可能其实是捏合的第一根手指，要能整笔撤销。
      // 但 noteEdit（重置终止检测器）和 markDirtyRun（本局不能再靠种子重放）
      // 这两件事撤不回来 —— 画面还原了、账没还原，等于没回滚。
      // 所以它们只能在收笔时做。这条规矩写在文档里挡不住手滑，所以在这儿查。
      // 含字符串字面量的断言必须查原文：stripLiterals 会把 'erase' 剥成空串，
      // 那样下面那条**否定**断言会假通过 —— 比漏掉更糟。
      const raw = readSrc('src/ui/input.js')
      const src = stripLiterals(raw)
      const fn = name => {
        const i = src.indexOf('function ' + name)
        t.ok(i >= 0, `input.js 里应有 ${name}()`)
        // 粗略取到下一个顶层 function 之前
        const next = src.indexOf('\n  function ', i + 1)
        return src.slice(i, next < 0 ? src.length : next)
      }
      const paint = fn('paintLine')
      t.ok(paint.indexOf('noteEdit') < 0, 'paintLine 里不许直接调 noteEdit —— 那是收笔才做的事')
      t.ok(paint.indexOf('markDirtyRun') < 0, 'paintLine 里不许直接调 markDirtyRun')
      t.ok(paint.indexOf('noteCell') >= 0, 'paintLine 必须逐格记下原值，否则回滚无从谈起')

      const commit = fn('commitStroke')
      t.ok(commit.indexOf('noteEdit') >= 0, 'commitStroke 必须补上 noteEdit')
      t.ok(commit.indexOf('markDirtyRun') >= 0, 'commitStroke 必须补上 markDirtyRun')

      const back = fn('rollbackStroke')
      t.ok(back.indexOf('runDirtyBefore') >= 0, 'rollbackStroke 必须把 runDirty 也还原，不能只还原格子')
    }
  },
  {
    name: '触控：捏合与双指拖的数学（缩放倍率 / 平移量 / 锚点）',
    run(t) {
      // 两指从相距 100 拉到 200，中点不动 ⇒ 放大一倍、不平移
      let d = pinchDelta({ dist: 100, cx: 50, cy: 50 }, { dist: 200, cx: 50, cy: 50 })
      t.equal(d.factor, 2, '距离翻倍应放大一倍')
      t.equal(d.dx, 0, '中点没动就不该平移')
      t.equal(d.dy, 0, '同上')

      // 两指距离不变、整体右下移 ⇒ 纯平移，不缩放
      d = pinchDelta({ dist: 120, cx: 10, cy: 20 }, { dist: 120, cx: 40, cy: 60 })
      t.equal(d.factor, 1, '距离没变就不该缩放')
      t.equal(d.dx, 30, '右移 30')
      t.equal(d.dy, 40, '下移 40')

      // 边捏边挪：两件事必须同时发生，不能二选一 ——
      // 真实的捏合总带着漂移，硬分类会让画面不跟手（D67）
      d = pinchDelta({ dist: 100, cx: 0, cy: 0 }, { dist: 150, cx: 25, cy: -5 })
      t.equal(d.factor, 1.5, '缩放照算')
      t.equal(d.dx, 25, '平移也照算')
      t.equal(d.dy, -5, '同上')

      // 锚点是两指中点，不是画布中心 —— 否则捏哪儿都往中间跑
      t.equal(d.anchorX, 25, '缩放锚点取当前中点 x')
      t.equal(d.anchorY, -5, '缩放锚点取当前中点 y')

      // 首帧没有上一帧，必须是恒等变换，不能把画面弹一下
      d = pinchDelta(null, { dist: 100, cx: 7, cy: 9 })
      t.equal(d.factor, 1, '首帧不缩放')
      t.equal(d.dx, 0, '首帧不平移')
      t.equal(d.anchorX, 7, '首帧锚点仍取中点')
      // 上一帧距离为 0（两指重合）时不能除出 Infinity
      d = pinchDelta({ dist: 0, cx: 0, cy: 0 }, { dist: 50, cx: 0, cy: 0 })
      t.equal(d.factor, 1, '上一帧距离为 0 时必须退化成恒等，不能除出 Infinity')
    }
  },
  {
    name: '触控：落第二指时这一笔是撤销还是保留',
    run(t) {
      // D67：第二根手指永远晚于第一根，所以第一笔总是先画上了。
      // 快 = 用户本来就想捏合，那一小段是误画；慢 = 真画了一笔再想缩放。
      t.equal(strokeVerdict(0), 'rollback', '同时落指必然是捏合')
      t.equal(strokeVerdict(80), 'rollback', '两指落下的实测时间差在 30–80ms 量级')
      t.equal(strokeVerdict(PROMOTE_MS - 1), 'rollback', '窗口内一律撤销')
      t.equal(strokeVerdict(PROMOTE_MS), 'commit', '到点即保留，边界取闭区间的右侧')
      t.equal(strokeVerdict(1200), 'commit', '画了一秒多再捏，画的必须留下')
    }
  },
  {
    name: '介绍卡：走完三幕后棋盘上恰好是一架滑翔机（5 格）',
    run(t) {
      // 用户裁决：第三幕收束到干净起点 —— 清盘再送滑翔机。
      // 这条断言就是"承诺必须兑现"的那把尺子（D70）。
      const e = new LifeEngine(200, 200, { rule: lifeRule(), boundary: 'torus' })
      e.randomize(4271, 0.35)                 // 先摆成首访那样的满盘
      t.ok(e.stats.alive > 10000, `前置：满盘应有上万格，实测 ${e.stats.alive}`)

      const n = placeStarterGift(e)
      t.equal(n, 5, `走完三幕后存活数必须恰为 5，实测 ${n}`)
      t.equal(e.stats.alive, 5, 'engine.stats.alive 也要同步成 5')

      // 不只是"5 格"，还得真的是滑翔机：与图案库里的滑翔机逐格比对
      const g = getPattern('glider')
      const o = centerOrigin(g, 100, 100)
      for (const [x, y] of g.cells) {
        t.equal(e.get(o.x + x, o.y + y), 1, `滑翔机的 (${x},${y}) 应当是活的`)
      }

      // 空盘上再送一次，结果一样 —— 契约与盘上原有内容无关
      const e2 = new LifeEngine(60, 60, { rule: lifeRule(), boundary: 'dead' })
      t.equal(placeStarterGift(e2), 5, '空盘上送出的也必须恰好是 5 格')

      // 它自己会清盘，不依赖调用方先清
      const e3 = new LifeEngine(60, 60, { rule: lifeRule(), boundary: 'dead' })
      e3.randomize(99, 0.5)
      t.equal(placeStarterGift(e3), 5, '满盘直接送，也必须只剩 5 格 —— 说明它自带清盘')
    }
  },
  {
    name: '文案对账：承诺型文案与兑现它的动作必须同为无条件（D70 盲区的可查部分）',
    run(t) {
      // 这颗雷的成因：文案无条件写着"这就给你放一个…"，动作却带着 if。
      // 承诺与兑现分处两个函数，从没对过账。
      // 「文案是否承诺了某个行为」一般来说静态查不出来，所以这里维护一张**显式清单**：
      // 每一对"承诺型词条 ↔ 兑现它的调用"都登记在案，两边的条件必须对齐。
      // 新增这类文案时要往清单里加 —— 清单本身就是这条守卫的边界，见 D70。
      const PROMISES = [
        {
          key: 'intro.act3.gift',       // 「这就给你放一个『会走路的小家伙』」
          renderer: 'act3',             // 渲染这句话的函数
          fulfiller: 'finish',          // 兑现它的函数
          call: 'placeStarterGift'      // 兑现动作
        }
      ]
      const src = stripLiterals(readSrc('src/ui/intro.js'))
      const bodyOf = name => {
        const i = src.indexOf('function ' + name)
        t.ok(i >= 0, `intro.js 里应有 ${name}()`)
        const next = src.indexOf('\n  function ', i + 1)
        return src.slice(i, next < 0 ? src.length : next)
      }
      const raw = readSrc('src/ui/intro.js')

      for (const p of PROMISES) {
        t.ok(raw.indexOf(p.key) >= 0, `${p.renderer} 应当渲染 ${p.key}`)

        const fulfil = bodyOf(p.fulfiller)
        t.ok(fulfil.indexOf(p.call) >= 0, `${p.fulfiller}() 必须调用 ${p.call}`)

        // 核心判据：兑现动作前面不许有 if —— 文案是无条件说的，动作就得无条件做
        const before = fulfil.slice(0, fulfil.indexOf(p.call))
        t.ok(!/\bif\s*\(/.test(before),
          `${p.call} 前面出现了 if：文案 ${p.key} 是无条件承诺的，兑现却带条件 —— ` +
          '这正是首访时那句话从未兑现的成因')
      }
    }
  },
  {
    name: '手机控制区：六行结构与主次比（D74）',
    run(t) {
      const css = readSrc('src/style.css')
      const html = readSrc('index.html')

      // ---- 行结构：每一行都在它该在的网格行，且都铺满两列 ----
      const atRow = (re, n, what) =>
        t.ok(re.test(css), `${what} 应当在第 ${n} 行且 grid-column: 1 / -1 铺满`)
      atRow(/\.stage \{[^}]*grid-row:\s*2;\s*grid-column:\s*1 \/ -1/, 2, '棋盘')
      atRow(/\.tb-run \{[^}]*grid-row:\s*3;\s*grid-column:\s*1 \/ -1/, 3, '主控排')
      atRow(/\.tb-left \{[^}]*grid-row:\s*4;\s*grid-column:\s*1 \/ -1/, 4, '配角排')
      t.ok(/\.toolrail, \.strip \{[^}]*grid-row:\s*5;\s*grid-column:\s*1 \/ -1/.test(css),
        '取用区（图案与世界共用）在第 5 行且铺满')
      t.ok(/grid-template-rows:\s*auto 1fr auto auto auto/.test(css),
        '余量必须给棋盘（第 2 行 1fr），不给玩具盒 —— 列表拿到非整数行必然截断')

      // ---- 桌面遗留属性：那句 margin-left:auto 必须被显式清掉 ----
      // 它是"运行排左侧 8px 黑缺口"的成因：网格项带 auto 外边距会缩成内容宽并右推。
      const runRule = /\.tb-run \{([\s\S]*?)\}/g
      let m, cleared = false
      while ((m = runRule.exec(css)) !== null) if (/margin:\s*0/.test(m[1])) cleared = true
      t.ok(cleared, '.tb-run 在窄屏必须显式 margin: 0，否则桌面的 margin-left:auto 会漏进来')

      // ---- 主次比：配角必须窄于主键 ----
      // 宽度由 flex 比例决定，可以直接算：
      //   主控排 = 播放 flex 62 : 速度 flex 38，间距 8
      //   配角排 = 三等分，两个间距 8
      const PAD = 12, GAP = 8
      t.ok(/#btn-play \{[^}]*flex:\s*62 1 0/.test(css), '播放占 flex 62')
      t.ok(/\.tb-speed \{[^}]*flex:\s*38 1 0/.test(css), '速度占 flex 38')
      t.ok(/\.tb-left > button \{[^}]*flex:\s*1 1 0/.test(css), '三个配角等宽')
      for (const W of [320, 375, 390, 430]) {
        const avail = W - PAD * 2
        const play = (avail - GAP) * 62 / 100
        const secondary = (avail - GAP * 2) / 3
        const ratio = secondary / play
        t.ok(ratio < 1, `${W}px 下配角/主键宽比应 <1，算得 ${ratio.toFixed(3)}`)
        t.ok(ratio < 0.75, `${W}px 下差距要够明显（<0.75），算得 ${ratio.toFixed(3)}`)
      }
      // 主角在高度上也要拉开
      t.ok(/#btn-play \{[^}]*min-height:\s*56px/.test(css), '主键 56px')
      t.ok(/\.tb-left > button \{[^}]*min-height:\s*44px/.test(css), '配角 44px，且不缩水')

      // ---- 取用区高度必须是整数张卡片，不许再取 1fr ----
      t.ok(/\.toolrail, \.strip \{[^}]*height:\s*77px/.test(css),
        '取用区一排：77px（60 卡片 + 16 内边距 + 1 上边框）')
      t.ok(!/min-height:\s*750px\)/.test(css),
        '高屏两排的分支必须已取消 —— 一排横滑 / 两排换行是两套姿势，违反「同类同形」（D75 ①）')

      // ---- 配角排是纯文案，不用 emoji（跨机型渲染不一致） ----
      const secBlock = /<button id="btn-step-m"[\s\S]*?<button id="btn-clear"[^>]*>[^<]*<\/button>/.exec(html)
      t.ok(!!secBlock, '配角排三颗按钮应当挨在一起')
      t.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(secBlock[0]),
        `配角排不许出现 emoji：${secBlock[0].replace(/\s+/g, ' ').slice(0, 120)}`)

      // ---- 短文案：配角用两字，且中英两语两语域齐备 ----
      for (const lang of ['zh', 'en']) {
        t.ok(typeof DICT[lang]['ctrl.fitShort'] === 'string', `${lang} 缺 ctrl.fitShort`)
        t.ok(typeof DICT[lang]['ctrl.fitShort.simple'] === 'string', `${lang} 缺 ctrl.fitShort.simple`)
      }
      t.equal(DICT.zh['ctrl.fitShort'], '适配', '中文配角短文案两字')

      // 页签短词条：与「世界」/Worlds 对齐节奏；「图案盒子」保留
      t.equal(DICT.zh['pattern.tab'], '图案', '中文页签两字')
      t.equal(DICT.en['pattern.tab'], 'Patterns', '英文页签与 Worlds 对齐')
      t.equal(DICT.zh['pattern.tab.simple'], '玩具', '简洁语域页签两字')
      t.equal(DICT.en['pattern.tab.simple'], 'Toys', '简洁语域英文页签')
      t.ok(typeof DICT.zh['pattern.section'] === 'string' && typeof DICT.en['pattern.section'] === 'string',
        '「图案盒子」词条保留（按用户要求留作提示用），不许顺手删掉')
      t.ok(readSrc('index.html').indexOf('data-i18n="pattern.tab"') >= 0, '页签必须改用短词条')

      // 语义修正不分语言：中文简洁语域是「返回」，英文不能还停在 Find it
      t.equal(DICT.zh['ctrl.fitShort.simple'], '返回', '中文简洁语域')
      t.equal(DICT.en['ctrl.fitShort.simple'], 'Go back', '英文简洁语域须与中文同义')
    }
  },
  {
    name: '取用区：同类同形、自我宣告、位置恒定（D75 三条原则）',
    run(t) {
      const css = readSrc('src/style.css')

      // ---- ① 同类同形：图案与世界必须共用同一套卡片规则 ----
      // 它们曾经一个是版面内横排、一个是 fixed 竖向浮层，同一类东西两套姿势。
      t.ok(/\.toolrail, \.strip \{/.test(css),
        '图案与世界必须写在同一条规则里 —— 分开写迟早又长成两套')
      t.ok(/\.toolrail \.card, \.strip \.card, \.strip \.card\.world \{/.test(css),
        '两处的卡片必须共用同一条尺寸规则（含 .card.world，它桌面上是 200px 宽的特例）')
      t.ok(/\.toolrail \.rail-list, \.strip \.strip-list \{[^}]*flex-flow:\s*row nowrap/.test(css),
        '两处必须同为横向单排 —— 排列方向是「同形」的第一要素')
      // 世界横条曾是 fixed 浮层，钉住不许退回去
      t.ok(/\.toolrail, \.strip \{[^}]*position:\s*static/.test(css),
        '窄屏下取用区必须在版面内（position: static），不许再做成浮层')
      // 滚动机制也必须同一套：桌面上世界横条滚的是内层列表，玩具盒滚的是容器 ——
      // 同样的外观、两套机制，是「同类同形」更隐蔽的一种违反
      t.ok(/\.strip \.card-list \{[^}]*overflow-x:\s*visible/.test(css),
        '窄屏必须把世界横条的内层滚动关掉，统一由容器滚')

      // ---- ② 自我宣告：末张露出的比例与屏宽无关 ----
      const m = /\.toolrail \.card, \.strip \.card[^{]*\{[^}]*flex:\s*0 0 calc\(\(100% - (\d+)px\) \/ ([\d.]+)\)/.exec(css)
      t.ok(!!m, '卡片宽度必须按容器取分数（calc((100% - Npx) / K)），靠调 padding 撞不准这个比例')
      const gapTotal = Number(m[1]), K = Number(m[2])
      const GAP = 8, PAD = 12
      for (const W of [320, 375, 390, 430]) {
        const inner = W - PAD * 2
        const card = (inner - gapTotal) / K
        // 第 4 张的左边缘 = 3 张卡片 + 3 个间距
        const fourthLeft = card * 3 + GAP * 3
        const visible = (inner - fourthLeft) / card
        t.ok(visible > 0.25 && visible < 0.5,
          `${W}px 下末张应露出 25%–50%，算得 ${(visible * 100).toFixed(0)}%`)
      }

      // ---- ③ 位置恒定：高频控件与取用区的 grid-row 是常量 ----
      // 清空搬过三次位置、玩具盒换过三种形态，每换一次用户重新学一次。
      // 这几条断言就是"以后要动得先过我"。
      const rowIs = (re, what) => t.ok(re.test(css), `${what} 的 grid-row 必须是常量`)
      rowIs(/\.tb-run \{[^}]*grid-row:\s*3;/, '主控排')
      rowIs(/\.tb-left \{[^}]*grid-row:\s*4;/, '配角排')
      rowIs(/\.toolrail, \.strip \{[^}]*grid-row:\s*5;/, '取用区')
      // grid-row 只能出现这几个固定值，不许被别的规则改写
      const rows = (css.match(/grid-row:\s*\d+/g) || []).filter(x => /grid-row:\s*[345]/.test(x))
      t.equal(rows.length, 3, `第 3/4/5 行各应只被声明一次，实测 ${rows.join('、')}`)

      // ---- 页签定在顶栏：低频动作不向主视觉收高度税 ----
      // 第 1 行即顶栏。列号从 2 改成 1/3 是因为窄屏不再显示品牌（第三个页签挤掉了它），
      // 但"页签属于顶栏、不占取用区上方"这条不变 —— 那才是这条守卫护的东西。
      t.ok(/\.tb-tabs \{[^}]*grid-row:\s*1;/.test(css),
        '页签在顶栏那一行 —— 放取用区正上方要吃掉 SE 上棋盘 14% 的面积')
      const html = readSrc('index.html')
      const group = /<div class="tb-more-group"[\s\S]*?\n      <\/div>/.exec(html)
      t.ok(!!group && group[0].indexOf('tb-tabs') < 0,
        '页签必须已移出「更多」组 —— 藏在里面时它的出现位置取决于展开状态')

      // ---- 切换只换内容：动画存在且尊重 reduced-motion ----
      t.ok(/@keyframes pickerIn/.test(css), '切换页签应有轻微滑入')
      t.ok(/prefers-reduced-motion: reduce\)\s*\{[\s\S]{0,200}?animation:\s*none/.test(css),
        'reduced-motion 下必须关掉动画')

      // ---- 取用区的开关在任何模式下都必须可见（窄屏）----
      // 简洁模式默认藏掉 data-mode="full"，而这两个页签是取用区唯一的开关。
      // D75 把两者改成互斥之后，藏掉「图案」就等于：儿童版用户点了「世界」再也回不去玩具盒。
      // 互斥之前玩具盒是常驻的，藏掉开关无所谓 —— 这个陷阱是互斥带来的连带后果。
      t.ok(/body\.mode-simple \.tb-tabs \[data-mode="full"\] \{ display: block !important; \}/.test(css),
        '窄屏简洁模式必须把「图案」页签顶回来，否则取用区是单向的')

      // ---- 互斥且恒有其一（窄屏） ----
      const ctl = readSrc('src/ui/controls.js')
      t.ok(/app\.setPicker = function \(name\)/.test(ctl), '应有 setPicker')
      t.ok(/app\.setRail\(name === 'pattern'\)[\s\S]{0,80}app\.setWorlds\(name === 'world'\)/.test(ctl),
        'setPicker 必须让两者互斥')
      t.ok(/NARROW\.matches/.test(ctl), '窄屏与桌面的取用区语义不同，需按断点分流')
    }
  },
  {
    name: '样式：按钮一律不折行，且多行卡片有例外（D73）',
    run(t) {
      // 「停一下」被断成两行（外部用户实测）：中文没有空格，浏览器可在任意两字间断行。
      // 修法是 button 全局 nowrap —— 这条守卫钉的就是那个修法本身。
      const css = readSrc('src/style.css')
      // 必须锚在行首：\bbutton 会先命中 .topbar button {…} 之类的派生规则
      const base = /^button\s*\{([\s\S]*?)\}/m.exec(css)
      t.ok(!!base, 'style.css 里应有 button 的基础规则')
      t.ok(/white-space:\s*nowrap/.test(base[1]),
        'button 基础规则里必须有 white-space: nowrap，否则中文按钮会被断行')

      // 但一刀切会把玩具卡片变成横向溢出 —— 从"难看"换成"看不全"，更糟。
      // 卡片本来就是多行块（72–84px 宽，要放「A little guy that walks」这种名字）。
      t.ok(/\.card,\s*\.pick-card,\s*\.preset\s*\{[^}]*white-space:\s*normal/.test(css),
        '.card / .pick-card / .preset 必须保留折行 —— 它们是多行卡片，不是单行动作按钮')
    }
  },
  {
    name: '文案：按钮词条长度上限（跑偏预警，不是折行守卫）',
    run(t) {
      // 说清楚这条管什么：它**抓不到**「停一下」那个 bug —— 那条文案宽度才 6，
      // 问题出在 CSS 不在文案。这条管的是另一件事：有人往按钮里塞一整句话。
      // 上限取 32：当前最宽的是 en 的 board.dead（29，侧栏整行按钮，显示正常），
      // 留一点余量，够拦住离谱的，不至于把正常的误伤。
      const LIMIT = 32
      const html = readSrc('index.html')
      const keys = {}
      const re = /<button\b[^>]*\sdata-i18n="([^"]+)"/g
      let m
      while ((m = re.exec(html)) !== null) keys[m[1]] = true
      // 从 index.html 扫，新增按钮自动纳入，不用维护清单。
      // 只有标签由 JS 换掉的那几个扫不到，单列在这里。
      for (const k of ['ctrl.pause', 'intro.start', 'intro.next', 'intro.back', 'intro.close']) keys[k] = true

      const n = Object.keys(keys).length
      t.ok(n > 30, `应当扫到足够多的按钮词条，实测 ${n}`)

      // 显示宽度：中日韩字符占两个西文字宽
      const width = str => {
        let w = 0
        for (const ch of String(str)) w += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1
        return w
      }
      const over = []
      for (const k of Object.keys(keys)) {
        for (const lang of ['zh', 'en']) {
          for (const suffix of ['', '.simple']) {
            const v = DICT[lang][k + suffix]
            if (typeof v !== 'string') continue
            const w = width(v)
            if (w > LIMIT) over.push(`${lang} ${k}${suffix}（宽 ${w}）= ${v}`)
          }
        }
      }
      t.equal(over.length, 0, `这些按钮文案超过 ${LIMIT} 个字宽：\n  ${over.join('\n  ')}`)
    }
  },
  {
    name: '接线：窄屏的「适配视图」与桌面那颗同属救援档，且各自只出现一次',
    run(t) {
      // 外部用户反馈：双指操作后棋盘易飞出视野，找回视图是高频救援动作。
      const html = readSrc('index.html')
      t.ok(/<button id="btn-fit"[^>]*class="rescue"/.test(html) ||
           /<button id="btn-fit" class="rescue"/.test(html),
        '桌面那颗「适配视图」应归入 rescue 档 —— 语义色若只在手机上成立就不叫语义')
      t.ok(/<button id="btn-fit-m"[^>]*class="rescue"/.test(html),
        '窄屏那颗也是 rescue 档')

      // 两颗共用同一批词条，不新增文案
      const fitKeys = (html.match(/id="btn-fit[^"]*"[^>]*data-i18n="([^"]+)"/g) || [])
      t.equal(fitKeys.length, 2, `应当正好两颗「适配视图」，实测 ${fitKeys.length}`)
      t.ok(html.indexOf('id="btn-fit-m"') >= 0 && html.indexOf('id="btn-fit"') >= 0, '两个 id 都要在')

      // 救援色必须与红/绿/橙都不同（D72 的语义表）
      const css = readSrc('src/style.css')
      const pick = sel => {
        const m = new RegExp('button\\.' + sel + '\\s*\\{([\\s\\S]*?)\\}').exec(css)
        return m ? (/background:\s*([^;]+);/.exec(m[1]) || [])[1] : null
      }
      const colors = { rescue: pick('rescue'), danger: pick('danger'), running: pick('running'), primary: pick('primary') }
      for (const k of Object.keys(colors)) t.ok(!!colors[k], `button.${k} 应当定义了背景色`)
      const vals = Object.values(colors).map(v => v.trim())
      t.equal(new Set(vals).size, vals.length, `四个语义档的底色必须互不相同，实测 ${JSON.stringify(colors)}`)

      // 两颗按钮走同一个动作，不另写逻辑
      const ctl = readSrc('src/ui/controls.js')
      t.ok(/btn-fit-m'\)\.addEventListener\('click', \(\) => app\.fitView\(\)\)/.test(ctl),
        '窄屏那颗必须直接调 app.fitView()，不另起一套')
    }
  },
  {
    name: '接线：开局状态按首访/回访分流，清空不许藏进「更多」',
    run(t) {
      // D69：回访者的实际动作是"先清空再开始"，所以回访开空盘。
      const main = readSrc('src/main.js')
      t.ok(/const firstVisit = prefs\.get\('introSeen'\) !== '1'/.test(main),
        '开局状态应由 introSeen 决定，而不是别开一个偏好键')
      t.ok(/if \(firstVisit\) app\.engine\.randomize\(/.test(main),
        '随机填充只在首访执行；回访不填充')
      // 空盘不能有种子语义：开机仍不许回填种子框（原有守卫也在管这条，这里再钉一次动机）
      t.ok(!/el\.seed\.value\s*=/.test(main), '开机不许回填种子框')

      // 清空是高频动作，必须在常驻区，不能是「更多」浮层的子元素
      const html = readSrc('index.html')
      const group = /<div class="tb-more-group"[\s\S]*?\n      <\/div>/.exec(html)
      t.ok(!!group, 'index.html 里应有「更多」组')
      t.ok(group[0].indexOf('btn-clear') < 0,
        '清空不许放在「更多」组里 —— 手机上误画频繁，它是高频动作')
      t.ok(html.indexOf('id="btn-clear"') >= 0, '清空按钮本身要还在')
    }
  },
  {
    name: '接线：页面必须声明网站图标，且文件存在',
    run(t) {
      // 不声明的话浏览器会去要 /favicon.ico，控制台一条 404。公网首验看到的就是这条。
      const html = readSrc('index.html')
      const m = /<link[^>]*rel="icon"[^>]*>/.exec(html)
      t.ok(!!m, 'index.html 应声明 rel="icon"')
      const href = /href="([^"]+)"/.exec(m[0])
      t.ok(!!href, '图标声明里应有 href')
      // 相对路径 —— 站点发布在 用户名.github.io/<仓库名>/ 下，绝对路径会 404
      t.ok(href[1].charAt(0) !== '/', `图标路径要用相对路径，实测 ${href[1]}`)
      const svg = readSrc('public' + href[1].replace(/^\./, ''))
      t.ok(svg.indexOf('<svg') >= 0, '图标文件应是一个 svg')
    }
  },
  {
    name: '接线：事件回调里引用的函数必须真的存在（公网 bug 后补）',
    run(t) {
      // 2026-08-29 公网首验炸的就是这条路径：
      // 第零幕改动时把 pageCount() 换成了 pageList()，漏了 nextBtn 回调里的那一处。
      // 三个环境（dev / 打包产物 / 线上）全都炸，本地没发现纯粹是因为**没人点过那个按钮**。
      // 见 docs/decisions.md D65。
      //
      // 判据：文件里以 name( 形式调用的名字，必须是本文件声明过的、或者已知全局。
      // 压缩器的行为反过来印证了这一点 —— 产物里 page/nextBtn/finish 全被改名，
      // 唯独 pageCount 原样保留，因为压缩器找不到它的声明，只能当全局放过。
      const known = {}
      for (const g of JS_GLOBALS) known[g] = true
      for (const k of JS_KEYWORDS) known[k] = true

      const offenders = []
      for (const file of DOM_SOURCES) {
        const code = stripLiterals(readSrc(file))
        const declared = declaredNames(code)
        const seen = {}
        const re = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g
        let m
        while ((m = re.exec(code)) !== null) {
          const name = m[2]
          if (known[name] || declared[name] || seen[name]) continue
          seen[name] = true
          offenders.push(`${file} 调用了没有声明的 ${name}()`)
        }
      }
      t.equal(offenders.length, 0, `引用落空：\n  ${offenders.join('\n  ')}`)
    }
  },
  {
    name: '介绍卡翻页：四种页序下每一页点「下一幕」的去向',
    run(t) {
      // 翻页逻辑原本写在 DOM 回调里，这个项目的测试没有 DOM，回调体一行都跑不到 ——
      // 于是里面同时藏了两个 bug 上了线。现在逻辑搬进纯函数，这里把每条路径都走一遍。
      const expect = [
        // [有没有第零幕, 模式, 期望页序, 每一页点「下一幕」的去向]
        [true, 'simple', ['act0', 'act1', 'act2', 'act3'], [1, 2, 3, 'finish']],
        [true, 'full', ['act0', 'act1', 'act2', 'act3', 'helpAge', 'helpBS', 'helpSave'], [1, 2, 3, 'finish', 5, 6, 'close']],
        [false, 'simple', ['act1', 'act2', 'act3'], [1, 2, 'finish']],
        [false, 'full', ['act1', 'act2', 'act3', 'helpAge', 'helpBS', 'helpSave'], [1, 2, 'finish', 4, 5, 'close']]
      ]
      for (const [chooser, mode, pages, nexts] of expect) {
        const list = introPages({ chooser, mode })
        t.equal(list.join(','), pages.join(','), `chooser=${chooser} mode=${mode} 的页序`)
        for (let i = 0; i < list.length; i++) {
          t.equal(String(introNext(list, i)), String(nexts[i]),
            `chooser=${chooser} mode=${mode}：第 ${i} 页（${list[i]}）点下一幕`)
        }
      }

      // 第二个 bug 是写死的下标 page === 2：带第零幕时第三幕在 3 号位，
      // 会在第二幕就误触「开始玩」。这里正面钉一次。
      const withZero = introPages({ chooser: true, mode: 'simple' })
      t.equal(introNext(withZero, 2), 3, '带第零幕时，第 2 页（第二幕）应该翻到下一页而不是收尾')
      t.equal(introNext(withZero, 3), 'finish', '第 3 页才是第三幕')
    }
  },
  {
    name: '精确档：滑块数值输入的钳位（D80 ①）',
    run(t) {
      const speed = { min: '1', max: '60', step: '1', value: '10' }
      const density = { min: '0.05', max: '0.6', step: '0.01', value: '0.35' }

      // 越界钳到合法范围，不是拒绝
      t.equal(clampToRange('999', speed), 60, '超上限钳到 max')
      t.equal(clampToRange('-5', speed), 1, '低于下限钳到 min')
      t.equal(clampToRange('7', speed), 7, '合法值原样')
      // 按步长对齐；顺序必须是"先对齐再钳位"，反了会在 max 不是整步长时越界
      t.equal(clampToRange('3.7', speed), 4, '按步长对齐')
      // 小数步长要收敛小数位，否则 0.35+0.01 那类浮点误差会漏进界面
      t.equal(clampToRange('0.427', density), 0.43, '小数步长对齐并收敛位数')
      t.equal(clampToRange('2', density), 0.6, '密度超上限')
      t.equal(clampToRange('0', density), 0.05, '密度低于下限')
      // 不是数字就当作没改过，而不是回落成 0 —— 回落成 0 会静默毁掉用户的设置
      t.equal(clampToRange('abc', speed), null, '非数字返回 null')
      t.equal(clampToRange('', speed), null, '空串返回 null')

      // 12 个滑块全部登记；新增滑块必须登记，否则这条会红
      const html = readSrc('index.html')
      const ranges = (html.match(/<input[^>]*type="range"[^>]*>/g) || [])
        .map(tag => (/id="([^"]+)"/.exec(tag) || [])[1]).filter(Boolean)
      t.equal(ranges.length, NUMERIC_SLIDERS.length,
        `index.html 里有 ${ranges.length} 个滑块，登记了 ${NUMERIC_SLIDERS.length} 个 —— 数目必须一致`)
      const registered = {}
      for (const [r, l] of NUMERIC_SLIDERS) {
        registered[r] = true
        t.ok(html.indexOf('id="' + l + '"') >= 0, `标签 #${l} 必须存在`)
      }
      for (const id of ranges) t.ok(registered[id], `滑块 #${id} 没有登记数值输入`)

      // 取值以滑块为准，不解析标签文字 —— 有几个标签根本不是纯数字
      const src = readSrc('src/ui/numeric-entry.js')
      t.ok(/input\.value = toDisplay\(range\.value\)/.test(src),
        '编辑框的初值应取自滑块（可经 toDisplay 换算），不是解析标签文字（拖尾显示「短/中/长」，解析必崩）')
      t.ok(/dispatchEvent\(new Event\('input'/.test(src),
        '提交后要派发 input 事件，让既有监听器照常更新 —— 不复制一份更新逻辑')
      t.ok(/inputMode = 'decimal'/.test(src), '手机上要唤起数字键盘')
    }
  },
  {
    name: '精确档：图案方向键微调（D80 ③）',
    run(t) {
      const W = 200, H = 120
      t.equal(JSON.stringify(nudgeCell({ x: 10, y: 10 }, 'ArrowRight', W, H)), '{"x":11,"y":10}', '右')
      t.equal(JSON.stringify(nudgeCell({ x: 10, y: 10 }, 'ArrowLeft', W, H)), '{"x":9,"y":10}', '左')
      t.equal(JSON.stringify(nudgeCell({ x: 10, y: 10 }, 'ArrowUp', W, H)), '{"x":10,"y":9}', '上')
      t.equal(JSON.stringify(nudgeCell({ x: 10, y: 10 }, 'ArrowDown', W, H)), '{"x":10,"y":11}', '下')
      // 边界钳位：不许走出棋盘
      t.equal(JSON.stringify(nudgeCell({ x: 0, y: 0 }, 'ArrowLeft', W, H)), '{"x":0,"y":0}', '左边界钳住')
      t.equal(JSON.stringify(nudgeCell({ x: 0, y: 0 }, 'ArrowUp', W, H)), '{"x":0,"y":0}', '上边界钳住')
      t.equal(JSON.stringify(nudgeCell({ x: 199, y: 119 }, 'ArrowRight', W, H)), '{"x":199,"y":119}', '右边界钳住')
      t.equal(JSON.stringify(nudgeCell({ x: 199, y: 119 }, 'ArrowDown', W, H)), '{"x":199,"y":119}', '下边界钳住')
      // 非方向键返回 null，调用方据此放行给别的快捷键
      t.equal(nudgeCell({ x: 5, y: 5 }, 'Enter', W, H), null, '回车不是方向键')
      t.equal(nudgeCell({ x: 5, y: 5 }, 'a', W, H), null, '普通字母不是方向键')

      // 幽灵脱离鼠标：一按方向键就钉在 stampAt，否则鼠标一动就把微调抹掉
      const inp = readSrc('src/ui/input.js')
      t.ok(/app\.armStampAt\(next\)/.test(inp),
        '方向键把位置钉进**同一个**待放态状态源 —— 桌面钉住与触屏摆放本来就是同一件事（D90 §4）')
      const main = readSrc('src/main.js')
      t.ok(/const gc = app\.pendingStamp \|\| app\.hoverCell/.test(main),
        '幽灵优先用钉住的位置（待放态），其次才跟鼠标')
      t.ok(/app\.cancelPending\(\{ keepRef: true \}\)/.test(main),
        '换图案要解除钉住，但参照线留着 —— 拿起下一个图案正是要拿它来对（D91）')

      // ② 坐标读数：必须单独刷新，不能只等 updateHud
      t.ok(/app\.updateHoverReadout = function/.test(main), '坐标读数应有独立的刷新函数')
      t.ok(/app\.updateHoverReadout\(\)/.test(inp), 'pointermove 上必须刷新坐标，否则"实时"是假的')
      t.ok(/app\.stampAnchor\(\) \|\| app\.hoverCell/.test(main),
        '选中图案时显示幽灵锚点，不是光标格 —— 放置对齐的是锚点')
    }
  },
  {
    name: '触控擦除：点击取反，整笔方向由起笔格定（D78）',
    run(t) {
      // 含字符串字面量的断言必须查原文：stripLiterals 会把 'erase' 剥成空串，
      // 那样下面那条**否定**断言会假通过 —— 比漏掉更糟。
      const raw = readSrc('src/ui/input.js')
      const src = stripLiterals(raw)

      // ---- 写入值必须在落指时定下，整笔沿用 ----
      // 逐格取反会让划过混合区域变成"翻转花纹"，既不可预测也没人想要。
      t.ok(/const value = strokeValue/.test(src),
        'paintLine 的写入值必须来自落指时定下的 strokeValue')
      t.ok(!/const value = mode === 'erase' \? 0 : 1/.test(raw),
        'paintLine 里不许再就地按 mode 判断 —— 那样触控就没有擦除的入口')

      // ---- 触控取反、桌面按键，两条分支都要在 ----
      t.ok(/strokeValue = isTouch\(e\) \? valueFromCell\(c\) : \(mode === 'erase' \? 0 : 1\)/.test(raw),
        '触控读起笔格取反，桌面仍由按键决定 —— 桌面左键改成取反会是未被要求的行为变更')
      t.ok(/function valueFromCell/.test(src), '应有起笔格取值函数')
      // 起笔格在盘外时取"画"：盘外无活格可言，取反无从谈起
      t.ok(/if \(!inside\) return 1/.test(src), '起笔格在盘外时一律取「画」')
      t.ok(/app\.engine\.get\(c\.x, c\.y\) === 1 \? 0 : 1/.test(src), '盘内按活/空取反')

      // ---- 与回滚窗口正交：回滚记的是原值，不关心这一笔写 1 还是 0 ----
      t.ok(/app\.engine\.set\(c\[0\], c\[1\], c\[2\]\)/.test(src),
        '回滚必须写回记录的原值 —— 这样它对「画」和「擦」一视同仁，无需为取反改动')
      // 不许为了取反去动 250ms 窗口
      t.ok(/strokeVerdict\(now\(\) - firstTouchAt\) === 'rollback'/.test(raw),
        '回滚判定仍走 strokeVerdict，窗口值不因取反而变')

      // ---- 无模式、无开关（先声明模式已被否决两次）----
      const html = readSrc('index.html')
      t.ok(!/id="btn-eras|data-tool="eras|id="btn-brush/.test(html),
        '不许加橡皮擦工具按钮或画笔模式开关 —— 「先声明模式再操作」已被否决两次')
    }
  },
  {
    name: '浮层层级表与规则编辑器窄屏（D79）',
    run(t) {
      const css = readSrc('src/style.css')

      // ---- 层级表：数字大的永远压小的 ----
      // 原来是倒置的：.modal 50 < .panel 55 < .tb-more-group 60，抽屉能盖住规则编辑器。
      const z = (re, what) => {
        const m = re.exec(css)
        t.ok(!!m, `找不到 ${what} 的 z-index`)
        return m ? Number(m[1]) : NaN
      }
      const modal = z(/\.modal \{[^}]*z-index:\s*(\d+)/, '模态')
      const tower = z(/\.tower-view \{[^}]*z-index:\s*(\d+)/, '全屏视图')
      const more = z(/\.tb-more-group \{[^}]*z-index:\s*(\d+)/, '「更多」')
      const panel = z(/\.panel \{[^}]*z-index:\s*(\d+)/, '抽屉')
      t.equal(modal, 80, '模态层 80')
      t.equal(tower, 60, '全屏视图层 60')
      t.equal(more, 41, '「更多」41')
      t.equal(panel, 40, '抽屉 40')
      t.ok(modal > tower, '模态必须压住全屏视图 —— 从观塔里弹出的确认框否则点不到')
      t.ok(tower > more && more > panel, '全屏视图 > 常驻浮层；「更多」固定在抽屉之上，不靠 DOM 顺序碰运气')

      // ---- 规则编辑器窄屏：单栏铺满 ----
      // 两栏 300px + 1fr 塞不进 375（实测自身溢出 39、内部 21 处、最大 213）
      t.ok(/#rule-modal \.modal-body \{[^}]*grid-template-columns:\s*1fr/.test(css),
        '窄屏下规则编辑器必须单栏')
      t.ok(/#rule-modal \.modal-box \{[^}]*height:\s*100dvh/.test(css), '窄屏下铺满整屏')
      t.ok(/#rule-modal \.modal-foot \{[^}]*flex-wrap:\s*wrap/.test(css),
        '页脚四个按钮在 375 上排不下，必须可换行')
      t.ok(/#rule-modal \.modal-foot button \{[^}]*min-width:\s*0/.test(css),
        '桌面的 min-width: 88px 会让页脚在窄屏溢出，必须覆盖')
      // 打开时收起常驻浮层 —— 模态本来就压在它们之上，但退出后不该撞见半开的抽屉
      t.ok(/classList\.remove\('drawer-open', 'more-open'\)/.test(readSrc('src/ui/rule-editor.js')),
        '打开规则编辑器时应收起抽屉与「更多」')

      // ---- 浮层触控目标 44px ----
      t.ok(/\.tb-more-group \.seg button,[\s\S]{0,120}?min-height:\s*44px/.test(css),
        '「更多」里的分段开关被别处压到 40px，需用更高特异度顶回 44')
    }
  },
  {
    name: '浮层排查第一批：缩放上限、顶栏对齐、总结卡片按钮（D77）',
    run(t) {
      const css = readSrc('src/style.css')
      const ctl = readSrc('src/ui/controls.js')
      const rec = readSrc('src/ui/records.js')

      // ① 窄屏放大上限抬高，但策略写在 UI 层 —— render 目录保持零改动
      t.ok(/const NARROW_MAX_SCALE = 120/.test(ctl), '窄屏放大上限应为 120 设备像素/格')
      t.ok(/app\.viewport\.maxScale = NARROW\.matches \? NARROW_MAX_SCALE : DESKTOP_MAX_SCALE/.test(ctl),
        '上限要按断点切换，且桌面沿用渲染器的默认值')
      t.ok(readSrc('src/render/viewport.js').indexOf('maxScale = 40') >= 0,
        '渲染器的默认上限不许改 —— 这是界面策略，不是渲染器的固有属性')

      // ⑤ 品牌垂直居中：桌面的 flex-direction: column 漏进窄屏，
      //    column 下 align-items 管水平，纵向靠 justify-content，于是标题贴顶（实测差 10.2px）。
      //    D82 之后窄屏索性不显示品牌了（三个页签装不下它），这条 bug 也就不存在；
      //    但守卫留着 —— 哪天品牌回到窄屏，必须同时把 row 补回来，否则老毛病原样复发。
      const brand = /@media \(max-width: 767px\)[\s\S]*?\.tb-brand \{[^}]*\}/.exec(css)
      t.ok(!!brand, '窄屏必须显式处置品牌，不许靠桌面规则继承')
      t.ok(/display:\s*none/.test(brand[0]) || /flex-direction:\s*row/.test(brand[0]),
        '窄屏的品牌要么不显示，要么显式写 flex-direction: row —— 这是「桌面属性漏进窄屏」的第五次')

      // ⑥ 等间距交给网格，不让各元素自己带外边距（原来两条缝一个 6 一个 0）
      t.ok(/grid-template-columns:\s*1fr auto auto;[\s\S]{0,120}?column-gap:\s*8px/.test(css),
        '顶栏三段的间距应由 column-gap 统一给出')

      // ③ 总结卡片：文案缩短，括号里的说明挪到 title
      t.equal(DICT.zh['sum.continue'], '继续跑', '中文按钮文案缩短')
      t.equal(DICT.en['sum.continue'], 'Keep going', '英文按钮文案缩短')
      for (const lang of ['zh', 'en']) {
        t.ok(typeof DICT[lang]['sum.continue.tip'] === 'string', `${lang} 缺 sum.continue.tip`)
        t.ok(DICT[lang]['sum.continue'].indexOf('(') < 0 && DICT[lang]['sum.continue'].indexOf('（') < 0,
          `${lang} 的按钮文案里不许再带括号说明 —— 那正是溢出 76px 的成因`)
      }
      t.ok(/el\.cont\.title = t\('sum\.continue\.tip'\)/.test(rec), '说明必须挂到 title 上，不能丢')

      // ③ 页脚窄屏重排 + 浮层按钮 44px（排查发现「更多」4 个、总结卡片 3 个不达标）
      t.ok(/#summary-modal \.intro-foot \{[^}]*flex-wrap:\s*wrap/.test(css), '总结卡片页脚窄屏可换行')
      t.ok(/\.tb-more-group button, #summary-modal button, #rule-modal button,\s*\n?\s*#confirm-modal button \{ min-height: 44px; \}/.test(css),
        '浮层里的按钮统一 44px 触控区')

      // 这条规则是**点名**的 —— 新开一个模态就得回来补一笔，漏了就是触控区不达标。
      // 所以让测试替人记这份名单：index.html 里每一个模态都要在名单上。
      // 例外只有介绍卡，理由写在下面那条里（实测数据，不是拍脑袋）。
      const modalIds = [...readSrc('index.html').matchAll(/class="modal"\s+id="([\w-]+)"/g)].map(m => m[1])
      t.ok(modalIds.length >= 4, `扫到 ${modalIds.length} 个模态`)
      for (const id of modalIds) {
        if (id === 'intro-modal') continue
        t.ok(css.indexOf('#' + id + ' button') > -1, `窄屏 44px 名单漏了 #${id}`)
      }
    }
  },
  {
    name: '介绍卡：三幕主线 + 附录页的信息架构（D76）',
    run(t) {
      // 标记类的东西写在模板字符串里，stripLiterals 会把它们剥掉 —— 这类断言要查原文。
      // 只有"是不是真代码"的判断（如条件、常量）才用剥过的版本。
      const raw = readSrc('src/ui/intro.js')
      const src = stripLiterals(raw)
      const html = readSrc('index.html')
      const css = readSrc('src/style.css')

      // ---- 附录入口在正文，不在页脚 ----
      // 把次级入口塞进主键那一排，会同时坏掉语义、视觉和宽度三件事：
      // 实测原来那个按钮盒宽 51px 而内容溢出 195px，文字压在「开始玩」底下穿出屏幕。
      t.ok(html.indexOf('id="intro-more"') < 0,
        '页脚的 #intro-more 必须删除而不是隐藏 —— 留着一个永不显示的元素，下一个人会以为它还有用')
      t.ok(/data-appendix/.test(raw), '附录入口应渲染在正文里，用 data-appendix 标记')
      t.ok(/appendix-link/.test(raw) && /\.appendix-link \{/.test(css), '附录入口应有独立的次级样式')
      t.ok(/\.appendix-link \{[^}]*white-space:\s*normal/.test(css),
        '附录入口文案必须完整不截断 —— 截断正是它「不像可点」的成因之一')
      t.ok(!/\.appendix-link \{[^}]*background:\s*var\(--accent/.test(css),
        '附录入口不许用主键的绿 —— 与主键要在颜色档上分开')

      // ---- 只有完整模式才有附录入口 ----
      t.ok(/pageList\(\)\.includes\('helpAge'\)/.test(raw),
        '附录入口必须按页序里有没有附录来决定，而不是按模式名硬判')
      // 简洁模式的页序里本来就没有附录
      const simple = introPages({ chooser: false, mode: 'simple' })
      t.equal(simple.join(','), 'act1,act2,act3', '简洁版只有三幕，不受本次改动影响')
      const full = introPages({ chooser: false, mode: 'full' })
      t.equal(full.join(','), 'act1,act2,act3,helpAge,helpBS,helpSave', '完整版三幕 + 三页附录')
      t.equal(appendixPages(full).length, 3, '附录三页')
      t.equal(appendixPages(simple).length, 0, '简洁版没有附录')
      // 附录页数不许再由写死的 key 名单数出来 —— 加第三页时那份名单会悄悄落下（D83 §4）
      t.ok(!/k === 'helpAge' \|\| k === 'helpBS'/.test(readSrc('src/ui/intro.js')),
        '数附录页要走 appendixPages()，不能逐个列 key')

      // ---- 进度：主线与附录分开数 ----
      t.ok(/const ACTS = 3/.test(src), '主线固定三幕')
      t.ok(/intro\.appendix\.step/.test(raw), '附录页应有自己的步骤文案，不能读作「第 4 幕」')
      t.ok(/dot-apx/.test(raw) && /\.dot-apx \{/.test(css),
        '附录点必须与主线点形状不同 —— 五个一样的点等于说「你还有两幕没看完」')
      t.ok(/\.dot-apx \{[^}]*background:\s*none/.test(css), '附录点是空心的')
      for (const lang of ['zh', 'en']) {
        t.ok(typeof DICT[lang]['intro.appendix.entry'] === 'string', `${lang} 缺附录入口文案`)
        t.ok(typeof DICT[lang]['intro.appendix.step'] === 'string', `${lang} 缺附录步骤文案`)
      }

      // ---- 窄屏：三块规矩演示改单列 ----
      // .demo-row 是 grid repeat(3,1fr)，而 1fr 的最小尺寸是内容宽 ——
      // 两个按钮并排就把每列撑到 ~164px，三列 493 塞进 303 的可见宽。
      t.ok(/@media \(max-width: 767px\)[\s\S]*?\.demo-row \{[^}]*grid-template-columns:\s*1fr/.test(css),
        '窄屏下三块演示必须改单列竖排')
      // 三块演示的可点戳与两个按钮都要保留
      t.ok(/data-demo-step/.test(raw) && /data-demo-reset/.test(raw),
        '竖排后「走一步」「放回去」两个按钮必须都还在')
    }
  },
  {
    name: '介绍卡：页序不许再用写死的下标判断',
    run(t) {
      // D62 定过"用身份不用下标"，然后我自己在 nextBtn 回调里写了 page === 2。
      // 规矩光写在文档里没用，得能被机器查。
      const code = stripLiterals(readSrc('src/ui/intro.js'))
      const bad = code.match(/\bpage\s*[=!]==?\s*[1-9]\d*/g) || []
      t.equal(bad.length, 0, `intro.js 里出现了写死的页下标：${bad.join('、')}`)
    }
  },
  {
    name: '接线：第零幕两张卡片必须走现有的 mode 机制',
    run(t) {
      // id 存在性上一条已经管了，这里管的是**接到哪儿**。
      // 用户的约束原话：「复用现有 mode/intro 机制，别另起一套状态」。
      // 所以两张卡片必须落到 app.setMode + prefs.set('mode')，
      // 而不是自己记一个 kidVersion 之类的旁路变量。
      const src = readSrc('src/ui/intro.js')
      t.ok(/pickKid\.addEventListener\(\s*'click'/.test(src), '儿童版卡片要有 click 绑定')
      t.ok(/pickStd\.addEventListener\(\s*'click'/.test(src), '标准版卡片要有 click 绑定')
      t.ok(/app\.setMode\(\s*mode/.test(src), '选版本要调用 app.setMode，而不是自己改 class')
      t.ok(/prefs\.set\(\s*'mode'/.test(src), '选完要落进现有的 mode 偏好键')
      t.ok(/pick\('simple'\)/.test(src) && /pick\('full'\)/.test(src),
        '两张卡片要分别对应 simple / full，不能引入第三种模式名')

      // 老用户不该再被问一遍：开机只在没存过 mode 偏好时带 chooser
      const main = readSrc('src/main.js')
      t.ok(/chooser:\s*savedMode !== 'simple' && savedMode !== 'full'/.test(main),
        '开机的第零幕条件应当是「没存过模式偏好」')
      t.ok(/btn-help[\s\S]{0,200}?intro\.open\(\{\s*chooser:\s*true/.test(main),
        '「?」按钮应当总是带上第零幕，好让老用户重选')
    }
  },
  {
    name: '接线：种子输入框开机必须是空的',
    run(t) {
      // 规格阶段 1：「种子输入框，留空则随机生成种子并显示」。
      // 空 = 换一张新盘。若开机就预填一个种子，第一次点「随机填充」会用同一个种子
      // 重放出一模一样的棋盘 —— 看上去就像按钮坏了。首位用户报的正是这个现象。
      const html = readSrc('index.html')
      const m = /<input[^>]*id="in-seed"[^>]*>/.exec(html)
      t.ok(!!m, 'index.html 里应有种子输入框')
      t.ok(!/\svalue=/.test(m[0]), `种子框不该带 value 属性：${m[0]}`)

      // 代码里也不许在开机时回填它
      const main = readSrc('src/main.js')
      t.ok(!/el\.seed\.value\s*=/.test(main) && !/seed\.value\s*=\s*'/.test(main),
        'main.js 不该在装配阶段给种子框赋值')

      // 「留空 ⇒ 每次都是新种子」这条契约本身
      const a = normalizeSeed('')
      const b = normalizeSeed('')
      t.ok(a !== b, '留空时两次应生成不同的种子')
      t.equal(normalizeSeed('4271'), 4271, '填了数字就必须照用，保证可复现')
      t.equal(normalizeSeed('4271'), normalizeSeed('4271'), '同一个种子输入必须稳定')
    }
  }
)

/* ================= 阶段 5：存档、种子与 RLE 互通 ================= */

/** 从 LifeWiki 复制下来的 Gosper glider gun 原文，一字未改 */
const LIFEWIKI_GUN = `#N Gosper glider gun
#C This was the first gun discovered.
#C As its name suggests, it was discovered by Bill Gosper.
x = 36, y = 9, rule = B3/S23
24bo$22bobo$12b2o6b2o12b2o$11bo3bo4b2o12b2o$2o8bo5bo3b2o$2o8bo3bob2o4b
obo$10bo5bo7bo$11bo3bo$12b2o!`

function cellSet(engine) {
  const out = new Set()
  for (let y = 0; y < engine.h; y++) {
    for (let x = 0; x < engine.w; x++) if (engine.get(x, y) === 1) out.add(x + ',' + y)
  }
  return out
}
function sameBoard(a, b) {
  if (a.w !== b.w || a.h !== b.h) return false
  for (let i = 0; i < a.cur.length; i++) if (a.cur[i] !== b.cur[i]) return false
  return true
}

cases.push(
  {
    name: 'RLE：LifeWiki 的 Gosper glider gun 原文能正确解析',
    run(t) {
      const p = parseRLE(LIFEWIKI_GUN)
      t.equal(p.w, 36, '宽度')
      t.equal(p.h, 9, '高度')
      t.equal(p.cells.length, 36, '活细胞数')
      t.equal(p.rule, 'B3/S23', '应读出头行里的 rule')
      t.equal(p.name, 'Gosper glider gun', '应读出 #N 里的名字')
      // 正文在原文里是折行的，折点落在 "4b" 与 "obo" 之间 —— 必须能正确跨行接上
      t.ok(p.cells.some(c => c[0] === 24 && c[1] === 0), '第 0 行第 24 列应有细胞')
      t.ok(p.cells.some(c => c[0] === 35 && c[1] === 3), '右下角那对方块应在')
    }
  },
  {
    name: 'RLE：粘贴导入 Gosper glider gun，运行后每 30 代产出一个滑翔机',
    run(t) {
      const p = parseRLE(LIFEWIKI_GUN)
      const e = new LifeEngine(160, 160, { rule: lifeRule(), boundary: 'dead' })
      for (const [x, y] of p.cells) e.set(10 + x, 10 + y, 1)
      e.stats.alive = e.countAlive()
      t.equal(e.stats.alive, 36, '放下之后应有 36 个活细胞')

      // 枪本体周期 30，每个周期吐出一架 5 格的滑翔机 ⇒ 人口每 30 代恰好 +5
      const counts = []
      for (let g = 0; g <= 150; g++) {
        if (g % 30 === 0) counts.push(e.countAlive())
        e.step()
      }
      t.equal(counts.join(','), '36,41,46,51,56,61',
        `每 30 代人口应恰好 +5（一架滑翔机），实测 ${counts.join(',')}`)
    }
  },
  {
    name: 'RLE：导出再导入，逐格一致',
    run(t) {
      const e = new LifeEngine(60, 40, { rule: lifeRule(), boundary: 'dead' }).randomize(31337, 0.3)
      const rle = boardToRLE(e, 0, 0, e.w, e.h, { rule: 'B3/S23' })
      const back = parseRLE(rle)
      const e2 = new LifeEngine(60, 40, { rule: lifeRule(), boundary: 'dead' })
      for (const [x, y] of back.cells) e2.set(x, y, 1)
      t.ok(sameBoard(e, e2), '整盘随机图案导出再导入应逐格一致')
      t.equal(e2.countAlive(), e.countAlive(), '活细胞数应相同')

      // 框选一块子区域同样要往返一致
      const sub = boardToRLE(e, 7, 5, 23, 17, { rule: 'B3/S23' })
      const subBack = parseRLE(sub)
      const want = new Set()
      for (let y = 0; y < 17; y++) for (let x = 0; x < 23; x++) if (e.get(7 + x, 5 + y) === 1) want.add(x + ',' + y)
      const got = new Set(subBack.cells.map(c => c[0] + ',' + c[1]))
      t.equal(got.size, want.size, '框选区域的活细胞数应一致')
      t.ok([...want].every(k => got.has(k)), '框选区域应逐格一致')

      // 开头有空行/空列的图案：$ 是"换到下一行"，开头的空行同样得写出来，
      // 漏掉的话整个图案会往上平移。第一版 toRLE 就漏了这一支，靠存档往返才暴露。
      const e3 = new LifeEngine(20, 20, { rule: lifeRule(), boundary: 'dead' })
      placePattern(e3, getPattern('glider'), 6, 5)
      const offsetRLE = boardToRLE(e3, 0, 0, 20, 20, { rule: 'B3/S23' })
      const offsetBack = parseRLE(offsetRLE)
      const e4 = new LifeEngine(20, 20, { rule: lifeRule(), boundary: 'dead' })
      for (const [x, y] of offsetBack.cells) e4.set(x, y, 1)
      t.ok(sameBoard(e3, e4), '开头有空行时导出再导入不该发生平移')
      t.ok(offsetBack.cells.every(c => c[1] >= 5), `图案应仍从第 5 行开始，实测最上一行 ${Math.min(...offsetBack.cells.map(c => c[1]))}`)

      // 内置图案也全部走一遍往返
      for (const pat of PATTERNS) {
        const set = new Set(pat.cells.map(c => c[0] + ',' + c[1]))
        const text = toRLE((x, y) => set.has(x + ',' + y), pat.w, pat.h, { rule: 'B3/S23' })
        const rt = parseRLE(text)
        t.equal(rt.cells.length, pat.cells.length, `${pat.key} 往返后细胞数应一致`)
        t.ok(rt.cells.every(c => set.has(c[0] + ',' + c[1])), `${pat.key} 往返后应逐格一致`)
      }
    }
  },
  {
    name: 'RLE：容错 —— 缺头行、空行游程、非法字符',
    run(t) {
      // 没有头行的裸正文
      const bare = parseRLE('bo$2bo$3o!')
      t.equal(bare.cells.length, 5, '裸正文应能解析出滑翔机的 5 个细胞')

      // $ 带重复次数表示连续空行
      const gapped = parseRLE('x = 3, y = 5, rule = B3/S23\no$3$2o!')
      t.equal(gapped.cells.length, 3, '应解析出 3 个细胞')
      t.ok(gapped.cells.some(c => c[1] === 4), '3$ 之后应落到第 4 行')

      let threw = null
      try { parseRLE('x = 3, y = 3\nozz!') } catch (e) { threw = e.message }
      t.ok(threw && threw.includes('z'), `非法字符应抛出并指出是哪个，实测：${threw}`)

      let empty = null
      try { parseRLE('   ') } catch (e) { empty = e.message }
      t.ok(!!empty, '空内容应抛错')
    }
  },
  {
    name: '存档：随机局往返 —— 棋盘逐格一致、代数一致',
    run(t) {
      const e = new LifeEngine(120, 90, { rule: lifeRule(), boundary: 'torus' }).randomize(4271, 0.35)
      e.run(347)

      const save = buildSave({
        engine: e, density: 0.35,
        origin: { type: 'random', seed: 4271, density: 0.35 }
      })
      t.equal(save.version, SAVE_VERSION, '版本号')
      t.equal(save.generation, 347, '代数应写进存档')
      t.equal(save.initType, 'random', '类型应是 random')
      t.equal(save.boardSize.join('x'), '120x90', '棋盘尺寸')
      t.equal(save.rule.fingerprint, e.rule.fingerprint, '规则指纹应写进存档')
      t.ok(!('initPattern' in save), '纯种子局不该带 initPattern —— 这才是规格 3.1 说的"极简"')

      // 走一遍文本序列化，模拟真实的下载/上传
      const back = parseSave(saveToText(save))
      const r = restoreInitial(back)
      t.equal(r.replayFrom, 0, '随机局从第 0 代开始重放')
      t.equal(r.replayTo, 347, '应重放到第 347 代')
      r.engine.run(r.replayTo - r.replayFrom)
      t.ok(sameBoard(e, r.engine), '读档后棋盘应逐格一致')
      t.equal(r.engine.generation, e.generation, '代数应一致')
      t.equal(r.engine.hash(), e.hash(), '哈希应一致')
      t.equal(r.engine.boundary, e.boundary, '边界应一致')
      t.equal(r.engine.rule.fingerprint, e.rule.fingerprint, '规则指纹应一致')
    }
  },
  {
    name: '存档：手绘局用 RLE 基线往返，代数同样对得上',
    run(t) {
      // 手绘改过盘之后，"从种子重放"这条路就断了，改用当时的棋盘做 RLE 基线
      const e = new LifeEngine(80, 60, { rule: lifeRule(), boundary: 'dead' })
      placePattern(e, getPattern('gun'), 5, 5)
      e.stats.alive = e.countAlive()
      const baselineGen = 0
      const rle = boardBaseline(e)
      e.run(97)

      const save = buildSave({
        engine: e, density: 0.3,
        origin: { type: 'pattern', rle, gen: baselineGen }
      })
      t.equal(save.initType, 'pattern', '类型应是 pattern')
      t.equal(save.initGeneration, 0, '基线代数')

      const r = restoreInitial(parseSave(saveToText(save)))
      r.engine.run(r.replayTo - r.replayFrom)
      t.ok(sameBoard(e, r.engine), '读档后棋盘应逐格一致')
      t.equal(r.engine.generation, 97, '代数应一致')
    }
  },
  {
    name: '存档：坏文件必须被挡住并说清坏在哪',
    run(t) {
      const bad = [
        ['not-json', '{这不是 JSON'],
        ['version', JSON.stringify({ version: 99 })],
        ['boardSize', JSON.stringify({ version: 1, boardSize: [0, 5] })],
        ['boundary', JSON.stringify({ version: 1, boardSize: [10, 10], boundary: 'klein' })],
        ['rule', JSON.stringify({ version: 1, boardSize: [10, 10], boundary: 'torus' })],
        ['generation', JSON.stringify({ version: 1, boardSize: [10, 10], boundary: 'torus', rule: { clauses: [] }, generation: -3 })]
      ]
      for (const [why, text] of bad) {
        let msg = null
        try { parseSave(text) } catch (e) { msg = e.message }
        t.ok(msg && msg.startsWith(why), `${why} 应被拦下，实测：${msg}`)
      }

      // 条款与自称的指纹对不上 ⇒ 不能装作没看见
      const life = lifeRule()
      const tampered = {
        version: 1, seed: 1, initType: 'random', initDensity: 0.3,
        rule: { type: 'clauses', clauses: life.clauses, agingLayers: 0, fingerprint: 'deadbeef' },
        boundary: 'torus', boardSize: [10, 10], generation: 0
      }
      let fp = null
      try { restoreInitial(parseSave(JSON.stringify(tampered))) } catch (e) { fp = e.message }
      t.ok(fp && fp.startsWith('fingerprint:'), `指纹对不上应报错，实测：${fp}`)
    }
  },
  {
    name: '引擎回归基线：固定种子跑 1000 代的棋盘哈希',
    run(t) {
      // 这条不测某个功能，测的是"引擎的演化结果一个字节都没变"。
      // 以后任何一次优化（邻居计数、双缓冲、查找表）只要动了结果，这里立刻红。
      const e = new LifeEngine(200, 200, { rule: lifeRule(), boundary: 'torus' }).randomize(4271, 0.35)
      e.run(1000)
      t.equal(e.hash(), 'e1e16f70', '第 1000 代的棋盘哈希（基线：种子 4271 / 密度 0.35 / 200×200 / 环形 / B3/S23）')
      t.equal(e.stats.alive, 1755, '第 1000 代的存活数')
      t.equal(e.stats.births, 511, '第 1000 代的出生数')
      t.equal(e.stats.deathsLonely, 307, '第 1000 代的孤独死')
      t.equal(e.stats.deathsCrowded, 249, '第 1000 代的拥挤死')
      t.equal(e.rule.fingerprint, '9eba4f34', '规则指纹基线')
    }
  }
)

/* ========== 读档重放：画面与统计要跟存档前一致（首位用户第五轮反馈） ========== */

cases.push(
  {
    name: '重放：年龄预热窗口与"从头跑满"渲染结果逐格相同',
    run(t) {
      // 年龄色阶在 AGE_MAX 代就封顶，所以重放时没必要从第 0 代就推进年龄数组 ——
      // 只补跑最后一小段，渲染出来的颜色索引必须逐格相同。这条测试就是钉这个等价性。
      const GENS = 600
      const WARMUP = AGE_MAX + 16
      const idxLUT = buildAgeIndexLUT()
      const ageIdx = a => idxLUT[Math.min(a === 0 ? 0 : a, 511)]

      const full = new LifeEngine(90, 90, { rule: lifeRule(), boundary: 'torus' }).randomize(9001, 0.3)
      const vFull = new VisualState(full.cur.length)
      vFull.sync(full)
      for (let g = 0; g < GENS; g++) { full.step(); vFull.advance(full, 4) }

      const warm = new LifeEngine(90, 90, { rule: lifeRule(), boundary: 'torus' }).randomize(9001, 0.3)
      const vWarm = new VisualState(warm.cur.length)
      vWarm.sync(warm)
      for (let g = 0; g < GENS; g++) {
        const remaining = GENS - g
        warm.step()
        if (remaining === WARMUP) vWarm.sync(warm)
        if (remaining <= WARMUP) vWarm.advance(warm, 4)
      }

      t.equal(warm.hash(), full.hash(), '两边棋盘本身必须一致')
      let colorDiff = 0, decayDiff = 0, aliveOld = 0
      for (let i = 0; i < full.cur.length; i++) {
        if (ageIdx(vFull.ages[i]) !== ageIdx(vWarm.ages[i])) colorDiff++
        if (vFull.decay[i] !== vWarm.decay[i]) decayDiff++
        if (vFull.ages[i] > AGE_MAX) aliveOld++
      }
      t.ok(aliveOld > 50, `场上应确实有不少活过 ${AGE_MAX} 代的细胞，否则这条测试没意义（实测 ${aliveOld} 个）`)
      t.equal(colorDiff, 0, `渲染用的颜色索引应逐格相同，实测 ${colorDiff} 格不同`)
      t.equal(decayDiff, 0, `余晖残留应逐格相同，实测 ${decayDiff} 格不同`)

      // 反例：预热窗口太短就会露馅，说明这条等价性确实依赖 WARMUP >= AGE_MAX
      const short = new LifeEngine(90, 90, { rule: lifeRule(), boundary: 'torus' }).randomize(9001, 0.3)
      const vShort = new VisualState(short.cur.length)
      vShort.sync(short)
      for (let g = 0; g < GENS; g++) {
        const remaining = GENS - g
        short.step()
        if (remaining === 8) vShort.sync(short)
        if (remaining <= 8) vShort.advance(short, 4)
      }
      let shortDiff = 0
      for (let i = 0; i < full.cur.length; i++) if (ageIdx(vFull.ages[i]) !== ageIdx(vShort.ages[i])) shortDiff++
      t.ok(shortDiff > 0, '预热只有 8 代时应当能看出差异，否则这条等价性是空的')
    }
  },
  {
    name: '重放：顺路记账的增量成本',
    run(t) {
      // 用户的顾虑："长局重放会不会明显变慢"。这里把两种跑法都量一遍。
      const GENS = 2000
      const WARMUP = AGE_MAX + 16

      const bare = new LifeEngine(200, 200, { rule: lifeRule(), boundary: 'torus' }).randomize(4271, 0.35)
      for (let i = 0; i < 100; i++) bare.step()
      const t0 = now()
      for (let i = 0; i < GENS; i++) bare.step()
      const bareMs = now() - t0

      const full = new LifeEngine(200, 200, { rule: lifeRule(), boundary: 'torus' }).randomize(4271, 0.35)
      const vis = new VisualState(full.cur.length)
      const log = new SnapshotLog()
      const chron = new Chronicle()
      const series = new RingSeries(500)
      vis.sync(full); chron.reset(200 * 200)
      for (let i = 0; i < 100; i++) full.step()
      const t1 = now()
      for (let i = 0; i < GENS; i++) {
        const remaining = GENS - i
        const st = full.step()
        series.push(st.alive)
        log.push(st)
        chron.observe(st)
        if (remaining === WARMUP) vis.sync(full)
        if (remaining <= WARMUP) vis.advance(full, 4)
      }
      const fullMs = now() - t1

      const overhead = (fullMs - bareMs) / bareMs * 100
      t.info(`200×200 重放 ${GENS} 代：裸跑 ${bareMs.toFixed(0)}ms，顺路记账 ${fullMs.toFixed(0)}ms，` +
        `增量 ${overhead.toFixed(0)}%（${((fullMs - bareMs) / GENS).toFixed(4)}ms/代）`)
      t.equal(log.length, GENS, '每一代都要有快照')
      t.ok(overhead < 60, `增量应远小于"每代都推进年龄"的量级，实测 ${overhead.toFixed(0)}%`)
    }
  }
)

cases.push({
  name: '重放：短局不弹进度条，长局才弹',
  run(t) {
    // 判据是"按第一片的实测速度外推总耗时"，不是"代数超过多少"——
    // 500×500 的两千代和 100×100 的两千代根本不是一回事。
    // 第一片 400 代花了 30ms（≈0.075ms/代，小棋盘）
    t.equal(shouldShowProgress(30, 400, 614), false, '614 代预计约 46ms，不该弹')
    t.equal(shouldShowProgress(30, 400, 2000), false, '2000 代预计约 150ms，不该弹')
    t.equal(shouldShowProgress(30, 400, 20000), true, '20000 代预计约 1.5s，该弹')
    // 第一片花了 170ms（≈0.43ms/代，200×200）
    t.equal(shouldShowProgress(170, 400, 614), false, '同样 614 代在大棋盘上约 261ms，仍不该弹')
    t.equal(shouldShowProgress(170, 400, 3000), true, '3000 代约 1.3s，该弹')
    // 边界情况
    t.equal(shouldShowProgress(999, 0, 5000), false, '还没跑过任何一代时不该下判断')
    t.equal(shouldShowProgress(9999, 500, 500), false, '已经跑完了就别弹了')
  }
})

cases.push({
  name: '框选：浮出菜单越界时向内翻转，始终整块可见',
  run(t) {
    const stage = { w: 800, h: 600 }
    const menu = { w: 180, h: 34 }
    const inside = at => at.x >= 0 && at.y >= 0 && at.x + menu.w <= stage.w && at.y + menu.h <= stage.h

    // 常规：贴在选区右下角外侧
    const mid = placeSelectionMenu({ left: 100, top: 100, right: 300, bottom: 200 }, menu, stage)
    t.equal(mid.x, 308, '默认贴右')
    t.equal(mid.y, 208, '默认贴下')
    t.ok(inside(mid), '应完全在画布内')

    // 贴右边缘：往左翻
    const right = placeSelectionMenu({ left: 600, top: 100, right: 790, bottom: 200 }, menu, stage)
    t.ok(right.x + menu.w <= stage.w, `右侧放不下应往左翻，实测 x=${right.x}`)
    t.ok(inside(right), '翻转后仍应完全可见')

    // 贴下边缘：往上翻
    const bottom = placeSelectionMenu({ left: 100, top: 500, right: 300, bottom: 595 }, menu, stage)
    t.ok(bottom.y + menu.h <= stage.h, `下方放不下应往上翻，实测 y=${bottom.y}`)
    t.ok(inside(bottom), '翻转后仍应完全可见')

    // 右下角：两个方向都要翻
    const corner = placeSelectionMenu({ left: 600, top: 500, right: 795, bottom: 595 }, menu, stage)
    t.ok(inside(corner), `右下角选区时菜单仍应完全可见，实测 ${corner.x},${corner.y}`)

    // 选区几乎铺满整个画布：两边都翻不动，退化成贴边而不是跑到画布外
    const huge = placeSelectionMenu({ left: 2, top: 2, right: 798, bottom: 598 }, menu, stage)
    t.ok(inside(huge), `选区铺满时也不能跑到画布外，实测 ${huge.x},${huge.y}`)
  }
})

/* ================= 阶段 5.5：时间之塔（渲染器无关部分） ================= */

/** 把内置图案放到大棋盘中央，返回给 buildTower 用的格索引 */
function patternCells(key, boardW, ox, oy) {
  const p = getPattern(key)
  return p.cells.map(([x, y]) => (y + oy) * boardW + (x + ox))
}

cases.push(
  {
    name: '时间之塔 · 几何断言：滑翔机的塔身是一条斜线',
    run(t) {
      const W = 60
      const { tower } = buildTower({
        boardSize: [W, W], boundary: 'dead',
        initCells: patternCells('glider', W, 20, 20), gens: 40, maxLayers: 200
      })
      t.equal(tower.length, 41, '第 0 代也算一层，40 代应有 41 层')
      for (const l of tower.layers) t.equal(l.cells.length, 5, '滑翔机每一层都是 5 格')

      // 每 4 层质心平移 (1,1) —— 这就是"斜线"的准确说法
      for (let i = 0; i + 4 < tower.length; i++) {
        const a = tower.centroidOf(tower.layers[i])
        const b = tower.centroidOf(tower.layers[i + 4])
        t.equal(+(b.x - a.x).toFixed(6), 1, `第 ${i} → ${i + 4} 层质心 x 应 +1`)
        t.equal(+(b.y - a.y).toFixed(6), 1, `第 ${i} → ${i + 4} 层质心 y 应 +1`)
      }

      // 包围盒沿两轴同步增长：40 代走了 10 步，足迹应比单层宽/高各多约 10
      const first = tower.bboxOf(tower.layers[0])
      const last = tower.bboxOf(tower.layers[tower.length - 1])
      t.equal(last.x0 - first.x0, 10, '整段跑下来 x 应前进 10 格')
      t.equal(last.y0 - first.y0, 10, '整段跑下来 y 应前进 10 格')
      t.equal(first.w, last.w, '单层宽度不变（滑翔机不长大）')
      t.equal(first.h, last.h, '单层高度不变')

      // 斜线：不是直柱（并集足迹远大于单层足迹）
      t.ok(tower.footprintUnion().size > 5 * 4,
        `斜线的投影足迹应远大于单层，实测 ${tower.footprintUnion().size} 格`)
    }
  },
  {
    name: '时间之塔 · 几何断言：blinker 的塔身是麻花柱',
    run(t) {
      const W = 30
      const { tower } = buildTower({
        boardSize: [W, W], boundary: 'dead',
        initCells: [14 * W + 13, 14 * W + 14, 14 * W + 15], gens: 20, maxLayers: 200
      })
      t.equal(tower.length, 21, '20 代应有 21 层')
      for (const l of tower.layers) t.equal(l.cells.length, 3, '每层都是 3 格')

      // 麻花：相邻层不同、隔层相同
      for (let i = 0; i + 1 < tower.length; i++) {
        t.ok(!tower.sameLayer(tower.layers[i], tower.layers[i + 1]), `第 ${i} 层与第 ${i + 1} 层应不同`)
      }
      for (let i = 0; i + 2 < tower.length; i++) {
        t.ok(tower.sameLayer(tower.layers[i], tower.layers[i + 2]), `第 ${i} 层与第 ${i + 2} 层应逐格相同`)
      }

      // 并集足迹是一个十字：横三 ∪ 竖三 = 5 格，且包围盒是 3×3
      const u = tower.footprintUnion()
      t.equal(u.size, 5, `麻花柱的投影足迹应是十字的 5 格，实测 ${u.size}`)
      const xs = [...u].map(i => i % W), ys = [...u].map(i => (i / W) | 0)
      t.equal(Math.max(...xs) - Math.min(...xs) + 1, 3, '十字宽 3')
      t.equal(Math.max(...ys) - Math.min(...ys) + 1, 3, '十字高 3')
      const cx = 14, cy = 14
      t.ok(u.has(cy * W + cx), '十字中心应是活的（两个相位共用）')
      t.ok(!u.has((cy - 1) * W + cx - 1), '十字的四个角不该有格子')
    }
  },
  {
    name: '时间之塔 · 几何断言：静物的塔身是直柱',
    run(t) {
      const W = 20
      const { tower } = buildTower({
        boardSize: [W, W], boundary: 'dead',
        initCells: [5 * W + 5, 5 * W + 6, 6 * W + 5, 6 * W + 6], gens: 20, maxLayers: 200
      })
      t.equal(tower.length, 21, '20 代应有 21 层')
      const base = tower.layers[0]
      const bbox0 = tower.bboxOf(base)
      for (let i = 1; i < tower.length; i++) {
        t.ok(tower.sameLayer(base, tower.layers[i]), `第 ${i} 层应与第 0 层逐格相同`)
        const b = tower.bboxOf(tower.layers[i])
        t.equal(`${b.x0},${b.y0},${b.w},${b.h}`, `${bbox0.x0},${bbox0.y0},${bbox0.w},${bbox0.h}`,
          `第 ${i} 层包围盒应与第 0 层相同`)
      }
      // 直柱：并集足迹恰好等于单层足迹
      t.equal(tower.footprintUnion().size, base.cells.length,
        '直柱的投影足迹应恰好等于单层，多一格都说明它在动')
      t.equal(tower.instanceCount, 4 * 21, '只画活细胞：21 层 × 4 格')
    }
  },
  {
    name: '时间之塔：滑动窗口，默认 200 上限 500',
    run(t) {
      t.equal(TOWER_DEFAULT_HEIGHT, 200, '默认塔高')
      t.equal(TOWER_MAX_HEIGHT, 500, '塔高上限')

      const W = 40
      const { tower } = buildTower({
        boardSize: [W, W], boundary: 'torus', seed: 4271, density: 0.3,
        gens: 600, maxLayers: TOWER_DEFAULT_HEIGHT
      })
      t.equal(tower.length, 200, `层数不该越过塔高，实测 ${tower.length}`)
      t.equal(tower.dropped, 401, '被丢掉的层数应如实记账（601 层留 200）')
      t.equal(tower.genRange.join('-'), '401-600', '窗口应停在最近 200 代')

      // 上限夹取
      const tall = new Tower({ width: 10, height: 10, maxLayers: 9999 })
      t.equal(tall.maxLayers, TOWER_MAX_HEIGHT, '超过上限应被夹到 500')
      t.equal(new Tower({ width: 10, height: 10, maxLayers: 0 }).maxLayers, 1, '下限至少 1 层')

      // 调小塔高会立刻裁掉多余的层
      tower.setMaxLayers(50)
      t.equal(tower.length, 50, '调小塔高应立刻裁剪')
      t.equal(tower.genRange.join('-'), '551-600', '裁剪后应保留最新的那一段')
    }
  },
  {
    name: '时间之塔：只画活细胞，且能按代数取切片',
    run(t) {
      const W = 50
      const { tower, engine } = buildTower({
        boardSize: [W, W], boundary: 'torus', seed: 99, density: 0.2, gens: 30, maxLayers: 200
      })
      // 实例数 = 各层活细胞数之和，死细胞一个都不进
      let sum = 0
      for (const l of tower.layers) sum += l.cells.length
      t.equal(tower.instanceCount, sum, '实例数应等于各层活细胞数之和')
      t.ok(tower.instanceCount < tower.length * W * W * 0.5,
        '稀疏局的实例数应远小于"层数 × 全盘格数"，说明确实没画死细胞')

      // 切片：按代数取到的那一层，必须和引擎跑到那一代时的棋盘逐格一致
      const probe = 17
      const layer = tower.layerAt(probe)
      t.ok(!!layer, `应能取到第 ${probe} 代的切片`)
      const ref = new LifeEngine(W, W, { rule: lifeRule(), boundary: 'torus' }).randomize(99, 0.2)
      ref.run(probe)
      const want = []
      for (let i = 0; i < ref.cur.length; i++) if (ref.cur[i] === 1) want.push(i)
      t.equal(layer.cells.length, want.length, '切片的活细胞数应与引擎一致')
      t.equal([...layer.cells].join(','), want.join(','), '切片应与引擎的棋盘逐格一致')
      t.equal(engine.generation, 30, '构建结束时引擎应停在最后一代')
    }
  },
  {
    name: '时间之塔：打包 / 还原往返一致（Worker 传输用）',
    run(t) {
      const W = 30
      const { tower } = buildTower({
        boardSize: [W, W], boundary: 'dead',
        initCells: patternCells('pulsar', W, 8, 8), gens: 12, maxLayers: 200
      })
      const back = unpackTower(packTower(tower))
      t.equal(back.length, tower.length, '层数应一致')
      t.equal(back.width, tower.width, '宽度应一致')
      t.equal(back.maxLayers, tower.maxLayers, '塔高应一致')
      t.equal(back.instanceCount, tower.instanceCount, '实例数应一致')
      for (let i = 0; i < tower.length; i++) {
        t.equal(back.layers[i].gen, tower.layers[i].gen, `第 ${i} 层代数`)
        t.ok(back.sameLayer(back.layers[i], tower.layers[i]), `第 ${i} 层应逐格一致`)
      }
    }
  },
  {
    name: '时间之塔：构建进度按 chunk 回调，最后一次必到 100%',
    run(t) {
      const calls = []
      buildTower(
        { boardSize: [30, 30], boundary: 'torus', seed: 7, density: 0.3, gens: 100, maxLayers: 200 },
        (done, total) => calls.push([done, total]),
        25
      )
      t.equal(calls.length, 4, `100 代按 25 一片应回调 4 次，实测 ${calls.length}`)
      t.equal(calls[0].join('/'), '25/100', '第一次回调')
      t.equal(calls[calls.length - 1].join('/'), '100/100', '最后一次必须报满')

      // 不能整除时最后一片也要报满
      const odd = []
      buildTower({ boardSize: [20, 20], boundary: 'torus', seed: 8, density: 0.3, gens: 30, maxLayers: 200 },
        (d, tt) => odd.push([d, tt]), 25)
      t.equal(odd[odd.length - 1].join('/'), '30/30', '不能整除时最后一次也要报满')
    }
  }
)

/* ================= 阶段 6：规则勘探器 ================= */

cases.push(
  {
    name: '勘探器 · 验收：B3/S23 归入持续复杂或长周期',
    run(t) {
      const r = exploreRule(ruleFromNotation('B3/S23'))
      const good = r.runs.filter(x => x.outcome === 'complex' || x.outcome === 'longCycle').length
      t.info(`B3/S23 三局：${r.runs.map(x => `${x.outcome}@${x.gens}`).join('、')} → 总判 ${r.outcome}`)
      t.ok(good >= 2, `3 局中至少 2 局应为持续复杂或长周期，实测 ${good} 局`)
      t.ok(r.outcome === 'complex' || r.outcome === 'longCycle', `总判应是持续复杂或长周期，实测 ${r.outcome}`)
    }
  },
  {
    name: '勘探器 · 验收：B2/S 归入爆炸',
    run(t) {
      const r = exploreRule(ruleFromNotation('B2/S'))
      t.info(`B2/S 三局：${r.runs.map(x => `${x.outcome} 末尾占比 ${x.finalFill.toFixed(3)} 增长 ${x.growth.toFixed(1)}×`).join('、')}`)
      t.equal(r.outcome, 'explosion', '总判应是爆炸')
      t.equal(r.runs.filter(x => x.outcome === 'explosion').length, 3, '三局应全部判为爆炸')
      for (const x of r.runs) t.ok(x.growth >= 2, `人口应涨到起始的两倍以上，实测 ${x.growth.toFixed(1)}×`)
    }
  },
  {
    name: '勘探器：爆炸判的是相对起点的增长，不是绝对占比',
    run(t) {
      // 第一版拿绝对占比当判据，起始密度 0.3 本身就越过阈值，所有规则都成了"爆炸"。
      // 这条测试就是钉住这个教训。
      const dense = { end: null, gens: 2000, cells: 10000, peak: 3000, initialAlive: 3000,
        finalAlive: 2900, maxFill: 0.30, variation: 0.08, initialFill: 0.30, finalFill: 0.29, growth: 1.0 }
      t.equal(classifyRun(dense), 'complex', '起点就密、但没有增长的，不该判成爆炸')

      const grown = { ...dense, peak: 7000, finalAlive: 6500, maxFill: 0.70, initialAlive: 800,
        initialFill: 0.08, finalFill: 0.65, growth: 8.75 }
      t.equal(classifyRun(grown), 'explosion', '从稀疏涨到占满的才是爆炸')

      // 起点再密，淹了棋盘也算爆炸
      const flooded = { ...dense, maxFill: 0.62, finalFill: 0.60, growth: 1.4 }
      t.equal(classifyRun(flooded), 'explosion', '淹了棋盘的兜底判据')
    }
  },
  {
    name: '勘探器：七类结局的判定边界',
    run(t) {
      const base = { cells: 10000, peak: 500, initialAlive: 800, finalAlive: 0,
        maxFill: 0.05, variation: 0.1, initialFill: 0.08, finalFill: 0, growth: 0.6 }
      t.equal(classifyRun({ ...base, end: { type: 'extinction', gen: 12 }, gens: 12 }), 'quickDeath',
        '不到 50 代全灭 = 速死')
      t.equal(classifyRun({ ...base, end: { type: 'extinction', gen: 900 }, gens: 900 }), 'extinct',
        '50 代之后才全灭 = 灭绝，不能也叫速死')
      t.equal(classifyRun({ ...base, end: { type: 'still', gen: 40 }, gens: 40 }), 'still', '静止')
      t.equal(classifyRun({ ...base, end: { type: 'cycle', gen: 300, period: 2 }, gens: 300 }), 'shortCycle',
        '周期 2 = 短周期')
      t.equal(classifyRun({ ...base, end: { type: 'cycle', gen: 900, period: 240 }, gens: 900 }), 'longCycle',
        '周期 240 = 长周期')
      t.equal(classifyRun({ ...base, end: null, gens: 2000, variation: 0.2 }), 'complex',
        '跑满上限且人口波动 = 持续复杂')
      t.equal(classifyRun({ ...base, end: null, gens: 2000, variation: 0.001 }), 'longCycle',
        '跑满上限但人口纹丝不动的，不该叫"持续复杂"')
      // 边界值
      t.equal(classifyRun({ ...base, end: { type: 'extinction', gen: 49 }, gens: 49 }), 'quickDeath', '第 49 代仍算速死')
      t.equal(classifyRun({ ...base, end: { type: 'extinction', gen: 50 }, gens: 50 }), 'extinct', '第 50 代起算灭绝')
      t.equal(classifyRun({ ...base, end: { type: 'cycle', gen: 99, period: 30 }, gens: 99 }), 'shortCycle', '周期 30 仍是短周期')
      t.equal(classifyRun({ ...base, end: { type: 'cycle', gen: 99, period: 31 }, gens: 99 }), 'longCycle', '周期 31 起算长周期')
    }
  },
  {
    name: '勘探器：多局总判与"持续复杂优先"排序',
    run(t) {
      const mk = os => ({ runs: os.map(o => ({ outcome: o })), outcome: majorityOutcome(os.map(o => ({ outcome: o }))) })
      t.equal(mk(['complex', 'complex', 'shortCycle']).outcome, 'complex', '多数派')
      t.equal(mk(['shortCycle', 'shortCycle', 'complex']).outcome, 'shortCycle', '多数派（反向）')
      // 平手时取更有趣的那一类
      t.equal(majorityOutcome([{ outcome: 'complex' }, { outcome: 'shortCycle' }]), 'complex',
        '一比一平手时应取 OUTCOMES 里更靠前的')

      const rows = [
        { outcome: 'quickDeath', avgEndGen: 10 }, { outcome: 'complex', avgEndGen: 2000 },
        { outcome: 'explosion', avgEndGen: 2000 }, { outcome: 'shortCycle', avgEndGen: 800 },
        { outcome: 'longCycle', avgEndGen: 1500 }, { outcome: 'complex', avgEndGen: 1200 }
      ]
      const sorted = sortResults(rows)
      t.equal(sorted[0].outcome, 'complex', '持续复杂排最前')
      t.equal(sorted[0].avgEndGen, 2000, '同类里代数长的在前')
      t.equal(sorted[1].outcome, 'complex', '两条持续复杂应相邻')
      t.equal(sorted[2].outcome, 'longCycle', '其次是长周期')
      t.equal(sorted[sorted.length - 1].outcome, 'quickDeath', '速死排最后')
      t.equal(OUTCOMES[0], 'complex', 'OUTCOMES 的顺序就是"有趣程度"')
    }
  },
  {
    name: '勘探器：B/S 采样空间不重复、不产出必死规则',
    run(t) {
      const rules = sampleBSRules(120, 42)
      t.equal(rules.length, 120, '应恰好采到 120 条')
      const set = new Set(rules.map(r => r.notation))
      t.equal(set.size, 120, '不应有重复')
      for (const r of rules) {
        t.ok(/^B[0-8]*\/S[0-8]*$/.test(r.notation), `记法应合法：${r.notation}`)
        t.ok(!/^B\//.test(r.notation), `出生集合为空的规则必然全灭，不该进采样：${r.notation}`)
      }
      // 同一个种子必须采出同一批 —— 勘探结果要能复现
      t.equal(sampleBSRules(20, 7).map(r => r.notation).join(','),
        sampleBSRules(20, 7).map(r => r.notation).join(','), '同种子应采出同一批规则')
      t.ok(sampleBSRules(20, 7).map(r => r.notation).join(',') !== sampleBSRules(20, 8).map(r => r.notation).join(','),
        '不同种子应采出不同批')
    }
  },
  {
    name: '勘探器：单局观测量与人口起伏',
    run(t) {
      t.equal(relativeVariation([]), 0, '空序列')
      t.equal(relativeVariation([0, 0, 0]), 0, '全零序列不该除以零')
      t.equal(relativeVariation([5, 5, 5, 5]), 0, '恒定序列起伏为 0')
      t.ok(relativeVariation([10, 90, 10, 90]) > 0.5, '大幅震荡的起伏应明显')

      const r = probeRule(ruleFromNotation('B3/S23'), { seed: 1000, boardSize: 48, density: 0.12, genCap: 500 })
      t.equal(r.notation, 'B3/S23', '应带上记法')
      t.equal(r.fingerprint, '9eba4f34', '应带上规则指纹，方便与主界面对账')
      t.equal(r.seed, 1000, '应带上种子 —— 候选名单要靠它复现')
      t.ok(r.cells === 48 * 48, '棋盘格数')
      t.ok(OUTCOMES.includes(r.outcome), `结局应是七类之一，实测 ${r.outcome}`)
      t.ok(r.gens > 0 && r.gens <= 500, '代数应落在上限内')
    }
  },
  {
    name: '收藏：B/S 记法编译成规则（复现路径的第一步）',
    run(t) {
      // 这条守卫是补的：applyNotation 里原本写的是 bsToClauses(parseBS(n)) ——
      // parseBS 返回的已经是条款，再喂给 bsToClauses 就成了垃圾，
      // 结果整条"换规则再复现"的路径静默失灵（切了等于没切）。埋在 DOM 回调里测不到。
      const r = compileNotation('B36/S23')
      t.equal(r.notation, 'B36/S23', '记法要留在规则对象上，界面靠它显示')
      t.ok(r.lookup instanceof Uint8Array, '应是编译好的规则（有查表），不是规则说明')
      // 硬判据：正中那个死格恰有 6 个活邻居 —— B36 下出生，标准 Life 下绝不出生
      const ring = 'OOO\nO.O\n.O.'
      const e = new LifeEngine(20, 20, { rule: r, boundary: 'dead' })
      place(e, ring, 5, 5)
      e.step()
      t.equal(e.get(6, 6), 1, 'B36：6 个邻居应当出生')
      const e2 = new LifeEngine(20, 20, { rule: lifeRule(), boundary: 'dead' })
      place(e2, ring, 5, 5)
      e2.step()
      t.equal(e2.get(6, 6), 0, '标准 Life 下同一格不该出生 —— 证明规则确实换了')
      let threw = false
      try { compileNotation('B9/S23') } catch { threw = true }
      t.ok(threw, '读不懂的记法要抛，不能悄悄给个默认规则')
    }
  },
  {
    name: '收藏：整盘收藏裁到活细胞外接框',
    run(t) {
      // 不裁的话头行会写成 x = 200, y = 200，日后把棋盘调小就再也复现不了
      const cells = new Set(['10,20', '12,23'])
      const get = (x, y) => cells.has(x + ',' + y) ? 1 : 0
      const b = liveBounds(get, { x: 0, y: 0, w: 200, h: 200 })
      t.equal(b.x, 10, '左边界'); t.equal(b.y, 20, '上边界')
      t.equal(b.w, 3, '宽 = 右-左+1'); t.equal(b.h, 4, '高 = 下-上+1')
      t.equal(liveBounds(() => 0, { x: 0, y: 0, w: 5, h: 5 }), null, '全空盘应回 null，交给调用方拒绝')
      // 只削外圈：框内的相对间距一格不动（滑翔机与吞食者的距离就是那一局的全部内容）
      const b2 = liveBounds(get, { x: 5, y: 5, w: 100, h: 100 })
      t.equal(b2.w + ',' + b2.h, '3,4', '换个搜索范围，外接框不变')
    }
  },
  {
    name: '收藏：导入是合并不是覆盖',
    run(t) {
      // 覆盖的话，导入一份别人的收藏就把自己的全洗掉 —— 不可撤销；
      // 合并的反面（多出几条）用户删得掉。两害相权。
      const mine = {
        layouts: [{ id: 'a', name: '我的', rle: 'x = 1, y = 1, rule = B3/S23\no!', note: '', life: '' }],
        rules: [{ notation: 'B3/S23', fingerprint: 'fp1', clauses: [], agingLayers: 0 }]
      }
      const incoming = {
        layouts: [{ id: 'a', name: '重名的', rle: 'x = 1, y = 1, rule = B3/S23\no!', note: '', life: '' },
                  { id: 'b', name: '别人的', rle: 'x = 1, y = 1, rule = B3/S23\no!', note: '', life: '' }],
        rules: [{ notation: 'B36/S23', fingerprint: 'fp2', clauses: [], agingLayers: 0 }]
      }
      const m = mergeFavorites(mine, incoming)
      t.equal(m.layouts.length, 2, '自己的那条还在，别人的加进来')
      t.equal(m.layouts[0].name, '我的', '同 id 不覆盖，先来的赢')
      t.equal(m.rules.length, 2, '规则同样合并')
      t.equal(m.added, 2, '真加进去的算 2 条')
      t.equal(m.skipped, 1, '重复的算跳过，要说给用户听')
      // 超预算的条目明确跳过，不静默丢
      const big = { layouts: [{ id: 'c', name: 'x', rle: 'x'.repeat(400), note: '', life: '' }], rules: [] }
      const m2 = mergeFavorites(mine, big, 200)
      t.equal(m2.added, 0, '塞不下就不塞')
      t.equal(m2.skipped, 1, '塞不下要记成跳过')
      t.equal(m2.layouts.length, 1, '原有的一条不受影响')
    }
  },
  {
    name: '收藏：规则条目留住复现所需的全部字段',
    run(t) {
      // clauses/agingLayers 定世界，seed 定那一盘 —— 少一个就复现不出来。
      // 迁入收藏前它们只活在勘探器的内存里，落盘后掉字段的话，刷新一次候选名单就废了。
      const r = normalizeRule({ notation: 'B3/S23', fingerprint: 'fp', seed: 42, outcome: 'still',
        clauses: [{ when: 'dead', neighbors: { op: 'in', values: [3] }, then: 'alive' }], agingLayers: 2, junk: 'x' })
      t.equal(r.clauses.length, 1, 'clauses 要留住')
      t.equal(r.agingLayers, 2, 'agingLayers 要留住')
      t.equal(r.seed, 42, 'seed 要留住')
      t.equal(r.junk, undefined, '不认识的字段不留 —— 导入的文件别夹带私货')
      const round = importFavorites(exportFavorites({ layouts: [], rules: [r] }))
      t.equal(round.rules[0].clauses.length, 1, '导出再导入，clauses 仍在')
      t.equal(round.rules[0].agingLayers, 2, '导出再导入，agingLayers 仍在')
    }
  },
  {
    name: '接线守卫：界面里出现的每个词典 key 都有中英词条',
    run(t) {
      // 这条是补的：收藏功能第一版把 HTML 和 JS 都写完了、测试全绿，
      // 一开浏览器满屏是 fav.replay 这样的裸 key —— 词条根本没写。
      // 静态扫一遍就能抓住，比开浏览器便宜得多。
      const files = ['index.html'].concat(DOM_SOURCES)
      const used = new Map()
      for (const f of files) {
        const src = readSrc(f)
        // HTML：data-i18n / data-i18n-title / data-i18n-placeholder 等
        for (const m of src.matchAll(/data-i18n(?:-[a-z]+)?="([^"]+)"/g)) used.set(m[1], f)
        // JS：t('literal') —— 拼接出来的 key（t(x + '.desc')）不在此列，扫不到也不该扫
        for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'\s*[,)]/g)) used.set(m[1], f)
      }
      t.ok(used.size > 100, `应扫到足够多的 key，实际 ${used.size}`)
      const missZh = [...used].filter(([k]) => !(k in DICT.zh)).map(([k, f]) => `${k}(${f})`)
      const missEn = [...used].filter(([k]) => !(k in DICT.en)).map(([k, f]) => `${k}(${f})`)
      t.equal(missZh.join(', '), '', '中文词典缺词条')
      t.equal(missEn.join(', '), '', '英文词典缺词条')
    }
  },
  {
    name: '接线守卫：取用区三个页签各有其块，且互斥',
    run(t) {
      const html = readSrc('index.html')
      const ctl = readSrc('src/ui/controls.js')
      for (const id of ['show-strip', 'show-list', 'show-hint'])
        t.ok(html.includes(`id="${id}"`), `index.html 缺 #${id}`)
      t.ok(/data-tab="show"/.test(html), '顶栏缺「精彩局」页签')
      // 页签名 → 取用区的映射必须三个都在，否则点了没反应（老 bug：syntax 是三元式，第三个页签落不到）
      const map = /const PICKERS = \{([^}]*)\}/.exec(stripLiterals(ctl))
      t.ok(!!map, 'controls.js 里应有 PICKERS 映射')
      for (const name of ['pattern', 'world', 'show'])
        t.ok(map[1].includes(name + ':'), `PICKERS 缺 ${name}`)
      // 窄屏互斥：setPicker 要把三个都摆一遍（漏一个就会两块同时开着）
      const sp = /app\.setPicker = function[\s\S]*?\n  \}/.exec(ctl)[0]
      for (const fn of ['setRail', 'setWorlds', 'setShows'])
        t.ok(sp.includes(fn), `setPicker 没有摆 ${fn} —— 窄屏会两块同时开`)
      // 精彩局与世界都是顶部横条，桌面下也必须互斥
      const tt = /app\.toggleTab = function[\s\S]*?\n  \}/.exec(ctl)[0]
      t.ok(/setShows\(false\)/.test(tt) && /setWorlds\(false\)/.test(tt),
        'toggleTab 里两条顶部横条要互相关掉 —— 它们占同一条边')
    }
  },
  {
    name: '接线守卫：收藏面板的按钮与内置精选局的词条齐备',
    run(t) {
      const html = readSrc('index.html')
      for (const id of ['fav-tabs', 'fav-list', 'fav-budget', 'fav-storage', 'btn-fav-add', 'btn-fav-export', 'btn-fav-import', 'fav-file'])
        t.ok(html.includes(`id="${id}"`), `index.html 缺 #${id}`)
      // 内置精选局的名称、说明、生平三样都要有词条（含简洁语域的名称）
      for (const b of BUILTIN_LAYOUTS) {
        for (const suffix of ['', '.desc', '.life']) {
          t.ok((b.nameKey + suffix) in DICT.zh, `中文缺 ${b.nameKey}${suffix}`)
          t.ok((b.nameKey + suffix) in DICT.en, `英文缺 ${b.nameKey}${suffix}`)
        }
        t.ok((b.nameKey + '.simple') in DICT.zh, `简洁语域缺 ${b.nameKey}.simple`)
        t.ok((b.nameKey + '.simple') in DICT.en, `简洁语域缺英文 ${b.nameKey}.simple`)
      }
    }
  },
  {
    name: '收藏：生平探针与内置局是同一把尺子（D83 ②）',
    run(t) {
      // 自存卡片上的生平必须与内置卡片可以并排读 —— 那就得是同一口径量出来的。
      // 这条把两者钉在一起：拿探针去跑内置的野火，出来的数必须与写在
      // BUILTIN_LAYOUTS 里、由上一轮实测钉死的那组分毫不差。
      // 口径一旦被改（换盘面、换边界、换检测器），这条会立刻红。
      const w = BUILTIN_LAYOUTS.find(b => b.id === 'builtin:wildfire')
      const life = probeLife(w.rle)
      t.equal(life.end, 'cycle', '野火以循环收场')
      t.equal(life.period, 2, '周期 2')
      t.equal(life.start, w.life.start, '起步格数一致')
      t.equal(life.gen, w.life.settle, `定型代数应为 ${w.life.settle}`)
      t.equal(life.peak, w.life.peak, `峰值应为 ${w.life.peak}`)
      t.equal(life.peakGen, w.life.peakGen, `峰值代数应为 ${w.life.peakGen}`)
      t.equal(life.final, w.life.final, `末态应为 ${w.life.final}`)
      t.equal(life.board, w.life.board, '盘面大小一致')
      t.equal(life.boundary, w.life.boundary, '边界一致')

      // 口径与词条里写的那句话也必须对得上：卡片上写着"默认 200×200 环形盘"，
      // 探针就不能偷偷换成别的盘 —— 那会让所有自存卡片一起说谎。
      t.equal(PROBE_SPEC.board, 200, '默认盘 200')
      t.equal(PROBE_SPEC.boundary, 'torus', '默认环形')
      for (const lang of ['zh', 'en']) {
        t.ok(DICT[lang]['fav.life.cycle'].includes('{board}'), `${lang} 的生平句子要把盘面写出来`)
      }
      t.ok(PROBE_SPEC.genCap > w.life.settle,
        `代数上限（${PROBE_SPEC.genCap}）要够野火这一档跑完（${w.life.settle}），否则自存同一局只能得到"跑满未定型"`)
    }
  },
  {
    name: '收藏：生平的四种结局各出一次，分块跑与一口气跑同结果（D83 ②）',
    run(t) {
      const H = 'rule = B3/S23\n'
      const small = { board: 40 }
      const blinker = probeLife('x = 3, y = 1, ' + H + '3o!', small)
      t.equal(blinker.end, 'cycle', '闪灯是循环')
      t.equal(blinker.period, 2, '周期 2')
      // 第 3 代才认出来，不是第 2 代：检测器只看**走过的每一代**，第 0 代那张盘从不入表
      // （主循环也是这么记的）。周期数是对的，代数是"认出来的那一代"。
      t.equal(blinker.gen, 3, '第 3 代认出来 —— 第 0 代不入表，这与主循环的记法一致')

      const block = probeLife('x = 2, y = 2, ' + H + '2o$2o!', small)
      t.equal(block.end, 'still', '方块是静物')
      t.equal(block.gen, 2, '连着两代一样才判静止')
      t.equal(block.final, 4, '末态 4 格')

      const lone = probeLife('x = 1, y = 1, ' + H + 'o!', small)
      t.equal(lone.end, 'extinction', '一个孤格必死')
      t.equal(lone.final, 0, '末态 0 格')

      const glider = probeLife('x = 3, y = 3, ' + H + 'bo$2bo$3o!', { board: 40, genCap: 10 })
      t.equal(glider.end, 'capped', '滑翔机在 10 代内不会复原 —— 该报"跑满未定型"，不能瞎猜一个结局')
      t.equal(glider.gen, 10, '停在上限那一代')

      const bad = createLifeProbe('这不是 RLE')
      t.ok(bad.done && bad.result.end === 'error',
        '读不懂的条目要一次定案为 error —— 否则每次渲染都会重试一遍，白烧 CPU')

      // 界面是分块跑的（一口气跑会冻住那一帧）。分块与不分块必须得到同一组数，
      // 否则卡片上的数字取决于用户当时切没切标签页。
      const chunked = createLifeProbe('x = 3, y = 1, ' + H + '3o!', small)
      while (!chunked.run(1));
      t.equal(JSON.stringify(chunked.result), JSON.stringify(blinker), '一代一代地跑，结果必须与整段跑相同')
      const chunkedGlider = createLifeProbe('x = 3, y = 3, ' + H + 'bo$2bo$3o!', { board: 40, genCap: 10 })
      while (!chunkedGlider.run(3));
      t.equal(JSON.stringify(chunkedGlider.result), JSON.stringify(glider), '跑到上限那一条也一样')
    }
  },
  {
    name: '收藏：内置卡与自存卡同形，用户写的字一个都不过词典（D83 ①）',
    run(t) {
      const tr = key => '词典:' + key
      const b = layoutRow(BUILTIN_LAYOUTS[0], tr)
      const mine = layoutRow({
        id: 'fav:1', name: '我的第 1 局', rle: 'x = 1, y = 1, rule = B3/S23\no!',
        note: '放在左上角那一坨', life: { end: 'still', board: 200, gen: 12, peak: 30, peakGen: 4, final: 8 }
      }, tr)
      t.equal(Object.keys(b).sort().join(','), Object.keys(mine).sort().join(','),
        '两种来源喂给卡片模板的字段必须一模一样 —— 卡片长得一样，是因为数据本来就是同一种形状')
      t.equal(mine.name, '我的第 1 局', '用户写的名字原样出去')
      t.equal(mine.note, '放在左上角那一坨', '用户写的说明原样出去，不翻译也不改写')
      t.ok(b.name.startsWith('词典:'), '内置的三样全走词典')
      t.ok(b.life.startsWith('词典:'), '内置的生平走词典')
      t.ok(mine.life.startsWith('词典:fav.life.'), '自存的生平：数字是跑出来的，措辞走词典')
      t.ok(!mine.life.includes('我的第 1 局'), '生平那一行不该混进用户写的字')

      // 没跑过生平的条目，生平那一行留白 —— 不编，也不拿说明去顶
      t.equal(layoutRow({ id: 'x', name: 'n', rle: 'r', note: '', life: '' }, tr).life, '', '没跑过就留白')
      // 别人导出的文件里那一行是字符串：原样显示，不改写
      t.equal(lifeText('别人写的一句话', tr), '别人写的一句话', '外来的生平原样显示')
      t.equal(lifeText({ end: 'error' }, tr), '', '跑不出来的条目留白，不编故事')

      // 排序：内置在前，自存的新的在前（横条上刚存完的那一张就在开头）
      const rows = layoutRows({ layouts: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }] }, tr)
      const builtinCount = BUILTIN_LAYOUTS.length + BIG_LAYOUTS.length + MACHINE_LAYOUTS.length + 1
      t.equal(rows.length, builtinCount + 2, '内置（三条小局 + 五条经典 + 六局机关 + 整台机器）+ 两条自存')
      t.equal(rows[builtinCount - 1].id, 'builtin:otca-metapixel', '整台机器压轴，排在所有内置的最后')
      t.ok(rows.slice(0, builtinCount).every(r => r.builtin), '内置在前')
      t.equal(rows[builtinCount].name, '乙', '后存的排在前面')
    }
  },
  {
    name: '收藏：长列表折起来，内置恒显示（D83 ③）',
    run(t) {
      const mk = n => {
        const rows = [{ id: 'b1', builtin: true }, { id: 'b2', builtin: true }]
        for (let i = 0; i < n; i++) rows.push({ id: 'm' + i, builtin: false })
        return rows
      }
      const few = foldRows(mk(RECENT_SHOWN), false)
      t.equal(few.hidden, 0, `不超过 ${RECENT_SHOWN} 条就不折 —— 一颗永远点不动的开关只是噪音`)
      t.equal(few.rows.length, RECENT_SHOWN + 2, '一条都没少')

      const many = foldRows(mk(RECENT_SHOWN + 3), false)
      t.equal(many.hidden, 3, '多出来的三条折起来')
      t.equal(many.rows.filter(r => r.builtin).length, 2, '内置的一条都不折 —— 它们是入口，不是历史')
      t.equal(many.rows.filter(r => !r.builtin).length, RECENT_SHOWN, `只露最近 ${RECENT_SHOWN} 条`)
      t.equal(many.rows[2].id, 'm0', '露出来的是列表最前面那几条（layoutRows 已把新的排在前）')

      const open = foldRows(mk(RECENT_SHOWN + 3), true)
      t.equal(open.hidden, 0, '展开后没有隐藏项')
      t.equal(open.rows.length, RECENT_SHOWN + 5, '展开后全在')
    }
  },
  {
    name: '收藏：说明字段的边界，与外来生平的收敛（D83 ①）',
    run(t) {
      const base = { name: '甲', rle: 'x = 1, y = 1, rule = B3/S23\no!' }
      t.ok(validateLayout({ ...base, note: '短说明' }).ok, '带说明的条目合法')
      t.ok(validateLayout(base).ok, '说明是可选的，不填也能存')
      t.equal(validateLayout({ ...base, note: 'x'.repeat(MAX_NOTE + 1) }).key, 'fav.err.longNote',
        '说明超长要明确拒绝 —— 悄悄截掉半句用户自己写的字，比不让存更难受')

      // 外来文件是不可信输入：认不出的结论收敛成 error，数字字段一律收敛成数
      const dirty = normalizeLife({ end: '<script>', gen: '不是数', peak: 3.7, board: '200', period: 9 })
      t.equal(dirty.end, 'error', '认不出的结局记为 error')
      t.equal(dirty.gen, 0, '非数字收敛成 0')
      t.equal(dirty.peak, 3, '小数截成整数')
      t.equal(dirty.period, undefined, '只有循环才有周期')
      t.equal(normalizeLife('别人的一句话'), '别人的一句话', '字符串形态原样留着')
      t.equal(normalizeLife(undefined), '', '没有就是没有')

      // 结构化的生平要能原样往返导出导入（数字是数据，措辞在词典里）
      const life = { end: 'cycle', board: 200, boundary: 'torus', start: 5, gen: 12, peak: 30, peakGen: 4, final: 8, period: 2 }
      const back = importFavorites(exportFavorites({ layouts: [{ ...base, id: 'a', note: '', life }], rules: [] }))
      t.ok(back.ok, '往返成功')
      t.equal(JSON.stringify(back.layouts[0].life), JSON.stringify(life), '生平逐字段往返')
    }
  },
  {
    name: '收藏：生平四种结局的中英两语域都填得满（D83 ②）',
    run(t) {
      const tr = (lang, reg) => (key, params) => {
        let str = reg === 'simple' ? DICT[lang][key + '.simple'] : undefined
        if (str === undefined) str = DICT[lang][key]
        if (str === undefined) return 'MISSING:' + key
        if (params) for (const k in params) str = str.split('{' + k + '}').join(String(params[k]))
        return str
      }
      const lives = {
        cycle: { end: 'cycle', board: 200, gen: 3640, peak: 1438, peakGen: 1470, final: 735, period: 2 },
        still: { end: 'still', board: 200, gen: 12, peak: 30, peakGen: 4, final: 8 },
        extinction: { end: 'extinction', board: 200, gen: 44, peak: 12, peakGen: 3, final: 0 },
        capped: { end: 'capped', board: 200, gen: 5000, peak: 900, peakGen: 120, final: 640 }
      }
      for (const [name, life] of Object.entries(lives)) {
        for (const lang of ['zh', 'en']) {
          for (const reg of ['full', 'simple']) {
            const text = lifeText(life, tr(lang, reg))
            t.ok(text.length > 0, `${lang}/${reg} 的「${name}」应有文案`)
            t.ok(!text.startsWith('MISSING:'), `${lang}/${reg} 缺「${name}」的词条`)
            t.ok(!text.includes('{'), `${lang}/${reg} 的「${name}」有没填上的占位符：${text}`)
            t.ok(text.includes(String(life.gen)), `${lang}/${reg} 的「${name}」要把代数说出来`)
          }
        }
      }
      // 峰值只在真的发生过时才说：一架滑翔机的"峰值"是第 0 代的 5 格，那是起点不是峰值
      const flat = { end: 'cycle', board: 200, gen: 801, peak: 5, peakGen: 0, final: 5, period: 800 }
      for (const lang of ['zh', 'en']) {
        const text = lifeText(flat, tr(lang, 'full'))
        t.ok(!text.includes('5 格在第 0 代') && !/on step 0/.test(text),
          `${lang}：没长过的局不该报一个"第 0 代的峰值"`)
        t.ok(lifeText({ ...flat, peak: 40, peakGen: 12 }, tr(lang, 'full')).includes('12'),
          `${lang}：真的长过就要把峰值说出来`)
      }

      // 进行中的那一行也要有词条（用户存完先看到的就是它）
      t.ok(!lifeText({ pending: true }, tr('en', 'full')).startsWith('MISSING'), '英文缺 fav.life.running')
    }
  },
  {
    name: '接线守卫：保存路径上说明与生平都接上了（D83 ①）',
    run(t) {
      const src = readSrc('src/ui/favorites-view.js')
      // 查"有没有真的调用"必须用剥过注释的版本。第一版扫的是原文，
      // 而处理函数里恰好有一句注释写着"（见 pump()）"—— 把 pump() 从代码里删掉，
      // 守卫照样绿。是红/绿自查把这一条揪出来的（D83 §5）。
      const code = stripLiterals(src)
      t.ok(/fav\.notePrompt/.test(src), '保存时要问一句可选的说明')
      t.ok(/createLifeProbe/.test(code), '生平要由系统跑，不能留空等用户填')
      t.ok(!/BUILTIN_LAYOUTS/.test(code),
        '卡片数据一律走 layoutRows()：界面层再自己拼一份内置行，两种卡片就会慢慢长歪（D83 ①）')
      const add = /el\.add\.addEventListener\([\s\S]*?\n  \}\)/.exec(code)
      t.ok(!!add, '找得到「收藏当前布局」的处理')
      t.ok(/note,/.test(add[0]) || /note:\s*note/.test(add[0]), '存的时候要把说明带上')
      t.ok(/pump\(\)/.test(add[0]), '存完要立刻开跑生平')
      const prompts = code.match(/window\.prompt\(/g) || []
      t.equal(prompts.length, 2, '只问名字与说明两件事 —— 生平是系统跑出来的，不问用户')
      // 分块跑：一口气跑满上限要两秒多，那正是用户刚点完「收藏」的时刻
      t.ok(/PROBE_CHUNK/.test(code) && /setTimeout\(tick/.test(code), '生平要分块跑，不能在一帧里跑完')
    }
  },
  {
    name: '接线守卫：横滑对齐与折叠开关（D83 ③）',
    run(t) {
      const css = readSrc('src/style.css')
      t.ok(/\.strip \.card-list \{[^}]*scroll-snap-type:\s*x proximity/.test(css),
        '桌面横条要按卡片对齐落点')
      t.ok(/\.strip \.card \{[^}]*scroll-snap-align/.test(css), '卡片要声明对齐点')
      t.ok(!/scroll-snap-type:\s*x mandatory/.test(css),
        'mandatory 会在长列表里把慢速滑动吸回去 —— 那是在和用户较劲')
      t.ok(/scroll-padding-left/.test(css), '窄屏容器滚动时要留出左内边距，否则停下来卡片被裁掉')
      t.ok(/\.fav-more \{/.test(css), '折叠开关要有自己的样式')
      t.ok(!/\.fav-more \{[^}]*background:\s*var\(--accent/.test(css),
        '折叠是次级动作，不许用主键的绿')
      const view = readSrc('src/ui/favorites-view.js')
      t.ok(/foldRows/.test(view), '侧栏长列表要折叠')
      t.ok(!/max-height/.test(css.slice(css.indexOf('#fav-list'), css.indexOf('#fav-budget'))),
        '侧栏本身就是一根滚动的柱子，里面不许再开定高滚动区（D83 §3）')
    }
  },
  {
    name: '接线守卫：收藏的存储边界在「?」与面板里都说了（D83 ④）',
    run(t) {
      const intro = readSrc('src/ui/intro.js')
      t.ok(/helpSave/.test(intro), '「?」里要有「收藏存在哪儿」这一页')
      t.ok(/RENDERERS = \{[^}]*helpSave/.test(intro), '新附录页要登记进 RENDERERS，否则翻到那页是空白')
      for (const lang of ['zh', 'en']) {
        for (const k of ['title', 'body', 'builtin', 'mine', 'move', 'budget', 'submit'])
          t.ok(typeof DICT[lang]['help.save.' + k] === 'string', `${lang} 缺 help.save.${k}`)
      }
      // 三件事都得说到：内置人人有 / 自存只在本机 / 换设备走导出导入
      t.ok(/导出/.test(DICT.zh['help.save.move']) && /导入/.test(DICT.zh['help.save.move']), '中文要说清导出导入')
      t.ok(/Export/i.test(DICT.en['help.save.move']) && /Import/i.test(DICT.en['help.save.move']), '英文要说清导出导入')
      const html = readSrc('index.html')
      t.ok(/data-i18n="fav.storageNote"/.test(html), '收藏面板里也要有一句 —— 会因此吃亏的人正在看这一块')
      for (const lang of ['zh', 'en'])
        t.ok(typeof DICT[lang]['fav.storageNote.simple'] === 'string' || typeof DICT[lang]['fav.storageNote'] === 'string',
          `${lang} 缺存储边界的短句`)
      // 简洁语域也得说到：孩子那一版看不到侧栏面板，只看得到取用区的提示条
      t.ok(/这台电脑/.test(DICT.zh['fav.showHint.simple']), '简洁语域的提示条要说清"只在这台电脑上"')
      t.ok(/this computer/i.test(DICT.en['fav.showHint.simple']), '英文简洁语域同理')
      const readme = readSrc('README.md')
      t.ok(/收藏存在哪儿/.test(readme), 'README 里要有「收藏存在哪儿」一节')
    }
  },
  {
    name: '缩放滑条：两端就是「适配视图」与现有上限，刻度是对数的（D84 ①）',
    run(t) {
      const fit = 8.33, max = 40
      // 两端必须**精确**落在这两个值上 —— 差一点点的表现是"推到底了棋盘还差一圈没露全"
      t.equal(zoomFromSlider(0, fit, max), fit, '最小档 = 适配视图')
      t.equal(zoomFromSlider(ZOOM_STEPS, fit, max), max, '最大档 = 现有上限')
      t.equal(sliderFromZoom(fit, fit, max), 0, '适配视图 → 最小档')
      t.equal(sliderFromZoom(max, fit, max), ZOOM_STEPS, '上限 → 最大档')

      // 往返：捏合改了缩放 → 同步回滑条 → 再读回来，必须还是同一个倍数
      for (const v of [0, 137, 500, 813, ZOOM_STEPS]) {
        const scale = zoomFromSlider(v, fit, max)
        t.equal(sliderFromZoom(scale, fit, max), v, `档位 ${v} 往返一致`)
      }

      // 对数刻度的判据：等长的行程 = 等比例的放大，与起点无关
      const ratio = (a, b) => zoomFromSlider(b, fit, max) / zoomFromSlider(a, fit, max)
      const r1 = ratio(0, 100), r2 = ratio(400, 500), r3 = ratio(900, ZOOM_STEPS)
      t.ok(Math.abs(r1 - r2) < 1e-9 && Math.abs(r2 - r3) < 1e-9,
        `同样走 100 档，放大倍率应处处相同：${r1.toFixed(4)} / ${r2.toFixed(4)} / ${r3.toFixed(4)}`)
      // 线性刻度会把低倍数挤没：这里正面钉一下"中点不是算术中点"
      t.ok(zoomFromSlider(ZOOM_STEPS / 2, fit, max) < (fit + max) / 2,
        '中点应当是几何中点，不是算术中点 —— 线性刻度会把看整盘要用的那一段挤没')

      // 越界一律钳到两端，不许算出负档或超上限
      t.equal(sliderFromZoom(fit / 4, fit, max), 0, '比适配还小（捏合可以）→ 钳到最小档')
      t.equal(sliderFromZoom(max * 10, fit, max), ZOOM_STEPS, '超出上限 → 钳到最大档')
      t.equal(zoomFromSlider(-50, fit, max), fit, '档位越界也钳')
      t.equal(zoomFromSlider(ZOOM_STEPS + 50, fit, max), max, '档位越上界也钳')

      // 退化情形：小棋盘上"适配"本身就可能顶到上限，此时全程只有一个值，不许除以零
      t.equal(zoomFromSlider(500, 60, 40), 60, '适配 ≥ 上限时退化为一个值')
      t.equal(sliderFromZoom(50, 60, 40), 0, '退化时档位恒为 0')
      t.ok(Number.isFinite(zoomFromSlider(500, 40, 40)), '两端相等也不许出 NaN')
    }
  },
  {
    name: '缩放滑条：最小档与「适配视图」是同一个函数算出来的（D84 ①）',
    run(t) {
      // 两处各算一遍公式的东西迟早会差一点。这里从两头钉死：
      // 一是行为上相等，二是源码里 fit() 就是调的那个函数。
      const vp = new Viewport()
      const W = 1736, H = 1701, BW = 200, BH = 200
      vp.fit(W, H, BW, BH)
      t.equal(vp.scale, fitScaleOf(W, H, BW, BH), '适配之后的缩放 = fitScaleOf 的返回值')
      t.equal(sliderFromZoom(vp.scale, fitScaleOf(W, H, BW, BH), vp.maxScale), 0,
        '适配视图之后，滑条应当正好落在最小档')
      const src = stripLiterals(readSrc('src/render/viewport.js'))
      t.ok(/this\.scale = fitScaleOf\(/.test(src),
        'fit() 必须调用 fitScaleOf —— 照着公式再写一遍就会有"推到底还差一圈"的那天')

      // 非方形画布：短边说了算（棋盘要整个看得见）
      t.equal(fitScaleOf(1000, 500, 100, 100), 4.9, '短边决定适配倍数')
    }
  },
  {
    name: '缩放滑条：倍数的读写（D84 ③）',
    run(t) {
      t.equal(zoomLabel(8.325), '8.3×', '一位小数 + ×')
      t.equal(zoomLabel(40), '40.0×', '整数也带一位小数，宽度才稳定')
      // 用户看到的是「8.3×」，允许他把 × 一起打回来
      t.equal(parseZoomInput('15×'), 15, '带×号照收')
      t.equal(parseZoomInput(' 12.5 '), 12.5, '前后空格不算数')
      t.equal(parseZoomInput('20x'), 20, '半角 x 也认')
      t.equal(parseZoomInput(''), null, '空串 = 这次不改（不是回落成最小值）')
      t.equal(parseZoomInput('abc'), null, '认不出 = 这次不改')

      // 与钳位串起来走一遍：输入 → 档位 → 钳位，两端都不许越界
      const fit = 8.33, max = 40
      const range = { min: '0', max: String(ZOOM_STEPS), step: '1', value: '0' }
      const enter = text => {
        const n = parseZoomInput(text)
        return n === null ? null : clampToRange(sliderFromZoom(n, fit, max), range)
      }
      t.equal(enter('999'), ZOOM_STEPS, '远超上限 → 钳到最大档（不是拒绝）')
      t.equal(enter('0.1'), 0, '远低于适配 → 钳到最小档')
      t.equal(enter(''), null, '空串一路回 null')
      t.ok(Math.abs(zoomFromSlider(enter('20'), fit, max) - 20) < 0.05, '输入 20 应当真的落在 20×')
    }
  },
  {
    name: '接线守卫：缩放滑条是画布上的浮层，不进控制区行结构（D84 ①④）',
    run(t) {
      const html = readSrc('index.html')
      const css = readSrc('src/style.css')
      for (const id of ['zoombar', 'in-zoom', 'btn-zoom-in', 'btn-zoom-out', 'zoom-readout', 'in-zoombar', 'hud-scale'])
        t.ok(html.includes(`id="${id}"`), `index.html 缺 #${id}`)

      // 它必须长在 <main class="stage"> 里（画布那块），而不是顶栏/控制区里 ——
      // 进了控制区就会改动 D74 的六行与 D75 的位置恒定
      const stage = /<main class="stage">[\s\S]*?<\/main>/.exec(html)
      t.ok(!!stage && stage[0].includes('id="zoombar"'), '滑条必须在画布那块里')
      const topbar = /<(nav|header)[^>]*class="topbar"[\s\S]*?<\/\1>/.exec(html)
      t.ok(!topbar || !topbar[0].includes('id="zoombar"'), '滑条不许进顶栏')

      // 浮层：绝对定位 + D79 的「贴附」层（5），且**不许**带 grid-row（那是行结构才有的东西）
      const rule = /\.zoombar \{([^}]*)\}/.exec(css)
      t.ok(!!rule, 'CSS 里应有 .zoombar 规则')
      t.ok(/position:\s*absolute/.test(rule[1]), '滑条是浮层，绝对定位')
      t.ok(/z-index:\s*5\b/.test(rule[1]),
        '层级取 D79 的「贴附」层 5 —— 它贴着画布，抽屉与模态盖住它是对的')
      t.ok(!/grid-row/.test(rule[1]), '浮层不许进网格行结构（D74 六行、D75 位置恒定）')
      // 六行仍旧是六行：grid-row 的取值集合没有因为这轮多出新成员
      t.ok(/grid-template-rows:\s*auto 1fr auto auto auto/.test(css), '控制区仍是那几行')

      // 两端按钮 44px 触控下限
      const step = /\.zoombar \.zoom-step \{([^}]*)\}/.exec(css)
      t.ok(!!step && /width:\s*44px/.test(step[1]) && /height:\s*44px/.test(step[1]),
        '＋/－ 必须是 44×44，桌面上也不缩水')

      // 竖向滑块：现代写法与老 WebKit 写法都要写
      const vert = /#in-zoom \{([^}]*)\}/.exec(css)
      t.ok(!!vert && /writing-mode:\s*vertical/.test(vert[1]), '竖排要有 writing-mode 写法')
      t.ok(/@supports not \(writing-mode: vertical-lr\)[\s\S]{0,200}slider-vertical/.test(css),
        '老引擎的竖排写法要留着，但只能放在 @supports 兜底里 —— 自绘细轨要 appearance:none，两者不能同写（D85 ①）')
    }
  },
  {
    name: '接线守卫：淡出只在播放时，且 reduced-motion 下不做动画（D84 ②）',
    run(t) {
      const css = readSrc('src/style.css')
      const code = stripLiterals(readSrc('src/ui/zoom-bar.js'))
      t.equal(DIM_AFTER_MS, 2000, '播放后 2 秒淡出')
      t.equal(ZOOM_BUTTON_STEP, ZOOM_STEPS / 10, '一按 ＋/－ 走全程的 10% —— 与滑条同一把刻度')

      // 只有播放中才装淡出的计时器；暂停时永远留着（那时用户多半在调构图）
      t.ok(/if \(app\.running\)[^\n]*setTimeout/.test(code),
        '淡出计时器必须挂在"正在播放"这个条件上')
      // 碰画布浮回来。位置要在原文里找（事件名是字符串，剥掉就没了），
      // 是不是真调用则查剥过的版本 —— 两头都查，注释糊弄不过去（D83 §5）
      const rawInput = readSrc('src/ui/input.js')
      const input = stripLiterals(rawInput)
      const pd = /canvas\.addEventListener\('pointerdown'[\s\S]*?\n  \}\)/.exec(rawInput)
      t.ok(!!pd && /zoomBar\.wake\(\)/.test(pd[0]), '碰一下画布，淡出去的滑条要浮回来')
      t.ok(/zoomBar\.wake\(\)/.test(input), '那一句必须是真代码，不是注释里提了一嘴')

      // 淡出保留 ＋/－ 微弱可见：滑条 0，按钮 > 0
      const dimRange = /\.zoombar\.dim #in-zoom \{([^}]*)\}/.exec(css)
      const dimStep = /\.zoombar\.dim \.zoom-step \{([^}]*)\}/.exec(css)
      t.ok(!!dimRange && /opacity:\s*0\b/.test(dimRange[1]), '淡出时滑条退场')
      t.ok(!!dimStep, '淡出时 ＋/－ 要单独给不透明度')
      const stepOpacity = Number((/opacity:\s*([\d.]+)/.exec(dimStep[1]) || [])[1])
      t.ok(stepOpacity > 0 && stepOpacity < 0.5,
        `＋/－ 要留一点点可见（0 < ${stepOpacity} < 0.5）—— "还在这儿，只是让开了"`)

      // reduced-motion：不做淡入淡出
      t.ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,200}\.zoombar[^}]*transition:\s*none/.test(css),
        'prefers-reduced-motion 下不许做淡入淡出')
    }
  },
  {
    name: '接线守卫：方向键归图案，滑条显式让位（D84 ④）',
    run(t) {
      // 这一条查的是"有没有真的调用"，所以扫剥过注释的源码 —— 注释里写着函数名不算数（D83 §5）
      const rawZb = readSrc('src/ui/zoom-bar.js')
      const zb = stripLiterals(rawZb)
      const input = stripLiterals(readSrc('src/ui/input.js'))
      // 判据分两头：条件是真代码（剥过的版本里查），'Arrow' 这个字面量在原文里查
      t.ok(/if \(!app\.stamp \|\| !e\.key\.startsWith\(/.test(zb),
        '滑条要认出"选中图案时的方向键"这一情形')
      t.ok(/startsWith\('Arrow'\)/.test(rawZb), '认的是方向键这一组')
      t.ok(/preventDefault\(\)/.test(zb), '让位要显式 preventDefault —— 否则滑条也会动')
      t.ok(/app\.nudgeStamp\(/.test(zb), '让位之后走图案微调那条现成的路，不另写一份')
      t.ok(/app\.nudgeStamp = function/.test(input), 'nudgeStamp 应当是 app 上的一个动作')
      // 窗口按键也必须走同一个函数（两处各写一份的话，只有一份会记得"幽灵要脱开鼠标"）
      t.ok(/if \(app\.nudgeStamp\(e\.key\)\)/.test(input), '窗口按键也走 nudgeStamp')
      t.ok(/app\.armStampAt\(next\)/.test(input), '微调仍旧把位置钉进那唯一的待放态状态源')

      // 滚轮行为不变：滑条这一轮不许碰 wheel
      t.ok(!/wheel/.test(zb), '缩放滑条不许插手滚轮 —— 滚轮行为这一轮明确不变')

      // 缩放滑条自带换算，不能再被通用循环接一遍（接两遍会插出两个输入框）
      const controls = stripLiterals(readSrc('src/ui/controls.js'))
      t.ok(/CODEC_SLIDERS/.test(controls), '通用接线循环要跳过自带换算的滑条')
      t.equal(CODEC_SLIDERS.zoom, 'in-zoom', '缩放滑条自带换算')
      // 例外表长出第二个成员时，跳过的写法必须是"照表跳"而不是写死一个 id
      t.ok(/Object\.values\(CODEC_SLIDERS\)/.test(controls),
        '要按例外表整表跳过 —— 写死一个 id 的话，第二个自带换算的滑条会被接两遍（D86 ①）')
      t.ok(NUMERIC_SLIDERS.some(([r, l]) => r === 'in-zoom' && l === 'hud-scale'),
        '缩放滑条仍要登记在册，标签是 HUD 上那一格')
    }
  },
  {
    name: '词条：缩放滑条的中英与简洁语域齐备（D84）',
    run(t) {
      const keys = ['vis.zoomBar', 'tip.zoomBar', 'tip.zoom', 'tip.zoomIn', 'tip.zoomOut',
        'tip.zoomEntry', 'zoom.in', 'zoom.out']
      for (const lang of ['zh', 'en']) {
        for (const k of keys) {
          t.ok(typeof DICT[lang][k] === 'string', `${lang} 缺 ${k}`)
          t.ok(typeof DICT[lang][k + '.simple'] === 'string', `${lang} 缺简洁语域的 ${k}`)
        }
      }
      // 关掉滑条不等于关掉缩放 —— 提示里要说清这一点，否则用户以为自己把功能关没了
      t.ok(/滚轮/.test(DICT.zh['tip.zoomBar']) && /捏合/.test(DICT.zh['tip.zoomBar']),
        '中文提示要说明关掉后滚轮与捏合仍然可用')
      t.ok(/wheel/i.test(DICT.en['tip.zoomBar']) && /pinch/i.test(DICT.en['tip.zoomBar']),
        '英文提示同理')
      // 最小档就是「适配视图」，提示里也要说
      t.ok(/适配视图/.test(DICT.zh['tip.zoom']), '中文提示要点出最下面一档是适配视图')
      t.ok(/fit view/i.test(DICT.en['tip.zoom']), '英文提示同理')
    }
  },
  {
    name: '触摸行为：窄屏每一类可交互元素都要声明 touch-action（D85 ②a）',
    run(t) {
      // 不声明的，浏览器替你做主：iOS Safari 把落在控件上的双击当"放大页面"、
      // 两指当"缩放页面"，放大之后用户往往不知道怎么还原 —— 这正是这一轮的病。
      const html = readSrc('index.html')
      const css = readSrc('src/style.css')

      // 规则里的选择器清单
      const rule = /([^{}]+)\{\s*touch-action:\s*manipulation;\s*\}/.exec(css)
      t.ok(!!rule, 'CSS 里应有一条给可交互元素兜底的 touch-action 规则')
      const selectors = rule[1]

      // index.html 里真正出现的可交互元素类型，逐个要求被覆盖
      const KINDS = ['button', 'input', 'select', 'textarea', 'label', 'a']
      const present = KINDS.filter(tag => new RegExp('<' + tag + '[\\s>]').test(html))
      t.ok(present.includes('button') && present.includes('input'), '至少应扫到按钮与输入框')
      for (const tag of present)
        t.ok(new RegExp('(^|[,\\s])' + tag + '([,\\s]|$)').test(selectors),
          `index.html 里有 <${tag}>，touch-action 规则却没覆盖它`)
      // 数值输入会给标签动态加 role="button"，那也是可交互元素
      t.ok(/\[role="button"\]/.test(selectors), 'role="button" 的元素也要覆盖')
      t.ok(/attributes?|setAttribute\('role', 'button'\)/.test(readSrc('src/ui/numeric-entry.js')),
        '数值输入确实会加 role="button"（覆盖它才有意义）')

      // 直接操作型控件各自的取值
      t.ok(/#board \{[\s\S]*?touch-action:\s*none/.test(css), '画布自己吃掉全部手势')
      t.ok(/#in-zoom, \.zoombar, \.zoombar \.zoom-step \{[^}]*touch-action:\s*none/.test(css),
        '缩放滑条整块浮层都不让浏览器接管 —— 这一轮的病就发在它身上')
      t.ok(/input\[type="range"\] \{[^}]*touch-action:\s*pan-y/.test(css),
        '抽屉里的横向滑块取 pan-y：竖着划仍能滚抽屉，捏合被挡掉')
      // auto 等于"什么都没说"，一个都不许留
      t.ok(!/touch-action:\s*auto/.test(css), '不许有 touch-action: auto —— 那等于没声明')
    }
  },
  {
    name: '触摸行为：viewport 不去禁用页面缩放（D85 ②b 的裁决）',
    run(t) {
      const html = readSrc('index.html')
      const meta = /<meta name="viewport"[^>]*>/.exec(html)
      t.ok(!!meta, '应有 viewport meta')
      // 裁决：不写 maximum-scale / user-scalable=no。
      // 一是它在出问题的那个平台（iOS Safari）自 iOS 10 起被有意忽略，根本不生效；
      // 二是在生效的平台上它关掉的是一项真实的无障碍能力（WCAG 1.4.4）。
      // 把裁决钉在这里，是因为"顺手加上 maximum-scale=1"是最容易被重新犯的那一步。
      t.ok(!/maximum-scale/.test(meta[0]), 'viewport 里不许写 maximum-scale（D85 ②b）')
      t.ok(!/user-scalable/.test(meta[0]), 'viewport 里不许写 user-scalable（D85 ②b）')
      t.ok(/width=device-width/.test(meta[0]) && /initial-scale=1/.test(meta[0]), '该有的两项照旧')
      // 理由要写在旁边，不能只活在文档里
      t.ok(/D85/.test(html.slice(Math.max(0, meta.index - 400), meta.index)),
        'meta 旁边要留一句为什么不禁用缩放，并指向 D85')
    }
  },
  {
    name: '页面被放大之后的兜底提示（D85 ②c）',
    run(t) {
      t.equal(PAGE_ZOOM_THRESHOLD, 1.05, '阈值 1.05：静息值常有 1.0000001 这种毛刺')
      t.equal(isPageZoomed(1), false, '没放大就不提示')
      t.equal(isPageZoomed(1.0000001), false, '毛刺不算放大')
      t.equal(isPageZoomed(1.04), false, '阈值以下不提示')
      t.equal(isPageZoomed(1.06), true, '超过阈值才提示')
      t.equal(isPageZoomed(2.4), true, '放大很多当然提示')
      // 拿不到读数时宁可不提示，也不能对着没放大的人喊
      for (const bad of [undefined, null, NaN, 'abc', {}])
        t.equal(isPageZoomed(bad), false, `读不出倍数（${String(bad)}）时不提示`)

      const html = readSrc('index.html')
      t.ok(/id="page-zoom-hint"/.test(html), '提示元素要写在 HTML 里（接线守卫扫得到）')
      t.ok(/data-i18n="hint\.pageZoomed"/.test(html), '文案走词典')
      const src = stripLiterals(readSrc('src/ui/page-zoom.js'))
      t.ok(/addEventListener/.test(src) && /resize/.test(readSrc('src/ui/page-zoom.js')),
        '要挂在 visualViewport 的 resize 上')
      // 兜底本身不能成为新的故障点：没有 visualViewport 的浏览器要能照常开机
      t.ok(/if \(view && view\.addEventListener\)/.test(src),
        '老浏览器没有 visualViewport，那就什么也不做')
      for (const lang of ['zh', 'en']) {
        t.ok(typeof DICT[lang]['hint.pageZoomed'] === 'string', `${lang} 缺 hint.pageZoomed`)
        t.ok(typeof DICT[lang]['hint.pageZoomed.simple'] === 'string', `${lang} 缺简洁语域`)
      }
      // 提示要告诉用户**怎么还原**，不是只说"你被放大了"
      t.ok(/捏/.test(DICT.zh['hint.pageZoomed']), '中文要说清"捏一下就能还原"')
      t.ok(/pinch/i.test(DICT.en['hint.pageZoomed']), '英文同理')
    }
  },
  {
    name: '缩放滑条：视觉尺寸与触控尺寸分离（D85 ①）',
    run(t) {
      const css = readSrc('src/style.css')
      // 触控区：一格不缩
      const step = /\.zoombar \.zoom-step \{([^}]*)\}/.exec(css)
      t.ok(!!step && /width:\s*44px/.test(step[1]) && /height:\s*44px/.test(step[1]),
        '＋/－ 的触控区仍是 44×44')
      const range = /#in-zoom \{([^}]*)\}/.exec(css)
      t.ok(!!range && /width:\s*44px/.test(range[1]), '滑条的触控区宽度仍是 44px')

      // 视觉：轨道细、滑块小 —— 它是辅助控件，不该和棋盘争眼
      const track = /#in-zoom::-webkit-slider-runnable-track \{([^}]*)\}/.exec(css)
      const thumb = /#in-zoom::-webkit-slider-thumb \{([^}]*)\}/.exec(css)
      t.ok(!!track && !!thumb, '轨道与滑块都要自绘（原生的太粗）')
      const trackW = Number((/width:\s*(\d+)px/.exec(track[1]) || [])[1])
      const thumbW = Number((/width:\s*(\d+)px/.exec(thumb[1]) || [])[1])
      t.ok(trackW > 0 && trackW <= 6, `轨道要细（实为 ${trackW}px，限 ≤6px）`)
      t.ok(thumbW > 0 && thumbW <= 16, `滑块要小（实为 ${thumbW}px，限 ≤16px）`)
      t.ok(trackW < 44 && thumbW < 44, '视觉尺寸必须小于触控尺寸 —— 这两件事分开正是这一条的要点')
      // 火狐那套伪元素也要跟着做小，否则同一个控件两副面孔
      t.ok(/#in-zoom::-moz-range-track \{[^}]*width:\s*3px/.test(css), 'Firefox 的轨道同样要细')

      // 浮层整体存在感降一档：底板透明度更低
      const bar = /\.zoombar \{([^}]*)\}/.exec(css)
      const alpha = Number((/background:\s*rgba\([^)]*?,\s*([\d.]+)\)/.exec(bar[1]) || [])[1])
      t.ok(alpha > 0 && alpha <= 0.5, `浮层底板要更透（实为 ${alpha}，限 ≤0.5）`)
      t.ok(/border:\s*1px solid rgba\(/.test(bar[1]), '边框也要淡下来（用 rgba 而不是实色变量）')

      // 自绘要 appearance:none，于是老写法只能进 @supports 兜底 —— 两者不能同时写
      t.ok(/#in-zoom \{[^}]*appearance:\s*none/.test(css), '自绘轨道要 appearance: none')
      t.ok(/@supports not \(writing-mode: vertical-lr\)[\s\S]{0,200}slider-vertical/.test(css),
        '没有竖排 writing-mode 的老引擎要有兜底')
    }
  },
  {
    name: '临界实验室：密度轴与口径（D86 ①）',
    run(t) {
      // 口径三件套 —— 与内置精选局、自存收藏的生平同一把尺子（D82 §8）
      t.equal(CRITICAL_SPEC.board, 200, '默认盘 200')
      t.equal(CRITICAL_SPEC.boundary, 'torus', '默认环形')
      // 上限 8000 是量出来的：把上限提到 5 万重跑过，这条轴上最长的一档在第 6744 代定型，
      // 8000 是它再留两成余量。取 5000 的那一版会把四档记成"跑满未定型"（D86 §9）。
      t.equal(CRITICAL_SPEC.genCap, 8000, '代数上限 8000')
      t.ok(CRITICAL_SPEC.genCap >= 6744 * 1.15,
        '上限必须盖得住实测最长的那一档（6744 代）并留余量 —— 不然又会造出假的长暂态')

      const axis = densityAxis()
      t.equal(axis[0], 0.01, '轴从 0.01 起 —— 低端的跨越点（0.03–0.04）不能落在轴外')
      t.equal(axis[axis.length - 1], 0.95, '轴到 0.95')
      t.equal(axis.length, 27, `低端 10 档细步 + 高端 17 档粗步，实为 ${axis.length}`)
      t.equal(axis.slice(0, 4).join(','), '0.01,0.02,0.03,0.04', '低端走 0.01 的细步')
      t.equal(axis[10], 0.15, '过了 0.10 改走 0.05')
      for (const d of axis) t.equal(d, round3(d), `${d} 必须是收敛到 3 位小数的数`)
      const sorted = [...axis].sort((a, b) => a - b)
      t.equal(axis.join(','), sorted.join(','), '轴必须升序')
      t.equal(new Set(axis).size, axis.length, '轴上不许有重复档')
    }
  },
  {
    name: '临界实验室：跨越点是夹出来的，涌现窗口是推出来的（D86 ①）',
    run(t) {
      // 这条不跑仿真：拿构造出来的样本验纯函数，二分收敛与窗口合并才测得准、测得快
      const mk = (density, outcome, gens) => ({ density, outcome, gens, capped: false })
      const rows = [
        mk(0.01, 'quickDeath', 2), mk(0.02, 'shortCycle', 4), mk(0.03, 'shortCycle', 7),
        mk(0.04, 'shortCycle', 3089), mk(0.05, 'shortCycle', 1471), mk(0.80, 'shortCycle', 1327),
        mk(0.85, 'still', 7), mk(0.90, 'quickDeath', 2)
      ]
      // "有戏"要两条都满足：结局有结构，且撑得够久 —— 第 4 代就定住的十来个格子是余烬，不是涌现
      t.equal(isEmergent(rows[1]), false, '4 代就定型的 shortCycle 不算涌现')
      t.equal(isEmergent(rows[3]), true, '3089 代的 shortCycle 算涌现')
      t.equal(isEmergent({ ...mk(0.5, 'complex', 5000), capped: true }), true, '跑满上限的一律算数')
      t.equal(isEmergent(mk(0.9, 'explosion', 900)), false, '爆炸不在"有戏"那三类里')
      t.ok(EMERGENCE_MIN_GENS === 100, '门槛 100 代')

      const cr = findCrossings(rows)
      t.equal(cr.length, 2, '两个跨越点：低端一个、高端一个')
      t.equal(`${cr[0].lo}-${cr[0].hi}`, '0.03-0.04', '低端跨越点夹在 0.03 与 0.04 之间')
      t.equal(`${cr[1].lo}-${cr[1].hi}`, '0.8-0.85', '高端跨越点夹在 0.80 与 0.85 之间')

      // 二分：宽的那个要细化，已经够窄的不动
      const plan = planRefinements(rows, REFINE_WIDTH)
      t.equal(plan.join(','), '0.825', '只对还太宽的那个区间取中点')
      t.equal(planRefinements([mk(0.03, 'quickDeath', 2), mk(0.04, 'shortCycle', 3089)]).length, 0,
        '区间已经 ≤0.01 就不再细化 —— 否则永远收敛不了')
      // 反复细化必须真的收敛（拿假的采样器跑，不烧仿真）
      let fake = [mk(0.1, 'quickDeath', 2), mk(0.9, 'shortCycle', 3000)]
      let rounds = 0
      for (; rounds < 20; rounds++) {
        const next = planRefinements(fake, REFINE_WIDTH)
        if (!next.length) break
        for (const d of next) fake.push(mk(d, d < 0.5 ? 'quickDeath' : 'shortCycle', d < 0.5 ? 2 : 3000))
        fake.sort((a, b) => a.density - b.density)
      }
      t.ok(rounds <= 8, `二分要在 8 轮内收敛，实为 ${rounds} 轮`)
      const last = findCrossings(fake)[0]
      t.ok(last.hi - last.lo <= REFINE_WIDTH + 1e-9, `最终区间要 ≤${REFINE_WIDTH}，实为 ${(last.hi - last.lo).toFixed(4)}`)

      const wins = emergenceWindows(rows)
      t.equal(wins.length, 1, '一个涌现窗口')
      t.equal(`${wins[0].from}-${wins[0].to}`, '0.04-0.8', '窗口是连续"有戏"的那一段')
      // 窗口边界必须与跨越点对齐 —— 两个东西同源，对不上就是有一个算错了
      t.equal(wins[0].from, cr[0].hi, '窗口左端 = 低端跨越点的右侧')
      t.equal(wins[0].to, cr[1].lo, '窗口右端 = 高端跨越点的左侧')
      t.equal(CURVE_METRICS.join(','), 'final,gens,peak', '曲线三种纵轴')
    }
  },
  {
    name: '临界实验室：分类判据必须为密度轴重标定（D86 §1 的反面断言）',
    run(t) {
      // 勘探器的默认阈值是按"扫规则、密度固定 0.10"标定的。直接拿来扫密度会说谎：
      // explosionFlood 判的是绝对占比，而这条轴上密度正是自变量。
      // 这条把"我们确实换了判据"钉住 —— 哪天有人把 opts 删了，图上不会红，只会悄悄说谎。
      const life = { clauses: parseBS('B3/S23'), agingLayers: 0 }
      const dense = probeRule(life, { boardSize: 96, density: 0.90, genCap: 300, seed: 4271, boundary: 'torus' })
      t.equal(dense.outcome, 'explosion',
        '默认参数下，密度 0.90（其实是第 2 代就全灭）会被判成「爆炸」—— 这正是不能照搬的理由')

      // 换成临界实验室的判据：同一局必须得到"死得快"这一类
      const recal = probeRule(life, {
        boardSize: 96, density: 0.90, genCap: 300, seed: 4271, boundary: 'torus',
        ...CRITICAL_CLASSIFY
      })
      t.ok(recal.outcome === 'quickDeath' || recal.outcome === 'extinct',
        `重标定之后应当判成死得快/灭绝，实为 ${recal.outcome}`)
      t.ok(CRITICAL_CLASSIFY.explosionFlood > 1,
        '重标定的做法是停用"绝对占比"那一条（>1 即永不触发），不是改小它')
      // 重标定里**只准放分类判据**。第一版写成 {...DEFAULTS, explosionFlood: 1.01}，
      // 于是它把 density: 0.10 也带上了 —— 谁把它当 spec 传进去，被测的那一局就被悄悄换掉，
      // 而分类结果看着还挺合理。就是这条断言把它抓出来的。
      for (const k of ['boardSize', 'density', 'genCap', 'seed', 'boundary'])
        t.ok(!(k in CRITICAL_CLASSIFY),
          `重标定里不许出现「${k}」这种"跑什么局"的参数 —— 混进去会把被测的那一局换掉`)
      // "相对起点的增长"那一条仍然生效（没有被覆盖成别的值）
      t.equal(classifyRun({ end: null, growth: 3, finalFill: 0.3, maxFill: 0.3, variation: 0.2, gens: 100 },
        CRITICAL_CLASSIFY), 'explosion', '真的涨了三倍还占着三成，仍旧判爆炸')
    }
  },
  {
    name: '临界实验室：实跑三档的回归钉子（D86 ⑤）',
    run(t) {
      // 口径写死，数字就必须钉死。这三档一头一尾一中间，跨越点两侧各一个。
      const w = observeDensity(0.35)
      t.equal(w.start, 14127, '0.35 起步 14127 格')
      t.equal(w.gens, 3492, '第 3492 代定型')
      t.equal(w.end && w.end.type, 'cycle', '以循环收场')
      t.equal(w.end && w.end.period, 2, '周期 2')
      t.equal(w.peak, 14742, '峰值 14742')
      t.equal(w.peakGen, 1, '峰值在第 1 代')
      t.equal(w.final, 1355, '末态 1355')
      t.equal(w.finalCells.length, w.final, '缩略图的亮格数必须等于 final —— 缩略图不许撒谎')
      t.ok(isEmergent(w), '0.35 落在涌现窗口里')

      const dead = observeDensity(0.90)
      t.equal(dead.gens, 2, '0.90 第 2 代就全灭')
      t.equal(dead.final, 0, '一格不剩')
      t.equal(dead.finalCells.length, 0, '缩略图上一个亮格都没有')
      t.equal(dead.outcome, 'quickDeath', '重标定之后是"死得快"，不是"爆炸"')
      t.equal(isEmergent(dead), false, '不算涌现')

      // 0.82 是用户点名的那一档：上限 5000 时它是"跑满未定型"，看着像临界慢化；
      // 实测它在第 5120 代就定型了 —— 只差 120 代。这条钉住那个结论（D86 §9）。
      const slow = observeDensity(0.82)
      t.equal(slow.capped, false, '0.82 在 8000 代的上限内定得下来 —— 它不是长暂态')
      t.equal(slow.gens, 5120, '第 5120 代定型（只比旧上限 5000 多 120 代）')
      t.equal(slow.end && slow.end.period, 2, '归于周期 2')
      t.equal(slow.final, 971, '末态 971')
      t.equal(isLongTransient(slow), false, '不该再被标成长暂态')

      const edge = observeDensity(0.03)
      t.equal(edge.gens, 7, '0.03 第 7 代就定住')
      t.equal(edge.final, 31, '只剩 31 格')
      t.equal(isEmergent(edge), false, '7 代就定住的不算涌现 —— 低端跨越点就在它与 0.04 之间')
    }
  },
  {
    name: '临界实验室：分岔时刻的两个阈值与三个内置示例（D86 ②）',
    run(t) {
      t.equal(TWIN.escapeRadius, 2, '逃逸半径 2')
      t.equal(TWIN.mergeGens, 8, '连续 8 代差异为零算合并')
      t.equal(TWIN_EXAMPLES.length, 3, '三个内置示例')

      const run = key => {
        const ex = TWIN_EXAMPLES.find(x => x.key === key)
        const tw = createTwin({ pattern: ex.pattern, dx: ex.dx, dy: ex.dy, gens: 800 })
        tw.run(800)
        return tw
      }

      // ① Matt 那颗孤立格：第 3 代分道，此后再不合并
      const lonely = run('lonely')
      t.equal(lonely.diff[0], 1, '第 0 代差异恒为 1 —— 两个宇宙就差这一格，这是构造出来的')
      t.equal(lonely.diverged && lonely.diverged.gen, 3, '第 3 代分道扬镳')
      t.equal(lonely.merged, null, '永不合并')
      t.equal(Math.max(...lonely.diff), 396, '峰值差异 396')
      t.equal(lonely.diff.indexOf(396), 714, '峰值出现在第 714 代')

      // ② 贴着图案的空格：同样第 3 代分道
      const edge = run('edge')
      t.equal(edge.diverged && edge.diverged.gen, 3, '贴边那格也是第 3 代分道')
      t.equal(edge.merged, null, '也不合并')

      // ③ 真空里一格：孤格必死，两个宇宙第 8 代判为合并 —— 一声没响
      const vac = run('vacuum')
      t.equal(vac.diverged, null, '从未分道')
      t.equal(vac.merged && vac.merged.gen, 8, `连续 ${TWIN.mergeGens} 代为零 → 第 8 代判合并`)
      t.equal(Math.max(...vac.diff), 1, '差异最多就是最初那一格')
      t.equal(vac.diff[1], 0, '第 1 代那格就死了，差异归零')
      t.ok(vac.done, '合并即收工，不必再跑')
    }
  },
  {
    name: '临界实验室：差异只能沿光锥扩散（D86 几何断言）',
    run(t) {
      // 元胞自动机的内禀性质：第 g+1 代的差异格必然落在第 g 代差异格的 8 邻域里。
      // 它也是"差异高亮不会乱跳"的保证 —— 跳出去就说明比对错了盘。
      const ex = TWIN_EXAMPLES[0]
      const tw = createTwin({ pattern: ex.pattern, dx: ex.dx, dy: ex.dy, gens: 60 })
      const n = tw.spec.board
      let prev = new Set([tw.flip.y * n + tw.flip.x])
      for (let g = 1; g <= 60; g++) {
        tw.run(1)
        const now = diffCells(tw.a, tw.b)
        for (const i of now) {
          const x = i % n, y = (i / n) | 0
          let ok = false
          for (let dy = -1; dy <= 1 && !ok; dy++) for (let dx = -1; dx <= 1 && !ok; dx++) {
            const j = ((y + dy + n) % n) * n + ((x + dx + n) % n)
            if (prev.has(j)) ok = true
          }
          t.ok(ok, `第 ${g} 代的差异格 (${x},${y}) 必须落在上一代差异格的 8 邻域里`)
        }
        prev = new Set(now)
      }
      // 差异格数与外接框是同一趟扫描算出来的，两者必须自洽
      const m = measure(tw.a, tw.b, n)
      t.equal(m.count, diffCells(tw.a, tw.b).length, '差异格数与差异格集合必须一致')
      t.ok(m.x1 >= m.x0 && m.y1 >= m.y0, '外接框不许是空的')
    }
  },
  {
    name: '接线守卫：临界实验室与观塔/勘探并列，手机只留小多图带（D86 ④）',
    run(t) {
      const html = readSrc('index.html')
      const css = readSrc('src/style.css')
      const main = stripLiterals(readSrc('src/main.js'))
      for (const id of ['crit-view', 'crit-strip', 'crit-curve', 'crit-density', 'crit-lbl-density',
        'crit-start', 'crit-stop', 'crit-twin-pick', 'crit-twin-a', 'crit-twin-b', 'crit-twin-chart',
        'btn-critical'])
        t.ok(html.includes(`id="${id}"`), `index.html 缺 #${id}`)

      // 三个全屏视图互斥：名单驱动，不逐个 if —— 加第四个时漏掉一处 hide 就会两块叠在一起
      t.ok(/const VIEWS = \{[^}]*critical/.test(main), '视图名单里要有 critical')
      t.ok(/for \(const key of Object\.keys\(VIEWS\)\)/.test(main), '互斥要照名单整表来')
      t.ok(/openView\('critical'\)/.test(readSrc('src/main.js')), '顶栏按钮要能打开它')

      // 手机首版只放小多图带，其余隐藏并说明（照观塔/勘探的先例）
      t.ok(/@media \(max-width: 767px\)[\s\S]*?\.crit-desk \{ display: none; \}/.test(css),
        '窄屏要把曲线/滑块/分岔时刻收起来')
      t.ok(/\.crit-mobile-note \{ display: none; \}/.test(css) &&
        /@media \(max-width: 767px\)[\s\S]*?\.crit-mobile-note \{ display: block; \}/.test(css),
        '窄屏要显示那句说明，桌面上不显示')
      t.ok(/data-i18n="crit\.mobileOnly"/.test(html), '说明文案走词典')
      // 入口在窄屏**不隐藏**（与观塔/勘探不同）：手机上有小多图带可看
      t.ok(!/#btn-tower, #btn-explorer, #btn-critical \{ display: none/.test(css),
        '临界的入口不许跟着观塔/勘探一起在窄屏隐藏 —— 手机上它有东西可看')

      // 临界滑块登记进数值输入，且不被通用循环接第二遍
      t.ok(NUMERIC_SLIDERS.some(([r, l]) => r === 'crit-density' && l === 'crit-lbl-density'),
        '临界滑块要登记数值输入')
      t.equal(CODEC_SLIDERS.density, 'crit-density', '它自带换算（滑块存千分位，用户读写 0.xxx）')

      // Worker 只搬运：逻辑留在 data/ 里才测得到
      const wk = stripLiterals(readSrc('src/workers/critical.js'))
      t.ok(/observeDensity/.test(wk) && /planRefinements/.test(wk), 'Worker 调的是 data 层的纯函数')
      t.ok(!/function classify|Math\.pow|new LifeEngine/.test(wk), 'Worker 里不许自己写判据或跑引擎')

      // 词条齐备（含简洁语域）
      for (const lang of ['zh', 'en']) {
        for (const k of ['crit.open', 'crit.title', 'crit.stripTitle', 'crit.curveTitle',
          'crit.twinTitle', 'crit.mobileOnly', 'crit.specNote', 'crit.longTransient'])
          t.ok(typeof DICT[lang][k] === 'string', `${lang} 缺 ${k}`)
        t.ok(typeof DICT[lang]['crit.twinLead.simple'] === 'string', `${lang} 缺简洁语域的开场白`)
      }
      // 那句话是这一节的立意，写进文案里
      t.ok(/一声没响/.test(DICT.zh['crit.twinLead']), '中文要留住"位置决定它是历史的开端，还是一声没响"')
      t.ok(/nothing at all/i.test(DICT.en['crit.twinLead']), '英文同理')
      // 图注要答得上"这个数是被什么裁出来的"
      t.ok(/\{board\}/.test(DICT.zh['crit.specNote']) && /\{seed\}/.test(DICT.zh['crit.specNote']) &&
        /\{cap\}/.test(DICT.zh['crit.specNote']), '口径注里要写全盘面、种子、代数上限')
    }
  },
  {
    name: '临界实验室：锁定时刻只出一个数字（D86 ③）',
    run(t) {
      // 口径：死边界是实测逼出来的 —— 环形盘上一格能生出滑翔机绕盘乱撞，
      // 两个结局不同的基准局在各自最后一代都仍翻得动，"锁定"根本不存在（D86 §11）。
      t.equal(LOCKIN_SPEC.boundary, 'dead', '锁定时刻的口径必须是死边界')
      t.equal(LOCKIN_SPEC.board, 48, '小盘：这是一次性勘探任务，要在几十秒内出一个数字')

      const r = findLockIn()
      t.equal(r.baseline, 'shortCycle', '基准局以短周期循环收场')
      t.equal(r.settleGen, 586, '基准局第 586 代定型')
      t.equal(r.gen, 581, '命运在第 581 代锁定 —— 比定型早 5 代')
      t.equal(r.flip.to, 'still', '那一格翻过去，结局从短周期变成静止')
      t.equal(r.scanned, 6, '往回扫了 6 代就找到了')
      t.equal(r.probes, 1228, '一共试了 1228 格')

      // 抽样上限在尾部根本没起作用：候选集本身不足 400 格，把上限放到 5000 答案一模一样。
      // 也就是说这个数在尾部是**穷举**出来的，不是抽出来的 —— 这条值得钉住。
      const full = findLockIn({ sampleCells: 5000 })
      t.equal(full.gen, r.gen, '把抽样上限放到 5000，答案不变')
      t.equal(full.probes, r.probes, '试的格数也一样 —— 尾部的候选集本来就不足 400')

      // 候选格只取活格与它们的 8 邻域（真空里翻一格必然自灭，试它是白花钱）
      const n = 8
      const cells = new Uint8Array(n * n)
      cells[9] = 1                                   // (1,1) 一个活格
      const cand = candidateCells(cells, n, 100, 1)
      t.equal(cand.length, 9, '一个活格 → 它自己 + 8 个邻居')
      t.ok(cand.includes(9) && cand.includes(0) && cand.includes(18), '邻域取对了')
      // 抽样必须可复现：同一颗种子必得同一批格子，否则这个数字每跑一次都不一样
      const big = new Uint8Array(n * n).fill(1)
      t.equal(candidateCells(big, n, 10, 42).join(','), candidateCells(big, n, 10, 42).join(','),
        '同种子同结果')
      t.ok(candidateCells(big, n, 10, 42).join(',') !== candidateCells(big, n, 10, 43).join(','),
        '换种子换一批')
    }
  },
  {
    name: '临界实验室：不用二分是因为这条性质不单调（D86 §11 的证据）',
    run(t) {
      // 方案里原本写的是"代数上二分"。二分要求"越晚越难翻盘"，而实测它不成立：
      // 同一局里第 971 代翻不动，第 1000 代又翻得动。这两条就是改成倒扫的理由。
      const spec = { ...LOCKIN_SPEC, boundary: 'torus', density: 0.30, seed: 4271 }
      const states = baselineStates(spec)
      const base = runToEnd(states[0], spec)
      t.equal(base.outcome, 'shortCycle', '环形口径下的基准局')
      t.equal(base.gens, 1029, '第 1029 代定型')
      // 实测这一段是交替的：1001 不动、1002 动、1005 不动、1006 动…… 翻得动与翻不动沿代数交替出现。
      t.equal(canFlipAt(states, 1001, base.outcome, spec).flippable, false, '第 1001 代翻不动')
      t.equal(canFlipAt(states, 1002, base.outcome, spec).flippable, true, '第 1002 代又翻得动')
      // 源码上钉住：不许再出现二分
      const src = stripLiterals(readSrc('src/data/lockin.js'))
      t.ok(/for \(let gen = last; gen >= stop; gen--\)/.test(src), '要从最后一代往回扫')
      t.ok(!/lo = mid \+ 1|hi = mid - 1/.test(src), '不许再用二分 —— 它在这条性质上给出的是运气，不是事实')
    }
  },
  {
    name: '接线守卫：锁定时刻是一次性任务，只出一个数字（D86 ③）',
    run(t) {
      const html = readSrc('index.html')
      for (const id of ['crit-lock-run', 'crit-lock-number', 'crit-lock-note'])
        t.ok(html.includes(`id="${id}"`), `index.html 缺 #${id}`)
      // 它属于桌面那一档（手机首版只留小多图带）
      const block = /<section class="crit-block crit-desk">\s*<h3[^>]*data-i18n="crit\.lockTitle"/.test(html)
      t.ok(block, '锁定时刻那一节要挂 crit-desk —— 手机上不出现')
      // Worker 只搬运
      const wk = stripLiterals(readSrc('src/workers/lockin.js'))
      t.ok(/findLockIn/.test(wk), 'Worker 调的是 data 层的纯函数')
      t.ok(!/new LifeEngine|classifyRun/.test(wk), 'Worker 里不许自己跑引擎或写判据')
      t.ok(/postMessage\(\{ type: 'progress'/.test(readSrc('src/workers/lockin.js')),
        '倒扫要报进度 —— 这件事可能几十秒，用户得看得见它在动')
      // 词条：中英 + 简洁语域
      for (const lang of ['zh', 'en']) {
        for (const k of ['crit.lockTitle', 'crit.lockLead', 'crit.lockRun', 'crit.lockGen', 'crit.lockNote', 'crit.lockNone'])
          t.ok(typeof DICT[lang][k] === 'string', `${lang} 缺 ${k}`)
        t.ok(typeof DICT[lang]['crit.lockTitle.simple'] === 'string', `${lang} 缺简洁语域`)
      }
      // 图注要把口径与两处判断讲清楚：为什么死边界、为什么不二分
      t.ok(/死边界/.test(DICT.zh['crit.lockNote']) && /不用二分/.test(DICT.zh['crit.lockNote']),
        '中文图注要说清死边界与不二分的理由')
      t.ok(/dead edge/i.test(DICT.en['crit.lockNote']) && /bisection/i.test(DICT.en['crit.lockNote']),
        '英文图注同理')
    }
  },
  {
    name: '选中图案：那一行操作提示会自我宣告（D87 ①）',
    run(t) {
      const html = readSrc('index.html')
      const css = readSrc('src/style.css')
      t.ok(/id="stamp-hint"/.test(html), '提示条要写在 HTML 里')
      t.ok(/data-i18n="stamp\.hint\.desk"/.test(html) && /data-i18n="stamp\.hint\.touch"/.test(html),
        '桌面与触屏两句都要在，文案走词典')
      // 显示与否只看 body.stamp-active —— 状态本来就在那儿，再写一份 JS 就会有对不上的那天
      t.ok(/\.stamp-hint \{[^}]*display: none/.test(css), '没选中图案时不占地方')
      t.ok(/body\.stamp-active \.stamp-hint \{ display: block; \}/.test(css), '选中即出现')
      const main = stripLiterals(readSrc('src/main.js'))
      t.ok(/classList\.toggle\('stamp-active', !!pattern\)/.test(readSrc('src/main.js')),
        'stamp-active 这个 class 必须跟着选中状态走 —— 提示条的显示全靠它')
      // 这一条查的是"有没有出现"，而元素 id 是字符串 —— 必须扫原文。
      // 剥过的版本里字符串是空的，`getElementById('stamp-hint')` 会变成 `getElementById('')`，
      // 于是这条禁令永远不会红（自查时抓到过一次，同 D83 §5 那一类）。
      //
      // 禁的是"在 JS 里开关它的显示"，不是"碰都不许碰"：D88 ① 要给它加一下高亮的 class，
      // 那是装饰不是状态。显示与否仍旧只由 body.stamp-active + CSS 决定。
      const rawMain = readSrc('src/main.js')
      t.ok(!/stamp-hint'\)\.hidden|stamp-hint'\)\.style/.test(rawMain),
        '不许在 JS 里直接开关提示条的显示（D87 ①）')
      const tipLines = (rawMain.match(/getElementById\('stamp-hint'\)[\s\S]{0,80}/g) || [])
      t.ok(tipLines.every(x => /classList/.test(x)),
        '对提示条只许加/去 class —— 显示与否是 CSS 的事')
      // 桌面/触屏各显示各的
      t.ok(/\.stamp-hint-touch \{ display: none; \}/.test(css), '桌面只显示键盘那一句')
      t.ok(/@media \(max-width: 767px\)[\s\S]*?\.stamp-hint-desk \{ display: none; \}/.test(css),
        '窄屏只显示触屏那一句')
      // 五件事一件不少（桌面），三件事一件不少（触屏）
      for (const lang of ['zh', 'en']) {
        const desk = DICT[lang]['stamp.hint.desk']
        const touch = DICT[lang]['stamp.hint.touch']
        t.ok(typeof desk === 'string' && typeof touch === 'string', `${lang} 缺提示词条`)
        t.equal(desk.split('·').length, 5, `${lang} 桌面那句要列五件事：旋转/镜像/微调/放下/取消`)
        t.equal(touch.split('·').length, 4,
          `${lang} 触屏那句要列四件事：旋转/翻转/摆好/再点一下放下（两步放置之后多了一步，D89 ①）`)
        t.ok(typeof DICT[lang]['stamp.hint.desk.simple'] === 'string', `${lang} 缺简洁语域`)
        t.ok(typeof DICT[lang]['stamp.hint.touch.simple'] === 'string', `${lang} 缺简洁语域`)
      }
      t.ok(/⟳/.test(DICT.zh['stamp.hint.touch']) && /⇋/.test(DICT.zh['stamp.hint.touch']),
        '触屏那句要用画布上那两颗按钮的同一个符号 —— 说的和看到的必须是一个东西')
    }
  },
  {
    name: '选中图案：卡片缩略图就是当前朝向，且与放下去的同源（D87 ②④）',
    run(t) {
      // D70 类的承诺对账：卡上显示的必须就是放下去的。
      // 做法不是"两处都记得转"，而是**两处调同一个函数**。
      const lib = stripLiterals(readSrc('src/ui/library.js'))
      t.ok(/app\.stampPattern\(\)/.test(lib), '选中的那张卡要按 app.stampPattern() 画')
      t.ok(!/transformPattern/.test(lib),
        'library 里不许自己再调一次 transformPattern —— 那就是第二份实现，迟早与落子对不上')
      const main = stripLiterals(readSrc('src/main.js'))
      const place = /app\.placeStampAt = function[\s\S]*?\n\}/.exec(main)
      t.ok(!!place && /app\.stampPattern\(\)/.test(place[0]), '落子也走同一个函数')

      // 变换本身仍是 D81 那个纯函数：转四次回原样、翻两次回原样
      const p = getPattern('matt')
      const four = transformPattern(transformPattern(transformPattern(transformPattern(p, { rot: 1, flip: false }),
        { rot: 1, flip: false }), { rot: 1, flip: false }), { rot: 1, flip: false })
      t.equal(JSON.stringify(four.cells.slice().sort()), JSON.stringify(p.cells.slice().sort()), '转四次回原样')
      // 非方图案转一次要换边：卡片上的尺寸标签也跟着换
      const once = transformPattern(p, { rot: 1, flip: false })
      t.equal(`${once.w}×${once.h}`, `${p.h}×${p.w}`, '3×4 转一次应当变成 4×3')
      t.ok(/shown\.w/.test(lib) && /shown\.h/.test(lib), '卡上的尺寸标签也要用变换后的图案，不能还写原图的')

      // 每次变换轻弹一句，且带上朝向名
      t.equal(orientToastKey('rotate'), 'stamp.rotated', '旋转有自己的一句')
      t.equal(orientToastKey('flip'), 'stamp.flipped', '镜像有自己的一句')
      t.equal(orientLabel({ rot: 0, flip: false }), 'SE', '默认朝向 SE（与 docs/patterns.md 同一套说法）')
      t.equal(orientLabel({ rot: 2, flip: false }), 'NW', '转两次朝 NW')
      t.equal(orientLabel({ rot: 1, flip: true }), 'SW′', '镜像过的带一撇')
      for (const lang of ['zh', 'en']) {
        for (const k of ['stamp.rotated', 'stamp.flipped']) {
          t.ok(typeof DICT[lang][k] === 'string', `${lang} 缺 ${k}`)
          t.ok(DICT[lang][k].includes('{orient}'), `${lang} 的 ${k} 要把当前朝向说出来`)
        }
      }
    }
  },
  {
    name: '手机两步放置：确认之前引擎一个字都不碰（D89 ①）',
    run(t) {
      // 点一下 = 摆个幽灵，再点一下（点在幽灵身上）= 落子，点空白 = 取消。
      t.equal(tapAction({ pending: false, insideGhost: false }), 'arm', '还没摆 → 先摆一个幽灵')
      t.equal(tapAction({ pending: false, insideGhost: true }), 'arm', '没进待放态时，点哪儿都是摆')
      t.equal(tapAction({ pending: true, insideGhost: true }), 'confirm', '点在幽灵身上 = 确认放下')
      t.equal(tapAction({ pending: true, insideGhost: false }), 'cancel', '点空白 = 取消')
      t.equal(tapAction(null), 'arm', '缺参数时按最无害的那条走')

      // 命中判定用外接框，含边界
      const p = { w: 3, h: 4 }
      t.equal(insideGhostBox({ x: 10, y: 10 }, { x: 10, y: 10 }, p), true, '左上角算命中')
      t.equal(insideGhostBox({ x: 12, y: 13 }, { x: 10, y: 10 }, p), true, '右下角算命中')
      t.equal(insideGhostBox({ x: 13, y: 13 }, { x: 10, y: 10 }, p), false, '出框就不算')
      t.equal(insideGhostBox({ x: 9, y: 10 }, { x: 10, y: 10 }, p), false, '左边一格也不算')
      t.equal(insideGhostBox(null, { x: 0, y: 0 }, p), false, '没有点就不算命中')

      // **确认之前不许碰引擎与记账**（D67 那条原则）：摆幽灵那条路上不许出现落子的动作
      const main = stripLiterals(readSrc('src/main.js'))
      const arm = /app\.armStampAt = function[\s\S]*?\n\}/.exec(main)
      t.ok(!!arm, '应有"摆一个待放幽灵"的动作')
      for (const forbidden of ['placePattern', 'placeStampAt', 'noteEdit', 'markDirtyRun', 'captureBaseline']) {
        t.ok(!new RegExp(forbidden).test(arm[0]),
          `摆幽灵时不许调 ${forbidden} —— 确认之前这一局的历史里什么都没发生`)
      }
      const confirm = /app\.confirmStamp = function[\s\S]*?\n\}/.exec(main)
      t.ok(!!confirm && /app\.placeStampAt\(/.test(confirm[0]), '确认那一步才落子')
      t.ok(/app\.cancelPending\(/.test(confirm[0]), '落子之后要走那唯一的出口退出待放态')

      // 触屏走两步、桌面照旧一步
      const rawInp = readSrc('src/ui/input.js')
      const inp = stripLiterals(rawInp)
      t.ok(/if \(!isTouch\(e\)\) \{ app\.placeStampAt\(/.test(inp), '桌面仍是点一下就放')
      // 模式名是字符串 —— 查它用原文（D88 §3 那条规矩）
      t.ok(/mode = 'stamp'/.test(rawInp), '触屏进两步放置那条路')
      t.ok(/app\.armStampAt\(/.test(inp) && /app\.confirmStamp\(\)/.test(inp) && /app\.cancelPending\(\)/.test(inp),
        '三条出路都要接上')
      // Esc 一次退一层：先退待放，再退选中
      t.ok(/if \(app\.pendingStamp\) app\.cancelPending\(/.test(inp), 'Esc 先取消待放')

      // 「放下」按钮：待放态才出现
      const html = readSrc('index.html')
      t.ok(/id="btn-drop"[^>]*hidden/.test(html), '「放下」按钮默认藏着')
      t.ok(/data-i18n="stamp\.drop"/.test(html), '按钮文案走词典')
      for (const lang of ['zh', 'en']) {
        t.ok(typeof DICT[lang]['stamp.drop'] === 'string', `${lang} 缺「放下」`)
        t.ok(typeof DICT[lang]['stamp.drop.simple'] === 'string', `${lang} 缺简洁语域`)
      }

      // 闪现方案退役：连同常量与纯函数一起撤走，别留"暂时没人调"的代码
      const hint = readSrc('src/ui/stamp-hint.js')
      t.ok(!/GHOST_FLASH|ghostFlashAlpha|ghostFlashDone/.test(hint),
        '闪现的常量与纯函数要一并删掉（D89 ①：被取代的机制不留半截）')
      t.ok(!/flashGhost/.test(stripLiterals(readSrc('src/main.js'))), '主循环里也不留闪现的痕迹')
    }
  },
  {
    name: '动向线：方向一律实测，一个都不许手写（D88 ②）',
    run(t) {
      // 登记表只说"这个图案有没有方向、属哪一类"，向量本身永远是跑出来的。
      t.equal(Object.keys(MOTION_KINDS).sort().join(','), 'eater,glider,gun,hwss,lwss,mwss,snark',
        '有方向的七个：三条飞船 + 滑翔机 + 枪 + 吞食者 + 反射器')
      for (const key of ['pulsar', 'rpentomino', 'matt', 'block', 'beehive', 'qbshuttle']) {
        t.ok(!MOTION_KINDS[key], `${key} 没有方向 —— 给它画箭头就是在编方向`)
        t.equal(motionOf(getPattern(key)), null, `${key} 不许量出方向来`)
      }

      // 滑翔机：与 D81 实测的那组一致（40 代位移 +10,+10 → 每 4 代走 (1,1)，朝 SE）
      const g = motionNow(getPattern('glider'), { rot: 0, flip: false })
      t.equal(`${g.dx},${g.dy}/${g.gens}`, '1,1/4', '滑翔机每 4 代走 (1,1)，朝 SE')
      t.equal(g.kind, 'ship', '它是飞船那一类')
      // 轻量飞船：横着走，c/2
      const l = motionNow(getPattern('lwss'), { rot: 0, flip: false })
      t.equal(`${l.dx},${l.dy}/${l.gens}`, '-1,0/2', '轻量飞船每 2 代走一格，朝西')
      // 枪：只报方向不报速度（射出去的会越攒越多，那团东西的质心速度不是任何一架的速度）
      const gun = motionNow(getPattern('gun'), { rot: 0, flip: false })
      t.equal(`${gun.dx},${gun.dy}`, '1,1', '枪的弹道朝 SE')
      t.equal(gun.gens, null, '枪不报"几代走几格" —— 算得出但意思不对的数比不报更糟')
      // 吞食者：方向是"可吞食的那条斜线"，而且是把滑翔机喂进去**真吃掉**才算数
      const e = motionNow(getPattern('eater'), { rot: 0, flip: false })
      t.equal(`${e.dx},${e.dy}`, '1,1', '默认朝向的吞食者吃的是从 NW 飞来的（沿 +1,+1 撞进来）')
      t.ok(e.eatenAt > 0 && e.eatenAt < 60, `喂进去确实被吃掉了（第 ${e.eatenAt} 代）`)

      // **禁止手写方向**：源码里不许出现方向常量表
      const src = readSrc('src/engine/motion.js')
      t.ok(!/dx:\s*-?[12]\b/.test(src.replace(/dx: dx/g, '')),
        'motion.js 里不许写死 dx 常量 —— 方向只能是量出来的')
      t.ok(/measureShip/.test(src) && /measureGun/.test(src) && /measureEater/.test(src), '三种测法都要在')
      // 吞食者那一趟的判据必须是"逐格复原"，不是"活细胞数对得上"（D64 互动型标准）
      t.ok(/sameBoard\(e\.cur, before\)/.test(src),
        '喂食判据要逐格比对：只看数目的话，吞食者被撞坏、别处多出几格也能凑出同一个数')
      const lib = readSrc('src/engine/patterns.js')
      t.ok(!/motion|heading|direction/i.test(lib.replace(/方向/g, '')),
        '图案表里不许夹带方向元数据 —— 那就是手写的方向')
    }
  },
  {
    name: '动向线：转过之后重新实测，与把向量转一遍必须一致（D88 ②）',
    run(t) {
      // 这是这一条的关键断言：线指的方向与放下去之后真会发生的事，必须是同一件事。
      // 做法是把图案按朝向变换后**重新实测**，再与"把原向量按同一朝向转一遍"比对。
      const EIGHT = [{ rot: 1, flip: false }, { rot: 2, flip: false }, { rot: 3, flip: false },
        { rot: 0, flip: true }, { rot: 1, flip: true }, { rot: 2, flip: true }, { rot: 3, flip: true }]
      for (const key of ['glider', 'lwss', 'gun']) {
        const base = motionNow(getPattern(key), { rot: 0, flip: false })
        for (const o of EIGHT) {
          const measured = motionNow(getPattern(key), o)
          const expected = rotateVector(base, o)
          t.equal(`${measured.dx},${measured.dy}`, `${expected.dx},${expected.dy}`,
            `${key} 转成 ${JSON.stringify(o)} 之后，实测方向应与转过的向量一致`)
        }
      }
      // 吞食者：八个朝向都要**真的吃得到**（吃不到就该返回 null，而不是照画一条线）。
      // 这也是 D81 那张四朝向表的另一种复核：来路跟着朝向转，一格都不许差。
      const eBase = motionNow(getPattern('eater'), { rot: 0, flip: false })
      for (const o of EIGHT) {
        const m = motionNow(getPattern('eater'), o)
        t.ok(m && m.eatenAt > 0, `${JSON.stringify(o)} 的吞食者仍要真的吃得到（第 ${m && m.eatenAt} 代吞完）`)
        const expected = rotateVector(eBase, o)
        t.equal(`${m.dx},${m.dy}`, `${expected.dx},${expected.dy}`, '来路方向也要跟着转')
      }
      // 探针盘不能太小：第一版把盘子缩到 60 又让图案从四分之一处出发，
      // 轻量飞船 40 代走 20 格正好撞边，量出来的方向直接是错的（-13,3）。
      t.equal(`${motionNow(getPattern('lwss'), { rot: 0, flip: false }).dx},${motionNow(getPattern('lwss'), { rot: 0, flip: false }).dy}`,
        '-1,0', '轻量飞船必须是干净的 (-1,0)，不是撞墙撞出来的怪数')
    }
  },
  {
    name: '动向线：几何与开关（D88 ②）',
    run(t) {
      // 线一路画到棋盘边（D89 ②）：截一段固定长度等于替用户决定"看这么远就够了"，
      // 而他要判断的恰恰是"这条线会不会撞上那个东西"。
      const B = { w: 200, h: 200 }
      const ship = rayEnds('ship', { x: 100, y: 100 }, { dx: 1, dy: 1 }, B)
      t.equal(`${ship.from.x},${ship.from.y}`, '100,100', '飞船的线从图案本身出发')
      t.equal(`${ship.to.x},${ship.to.y}`, '200,200', '一直画到棋盘角上')
      t.equal(ship.arrowAt, 'to', '箭头在远端 —— 它要去那儿')
      t.equal(ship.solidEnd, 'from', '渐变的浓端在图案那一头')
      // 吞食者：线画在来路上，箭头指回嘴，浓端也在图案那一头
      const eat = rayEnds('eater', { x: 100, y: 100 }, { dx: 1, dy: 1 }, B)
      t.equal(`${eat.from.x},${eat.from.y}`, '0,0', '来路一直退到棋盘另一角')
      t.equal(`${eat.to.x},${eat.to.y}`, '100,100', '另一端落在图案上')
      t.equal(eat.arrowAt, 'to', '箭头指向嘴')
      t.equal(eat.solidEnd, 'to', '浓端在图案（也就是嘴）那一头')
      // 横着走的飞船只吃一个方向的边界
      const west = rayEnds('ship', { x: 100, y: 40 }, { dx: -1, dy: 0 }, B)
      t.equal(`${west.to.x},${west.to.y}`, '0,40', '朝西的线画到左边缘')
      // 拿不到棋盘尺寸时退回兜底长度，绝不画出盘外去
      const fb = rayEnds('ship', { x: 10, y: 10 }, { dx: 1, dy: 0 }, null)
      t.equal(fb.to.x - fb.from.x, RAY_FALLBACK, `没有棋盘尺寸时退回兜底长度 ${RAY_FALLBACK}`)
      // 贴着边的图案：线长可以是零点几格，但不许是负的
      const edge = rayEnds('ship', { x: 199.5, y: 100 }, { dx: 1, dy: 0 }, B)
      t.ok(edge.to.x >= 199.5 && edge.to.x <= 200, '贴边时线不许倒着画')

      // 渲染那一头：浓端与箭头端是两件事，各画各的
      const r = readSrc('src/render/renderer.js')
      t.ok(/createLinearGradient\(near\.x, near\.y, far\.x, far\.y\)/.test(r), '远端要渐淡')
      t.ok(/const near = solidEnd === 'to' \? b : a/.test(r), '浓端跟着 solidEnd 走，不是跟着箭头走')
      t.ok(/globalAlpha = 0\.85[\s\S]{0,400}closePath\(\); ctx\.fill\(\)/.test(r),
        '箭头是实的 —— 它标的是"哪一头要紧"，不该跟着淡掉')

      // 落子后线消失、可在设置里关：线只在幽灵存在且开关打开时画
      const main = stripLiterals(readSrc('src/main.js'))
      t.ok(/if \(app\.visualOpts\.motionRay\)/.test(main), '动向线要能在设置里关掉')
      t.ok(/if \(gp && gc\) \{[\s\S]{0,700}drawMotionRay/.test(main),
        '线画在"有幽灵"这个条件里 —— 落子之后幽灵没了，线自然也没了')
      const html = readSrc('index.html')
      t.ok(/id="in-motion-ray"/.test(html), '设置里要有那个开关')
      t.ok(/data-i18n="vis\.motionRay"/.test(html), '开关文案走词典')
      for (const lang of ['zh', 'en']) {
        t.ok(typeof DICT[lang]['vis.motionRay'] === 'string', `${lang} 缺开关文案`)
        t.ok(typeof DICT[lang]['vis.motionRay.simple'] === 'string', `${lang} 缺简洁语域`)
        t.ok(typeof DICT[lang]['tip.motionRay'] === 'string', `${lang} 缺提示`)
      }
      // 界面取动向线是**异步**的：没量过先回 null，量完再叫醒 —— 吞食者最慢要两百毫秒，
      // 不能卡在渲染那一帧里
      const src = stripLiterals(readSrc('src/engine/motion.js'))
      t.ok(/setTimeout\(run, 0\)/.test(src), '没量过的要让出这一帧再量')
      t.equal(motionCached({ key: 'pulsar' }, { rot: 0, flip: false }), null, '没方向的图案永远回 null')
      t.equal(motionKey('glider', { rot: 5, flip: true }), 'glider:1:true', '缓存键要把朝向归一')
      const mainSrc = stripLiterals(readSrc('src/main.js'))
      t.ok(/motionCached\(app\.stamp, app\.stampOrient, \(\) => \{ app\.dirty = true \}\)/.test(mainSrc),
        '界面要传一个"量完叫我"的回调，否则线永远出不来')

      // 质心是这一切的地基，单独验一次
      const e = new LifeEngine(8, 8, { rule: lifeRule(), boundary: 'dead' })
      e.set(1, 1, 1); e.set(3, 1, 1); e.stats.alive = 2
      const c = centroid(e)
      t.equal(`${c.x},${c.y},${c.n}`, '2,1,2', '质心算对')
      t.equal(centroid(new LifeEngine(4, 4, { rule: lifeRule() })), null, '空盘没有质心')
    }
  },
  {
    name: '首次选中的指向性气泡：用过一次就不再出现（D88 ①）',
    run(t) {
      // 提示要长在动作发生的位置上 —— 这是这一条的立意，写成了"气泡贴在 ⟳/⇋ 旁边"。
      const html = readSrc('index.html')
      const css = readSrc('src/style.css')
      t.ok(/<div class="stamp-tools"[\s\S]*?id="stamp-tip"[\s\S]*?<\/div>/.test(html),
        '气泡必须长在那两颗按钮所在的容器里，不是画布另一角')
      t.ok(/\.stamp-tip::before/.test(css), '要有个尖角指着按钮 —— 指向性就在这一笔上')
      t.ok(/data-i18n="stamp\.tip"/.test(html), '文案走词典')

      // 只冒到"用过一次"为止
      t.equal(shouldShowStampTip(null, true), true, '没用过 + 选中了 → 冒')
      t.equal(shouldShowStampTip('1', true), false, '用过了就不再冒')
      t.equal(shouldShowStampTip(null, false), false, '没选中图案时不冒')
      t.ok(PREF_KEYS.includes('stampTipSeen'), '这条偏好要登记进白名单（三判据见 D84 ③）')
      const main = stripLiterals(readSrc('src/main.js'))
      t.ok(/app\.markStampTipUsed\(\)/.test(main), '转过或翻过一次就要记下来')
      // "必须真的调用"要查**剥过注释**的版本，"必须出现某个字符串"要查**原文** ——
      // 两者都要，就两条都写：只查原文的话，把那一行注释掉守卫照样绿（自查时抓到过）。
      const mark = /app\.markStampTipUsed = function[\s\S]*?\n\}/.exec(main)
      t.ok(!!mark && /prefs\.set\(/.test(mark[0]), '记这件事必须是真代码，不能是注释掉的一行')
      t.ok(/'stampTipSeen'/.test(readSrc('src/main.js')), '记的就是那个偏好键')

      // 桌面没有那两颗按钮，改成把提示行短暂高亮
      t.ok(/\.stamp-hint\.flash/.test(css), '桌面首次选中要把提示行高亮一下')
      t.ok(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,120}\.stamp-hint\.flash \{ animation: none/.test(css),
        'reduced-motion 下不做动画')
      for (const lang of ['zh', 'en']) {
        t.ok(typeof DICT[lang]['stamp.tip'] === 'string', `${lang} 缺气泡文案`)
        t.ok(typeof DICT[lang]['stamp.tip.simple'] === 'string', `${lang} 缺简洁语域`)
        t.ok(/⟳/.test(DICT[lang]['stamp.tip']) && /⇋/.test(DICT[lang]['stamp.tip']),
          `${lang} 的气泡要用按钮上的那两个符号`)
      }
    }
  },
  {
    name: '临界实验室：手机上那几句人话（D89 ③）',
    run(t) {
      // 每档一句人话，数字全来自这一档自己的实测，措辞走词典。
      const tr = (k, p) => k + ':' + JSON.stringify(p || {})
      const dead = { density: 0.03, gens: 7, final: 0, peak: 1183, outcome: 'quickDeath', capped: false }
      const quiet = { density: 0.03, gens: 7, final: 31, peak: 1183, outcome: 'shortCycle', capped: false }
      const alive = { density: 0.35, gens: 3492, final: 1355, peak: 14742, outcome: 'shortCycle', capped: false }
      t.ok(plainLife(dead, tr).startsWith('crit.plain.dead:'), '末态 0 → 说"死光了"')
      t.ok(plainLife(quiet, tr).startsWith('crit.plain.quiet:'), '几代就定住 → 说"定住了"，不算涌现')
      t.ok(plainLife(alive, tr).startsWith('crit.plain.alive:'), '撑住了 → 说"热闹了多少代"')
      t.equal(plainLife(null, tr), '', '没有样本就没有话')
      // 百分比是从密度算的，不是另存一份
      t.ok(plainLife(alive, tr).includes('"pct":35'), '撒 35% 要由 density 算出来')

      // 真跑一档，看那句话读得通
      const real = observeDensity(0.03)
      const zh = plainLife(real, (k, p) => {
        let str = DICT.zh[k]
        for (const key in p) str = str.split('{' + key + '}').join(String(p[key]))
        return str
      })
      t.equal(zh, '撒 3% → 7 代就定住，只剩 31 格', `0.03 那一档的人话：${zh}`)

      // 跨越点分界卡插在哪儿，由 findCrossings 说了算 —— 与曲线上夹的是同一处
      const mk = (density, outcome, gens) => ({ density, outcome, gens, capped: false })
      const rows = [mk(0.03, 'shortCycle', 7), mk(0.04, 'shortCycle', 3089),
        mk(0.80, 'shortCycle', 1327), mk(0.85, 'still', 7)]
      const marks = crossingMarks(rows)
      t.equal(marks.size, 2, '两处跨越点，两张分界卡')
      t.ok(marks.has(0.04) && marks.has(0.85), '卡插在跨越区间的右侧那一档之前')
      t.equal(marks.get(0.04).lo, 0.03, '卡上写的区间与 findCrossings 一致')
      t.equal(crossingMarks(rows).size, findCrossings(rows).length, '有几处跨越点就有几张卡')

      // 词条：中英 + 简洁语域
      for (const lang of ['zh', 'en']) {
        for (const k of ['crit.lead', 'crit.summary', 'crit.summaryEmpty', 'crit.crossing',
          'crit.plain.dead', 'crit.plain.quiet', 'crit.plain.alive']) {
          t.ok(typeof DICT[lang][k] === 'string', `${lang} 缺 ${k}`)
        }
        for (const k of ['crit.lead', 'crit.summary', 'crit.plain.dead', 'crit.plain.alive'])
          t.ok(typeof DICT[lang][k + '.simple'] === 'string', `${lang} 缺简洁语域的 ${k}`)
      }
      // 总结里的窗口数字必须是填进去的，不是写死的
      for (const lang of ['zh', 'en'])
        t.ok(/\{from\}/.test(DICT[lang]['crit.summary']) && /\{to\}/.test(DICT[lang]['crit.summary']),
          `${lang} 的总结要把涌现窗口的两端填进去`)

      // 这几句只在手机上说：桌面那边图注已经把同样的事说完了（D89 ③）
      const css = readSrc('src/style.css')
      t.ok(/\.crit-say \{ display: none; \}/.test(css), '开场白与总结桌面上不显示')
      t.ok(/\.crit-cross \{ display: none; \}/.test(css), '分界卡桌面上不显示')
      // 每档那句人话要用**够高的特异度**关掉：`.crit-card figcaption em` 是 (0,2,1)，
      // 单类名 (0,1,0) 压不过它 —— 本项目第七次被特异度绊倒，形状每次一样。
      t.ok(/\.crit-card figcaption em\.crit-plain \{ display: none; \}/.test(css),
        '人话那一句要按特异度关掉，不能只写单类名')
      t.ok(/@media \(max-width: 767px\)[\s\S]*?\.crit-say \{ display: block/.test(css), '窄屏才把话说出来')
      t.ok(/@media \(max-width: 767px\)[\s\S]*?\.crit-card figcaption em\.crit-plain \{ display: block/.test(css),
        '窄屏打开人话那一句时，特异度也要够')
      const html = readSrc('index.html')
      t.ok(/data-i18n="crit\.lead"/.test(html) && /id="crit-summary"/.test(html), '开场白与总结要在')
    }
  },
  {
    name: '待放态的「放这」：短词、语义色、跟着幽灵走（D90）',
    run(t) {
      const html = readSrc('index.html')
      const css = readSrc('src/style.css')

      // ① 短词。上一版叫「放下」，被 .stamp-tools 那条 44px 宽度规则挤成方块、文字溢出屏幕右缘。
      // 现在它不在那个容器里了，宽度由文字定。
      t.ok(!/<div class="stamp-tools"[\s\S]*?id="btn-drop"[\s\S]*?<\/div>/.test(html),
        '确认按钮不许再长在 .stamp-tools 里 —— 那里的按钮一律 44×44，文字会被挤出去')
      t.equal(DICT.zh['stamp.drop'], '放这', '中文短词')
      t.equal(DICT.en['stamp.drop'], 'Drop', '英文短词')
      for (const lang of ['zh', 'en']) {
        t.ok(DICT[lang]['stamp.drop'].length <= 6, `${lang} 的确认按钮要短`)
        t.ok(typeof DICT[lang]['stamp.drop.simple'] === 'string', `${lang} 简洁语域照旧`)
      }
      // 宽度由文字定、高度守住触控下限
      const rule = /\.stamp-confirm \{([^}]*)\}/.exec(css)
      t.ok(!!rule, '确认按钮要有自己的样式')
      t.ok(!/width:/.test(rule[1]), '不许写死宽度 —— 宽度由文字定，四种语域四种长度')
      t.ok(/min-height/.test(rule[1]), '高度要有下限')
      t.ok(/@media \(max-width: 767px\)[\s\S]*?\.stamp-confirm \{[^}]*min-height: 44px/.test(css),
        '窄屏下触控下限 44px')
      t.ok(/white-space: nowrap/.test(rule[1]), '它是一个词，不许被劈开（D73）')

      // ② 语义色：新开的"确认"档，不与已有五档撞义
      t.ok(/class="stamp-confirm confirm"/.test(html), '按钮挂的是「确认」档')
      const confirm = /button\.confirm \{([^}]*)\}/.exec(css)
      t.ok(!!confirm, 'D72 的第六档要有自己的类')
      const bg = (/background:\s*(#[0-9a-f]{6})/i.exec(confirm[1]) || [])[1]
      t.ok(!!bg, '确认档要有底色')
      // 与已有五档逐个比对：不许撞色
      const others = { primary: '#2f6b3a', running: '#6d4d16', danger: '#5a2323', rescue: '#1e3a5f' }
      for (const [name, hex] of Object.entries(others))
        t.ok(bg.toLowerCase() !== hex, `确认档不许和 ${name} 用同一个底色`)
      t.ok(css.includes('#2f6b3a'), '推进绿仍在（确认档是新增，不是改掉它）')

      // ③ 位置：跟着幽灵走，用的是 D47 那套定位逻辑，不是另写一份
      const main = stripLiterals(readSrc('src/main.js'))
      t.ok(/placeSelectionMenu\(/.test(main), '定位要复用 placeSelectionMenu —— 操作跟着对象走这件事只该有一套实现')
      t.ok(/app\.placeStampConfirm = function/.test(main), '要有把按钮摆到幽灵旁边的动作')
      const place = /app\.placeStampConfirm = function[\s\S]*?\n\}/.exec(main)
      t.ok(!!place && /if \(btn\.style\.left !== x\)/.test(place[0]),
        '位置没变就别写 style —— 每帧写一次会把布局搅得没完')
      t.ok(/if \(app\.pendingStamp\) app\.placeStampConfirm\(\)/.test(main), '幽灵被拖被缩放时按钮要跟上')
      const orient = /function afterOrientChange[\s\S]*?\n\}/.exec(main)
      t.ok(!!orient && /placeStampConfirm/.test(orient[0]), '转过之后外接框换了边，按钮也要跟着挪')
      // ⟳/⇋ 仍旧钉在右上角
      t.ok(/\.stamp-tools \{[\s\S]*?position: absolute; right: 10px; top: 10px/.test(css),
        '⟳/⇋ 保持右上角不动')

      // 定位函数本身的边界（这条早有，这里再钉一次它被复用的那几条性质）
      const stage = { w: 300, h: 200 }
      const menu = { w: 80, h: 40 }
      const mid = placeSelectionMenu({ left: 100, top: 80, right: 140, bottom: 120 }, menu, stage)
      t.equal(`${mid.x},${mid.y}`, '148,128', '放得下就贴在右下角')
      const rightEdge = placeSelectionMenu({ left: 250, top: 80, right: 290, bottom: 120 }, menu, stage)
      t.ok(rightEdge.x + menu.w <= stage.w, '贴右边界时往左翻，不出界')
      const bottomEdge = placeSelectionMenu({ left: 100, top: 170, right: 140, bottom: 195 }, menu, stage)
      t.ok(bottomEdge.y + menu.h <= stage.h, '贴下边界时往上翻，不出界')
    }
  },
  {
    name: '窄屏排查必须遍历"状态"，不只是遍历屏宽（D90 ①的教训）',
    run(t) {
      // 上一版的溢出检查没抓到那颗按钮，原因不在检查写得松，而在**它没进过那个状态**：
      // 待放态、选区菜单、页面放大提示、首次气泡都是"某个状态才存在"的元素，
      // 默认状态下扫一百遍也扫不到。清单写进 decisions，并在这里钉住清单本身。
      const doc = readSrc('docs/decisions.md')
      t.ok(/窄屏排查的状态清单/.test(doc), 'decisions 里要有那份状态清单')
      for (const id of ['btn-drop', 'stamp-tip', 'sel-menu', 'page-zoom-hint', 'stamp-hint'])
        t.ok(new RegExp('`#' + id + '`').test(doc), `状态清单里要点名 #${id}`)
      // 这些元素都必须是"默认不显示"的 —— 它们正因如此才会被默认状态的排查漏掉
      const html = readSrc('index.html')
      for (const id of ['btn-drop', 'stamp-tip', 'sel-menu', 'page-zoom-hint'])
        t.ok(new RegExp('id="' + id + '"[^>]*hidden').test(html), `#${id} 默认是藏着的`)
    }
  },
  {
    name: '参照线：放下之后留一条，只留最近一条（D91）',
    run(t) {
      // 参照线是**落子那一刻的位置与朝向**，冻住不动 —— 它回答的是"我刚才对着哪儿放的"，
      // 那是历史，不是现状；放下去的东西下一秒就变形、移动、甚至被吃掉。
      const p = getPattern('glider')
      const m = motionNow(p, { rot: 0, flip: false })
      const ref = refFromPlacement(p, { x: 20, y: 30 }, m)
      t.equal(ref.kind, 'ship', '类型跟着动向走')
      // 锚点 = 落点 + **实测航道点**（D98），不再是"落点 + 半个图案"——
      // 那条线要穿过它真正走的航道，而不是它包围盒的正中
      const anchor = rayAnchor(p, { x: 20, y: 30 }, m)
      t.equal(`${ref.center.x},${ref.center.y}`, `${anchor.x},${anchor.y}`, '参照线与待放线用同一个锚点')
      t.ok(Math.abs(ref.center.x - 21) < 1.5 && Math.abs(ref.center.y - 31) < 1.5,
        '滑翔机的航道就在它自己身上，锚点与包围盒中心相差不到一格')
      t.equal(`${ref.dx},${ref.dy}`, `${m.dx},${m.dy}`, '方向就是那一刻实测的方向')
      // 没方向的图案不留参照线（脉冲星没有"对着哪儿"这回事）
      t.equal(refFromPlacement(getPattern('pulsar'), { x: 0, y: 0 }, null), null, '没方向就没有参照线')
      t.equal(refFromPlacement(null, { x: 0, y: 0 }, m), null, '缺图案时不编一条出来')

      // 与待放线共用同一套几何：参照线也要能一路画到棋盘边
      const ends = rayEnds(ref.kind, ref.center, ref, { w: 200, h: 200 })
      // 从锚点朝 SE 走，先撞到的是下边界（y=200）—— 撞哪条边由哪条先到说了算。
      // x 的落点跟着锚点走（锚点是实测航道点，不再正好是整数），所以断言写成关系式而不是死数
      t.ok(ends.to.x === 200 || ends.to.y === 200, `参照线同样画到棋盘边：${ends.to.x},${ends.to.y}`)
      t.equal(ends.to.y, 200, '先撞下边界')
      t.equal(Math.round(ends.to.x), Math.round(ref.center.x + (200 - ref.center.y)),
        '沿 45° 走到下边界时，x 正好走过同样多的格数')
      t.equal(ends.solidEnd, 'from', '浓端仍在图案那一头')

      // 生命周期：落子时留、播放/清空时清、画笔落子时换掉，只留最近一条
      const main = stripLiterals(readSrc('src/main.js'))
      t.ok(/app\.setRefRay = function/.test(main), '要有设置参照线的动作')
      const place = /app\.placeStampAt = function[\s\S]*?\n\}/.exec(main)
      t.ok(!!place && /setRefRay\(refFromPlacement\(/.test(place[0]), '落子时留下参照线')
      const run = /app\.setRunning = function[\s\S]*?\n\}/.exec(main)
      t.ok(!!run && /if \(on\) app\.cancelPending\(\)/.test(run[0]),
        '一开跑就整体退场 —— 棋盘已不是那一刻的棋盘（待放态与参照线一起清）')
      const clear = /app\.clear = function[\s\S]*?\n\}/.exec(main)
      t.ok(!!clear && /app\.cancelPending\(\)/.test(clear[0]), '清空时整体退场（含参照线）')
      const inp = stripLiterals(readSrc('src/ui/input.js'))
      const commit = /function commitStroke\(\)[\s\S]*?\n  \}/.exec(inp)
      t.ok(!!commit && /app\.setRefRay\(null\)/.test(commit[0]),
        '画笔也是落子：它把参照线换掉（画笔没有方向，于是等于清掉）')
      // 只留一条：setRefRay 是覆盖，不是往数组里塞
      const setter = /app\.setRefRay = function[\s\S]*?\n\}/.exec(main)
      t.ok(!/push\(|concat\(/.test(setter[0]), '只留最近一条 —— 留一堆线等于没有线')

      // 量测是异步的 → 落子那一刻可能还没量完，得等量完再贴；
      // 而且要挡住"旧的盖掉新的"：连着放两个，先落的那个后量完就会冲掉后落的（自查时想到的）
      t.ok(/const seq = \+\+app\.refSeq/.test(main), '每次落子领一个序号')
      t.ok(/if \(m && seq === app\.refSeq\)/.test(main), '序号对不上的回调直接丢掉')
      t.ok(/const base = app\.stamp/.test(main) && /const orient = \{ \.\.\.app\.stampOrient \}/.test(main),
        '图案与朝向要在落子那一刻抓下来 —— 回调触发时用户可能已经换了图案')
      t.ok(/refSeq: 0/.test(main), '序号要有初值，否则 ++undefined 得到 NaN')

      // 静态贴纸：引擎跑了之后，参照线的数据一个字都不该变
      t.ok(!/refRay[^\n]*engine/.test(main.replace(/app\.engine\.w, h: app\.engine\.h/g, '')),
        '参照线不许跟着引擎更新')

      // 样式退一档：更淡、更细、箭头也淡
      const r = readSrc('src/render/renderer.js')
      t.ok(/const k = opts\.ref \? 0\.45 : 1/.test(r), '参照线整体更淡')
      t.ok(/\* \(opts\.ref \? 0\.6 : 1\)/.test(r), '线也更细')
      t.ok(/globalAlpha = 0\.85 \* k \*/.test(r), '箭头跟着一起淡')
      t.ok(/drawMotionRay\(vp, from, to, arrowAt = 'to', solidEnd = 'from', opts = \{\}\)/.test(r),
        '样式是参数，不是第二个画线函数')
      // 画在最底下：参照线先画，幽灵与它的线压在上面
      // 画在最底下：参照线（现在是入口 + 出口两条）先画，幽灵与它的线压在上面
      t.ok(/app\.refRay\)[\s\S]{0,900}drawMotionRay[\s\S]{0,1600}drawGhost/.test(main),
        '参照线画在幽灵与待放线之下 —— 手上那条要压过刚才那条')
    }
  },
  {
    name: '待放态的退出集合：每一条路都走同一个出口（D90 §4）',
    run(t) {
      // 真机 bug：待放态下按「全部擦掉」，棋盘清了，幽灵与动向线还留在原位。
      // 病根是**两个状态源**：幽灵看 app.stampAt，按钮看 app.pending —— 清一个不清另一个，
      // 就出现"清了一半"。现在只有一个源 pendingStamp，三样（幽灵/动向线/「放这」）全看它。
      const main = stripLiterals(readSrc('src/main.js'))
      t.ok(/pendingStamp: null/.test(main), '待放态要有一个明确的初值')
      // 查的是"这个名字还在不在"，所以连属性写法一起挡（`stampAt: null` 也算复活）。
      // `armStampAt` / `placeStampAt` 里的是大写 S，不会误伤。
      t.ok(!/stampAt/.test(main) && !/\bpending\b/.test(main),
        '旧的两个状态源必须消失（含属性写法）—— 留着一个就会有"清了一半"的那天')
      const inp = stripLiterals(readSrc('src/ui/input.js'))
      // 输入层查的是"有没有再去碰 app 上那两个旧字段"。
      // 这里不能像 main.js 那样连词形一起挡：`tapAction({pending, insideGhost})` 的形参
      // 本来就叫 pending，那是这个纯函数自己的 API，与 app 的状态源无关。
      t.ok(!/app\.stampAt/.test(inp) && !/app\.pending\b/.test(inp), '输入层也不许再碰旧状态源')

      // 幽灵、动向线、按钮三样都只认那一个源
      t.ok(/const gc = app\.pendingStamp \|\| app\.hoverCell/.test(main), '幽灵认它')
      t.ok(/if \(app\.pendingStamp\) app\.placeStampConfirm\(\)/.test(main), '按钮位置认它')
      t.ok(/if \(!app\.pendingStamp\) return/.test(main), '摆按钮之前先看它')

      // **单一出口**：cancelPending 是唯一的退场路径
      const cancel = /app\.cancelPending = function[\s\S]*?\n\}/.exec(main)
      t.ok(!!cancel, '要有那个唯一出口')
      t.ok(/app\.pendingStamp = null/.test(cancel[0]), '出口清状态源')
      t.ok(/hidden = true/.test(cancel[0]), '出口收按钮')
      t.ok(/if \(!opts\.keepRef\) app\.setRefRay\(null\)/.test(cancel[0]),
        '出口按规则处理参照线：默认清掉，只有明说 keepRef 才留')
      t.ok(!/app\.clearPending/.test(main), '不许再有第二个"半退出"的函数')

      // 退出集合：每一种进入方式都必须调那个出口
      const paths = [
        ['app\\.clear = function', 'clear', false],            // 清空 → 连参照线一起清
        ['app\\.setRunning = function', 'setRunning', false],  // 播放
        ['app\\.stepOnce = function', 'stepOnce', false],      // 单步
        ['app\\.adoptEngine = function', 'adoptEngine', false],// 读档/换盘
        ['app\\.applyRule = function', 'applyRule', false],    // 换世界
        ['app\\.openView = function', 'openView', true],       // 进全屏视图 → 参照线留着
        ['app\\.setStamp = function', 'setStamp', true]        // 换图案 → 参照线留着
      ]
      for (const [head, name, keepRef] of paths) {
        const fn = new RegExp(head + '[\\s\\S]*?\\n\\}').exec(main)
        t.ok(!!fn, `找得到 ${name}`)
        t.ok(/app\.cancelPending\(/.test(fn[0]), `${name} 必须走那个唯一出口`)
        const keeps = /app\.cancelPending\(\{ keepRef: true \}\)/.test(fn[0])
        t.equal(keeps, keepRef,
          `${name} 的参照线处置：${keepRef ? '应当留着（棋盘没变）' : '应当一并清掉（棋盘变了或整个换掉了）'}`)
      }
      // Esc / 点空白：留参照线
      t.ok(/app\.cancelPending\(\{ keepRef: true \}\)/.test(inp), 'Esc / 点空白也走出口，且留着参照线')

      // 规则本身写进文档，免得下一个人再想一遍
      const doc = readSrc('docs/decisions.md')
      t.ok(/待放态的退出集合/.test(doc), 'D90 里要有那张退出集合表')
      for (const word of ['清空', '播放', '单步', '读档', '换世界', '换图案'])
        t.ok(new RegExp(word).test(doc), `退出集合里要点名「${word}」`)
      t.ok(/待放态 × 每个退出动作/.test(doc), '状态清单排查要加上这一组组合')
    }
  },
  {
    name: '触屏事件序列驱动：待放态的进入与退出（D92 ③）',
    run(t) {
      // 上一轮我在浏览器里手点了六条路径，报"全过"，而真机不过 ——
      // 事后查明真机对着的是上一版（那次修复我没推）。但这件事也照出另一半问题：
      // **手点出来的验证不是守卫**，它不会在下一次改动时自己红。
      // 所以把触屏那条路写成可重复的用例：拿一个假 canvas 把真的 setupCanvasInput 接起来，
      // 再按"按下—抬起"的顺序喂事件，看它调了哪些动作。
      const handlers = {}
      const fakeCanvas = {
        addEventListener: (type, fn) => { (handlers[type] = handlers[type] || []).push(fn) },
        setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture() { return false },
        classList: { add() {}, remove() {}, toggle() {} },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 })
      }
      const calls = []
      const app = {
        canvas: fakeCanvas,
        engine: new LifeEngine(40, 40, { rule: lifeRule(), boundary: 'dead' }),
        viewport: Object.assign(new Viewport(), { scale: 4, originX: 0, originY: 0 }),
        renderer: { dpr: 1 },
        records: { noteEdit() {} },
        mode: 'full',
        stamp: getPattern('glider'),
        stampOrient: { rot: 0, flip: false },
        pendingStamp: null,
        hoverCell: null,
        stampPattern() { return getPattern('glider') },
        stampAnchor() { return app.pendingStamp ? { x: app.pendingStamp.x, y: app.pendingStamp.y } : null },
        armStampAt(c) { calls.push('arm'); app.pendingStamp = { x: c.x, y: c.y } },
        confirmStamp() { calls.push('confirm'); app.pendingStamp = null },
        cancelPending() { calls.push('cancel'); app.pendingStamp = null },
        placeStampAt() { calls.push('place') },
        setRefRay() {}, markDirtyRun() {}, captureBaseline() {}, updateHud() {},
        updateHoverReadout() {}, hideSelectionMenu() {}, setStamp() {}, nudgeStamp() { return false },
        rotateStamp() {}, flipStamp() {}, zoomBar: { wake() {} }
      }
      // setupCanvasInput 会往 window 上挂键盘监听；测试环境没有 window/document，临时给两个空壳
      const hadWindow = 'window' in globalThis, hadDoc = 'document' in globalThis
      const oldWindow = globalThis.window, oldDoc = globalThis.document
      globalThis.window = { addEventListener() {} }
      globalThis.document = { getElementById: () => ({ hidden: true }) }
      try {
        setupCanvasInput(app)
        const fire = (type, x, y, id = 1) => {
          for (const fn of handlers[type] || []) {
            fn({ clientX: x, clientY: y, pointerId: id, pointerType: 'touch', button: 0, isPrimary: true,
              preventDefault() {}, shiftKey: false })
          }
        }
        const tap = (x, y, id) => { fire('pointerdown', x, y, id); fire('pointerup', x, y, id) }

        // ① 第一下：摆一个待放的幽灵，**不落子**
        tap(100, 100, 1)
        t.equal(calls.join(','), 'arm', '第一次点只摆幽灵 —— 引擎那条路（place）一次都不许走')
        t.ok(!!app.pendingStamp, '进入待放态')

        // ② 点在幽灵身上：确认
        calls.length = 0
        const anchor = app.pendingStamp
        tap(anchor.x * 4, anchor.y * 4, 2)
        t.equal(calls.join(','), 'confirm', '点在幽灵身上 = 确认落子')
        t.equal(app.pendingStamp, null, '确认之后退出待放态')

        // ③ 点空白：取消
        calls.length = 0
        tap(100, 100, 3)          // 先摆
        tap(360, 360, 4)          // 再点远处的空白
        t.equal(calls.join(','), 'arm,cancel', '点空白 = 取消，而不是又摆一个')
        t.equal(app.pendingStamp, null, '取消之后退出待放态')

        // ④ 拖动：只挪幽灵，不落子
        calls.length = 0
        fire('pointerdown', 100, 100, 5)
        fire('pointermove', 200, 160, 5)
        fire('pointerup', 200, 160, 5)
        t.ok(calls.includes('arm') && !calls.includes('place') && !calls.includes('confirm'),
          `拖动只挪幽灵：实际调用 ${calls.join(',')}`)
        t.ok(app.pendingStamp && app.pendingStamp.x > 20, '幽灵跟着拖到了新位置')
      } finally {
        if (hadWindow) globalThis.window = oldWindow; else delete globalThis.window
        if (hadDoc) globalThis.document = oldDoc; else delete globalThis.document
      }
    }
  },
  {
    name: '空盘不开跑：0 格的"局"不该进台账（D92 ①）',
    run(t) {
      // 真机截图：待放态按播放，空盘跑一代必然全灭 → 弹"第 1 代 / 峰值 0 / 剩 0"的总结卡片，
      // 还往台账落一条。那不是一局，是一次误触。从根上不启动，比"跑起来再想办法不记账"干净 ——
      // 终止检测与记账都不必知道有这么个特例。
      const main = stripLiterals(readSrc('src/main.js'))
      const run = /app\.setRunning = function[\s\S]*?\n\}/.exec(main)
      t.ok(!!run, '找得到 setRunning')
      t.ok(/if \(on && app\.engine\.stats\.alive === 0\)/.test(run[0]), '空盘按播放直接不启动')
      t.ok(/return\s*\n\s*\}/.test(run[0]), '不启动就直接返回，不往下走')
      const step = /app\.stepOnce = function[\s\S]*?\n\}/.exec(main)
      t.ok(!!step && /alive === 0/.test(step[0]), '空盘单步同理 —— 一步之后仍是空盘，却会被判成全灭')
      // 提示要有词条（中英 + 简洁语域）
      for (const lang of ['zh', 'en']) {
        t.ok(typeof DICT[lang]['toast.emptyBoard'] === 'string', `${lang} 缺空盘提示`)
        t.ok(typeof DICT[lang]['toast.emptyBoard.simple'] === 'string', `${lang} 缺简洁语域`)
      }
      t.ok(/画|randomize|随机/i.test(DICT.zh['toast.emptyBoard']),
        '提示要告诉他下一步能做什么，而不是只说"空的"')
    }
  },
  {
    name: '版本印记：线上是哪一版要能一条命令核对（D92 ②）',
    run(t) {
      // 上一轮真机验的是上一版（修好的那次提交我没推），而当时没有任何东西
      // 能让我或用户一眼核对"线上到底是哪一版"。
      const html = readSrc('index.html')
      t.ok(/<meta name="app-version" content="dev" \/>/.test(html),
        'index.html 里要有版本印记的位置（开发时写着 dev，那也是准的）')
      const cfg = readSrc('vite.config.js')
      // 钩子名要**精确**匹配：只查 `transformIndexHtml` 这个子串的话，
      // 把它改名成 transformIndexHtmlDisabled（等于关掉）守卫照样绿 —— 自查时抓到的。
      t.ok(/transformIndexHtml\s*\(/.test(cfg), '构建时把版本写进**静态 HTML**（钩子名要对得上）')
      t.ok(/name="app-version" content="\$\{pkgVersion\}"/.test(cfg), '写进去的就是 package.json 的版本')
      t.ok(/readFileSync/.test(cfg) && /package\.json/.test(cfg), '版本号取自 package.json，不另抄一份')
      // 部署流程里要写明"推完怎么核对"
      const deploy = readSrc('docs/deploy.md')
      t.ok(/app-version/.test(deploy), 'deploy.md 里要写明推完之后怎么核对线上版本')
    }
  },
  {
    name: '精彩局：三条进入路线由一处判定（D93）',
    run(t) {
      // 同规则永远拿在手上 —— 盘上有没有东西、在不在播，都不清盘
      for (const boardEmpty of [true, false]) {
        for (const running of [true, false]) {
          t.equal(showEntryPlan({ sameRule: true, boardEmpty, running }), 'stamp',
            `同规则（空盘=${boardEmpty} 播放中=${running}）一律走待放置`)
        }
      }
      // 异规则：空盘且没在播才一点即开，其余先问一句
      t.equal(showEntryPlan({ sameRule: false, boardEmpty: true, running: false }), 'replace',
        '异规则 + 空盘 + 没在播 = 一点即开，不打扰')
      t.equal(showEntryPlan({ sameRule: false, boardEmpty: false, running: false }), 'confirm',
        '异规则 + 盘上有东西 = 先问一句')
      t.equal(showEntryPlan({ sameRule: false, boardEmpty: true, running: true }), 'confirm',
        '异规则 + 正在播 = 先问一句（盘空也问：他正看着它跑）')
    }
  },
  {
    name: '精彩局：页签切换零棋盘副作用',
    run(t) {
      // ① 的核实结论要有守卫钉住：切到「精彩局」页签只换显示，不碰棋盘。
      // 一旦有人在 setShows 里顺手加了"顺便演示第一局"，这条就红。
      const src = stripLiterals(readSrc('src/ui/controls.js'))
      const m = /app\.setShows\s*=\s*function[\s\S]*?\n  \}/.exec(src)
      t.ok(!!m, '找得到 app.setShows')
      const body = m ? m[0] : ''
      for (const bad of ['clear', 'replayLayout', 'setRunning', 'importRleText', 'openShowEntry']) {
        t.ok(body.indexOf(bad) === -1, `setShows 里不许出现 ${bad} —— 页签切换只换卡片带内容`)
      }
    }
  },
  {
    name: '精彩局：同规则那条路一格都不碰引擎（D93）',
    run(t) {
      const raw = readSrc('src/ui/favorites-view.js')
      const src = stripLiterals(raw)
      const m = /app\.openShowEntry\s*=\s*function[\s\S]*?\n  \}/.exec(src)
      t.ok(!!m, '找得到 app.openShowEntry')
      const body = m ? m[0] : ''
      // stamp 分支必须在替换动作**之前**结束
      const stampAt = body.indexOf('app.setStamp')
      const replayAt = body.indexOf('app.replayLayout')
      t.ok(stampAt > -1 && replayAt > -1, '两条路都在这个函数里')
      t.ok(stampAt < replayAt, '同规则那条先返回，替换的写在后面')
      const stampBranch = body.slice(0, replayAt)
      for (const bad of ['app.clear', 'replayLayout', 'setRunning']) {
        t.ok(stampBranch.indexOf(bad) === -1, `同规则分支里不许出现 ${bad}`)
      }
      // 卡片带的点击只许走这一个出口（不许再有第二条直接复现的路）
      const handler = /el\.showList\.addEventListener[\s\S]*?\n  \}\)/.exec(src)
      t.ok(!!handler, '找得到卡片带的点击处理器')
      t.ok(/openShowEntry/.test(handler[0]), '卡片带点击只走 openShowEntry')
      t.ok(!/replayLayout/.test(handler[0]), '卡片带点击里不许直接调 replayLayout')
      // 规则相同与否比的是指纹，不是字符串
      t.ok(/compileNotation\(notation\)\.fingerprint === app\.engine\.rule\.fingerprint/.test(src),
        '同规则判定比指纹（写法不同、世界相同的两条记法不该被判成异规则）')
      // ⑤ 侧栏「复现」的语义不动。查的是**原文**：'data-fav-play' 是字符串字面量，
      // stripLiterals 会把它剥成空串，拿剥过的源码查它永远查不到（D88 §3）。
      const sideBar = /const play = [\s\S]{0,800}?app\.replayLayout\(r\)/.exec(raw)
      t.ok(!!sideBar && /favPlay/.test(sideBar[0]),
        '侧栏「复现」仍然是整盘复现 —— 那里的用词已明示替换')
    }
  },
  {
    name: '精彩局：「换世界」小标随规则一起重算（D93）',
    run(t) {
      // 那个标说的是"这一张与当前世界的关系"。关系变了标不重算，
      // 它说的就是上一刻的事 —— 本机点出来的：换到烟花世界后三张卡一个标都没有。
      const src = stripLiterals(readSrc('src/main.js'))
      const m = /app\.applyRule = function[\s\S]*?\n\}/.exec(src)
      t.ok(!!m, '找得到 app.applyRule')
      t.ok(/app\.favorites\.renderShow\(\)/.test(m ? m[0] : ''), '换规则时重画精彩局卡片带')
      // 拿起/放下图案时也要重画（那张卡要高亮）
      const st = /app\.setStamp = function[\s\S]*?\n\}/.exec(src)
      t.ok(/app\.favorites\.renderShow\(\)/.test(st ? st[0] : ''), '换图案时重画精彩局卡片带')
    }
  },
  {
    name: '精彩局：换世界要问一句，词条中英 + 简洁语域齐备（D93）',
    run(t) {
      for (const lang of ['zh', 'en']) {
        for (const k of ['fav.show.swapTag', 'fav.show.needRule.title', 'fav.show.needRule.body',
          'fav.show.needRule.yes', 'confirm.cancel']) {
          t.ok(k in DICT[lang], `${lang} 缺词条 ${k}`)
          t.ok((k + '.simple') in DICT[lang], `${lang} 缺简洁语域的 ${k}.simple`)
        }
        // 那句话必须把两件事说全：换的是哪个规则、当前棋盘会没
        t.ok(/\{rule\}/.test(DICT[lang]['fav.show.needRule.body']), `${lang} 的确认句里要写明是哪个规则`)
        t.ok(/\{name\}/.test(DICT[lang]['fav.show.needRule.body']), `${lang} 的确认句里要写明是哪一局`)
      }
      // 「继续」穿破坏红（D72）：它确实会盖掉用户已有的东西
      const html = readSrc('index.html')
      t.ok(/id="confirm-yes"[^>]*class="danger"|class="danger"[^>]*id="confirm-yes"/.test(html),
        '确认框的「继续」是破坏红')
      // 焦点默认落在取消上
      const conf = stripLiterals(readSrc('src/ui/confirm.js'))
      t.ok(/el\.no\.focus\(\)/.test(conf), '打开时焦点落在「取消」上，回车不该顺手把盘换了')
    }
  },
  {
    name: '接线：Esc 判断模态不许再点名（D93）',
    run(t) {
      const raw = readSrc('src/ui/input.js')
      t.ok(/\.modal:not\(\[hidden\]\)/.test(raw), 'Esc 用"有没有模态开着"来判断')
      t.ok(!/getElementById\('rule-modal'\)/.test(raw) && !/getElementById\('intro-modal'\)/.test(raw),
        '不许再挨个点名模态 —— 每新开一个都要回来补一笔，漏了就是 Esc 把手上的图案弄丢')
    }
  },
  {
    name: '大盘：档位表与界面上的按钮是同一份（D94 ①）',
    run(t) {
      const html = readSrc('index.html')
      const m = /<div class="btn-group grid2" id="in-size">([\s\S]*?)<\/div>/.exec(html)
      t.ok(!!m, '找得到尺寸按钮组')
      const vals = [...m[1].matchAll(/data-val="(\d+)"/g)].map(x => Number(x[1]))
      t.equal(vals.join(','), BOARD_SIZES.join(','), '按钮与 BOARD_SIZES 逐个对上（两份名单必然会分叉，所以只许有一份）')
      t.ok(vals.includes(1024) && vals.includes(2048), '两个大盘档都在')
      // 仅完整模式：整个「棋盘」分组挂 data-mode="full"，简洁模式下根本不出现
      const sec = /<section class="group" data-mode="full">[\s\S]*?id="in-size"/.test(html)
      t.ok(sec, '尺寸控件在完整模式的分组里 —— 简洁模式看不到大盘档')
      t.ok(isBigBoard(1024) && isBigBoard(2048) && !isBigBoard(500), '大盘从 1024 起算')
      t.equal(BIG_FROM, 1024, '大盘门槛写在一处')
      // 最小够用的档位，不许"差不多够"
      t.equal(neededBoard(749, 338), 1024, '繁殖者 749×338 → 1024 档')
      t.equal(neededBoard(499, 516), 1024, '深胞 499×516 → 1024 档')
      t.equal(neededBoard(27, 27), 100, '小图案不必占大盘')
      t.equal(neededBoard(4000, 10), null, '所有档都摆不下就如实回 null')
    }
  },
  {
    name: '大盘：视觉层在这一档不生效，理由有实测数字（D94 ①）',
    run(t) {
      const on = { ageColoring: true, glow: true, trails: true, motionRay: true }
      const small = visualFor(on, 500)
      t.ok(small.ageColoring && small.glow && small.trails, '小盘一切照旧')
      const big = visualFor(on, 2048)
      t.ok(!big.ageColoring && !big.glow && !big.trails, '大盘关掉年龄/余晖/拖尾')
      t.ok(big.motionRay, '动向线不受影响 —— 它只画一条线，不扫整盘')
      t.ok(on.ageColoring && on.glow && on.trails, '**不许改用户那份设置**，只是不生效')
      // 关掉是有账可算的：视觉层那一遍占 2048² 全部开销的四成
      const withVis = costOf(2048), without = costOf(2048, false)
      t.ok(withVis > without, '算上视觉层更贵')
      t.ok((withVis - without) / withVis > 0.25, `视觉层占 ${(100 * (withVis - without) / withVis).toFixed(0)}% —— 值得为它单开一条政策`)
      // 主循环必须走 visualNow()，不许再直接读 visualOpts
      const src = stripLiterals(readSrc('src/main.js'))
      t.ok(/app\.renderer\.draw\(app\.engine, app\.viewport, app\.visual, app\.visualNow\(\)\)/.test(src),
        '渲染读的是生效后的选项')
      t.ok(!/app\.visual\.advance\(app\.engine, app\.visualOpts\./.test(src),
        '推进年龄/余晖也读生效后的选项，否则大盘上关了却还在扫')
    }
  },
  {
    name: '中量级经典：RLE 身份自洽（D94 ②，D64 入册标准）',
    run(t) {
      t.equal(BIG_LAYOUTS.length, 5, '五条')
      const lifeFp = compileNotation('B3/S23').fingerprint
      for (const e of BIG_LAYOUTS) {
        const p = parseRLE(e.rle)
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
        for (const [x, y] of p.cells) {
          if (x < x0) x0 = x; if (y < y0) y0 = y
          if (x > x1) x1 = x; if (y > y1) y1 = y
        }
        // 头行写的尺寸与真正解出来的包围盒必须一致 —— 这是"这份 RLE 没被截断"的凭据
        t.equal(`${p.w}×${p.h}`, `${x1 - x0 + 1}×${y1 - y0 + 1}`, `${e.id} 头行尺寸与解出来的包围盒一致`)
        t.equal(compileNotation(p.rule).fingerprint, lifeFp, `${e.id} 是标准生命游戏规则`)
        t.ok(e.board >= neededBoard(p.w, p.h), `${e.id} 声明的档位摆得下它自己`)
        t.ok(e.board >= BIG_FROM, `${e.id} 是大盘展品`)
        // 出处与署名照录，不许"顺手清理"掉
        t.ok(/#N /.test(e.rle) && /#O /.test(e.rle), `${e.id} 保留了 #N 名称与 #O 作者行`)
        t.ok(e.scale === 'big', `${e.id} 标了规模档`)
      }
      // 中英 + 简洁语域三样齐备
      for (const lang of ['zh', 'en']) {
        for (const e of BIG_LAYOUTS) {
          for (const suffix of ['', '.desc', '.life']) {
            t.ok((e.nameKey + suffix) in DICT[lang], `${lang} 缺 ${e.nameKey}${suffix}`)
            t.ok((e.nameKey + suffix + '.simple') in DICT[lang], `${lang} 缺 ${e.nameKey}${suffix}.simple`)
          }
          // 生平那一行必须说清口径：多大的盘
          t.ok(/1024|2048/.test(DICT[lang][e.nameKey + '.life']), `${lang} 的 ${e.nameKey}.life 要写明在多大的盘上量的`)
        }
      }
    }
  },
  {
    name: '中量级经典：生平是实跑出来的（D94 ②）',
    run(t) {
      // 完整口径跑一遍要一分多钟（繁殖者 4000 代 78 秒），进不了测试套件。
      // 所以这里钉的是**同一条路上的一个便宜检查点**：同样的摆位、同样的档位、跑 60 代。
      // 它挡得住"引擎变了而卡片上的数字没跟着变"这件事 —— 那正是这条测试要防的。
      const CHECK = {
        'builtin:max': { start: 187, at60: 1665 },
        'builtin:breeder': { start: 4060, at60: 4271 },
        'builtin:deepcell': { start: 5449, at60: 5453 },
        'builtin:primer': { start: 2953, at60: 4152 },
        'builtin:hacksaw': { start: 687, at60: 940 }
      }
      for (const e of BIG_LAYOUTS) {
        const p = parseRLE(e.rle)
        const n = e.board
        const eng = new LifeEngine(n, n, { rule: lifeRule(), boundary: 'dead' })
        const ox = (n - p.w) >> 1, oy = (n - p.h) >> 1
        for (const [x, y] of p.cells) eng.set(ox + x, oy + y, 1)
        eng.stats.alive = eng.countAlive()
        t.equal(eng.stats.alive, CHECK[e.id].start, `${e.id} 起始格数`)
        for (let g = 0; g < 60; g++) eng.step()
        t.equal(eng.stats.alive, CHECK[e.id].at60, `${e.id} 第 60 代格数`)
      }
    }
  },
  {
    name: '规则记法：B3/S23 与 S23/B3 是同一个世界（D94 ②）',
    run(t) {
      // LifeWiki 那批 RLE 里 max.rle 的头行就写作 `rule = s23/b3`。
      // 认不出它，等于把一批标准图案挡在门外 —— 这条是被真实数据逼出来的。
      const a = compileNotation('B3/S23'), b = compileNotation('s23/b3')
      t.equal(a.fingerprint, b.fingerprint, '两种写法同一个指纹')
      t.equal(b.notation, 'B3/S23', '规整回 B/S 的写法')
      t.equal(compileNotation('S/B2').fingerprint, compileNotation('B2/S').fingerprint, 'Seeds 两种写法也一致')
      let bad = false
      try { compileNotation('B3S23') } catch (e) { bad = true }
      t.ok(bad, '只认这两种排列，不做通用容错 —— 越松越容易把两个规则读成一个')
    }
  },
  {
    name: '精彩局：摆不下的不许默默截断（D94 ②）',
    run(t) {
      t.equal(showEntryPlan({ sameRule: true, fits: true, boardEmpty: false, running: false }), 'stamp',
        '同规则 + 摆得下 = 拿在手上')
      t.equal(showEntryPlan({ sameRule: true, fits: false, boardEmpty: false, running: false }), 'confirm',
        '同规则但摆不下 —— 得换盘，而换盘就是清盘，所以要问')
      t.equal(showEntryPlan({ sameRule: true, fits: false, boardEmpty: true, running: false }), 'replace',
        '摆不下但盘是空的：没有劳动可毁，直接换')
      const src = stripLiterals(readSrc('src/ui/favorites-view.js'))
      t.ok(/resizeBoard\(need, need, \{ silent: true \}\)/.test(src), '复现时先把盘换到够大再铺')
      // 三种理由三句话，不拼字符串
      for (const which of ['needRule', 'needBoard', 'needBoth']) {
        for (const lang of ['zh', 'en']) {
          t.ok((`fav.show.${which}.body`) in DICT[lang], `${lang} 缺 fav.show.${which}.body`)
          t.ok((`fav.show.${which}.body.simple`) in DICT[lang], `${lang} 缺简洁语域的 fav.show.${which}.body`)
        }
      }
      t.ok(/\{n\}/.test(DICT.zh['fav.show.needBoard.body']), '换盘那句要写明换成多大')
    }
  },
  {
    name: '取用区：桌面是网格、手机是横滑，同一份 DOM（D95 ①）',
    run(t) {
      const css = readSrc('src/style.css')
      const wide = /@media \(min-width: 768px\) \{[\s\S]*?\n\}/g
      const blocks = [...css.matchAll(wide)].map(m => m[0])
      const grid = blocks.find(b => /\.strip \.card-list, \.toolrail \.card-list/.test(b))
      t.ok(!!grid, '宽屏下有一条同时管三条带的网格声明（同类同形，按设备内约束）')
      t.ok(/display:\s*grid/.test(grid), '桌面取用区是网格')
      t.ok(/repeat\(auto-fill/.test(grid), '列数由容器宽度决定，不写死方向')
      // 下限必须用 min(…, 100%) 兜一层：容器比下限还窄时（玩具盒竖条一冒出竖滚动条
      // 就只剩 83px，而下限是 88px），硬下限会把网格撑出横向溢出 —— 13 张卡那次排查抓到的
      t.ok(/minmax\(min\(\d+px, 100%\), 1fr\)/.test(grid),
        '网格下限要用 min(…, 100%) 兜底，否则容器一窄就横向溢出')
      // 断言要落在**那一行的值**上：拿整个 media 块去测，会被别的行里的 min() 蒙混过关（自查时抓到的）
      const railLine = /\.toolrail \.card-list \{ grid-template-columns: ([^;]+);/.exec(css)
      t.ok(!!railLine, '玩具盒竖条有自己的列宽声明')
      t.ok(/minmax\(min\(\d+px, 100%\), 1fr\)/.test(railLine ? railLine[1] : ''), '玩具盒竖条同样兜底')
      t.ok(/overflow-x:\s*visible/.test(grid), '不横滑，于是也没有那条横贯的滚动条')
      // 手机那一套一字不动（D75）：窄屏块里的横滑机制原样还在
      const narrow = /@media \(max-width: 767px\) \{[\s\S]*?\n\}/g
      const nb = [...css.matchAll(narrow)].map(m => m[0]).join('\n')
      t.ok(/\.toolrail \.rail-list, \.strip \.strip-list \{\s*display: flex/.test(nb), '窄屏仍是横向 flex')
      t.ok(/\.toolrail, \.strip \{ scroll-snap-type: x proximity/.test(nb), '窄屏仍由容器横滚 + 吸附')
      t.ok(/flex: 0 0 calc\(\(100% - 24px\) \/ 3\.4\)/.test(nb), '窄屏卡片宽度仍是容器的 1/3.4（D75 ②）')
    }
  },
  {
    name: '取用区：瘦卡片只放名称 + 一行短语 + 小标（D95 ①②）',
    run(t) {
      const raw = readSrc('src/ui/favorites-view.js')
      const css = readSrc('src/style.css')
      // 卡片上是短语，悬停 title 里才是完整说明
      t.ok(/title="\$\{esc\(r\.full \|\| r\.note \|\| r\.name\)\}"/.test(raw), '完整说明走 title')
      t.ok(/<em>\$\{esc\(r\.note \|\| ''\)\}<\/em>/.test(raw), '卡片上那一行是短语')
      t.ok(/white-space: nowrap; overflow: hidden; text-overflow: ellipsis/.test(css), '短语与名称都单行截断')
      // 选中态：提示行换成那一局的完整说明，且**只有一个写入者**
      const view = stripLiterals(raw)
      t.ok(/function syncShowHint/.test(view), '提示行由收藏那边统一维护')
      const ctrl = stripLiterals(readSrc('src/ui/controls.js'))
      t.ok(/if \(app\.syncShowHint\) app\.syncShowHint\(\)/.test(ctrl),
        '语言切换时也走同一个出口 —— 一个元素只许有一个写入者')
      // ② 「建议电脑」只在窄屏；规模档只在桌面
      t.ok(/\.show-card \.tag-adv \{ display: none; \}/.test(css), '桌面不显示"建议电脑"—— 在电脑上说这句是废话')
      t.ok(/\.show-card \.tag-scale \{ display: none; \}/.test(css), '窄屏不显示规模档 —— 他手里就是手机')
      t.ok(/tag-adv/.test(raw) && /tag-scale/.test(raw) && /tag-swap/.test(raw), '三枚小标各带自己的类，由 CSS 决定谁出现在哪个屏上')
      // 文案里不许再夹带"建议在电脑上看"——那句话现在是小标，不是说明的一部分
      for (const lang of ['zh', 'en']) {
        for (const k of Object.keys(DICT[lang])) {
          if (!/^fav\.builtin\..*\.desc/.test(k)) continue
          t.ok(!/建议在电脑|用电脑看|best on a computer|use a computer/i.test(DICT[lang][k]),
            `${lang} 的 ${k} 里不该再夹带"建议电脑"——它是小标，由屏宽决定显不显示`)
        }
      }
    }
  },
  {
    name: '取用区：折叠的阈值只有一处说了算（D95 ③）',
    run(t) {
      const view = readSrc('src/ui/favorites-view.js')
      const css = readSrc('src/style.css')
      const m = /const SHOW_FOLD = (\d+)/.exec(view)
      t.ok(!!m, '折叠阈值写在一个具名常量上')
      const fold = Number(m[1])
      t.ok(fold >= 15 && fold <= 20, `阈值 ${fold} 落在 15–20 张这个量级里（卡片还会涨）`)
      // CSS 藏的是"第 fold+1 张起"，两个数必须对得上 —— 这是典型的双份真相
      t.ok(new RegExp(`\\.strip-list\\.folded > \\.card:nth-child\\(n\\+${fold + 1}\\)`).test(css),
        `CSS 藏的必须正好是第 ${fold + 1} 张起，与 SHOW_FOLD 对齐`)
      // 用 CSS 藏而不是不渲染：DOM 两边同一份，手机那条横滑带才可能"一字不动"
      t.ok(/classList\.toggle\('folded'/.test(view), '折叠是加个 class，不是少渲染几张')
      t.ok(/#show-more \{ display: none; \}/.test(css), '窄屏没有展开按钮 —— 那边划到底就是全部')
      // 沿用侧栏的词条，不另起一套说法
      for (const lang of ['zh', 'en']) {
        t.ok('fav.showAll' in DICT[lang] && 'fav.foldUp' in DICT[lang], `${lang} 复用侧栏那两条词条`)
      }
    }
  },
  {
    name: '取用区：完整说明缺席时不许把 key 显示出来（D95 ①）',
    run(t) {
      const tr = k => '词典:' + k
      // t() 缺词时会把 key 原样吐出来，所以没声明 full 的条目根本不该去查
      const withFull = layoutRow({ id: 'a', nameKey: 'fav.builtin.max', rle: 'r', full: true }, tr)
      t.equal(withFull.full, '词典:fav.builtin.max.full', '声明了 full 的才查词典')
      const without = layoutRow({ id: 'b', nameKey: 'fav.builtin.wildfire', rle: 'r' }, tr)
      t.equal(without.full, '', '没声明的留空，而不是把 key 印在卡片上')
      const mine = layoutRow({ id: 'c', name: '我的', rle: 'r', note: '我写的一句' }, tr)
      t.equal(mine.full, '我写的一句', '自存的没有短语/全文之分，用户写的那一句两处都用')
      t.equal(mine.note, '我写的一句', '而且一个字都不改写（D83）')
    }
  },
  {
    name: '元像素零件：两块静物是直柱（D96 ①）',
    run(t) {
      // D64 要的"实测生平"，对静物就是这一句：**它真的一动不动**。
      // 判据是逐格比对，不是人口数 —— 人口不变而图形变了的东西多的是（振荡子就是）。
      for (const key of ['block', 'beehive']) {
        const p = getPattern(key)
        const e = new LifeEngine(60, 60, { rule: lifeRule(), boundary: 'dead' })
        placePattern(e, p, 20, 20)
        e.stats.alive = e.countAlive()
        const s0 = e.cur.slice()
        let stable = true
        for (let g = 0; g < 200; g++) { e.step(); if (String(e.cur) !== String(s0)) { stable = false; break } }
        t.ok(stable, `${key} 跑 200 代逐格不变`)
        t.equal(e.stats.alive, p.cells.length, `${key} 人口始终是 ${p.cells.length}`)
      }
    }
  },
  {
    name: '元像素零件：三条飞船同速不同块头（D96 ①）',
    run(t) {
      // 补齐飞船族的意义就在这个数上：轻/中/重速度**一模一样**，差的只是块头。
      for (const [key, cells] of [['lwss', 9], ['mwss', 11], ['hwss', 13]]) {
        const m = motionNow(getPattern(key), { rot: 0, flip: false })
        t.equal(`${m.dx},${m.dy}/${m.gens}`, '-1,0/2', `${key} 每 2 代往西走一格（c/2）`)
        t.equal(getPattern(key).cells.length, cells, `${key} ${cells} 格`)
      }
      // 与盒里那架滑翔机同处一盒，方向各测各的：飞船朝西，滑翔机朝 SE
      const g = motionNow(getPattern('glider'), { rot: 0, flip: false })
      t.equal(`${g.dx},${g.dy}`, '1,1', '滑翔机仍朝 SE —— 三条船的方向没把它带偏')
    }
  },
  {
    name: '元像素零件：蜂后穿梭机周期 30（D96 ①）',
    run(t) {
      const p = getPattern('qbshuttle')
      const e = new LifeEngine(80, 80, { rule: lifeRule(), boundary: 'dead' })
      placePattern(e, p, 25, 35)
      e.stats.alive = e.countAlive()
      const s0 = e.cur.slice()
      let period = null
      for (let g = 1; g <= 200; g++) { e.step(); if (String(e.cur) === String(s0)) { period = g; break } }
      t.equal(period, 30, '第 30 代逐格回到起始盘面')
      // 两端的方块是稳定器，不是装饰：拿掉就不再是周期 30 的东西
      const bare = { key: 'x', w: p.w, h: p.h, cells: p.cells.filter(([x]) => x > 3 && x < p.w - 4) }
      const e2 = new LifeEngine(80, 80, { rule: lifeRule(), boundary: 'dead' })
      placePattern(e2, bare, 25, 35)
      e2.stats.alive = e2.countAlive()
      const b0 = e2.cur.slice()
      let bp = null
      for (let g = 1; g <= 200; g++) { e2.step(); if (String(e2.cur) === String(b0)) { bp = g; break } }
      t.ok(bp !== 30, `拿掉两端的稳定器就不是周期 30 了（实测 ${bp === null ? '两百代都没回到原样' : '周期 ' + bp}）`)
    }
  },
  {
    name: '元像素零件：反射器把滑翔机拐 90°，自己逐格复原（D96 ①，D64 互动型）',
    run(t) {
      const snark = getPattern('snark')
      // 独放是静物 —— 反射器的前提就是"平时一动不动"
      const e = new LifeEngine(70, 70, { rule: lifeRule(), boundary: 'dead' })
      placePattern(e, snark, 23, 26)
      e.stats.alive = e.countAlive()
      const s0 = e.cur.slice()
      let stable = true
      for (let g = 0; g < 300; g++) { e.step(); if (String(e.cur) !== String(s0)) { stable = false; break } }
      t.ok(stable, '反射器独放 300 代逐格不变')
      t.equal(snark.cells.length, 52, '入册的是减掉演示滑翔机之后的 52 格本体')

      // 反射那一局：实测摆位、实测代数、逐格复原（D64 互动型三样）
      const m = motionNow(snark, { rot: 0, flip: false })
      t.equal(m.kind, 'reflector', '它属反射器那一类')
      t.equal(`${m.dx},${m.dy}`, '1,1', '默认朝向接的是从 NW 飞来、朝 SE 走的那架')
      t.equal(`${m.outDx},${m.outDy}`, '1,-1', '出射朝 NE —— 正好拐了 90°')
      t.equal(m.restoredAt, 29, '第 29 代反射器逐格复原')
      // **真正的"开箱即配"是这一条**：要拿的就是盒里那架滑翔机，原样，不转不翻（D98）。
      // 光对方向不够 —— 同一个方向上有两种手性，反射器只接其中一种。
      t.equal(`${m.via.rot},${m.via.flip}`, '0,false', '对应滑翔机 = 盒里默认那架，原样拖出来即可')
      // 出射必须与入射垂直：点积为零。这是"拐 90°"这句话的数值形式
      t.equal(m.dx * m.outDx + m.dy * m.outDy, 0, '入射与出射垂直')

      // 转过之后仍然成立，而且转到哪儿都还是 90°
      for (const o of [{ rot: 1, flip: false }, { rot: 2, flip: false }, { rot: 3, flip: false }]) {
        const r = motionNow(snark, o)
        t.ok(!!r, `rot=${o.rot} 也量得到反射巷道`)
        t.ok(!!r.via, `rot=${o.rot} 记下了该拿哪一架滑翔机`)
        t.equal(r.dx * r.outDx + r.dy * r.outDy, 0, `rot=${o.rot} 出射仍与入射垂直`)
        t.equal(r.restoredAt, 29, `rot=${o.rot} 同样第 29 代复原 —— 转朝向不改变这件事`)
      }
      // 摆位必须进文档，用户才照得出来（D64：承诺与兑现要对账）
      // 查的是**那三个实测数字在同一段里**，不是"文档里出现过反射器三个字"——
      // 后者在表格里也算数，把整节删掉都不会红（自查时抓到的）。
      const doc = readSrc('docs/patterns.md')
      const recipe = /## Snark 反射器[\s\S]{0,2500}/.exec(doc)
      t.ok(!!recipe, 'docs/patterns.md 里要有"怎么亲手让它拐一次弯"那一节')
      const body = recipe ? recipe[0] : ''
      // 文档现在教的是"照着线和圈放"，不再让人数格子 —— 那两个数字（退 4、错 4）
      // 是内部搜索的中间量，写给用户只会让他去数格子，而数格子正是这次栽跟头的地方（D98）
      t.ok(/小圈/.test(body), '文档教的是照着线上的小圈放')
      t.ok(/不必转也不必翻/.test(body), '文档写明滑翔机原样拖出来即可（手性已经由朝向挑好了）')
      t.ok(/第 \*\*29\*\* 代/.test(body), '文档写着第 29 代逐格复原')
      t.ok(/4\.2 格/.test(body), '文档记着第一版那条线偏了多远')
    }
  },
  {
    name: '元像素零件：入册的六个都有出处与双语域（D96 ①，D64）',
    run(t) {
      const NEW = ['mwss', 'hwss', 'snark', 'qbshuttle', 'block', 'beehive']
      const src = readSrc('src/engine/patterns.js')
      for (const key of NEW) {
        t.ok(!!getPattern(key), `${key} 在图案库里`)
        for (const lang of ['zh', 'en']) {
          t.ok(('pattern.' + key) in DICT[lang], `${lang} 缺 pattern.${key}`)
          t.ok(('pattern.' + key + '.desc') in DICT[lang], `${lang} 缺 pattern.${key}.desc`)
          t.ok(('pattern.' + key + '.simple') in DICT[lang], `${lang} 缺简洁语域名称`)
          t.ok(('pattern.' + key + '.desc.simple') in DICT[lang], `${lang} 缺简洁语域说明`)
        }
      }
      // RLE 原文照录在紧挨着的注释里（D64：ASCII 给读代码的人，RLE 才是对外的凭据）。
      // **逐个查各自那一段**：查全文里"够不够六条"是假守卫 —— 删掉一条，
      // 别人的那几条照样把数字凑够（自查时抓到的）。
      for (const key of NEW) {
        const at = src.indexOf('\n  ' + key + ': `')
        t.ok(at > 0, `${key} 在图案表里`)
        // 窗口必须**只覆盖这一条自己的注释**：往回取固定字数会一路取到上一条的 RLE 上，
        // 于是删掉自己那行照样绿（自查第二次抓到的）。从上一条 ASCII 的结尾算起才准。
        const prevEnd = src.lastIndexOf('`,', at)
        const before = src.slice(prevEnd + 2, at)
        t.ok(/rule = [bB]3\/[sS]23/.test(before), `${key} 紧挨着的注释里要有它自己的 RLE 原文`)
      }
      t.ok(/Mike Playle/.test(src) && /Bill Gosper/.test(src), '作者署名照录')
    }
  },
  {
    name: '玩具盒：每张卡有且仅有一组（D97 ③）',
    run(t) {
      // 分组登记表只此一份。这条守卫盯的就是"新加一个图案却忘了给它分组"——
      // 忘了的话它会从竖条上消失（分组渲染只画登记在册的），而卡片本身还在盒里。
      for (const p of PATTERNS) {
        t.ok(!!p.group, `${p.key} 没有分组`)
        t.ok(PATTERN_GROUPS.includes(p.group), `${p.key} 的分组 ${p.group} 不在登记表里`)
      }
      const grouped = groupedPatterns()
      const flat = grouped.flatMap(g => g.items.map(i => i.key))
      t.equal(flat.length, PATTERNS.length, '分组之后一张不多一张不少')
      t.equal(new Set(flat).size, flat.length, '没有一张卡被分进两组')
      for (const g of grouped) t.ok(g.items.length > 0, `分组 ${g.group} 是空的 —— 空分组只会在竖条上留个孤零零的标题`)
      // 分组标题中英 + 简洁语域齐备
      for (const lang of ['zh', 'en']) {
        for (const g of PATTERN_GROUPS) {
          t.ok(('pattern.group.' + g) in DICT[lang], `${lang} 缺 pattern.group.${g}`)
          t.ok(('pattern.group.' + g + '.simple') in DICT[lang], `${lang} 缺简洁语域的 pattern.group.${g}`)
        }
      }
      // 吞食者与反射器同组：它俩都是"静物形态的机关"，按长相拆开等于把同一件事说成两件
      t.equal(PATTERNS.find(p => p.key === 'eater').group, PATTERNS.find(p => p.key === 'snark').group,
        '吞食者与反射器同组')
      t.equal(PATTERNS.find(p => p.key === 'matt').group, 'original', 'Matt 自己一组（D64 那条界线）')
    }
  },
  {
    name: '玩具盒竖条：宽度够两列，且滚动条冒出来也塌不回一列（D97 ①）',
    run(t) {
      const css = readSrc('src/style.css')
      const rail = /\.toolrail \{[\s\S]*?\n\}/.exec(css)
      t.ok(!!rail, '找得到竖条的样式')
      const width = Number((/width: (\d+)px/.exec(rail[0]) || [])[1])
      const pad = /padding: \d+px (\d+)px/.exec(rail[0])
      const padX = Number(pad ? pad[1] : NaN) * 2
      const gap = Number((/\.rail-list \{ gap: (\d+)px/.exec(css) || [])[1])
      const min = Number((/\.toolrail \.card-list \{ grid-template-columns: repeat\(auto-fill, minmax\(min\((\d+)px/.exec(css) || [])[1])
      for (const [name, v] of [['宽度', width], ['内边距', padX], ['列间距', gap], ['列宽下限', min]]) {
        t.ok(Number.isFinite(v), `${name} 读得出来`)
      }
      // 实测：Chrome 上标准属性 scrollbar-width: thin 优先，滚动条 12px；再加 1px 右边框
      const SCROLLBAR = 12, BORDER = 1
      const usable = width - padX - BORDER - SCROLLBAR
      t.ok(usable >= min * 2 + gap,
        `滚动条冒出来之后仍排得下两列：可用 ${usable} ≥ ${min * 2 + gap}（否则会塌成一列，` +
        '内容更高、滚动条更下不去 —— 第一版取 200px 就撞上了这个反馈环）')
      // 不许再按屏宽把竖条收窄回一列
      t.ok(!/@media \(max-width: 900px\) \{ \.toolrail \{ width/.test(css),
        '不许再有"窄一点的桌面就收窄竖条"那条规则 —— 一收就只剩一列')
    }
  },
  {
    name: '玩具盒竖条：卡片压扁、名称单行、标题只在桌面（D97 ②③）',
    run(t) {
      const css = readSrc('src/style.css')
      const art = Number((/\.toolrail \.card-art \{ width: (\d+)px/.exec(css) || [])[1])
      t.ok(art <= 26, `缩略图缩了一档（${art}px ≤ 26px）`)
      const b = /\.toolrail \.card-text b \{[\s\S]*?\}/.exec(css)
      t.ok(b && /white-space: nowrap/.test(b[0]) && /text-overflow: ellipsis/.test(b[0]),
        '名称单行，超长截断 —— 说明本来就在 title 里')
      // 标题横跨整行，窄屏不出现
      t.ok(/\.rail-group \{[\s\S]*?grid-column: 1 \/ -1/.test(css), '分组标题横跨整行')
      t.ok(/@media \(max-width: 767px\) \{ \.rail-group \{ display: none; \} \}/.test(css),
        '窄屏横滑带不显示分组标题（那儿没地方摆，还会把横滑打断）')
      // 手机卡片一字不动：窄屏那几条原样还在（D75）
      const narrow = [...css.matchAll(/@media \(max-width: 767px\) \{[\s\S]*?\n\}/g)].map(m => m[0]).join('\n')
      t.ok(/flex: 0 0 calc\(\(100% - 24px\) \/ 3\.4\)/.test(narrow), '窄屏卡片宽仍是容器的 1/3.4')
      t.ok(/\.toolrail \.card-art, \.strip \.card-art \{ width: 22px/.test(narrow), '窄屏缩略图仍是 22px')
    }
  },
  {
    name: '滚动条：全站一处样式（D97 ④）',
    run(t) {
      const css = readSrc('src/style.css')
      t.ok(/\* \{ scrollbar-width: thin;/.test(css), '标准属性写在通配选择器上，全站一致')
      t.ok(/::-webkit-scrollbar \{ width: 8px; height: 8px; \}/.test(css), '老 Safari 有兜底')
      // 不许给某个容器单开滚动条样式 —— 那是下一次不一致的开始
      // 逐行看：带 ::-webkit-scrollbar 的那几行，选择器必须**从它自己开头**。
      // 用正则在全文里找"前面有东西"会跨到上一条规则去（第一次就这么假红的）。
      // 注释行不算数（说明文字里也会提到这个选择器）—— 只看真正的规则行
      const offenders = css.split('\n')
        .filter(line => line.includes('::-webkit-scrollbar') && line.includes('{'))
        .filter(line => !line.trim().startsWith('::-webkit-scrollbar'))
      t.equal(offenders.length, 0, `不许给单个容器另写滚动条样式（发现 ${offenders.join(' / ')}）`)
      // 说清楚它不是真"覆盖式"：注释里要写明白，别让下一个人以为做到了
      t.ok(/真正的"覆盖式"|不占布局宽度/.test(css), '注释里说明这是细而半透明，不是真覆盖式')
    }
  },
  {
    name: '动向线：线上标出来的每个落点，放下去必然发生（D98 ③）',
    run(t) {
      // 这一条是这一轮的核心：**线本身要过喂食测试**。
      // 以前测的是"量出来的方向对不对"，线画在哪儿没人管 —— 于是反射器的线
      // 从包围盒中心画出去，与真正能接收的航道差了四格，用户把两条线对齐了照样撞爆。
      //
      // 现在测的是这么一句：**画出来的小圈，每一个放下去都得成**。
      // 用的是渲染器实际用的那两个出口（rayAnchor / landingDots），不另算一份几何。
      const N = 70
      const ORI = [{ rot: 0, flip: false }, { rot: 1, flip: false }, { rot: 2, flip: false }, { rot: 3, flip: false },
        { rot: 0, flip: true }, { rot: 1, flip: true }, { rot: 2, flip: true }, { rot: 3, flip: true }]

      for (const key of ['eater', 'snark']) {
        for (const o of ORI) {
          const base = getPattern(key)
          const pat = (o.rot || o.flip) ? transformPattern(base, o) : base
          const m = motionNow(base, o)
          t.ok(!!m, `${key} rot=${o.rot} flip=${o.flip} 量得到动向`)
          if (!m) continue
          // 互动型必须报"该拿哪一架来对"：同一个方向上有两种手性的滑翔机，只有一种对得上
          t.ok(!!m.via, `${key} 记下了对应图案的朝向`)
          t.ok(m.landings && m.landings.length >= 5,
            `${key} rot=${o.rot} flip=${o.flip} 线上至少标出五个落点（实际 ${m.landings ? m.landings.length : 0}）`)

          const ox = (N - pat.w) >> 1, oy = (N - pat.h) >> 1
          const anchor = rayAnchor(pat, { x: ox, y: oy }, m)
          const ends = rayEnds(m.kind, anchor, m, { w: N, h: N })
          t.equal(ends.arrowAt, 'to', `${key} 的线箭头指向图案`)
          t.equal(`${ends.to.x},${ends.to.y}`, `${anchor.x},${anchor.y}`, `${key} 的线末端就是锚点`)

          // 小圈必须落在线上：到直线的垂距不超过半格（画在别处等于骗人）
          const len = Math.hypot(m.dx, m.dy) || 1
          const ux = m.dx / len, uy = m.dy / len
          const dots = landingDots({ x: ox, y: oy }, m)
          t.equal(dots.length, m.landings.length, '每个落点画一个小圈')
          let offMax = 0
          for (const d of dots) {
            const rx = d.x - anchor.x, ry = d.y - anchor.y
            offMax = Math.max(offMax, Math.abs(rx * -uy + ry * ux))
          }
          t.ok(offMax <= 0.5, `${key} rot=${o.rot} 的小圈都在线上（最远 ${offMax.toFixed(2)} 格）`)

          // 逐个放下去跑一遍：**全都得成**
          const glider = (m.via.rot || m.via.flip)
            ? transformPattern(getPattern('glider'), m.via) : getPattern('glider')
          const mk = () => {
            const e = new LifeEngine(N, N, { rule: lifeRule(), boundary: 'dead' })
            placePattern(e, pat, ox, oy)
            e.stats.alive = e.countAlive()
            return e
          }
          const before = mk().cur.slice()
          const pop = pat.cells.length
          let ok = 0
          for (const l of m.landings) {
            const e = mk()
            placePattern(e, glider, ox + l.at.x, oy + l.at.y)
            e.stats.alive = e.countAlive()
            if (e.stats.alive !== pop + 5) continue        // 与图案重叠 = 这个点本就不该标出来
            let hit = false
            for (let g = 1; g <= 160 && !hit; g++) {
              e.step()
              if (key === 'eater') {
                if (e.stats.alive !== pop) continue
                let same = true
                for (let i = 0; i < before.length; i++) if (e.cur[i] !== before[i]) { same = false; break }
                if (same && g > 3) hit = true
              } else {
                if (e.stats.alive !== pop + 5) continue
                let intact = true, extra = 0
                for (let i = 0; i < before.length; i++) {
                  if (before[i] === 1) { if (e.cur[i] !== 1) { intact = false; break } }
                  else if (e.cur[i] === 1) extra++
                }
                if (intact && extra === 5 && g > 20) hit = true
              }
            }
            if (hit) ok++
          }
          t.equal(ok, m.landings.length,
            `${key} rot=${o.rot} flip=${o.flip}：标出来的 ${m.landings.length} 个落点全都成功（实际 ${ok}）——` +
            '画的和能发生的必须是一回事')

          // 再走一遍**用户真正的那条路**：他不会去算 at，他只会
          // "把图案点在小圈所在的那一格上"。所以照 centerOrigin（落子用的同一个函数）再验一次。
          let byClick = 0
          for (const d of dots) {
            const gc = { x: Math.round(d.x), y: Math.round(d.y) }
            const go = centerOrigin(glider, gc.x, gc.y)
            const e = mk()
            placePattern(e, glider, go.x, go.y)
            e.stats.alive = e.countAlive()
            if (e.stats.alive !== pop + 5) continue
            let hit = false
            for (let g = 1; g <= 160 && !hit; g++) {
              e.step()
              if (key === 'eater') {
                if (e.stats.alive !== pop) continue
                let same = true
                for (let i = 0; i < before.length; i++) if (e.cur[i] !== before[i]) { same = false; break }
                if (same && g > 3) hit = true
              } else {
                if (e.stats.alive !== pop + 5) continue
                let intact = true, extra = 0
                for (let i = 0; i < before.length; i++) {
                  if (before[i] === 1) { if (e.cur[i] !== 1) { intact = false; break } }
                  else if (e.cur[i] === 1) extra++
                }
                if (intact && extra === 5 && g > 20) hit = true
              }
            }
            if (hit) byClick++
          }
          t.equal(byClick, dots.length,
            `${key} rot=${o.rot} flip=${o.flip}：**点在小圈那一格**上同样全都成功（实际 ${byClick}/${dots.length}）`)
        }
      }
    }
  },
  {
    name: '动向线：落点是跑出来的、参照线上也有、渲染真的画（D98 ②）',
    run(t) {
      // 上一条测的是"标出来的点都成"。但**光靠几何筛选也可能碰巧全对** ——
      // 自查时把"跑一遍"换成"一律通过"，那条测试居然没红。
      // 所以这里补三条各管一段的：真的跑过、参照线也带、渲染真的画。
      const src = stripLiterals(readSrc('src/engine/motion.js'))
      t.ok(/if \(interactionWorks\(pattern, before, pop, glider, gx, gy, size, motion\.kind\)\)/.test(src),
        '落点必须**逐个跑一遍**才留下 —— 只按几何筛出来的点，遇到死点就会骗人')
      t.ok(/for \(let g = 1; g <= 160; g\+\+\)/.test(src), 'interactionWorks 真的在推演，不是查表')

      // 参照线：放下之后那条线也要带着落点，拿起下一架时照着放
      const eater = getPattern('eater')
      const m = motionNow(eater, { rot: 0, flip: false })
      const origin = { x: 40, y: 40 }
      const ref = refFromPlacement(eater, origin, m)
      const dots = landingDots(origin, m)
      t.ok(ref.dots && ref.dots.length === dots.length && dots.length > 0,
        `参照线带着 ${dots.length} 个落点（实际 ${ref.dots ? ref.dots.length : 0}）`)
      t.equal(`${ref.dots[0].x},${ref.dots[0].y}`, `${dots[0].x},${dots[0].y}`, '与待放那条线上的是同一批点')
      // 落子那一刻就换算成棋盘坐标：参照线是静态贴纸（D91），不该再回头依赖图案对象
      t.ok(ref.dots.every(d => Number.isFinite(d.x) && Number.isFinite(d.y)), '存的是棋盘坐标')

      // 渲染：小圈真的画
      const rend = stripLiterals(readSrc('src/render/renderer.js'))
      t.ok(/if \(opts\.dots && opts\.dots\.length\)/.test(rend), '渲染器要认 opts.dots')
      t.ok(/ctx\.arc\(/.test(rend), '落点画成小圈')
    }
  },
  {
    name: '动向线：出口线画的就是那架滑翔机真飞的那条（D100）',
    run(t) {
      // 用户要的：入口线说"从哪进"，出口线说"拐向哪去"。
      // 守卫口径就是他给的那句：**出口线上标的方向 = 实测出射滑翔机的质心位移**。
      // 顺带把更强的一条也验了：那架滑翔机**真的飞在那条线上**（垂距不超过半格）。
      const N = 90
      const ORI = [{ rot: 0, flip: false }, { rot: 1, flip: false }, { rot: 2, flip: false }, { rot: 3, flip: false },
        { rot: 0, flip: true }, { rot: 1, flip: true }, { rot: 2, flip: true }, { rot: 3, flip: true }]

      for (const o of ORI) {
        const base = getPattern('snark')
        const pat = (o.rot || o.flip) ? transformPattern(base, o) : base
        const m = motionNow(base, o)
        t.ok(!!m.exit, `rot=${o.rot} flip=${o.flip} 量到了出射航道`)
        if (!m.exit) continue
        t.equal(`${m.exit.dx},${m.exit.dy}`, `${m.outDx},${m.outDy}`, '出口线的方向就是实测的出射方向')
        t.equal(m.dx * m.exit.dx + m.dy * m.exit.dy, 0, '入射与出射垂直 —— 它是个 90° 反射器')

        const ox = (N - pat.w) >> 1, oy = (N - pat.h) >> 1
        const bounds = { w: N, h: N }
        const en = entryEnds(pat, { x: ox, y: oy }, m, bounds)
        const ex = exitEnds(pat, { x: ox, y: oy }, m, bounds)
        t.ok(!!en && !!ex, '反射器两条线都有')
        t.equal(en.arrowAt, 'to', '入口线的箭头指向图案')
        t.equal(ex.solidEnd, 'from', '出口线的浓端在图案这一头')
        t.equal(`${ex.from.x},${ex.from.y}`, `${ex.center.x},${ex.center.y}`, '出口线从图案这儿起画')
        const outward = (ex.to.x - ex.from.x) * m.exit.dx + (ex.to.y - ex.from.y) * m.exit.dy
        t.ok(outward > 0, '出口线的箭头朝外')

        // 真跑一遍：把滑翔机放在入口线的落点上，看出射那架走的是不是这条出口线
        const glider = (m.via.rot || m.via.flip)
          ? transformPattern(getPattern('glider'), m.via) : getPattern('glider')
        const e = new LifeEngine(N, N, { rule: lifeRule(), boundary: 'dead' })
        placePattern(e, pat, ox, oy)
        const before = e.cur.slice()
        const land = m.landings[Math.min(2, m.landings.length - 1)]
        placePattern(e, glider, ox + land.at.x, oy + land.at.y)
        e.stats.alive = e.countAlive()
        const pop = pat.cells.length
        let restored = 0
        for (let g = 1; g <= 200 && !restored; g++) {
          e.step()
          if (e.stats.alive !== pop + 5) continue
          let intact = true, extra = 0
          for (let i = 0; i < before.length; i++) {
            if (before[i] === 1) { if (e.cur[i] !== 1) { intact = false; break } }
            else if (e.cur[i] === 1) extra++
          }
          if (intact && extra === 5 && g > 20) restored = g
        }
        t.ok(restored > 0, `rot=${o.rot} flip=${o.flip} 这一发确实反射成功了`)
        if (!restored) continue
        // 量出射那架的位置：**只认离开了图案身子的那一架**。
        // 它刚拐出来时会贴着反射器走，有几格正好压在反射器自己的格子上，
        // "与 before 不同的格子"就数不满五个 —— 那时候量到的质心是缺角的（自查时踩到）。
        const mean = () => {
          const cells = []
          for (let i = 0; i < before.length; i++) {
            if (e.cur[i] === 1 && before[i] !== 1) cells.push(i)
          }
          if (cells.length !== 5) return null
          const outside = cells.every(i => {
            const x = i % N, y = (i / N) | 0
            return x < ox - 1 || x >= ox + pat.w + 1 || y < oy - 1 || y >= oy + pat.h + 1
          })
          if (!outside) return null
          return { x: cells.reduce((a2, i) => a2 + i % N, 0) / 5, y: cells.reduce((a2, i) => a2 + ((i / N) | 0), 0) / 5 }
        }
        let p0 = null
        for (let k = 0; k < 60 && !p0; k++) { e.step(); p0 = mean() }
        let p1 = null
        for (let k = 0; k < 20; k++) e.step()
        p1 = mean()
        t.ok(!!p0 && !!p1, '出射的那架一直在盘上')
        if (!p0 || !p1) continue
        const vx = p1.x - p0.x, vy = p1.y - p0.y
        // 叉积为零 = 平行。**取绝对值**：叉积算出来可能是 -0，
        // 而 Object.is(-0, +0) 是 false —— 断言会在一个完全正确的结果上红（自查时踩到）
        t.equal(Math.abs(Math.round(vx * m.exit.dy - vy * m.exit.dx)), 0,
          `实测位移 (${vx.toFixed(1)},${vy.toFixed(1)}) 与出口线方向 (${m.exit.dx},${m.exit.dy}) 平行`)
        t.ok(vx * m.exit.dx + vy * m.exit.dy > 0, '而且是同一个朝向，不是反着的')
        const len = Math.hypot(m.exit.dx, m.exit.dy)
        const ux = m.exit.dx / len, uy = m.exit.dy / len
        for (const pt of [p0, p1]) {
          const rx = pt.x - ex.center.x, ry = pt.y - ex.center.y
          t.ok(Math.abs(rx * -uy + ry * ux) <= 0.5,
            `出射的滑翔机就在出口线上（垂距 ${Math.abs(rx * -uy + ry * ux).toFixed(2)} 格）`)
        }
      }

      // 吞食者没有出口 —— 进去的东西没再出来，画一条线就是在编
      const eater = getPattern('eater')
      const em = motionNow(eater, { rot: 0, flip: false })
      t.ok(!em.exit, '吞食者没有出射航道')
      t.equal(exitEnds(eater, { x: 0, y: 0 }, em, { w: 60, h: 60 }), null, '吞食者不画出口线')
      t.ok(!!entryEnds(eater, { x: 0, y: 0 }, em, { w: 60, h: 60 }), '但入口线照旧')

      // 枪与飞船：只有出口线，与反射器的出口同一个口径（同一个函数、同一种画法）
      for (const key of ['gun', 'glider']) {
        const p = getPattern(key)
        const mm = motionNow(p, { rot: 0, flip: false })
        t.equal(entryEnds(p, { x: 0, y: 0 }, mm, { w: 140, h: 140 }), null, `${key} 没有入口线`)
        const x = exitEnds(p, { x: 0, y: 0 }, mm, { w: 140, h: 140 })
        t.ok(!!x, `${key} 有出口线`)
        t.equal(`${x.dx},${x.dy}`, `${mm.dx},${mm.dy}`, `${key} 的出口线就是它自己的方向`)
      }

      // 出口线画成虚的、更淡；入口线画成实的（样式是参数，不是第二个画线函数）
      const r = readSrc('src/render/renderer.js')
      t.ok(/if \(opts\.exit\) ctx\.setLineDash/.test(r) && /else ctx\.setLineDash\(\[\]\)/.test(r),
        '入口实线、出口虚线')
      t.ok(/opts\.exit \? 0\.75 : 1/.test(r), '出口线更淡')
      const mainSrc2 = stripLiterals(readSrc('src/main.js'))
      t.ok(/exitEnds\(gp, o, m, bounds\)/.test(mainSrc2), '待放时画出口线')
      t.ok(/r\.exit/.test(mainSrc2), '参照线也带出口线')

      // 参照线里那条出口是**真存下来了**，不是源码里提了一嘴。
      // 冻在落子那一刻：一个点 + 一个方向，够画（D91 说过它是静态贴纸）
      const sn = getPattern('snark')
      const sm = motionNow(sn, { rot: 0, flip: false })
      const ref = refFromPlacement(sn, { x: 30, y: 30 }, sm)
      t.ok(!!ref.exit, '放下反射器之后，参照线带着出口')
      t.equal(`${ref.exit.dx},${ref.exit.dy}`, `${sm.exit.dx},${sm.exit.dy}`, '出口方向与实测一致')
      t.equal(`${ref.exit.center.x},${ref.exit.center.y}`,
        `${30 + sm.exit.lane.x},${30 + sm.exit.lane.y}`, '出口线的点也换算成了棋盘坐标')
      const eref = refFromPlacement(eater, { x: 30, y: 30 }, em)
      t.equal(eref.exit, null, '吞食者的参照线没有出口')
    }
  },
  {
    name: '动向线：枪的线就画在弹道上（D98 ①）',
    run(t) {
      // 枪一并复核：子弹从枪口出来，不从枪身正中出来。
      // 判据是**射出去那架滑翔机离线有多远**，不是"方向对不对"。
      const N = 120
      const gun = getPattern('gun')
      const m = motionNow(gun, { rot: 0, flip: false })
      const ox = (N - gun.w) >> 1, oy = (N - gun.h) >> 1
      const anchor = rayAnchor(gun, { x: ox, y: oy }, m)
      const e = new LifeEngine(N, N, { rule: lifeRule(), boundary: 'dead' })
      placePattern(e, gun, ox, oy)
      e.stats.alive = e.countAlive()
      for (let g = 0; g < 90; g++) e.step()
      // 枪身之外那团东西的质心 = 射出去的那架
      let sx = 0, sy = 0, n = 0
      for (let i = 0; i < e.cur.length; i++) {
        if (e.cur[i] !== 1) continue
        const x = i % N, y = (i / N) | 0
        if (x >= ox - 2 && x < ox + gun.w + 2 && y >= oy - 2 && y < oy + gun.h + 2) continue
        sx += x; sy += y; n++
      }
      t.ok(n >= 5, `第 90 代枪外确实有东西（${n} 格）`)
      const len = Math.hypot(m.dx, m.dy) || 1
      const ux = m.dx / len, uy = m.dy / len
      // 点到直线的距离：把相对锚点的位移投影到法线上
      const rx = sx / n - anchor.x, ry = sy / n - anchor.y
      const off = Math.abs(rx * (-uy) + ry * ux)
      t.ok(off <= 1.5, `射出去的滑翔机就在线上（离线 ${off.toFixed(2)} 格）`)
    }
  },
  {
    name: '访问统计：没配地址就一律不挂，本地一律不挂（D99）',
    run(t) {
      // 两道闸门，缺一不可：
      //   ① 没配地址 —— 构建里根本没有统计这回事；
      //   ② 配了地址但跑在本地 —— 也不发。
      // 第二道是给"用正式包在本地起服务"那种情形兜底的。
      t.equal(shouldCount(undefined, 'example.com'), false, '没配地址就不挂')
      t.equal(shouldCount('', 'example.com'), false, '空地址也不挂')
      t.equal(shouldCount('https://x.goatcounter.com/count', 'localhost'), false, 'localhost 不挂')
      t.equal(shouldCount('https://x.goatcounter.com/count', '127.0.0.1'), false, '回环地址不挂')
      t.equal(shouldCount('https://x.goatcounter.com/count', ''), false, '拿不到域名时不挂')
      t.equal(shouldCount('https://x.goatcounter.com/count', 'geesonchan.github.io'), true, '线上才挂')

      // 源码里不许写死任何统计地址：写死了，别人 fork 去部署就会把访问量记到我们后台
      const src = readSrc('src/analytics.js')
      t.ok(/import\.meta\.env\.VITE_GOATCOUNTER/.test(src), '地址从构建变量来')
      // 查的是**字符串字面量**里有没有具体地址；注释里举例说明形如 xxx.goatcounter.com 是可以的
      const literals = src.match(/(['"`])[^'"`\n]*goatcounter\.com[^'"`\n]*\1/g) || []
      t.equal(literals.length, 0, `源码里不许写死具体的统计地址（发现 ${literals.join(' / ')}）`)
    }
  },
  {
    name: '访问统计：构建里配在哪，一处说了算（D99）',
    run(t) {
      const wf = readSrc('.github/workflows/deploy.yml')
      t.ok(/VITE_GOATCOUNTER:/.test(wf), '构建步骤把地址交给 Vite')
      t.ok(/vars\.GOATCOUNTER/.test(wf), '仓库变量优先 —— 改地址不必动代码')
      // 默认值只在本仓库生效：fork 出去的人不该把访问量记到原作者账号里
      t.ok(/github\.repository == '[\w-]+\/[\w-]+'/.test(wf),
        '默认地址必须用 github.repository 圈住，只在本仓库回落')
      const fallback = /'(https:\/\/[\w-]+\.goatcounter\.com\/count)'/.exec(wf)
      t.ok(!!fallback, '默认地址写成完整的 …/count 形式')
      t.ok(/\/count$/.test(fallback ? fallback[1] : ''), '统计端点是站点地址加 /count')
      // 文档要说清楚它现在配在哪 —— 否则下一个人会去 Settings 里找一个不存在的变量
      const doc = readSrc('docs/deploy.md')
      t.ok(/deploy\.yml/.test(doc), 'deploy.md 里写明默认地址落在 workflow 里')
      t.ok(/vars\.GOATCOUNTER|仓库变量/.test(doc), 'deploy.md 里写明仓库变量仍然优先')
    }
  },
  {
    name: '渲染：缩到每格不足一像素时，缓冲按画布像素分配（D102 ②）',
    run(t) {
      // 原来的做法是"一像素一格"，缓冲按**可见格数**分配 —— 缩得越小反而越大：
      // 4096² 适配整盘那块 ImageData 有 64 MB，而屏幕上只有三百万像素装得下它。
      // 实测改成按像素分配 + 逐像素采样之后：那一遍从 38.3ms 降到 7.7ms，缓冲降到 10.6MB。
      const src = stripLiterals(readSrc('src/render/renderer.js'))
      t.ok(/const coarse = vp\.scale < 1/.test(src), '按"每格不足一像素"分路')
      t.ok(/this\.paintPixels\(engine, visual, x0, y0, bw, bh, vp\.scale/.test(src), '细路走 paintPixels')
      t.ok(/this\.paintCells\(engine, visual, x0, y0, x1, y1/.test(src), '放大时仍走原来那条（一像素一格，放大才清爽）')
      t.ok(/createImageData\(bw, bh\)/.test(src), '缓冲按画布像素数分配')
      t.ok(!/drawImage\(this\.buf, 0, 0, vw, vh/.test(src), 'drawImage 的源尺寸也得跟着缓冲走，不能还按格数')
      t.ok((src.match(/drawImage\(this\.buf, 0, 0, bw, bh/g) || []).length === 2,
        '两条画法（拖尾层与主层）都用同一套尺寸')
      // 代价要写在代码里：最近邻采样会漏格，别让下一个人以为它无损
      const raw = readSrc('src/render/renderer.js')
      t.ok(/最近邻采样，会漏格/.test(raw), '注释里写明这是有损的：会漏格')
    }
  },
  {
    name: '整台机器：RLE 自洽，铺下去一百代空转不死（D103 ④）',
    run(t) {
      // ① 身份：文件里的 x/y 与解出来的包围盒、活细胞数，与条目里声明的三个数必须一致 ——
      //    条目声明这三个数是为了"不必先解析 161 KB 才知道摆不摆得下"，
      //    声明与实物一旦对不上，卡片就会拿错误的尺寸去判断。
      const text = readSrc('public/patterns/otca-metapixel.rle')
      const p = parseRLE(text)
      t.equal(p.w, METAPIXEL_LAYOUT.w, '宽与条目声明一致')
      t.equal(p.h, METAPIXEL_LAYOUT.h, '高与条目声明一致')
      t.equal(p.cells.length, METAPIXEL_LAYOUT.cells, '活细胞数与条目声明一致')
      t.equal(`${p.w}×${p.h}`, '2058×2058', '就是 OTCA 元像素那个尺寸')
      t.equal(compileNotation(p.rule).fingerprint, compileNotation('B3/S23').fingerprint, '标准生命游戏规则')
      t.ok(/#O Brice Due/.test(text), '作者署名照录在文件里')
      t.ok(METAPIXEL_LAYOUT.board >= p.w && METAPIXEL_LAYOUT.board >= p.h, '声明的档位摆得下它')
      t.equal(METAPIXEL_LAYOUT.board, 2304, '元像素档')
      t.equal(METAPIXEL_LAYOUT.boundary, 'dead', '默认死边界 —— 它是一台机器，不该自己绕回来撞自己')
      t.ok(!METAPIXEL_LAYOUT.rle && !!METAPIXEL_LAYOUT.rleUrl, '格子走静态文件，不进首屏包')

      // ② 铺下去真的会空转：跑 100 代，人口始终在实测区间里，且一格不少地活着
      const n = METAPIXEL_LAYOUT.board
      const e = new LifeEngine(n, n, { rule: lifeRule(), boundary: 'dead' })
      const ox = (n - p.w) >> 1, oy = (n - p.h) >> 1
      for (const [x, y] of p.cells) e.set(ox + x, oy + y, 1)
      e.stats.alive = e.countAlive()
      t.equal(e.stats.alive, 64691, '铺盘之后一格不差')
      let min = e.stats.alive, max = e.stats.alive
      for (let g = 1; g <= 100; g++) {
        const st = e.step()
        if (st.alive < min) min = st.alive
        if (st.alive > max) max = st.alive
      }
      // 实测 100 代内 54577–65120。**下界才是要紧的那条**：它证明这台机器在空转而不是在塌
      t.ok(min > 50000, `一百代里人口从没跌破五万（实测最低 ${min}）—— 它在空转，不是在死`)
      t.ok(max < 70000, `也没有失控增长（实测最高 ${max}）`)
      t.ok(e.stats.alive > 60000, `一百代之后仍有 ${e.stats.alive} 格`)

      // ③ **没量到的东西不许写进生平**（D82）：跑满 35,528 代它没回到起点，
      // 所以生平里不许出现 period —— 35,328 是这台机器的设计值，不是我们量到的周期。
      t.ok(METAPIXEL_LAYOUT.life.end !== 'cycle', '生平不许声称是周期局')
      t.ok(!('period' in METAPIXEL_LAYOUT.life), '生平里不许有没量到的周期')
      for (const lang of ['zh', 'en']) {
        const life = DICT[lang]['fav.mp.otca.life']
        t.ok(/35,?528/.test(life), `${lang} 的生平写着实际跑了多少代`)
        t.ok(/54,?337/.test(life) && /65,?280/.test(life), `${lang} 的生平写着实测人口区间`)
      }
      // ④ 说明第一句是导航，不是介绍
      for (const lang of ['zh', 'en']) {
        const full = DICT[lang]['fav.mp.otca.full']
        t.ok(/看不清是正常的|unreadable/.test(full), `${lang} 的说明先讲"看不清是正常的"`)
        t.ok(/Brice Due/.test(full), `${lang} 的说明带作者署名`)
        t.ok(/fav\.mp\.otca\.full\.simple/.test('fav.mp.otca.full.simple') && ('fav.mp.otca.full.simple' in DICT[lang]),
          `${lang} 有简洁语域的说明`)
      }
    }
  },
  {
    name: '六局机关：摆位与生平都是跑出来的（D102 ③）',
    run(t) {
      t.equal(MACHINE_LAYOUTS.length, 6, '六局')
      const lifeFp = compileNotation('B3/S23').fingerprint
      const byId = {}
      for (const e of MACHINE_LAYOUTS) {
        const p = parseRLE(e.rle)
        byId[e.id] = p
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
        for (const [x, y] of p.cells) {
          if (x < x0) x0 = x; if (y < y0) y0 = y
          if (x > x1) x1 = x; if (y > y1) y1 = y
        }
        t.equal(`${p.w}×${p.h}`, `${x1 - x0 + 1}×${y1 - y0 + 1}`, `${e.id} 头行尺寸与包围盒一致`)
        t.equal(compileNotation(p.rule).fingerprint, lifeFp, `${e.id} 是标准生命游戏规则`)
        t.ok(p.w <= 200 && p.h <= 200, `${e.id} 摆得进默认的 200 盘`)
        for (const lang of ['zh', 'en']) {
          for (const suffix of ['', '.desc', '.full', '.life']) {
            t.ok((e.nameKey + suffix) in DICT[lang], `${lang} 缺 ${e.nameKey}${suffix}`)
            t.ok((e.nameKey + suffix + '.simple') in DICT[lang], `${lang} 缺 ${e.nameKey}${suffix}.simple`)
          }
        }
      }

      // **开门 / 关门只差一格**：两局里除吞食者外一模一样，吞食者整体右移一格。
      // 这一条是这一批的招牌，必须钉死 —— 差的若不止一格，那句"一格之差两种命运"就是空话。
      const shut = byId['builtin:mp-door-shut'], open = byId['builtin:mp-door-open']
      const key = c => c[0] + ',' + c[1]
      // 按位置把两块分开：枪在左上（前 9 行），吞食者在右下。
      // **不能用集合差**去比 —— 挪一格之后两个位置有重叠格，差集算出来的不是那 7 格（自查时踩到）。
      const split = q => {
        const gun = [], eater = []
        for (const c of q.cells) (c[1] < 20 ? gun : eater).push(c)
        return { gun, eater }
      }
      const S = split(shut), O = split(open)
      t.equal(S.gun.map(key).sort().join(' '), O.gun.map(key).sort().join(' '), '两局的枪一模一样')
      t.equal(S.eater.length, 7, '关门那局的吞食者是 7 格')
      t.equal(O.eater.length, 7, '开门那局的吞食者也是 7 格')
      t.equal(S.eater.map(c => [c[0] + 1, c[1]]).map(key).sort().join(' '),
        O.eater.map(key).sort().join(' '), '差异正好是"吞食者整体右移一格"，不是别的改动')

      // 生平钉两个便宜的检查点：湮灭跑到全空、造物跑到定型
      const run = (rle, gens) => {
        const q = parseRLE(rle)
        const n = 200
        const e = new LifeEngine(n, n, { rule: lifeRule(), boundary: 'torus' })
        const ox = (n - q.w) >> 1, oy = (n - q.h) >> 1
        for (const [x, y] of q.cells) e.set(ox + x, oy + y, 1)
        e.stats.alive = e.countAlive()
        let settled = 0
        for (let g = 1; g <= gens; g++) {
          const h = e.hash()
          const st = e.step()
          if (st.alive === 0) return { empty: g, alive: 0 }
          if (e.hash() === h) { settled = g; break }
        }
        return { settled, alive: e.stats.alive }
      }
      const a = run(byId['builtin:mp-annihilate'] && MACHINE_LAYOUTS[0].rle, 120)
      t.equal(a.empty, 60, '互相抵消：第 60 代全空')
      const c = run(MACHINE_LAYOUTS[1].rle, 120)
      t.equal(c.settled, 39, '撞出新东西：第 39 代定型')
      t.equal(c.alive, 4, '留下的正好是一块 4 格方块')

      // 观察笔记页：三条原始观察各占一节，且每节都指向对应的那一局（D102 ④）
      const notes = readSrc('docs/metapixel-notes.md')
      t.ok(/Leo & Matt/.test(notes), '署名在页首')
      for (const [title,局] of [['互相抵消', '互相抵消'], ['撞出新东西', '撞出新东西'], ['开门与关门', '关门']]) {
        t.ok(new RegExp('## [一二三四]、' + title).test(notes), `笔记页有「${title}」这一节`)
        t.ok(notes.includes(局), `「${title}」那一节指向对应的局`)
      }
      t.ok(/43 代才恢复/.test(notes), '把"反射器恢复 43 代"这条教训写进去了')
      t.ok(/信号变轨/.test(notes) && /还没有稳定摆位/.test(notes), '没做出来的如实写明')
      // 整台机器那一节（D103 ⑤）：指向那一局，并先教怎么看
      t.ok(/## 五、整台机器/.test(notes), '笔记页有「整台机器」这一节')
      t.ok(/整盘视图里看不清是正常的/.test(notes), '那一节先说清"看不清是正常的"')
      t.ok(/2304² 的死边界盘/.test(notes), '写明它摆在哪种盘上')
    }
  },
  {
    name: '勘探器：默认参数就是规格里写的那几个',
    run(t) {
      t.equal(DEFAULTS.runsPerRule, 3, '每规则默认 3 局不同种子')
      t.equal(DEFAULTS.genCap, 2000, '每局默认代数上限 2000')
      t.equal(DEFAULTS.quickDeathGens, 50, '速死界限 50 代')
    }
  }
)

function now() {
  if (typeof performance !== 'undefined' && performance.now) return performance.now()
  return Date.now()
}
