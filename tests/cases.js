// 阶段 1 验收标准的自动化测试用例（单一事实来源）
// 同时被 Vitest（tests/engine.test.js）与 jsc 运行器（tests/run-jsc.js）复用。

import { LifeEngine } from '../src/engine/board.js'
import { lifeRule, compileRule, parseBS } from '../src/engine/rules.js'

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

function now() {
  if (typeof performance !== 'undefined' && performance.now) return performance.now()
  return Date.now()
}
