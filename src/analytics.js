// 访问统计。只在正式部署的站点上挂，本地开发一律不挂。
//
// 为什么要用环境变量而不是把地址写死在 index.html：
//   1. 本地 dev 和跑测试时不该往任何第三方发请求；
//   2. 别人 fork 这个仓库自己部署时，不该把访问量记到原作者的账号里。
// 没设 VITE_GOATCOUNTER 就是彻底不加载，页面上看不出任何差别。

/**
 * @param {string|undefined} endpoint 形如 https://xxx.goatcounter.com/count
 * @param {string} host 当前域名，用来挡掉本地调试
 */
export function shouldCount(endpoint, host) {
  if (!endpoint) return false
  return host !== 'localhost' && host !== '127.0.0.1' && host !== ''
}

export function setupAnalytics() {
  const endpoint = import.meta.env.VITE_GOATCOUNTER
  if (!shouldCount(endpoint, location.hostname)) return
  const s = document.createElement('script')
  s.async = true
  s.src = 'https://gc.zgo.at/count.js'
  s.setAttribute('data-goatcounter', endpoint)
  document.head.appendChild(s)
}
