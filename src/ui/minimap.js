// 小地图（D109）：整盘一眼，外加"我现在看的是哪一块"。
//
// 为什么需要它：4 像素/格时屏幕上只装得下二十万格，而元像素有四百多万格 ——
// 放大到能看清机器的那一刻，人就迷路了（D101 §4 里那条"小地图最划算"就是说这个）。
//
// 三条克制：
//   · **看得全整盘时不出现** —— 那时它只是块多余的遮挡；
//   · **不每帧重画** —— 它是张概览，慢半拍不影响判断；每 250ms 一次，且只在真变了时画；
//   · **不碰引擎** —— 只读 `engine.cur`，与渲染器同一条规矩。
import { isBigBoard } from '../data/board-sizes.js'

/** 多久重画一次（毫秒）。概览不需要跟着帧率走 */
export const REDRAW_MS = 250

/**
 * 该不该露面：**看不全整盘时才露面**。
 * @param {{w:number,h:number}} board 棋盘尺寸
 * @param {{scale:number}} vp 视口
 * @param {{width:number,height:number}} canvas 画布像素尺寸
 */
export function shouldShow(board, vp, canvas) {
  const visW = canvas.width / vp.scale
  const visH = canvas.height / vp.scale
  return visW < board.w * 0.9 || visH < board.h * 0.9
}

/** 视野在小地图上的矩形（0–1 归一化），越界部分照旧画出来，让人看得出"我在边上" */
export function viewBox(board, vp, canvas) {
  return {
    x: vp.originX / board.w,
    y: vp.originY / board.h,
    w: (canvas.width / vp.scale) / board.w,
    h: (canvas.height / vp.scale) / board.h
  }
}

/** 点小地图上某处 → 视野中心该落在哪一格 */
export function pickCenter(board, nx, ny) {
  return { x: Math.max(0, Math.min(board.w, nx * board.w)), y: Math.max(0, Math.min(board.h, ny * board.h)) }
}

export function createMinimap(app) {
  const el = document.getElementById('minimap')
  const ctx = el.getContext('2d')
  let lastDraw = 0
  let lastSig = ''
  let dragging = false

  /** 把整盘降采样画进这张小画布：**逐像素采样**，与大画布缩到最小时是同一套做法（D102 ②） */
  function paint() {
    const e = app.engine
    const w = el.width, h = el.height
    const img = ctx.createImageData(w, h)
    const data = img.data
    const sx = e.w / w, sy = e.h / h
    const c = app.renderer.flat
    let p = 0
    for (let y = 0; y < h; y++) {
      const row = Math.min(e.h - 1, (y * sy) | 0) * e.w
      for (let x = 0; x < w; x++) {
        const v = e.cur[row + Math.min(e.w - 1, (x * sx) | 0)]
        if (v) { data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255 }
        else { data[p] = 20; data[p + 1] = 23; data[p + 2] = 30; data[p + 3] = 210 }
        p += 4
      }
    }
    ctx.putImageData(img, 0, 0)
    // 视野框：画在最上面，边框实、内部不填 —— 它是"框"，不是"高亮块"
    const box = viewBox({ w: e.w, h: e.h }, app.viewport, app.canvas)
    ctx.strokeStyle = 'rgba(255,255,255,.85)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(Math.round(box.x * w) + 0.5, Math.round(box.y * h) + 0.5,
      Math.max(3, Math.round(box.w * w)), Math.max(3, Math.round(box.h * h)))
  }

  function jumpTo(ev) {
    const r = el.getBoundingClientRect()
    const nx = (ev.clientX - r.left) / r.width
    const ny = (ev.clientY - r.top) / r.height
    const c = pickCenter({ w: app.engine.w, h: app.engine.h }, nx, ny)
    const vp = app.viewport
    vp.originX = c.x - app.canvas.width / (2 * vp.scale)
    vp.originY = c.y - app.canvas.height / (2 * vp.scale)
    app.dirty = true
    lastSig = ''            // 视野变了，下一拍立刻重画
  }

  el.addEventListener('pointerdown', ev => {
    dragging = true
    el.setPointerCapture(ev.pointerId)
    jumpTo(ev)
    ev.preventDefault()
  })
  el.addEventListener('pointermove', ev => { if (dragging) jumpTo(ev) })
  el.addEventListener('pointerup', ev => { dragging = false; el.releasePointerCapture(ev.pointerId) })
  el.addEventListener('pointercancel', () => { dragging = false })

  return {
    /** 主循环每帧叫一次；真正重画由这里节流 */
    tick(now) {
      const show = shouldShow({ w: app.engine.w, h: app.engine.h }, app.viewport, app.canvas)
      if (el.hidden === show) el.hidden = !show
      if (!show) return
      // 画布像素尺寸只在必要时改（改一次就要重新分配 ImageData）
      const px = Math.round(el.clientWidth)
      if (px > 0 && el.width !== px) { el.width = px; el.height = Math.round(el.clientHeight); lastSig = '' }
      if (now - lastDraw < REDRAW_MS) return
      const sig = `${app.engine.generation}|${app.viewport.originX.toFixed(1)}|${app.viewport.originY.toFixed(1)}|${app.viewport.scale.toFixed(2)}`
      if (sig === lastSig) return
      lastSig = sig
      lastDraw = now
      paint()
    }
  }
}
