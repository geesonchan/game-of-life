// 事件编年史：自动记录里程碑，供时间线展示。
// 只产出 {gen, type, params}，文案由界面按 i18n 词典渲染 —— 数据层不持有人类语言（D22）。

const DEFAULT_MAX = 500

export class Chronicle {
  constructor(opts = {}) {
    this.max = opts.max ?? DEFAULT_MAX
    this.reset()
  }

  reset(boardCells = 0) {
    this.events = []
    this.boardCells = boardCells
    this.peak = 0
    this.peakGen = 0
    this.lastPeakLogged = 0
    this.collapseLogged = false
    this.quietRun = 0
    this.quietLogged = false
  }

  add(gen, type, params = {}) {
    this.events.push({ gen, type, params })
    // 超出上限时丢最老的普通事件，但保留开局与终止这类关键事件
    if (this.events.length > this.max) {
      const i = this.events.findIndex(e => e.type !== 'start' && e.type !== 'end')
      this.events.splice(i === -1 ? 0 : i, 1)
    }
    return this.events[this.events.length - 1]
  }

  /**
   * 每代喂一次统计，自动挑出值得记的时刻。
   * @returns {Array} 本代新增的事件
   */
  observe(stats) {
    const before = this.events.length
    const { gen, alive, activeArea } = stats

    // 人口峰值：只在显著刷新时记，否则开局阶段每代都会刷一条
    if (alive > this.peak) {
      this.peak = alive
      this.peakGen = gen
      if (alive >= this.lastPeakLogged * 1.15 + 5) {
        this.lastPeakLogged = alive
        this.add(gen, 'peak', { alive })
        this.collapseLogged = false   // 新的高点开始，允许再记一次崩塌
      }
    }

    // 崩塌（"区域灭绝"的可观测形式）：从峰值跌到四成以下
    if (!this.collapseLogged && this.peak >= 20 && alive <= this.peak * 0.4) {
      this.collapseLogged = true
      this.add(gen, 'collapse', { alive, peak: this.peak, peakGen: this.peakGen })
    }

    // 安静下来：活动区连续很多代都只占棋盘的极小一块
    if (this.boardCells > 0 && activeArea > 0 && activeArea <= this.boardCells * 0.01) {
      this.quietRun++
      if (!this.quietLogged && this.quietRun >= 50) {
        this.quietLogged = true
        this.add(gen, 'quiet', { activeArea })
      }
    } else {
      this.quietRun = 0
    }

    return this.events.slice(before)
  }
}
