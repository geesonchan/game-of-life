// Canvas 渲染层：只读引擎状态，绝不修改。
// 为了在 500×500 也保持流畅，先把可见区域画进 1 像素 1 格的 ImageData，
// 再用 drawImage 整体放大（关闭平滑）；避免几万次 fillRect。

const COLORS = {
  background: [17, 19, 24],   // 画布底色（棋盘外）
  boardDead: [24, 27, 34],    // 棋盘内的死细胞
  alive: [126, 231, 135],     // 活细胞
  grid: 'rgba(255,255,255,0.07)',
  border: 'rgba(255,255,255,0.18)'
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false })
    this.ctx.imageSmoothingEnabled = false
    // 离屏缓冲：1 像素 = 1 格
    this.buf = document.createElement('canvas')
    this.bufCtx = this.buf.getContext('2d')
    this.imageData = null
    this.dpr = 1
  }

  /** 跟随容器尺寸调整画布（考虑设备像素比） */
  resize() {
    const dpr = window.devicePixelRatio || 1
    const rect = this.canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width * dpr))
    const h = Math.max(1, Math.round(rect.height * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
      this.ctx.imageSmoothingEnabled = false
    }
    this.dpr = dpr
    return { w, h }
  }

  /**
   * 画一帧。
   * @param {import('../engine/board.js').LifeEngine} engine
   * @param {import('./viewport.js').Viewport} vp
   */
  draw(engine, vp) {
    const ctx = this.ctx
    const cw = this.canvas.width
    const ch = this.canvas.height
    ctx.fillStyle = rgb(COLORS.background)
    ctx.fillRect(0, 0, cw, ch)

    // 可见的棋盘格范围（裁剪到棋盘内）
    const x0 = Math.max(0, Math.floor(vp.originX))
    const y0 = Math.max(0, Math.floor(vp.originY))
    const x1 = Math.min(engine.w, Math.ceil(vp.originX + cw / vp.scale) + 1)
    const y1 = Math.min(engine.h, Math.ceil(vp.originY + ch / vp.scale) + 1)
    const vw = x1 - x0
    const vh = y1 - y0
    if (vw <= 0 || vh <= 0) return

    if (!this.imageData || this.imageData.width !== vw || this.imageData.height !== vh) {
      this.buf.width = vw
      this.buf.height = vh
      this.imageData = this.bufCtx.createImageData(vw, vh)
    }

    const data = this.imageData.data
    const cur = engine.cur
    const bw = engine.w
    const dead = COLORS.boardDead
    const alive = COLORS.alive
    let p = 0
    for (let y = y0; y < y1; y++) {
      const row = y * bw
      for (let x = x0; x < x1; x++) {
        const c = cur[row + x] === 1 ? alive : dead
        data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255
        p += 4
      }
    }
    this.bufCtx.putImageData(this.imageData, 0, 0)

    const dx = (x0 - vp.originX) * vp.scale
    const dy = (y0 - vp.originY) * vp.scale
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(this.buf, 0, 0, vw, vh, dx, dy, vw * vp.scale, vh * vp.scale)

    // 放得够大时画网格线
    if (vp.scale >= 9) {
      ctx.strokeStyle = COLORS.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = x0; x <= x1; x++) {
        const sx = Math.round((x - vp.originX) * vp.scale) + 0.5
        ctx.moveTo(sx, dy); ctx.lineTo(sx, dy + vh * vp.scale)
      }
      for (let y = y0; y <= y1; y++) {
        const sy = Math.round((y - vp.originY) * vp.scale) + 0.5
        ctx.moveTo(dx, sy); ctx.lineTo(dx + vw * vp.scale, sy)
      }
      ctx.stroke()
    }

    // 棋盘外框
    const tl = vp.boardToScreen(0, 0)
    const br = vp.boardToScreen(engine.w, engine.h)
    ctx.strokeStyle = COLORS.border
    ctx.lineWidth = 1
    ctx.strokeRect(Math.round(tl.x) + 0.5, Math.round(tl.y) + 0.5, Math.round(br.x - tl.x), Math.round(br.y - tl.y))
  }
}

function rgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})` }
