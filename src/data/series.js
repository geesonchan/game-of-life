// 数据层：定长环形序列。阶段 2 只用来喂存活数折线图，
// 阶段 4 的每代快照表会在它之上扩展（同样的"记录与渲染无关"原则）。

export class RingSeries {
  constructor(capacity) {
    this.cap = capacity
    this.buf = new Float64Array(capacity)
    this.count = 0   // 已写入总数（可能远大于 cap）
  }

  push(v) {
    this.buf[this.count % this.cap] = v
    this.count++
  }

  /** 当前保留的样本数 */
  get length() { return Math.min(this.count, this.cap) }

  /** i = 0 是保留窗口里最旧的一条 */
  at(i) {
    const start = this.count > this.cap ? this.count % this.cap : 0
    return this.buf[(start + i) % this.cap]
  }

  clear() { this.count = 0 }
}
