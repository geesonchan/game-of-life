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

  /** 让整块棋盘居中铺满画布 */
  fit(canvasW, canvasH, boardW, boardH, margin = 0.98) {
    this.scale = Math.min(canvasW / boardW, canvasH / boardH) * margin
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
