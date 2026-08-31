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

/**
 * 方向键把图案挪一格。纯函数，可直接测。
 * 抽出来的理由同 D65：这类判断埋在 keydown 回调里，这个项目的测试就摸不到。
 * @returns {{x:number,y:number}|null} 新位置；不是方向键则返回 null
 */
export function nudgeCell(cell, key, w, h) {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key]
  if (!d) return null
  return {
    x: Math.max(0, Math.min(w - 1, cell.x + d[0])),
    y: Math.max(0, Math.min(h - 1, cell.y + d[1]))
  }
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

  /**
   * 这一笔往格子里写什么（D78）。落指时定下，整笔沿用 ——
   * **不是**每划过一格就取反那一格：那样划过混合区域会变成"翻转花纹"，
   * 既不可预测也没人想要。
   *
   * 值的来源按输入方式分：
   *   桌面：左键恒画、右键恒擦 —— 与现状完全一致，一个像素不动。
   *   触控：读起笔格的状态取反 —— 点空格画、点活格擦。手机没有第二个键，
   *         而取反是自逆的：点错了再点一次就回来，修正错误的动作与犯错的是同一个。
   */
  let strokeValue = 1

  /** 起笔格在盘内才谈得上取反；盘外一律取"画"（那一笔多半还会被回滚掉） */
  function valueFromCell(c) {
    const inside = c.x >= 0 && c.y >= 0 && c.x < app.engine.w && c.y < app.engine.h
    if (!inside) return 1
    return app.engine.get(c.x, c.y) === 1 ? 0 : 1
  }

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
      // 画笔也是"落子"：它把参照线替换掉 —— 画笔没有方向，于是等于清掉（D91）。
      // 留着上一次的线会骗人：棋盘已经不是那条线画下时的棋盘了。
      app.setRefRay(null)
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

  let stampDownAt = null        // 触屏按下时的格子（判"点"还是"拖"）
  let stampMoved = false
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
    // 碰一下画布 = "我又要动视图了"：淡出去的缩放滑条浮回来（D84 ②）
    if (app.zoomBar) app.zoomBar.wake()
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
    // 选中图案时不进画笔。
    // **桌面一步到位，触屏两步**（D89 ①）：触屏上点一下只是把幽灵摆出来，
    // 拖得动、转得了、确认之前引擎与记账一个字都不碰（D67 那条原则）。
    if (app.stamp && !spaceHeld && (isTouch(e) || e.button === 0 || e.button === 2)) {
      if (!isTouch(e) && e.button === 2) { app.setStamp(null); return }
      if (!isTouch(e)) { app.placeStampAt(vp.screenToCell(p0.x, p0.y)); return }
      // 触屏：按下先记住起点，是"点"还是"拖"要等抬手才知道。
      // **先记状态再抓指针**：抓指针是锦上添花（手指滑出画布也能继续跟），
      // 它若抛异常（某些环境下会），也不该把这一次放置整个废掉。
      mode = 'stamp'
      stampDownAt = vp.screenToCell(p0.x, p0.y)
      stampMoved = false
      canvas.setPointerCapture(e.pointerId)
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
      // 触控没有第二个键，改用起笔格取反；桌面沿用按键决定（D78）
      strokeValue = isTouch(e) ? valueFromCell(c) : (mode === 'erase' ? 0 : 1)
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
    if (mode === 'stamp') {
      // 拖着幽灵走。仍旧只改锚点，不碰棋盘（D89 ①）
      const c = clampCell(vp.screenToCell(p.x, p.y))
      if (!stampDownAt || c.x !== stampDownAt.x || c.y !== stampDownAt.y) stampMoved = true
      app.armStampAt(c)
      lastPointer = p
      return
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
    app.updateHoverReadout()      // 坐标要跟着指针走，不能等下一次 updateHud
    // 图案预览要跟着鼠标走，所以移动就得重画
    if (app.stamp) app.dirty = true
  })

  function endDrag(e) {
    if (mode === 'stamp') {
      // 拖过就停在拖到的地方（仍是待放）；只是点一下，就按三选一处置
      if (!stampMoved) {
        const origin = app.stampAnchor()
        const what = tapAction({
          pending: !!app.pendingStamp,
          insideGhost: insideGhostBox(stampDownAt, origin, app.stampPattern())
        })
        if (what === 'arm') app.armStampAt(stampDownAt)
        else if (what === 'confirm') app.confirmStamp()
        else app.cancelPending()
      }
      stampDownAt = null
      stampMoved = false
      mode = null
      if (e && e.pointerId !== undefined && canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId)
      }
      return
    }
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
    app.updateHoverReadout()
    if (app.stamp) app.dirty = true
  })

  /**
   * 按方向键把幽灵挪一格。抽成 app 上的一个动作，是因为**有两处要用它**：
   * 画布的全局按键，以及缩放滑条聚焦时的让位（滑条自己是个 input，
   * 方向键本来归它，选中图案时它显式交出来 —— 见 D84 ④ / D81 §4）。
   * 两处各写一份的话，迟早只有一份记得"幽灵要从鼠标上脱开"。
   * @returns {boolean} 有没有真的挪（不是方向键、或钳在边界外时为 false）
   */
  app.nudgeStamp = function (key) {
    if (!app.stamp) return false
    const from = app.pendingStamp || app.hoverCell ||
      { x: app.engine.w >> 1, y: app.engine.h >> 1 }   // 鼠标不在画布上时从中心起步
    const next = nudgeCell(from, key, app.engine.w, app.engine.h)
    if (!next) return false
    // 一按方向键，幽灵就从鼠标上脱开、钉住 —— 否则鼠标一动就把微调抹掉了。
    // 钉住 = 进入待放态：这与触屏点一下摆出幽灵是同一件事，所以用的是同一个状态源（D90 §4）。
    app.armStampAt(next)
    app.dirty = true
    app.updateHud()
    return true
  }

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
    // 方向键微调图案位置（桌面专属；手机有拖放，不需要）。
    // 一按方向键，幽灵就从鼠标上脱开、钉住待放（同一个状态源，D90 §4）。
    if (app.stamp && !isTyping(e.target) && e.key.startsWith('Arrow')) {
      if (app.nudgeStamp(e.key)) e.preventDefault()
      return
    }
    // R 旋转、F 水平镜像（Golly 惯例）。与方向键微调/回车/Esc 共存 ——
    // 它们改的是不同的量：方向键改位置，R/F 改朝向，回车落子，Esc 取消。
    if (app.stamp && !isTyping(e.target) && !e.metaKey && !e.ctrlKey) {
      const k = e.key.toLowerCase()
      if (k === 'r') { app.rotateStamp(1); e.preventDefault(); return }
      if (k === 'f') { app.flipStamp(); e.preventDefault(); return }
    }
    // 回车落子（位置取幽灵当前所在，不管是鼠标跟着还是方向键钉住的）
    if (app.stamp && !isTyping(e.target) && e.key === 'Enter') {
      const at = app.pendingStamp || app.hoverCell
      if (at) { app.confirmStamp(at); e.preventDefault() }
      return
    }
    if (e.code === 'Space' && !isTyping(e.target)) { spaceHeld = true; e.preventDefault() }
    else if (e.key === 'Escape' && app.stamp
      && document.getElementById('rule-modal').hidden
      && document.getElementById('intro-modal').hidden) {
      // 待放态先退回"拿着图案"，再按一次才放下图案本身 —— 一次 Esc 退一层
      if (app.pendingStamp) app.cancelPending({ keepRef: true })
      else app.setStamp(null)
      e.preventDefault()
    }
  })
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') spaceHeld = false
  })

  /** 用 Bresenham 在两个格子之间补齐，避免快速拖动漏格 */
  function paintLine(a, b) {
    const value = strokeValue      // 落指时定下（D78），整笔不变
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

/**
 * 触屏上"点一下"该干什么（D89 ①，手机两步放置）。
 * 三选一，纯函数，边界写在测试里：
 *   · 还没进待放态 → **摆一个幽灵**（不写棋盘，引擎一动不动）
 *   · 已经在待放态，点在幽灵身上 → **确认落子**
 *   · 已经在待放态，点在别处（空白）→ **取消**
 * @param {{pending:boolean, insideGhost:boolean}} o
 * @returns {'arm'|'confirm'|'cancel'}
 */
export function tapAction(o) {
  if (!o || !o.pending) return 'arm'
  return o.insideGhost ? 'confirm' : 'cancel'
}

/** 点的那一格在不在幽灵的外接框里（含边界） */
export function insideGhostBox(cell, origin, pattern) {
  if (!cell || !origin || !pattern) return false
  return cell.x >= origin.x && cell.x < origin.x + pattern.w &&
    cell.y >= origin.y && cell.y < origin.y + pattern.h
}

export function isTyping(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
}
