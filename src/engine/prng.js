// 种子化伪随机数发生器（mulberry32）
// 架构约束：所有随机来源必须走这里，保证同种子结果逐格可复现。

/**
 * 创建一个 mulberry32 随机数发生器。
 * @param {number} seed 32 位无符号整数种子
 * @returns {() => number} 返回 [0,1) 区间的浮点数
 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 生成一个新的随机种子（仅在用户未指定种子时调用，结果会被记录下来）。
 * 注意：这里用 Math.random 只是"选种子"，选定后一切演化都是确定的。
 */
export function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0
}

/**
 * 把任意字符串规整成一个 32 位种子，便于用户输入 "hello" 这类文字种子。
 * 纯数字输入直接按数字解析。
 */
export function normalizeSeed(input) {
  if (input === null || input === undefined) return randomSeed()
  const s = String(input).trim()
  if (s === '') return randomSeed()
  if (/^\d+$/.test(s)) return Number(s) >>> 0
  // FNV-1a 字符串哈希
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
