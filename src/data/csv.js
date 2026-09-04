// CSV 生成。纯字符串处理，零 DOM 依赖 —— 下载动作属于界面层。

/** 需要转义的字段：含逗号、引号、换行 */
function escapeCell(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * @param {Array<object>} rows
 * @param {Array<string>} columns 列名，同时也是取值的键
 * @param {string[]} [header] 表头文案，缺省用 columns 本身
 */
export function toCSV(rows, columns, header) {
  const head = (header || columns).map(escapeCell).join(',')
  const body = rows.map(r => columns.map(c => escapeCell(r[c])).join(',')).join('\n')
  return rows.length ? `${head}\n${body}\n` : `${head}\n`
}

/** 每代快照的列（规格 3.3） */
export const SNAPSHOT_COLUMNS = ['gen', 'alive', 'births', 'deathsLonely', 'deathsCrowded', 'activeArea']

/** 实验台账的列（规格 3.4） */
export const LEDGER_COLUMNS = [
  'runId', 'timestamp', 'origin', 'seed', 'ruleFingerprint', 'ruleNotation', 'boundary',
  'boardSize', 'initDensity', 'endType', 'endGen', 'peakPop', 'note'
]
