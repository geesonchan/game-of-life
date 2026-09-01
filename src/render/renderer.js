// Canvas 渲染层：只读引擎状态，绝不修改。
// 为了在 500×500 也保持流畅，先把可见区域画进 1 像素 1 格的 ImageData，
// 再用 drawImage 整体放大（关闭平滑）；避免几万次 fillRect。
// 阶段 2 起，每格填什么颜色由 VisualState（年龄 / 余晖）决定 —— 依然全在渲染层。

import { buildAgeColorLUT, buildAgeIndexLUT, buildGlowLUT, buildAgingLUT, flatColor, PALETTES } from './palette.js'

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
    this.agingLayers = 0
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

  /** 规则变了要跟着重建衰老态配色（层数决定色阶数） */
  setAgingLayers(n) {
    this.agingLayers = Math.max(0, Math.min(8, n | 0))
    this.agingLUT = buildAgingLUT(this.paletteKey, this.agingLayers, COLORS.boardDead)
  }

  rebuildPalette() {
    this.ageColorLUT = buildAgeColorLUT(this.paletteKey)
    this.glowLUT = buildGlowLUT(this.paletteKey, this.glowFrames, COLORS.boardDead)
    this.agingLUT = buildAgingLUT(this.paletteKey, this.agingLayers, COLORS.boardDead)
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
    const agingLUT = this.agingLUT
    const flat = this.flat
    const flat0 = flat[0], flat1 = flat[1], flat2 = flat[2]

    let p = 0
    for (let y = y0; y < y1; y++) {
      const row = y * bw
      for (let x = x0; x < x1; x++) {
        const i = row + x
        const s = cur[i]
        if (s > 1) {
          // 衰老态：用死亡色系着色，亮度压在活细胞之下
          const k = s * 3
          if (k + 2 < agingLUT.length) {
            data[p] = agingLUT[k]; data[p + 1] = agingLUT[k + 1]; data[p + 2] = agingLUT[k + 2]
            data[p + 3] = 255
          } else {
            data[p + 3] = 0
          }
        } else if (s === 1) {
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

  /**
   * 画图案放置预览（半透明），跟着鼠标走。
   * 画在最上层，不进拖尾图层 —— 它是界面提示，不是棋盘内容。
   */
  /**
   * 动向线（D88 ②）：一条长虚线射线 + 一个箭头。
   * 方向从哪儿来不归它管 —— 它只管画；方向一律是引擎实测出来的（engine/motion.js）。
   */
  drawMotionRay(vp, from, to, arrowAt = 'to', solidEnd = 'from', opts = {}) {
    const ctx = this.ctx
    const p = (bx, by) => ({ x: (bx - vp.originX) * vp.scale, y: (by - vp.originY) * vp.scale })
    const a = p(from.x + 0.5, from.y + 0.5)
    const b = p(to.x + 0.5, to.y + 0.5)
    // 远端渐淡（D89 ②）：线一路画到棋盘边，越远越淡 ——
    // 近处要看清"对没对上"，远处只需交代"往那边去"。
    // 渐变的浓端永远落在**图案那一头**（solidEnd），不管箭头在哪一端。
    const near = solidEnd === 'to' ? b : a
    const far = solidEnd === 'to' ? a : b
    // 参照线退一档（D91）：更淡、更细、箭头也淡下去 ——
    // 它是"刚才那条"，不该和手上正在瞄的那条抢眼睛。
    const k = opts.ref ? 0.45 : 1
    const grad = ctx.createLinearGradient(near.x, near.y, far.x, far.y)
    const c = this.flat
    grad.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${0.8 * k})`)
    grad.addColorStop(0.5, `rgba(${c[0]},${c[1]},${c[2]},${0.35 * k})`)
    grad.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`)
    ctx.save()
    ctx.strokeStyle = grad
    ctx.lineWidth = Math.max(1, Math.min(3, vp.scale / 4)) * (opts.ref ? 0.6 : 1) * (opts.exit ? 0.8 : 1)
    // 两种线，两种说法（D100）：
    //   · **入口线画实的** —— 它是"你要瞄的那条"，要看清对没对上；
    //   · **出口线画虚的、更淡** —— 它是"东西会往哪儿去"，是预告，不该和要瞄的那条抢眼。
    // 枪的弹道、飞船的航线都归后一种：它们说的也是"从我这儿出去的东西走哪条线"。
    if (opts.exit) ctx.setLineDash([Math.max(3, vp.scale * 0.7), Math.max(3, vp.scale * 0.7)])
    else ctx.setLineDash([])
    ctx.globalAlpha = opts.exit ? 0.75 : 1
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
    // 箭头是实的：它标的是"哪一头要紧"，不该跟着淡掉
    const tip = arrowAt === 'from' ? a : b
    const tail = arrowAt === 'from' ? b : a
    const ang = Math.atan2(tip.y - tail.y, tip.x - tail.x)
    const size = Math.max(7, Math.min(18, vp.scale * 1.6)) * (opts.exit ? 0.85 : 1)
    ctx.globalAlpha = 0.85 * k * (opts.exit ? 0.75 : 1)
    ctx.fillStyle = rgb(this.flat)
    ctx.beginPath()
    ctx.moveTo(tip.x, tip.y)
    ctx.lineTo(tip.x - size * Math.cos(ang - 0.4), tip.y - size * Math.sin(ang - 0.4))
    ctx.lineTo(tip.x - size * Math.cos(ang + 0.4), tip.y - size * Math.sin(ang + 0.4))
    ctx.closePath(); ctx.fill()
    // 可落点（D98 ②）：线对上了还不够，还得落在这些点上。
    // 画成小圈而不是实点 —— 它标的是"可以放在这儿"，是个位置，不是个东西。
    if (opts.dots && opts.dots.length) {
      const r = Math.max(2, Math.min(5, vp.scale * 0.28))
      ctx.globalAlpha = 0.7 * k
      ctx.lineWidth = Math.max(1, vp.scale / 8)
      ctx.strokeStyle = rgb(this.flat)
      for (const d of opts.dots) {
        const q = p(d.x + 0.5, d.y + 0.5)
        ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.stroke()
      }
    }
    ctx.restore()
  }

  /**
   * 幽灵。`alpha` 是**倍数**不是绝对值（默认 1 = 原来的样子）：
   * 调用方要整体淡入淡出时乘一个数就行，两档不透明度的相对关系不变。
   * （当年是给"闪现一秒再淡出"用的，那套方案在 D89 ① 被两步放置取代；
   *   参数留着 —— 它是个干净的能力，不是那套方案的残留。）
   */
  drawGhost(vp, pattern, ox, oy, boardW, boardH, alpha = 1) {
    const ctx = this.ctx
    const size = Math.max(1, vp.scale)
    const k = Math.max(0, Math.min(1, alpha))
    ctx.save()
    ctx.globalAlpha = 0.6 * k
    ctx.fillStyle = rgb(this.flat)
    for (const [dx, dy] of pattern.cells) {
      const x = ox + dx, y = oy + dy
      if (x < 0 || y < 0 || x >= boardW || y >= boardH) continue
      const px = (x - vp.originX) * vp.scale
      const py = (y - vp.originY) * vp.scale
      ctx.fillRect(px, py, size, size)
    }
    ctx.globalAlpha = 0.9 * k
    ctx.strokeStyle = rgb(this.flat)
    ctx.setLineDash([4, 3])
    ctx.lineWidth = 1
    const bx = (ox - vp.originX) * vp.scale
    const by = (oy - vp.originY) * vp.scale
    ctx.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5,
      Math.round(pattern.w * vp.scale), Math.round(pattern.h * vp.scale))
    ctx.setLineDash([])
    ctx.restore()
  }

  /** 框选导出 RLE 时的选框，画在最上层 */
  drawSelection(vp, sel) {
    const ctx = this.ctx
    const x = (sel.x0 - vp.originX) * vp.scale
    const y = (sel.y0 - vp.originY) * vp.scale
    const w = sel.w * vp.scale
    const h = sel.h * vp.scale
    ctx.save()
    ctx.fillStyle = 'rgba(126,231,135,0.12)'
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = rgb(this.flat)
    ctx.setLineDash([5, 3])
    ctx.lineWidth = 1
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h))
    ctx.setLineDash([])
    ctx.restore()
  }

  strokeBorder(ctx, rx, ry, rw, rh) {
    ctx.strokeStyle = COLORS.border
    ctx.lineWidth = 1
    ctx.strokeRect(Math.round(rx) + 0.5, Math.round(ry) + 0.5, Math.round(rw), Math.round(rh))
  }
}

function rgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})` }
function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})` }
