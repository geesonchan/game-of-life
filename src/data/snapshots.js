// 每代快照表（规格 3.3）。
// 上限 50,000 条；超出后老的部分每 10 代抽稀 1 条，最近 5,000 条保持全量。
//
// 实现要点：最近窗口用**环形缓冲**而不是数组 shift —— 每代 shift 一个 5,000 长的数组
// 是 O(n)，跑一万代就是五千万次搬运。环形缓冲写入是 O(1)。

const FIELDS = ['gen', 'alive', 'births', 'deathsLonely', 'deathsCrowded', 'activeArea']

export class SnapshotLog {
  /**
   * @param {{cap?:number, recentFull?:number, stride?:number}} [opts]
   *   cap        总条数上限
   *   recentFull 最近多少条保持全量
   *   stride     更老的部分每几代留 1 条
   */
  constructor(opts = {}) {
    this.cap = opts.cap ?? 50000
    this.recentFull = opts.recentFull ?? 5000
    this.stride = opts.stride ?? 10
    this.baseStride = this.stride
    this.reset()
  }

  reset() {
    this.archive = []                              // 抽稀后的老数据，按 gen 升序
    this.recent = new Array(this.recentFull)       // 环形缓冲
    this.head = 0
    this.count = 0
    this.stride = this.baseStride
    this.thinned = 0                               // 被抽稀丢弃的条数，供界面如实显示
  }

  /** 只取规格 3.3 列出的六个字段，别把引擎的内部结构整个塞进来 */
  push(stats) {
    const row = {}
    for (const f of FIELDS) row[f] = stats[f] ?? 0

    if (this.count === this.recentFull) {
      const evicted = this.recent[this.head]
      if (evicted.gen % this.stride === 0) this.archive.push(evicted)
      else this.thinned++
      this.recent[this.head] = row
      this.head = (this.head + 1) % this.recentFull
    } else {
      this.recent[this.head] = row
      this.head = (this.head + 1) % this.recentFull
      this.count++
    }

    // 归档也满了就再抽稀一级（10 → 100 → 1000…），保证总量不越过上限
    if (this.archive.length + this.count > this.cap) this.coarsen()
    return row
  }

  /** 抽稀粒度扩大 10 倍，并把归档里对不上新粒度的条目丢掉 */
  coarsen() {
    this.stride *= 10
    const before = this.archive.length
    this.archive = this.archive.filter(r => r.gen % this.stride === 0)
    this.thinned += before - this.archive.length
  }

  get length() { return this.archive.length + this.count }

  /** 最近窗口按时间顺序展开 */
  recentRows() {
    const out = []
    const start = (this.head - this.count + this.recentFull) % this.recentFull
    for (let i = 0; i < this.count; i++) out.push(this.recent[(start + i) % this.recentFull])
    return out
  }

  /** 全部快照，按 gen 升序（归档在前，最近窗口在后） */
  toArray() { return this.archive.concat(this.recentRows()) }

  /** 按代数取一条（用于对账；最近窗口里一定是全量的） */
  at(gen) {
    return this.recentRows().find(r => r.gen === gen) || this.archive.find(r => r.gen === gen) || null
  }

  /** 界面上如实显示"留了多少、丢了多少、当前粒度" */
  get info() {
    return { kept: this.length, thinned: this.thinned, stride: this.stride, full: this.count }
  }
}
