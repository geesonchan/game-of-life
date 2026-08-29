// Canvas 渲染层：只读引擎状态，绝不修改。
// 为了在 500×500 也保持流畅，先把可见区域画进 1 像素 1 格的 ImageData，
// 再用 drawImage 整体放大（关闭平滑）；避免几万次 fillRect。
// 阶段 2 起，每格填什么颜色由 VisualState（年龄 / 余晖）决定 —— 依然全在渲染层。

import { buildAgeColorLUT, buildAgeIndexLUT, buildGlowLUT, flatColor, PALETTES } from './palette.js'

const COLORS = {
  background: [17, 19, 24],   // 画布底色（棋盘外）
  boardDead: [24, 27, 34],    // 棋盘内的死细胞
  grid: 'rgba(255,255,255,0.07)',
  border: 'rgba(255,255,255,0.18)'
}

const AGE_LUT_SIZE = 512

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

    this.ageIdxLUT = buildAgeIndexLUT()
    this.paletteKey = 'emerald'
    this.glowFrames = 4
    this.rebuildPalette()
    this._viewSig = ''
    this.trailCanvas = null   // 拖尾图层按需创建
    this.trailCtx = null
    this._trailActive = false
  }

  /** 切换色带（同时重建年龄色阶表、余晖表与单色） */
  setPalette(key) {
    if (!PALETTES[key]) return
    this.paletteKey = key
    this.rebuildPalette()
  }

  /** 余晖长度（代） */
  setGlowFrames(n) {
    this.glowFrames = Math.max(1, Math.min(8, n | 0))
    this.glowLUT = buildGlowLUT(this.paletteKey, this.glowFrames, COLORS.boardDead)
  }

  rebuildPalette() {
    this.ageColorLUT = buildAgeColorLUT(this.paletteKey)
    this.glowLUT = buildGlowLUT(this.paletteKey, this.glowFrames, COLORS.boardDead)
    this.flat = flatColor(this.paletteKey)
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
      this._viewSig = '' // 画布尺寸变了，拖尾缓冲作废
    }
    this.dpr = dpr
    return { w, h }
  }

  /**
   * 画一帧。
   * @param {import('../engine/board.js').LifeEngine} engine
   * @param {import('./viewport.js').Viewport} vp
   * @param {import('./visual-state.js').VisualState} visual
   * @param {{ageColoring?:boolean, glow?:boolean, trails?:boolean, trailAlpha?:number}} [opts]
   */
  draw(engine, vp, visual, opts = {}) {
    const ctx = this.ctx
    const cw = this.canvas.width
    const ch = this.canvas.height
    const ageColoring = opts.ageColoring !== false
    const glow = !!opts.glow
    const trails = !!opts.trails

    // 棋盘在屏幕上的矩形
    const rx = (0 - vp.originX) * vp.scale
    const ry = (0 - vp.originY) * vp.scale
    const rw = engine.w * vp.scale
    const rh = engine.h * vp.scale

    // 视口一变，上一帧的拖尾残留就对不上位置了，必须整层重置
    const sig = `${vp.originX}|${vp.originY}|${vp.scale}|${engine.w}|${engine.h}|${cw}x${ch}`
    const viewChanged = sig !== this._viewSig
    this._viewSig = sig

    // 棋盘外：始终铺满不透明底色（even-odd 填充 = 整屏挖掉棋盘矩形）
    ctx.beginPath()
    ctx.rect(0, 0, cw, ch)
    ctx.rect(rx, ry, rw, rh)
    ctx.fillStyle = rgb(COLORS.background)
    ctx.fill('evenodd')

    // 可见的棋盘格范围（裁剪到棋盘内）
    const x0 = Math.max(0, Math.floor(vp.originX))
    const y0 = Math.max(0, Math.floor(vp.originY))
    const x1 = Math.min(engine.w, Math.ceil(vp.originX + cw / vp.scale) + 1)
    const y1 = Math.min(engine.h, Math.ceil(vp.originY + ch / vp.scale) + 1)
    const vw = x1 - x0
    const vh = y1 - y0
    if (vw <= 0 || vh <= 0) {
      ctx.fillStyle = rgb(COLORS.boardDead)
      ctx.fillRect(rx, ry, rw, rh)
      this.strokeBorder(ctx, rx, ry, rw, rh)
      return
    }

    this.paintCells(engine, visual, x0, y0, x1, y1, ageColoring, glow)

    const dx = (x0 - vp.originX) * vp.scale
    const dy = (y0 - vp.originY) * vp.scale
    const dw = vw * vp.scale
    const dh = vh * vp.scale

    if (trails) {
      // 拖尾层：细胞画在自己的图层上逐帧淡出，网格线和外框不参与淡出，
      // 否则它们每帧重画又永不消退，很快会累积成刺眼的实线。
      const tc = this.ensureTrailLayer(cw, ch)
      if (viewChanged || !this._trailActive) {
        tc.clearRect(0, 0, cw, ch)
        tc.fillStyle = rgb(COLORS.boardDead)
      } else {
        tc.fillStyle = rgba(COLORS.boardDead, opts.trailAlpha ?? 0.15)
      }
      tc.fillRect(rx, ry, rw, rh)
      tc.imageSmoothingEnabled = false
      tc.drawImage(this.buf, 0, 0, vw, vh, dx, dy, dw, dh)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(this.trailCanvas, 0, 0)
    } else {
      ctx.fillStyle = rgb(COLORS.boardDead)
      ctx.fillRect(rx, ry, rw, rh)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(this.buf, 0, 0, vw, vh, dx, dy, dw, dh)
    }
    this._trailActive = trails

    // 放得够大时画网格线
    if (vp.scale >= 9) {
      ctx.strokeStyle = COLORS.grid
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = x0; x <= x1; x++) {
        const sx = Math.round((x - vp.originX) * vp.scale) + 0.5
        ctx.moveTo(sx, dy); ctx.lineTo(sx, dy + dh)
      }
      for (let y = y0; y <= y1; y++) {
        const sy = Math.round((y - vp.originY) * vp.scale) + 0.5
        ctx.moveTo(dx, sy); ctx.lineTo(dx + dw, sy)
      }
      ctx.stroke()
    }

    this.strokeBorder(ctx, rx, ry, rw, rh)
  }

  /** 把可见区域按"活细胞年龄 / 死亡余晖"填进 1 像素 1 格的 ImageData */
  paintCells(engine, visual, x0, y0, x1, y1, ageColoring, glow) {
    const vw = x1 - x0
    const vh = y1 - y0
    if (!this.imageData || this.imageData.width !== vw || this.imageData.height !== vh) {
      this.buf.width = vw
      this.buf.height = vh
      this.imageData = this.bufCtx.createImageData(vw, vh)
    }

    const data = this.imageData.data
    const cur = engine.cur
    const bw = engine.w
    const ages = visual.ages
    const decay = visual.decay
    const ageLUT = this.ageColorLUT
    const idxLUT = this.ageIdxLUT
    const glowLUT = this.glowLUT
    const flat = this.flat
    const flat0 = flat[0], flat1 = flat[1], flat2 = flat[2]

    let p = 0
    for (let y = y0; y < y1; y++) {
      const row = y * bw
      for (let x = x0; x < x1; x++) {
        const i = row + x
        if (cur[i] === 1) {
          if (ageColoring) {
            let a = ages[i]
            if (a === 0) a = 1
            else if (a >= AGE_LUT_SIZE) a = AGE_LUT_SIZE - 1
            const k = idxLUT[a] * 3
            data[p] = ageLUT[k]; data[p + 1] = ageLUT[k + 1]; data[p + 2] = ageLUT[k + 2]
          } else {
            data[p] = flat0; data[p + 1] = flat1; data[p + 2] = flat2
          }
          data[p + 3] = 255
        } else if (glow) {
          const d = decay[i]
          if (d > 0) {
            const k = d * 3
            data[p] = glowLUT[k]; data[p + 1] = glowLUT[k + 1]; data[p + 2] = glowLUT[k + 2]
            data[p + 3] = 255
          } else {
            data[p + 3] = 0
          }
        } else {
          data[p + 3] = 0
        }
        p += 4
      }
    }
    this.bufCtx.putImageData(this.imageData, 0, 0)
  }

  /** 拖尾专用图层（与主画布同尺寸，带 alpha） */
  ensureTrailLayer(cw, ch) {
    if (!this.trailCanvas) {
      this.trailCanvas = document.createElement('canvas')
      this.trailCtx = this.trailCanvas.getContext('2d')
    }
    if (this.trailCanvas.width !== cw || this.trailCanvas.height !== ch) {
      this.trailCanvas.width = cw
      this.trailCanvas.height = ch
      this._trailActive = false
    }
    return this.trailCtx
  }

  strokeBorder(ctx, rx, ry, rw, rh) {
    ctx.strokeStyle = COLORS.border
    ctx.lineWidth = 1
    ctx.strokeRect(Math.round(rx) + 0.5, Math.round(ry) + 0.5, Math.round(rw), Math.round(rh))
  }
}

function rgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})` }
function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})` }
