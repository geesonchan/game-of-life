// 存活数折线图（最近 N 代）。渲染层组件：只读数据层的序列，不回写。

const CHART_COLORS = {
  bg: '#12151c',
  grid: 'rgba(255,255,255,0.06)',
  line: '#7ee787',
  fill: 'rgba(126,231,135,0.16)',
  peak: 'rgba(227,179,65,0.55)',
  text: '#8b95a7'
}

export class Chart {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.dpr = 1
  }

  resize() {
    const dpr = window.devicePixelRatio || 1
    const rect = this.canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width * dpr))
    const h = Math.max(1, Math.round(rect.height * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.dpr = dpr
    return { w, h }
  }

  /**
   * @param {import('../data/series.js').RingSeries} series
   * @param {number[]} [accent] 折线主色（跟随当前色带），缺省用默认绿
   */
  draw(series, accent) {
    const line = accent ? `rgb(${accent[0]},${accent[1]},${accent[2]})` : CHART_COLORS.line
    const fill = accent ? `rgba(${accent[0]},${accent[1]},${accent[2]},0.16)` : CHART_COLORS.fill
    const { w, h } = this.resize()
    const ctx = this.ctx
    ctx.fillStyle = CHART_COLORS.bg
    ctx.fillRect(0, 0, w, h)

    const n = series.length
    if (n === 0) {
      ctx.fillStyle = CHART_COLORS.text
      ctx.font = `${11 * this.dpr}px -apple-system, sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText('等待数据…', w / 2, h / 2 + 4 * this.dpr)
      return
    }

    let max = 0
    for (let i = 0; i < n; i++) { const v = series.at(i); if (v > max) max = v }
    if (max <= 0) max = 1

    const padTop = 8 * this.dpr
    const padBottom = 4 * this.dpr
    const plotH = h - padTop - padBottom
    const xOf = i => (n === 1 ? w / 2 : (i / (n - 1)) * w)
    const yOf = v => padTop + plotH - (v / max) * plotH

    // 水平参考线（1/2、1/4 位置）
    ctx.strokeStyle = CHART_COLORS.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const f of [0.25, 0.5, 0.75]) {
      const y = Math.round(padTop + plotH * f) + 0.5
      ctx.moveTo(0, y); ctx.lineTo(w, y)
    }
    ctx.stroke()

    // 面积
    ctx.beginPath()
    ctx.moveTo(xOf(0), h)
    for (let i = 0; i < n; i++) ctx.lineTo(xOf(i), yOf(series.at(i)))
    ctx.lineTo(xOf(n - 1), h)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()

    // 折线
    ctx.beginPath()
    for (let i = 0; i < n; i++) {
      const x = xOf(i), y = yOf(series.at(i))
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = line
    ctx.lineWidth = 1.5 * this.dpr
    ctx.lineJoin = 'round'
    ctx.stroke()

    // 峰值线与标注
    const peakY = Math.round(yOf(max)) + 0.5
    ctx.strokeStyle = CHART_COLORS.peak
    ctx.setLineDash([3 * this.dpr, 3 * this.dpr])
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, peakY); ctx.lineTo(w, peakY); ctx.stroke()
    ctx.setLineDash([])

    ctx.fillStyle = CHART_COLORS.text
    ctx.font = `${10 * this.dpr}px ui-monospace, Menlo, monospace`
    ctx.textAlign = 'left'
    ctx.fillText(`峰值 ${max}`, 4 * this.dpr, Math.max(10 * this.dpr, peakY - 3 * this.dpr))
    ctx.textAlign = 'right'
    ctx.fillText(`最近 ${n} 代`, w - 4 * this.dpr, h - 4 * this.dpr)
  }
}
