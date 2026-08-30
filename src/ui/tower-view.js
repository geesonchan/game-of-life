// 观塔模式：与主界面并列的独立视图（阶段 5.5）。
// 数据模型与几何断言都在 data/tower.js，这里只负责把塔画出来、以及切片联动。
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { unpackTower, TOWER_DEFAULT_HEIGHT, TOWER_MAX_HEIGHT } from '../data/tower.js'
import { t } from '../i18n/index.js'

const $ = id => document.getElementById(id)
const LAYER_GAP = 1          // 层与层的间距（格为单位）
const INSTANCE_CAP = 600000  // 实例数上限，超了就按代数抽稀，免得显卡吃不消

export function createTowerView(app) {
  const el = {
    view: $('tower-view'), canvas: $('tower-canvas'), back: $('tower-back'),
    stat: $('tower-stat'), fps: $('tower-fps'), empty: $('tower-empty'),
    progress: $('tower-progress'), bar: $('tower-progress-bar'), progressText: $('tower-progress-text'),
    gens: $('tower-gens'), lblGens: $('tower-lbl-gens'),
    height: $('tower-height'), lblHeight: $('tower-lbl-height'),
    build: $('tower-build'), spin: $('tower-spin'),
    slice: $('tower-slice'), lblSlice: $('tower-lbl-slice'), mini: $('tower-mini')
  }

  let renderer = null, scene = null, camera = null, controls = null
  let mesh = null, slicePlane = null
  let tower = null
  let drawStride = 1     // 实例超上限时的抽稀倍率，必须显示出来 —— 悄悄少画一半层是不能接受的
  let worker = null
  let raf = 0
  let open = false
  let frames = 0, fpsAt = 0

  el.height.max = String(TOWER_MAX_HEIGHT)
  el.gens.max = String(TOWER_MAX_HEIGHT)

  /* ---------------- three.js 场景 ---------------- */

  function ensureScene() {
    if (renderer) return
    renderer = new THREE.WebGLRenderer({ canvas: el.canvas, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0b0d12)
    camera = new THREE.PerspectiveCamera(50, 1, 0.5, 5000)
    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.autoRotateSpeed = 1.2
    scene.add(new THREE.AmbientLight(0xffffff, 0.85))
    const key = new THREE.DirectionalLight(0xffffff, 1.1)
    key.position.set(1.2, 2, 0.8)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xbcd8ff, 0.35)
    fill.position.set(-1, 0.4, -1)
    scene.add(fill)
  }

  function resize() {
    if (!renderer) return
    const r = el.canvas.getBoundingClientRect()
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height))
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  /* ---------------- 建塔（Worker 构建，主线程只画） ---------------- */

  function startBuild() {
    const gens = Number(el.gens.value)
    const maxLayers = Number(el.height.value)
    const e = app.engine
    // 从当前这一局的开局条件重放：手绘过的局就直接拿当前棋盘当起点
    const spec = {
      type: 'build',
      boardSize: [e.w, e.h],
      boundary: e.boundary,
      rule: { clauses: e.rule.clauses, agingLayers: e.rule.agingLayers },
      gens, maxLayers, chunk: 25
    }
    if (app.runDirty || e.initType !== 'random') {
      const cells = []
      for (let i = 0; i < e.cur.length; i++) if (e.cur[i] === 1) cells.push(i)
      spec.initCells = cells
    } else {
      spec.seed = e.seed
      spec.density = e.density
    }

    showProgress(0, gens)
    el.build.disabled = true
    if (worker) worker.terminate()
    worker = new Worker(new URL('../workers/tower-builder.js', import.meta.url), { type: 'module' })
    worker.onmessage = ev => {
      const m = ev.data
      if (m.type === 'progress') showProgress(m.done, m.total)
      else if (m.type === 'done') {
        hideProgress()
        el.build.disabled = false
        adopt(unpackTower(m.packed))
        worker.terminate(); worker = null
      } else if (m.type === 'error') {
        hideProgress()
        el.build.disabled = false
        app.toast(m.message)
        worker.terminate(); worker = null
      }
    }
    worker.postMessage(spec)
  }

  function showProgress(done, total) {
    el.empty.hidden = true
    el.progress.hidden = false
    el.bar.style.width = (total ? Math.round(done / total * 100) : 0) + '%'
    el.progressText.textContent = t('tower.building', { done, total })
  }
  function hideProgress() { el.progress.hidden = true }

  /* ---------------- 把塔搭成 InstancedMesh ---------------- */

  function adopt(next) {
    tower = next
    buildMesh()
    el.empty.hidden = tower.length > 0
    el.stat.textContent = statLine()

    const range = tower.genRange
    el.slice.disabled = !range
    if (range) {
      el.slice.min = String(range[0])
      el.slice.max = String(range[1])
      el.slice.value = String(range[1])
      updateSlice()
    }
    frameCamera()
  }

  function buildMesh() {
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); mesh = null }
    if (!tower || !tower.length) return

    // 实例太多时按代数抽稀：宁可少画几层，也不要把显卡拖垮
    const stride = Math.max(1, Math.ceil(tower.instanceCount / INSTANCE_CAP))
    drawStride = stride
    const layers = tower.layers.filter((_, i) => i % stride === 0)
    let count = 0
    for (const l of layers) count += l.cells.length

    const geo = new THREE.BoxGeometry(0.9, 0.9, 0.9)
    // 注意不要开 vertexColors：那会打开 USE_COLOR，而 BoxGeometry 没有 color 属性，
    // 着色器里 vColor *= color 就把颜色乘成了黑的。逐实例颜色走的是 instanceColor，
    // 由 setColorAt 自动启用 USE_INSTANCING_COLOR，跟 vertexColors 无关。
    const mat = new THREE.MeshLambertMaterial()
    mesh = new THREE.InstancedMesh(geo, mat, count)
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)

    const m = new THREE.Matrix4()
    const color = new THREE.Color()
    const w = tower.width, h = tower.height
    const g0 = tower.layers[0].gen
    const span = Math.max(1, tower.layers[tower.length - 1].gen - g0)
    let k = 0
    for (const layer of layers) {
      const y = (layer.gen - g0) * LAYER_GAP
      // 沿时间轴渐变，越新越亮，一眼能看出塔是从下往上长的
      const tt = (layer.gen - g0) / span
      // 底部也得看得清 —— 亮度从 0.45 起步，别让最老的那几层黑成一团
      color.setHSL(0.34 - 0.10 * tt, 0.62, 0.45 + 0.30 * tt)
      for (const idx of layer.cells) {
        m.makeTranslation((idx % w) - w / 2, y, ((idx / w) | 0) - h / 2)
        mesh.setMatrixAt(k, m)
        mesh.setColorAt(k, color)
        k++
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    scene.add(mesh)

    // 切片高亮面
    if (slicePlane) { scene.remove(slicePlane); slicePlane.geometry.dispose(); slicePlane.material.dispose() }
    const pg = new THREE.PlaneGeometry(w, h)
    pg.rotateX(-Math.PI / 2)
    slicePlane = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({
      color: 0x7ee787, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false
    }))
    scene.add(slicePlane)
  }

  function statLine() {
    if (!tower) return ''
    const parts = [t('tower.built', { layers: tower.length, cells: tower.instanceCount })]
    if (tower.dropped > 0) parts.push(t('tower.dropped', { n: tower.dropped }))
    if (drawStride > 1) parts.push(t('tower.thinned', { n: drawStride }))
    return parts.join(' · ')
  }

  function frameCamera() {
    if (!tower || !tower.length) return
    const span = (tower.layers[tower.length - 1].gen - tower.layers[0].gen) * LAYER_GAP
    const r = Math.max(tower.width, tower.height, span) * 0.9
    camera.position.set(r, span * 0.6 + r * 0.3, r)
    controls.target.set(0, span / 2, 0)
    controls.update()
  }

  /* ---------------- 切片滑块 ↔ 2D 小窗 ---------------- */

  function updateSlice() {
    if (!tower || !tower.length) return
    const gen = Number(el.slice.value)
    el.lblSlice.textContent = t('tower.slicePeek', { gen })
    const layer = tower.layerAt(gen)
    if (slicePlane) slicePlane.position.y = (gen - tower.layers[0].gen) * LAYER_GAP
    drawMini(layer)
  }

  function drawMini(layer) {
    const c = el.mini
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rect = c.getBoundingClientRect()
    const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr))
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#12151c'
    ctx.fillRect(0, 0, w, h)
    if (!layer || !tower) return
    const s = Math.min(w / tower.width, h / tower.height)
    const ox = (w - tower.width * s) / 2, oy = (h - tower.height * s) / 2
    ctx.fillStyle = '#18232c'
    ctx.fillRect(ox, oy, tower.width * s, tower.height * s)
    ctx.fillStyle = '#7ee787'
    const px = Math.max(1, s)
    for (const idx of layer.cells) {
      ctx.fillRect(ox + (idx % tower.width) * s, oy + (((idx / tower.width) | 0)) * s, px, px)
    }
  }

  /* ---------------- 循环 ---------------- */

  function loop(now) {
    if (!open) return
    raf = requestAnimationFrame(loop)
    controls.autoRotate = el.spin.checked
    controls.update()
    renderer.render(scene, camera)
    frames++
    if (now - fpsAt >= 500) {
      el.fps.textContent = t('tower.fps', { n: Math.round(frames * 1000 / (now - fpsAt)) })
      frames = 0; fpsAt = now
    }
  }

  /* ---------------- 开关 ---------------- */

  function show() {
    open = true
    el.view.hidden = false
    ensureScene()
    resize()
    // 视图被隐藏期间 2D 小窗的画布内容不可靠（隐藏时布局尺寸为 0），
    // 重新进来必须照当前切片重画一遍，否则会留下一块残影
    if (tower && tower.length) updateSlice()
    el.fps.textContent = ''
    fpsAt = performance.now(); frames = 0
    raf = requestAnimationFrame(loop)
  }
  function hide() {
    open = false
    cancelAnimationFrame(raf)
    el.view.hidden = true
  }

  el.back.addEventListener('click', hide)
  el.build.addEventListener('click', startBuild)
  el.gens.addEventListener('input', () => { el.lblGens.textContent = el.gens.value })
  el.height.addEventListener('input', () => {
    el.lblHeight.textContent = el.height.value
    if (tower) { tower.setMaxLayers(Number(el.height.value)); adopt(tower) }
  })
  el.slice.addEventListener('input', updateSlice)
  window.addEventListener('resize', () => { if (open) resize() })
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && open) { hide(); e.preventDefault() } })

  el.lblGens.textContent = el.gens.value
  el.lblHeight.textContent = el.height.value

  /** 按需渲染一帧。给"面板 rAF 被节流时也要能验证/测量"留的口子 */
  function renderOnce() {
    if (!renderer) return false
    controls.update()
    renderer.render(scene, camera)
    return true
  }

  return {
    show, hide, renderOnce,
    get isOpen() { return open },
    relocalize() {
      if (tower) { el.stat.textContent = statLine(); updateSlice() }
    },
    _internals: {
      get tower() { return tower }, get mesh() { return mesh },
      get renderer() { return renderer }, get scene() { return scene }, get camera() { return camera },
      get controls() { return controls }
    }
  }
}
