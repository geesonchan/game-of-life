// **可滚动区域必须让人看得出下面还有东西**（D118，作者定）。
//
// 来历：引导第二幕的三张规则卡，页脚一压住第三张，"下面还有"这个信号就一起没了。
// 而第三条恰好是唯一讲"新生命怎么诞生"的 —— 前两条讲死。
// **漏掉它，用户对这个游戏的理解只剩一半。**
//
// 从前那半截露出来的卡片是**偶然**充当了这个信号：盒子恰好比可视区高一点，
// 于是第三张露了个头。那不是设计，是巧合 —— 一改高度就没了（D115 那次就是这么没的）。
// 这里把它变成**明确的**信号：还没到底就在下沿淡出一段。
//
// 为什么用 mask 不用贴一层渐变 DOM：mask 作用在元素的盒子上，**不跟着内容滚**，
// 所以它永远停在下沿；贴 DOM 要么跟着滚、要么得再套一层定位容器。

/** 离底多少像素以内算"到底了"（浏览器的小数舍入要留一点余量） */
const EPS = 2

/**
 * 给一个可滚动元素接上"下面还有"的提示。
 *
 * @param {HTMLElement} el 滚动容器
 * @returns {{refresh: () => void, detach: () => void}}
 *   内容换了（比如引导换一幕）要手动 `refresh()` —— 滚动事件不会因为换内容而触发。
 */
export function attachScrollHint(el) {
  if (!el) return { refresh() {}, detach() {} }
  const update = () => {
    const more = el.scrollHeight - el.clientHeight - el.scrollTop > EPS
    el.classList.toggle('more-below', more)
  }
  el.addEventListener('scroll', update, { passive: true })
  window.addEventListener('resize', update)
  update()
  return {
    refresh: update,
    detach() {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      el.classList.remove('more-below')
    }
  }
}
