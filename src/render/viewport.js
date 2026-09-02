// 视口：棋盘坐标与屏幕坐标的相互换算。
// 架构约束：render 层只读引擎状态，不修改。视口与棋盘完全分离。

export class Viewport {
  constructor() {
    this.originX = 0   // 画布左上角对应的棋盘 X 坐标（可为小数）
    this.originY = 0
    this.scale = 4     // 每格占多少设备像素
    this.minScale = 0.5
    this.maxScale = 40
  }

  /**
   * 存下/还原"看哪儿"。撤销要连取景一起还（`captureSession` 的 `view` 那一格）——
   * 只还格子不还取景的话，撤销之后棋盘对了、视野却停在别处，用户会以为没撤成。
   *
   * 只有这三个数是**意图**（用户拖出来的）；`minScale`/`maxScale` 是派生的钳位，
   * 由盘尺寸和画布算出来，不许回写（D110 §7 那条棘轮）。
   */
  capture() {
    return { originX: this.originX, originY: this.originY, scale: this.scale }
  }

  restore(v) {
    if (!v) return
    this.originX = v.originX
    this.originY = v.originY
    this.scale = v.scale
  }

  /** 让整块棋盘居中铺满画布 */
  fit(canvasW, canvasH, boardW, boardH, margin = 0.98) {
    this.scale = fitScaleOf(canvasW, canvasH, boardW, boardH, margin)
    this.minScale = Math.min(0.5, this.scale * 0.5)
    this.originX = boardW / 2 - canvasW / (2 * this.scale)
    this.originY = boardH / 2 - canvasH / (2 * this.scale)
  }

  /** 以画布上某点为锚点缩放 */
  zoomAt(canvasX, canvasY, factor) {
    const before = this.screenToBoard(canvasX, canvasY)
    this.scale = clamp(this.scale * factor, this.minScale, this.maxScale)
    const after = this.screenToBoard(canvasX, canvasY)
    this.originX += before.x - after.x
    this.originY += before.y - after.y
  }

  /** 按像素平移 */
  panByPixels(dxPx, dyPx) {
    this.originX -= dxPx / this.scale
    this.originY -= dyPx / this.scale
  }

  /** 屏幕（画布设备像素）→ 棋盘浮点坐标 */
  screenToBoard(px, py) {
    return { x: this.originX + px / this.scale, y: this.originY + py / this.scale }
  }

  /** 屏幕 → 棋盘整数格坐标 */
  screenToCell(px, py) {
    const p = this.screenToBoard(px, py)
    return { x: Math.floor(p.x), y: Math.floor(p.y) }
  }

  /** 棋盘坐标 → 屏幕像素 */
  boardToScreen(bx, by) {
    return { x: (bx - this.originX) * this.scale, y: (by - this.originY) * this.scale }
  }
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

/* ---------------- 缩放滑条的刻度（D84） ---------------- */

/**
 * 适配视图那一档的缩放。`fit()` 用的就是这个函数 ——
 * 滑条的最小档因此**天生等于「适配视图」**，而不是在别处照着公式再算一遍。
 * 两处各算一遍的东西迟早会差一点，而"差一点"在这里的表现是：
 * 滑条推到底了，棋盘却还差一圈没露全。
 */
export function fitScaleOf(canvasW, canvasH, boardW, boardH, margin = 0.98) {
  return Math.min(canvasW / boardW, canvasH / boardH) * margin
}

/** 滑条的档位数。0 = 适配视图，ZOOM_STEPS = 现有上限。 */
export const ZOOM_STEPS = 1000

/**
 * 档位 → 缩放倍数。**对数刻度**：等长的一段行程，换来的是等比例的放大。
 * 线性刻度在这里是错的 —— 适配到上限往往跨一个数量级，
 * 线性下"前四分之一行程"就把可用的低倍数全挤没了，而那正是看整盘时要用的一段。
 */
export function zoomFromSlider(v, fit, max) {
  if (!(max > fit)) return fit          // 小棋盘上适配倍数可能已经顶到上限
  const k = clamp(Number(v), 0, ZOOM_STEPS) / ZOOM_STEPS
  return fit * Math.pow(max / fit, k)
}

/** 缩放倍数 → 档位（捏合、滚轮、适配之后要把滑条同步回来）。超出两端的一律钳到两端。 */
export function sliderFromZoom(scale, fit, max) {
  if (!(max > fit)) return 0
  const k = Math.log(Math.max(Number(scale), 1e-9) / fit) / Math.log(max / fit)
  return Math.round(clamp(k, 0, 1) * ZOOM_STEPS)
}
