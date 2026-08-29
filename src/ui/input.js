// 画布交互：左键画、右键擦、中键/空格平移、滚轮缩放。
// 只改引擎的细胞状态和视口，不掺杂渲染逻辑。

export function setupCanvasInput(app) {
  const canvas = app.canvas
  const vp = app.viewport

  let mode = null          // 'paint' | 'erase' | 'pan'
  let lastCell = null
  let lastPointer = null
  let spaceHeld = false

  canvas.addEventListener('contextmenu', e => e.preventDefault())

  /** 事件坐标 → 画布设备像素坐标 */
  function devicePos(e) {
    const r = canvas.getBoundingClientRect()
    const dpr = app.renderer.dpr
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr }
  }

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId)
    const p = devicePos(e)
    if (e.button === 1 || spaceHeld) {
      mode = 'pan'
      canvas.classList.add('panning')
    } else if (e.button === 0) {
      mode = 'paint'
    } else if (e.button === 2) {
      mode = 'erase'
    }
    lastPointer = p
    if (mode === 'paint' || mode === 'erase') {
      const c = vp.screenToCell(p.x, p.y)
      paintLine(c, c)
      lastCell = c
    }
  })

  canvas.addEventListener('pointermove', e => {
    const p = devicePos(e)
    if (mode === 'pan') {
      vp.panByPixels(p.x - lastPointer.x, p.y - lastPointer.y)
      app.dirty = true
    } else if (mode === 'paint' || mode === 'erase') {
      const c = vp.screenToCell(p.x, p.y)
      if (!lastCell || c.x !== lastCell.x || c.y !== lastCell.y) {
        paintLine(lastCell || c, c)
        lastCell = c
      }
    }
    lastPointer = p
    // 鼠标位置的格坐标显示在 HUD 上
    const c = vp.screenToCell(p.x, p.y)
    app.hoverCell = (c.x >= 0 && c.y >= 0 && c.x < app.engine.w && c.y < app.engine.h) ? c : null
  })

  function endDrag(e) {
    if (mode === 'pan') canvas.classList.remove('panning')
    mode = null
    lastCell = null
    if (e && e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId)
    }
  }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)
  canvas.addEventListener('pointerleave', () => { app.hoverCell = null })

  canvas.addEventListener('wheel', e => {
    e.preventDefault()
    const p = devicePos(e)
    const factor = Math.pow(1.0016, -e.deltaY)
    vp.zoomAt(p.x, p.y, factor)
    app.dirty = true
    app.updateHud()
  }, { passive: false })

  // 空格键按住 = 临时平移模式
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !isTyping(e.target)) { spaceHeld = true; e.preventDefault() }
  })
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') spaceHeld = false
  })

  /** 用 Bresenham 在两个格子之间补齐，避免快速拖动漏格 */
  function paintLine(a, b) {
    const value = mode === 'erase' ? 0 : 1
    let x0 = a.x, y0 = a.y
    const x1 = b.x, y1 = b.y
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1
    let err = dx + dy
    for (;;) {
      app.engine.set(x0, y0, value)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) { err += dy; x0 += sx }
      if (e2 <= dx) { err += dx; y0 += sy }
    }
    app.engine.stats.alive = app.engine.countAlive()
    app.dirty = true
    app.updateHud()
  }
}

export function isTyping(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
}
