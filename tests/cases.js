// 阶段 1 验收标准的自动化测试用例（单一事实来源）
// 同时被 Vitest（tests/engine.test.js）与 jsc 运行器（tests/run-jsc.js）复用。

import { LifeEngine } from '../src/engine/board.js'
import { lifeRule, compileRule, parseBS, bsToClauses } from '../src/engine/rules.js'
import { validateRule, validateClauses } from '../src/engine/validate.js'
import { presetRule, PRESETS } from '../src/engine/presets.js'
import { exportRule, importRule } from '../src/engine/rule-io.js'
import { PATTERNS, getPattern, placePattern, centerOrigin } from '../src/engine/patterns.js'
import { DICT } from '../src/i18n/dict.js'

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
    name: '图案库：5 个内置图案的尺寸与活细胞数正确',
    run(t) {
      t.equal(PATTERNS.length, 5, '应有 5 个内置图案')
      const expect = {
        glider: [3, 3, 5], gun: [36, 9, 36], pulsar: [13, 13, 48], lwss: [5, 4, 9], rpentomino: [3, 3, 5]
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
          const v = String(entries[k]).toLowerCase()
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

function now() {
  if (typeof performance !== 'undefined' && performance.now) return performance.now()
  return Date.now()
}
