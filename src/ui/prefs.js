// 界面偏好的持久化。
//
// 规格修订（见 docs/decisions.md D30）：localStorage 只允许存**界面偏好**，
// 一共三样 —— 介绍卡看过没有、语言、简洁/完整模式。
// 任何游戏数据（棋盘、存档、台账、快照）一律禁止走这里，仍旧走显式的文件导出。
//
// 这条边界不靠自觉，靠白名单：写一个不在 ALLOWED 里的键会直接抛异常，
// 并且有测试专门拿 board / save / ledger 这类键去撞它。

/** 唯一允许持久化的三个键 */
export const PREF_KEYS = Object.freeze(['introSeen', 'lang', 'mode'])

const NAMESPACE = 'gol.pref.'

/**
 * @param {{getItem:Function, setItem:Function, removeItem:Function}|null} storage
 *        传 null 表示当前环境没有可用存储（隐私模式、禁用 cookie、Node 里跑测试）
 */
export function createPrefs(storage) {
  const allowed = new Set(PREF_KEYS)

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
