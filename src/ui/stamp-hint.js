// 选中图案期间的可发现性与状态反馈（D87）。
//
// 起因：旋转做出来了（D81），但没人知道它在。D75 ② 定过"可交互区域必须自我宣告"——
// 这里补的正是那句宣告，以及"现在是什么朝向"这个状态的可见形式。
//
// 两件事分工明确：
//   · **那一行提示**（HTML + CSS）：显示与否只看 `body.stamp-active`，桌面/触屏两句由媒体查询挑，
//     这里一行 JS 都不用写 —— 状态本来就在 body 的 class 上，再写一份就会有对不上的那天。
//   · **缩略图即状态**：取用区那张卡片直接画成当前朝向。它走的是 `app.stampPattern()`，
//     与落子用的是**同一个函数**，所以"卡上显示的"与"放下去的"不可能不一致（D87 ④，D70 类的承诺对账）。

// **闪现方案已退役（D89 ①）。** 它当年解决的是"触屏没有悬停、幽灵平时不可见"，
// 办法是按完 ⟳/⇋ 在画布中央闪一秒。两步放置把这个问题从根上解决了：
// 触屏上幽灵**本来就一直在**（待放态），转它、拖它都看得见，不需要闪一下再消失。
// 一个功能被更好的机制取代时，要连同它的常量、纯函数与测试一起撤走 ——
// 留着"暂时没人调"的代码，下一个人会以为它还在起作用。

/**
 * 一次朝向变换之后该弹哪句话。轻，一句，不带角标数字 ——
 * 卡片缩略图已经把"现在是什么朝向"画出来了，toast 只负责"刚才发生了什么"。
 * @param {{rot:number, flip:boolean}} orient
 * @param {'rotate'|'flip'} kind
 */
export function orientToastKey(kind) {
  return kind === 'flip' ? 'stamp.flipped' : 'stamp.rotated'
}

/**
 * 这次选中要不要冒那个气泡（D88 ①）。纯函数，把"只冒到用过一次为止"这条规矩写死在一处。
 * @param {string|null} seenPref 偏好里存的值（'1' = 用过了）
 * @param {boolean} hasStamp 现在是不是选中了图案
 */
export function shouldShowStampTip(seenPref, hasStamp) {
  return !!hasStamp && seenPref !== '1'
}

/** 朝向 → 朝向名（四个方向，与 docs/patterns.md 的对应表同一套说法） */
export const ORIENT_NAMES = Object.freeze(['SE', 'SW', 'NW', 'NE'])

/** 当前朝向的短标签，进 toast 的参数 */
export function orientLabel(orient) {
  const rot = ((orient && orient.rot) | 0) % 4
  return ORIENT_NAMES[(rot + 4) % 4] + (orient && orient.flip ? '′' : '')
}
