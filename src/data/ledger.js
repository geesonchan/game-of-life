// 实验台账（规格 3.4）：每局终止后落一条。
// 同样只存数据，runId 与 timestamp 由界面层传入 —— 数据层不碰 Date，保持可测。
//
// **有些字段对某类局根本不成立**（D135）。台账从前无条件填 `seed` 与 `initDensity`，
// 而手摆的局**那个种子产生不出那盘棋** —— 记的不是"微不足道的事实"，
// 是**一个不成立的事实**。这是"说的与做的不同源"的又一次：
// 那两列说的是"这一局是这么来的"，而做出来的局根本不是那么来的。
//
// 判据：**填不出来的字段就别填**。空着可以，写一个假的不行。
// `origin` 那一列把这件事挑明：`seeded` = 种子生成、`handmade` = 手摆或载入过。

/** 这一局是怎么来的。`seeded` 的行才谈得上 seed / initDensity */
export const ORIGIN_SEEDED = 'seeded'
export const ORIGIN_HANDMADE = 'handmade'

/**
 * 对这一类局没有意义的字段 —— 一处登记，`add` 照它清空（照 promises.js 那套做法）。
 * 手摆的局：种子与初始密度都不成立，因为盘不是那么来的。
 */
export const NA_FIELDS = Object.freeze({
  [ORIGIN_HANDMADE]: ['seed', 'initDensity']
})

export class Ledger {
  constructor() { this.rows = [] }

  /**
   * @param {object} entry 见 LEDGER_COLUMNS
   *
   * **不成立的字段在这里清空，不靠调用方记得**（D135）：
   * 调用方只说"这一局是怎么来的"（`origin`），哪些列因此不成立由这一处决定 ——
   * 各调用点各清一遍的话，下一个写入点就会漏。
   */
  add(entry) {
    const row = { note: '', ...entry }
    for (const f of NA_FIELDS[row.origin] || []) row[f] = ''
    this.rows.push(row)
    return row
  }

  updateNote(runId, note) {
    const row = this.rows.find(r => r.runId === runId)
    if (row) row.note = note
    return row
  }

  find(runId) { return this.rows.find(r => r.runId === runId) || null }

  clear() { this.rows = [] }

  get length() { return this.rows.length }
}
