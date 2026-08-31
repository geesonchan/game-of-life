// 生平探针：把一条收藏的布局按**内置精选局同一口径**实跑一遍，得出它的生平。
//
// 口径只有一个，写死在 PROBE_SPEC 里：应用默认的 200×200 环形盘 + 应用自己的终止检测器。
// 理由见 docs/decisions.md D82 §8 与 D83 §2 —— 野火那条曾用"大盘 + 核心窗口"量过，
// 得到的数是被窗口裁出来的，换个窗口就变。用户点「复现」看到的是默认盘上的那一局，
// 卡片上的数就必须是那一局的数，否则卡片在说另一个世界的事。
//
// 分块跑，不是一口气跑完：200×200 跑满上限要两秒多，同步跑会把界面冻住 ——
// 而这件事发生在用户刚点完「收藏」的那一刻，正是最不该卡的时候。
// 所以这里只提供"再跑 n 代"的接口，什么时候跑、跑多少由调用方（界面）决定。
import { LifeEngine } from '../engine/board.js'
import { parseRLE } from '../engine/rle.js'
import { compileNotation } from '../engine/rules.js'
import { TerminationDetector } from './detector.js'
import { ruleOf } from './favorites.js'

/**
 * 生平的口径。改这里就等于改所有自存卡片上的数字 ——
 * 有守卫钉住 board/boundary，因为词条里写着"默认 200×200 环形盘"，两边必须一致。
 */
export const PROBE_SPEC = Object.freeze({ board: 200, boundary: 'torus', genCap: 5000 })

/** 界面每一帧跑多少代：够短，短到一帧掉不下去；够长，长到几秒内能跑完上限 */
export const PROBE_CHUNK = 100

/**
 * 造一个探针。
 * @param {string} rle 带 rule 头行的 RLE（收藏条目里存的就是这个）
 * @param {{board?:number, boundary?:string, genCap?:number}} opts 只在测试里改
 * @returns {{spec:object, done:boolean, result:object|null, run:(gens?:number)=>boolean}}
 *          `run(n)` 再跑 n 代，返回是否已经跑完；跑完后 `result` 就位。
 */
export function createLifeProbe(rle, opts = {}) {
  const spec = { ...PROBE_SPEC, ...opts }
  const probe = { spec, done: false, result: null, run }

  let engine = null, detector = null
  let peak = 0, peakGen = 0, startAlive = 0

  // 读不懂就到此为止：认不出的 RLE、编译不了的规则（非 B/S 记法的自定义规则），
  // 这一局在这台机器上根本复现不出来，写个 error 结论止住，免得每次渲染都重试一遍。
  try {
    const p = parseRLE(rle)
    if (!p.cells.length) throw new Error('empty')
    const rule = compileNotation(ruleOf(rle) || 'B3/S23')
    // 图案比默认盘还大就把盘撑到装得下 —— 装不下的话跑的是被截断的另一局
    const n = Math.max(spec.board, p.w, p.h)
    engine = new LifeEngine(n, n, { rule, boundary: spec.boundary })
    const ox = (n - p.w) >> 1, oy = (n - p.h) >> 1   // 与「复现」的居中算法同一条
    for (const [x, y] of p.cells) engine.set(ox + x, oy + y, 1)
    engine.stats.alive = engine.countAlive()
    peak = startAlive = engine.stats.alive
    detector = new TerminationDetector({ genLimit: spec.genCap })
    probe.spec = { ...spec, board: n }
  } catch (e) {
    probe.done = true
    probe.result = { end: 'error', board: spec.board, boundary: spec.boundary }
  }

  function run(gens = PROBE_CHUNK) {
    if (probe.done) return true
    for (let i = 0; i < gens; i++) {
      const st = engine.step()
      if (st.alive > peak) { peak = st.alive; peakGen = st.gen }
      const verdict = detector.observe(st.gen, engine.hash(), st.alive)
      if (verdict) {
        probe.done = true
        probe.result = {
          end: verdict.type,
          board: probe.spec.board,
          boundary: probe.spec.boundary,
          start: startAlive,
          gen: verdict.gen,
          period: verdict.period,
          peak,
          peakGen,
          final: st.alive
        }
        return true
      }
    }
    return false
  }

  return probe
}

/**
 * 一口气跑完（测试与批处理用）。界面**不要**用这个 —— 它会冻住那一帧。
 * @returns {object} 生平
 */
export function probeLife(rle, opts = {}) {
  const p = createLifeProbe(rle, opts)
  while (!p.run(500));
  return p.result
}
