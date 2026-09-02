// 启动时"棋盘从哪儿来"的唯一裁决处（D110）。
//
// 这张表原本只写在 decisions 里（D107 §3），于是它是一句约定 —— 谁想绕都绕得过去。
// 现在它是**数据**：优先级、写入方式、写的是格子还是视图，全在 SOURCES 里；
// 文档那张表与它同源，有测试盯着两边一致。
//
// **三类写入者，各有各的治法（D110 §1）**：
//   · **一次性**（首访随机盘、链接、引导收尾）—— 靠**顺序**：后面的盖前面的；
//   · **周期性**（自动看展轮播）—— 顺序没用，第二帧照样盖掉；只能靠**不启动**；
//   · **响应式**（窗口变化、工具条收起改画布尺寸）—— 随时触发又不能禁；
//     只能剥夺它的决定权：**它无权决定看哪儿，只能从已有意图重算**。

/**
 * 启动来源表。`rank` 越大越晚生效（越晚 = 越有权覆盖）。
 * `writes` 说明它写的是什么：格子 / 视图 / 都不写。
 */
export const SOURCES = Object.freeze([
  { name: 'prefs', rank: 1, kind: 'once', writes: 'none', desc: '偏好恢复（模式/语言/视觉）' },
  { name: 'chooser', rank: 1, kind: 'once', writes: 'view', desc: '首屏儿童版/标准版选择页：不写格子，但收工具条会改画布尺寸' },
  { name: 'firstVisitDemo', rank: 2, kind: 'once', writes: 'cells+view', desc: '首访导演场（随机盘）' },
  { name: 'link', rank: 3, kind: 'once', writes: 'cells+view', desc: '分享链接（取景是它内部最后一步）' },
  { name: 'autoShowcase', rank: 3.5, kind: 'periodic', writes: 'cells+view', desc: '自动看展轮播：有链接时不启动' },
  { name: 'introFinish', rank: 4, kind: 'once', writes: 'cells+view', desc: '引导收尾：有链接时不碰' },
  { name: 'resize', rank: 4.5, kind: 'responsive', writes: 'view', desc: '窗口/画布尺寸变化：只能从已有意图重算' },
  { name: 'user', rank: 5, kind: 'once', writes: 'cells+view', desc: '用户自己的动作：读档/清空/复现/手动看展' }
])

/**
 * 裁决"这次启动棋盘从哪儿来"。**纯函数**：不碰引擎、不碰 DOM，只回一个意图。
 *
 * @param {{share: object|null, firstVisit: boolean, density: number, autoShowcaseEnabled?: boolean}} ctx
 *   `share` 是 decodeShare 成功后的 state（失败或没有就传 null）
 * @returns {{source:string, board?:number, boundary?:string, rule?:string, seed?:number,
 *            density?:number, rle?:string, view?:object, speed?:number,
 *            autoShowcase:boolean, starterGift:boolean}}
 */
export function resolveInitialBoard(ctx) {
  const share = ctx && ctx.share
  if (share) {
    return {
      // **把解出来的那份原样带上**（D110 §21）。逐个字段抄写过一次，
      // 结果 `id=` 落地那天字段抄漏了，链接照常"成功打开"、打开的却是另一局 ——
      // 因为漏掉的字段静默变成"没给"。展开写就不会漏，新字段也不必再改这里。
      ...share,
      source: 'link',
      // 有链接就不许自动看展开播 —— 周期性写盘者靠"不启动"治，不靠排序（D110 §1）
      autoShowcase: false,
      // 引导收尾也不送小家伙：棋盘上已经有他要看的那一局（D107 ③）
      starterGift: false
    }
  }
  // **第三种：有链接，但坏了**（D110 §23）。此前只有"有链接 / 没链接"两条路，
  // 坏链接被归进"没链接" —— 于是引导照常清盘送礼，而"链接坏了"这件事
  // 恰恰对最需要知道的那个人隐藏了：第一次点开、正在走引导的人。
  const broken = ctx && ctx.brokenLink ? { brokenLink: ctx.brokenLink } : null
  if (ctx && ctx.firstVisit) {
    return {
      source: 'firstVisitDemo',
      seed: 4271,
      density: ctx.density,
      autoShowcase: !!(ctx && ctx.autoShowcaseEnabled),
      // 链接坏了也**不送小家伙**：这个人是为那条链接来的，
      // 给他一个滑翔机等于把失败盖掉（D110 §23）
      starterGift: !broken,
      ...broken
    }
  }
  return {
    source: 'empty',
    autoShowcase: !!(ctx && ctx.autoShowcaseEnabled),
    starterGift: !broken,
    ...broken
  }
}

/** 表按 rank 排好的样子，文档那张表照它写 */
export function priorityTable() {
  return SOURCES.slice().sort((a, b) => a.rank - b.rank)
}
