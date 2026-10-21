/**
 * utils/uni-shim.js —— 小程序写法 → uni-app(Vue3) 运行时适配层
 *
 * 为什么需要它：本项目以「原生微信小程序」为主工程（pages/*.js 用 Page({}) / Component({})
 * 与 this.setData 编写），uni-app 目录由 tools/migrate-to-uniapp.js 机械转换生成。
 * 为了让两套代码保持一字不差的业务逻辑（不手抄、不产生行为漂移），转换器只做文本改写：
 *   Page({...})      → export default mpPage({...})
 *   Component({...}) → export default mpComponent({...})
 *   this.data.x      → this.x
 *   this.setData(p)  → this.setData(p)   ← 由本文件提供
 *   wx.* → uni.*
 * 本文件负责把 Page/Component 的选项结构翻译成 Vue3 的选项结构。
 */

/* ------------------------------------------------------------------ */
/* data 深拷贝（每个页面实例独立，避免页面间共享同一份对象）            */
/* ------------------------------------------------------------------ */
function clone(v) {
  if (Array.isArray(v)) return v.map(clone)
  if (v && typeof v === 'object') {
    const out = {}
    Object.keys(v).forEach((k) => { out[k] = clone(v[k]) })
    return out
  }
  return v
}

/* ------------------------------------------------------------------ */
/* setData 兼容：支持 'a.b[0].c' 路径写法（小程序常见写法）             */
/* ------------------------------------------------------------------ */
function setPath(target, path, value) {
  const keys = String(path).replace(/\[(\d+)\]/g, '.$1').split('.')
  let obj = target
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    if (obj[k] === undefined || obj[k] === null) obj[k] = {}
    obj = obj[k]
  }
  obj[keys[keys.length - 1]] = value
}

/** 由 main.js 以 app.mixin(...) 注入到每个组件实例 */
export const shim = {
  methods: {
    setData(patch, cb) {
      if (patch && typeof patch === 'object') {
        Object.keys(patch).forEach((k) => {
          if (k.indexOf('.') >= 0 || k.indexOf('[') >= 0) setPath(this, k, patch[k])
          else this[k] = patch[k]
        })
      }
      if (typeof cb === 'function') {
        if (this.$nextTick) this.$nextTick(cb)
        else cb()
      }
    },
  },
}

/* ------------------------------------------------------------------ */
/* 页面生命周期（uni-app 页面组件支持根级写法，保持原样即可）           */
/* ------------------------------------------------------------------ */
const PAGE_HOOKS = [
  'onLoad', 'onShow', 'onReady', 'onHide', 'onUnload', 'onPullDownRefresh',
  'onReachBottom', 'onPageScroll', 'onResize', 'onTabItemTap', 'onShareAppMessage',
  'onShareTimeline', 'onAddToFavorites', 'onSaveExitState', 'onNavigationBarButtonTap',
  'onBackPress', 'onInit', 'onLaunch', 'onError', 'onPageNotFound', 'onThemeChange',
]

/** Page({...}) → Vue3 页面组件选项 */
export function mpPage(options) {
  const src = options || {}
  const out = {}
  const dataSrc = {}

  const rawData = typeof src.data === 'function' ? src.data() : (src.data || {})
  Object.keys(rawData).forEach((k) => { dataSrc[k] = rawData[k] })

  const methods = Object.assign({}, src.methods)

  Object.keys(src).forEach((k) => {
    if (k === 'data' || k === 'methods') return
    if (PAGE_HOOKS.indexOf(k) >= 0) { out[k] = src[k]; return }
    if (typeof src[k] === 'function') { methods[k] = src[k]; return }
    // 顶层非函数自定义字段：小程序里通过 this.data.X 读，这里并入 data
    dataSrc[k] = src[k]
  })

  out.data = function () { return clone(dataSrc) }
  if (Object.keys(methods).length) out.methods = methods
  return out
}

/* ------------------------------------------------------------------ */
/* 组件：properties → props，lifetimes → Vue 生命周期                   */
/* ------------------------------------------------------------------ */
const LIFETIME_MAP = {
  created: 'created',
  attached: 'mounted',
  ready: 'mounted',
  moved: 'mounted',
  detached: 'unmounted',
  error: 'errorCaptured',
}

/** Component({...}) → Vue3 组件选项 */
export function mpComponent(options) {
  const src = options || {}
  const out = {}
  const dataSrc = {}

  const props = {}
  Object.keys(src.properties || {}).forEach((k) => {
    const p = src.properties[k]
    if (p && typeof p === 'object') {
      props[k] = Object.assign({}, p)
      if ('value' in props[k]) {
        props[k].default = props[k].value
        delete props[k].value
      }
    } else {
      props[k] = { type: p }
    }
  })
  if (Object.keys(props).length) out.props = props

  const rawData = typeof src.data === 'function' ? src.data() : (src.data || {})
  Object.keys(rawData).forEach((k) => { dataSrc[k] = rawData[k] })

  const methods = Object.assign({}, src.methods)
  Object.keys(src).forEach((k) => {
    if (k === 'data' || k === 'methods' || k === 'properties' || k === 'lifetimes' || k === 'observers') return
    if (typeof src[k] === 'function') { methods[k] = src[k]; return }
    dataSrc[k] = src[k]
  })
  if (Object.keys(methods).length) out.methods = methods
  out.data = function () { return clone(dataSrc) }

  const used = {}
  Object.keys(src.lifetimes || {}).forEach((k) => {
    const target = LIFETIME_MAP[k]
    if (!target || used[target]) return
    used[target] = true
    out[target] = src.lifetimes[k]
  })
  if (src.attached && !used.mounted) { out.mounted = src.attached; used.mounted = true }
  if (src.detached && !used.unmounted) { out.unmounted = src.detached }
  if (src.ready && !used.mounted) { out.mounted = src.ready; used.mounted = true }

  if (src.observers && Object.keys(src.observers).length) {
    // 本项目组件未使用 observers；如后续需要，用 watch 手工改写
    out.watch = {}
    Object.keys(src.observers).forEach((k) => { out.watch[k] = src.observers[k] })
  }
  return out
}
