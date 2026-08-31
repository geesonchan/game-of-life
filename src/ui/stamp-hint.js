// 选中图案期间的可发现性与状态反馈（D87）。
//
// 起因：旋转做出来了（D81），但没人知道它在。D75 ② 定过"可交互区域必须自我宣告"——
// 这里补的正是那句宣告，以及"现在是什么朝向"这个状态的可见形式。
//
// 三件事分工明确：
//   · **那一行提示**（HTML + CSS）：显示与否只看 `body.stamp-active`，桌面/触屏两句由媒体查询挑，
//     这里一行 JS 都不用写 —— 状态本来就在 body 的 class 上，再写一份就会有对不上的那天。
//   · **缩略图即状态**：取用区那张卡片直接画成当前朝向。它走的是 `app.stampPattern()`，
//     与落子用的是**同一个函数**，所以"卡上显示的"与"放下去的"不可能不一致（D87 ④，D70 类的承诺对账）。
//   · **手机闪一下幽灵**：触屏没有悬停，幽灵平时不可见；按完 ⟳/⇋ 得让他看见现在是什么形状。

/** 闪一下幽灵：亮多久、淡多久（毫秒）。1 秒是"看得清又不挡路"。 */
export const GHOST_FLASH = Object.freeze({ hold: 1000, fade: 400 })

/**
 * 闪现幽灵此刻该有多透明。纯函数，边界写在测试里。
 * @param {number} elapsed 从按下那一刻起过了多久
 * @returns {number} 0–1 的不透明度；已经淡完则回 0
 */
export function ghostFlashAlpha(elapsed, spec = GHOST_FLASH) {
  const t = Number(elapsed)
  if (!Number.isFinite(t) || t < 0) return 1
  if (t <= spec.hold) return 1
  const k = (t - spec.hold) / spec.fade
  return k >= 1 ? 0 : 1 - k
}

/** 闪现是不是该收工了（收工时要把临时钉住的锚点还回去） */
export function ghostFlashDone(elapsed, spec = GHOST_FLASH) {
  return Number(elapsed) >= spec.hold + spec.fade
}

/**
 * 一次朝向变换之后该弹哪句话。轻，一句，不带角标数字 ——
 * 卡片缩略图已经把"现在是什么朝向"画出来了，toast 只负责"刚才发生了什么"。
 * @param {{rot:number, flip:boolean}} orient
 * @param {'rotate'|'flip'} kind
 */
export function orientToastKey(kind) {
  return kind === 'flip' ? 'stamp.flipped' : 'stamp.rotated'
}

/** 朝向 → 朝向名（四个方向，与 docs/patterns.md 的对应表同一套说法） */
export const ORIENT_NAMES = Object.freeze(['SE', 'SW', 'NW', 'NE'])

/** 当前朝向的短标签，进 toast 的参数 */
export function orientLabel(orient) {
  const rot = ((orient && orient.rot) | 0) % 4
  return ORIENT_NAMES[(rot + 4) % 4] + (orient && orient.flip ? '′' : '')
}
