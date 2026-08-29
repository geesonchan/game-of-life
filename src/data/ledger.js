// 实验台账（规格 3.4）：每局终止后落一条。
// 同样只存数据，runId 与 timestamp 由界面层传入 —— 数据层不碰 Date，保持可测。

export class Ledger {
  constructor() { this.rows = [] }

  /** @param {object} entry 见 LEDGER_COLUMNS */
  add(entry) {
    const row = { note: '', ...entry }
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
