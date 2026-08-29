// 视觉状态追踪：细胞的"存活代数"与"死亡余晖"。
// 这两个量纯属视觉效果，因此完全住在渲染层自己的缓冲里，engine 对此一无所知。
// 由主循环在每次 engine.step() 之后调用 advance()，保证与代数同拍（渲染可跳帧，它不跳）。

export class VisualState {
  constructor(size) {
    this.ages = new Uint16Array(size)   // 连续存活代数，0 = 当前不活
    this.decay = new Uint8Array(size)   // 死亡余晖剩余代数，0 = 无残影
  }

  resize(size) {
    this.ages = new Uint16Array(size)
    this.decay = new Uint8Array(size)
  }

  /** 硬重置：按引擎当前状态重建（清空 / 随机填充 / 换尺寸后调用） */
  sync(engine) {
    const cur = engine.cur
    if (this.ages.length !== cur.length) this.resize(cur.length)
    const ages = this.ages, decay = this.decay
    for (let i = 0; i < cur.length; i++) {
      ages[i] = cur[i] === 1 ? 1 : 0
      decay[i] = 0
    }
  }

  /**
   * 软对齐：用户手绘/擦除后调用。
   * 只修补与引擎不一致的格子，已有的年龄梯度不受影响；擦除的格子不留残影
   * （残影是"演化导致的死亡"的语义，手动擦除不算）。
   */
  reconcile(engine) {
    const cur = engine.cur
    if (this.ages.length !== cur.length) return this.sync(engine)
    const ages = this.ages, decay = this.decay
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] === 1) {
        if (ages[i] === 0) ages[i] = 1
      } else if (ages[i] > 0) {
        ages[i] = 0
        decay[i] = 0
      }
    }
  }

  /**
   * 推进一代。必须在 engine.step() 之后、每代调用一次。
   * @param {object} engine 已经跨到新一代的引擎
   * @param {number} glowFrames 余晖长度（0 = 关闭余晖）
   */
  advance(engine, glowFrames) {
    const cur = engine.cur
    if (this.ages.length !== cur.length) this.sync(engine)
    const ages = this.ages, decay = this.decay
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] === 1) {
        const a = ages[i]
        if (a < 65535) ages[i] = a + 1
        if (decay[i] !== 0) decay[i] = 0
      } else if (ages[i] > 0) {
        // ages > 0 说明上一代还活着 ⇒ 本代刚死
        ages[i] = 0
        decay[i] = glowFrames
      } else if (decay[i] > 0) {
        decay[i]--
      }
    }
  }

  /** 余晖长度调小时，把超出的残影钳回来，避免查表越界 */
  clampDecay(maxFrames) {
    const decay = this.decay
    for (let i = 0; i < decay.length; i++) if (decay[i] > maxFrames) decay[i] = maxFrames
  }
}
