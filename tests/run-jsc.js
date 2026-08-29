// 备用测试运行器：在没有 Node 的机器上，用 macOS 自带的 JavaScriptCore 跑同一批用例。
//   jsc -m tests/run-jsc.js
// 逻辑与 Vitest 完全共享 tests/cases.js，不是另写一套。
import { cases } from './cases.js'

let passed = 0
let failed = 0
const notes = []

for (const c of cases) {
  const t = {
    ok(cond, msg) { if (!cond) throw new Error(msg || '断言失败') },
    equal(a, b, msg) {
      if (a !== b) throw new Error(`${msg || '断言失败'}：期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`)
    },
    info(msg) { notes.push(`      ↳ ${msg}`) }
  }
  try {
    const n0 = notes.length
    c.run(t)
    passed++
    print(`  ✓ ${c.name}`)
    for (let i = n0; i < notes.length; i++) print(notes[i])
  } catch (err) {
    failed++
    print(`  ✗ ${c.name}`)
    print(`      ${err && err.message ? err.message : err}`)
  }
}

print('')
print(`  ${passed} 通过 / ${failed} 失败 / 共 ${cases.length}`)
if (failed > 0) throw new Error('测试未全部通过')
