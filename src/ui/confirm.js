// 一次性确认框（D93）。**只有一种用途：这一步会盖掉用户已有的劳动。**
//
// 为什么值得单开一个：D82 定过"用户劳动不得被静默清掉"。原先精彩局卡片
// 一点就 replayLayout() —— 清盘 + 换规则 + 铺新局，等于一次不带确认、
// 也不穿破坏红的隐式清空。要么别清（同规则改走待放置），要么问一句。
//
// 刻意做得很薄：一句话、两颗按钮，不做通用对话框框架。
// 通用框架会长出第二种、第三种用途，然后"看见它就知道有东西要没了"这层含义就稀释了。
import { t } from '../i18n/index.js'

const $ = id => document.getElementById(id)

export function createConfirm(app) {
  const el = { modal: $('confirm-modal'), backdrop: $('confirm-backdrop'),
    title: $('confirm-title'), body: $('confirm-body'), yes: $('confirm-yes'), no: $('confirm-no') }
  let pending = null      // 点「继续」要做的事

  function close() {
    el.modal.hidden = true
    pending = null
  }

  /**
   * 问一句再做。
   * @param {{title:string, body:string, yes:string}} text 已经翻译好的三句话
   * @param {()=>void} onYes 用户点「继续」之后才跑
   */
  app.confirmAction = function (text, onYes) {
    el.no.hidden = false                // 告知框把它藏起来过，这里要还原
    el.yes.classList.add('danger')
    el.title.textContent = text.title
    el.body.textContent = text.body
    el.yes.textContent = text.yes
    el.no.textContent = t('confirm.cancel')
    pending = onYes
    el.modal.hidden = false
    // 焦点落在「取消」上：默认那一下回车不该是破坏性的那颗
    if (el.no.focus) el.no.focus()
  }

  /**
   * **挡路的告知框**：只有一个按钮，点了才走（D110 §24）。
   * 用在"用户此行的唯一目的失败了"那一类 —— 比如他专程为一条链接而来，而链接打不开。
   * 顺带发生的事仍用不挡路的 toast。
   */
  app.alertAction = function (text, onClose) {
    el.title.textContent = text.title
    el.body.textContent = text.body
    el.yes.textContent = text.yes || t('confirm.ok')
    el.yes.classList.remove('danger')
    el.no.hidden = true                 // 一个按钮：没有"取消"这一说，事情已经发生了
    pending = onClose || null
    el.modal.hidden = false
    if (el.yes.focus) el.yes.focus()
  }

  el.yes.addEventListener('click', () => { const go = pending; close(); if (go) go() })
  el.no.addEventListener('click', close)
  el.backdrop.addEventListener('click', close)
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !el.modal.hidden) { close(); e.preventDefault() }
  })

  return { close, isOpen: () => !el.modal.hidden }
}
