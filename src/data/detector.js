// 终止检测：全灭 / 静止 / 循环 / 代数上限。四条都可单独勾选启用。
//
// 循环检测用 Map（哈希 → 首次出现的代数）做 O(1) 查重，**禁止线性扫描历史**：
// 一万代规模下线性扫描是 5×10^7 次比较，Map 是 1 次哈希查表。

/** 哈希表条数上限：代数上限关掉时也不至于无限吃内存 */
const MAX_HASHES = 200000

export class TerminationDetector {
  constructor(opts = {}) {
    this.enabled = {
      extinction: true, still: true, cycle: true, capped: true,
      ...(opts.enabled || {})
    }
    this.genLimit = opts.genLimit ?? 10000
    this.reset()
  }

  reset() {
    this.seen = new Map()     // 棋盘哈希 → 首次出现的代数
    this.prevHash = null
    this.overflowed = false   // 哈希表满了，之后的代数不再纳入循环检测
  }

  /**
   * 观察一代。**在这一代已经算完之后调用**。
   * @param {number} gen 当前代数
   * @param {string} hash 当前棋盘哈希
   * @param {number} alive 当前活细胞数
   * @returns {null | {type:'extinction'|'still'|'cycle'|'capped', gen:number, period?:number, from?:number}}
   */
  observe(gen, hash, alive) {
    // 顺序要紧：空盘同时满足"全灭"和"静止"，先报更有信息量的全灭；
    // 静止本质上是周期为 1 的循环，先报静止，"循环"就只留给真正的多代周期。
    const prev = this.seen.get(hash)
    let verdict = null
    if (this.enabled.extinction && alive === 0) verdict = { type: 'extinction', gen }
    else if (this.enabled.still && hash === this.prevHash) verdict = { type: 'still', gen }
    else if (this.enabled.cycle && prev !== undefined) {
      verdict = { type: 'cycle', gen, from: prev, period: gen - prev }
    }

    // 两条都很要紧：
    // 1) 记的是这个棋盘**最近一次**出现的代数，不是第一次 —— 周期就是"距上次多久"。
    //    若只记首次，静物从第 0 代一路不变，跑到第 7 代会被算成周期 7，其实是 1。
    // 2) 命中之后也要如实推进历史。命中就提前 return 会在历史里留下空洞，
    //    一旦用户「继续跑」放行，后面算出来的周期会把空掉的那几代算进去。
    this.prevHash = hash
    if (prev !== undefined || this.seen.size < MAX_HASHES) this.seen.set(hash, gen)
    else this.overflowed = true

    if (!verdict && this.enabled.capped && gen >= this.genLimit) verdict = { type: 'capped', gen }
    return verdict
  }

  /** 供界面显示"查重表里存了多少个棋盘" */
  get hashCount() { return this.seen.size }
}
