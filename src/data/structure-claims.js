// **描述结构的注释，必须与它描述的那个结构一起改、或者一起红**（D110 §12 第五面）。
//
// 前四面管的都是**产品对用户说的话**（数与动作 / 承诺与兑现 / 布尔可用性 / 呈现职责）。
// 这一面第一次落在**文档对代码**上，形状还是同一个：两处各写一遍，迟早分叉，
// 而分叉的那一次没人看得见 —— 注释成了假话，还是我们自己写的假话。
//
// 实例（作者点名的）：B 案落地之后代码里只剩一个呈现者，守卫也钉住了"只许出现一次"，
// 可 `main.js` 那段注释还写着"两个呈现者**二选一**地消费它"。
// 代码那一侧有守卫，注释那一侧没有 —— 于是只有注释会烂。
//
// **能扫的只是一个子集，这一点必须说在前面**：
// 注释里的自然语言整体无法核对。但**对代码位置计数**的那一类断言可以 ——
// 「只有一处」「唯一出口」「两个呈现者」「只此一份」。
// 它们恰好也是最容易烂、而且最要紧的那一类（其余都是理由，只有这一类是事实）。
// 量过：`src/` 全部注释里，泛泛的"数词 + 量词"有 752 处（扫不动）；
// 收窄到"对代码位置计数"只剩 27 处（扫得动）。这张表就是那 27 处的去向。
//
// **扫不动的那一半，如实留成判据**：像"引导开着 → 第三幕那一页说"这种**路由**断言
// 不带数字，形式上无从核对。判据是：改了呈现路径，就得回头读这一段。

/**
 * 反向扫描要看的文件。
 *
 * JSC 运行器只有 `read(path)`，没有列目录 —— 所以这份清单只能显式写。
 * 守卫会核对：登记表里提到的每个文件都得在这儿，否则"登记了但根本没扫"。
 * **新增 src 文件要加进来**；漏加的代价是那一份文件不被扫，不是红 —— 这是这条扫描的边界。
 */
export const SCANNED_FILES = Object.freeze([
  'src/analytics.js',
  'src/data/big-layouts.js',
  'src/data/board-sizes.js',
  'src/data/chronicle.js',
  'src/data/critical.js',
  'src/data/csv.js',
  'src/data/detector.js',
  'src/data/explorer.js',
  'src/data/favorites.js',
  'src/data/ledger.js',
  'src/data/life-probe.js',
  'src/data/lockin.js',
  'src/data/machine-layouts.js',
  'src/data/metapixel-layout.js',
  'src/data/promises.js',
  'src/data/series.js',
  'src/data/session.js',
  'src/data/share.js',
  'src/data/snapshots.js',
  'src/data/startup.js',
  'src/data/structure-claims.js',
  'src/data/tower.js',
  'src/data/twin.js',
  'src/engine/board.js',
  'src/engine/index.js',
  'src/engine/motion.js',
  'src/engine/patterns.js',
  'src/engine/presets.js',
  'src/engine/prng.js',
  'src/engine/rle.js',
  'src/engine/rule-io.js',
  'src/engine/rules.js',
  'src/engine/save.js',
  'src/engine/validate.js',
  'src/i18n/dict.js',
  'src/i18n/index.js',
  'src/main.js',
  'src/render/chart.js',
  'src/render/palette.js',
  'src/render/renderer.js',
  'src/render/viewport.js',
  'src/render/visual-state.js',
  'src/ui/confirm.js',
  'src/ui/controls.js',
  'src/ui/critical-view.js',
  'src/ui/explorer-view.js',
  'src/ui/favorites-view.js',
  'src/ui/input.js',
  'src/ui/intro.js',
  'src/ui/io.js',
  'src/ui/library.js',
  'src/ui/minimap.js',
  'src/ui/numeric-entry.js',
  'src/ui/page-zoom.js',
  'src/ui/prefs.js',
  'src/ui/records.js',
  'src/ui/replay-driver.js',
  'src/ui/rule-editor.js',
  'src/ui/stamp-hint.js',
  'src/ui/tower-view.js',
  'src/ui/zoom-bar.js',
  'src/workers/critical.js',
  'src/workers/explorer.js',
  'src/workers/lockin.js',
  'src/workers/tower-builder.js',
])

/**
 * 对代码位置计数的断言长什么样 —— 反向扫描用它。
 *
 * 只收"这件事在代码里有几处"，不收"一个量只许有一个来源"这种讲道理的话。
 */
export const CLAIM_PATTERN =
  /(?:只有(?:一|两|二|三|四|五|六|七|八|九|十|\d+)(?:处|个|条|份|道|口)|唯一(?:的)?(?:一)?(?:处|个|条|份|入口|出口|渲染者|来源|判断源)|(?:一|两|二|三|四|五|六|七|八|九|十|\d+)(?:处|个|条)(?:写盘|入口|出口|渲染者|呈现者|判断|实现|定位|来源)|只此一(?:处|份)|各只许出现一次|只许出现一次|只有一(?:处|个|份|条))/g

/** 数词前面挨着这些字，说的是"跟谁一样"，不是"有几处" */
export const SAME_PREFIX = Object.freeze(['同', '每', '另', '这', '那', '上', '下'])

/**
 * 登记表。两类：
 *
 * · `pins` —— 这句注释钉着一个**能数的**结构事实。
 *   守卫两头查：注释里那句话还在不在（`says`），代码里那个数还对不对（`scan` / `is`）。
 *   改代码不改注释 → 数对不上，红；改注释不改代码 → `says` 找不到，红。
 *   **两边只能一起改。**
 *
 * · `prose` —— 形式上像计数，实际是在讲道理或讲历史，无从核对。
 *   登记在这儿是为了**让反向扫描闭合**：不是漏掉了，是看过并判定不钉，理由写在 `why`。
 */
export const STRUCTURE_CLAIMS = Object.freeze([
  {
    kind: 'pins',
    file: 'src/main.js',
    says: '也只有一个呈现者',
    what: '这条通知的呈现者',
    scan: { file: 'src/main.js', re: /app\.reportLinkFailure\(/g },
    is: 1,
    note: 'D110 §31 那条 B 案。这一面就是被它的旧版注释逼出来的。'
  },
  {
    kind: 'pins',
    file: 'src/main.js',
    says: '队里那件事的**唯一渲染者**',
    what: '取走通知的地方',
    scan: { file: 'src/main.js', re: /app\.takeNotice\(\)/g },
    is: 1,
    note: '取与呈现各钉一次：一个取不走两次，一个说不成两遍。'
  },
  {
    kind: 'pins',
    file: 'src/main.js',
    says: '开闸有两处：它 + 兜底的 recoverToEmptyBoard',
    what: '启动段里开闸的地方',
    scan: { file: 'src/main.js', re: /app\.unlockBoard\(\)/g },
    is: 2,
    note: '**这条是新守卫自己抓出来的**：注释原本写"唯一开闸处"，' +
      '而 recoverToEmptyBoard（§15 那层兜底）也要开闸，实际两处。' +
      '代码是对的 —— 兜底不开闸连空盘都写不出来；假的是注释。第五面的第二个实例。'
  },
  {
    kind: 'pins',
    file: 'src/ui/controls.js',
    says: '撤销只有这一个入口',
    what: '撤销的入口',
    scan: { file: 'src/ui/controls.js', re: /addEventListener\('click', \(\) => app\.undo\(\)\)/g },
    is: 1,
    note: '临时条撤销之后（D116），撤销只剩控制排那一颗。再加入口就得回来改这句话。'
  },
  {
    kind: 'prose',
    file: 'src/main.js',
    says: '临时条撤掉之后这条路成了唯一入口',
    why: '与 controls.js 那条"撤销只有这一个入口"是同一个事实，钉一次就够。'
  },
  {
    kind: 'pins',
    file: 'src/main.js',
    says: '撤销按钮的**唯一**刷新处',
    what: 'refreshUndo 的实现',
    scan: { file: 'src/main.js', re: /app\.refreshUndo = function/g },
    is: 1,
    note: '"唯一"那两个字就是这条钉的。controls.js 里曾经也有一份，' +
      '因为启动段要用而搬到了 main.js —— 搬完得只剩一份，不能两处都留。'
  },
  {
    kind: 'prose',
    file: 'src/main.js',
    says: '从前是两处各判一次',
    why: '**讲历史** —— 说的是改之前的样子，本来就不该与现在的代码对得上。'
  },
  {
    kind: 'prose',
    file: 'src/main.js',
    says: '走的路只有一条',
    why: '讲的是"按结果挑路"这条道理（§23），不是在数代码位置。'
  },
  {
    kind: 'prose',
    file: 'src/main.js',
    says: '待放态的唯一出口',
    why: '钉得住，但它钉的是 D90 §4 那条，已有自己的守卫；这里不重复钉。'
  },
  {
    kind: 'prose',
    file: 'src/main.js',
    says: '同一件事的两个入口',
    why: '讲的是两个入口落到同一处（D47），不是断言代码里只有两处。'
  },
  {
    kind: 'prose',
    file: 'src/main.js',
    says: '同一条队 + 同一个渲染者',
    why: '与上面第一条是同一个事实的另一处引用，钉一次就够。'
  },
  {
    kind: 'prose',
    file: 'src/main.js',
    says: '启动写盘唯一入口',
    why: '注释自己就点名了守卫（tests/cases.js「启动写盘唯一入口」），已经钉住。'
  },
  {
    kind: 'prose',
    file: 'src/ui/intro.js',
    says: '呈现由那个唯一的渲染者决定',
    why: '引用上面第一条，不另钉。'
  },
  {
    kind: 'prose',
    file: 'src/ui/replay-driver.js',
    says: '一件事，一处实现',
    why: 'D110 §18 已有自己的守卫（「分片重放只有一份实现」）。'
  },
  {
    kind: 'prose',
    file: 'src/ui/confirm.js',
    says: '只有一个按钮',
    why: '说的是**界面上**只有一个按钮，不是代码位置数。'
  },
  {
    kind: 'prose',
    file: 'src/ui/controls.js',
    says: '一个量只许有一个来源',
    why: '这是规矩本身，不是对某段代码的计数。'
  },
  {
    kind: 'prose',
    file: 'src/ui/explorer-view.js',
    says: '同一份名单，两个入口',
    why: '同上，讲的是共用一份数据。'
  },
  {
    kind: 'prose',
    file: 'src/ui/favorites-view.js',
    says: '同一个出口',
    why: '讲内置与自存共用 layoutRows()（D83 §1），不是位置计数。'
  },
  {
    kind: 'prose',
    file: 'src/ui/favorites-view.js',
    says: '只有一份 DOM',
    why: '说的是形态差异全在 CSS 里（D95 ①），是渲染事实不是代码位置数。'
  },
  {
    kind: 'prose',
    file: 'src/ui/input.js',
    says: '迟早只有一份记得',
    why: '讲的是"两处各写一份会分叉"这条道理。'
  },
  {
    kind: 'prose',
    file: 'src/data/favorites.js',
    says: '口径只有一个',
    why: '讲的是容量口径同源，不是代码位置数。'
  },
  {
    kind: 'prose',
    file: 'src/data/favorites.js',
    says: '走同一个出口',
    why: '同 favorites-view 那条。'
  },
  {
    kind: 'prose',
    file: 'src/data/life-probe.js',
    says: '口径只有一个',
    why: '讲的是探针口径写死在 PROBE_SPEC。'
  },
  {
    kind: 'prose',
    file: 'src/engine/motion.js',
    says: '唯一出口',
    why: '钉得住，但 D98 ③ 那条守卫已经在核对落点，不重复钉。'
  },
  {
    kind: 'prose',
    file: 'src/engine/patterns.js',
    says: '登记表只此一份',
    why: 'D97 ③ 分组那条守卫已经在核对同一份登记表。'
  }
])

/**
 * 注释里"对代码位置计数"、却没在上表登记的地方 —— 守卫用它。
 *
 * @param {Array<{path:string, text:string}>} files 源文件
 * @returns {Array<{path:string, line:number, claim:string, seg:string}>}
 */
export function unregisteredClaims(files) {
  const known = STRUCTURE_CLAIMS.map(c => ({ file: c.file, says: c.says }))
  const bad = []
  for (const { path, text } of files) {
    // 这张表自己不扫：它整篇都在**引用**别处的断言，扫它等于扫引号里的话
    if (path === 'src/data/structure-claims.js') continue
    const comments = text.match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g) || []
    let cursor = 0
    for (const c of comments) {
      const at = text.indexOf(c, cursor)
      cursor = at + c.length
      const line = text.slice(0, at).split('\n').length
      CLAIM_PATTERN.lastIndex = 0
      let m
      while ((m = CLAIM_PATTERN.exec(c)) !== null) {
        // 「**同**一个定位函数」「**每**一处」这类不是计数，是"跟谁一样"。
        // 判据：数词前面挨着这些字，就不是在数代码位置
        if (SAME_PREFIX.indexOf(c[m.index - 1]) >= 0) continue
        // 这条注释被登记过吗 —— 登记表里 says 出现在这段注释里就算
        const covered = known.some(k => k.file === path && c.indexOf(k.says) >= 0)
        if (covered) break
        bad.push({ path, line, claim: m[0], seg: c.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s*\*\s*/g, ' ').trim() })
      }
    }
  }
  return bad
}
