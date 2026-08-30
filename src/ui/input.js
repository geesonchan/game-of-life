// 画布交互：左键画、右键擦、中键/空格平移、滚轮缩放。
// 只改引擎的细胞状态和视口，不掺杂渲染逻辑。

/**
 * 双指手势的数学：两帧的两指位置 → 缩放倍率与平移量。纯函数，可直接测。
 * 抽出来的理由同 D65：手势判断原本会整块埋在 pointermove 回调里，
 * 而这个项目的测试没有 DOM，回调体一行都跑不到 —— 上一个上线才炸的 bug 就是这么来的。
 *
 * 捏合与拖动不分家：真实的捏合总带着漂移，硬分成两种模式会让画面不跟手。
 * @param {{dist:number,cx:number,cy:number}} prev 上一帧
 * @param {{dist:number,cx:number,cy:number}} cur  这一帧
 */
export function pinchDelta(prev, cur) {
  if (!prev || !cur || !(prev.dist > 0)) return { factor: 1, dx: 0, dy: 0, anchorX: cur ? cur.cx : 0, anchorY: cur ? cur.cy : 0 }
  return {
    factor: cur.dist / prev.dist,
    dx: cur.cx - prev.cx,
    dy: cur.cy - prev.cy,
    anchorX: cur.cx,       // 以两指中点为锚，而不是画布中心
    anchorY: cur.cy
  }
}

/** 落第二指时该拿这一笔怎么办（D67）。'rollback' = 判定误画，整笔撤销；'commit' = 保留。 */
export const PROMOTE_MS = 250
export function strokeVerdict(elapsedMs) {
  return elapsedMs < PROMOTE_MS ? 'rollback' : 'commit'
}

export function setupCanvasInput(app) {
  const canvas = app.canvas
  const vp = app.viewport

  let mode = null          // 'paint' | 'erase' | 'pan'
  let lastCell = null
  let lastPointer = null
  let spaceHeld = false
  let selectAnchor = null

  const clampCell = c => ({
    x: Math.max(0, Math.min(app.engine.w - 1, c.x)),
    y: Math.max(0, Math.min(app.engine.h - 1, c.y))
  })

  /* ---------- 笔画记录：为了能整笔撤销（D67） ---------- */
  let stroke = null          // { cells: [[x,y,旧值],…], runDirtyBefore, startedAt }

  function beginStroke() {
    stroke = { cells: [], runDirtyBefore: app.runDirty, startedAt: now() }
  }
  /** 落笔前先记下原值；同一格重复画只记第一次 */
  function noteCell(x, y) {
    if (!stroke) return
    stroke.cells.push([x, y, app.engine.get(x, y)])
  }
  /** 整笔撤销：格子还原、脏标记还原。画面和账一起回滚，缺一不可。 */
  function rollbackStroke() {
    if (!stroke) return
    for (let i = stroke.cells.length - 1; i >= 0; i--) {
      const c = stroke.cells[i]
      app.engine.set(c[0], c[1], c[2])
    }
    app.engine.stats.alive = app.engine.countAlive()
    app.visual.reconcile(app.engine)
    app.runDirty = stroke.runDirtyBefore
    stroke = null
    app.dirty = true
    app.updateHud()
  }
  /** 收笔：这时才记账 */
  function commitStroke() {
    if (!stroke) return
    if (stroke.cells.length) {
      app.records.noteEdit()   // 轨迹变了，之前攒的哈希作废
      app.markDirtyRun()       // 手绘过的局不能再靠种子重放
    }
    stroke = null
  }
  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
  }

  canvas.addEventListener('contextmenu', e => e.preventDefault())

  /* ================= 触控手势（方案见 docs/decisions.md D67） =================
     单指画 / 双指捏合缩放 + 拖动平移。矛盾在于第二根手指永远晚于第一根 ——
     等我们知道这是手势时，第一笔早画上了。做法是乐观绘制 + 限时回滚。 */

  const touches = new Map()     // pointerId → {x, y}（设备像素）
  let gesture = null            // {dist, cx, cy} 上一帧的两指距离与中点
  let firstTouchAt = 0

  const isTouch = e => e.pointerType === 'touch'

  /** 两指的距离与中点 */
  function pinchOf() {
    const [a, b] = [...touches.values()]
    const dx = b.x - a.x, dy = b.y - a.y
    return { dist: Math.hypot(dx, dy), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
  }

  /** 第二根手指落下：从画笔升级为双指手势 */
  function promoteToGesture() {
    if (mode === 'paint' || mode === 'erase') {
      // 快 = 用户本来就想捏合，那一小段是误画，整笔撤销；
      // 慢 = 用户真的画了一笔然后想缩放，保留已画的，正常收笔。
      if (strokeVerdict(now() - firstTouchAt) === 'rollback') rollbackStroke()
      else commitStroke()
    }
    mode = 'gesture'
    lastCell = null
    canvas.classList.remove('panning')
    gesture = pinchOf()
  }

  // iOS 私有手势事件：即使画布已经 touch-action:none，某些版本仍会触发整页缩放。
  // 只在画布上拦，不碰 document —— 全局拦会把抽屉滚动和按钮点击一起废掉。
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    canvas.addEventListener(type, e => e.preventDefault())
  }

  /** 事件坐标 → 画布设备像素坐标 */
  function devicePos(e) {
    const r = canvas.getBoundingClientRect()
    const dpr = app.renderer.dpr
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr }
  }

  canvas.addEventListener('pointerdown', e => {
    const p0 = devicePos(e)
    if (isTouch(e)) {
      if (touches.size >= 2) return           // 第三根手指一概不理
      touches.set(e.pointerId, p0)
      if (touches.size === 1) firstTouchAt = now()
      if (touches.size === 2) { promoteToGesture(); return }
    }
    // 框选：Shift+左键随时可拖（无模式），或侧栏按钮预备的一次性框选。
    // 简洁模式不启用 —— RLE 面板本来就只在完整模式出现，框出来没地方放（D47）。
    const wantSelect = app.mode === 'full' && e.button === 0 && (e.shiftKey || app.selectArmed)
    app.hideSelectionMenu()
    if (wantSelect) {
      canvas.setPointerCapture(e.pointerId)
      mode = 'select'
      const c = vp.screenToCell(p0.x, p0.y)
      selectAnchor = clampCell(c)
      app.selection = { x0: selectAnchor.x, y0: selectAnchor.y, w: 1, h: 1 }
      app.dirty = true
      return
    }
    // 选中图案时，左键 = 放置，右键 = 取消选择；此时不进画笔
    if (app.stamp && (e.button === 0 || e.button === 2) && !spaceHeld) {
      if (e.button === 2) app.setStamp(null)
      else app.placeStampAt(vp.screenToCell(p0.x, p0.y))
      return
    }
    canvas.setPointerCapture(e.pointerId)
    const p = p0
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
      beginStroke()
      const c = vp.screenToCell(p.x, p.y)
      paintLine(c, c)
      lastCell = c
    }
  })

  canvas.addEventListener('pointermove', e => {
    const p = devicePos(e)
    if (isTouch(e) && touches.has(e.pointerId)) {
      touches.set(e.pointerId, p)
      if (mode === 'gesture' && touches.size === 2) {
        const g = pinchOf()
        const d = pinchDelta(gesture, g)
        vp.zoomAt(d.anchorX, d.anchorY, d.factor)
        vp.panByPixels(d.dx, d.dy)
        gesture = g
        app.dirty = true
        app.updateHud()
        return
      }
    }
    if (mode === 'select') {
      const c = clampCell(vp.screenToCell(p.x, p.y))
      app.selection = {
        x0: Math.min(selectAnchor.x, c.x), y0: Math.min(selectAnchor.y, c.y),
        w: Math.abs(c.x - selectAnchor.x) + 1, h: Math.abs(c.y - selectAnchor.y) + 1
      }
      app.dirty = true
    } else if (mode === 'pan') {
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
    // 图案预览要跟着鼠标走，所以移动就得重画
    if (app.stamp) app.dirty = true
  })

  function endDrag(e) {
    if (mode === 'paint' || mode === 'erase') { commitStroke(); app.captureBaseline() }
    if (mode === 'pan') canvas.classList.remove('panning')
    if (mode === 'select' && app.selection && app.onSelectionDone) {
      // 先框后选：选区留在画布上，松手才问要干嘛（D47）
      app.selectArmed = false
      app.onSelectionDone(app.selection)
    }
    mode = null
    lastCell = null
    if (e && e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId)
    }
  }

  /** 触点抬起：手势要等两根手指都离开才算完，剩一根不退回画笔（那会画出一道意外的线） */
  function endTouch(e) {
    if (!isTouch(e) || !touches.has(e.pointerId)) return false
    touches.delete(e.pointerId)
    if (mode === 'gesture') {
      gesture = null
      if (touches.size === 0) { mode = null; app.captureBaseline() }
      return true
    }
    return false
  }
  canvas.addEventListener('pointerup', e => { if (!endTouch(e)) endDrag(e) })
  canvas.addEventListener('pointercancel', e => { if (!endTouch(e)) endDrag(e) })
  canvas.addEventListener('pointerleave', () => {
    app.hoverCell = null
    if (app.stamp) app.dirty = true
  })

  canvas.addEventListener('wheel', e => {
    e.preventDefault()
    const p = devicePos(e)
    const factor = Math.pow(1.0016, -e.deltaY)
    vp.zoomAt(p.x, p.y, factor)
    app.dirty = true
    app.updateHud()
  }, { passive: false })

  // 空格键按住 = 临时平移模式；Esc 取消图案选择
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !isTyping(e.target)) { spaceHeld = true; e.preventDefault() }
    else if (e.key === 'Escape' && app.stamp
      && document.getElementById('rule-modal').hidden
      && document.getElementById('intro-modal').hidden) {
      app.setStamp(null); e.preventDefault()
    }
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
      noteCell(x0, y0)
      app.engine.set(x0, y0, value)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) { err += dy; x0 += sx }
      if (e2 <= dx) { err += dx; y0 += sy }
    }
    app.engine.stats.alive = app.engine.countAlive()
    app.visual.reconcile(app.engine)  // 手绘的格子补上年龄，擦除的不留残影
    // 记账（noteEdit / markDirtyRun）挪到收笔时的 commitStroke —— 这两件事回滚不掉，
    // 而触控下"这一笔可能其实是捏合的第一根手指"，要能整笔撤销（D67）。
    // 桌面的最终状态不变：抬指时照样都设上，中途也没人能读到。
    app.dirty = true
    app.updateHud()
  }
}

export function isTyping(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
}
