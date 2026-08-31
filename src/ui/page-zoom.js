// 页面被浏览器放大之后的兜底提示（D85 ②c）。
//
// 我们能做的是不去招惹浏览器的缩放（`touch-action`，见 style.css），
// 但招惹不到不等于永远不会发生：用户自己在画布外捏了一下、系统辅助功能放大了页面、
// 或者哪个我们没想到的手势 —— 都可能把整个界面放大。
// 被放大之后最难受的不是放大本身，是**不知道怎么还原**：
// 全屏画布应用没有页面滚动条、没有别的参照物，捏回去这件事得有人告诉他。
//
// 所以这里只做一件事：发现页面被放大了，就在 HUD 底下挂一句话；缩回去了就收起来。
// 不拦截、不强行 scrollTo、不改 viewport —— 那些做法都是跟用户较劲。

/** 超过这个倍数才算"被放大了"。1.05 而不是 1：浏览器的静息值常有 1.0000001 这种毛刺。 */
export const PAGE_ZOOM_THRESHOLD = 1.05

/**
 * 该不该提示。纯函数，便于把边界条件钉在测试里。
 * @param {number|undefined|null} scale `visualViewport.scale`
 * @returns {boolean} 拿不到读数时一律 false —— 宁可不提示，也不能对着没放大的人喊
 */
export function isPageZoomed(scale, threshold = PAGE_ZOOM_THRESHOLD) {
  const n = Number(scale)
  if (!Number.isFinite(n)) return false
  return n > threshold
}

/**
 * 接上 visualViewport。老浏览器没有这个对象，那就什么也不做 ——
 * 兜底提示本身不该成为新的故障点。
 * @returns {{check:Function}} 供测试与手动触发
 */
export function watchPageZoom(app, view = (typeof window !== 'undefined' ? window.visualViewport : null)) {
  const el = document.getElementById('page-zoom-hint')
  if (!el) return { check() {} }

  function check() {
    el.hidden = !isPageZoomed(view && view.scale)
  }

  if (view && view.addEventListener) {
    // resize 是缩放的信号；scroll 是放大之后平移的信号（放大着不动也要一直提示）
    view.addEventListener('resize', check)
    view.addEventListener('scroll', check)
  }
  check()
  return { check }
}
