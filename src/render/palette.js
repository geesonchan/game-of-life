// 色带与颜色查找表。纯渲染层资产，引擎完全不知道它的存在。
// 年龄 → 颜色、余晖剩余代数 → 颜色，都在这里预计算成查找表，绘制时只查不算。

/** 色带预设：stops 从"新生"到"年老"，death 是刚死瞬间的余晖色 */
export const PALETTES = {
  emerald: {
    name: '翠绿',
    stops: [[218, 255, 228], [126, 231, 135], [46, 163, 92], [24, 92, 62], [15, 48, 38]],
    death: [255, 118, 118]
  },
  lava: {
    name: '熔岩',
    stops: [[255, 247, 214], [255, 205, 84], [242, 130, 44], [178, 46, 44], [72, 22, 30]],
    // 死亡色取"烟灰"：熔岩色带本身是暖色，余晖若也用暖色会和新生细胞混淆
    death: [150, 158, 180]
  },
  glacier: {
    name: '冰川',
    stops: [[238, 251, 255], [130, 216, 255], [64, 142, 234], [40, 76, 172], [23, 35, 88]],
    death: [206, 146, 255]
  }
}

export const AGE_STEPS = 64      // 年龄色阶数
export const AGE_MAX = 64        // 映射到最深色的存活代数；超过它一律同色
const AGE_LUT_SIZE = 512         // 年龄索引表长度，超出部分钳到最深色

/** 在 stops 之间做分段线性插值 */
function sampleStops(stops, t) {
  if (t <= 0) return stops[0].slice()
  if (t >= 1) return stops[stops.length - 1].slice()
  const seg = (stops.length - 1) * t
  const i = Math.floor(seg)
  const f = seg - i
  const a = stops[i], b = stops[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f)
  ]
}

/** 年龄色阶查找表：Uint8Array(AGE_STEPS * 3) */
export function buildAgeColorLUT(paletteKey) {
  const p = PALETTES[paletteKey] || PALETTES.emerald
  const lut = new Uint8Array(AGE_STEPS * 3)
  for (let i = 0; i < AGE_STEPS; i++) {
    const c = sampleStops(p.stops, i / (AGE_STEPS - 1))
    lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2]
  }
  return lut
}

/**
 * 年龄 → 色阶索引的查找表。用 log2 压缩：
 * 前几代的差异被放大（新生细胞一眼可辨），老细胞则缓慢加深。
 */
export function buildAgeIndexLUT() {
  const lut = new Uint8Array(AGE_LUT_SIZE)
  const denom = Math.log2(AGE_MAX)
  for (let a = 0; a < AGE_LUT_SIZE; a++) {
    const age = a < 1 ? 1 : a
    let t = Math.log2(age) / denom
    if (t > 1) t = 1
    lut[a] = Math.min(AGE_STEPS - 1, Math.round(t * (AGE_STEPS - 1)))
  }
  return lut
}

/** 年龄索引取值（带钳位），供渲染器内联调用 */
export function ageIndex(lut, age) {
  return lut[age < AGE_LUT_SIZE ? age : AGE_LUT_SIZE - 1]
}

/** 余晖最亮时相对死亡色的强度上限。残影必须明显暗于活细胞，否则会喧宾夺主 */
const GLOW_PEAK = 0.55

/**
 * 余晖查找表：Uint8Array((frames + 1) * 3)。
 * 索引 = 余晖剩余代数（frames 表示刚死，1 表示即将消失，0 不使用）。
 * 亮度按 (d/frames)^1.8 衰减：刚死那一代最显眼，之后迅速沉入底色。
 */
export function buildGlowLUT(paletteKey, frames, boardDead) {
  const p = PALETTES[paletteKey] || PALETTES.emerald
  const lut = new Uint8Array((frames + 1) * 3)
  for (let d = 1; d <= frames; d++) {
    const bright = GLOW_PEAK * Math.pow(d / frames, 1.8)
    lut[d * 3] = Math.round(boardDead[0] + (p.death[0] - boardDead[0]) * bright)
    lut[d * 3 + 1] = Math.round(boardDead[1] + (p.death[1] - boardDead[1]) * bright)
    lut[d * 3 + 2] = Math.round(boardDead[2] + (p.death[2] - boardDead[2]) * bright)
  }
  return lut
}

/** 关闭年龄着色时使用的单色（取色带中段偏亮处） */
export function flatColor(paletteKey) {
  const p = PALETTES[paletteKey] || PALETTES.emerald
  return sampleStops(p.stops, 0.25)
}

/**
 * 衰老态配色表：索引 = 状态码（2 = 衰老 1，3 = 衰老 2，…）。
 * 用死亡色作基调（衰老本来就是"正在死"），越深的衰老层越暗，
 * 亮度整体压在活细胞之下，保证画面主体仍是活细胞。
 */
export function buildAgingLUT(paletteKey, layers, boardDead) {
  const p = PALETTES[paletteKey] || PALETTES.emerald
  const lut = new Uint8Array((2 + Math.max(0, layers)) * 3)
  for (let k = 1; k <= layers; k++) {
    const bright = 0.78 * (1 - 0.62 * (k - 1) / Math.max(1, layers))
    const i = (1 + k) * 3
    lut[i] = Math.round(boardDead[0] + (p.death[0] - boardDead[0]) * bright)
    lut[i + 1] = Math.round(boardDead[1] + (p.death[1] - boardDead[1]) * bright)
    lut[i + 2] = Math.round(boardDead[2] + (p.death[2] - boardDead[2]) * bright)
  }
  return lut
}
