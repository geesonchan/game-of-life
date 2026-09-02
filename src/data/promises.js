// **给用户看的数字，必须与执行它的动作出自同一处计算**（D110 §12）。
//
// 这条通则是同一条原理的第三次出现：
//   · D70 —— 承诺与兑现必须由**同一个条件**挑（说了送小家伙就得送）；
//   · D110 §7 —— 派生值不许被回写成意图（棘轮）；
//   · 这一条 —— 提示里的**数**与动作用的**数**必须是同一个表达式。
// 三次的形状一样：**两处各算一遍，迟早分叉，而分叉的那一次没人看得见。**
//
// 实例（自查抓到的）：改尺寸的确认框说"那部分会没"，而真正裁的偏移是另算的 ——
// 于是出现"提示说会丢一点、做出来全丢"。提示成了假话，还是我们自己写的假话。
//
// 这张表让它**可扫**：凡是文案里出现数量/时间占位符的词条，都必须在这里登记，
// 并写明"这个数从哪儿来、动作用的是不是同一个"。
// 守卫会反过来查：词典里有数量占位符、这里没登记 —— 当场红。

/** 算数量或时间的占位符名字。纯粹的名字（{name}）、尺寸（{w}）不在此列 */
export const QUANTITY_PLACEHOLDERS = Object.freeze(['n', 'ms', 'gps', 'sec', 'count', 'gens'])

export const QUANTITY_PROMISES = Object.freeze([
  {
    key: 'size.shrink.body',
    holds: ['n'],
    from: 'resizePlan(...).lostCount',
    sameAs: '同一个 plan 对象传给 app.resizeBoard(n, n, { plan })，裁的就是它算出的偏移',
    ok: true
  },
  {
    key: 'share.askGen.body',
    holds: ['n'],
    from: 'app.engine.generation',
    sameAs: '就是引擎当前代数本身，没有第二处计算',
    ok: true
  },
  {
    key: 'fav.show.needEnv.body',
    holds: ['n'],
    from: 'boardNeededBy(entry)',
    sameAs: '这里的 {n} 是**盘尺寸**不是数量；同一个值随后交给 app.resizeBoard(need, need)。' +
      '句子里承诺的"当前棋盘上的东西会一并换掉"由 replayLayout 的 carry:false + clear() 兑现',
    ok: true
  },
  {
    key: 'fav.show.needBoth.body',
    holds: ['n'],
    from: 'boardNeededBy(entry)',
    sameAs: '同上，外加规则名 —— 两者都由同一条 replayLayout 落实',
    ok: true
  },
  {
    key: 'share.replaying',
    holds: ['sec'],
    from: 'etaSeconds(...)（replay-driver.js，经 runReplay 的 onProgress）',
    sameAs: '**同源**：与读档回放共用同一个驱动器，秒数就是那个分片循环按本机实测外推的。' +
      '（这条是登记表自己抓到的 —— 加完 g= 跑测试，它当场红。用户说"别漏在自己脚下"，' +
      '结果确实差点漏在自己脚下。）',
    ok: true
  },
  {
    key: 'io.replayingEta',
    holds: ['sec'],
    from: 'etaSeconds(elapsedMs, done, total)（replay-driver.js）',
    sameAs: '**同源**：与驱动器判断"要不要弹进度条"用的是同一个外推（已跑代数 ÷ 已花时间），' +
      '也就是真正在跑的那个分片循环自己量出来的。读档与链接里的 g= 共用这一份驱动器 —— ' +
      '这是 §12 升格之后的第一个实例，不许两处各算一遍。',
    ok: true
  },
  {
    key: 'board.bigNoteMeasured',
    holds: ['gps', 'ms'],
    from: 'app.measuredStepMs()',
    sameAs: '**同源**（D110 §16）：这就是主循环 recordStepCost 攒出来的那个 EMA，' +
      '卡顿判定用的也是它。一处测量，三处用。',
    ok: true
  },
  {
    key: 'board.bigNote',
    holds: ['gps', 'ms'],
    from: 'costOf(n)（board-sizes.js 的桌面实测表）',
    sameAs: '**只在这台机器还没跑过这一档时出现**，一跑起来就换成上面那条本机实测的。' +
      '此时它是预告不是承诺（D104 预告口径）。用别人机器的数字加免责声明是缓解不是解法，' +
      '所以它现在只是"还没量到"的占位。',
    ok: true
  }
])

/**
 * "**事前**说的那个数"的标记词。
 *
 * 事后如实报数（"解析出 N 格"、"丢了 N 条"）不在这条规则管辖内 —— 它报的就是发生过的事，
 * 天然同源。要管的是**动作还没做、先说出一个数**的那一类：预告、估计、将要失去多少。
 * 这类句子里几乎总有一个标记词，扫它比扫语义靠谱，而且加新词条时一眼看得出该不该登记。
 */
export const ESTIMATE_MARKS = Object.freeze([
  '约', '大约', '预期', '会没', '会裁', '将会', '预计',
  'about', 'approx', 'estimated', 'expect', 'will be lost', 'will be'
])

/** 文案里"事前说了一个数"、却没在上表登记的词条 —— 守卫用它 */
export function unregisteredEstimates(dict) {
  const known = new Set(QUANTITY_PROMISES.map(p => p.key))
  const bad = []
  for (const key of Object.keys(dict)) {
    const text = dict[key]
    if (typeof text !== 'string') continue
    const base = key.replace(/\.simple$/, '')      // 简洁语域跟着主键走
    if (known.has(base)) continue
    const holds = (text.match(/\{(\w+)\}/g) || []).map(h => h.slice(1, -1))
    if (!holds.some(h => QUANTITY_PLACEHOLDERS.indexOf(h) >= 0)) continue
    const low = text.toLowerCase()
    if (ESTIMATE_MARKS.some(m => low.indexOf(m) >= 0)) bad.push(key)
  }
  return bad
}
