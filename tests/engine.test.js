// Vitest 包装层：把 tests/cases.js 里的用例逐条注册为 it()
// engine 层零 DOM 依赖，直接在 Node 环境跑。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 与 jsc 运行器对齐：给需要检查源文件的用例提供读文件能力
globalThis.readTextFile = path => readFileSync(path, 'utf8')

import { cases } from './cases.js'

describe('阶段 1 · 引擎验收', () => {
  for (const c of cases) {
    it(c.name, () => {
      c.run({
        ok: (cond, msg) => expect(cond, msg).toBe(true),
        equal: (a, b, msg) => expect(a, msg).toBe(b),
        info: (msg) => console.log('   ↳', msg)
      })
    })
  }
})
