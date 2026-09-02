// 界面偏好的持久化。
//
// 规格修订（见 docs/decisions.md D30）：localStorage 只允许存**界面偏好**
// —— 介绍卡看过没有、语言、简洁/完整模式，以及缩放滑条的开关（D84 ③）。
// 任何游戏数据（棋盘、存档、台账、快照）一律禁止走这里，仍旧走显式的文件导出。
//
// 这条边界不靠自觉，靠白名单：写一个不在 ALLOWED 里的键会直接抛异常，
// 并且有测试专门拿 board / save / ledger 这类键去撞它。

/**
 * 允许持久化的界面偏好键。
 *
 * 白名单挡的是**游戏数据**（棋盘、存档、台账、快照），不是"键的数量" ——
 * 新加一个的判据有三条，三条都满足才收（D84 ③）：
 * 它是界面偏好而非实验数据；它丢了不损失任何用户劳动；它只影响这台设备的这个浏览器。
 * `zoomBar`（缩放滑条开关）是照这三条收进来的第四个，
 * `stampTipSeen`（旋转气泡看过没有）与 `motionRay`（动向线开关）是第五、第六个 ——
 * 前者丢了最多是气泡再冒一次，后者丢了只是回到默认开着，都不损失任何用户劳动。
 */
export const PREF_KEYS = Object.freeze([
  'introSeen', 'lang', 'mode', 'zoomBar',
  'stampTipSeen',   // 旋转气泡看过没有（D88 ①）
  'motionRay',      // 动向线开关（D88 ②）
  'autoShow'        // 自动看展开关（D110 §14）：'0' = 别自动开演
])

/**
 * 书签类数据的键（D82 对 D30 的精修）。收藏列表允许落 localStorage，
 * 但它走**另一条通道**、有自己的体积上限，且写失败必须能被调用方看见 ——
 * 不与三个界面偏好混在一个白名单里，是为了让"哪些东西允许留在浏览器里"
 * 一眼就看得出分两类，而不是一个越来越长的清单。
 */
export const BOOKMARK_KEYS = Object.freeze(['favorites'])

const NAMESPACE = 'gol.pref.'
const BOOKMARK_NS = 'gol.bookmark.'

/**
 * @param {{getItem:Function, setItem:Function, removeItem:Function}|null} storage
 *        传 null 表示当前环境没有可用存储（隐私模式、禁用 cookie、Node 里跑测试）
 */
export function createPrefs(storage) {
  const allowed = new Set(PREF_KEYS)
  const bookmarks = new Set(BOOKMARK_KEYS)

  function assertBookmark(key) {
    if (!bookmarks.has(key)) {
      throw new Error(
        `书签键「${key}」不在白名单里。localStorage 的书签通道只放收藏这类"指针"（${BOOKMARK_KEYS.join(' / ')}）；` +
        '实验台账、存档、快照仍旧必须走显式的文件导出。见 docs/decisions.md D82。'
      )
    }
  }

  function assertAllowed(key) {
    if (!allowed.has(key)) {
      throw new Error(
        `偏好键「${key}」不在白名单里。localStorage 只允许存界面偏好（${PREF_KEYS.join(' / ')}）；` +
        '棋盘、存档、台账等游戏数据必须走显式的文件导出。见 docs/decisions.md D30。'
      )
    }
  }

  return {
    /** 读一个偏好；存储不可用或没存过时返回 fallback */
    get(key, fallback = null) {
      assertAllowed(key)
      if (!storage) return fallback
      try {
        const raw = storage.getItem(NAMESPACE + key)
        return raw === null || raw === undefined ? fallback : raw
      } catch (e) {
        return fallback   // 隐私模式下读也可能抛
      }
    },

    /** 写一个偏好；存储不可用时静默跳过 —— 偏好丢了不该让应用崩 */
    set(key, value) {
      assertAllowed(key)
      if (!storage) return false
      try {
        storage.setItem(NAMESPACE + key, String(value))
        return true
      } catch (e) {
        return false      // 配额满、隐私模式写入被拒
      }
    },

    /** 供设置界面用：清掉所有偏好，不碰任何其它键 */
    clear() {
      if (!storage) return
      for (const k of PREF_KEYS) {
        try { storage.removeItem(NAMESPACE + k) } catch (e) { /* 忽略 */ }
      }
    },

    isAllowed(key) { return allowed.has(key) },

    /* ---------- 书签通道（D82）：只放收藏这类"指针"，与三个界面偏好分开 ---------- */

    /** 读一个书签（字符串，通常是 JSON） */
    getBookmark(key, fallback = null) {
      assertBookmark(key)
      if (!storage) return fallback
      try {
        const raw = storage.getItem(BOOKMARK_NS + key)
        return raw === null || raw === undefined ? fallback : raw
      } catch (e) { return fallback }
    },

    /**
     * 写一个书签。**与偏好不同，写失败必须能被调用方看见** ——
     * 收藏是用户的劳动，静默丢掉比报错难受得多。
     * @returns {{ok:boolean, key?:string}} 失败时给出词典 key
     */
    setBookmark(key, value) {
      assertBookmark(key)
      if (!storage) return { ok: false, key: 'fav.err.noStorage' }
      try {
        storage.setItem(BOOKMARK_NS + key, String(value))
        return { ok: true }
      } catch (e) {
        // 配额满是这里最常见的失败，且用户完全有办法应对（导出后删几条）
        return { ok: false, key: 'fav.err.quota' }
      }
    },

    clearBookmarks() {
      if (!storage) return
      for (const k of BOOKMARK_KEYS) {
        try { storage.removeItem(BOOKMARK_NS + k) } catch (e) { /* 忽略 */ }
      }
    },

    isBookmark(key) { return bookmarks.has(key) },
    available: !!storage
  }
}

/** 探测当前环境是否真的能用 localStorage（隐私模式下 getItem 就会抛） */
function detectStorage() {
  try {
    if (typeof localStorage === 'undefined' || localStorage === null) return null
    const probe = NAMESPACE + '__probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return localStorage
  } catch (e) {
    return null
  }
}

export const prefs = createPrefs(detectStorage())
