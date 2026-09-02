// **撤销 / 后悔药**（方案定稿见 docs/handoff.md 第五节）。
//
// 这一份是**纯的**：只管栈、字节、前提，谁都不碰。
// 碰引擎的那一半在 main.js（`app.undo`），因为还原要连 `currentShowId` 与"在不在跑"一起还。
//
// **混合结构**，因为两类改动的代价差着三个数量级：
//   · 局部改动（画笔/橡皮擦）→ 存**补丁**：`{cells:[[x,y,旧值]], …}`。
//     input.js 里 D67 那套整笔回滚本来就攒了这个数组，收笔时压栈即可，白捡。
//     一笔涂抹约 270 条 ≈ 2 KB。
//   · 整盘改动（清空/随机/改尺寸/载入/读档）→ 存 `captureSession` **整份快照**。
//     2304² 一份 5.06 MiB / 拷贝 1.1ms；1024² 1.00 MiB / 0.2ms；200² 39 KB。
//
// **按字节封顶，不按步数**：一步在橡皮擦场景下等于没有（擦一下就把清空那步挤掉了），
// 而按步数封顶又会让 2304² 的快照攒到几百 MiB。字节是唯一同时管得住两头的量纲。

/** 32 MiB。够装 6 份 2304² 的快照，或者几千笔涂抹 */
export const MAX_UNDO_BYTES = 32 * 1024 * 1024

/**
 * 一条补丁多大。
 *
 * 实测口径：一笔涂抹约 270 条 ≈ 2 KB → 每条约 8 字节（`[x, y, 旧值]` 三个小整数）。
 * 这是**估算不是实测**，够用就行 —— 封顶要的是"别让它无限长"，不是精确到字节。
 */
export function patchBytes(cellCount) { return cellCount * 8 }

/**
 * 一份快照多大 —— `engine.cur` 是 `Uint8Array`，所以就是 `w * h` 字节。
 * 对得上实测：2304²=5.06 MiB、1024²=1.00 MiB、200²=39 KB。
 */
export function snapshotBytes(w, h) { return w * h }

/**
 * 补丁失效的三种原因，**共用一个模板**。
 *
 * 三种都是同一件事：**补丁按坐标回滚，而坐标的前提没了**。
 * 分三个词条是因为用户要知道是哪一种（"我干了什么导致退不回去"），
 * 但句式必须一样 —— 三句话各写各的，迟早有一句读起来像是出了故障。
 */
export const STALE_REASONS = Object.freeze(['size', 'rule', 'replaced'])

/**
 * 这条撤销还能不能用。
 *
 * **补丁自带前提**（主判据）：记下 `w/h/规则记号/世代戳`，对不上就不许回滚 ——
 * 按错坐标回滚比不给撤销坏得多，那是**在用户没要求的地方改棋盘**。
 *
 * 快照不查前提：它整份都带着（w/h/规则/格子），还回去就是那一刻，不依赖现在长什么样。
 *
 * @param {object} entry 栈里那一条
 * @param {{w:number,h:number,rule:string,stamp:number}} now 现在的棋盘
 * @returns {null|'size'|'rule'|'replaced'} null = 还能用
 */
export function staleReason(entry, now) {
  if (!entry) return null
  if (entry.kind === 'snapshot') return null
  const pre = entry.pre
  if (pre.w !== now.w || pre.h !== now.h) return 'size'
  if (pre.rule !== now.rule) return 'rule'
  if (pre.stamp !== now.stamp) return 'replaced'
  return null
}

/**
 * **没有改变任何东西的操作，不是一步**（D113，作者定）。
 *
 * 空盘上点清空、随机填充生成了完全相同的一盘、图案落在界外一个格子都没放上 ——
 * 这些都"发生"过，但棋盘一个比特都没动。
 * 把它们压进栈里，用户按撤销就是**按了没反应** —— 那正是我们追了一路的那类事情
 * （§12 那一族：说的与做的不一致；这一次是"按钮说有一步可退，其实没有"）。
 *
 * 判据落在**结果**上，不落在"哪个操作"上：不去枚举"清空要判空盘、随机要比种子"，
 * 而是问一句"棋盘变了吗"。枚举注定漏（下一个写盘入口就忘了），问结果漏不掉。
 *
 * @param {object} entry 栈里那一条（补丁或快照）
 * @param {{w:number,h:number,rule:string,generation:number,boundary:*,
 *          cells:ArrayLike<number>, get:(x:number,y:number)=>number}} board 现在的棋盘
 * @returns {boolean} 真的改变了什么
 */
export function stepChangedAnything(entry, board) {
  if (!entry) return false
  if (entry.kind === 'patch') {
    // 补丁记的是**旧值**；哪一格现在与旧值不同，哪一格就真被改过
    for (let i = 0; i < entry.cells.length; i++) {
      const c = entry.cells[i]
      if (board.get(c[0], c[1]) !== c[2]) return true
    }
    return false
  }
  const s = entry.session
  // 便宜的先比，逐格那一遍放最后 —— 大盘上它是几百万次比较
  if (s.w !== board.w || s.h !== board.h) return true
  if (s.generation !== board.generation) return true
  if (s.rule !== board.rule) return true
  if (s.boundary !== board.boundary) return true
  const cur = board.cells
  if (s.cells.length !== cur.length) return true
  for (let i = 0; i < s.cells.length; i++) if (s.cells[i] !== cur[i]) return true
  return false
}

/**
 * 撤销栈。**多步**，按字节封顶，超了丢最旧的。
 *
 * @param {number} limit 字节上限
 */
export function createUndoStack(limit = MAX_UNDO_BYTES) {
  /** @type {Array<object>} 栈底在前，栈顶在后 */
  let items = []
  let used = 0

  function bytesOf(entry) {
    return entry.kind === 'patch'
      ? patchBytes(entry.cells.length)
      : snapshotBytes(entry.session.w, entry.session.h)
  }

  /** 超了就丢最旧的，直到装得下。**永远留至少一条** —— 否则刚压进去的自己被挤掉了 */
  function evict() {
    while (used > limit && items.length > 1) {
      used -= bytesOf(items.shift())
    }
  }

  return {
    /**
     * 压栈。
     *
     * @param {object} entry `{kind:'patch'|'snapshot', …}`
     * @param {{dropPatches?:boolean}} opts `dropPatches` = A 类（改尺寸/读档/载入）：
     *   **压栈即作废之前的补丁**。这是第二道兜底 —— 主判据是上面那个前提检查，
     *   但补丁的坐标在盘换过之后本来就没意义了，留着只是等着被拒，不如当场清掉。
     *   快照不清：它整份都带着，换过盘也还得回去。
     */
    push(entry, opts = {}) {
      if (opts.dropPatches) {
        items = items.filter(it => it.kind === 'snapshot')
        used = items.reduce((n, it) => n + bytesOf(it), 0)
      }
      items.push(entry)
      used += bytesOf(entry)
      evict()
      return this
    },
    /** 栈顶那一条（不弹出） */
    peek() { return items.length ? items[items.length - 1] : null },
    /** 弹出栈顶 */
    pop() {
      const e = items.pop()
      if (e) used -= bytesOf(e)
      return e || null
    },
    /**
     * **单一判断源**（D110 §12 第三面）：按钮 `disabled`、临时条出不出现、撤销入口，
     * 三处都问它。三处各判一次的话，迟早出现"按钮亮着但点了没反应"。
     */
    canUndo() { return items.length > 0 },
    /** 跑过一代就整栈作废 —— 棋盘已经不是补丁记的那个棋盘了 */
    clear() { items = []; used = 0 },
    size() { return items.length },
    bytes() { return used },
    limit() { return limit }
  }
}
