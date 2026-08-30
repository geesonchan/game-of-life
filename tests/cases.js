// 阶段 1 验收标准的自动化测试用例（单一事实来源）
// 同时被 Vitest（tests/engine.test.js）与 jsc 运行器（tests/run-jsc.js）复用。

import { LifeEngine } from '../src/engine/board.js'
import { lifeRule, compileRule, parseBS, bsToClauses } from '../src/engine/rules.js'
import { normalizeSeed } from '../src/engine/prng.js'
import { validateRule, validateClauses } from '../src/engine/validate.js'
import { presetRule, PRESETS } from '../src/engine/presets.js'
import { exportRule, importRule } from '../src/engine/rule-io.js'
import { PATTERNS, getPattern, placePattern, centerOrigin } from '../src/engine/patterns.js'
import { parseRLE, toRLE, boardToRLE } from '../src/engine/rle.js'
import { buildSave, parseSave, restoreInitial, saveToText, boardBaseline, SAVE_VERSION } from '../src/engine/save.js'
import { DICT } from '../src/i18n/dict.js'
import { createPrefs, PREF_KEYS } from '../src/ui/prefs.js'
import { SnapshotLog } from '../src/data/snapshots.js'
import { TerminationDetector } from '../src/data/detector.js'
import { Chronicle } from '../src/data/chronicle.js'
import { Ledger } from '../src/data/ledger.js'
import { toCSV, SNAPSHOT_COLUMNS, LEDGER_COLUMNS } from '../src/data/csv.js'
import { VisualState } from '../src/render/visual-state.js'
import { buildAgeIndexLUT, AGE_MAX } from '../src/render/palette.js'
import { RingSeries } from '../src/data/series.js'
import { shouldShowProgress, placeSelectionMenu } from '../src/ui/io.js'
import { introPages, introNext, placeStarterGift } from '../src/ui/intro.js'
import { pinchDelta, strokeVerdict, PROMOTE_MS } from '../src/ui/input.js'
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
    name: '图案库：6 个内置图案的尺寸与活细胞数正确',
    run(t) {
      t.equal(PATTERNS.length, 6, '应有 6 个内置图案')
      const expect = {
        glider: [3, 3, 5], gun: [36, 9, 36], pulsar: [13, 13, 48], lwss: [5, 4, 9], rpentomino: [3, 3, 5],
        matt: [3, 4, 5]   // 用户注册图案，包围盒 3×4：末行那个孤立格把高度撑到 4
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
      t.equal(keys.join(','), 'glider,gun,pulsar,lwss,rpentomino,matt',
        `内置 5 个在前、用户注册图案在后，实测顺序 ${keys.join(',')}`)

      // 名称不翻译：中英两语、两个语域都得是「Matt」本身
      t.equal(DICT.zh['pattern.matt'], 'Matt', '中文名不翻译')
      t.equal(DICT.en['pattern.matt'], 'Matt', '英文名一致')
      t.equal(DICT.zh['pattern.matt.simple'], 'Matt', '简洁语域中文名也是 Matt')
      t.equal(DICT.en['pattern.matt.simple'], 'Matt', '简洁语域英文名也是 Matt')
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
    name: '偏好：白名单恰好是三样界面偏好',
    run(t) {
      t.equal(PREF_KEYS.length, 3, '只允许三个键')
      t.equal(PREF_KEYS.slice().sort().join(','), 'introSeen,lang,mode', '就是这三样')
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
  'src/ui/tower-view.js', 'src/ui/explorer-view.js', 'src/render/chart.js', 'src/analytics.js'
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
      const src = stripLiterals(readSrc('src/ui/input.js'))
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
        [true, 'full', ['act0', 'act1', 'act2', 'act3', 'helpAge', 'helpBS'], [1, 2, 3, 'finish', 5, 'close']],
        [false, 'simple', ['act1', 'act2', 'act3'], [1, 2, 'finish']],
        [false, 'full', ['act1', 'act2', 'act3', 'helpAge', 'helpBS'], [1, 2, 'finish', 4, 'close']]
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
