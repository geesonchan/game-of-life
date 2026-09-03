// **浮在画布上的控件，要按"抬手"算点击，不能等浏览器合成 click**（D128）。
//
// 症状：画笔开关与缩放条都"点几次才有反应"。两个不同的控件同样的毛病 ——
// 多半不是各自的 bug，是共同的原因（作者的判断，对）。
//
// 共同的原因：**它们都靠浏览器合成的 `click`**。
// 合成 `click` 有条件：这一下要像"点"，手指移动不能超过浏览器的容差（约 10px）。
// 而这两个控件恰好都**小、且贴着屏幕边缘** —— 拇指够到边上时本来就带着弧线，
// 一划就超过容差，浏览器判成拖动，那一下**静默丢掉**：没有反馈，只能再点一次。
//
// 所以自己按"抬手"算：落手记位置，抬手时只要没走太远就算点了 ——
// **容差放宽到 20px**，比浏览器宽一倍，正好覆盖拇指的自然弧线。
//
// **键盘那条路照旧走 `click`**（焦点在按钮上按回车/空格只会发 click，不发 pointer 事件），
// 所以两条都听；触屏那次点完把紧随其后的合成 click 挡掉，免得触发两遍。

/** 手指容差（px）。浏览器约 10，这里放宽一倍 —— 我们要的正是"别那么挑剔" */
export const TAP_SLOP = 20

/**
 * 给一个控件接上"抬手即点击"。
 *
 * @param {HTMLElement} el
 * @param {(e: Event) => void} fn
 */
export function onTap(el, fn) {
  if (!el) return
  let armed = false
  let x0 = 0
  let y0 = 0
  let swallowClick = false

  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return        // 鼠标那条路本来就准，不插手
    armed = true
    x0 = e.clientX
    y0 = e.clientY
  })
  el.addEventListener('pointerup', e => {
    if (!armed) return
    armed = false
    if (Math.hypot(e.clientX - x0, e.clientY - y0) > TAP_SLOP) return   // 真是在拖
    swallowClick = true                          // 后面那次合成 click 不算数
    fn(e)
  })
  el.addEventListener('pointercancel', () => { armed = false })
  el.addEventListener('click', e => {
    if (swallowClick) { swallowClick = false; return }
    fn(e)
  })
}
