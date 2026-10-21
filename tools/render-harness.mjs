/**
 * tools/render-harness.mjs —— 由 tools/render-test.js 复制到 .tmp-verify/run.mjs 执行。
 *
 * 在 Node 里用 Vue 3 的 @vue/server-renderer 真实渲染 uni-app 导出的每个页面与组件：
 *   1) 安装 uni.* 桩件（含 canvas 2d 上下文桩件）
 *   2) 用 shim 提供 setData
 *   3) 手动触发 onLoad / onShow / onReady（父页面）与 attached（子组件）
 *   4) 渲染并检查：是否有异常、Vue 警告、渲染结果是否有真实内容
 */
import { readFileSync, writeSync } from 'fs'
import { shim } from './utils/uni-shim.mjs'
import * as data from './utils/data.mjs'
import * as engine from './utils/engine.mjs'
import * as nav from './utils/nav.mjs'

/** 同步输出：避免 process.exit 截断管道里的 stdout */
function say(s) { writeSync(1, s + '\n') }

/* Vue 的 esm-bundler 构建依赖这三个编译期特性开关（等价于 vite 的 define） */
globalThis.__VUE_OPTIONS_API__ = true
globalThis.__VUE_PROD_DEVTOOLS__ = false
globalThis.__VUE_PROD_HYDRATION_MISMATCH_DETAILS__ = false

const NM = 'file:///E:/deepseek/silkworm/web/untitled/node_modules'
const { createSSRApp } = await import(NM + '/vue/dist/vue.runtime.esm-bundler.js')
const { renderToString } = await import(NM + '/@vue/server-renderer/dist/server-renderer.esm-bundler.js')

/* ================= 1. uni.* 桩件 ================= */
const store = {}
const uniCalls = []
const canvasCalls = []

function makeCtx() {
  const target = {}
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k]
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} })
      if (k === 'measureText') return (s) => ({ width: String(s || '').length * 7 })
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      if (typeof k === 'string' && /^(fill|stroke|clear|begin|close|move|line|arc|rect|roundRect|quadratic|bezier|save|restore|translate|scale|rotate|clip|draw|put|set|ellipse|transform|create)/.test(k)) {
        return (...args) => { canvasCalls.push(k) }
      }
      return undefined
    },
    set(t, k, v) { t[k] = v; return true },
  })
}

function makeCanvas() {
  const c = { width: 320, height: 160 }
  c.getContext = () => (c._ctx || (c._ctx = Object.assign(makeCtx(), { canvas: c })))
  return c
}

function makeQuery() {
  const q = {
    select(sel) { q._sel = sel; return q },
    selectAll(sel) { q._sel = sel; return q },
    in() { return q },
    fields(o) { q._fields = o; return q },
    boundingClientRect(cb) { q._cb = cb; return q },
    exec(cb) {
      const node = makeCanvas()
      if (cb) cb([{ id: q._sel, node, width: 320, height: 160 }])
      else if (q._cb) q._cb({ id: q._sel, width: 320, height: 160 })
    },
  }
  return q
}

const windowInfo = { windowWidth: 375, windowHeight: 667, pixelRatio: 2, platform: 'devtools', SDKVersion: '3.0.0', safeArea: { top: 0, bottom: 667 } }

globalThis.uni = {
  getStorageSync: (k) => (store[k] === undefined ? '' : store[k]),
  setStorageSync: (k, v) => { store[k] = v },
  removeStorageSync: (k) => { delete store[k] },
  createSelectorQuery: () => makeQuery(),
  getSystemInfoSync: () => windowInfo,
  getWindowInfo: () => windowInfo,
  showToast: (o) => uniCalls.push('toast:' + (o && o.title)),
  hideToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  showModal: (o) => { uniCalls.push('modal:' + (o && o.title)); if (o && o.success) o.success({ confirm: true, cancel: false }) },
  navigateTo: (o) => { uniCalls.push('navigateTo:' + (o && o.url)); if (o && o.success) o.success({}) },
  switchTab: (o) => { uniCalls.push('switchTab:' + (o && o.url)); if (o && o.success) o.success({}) },
  redirectTo: (o) => { uniCalls.push('redirectTo:' + (o && o.url)); if (o && o.success) o.success({}) },
  reLaunch: (o) => { uniCalls.push('reLaunch:' + (o && o.url)); if (o && o.success) o.success({}) },
  navigateBack: () => uniCalls.push('navigateBack'),
  setClipboardData: (o) => { uniCalls.push('clipboard'); if (o && o.success) o.success({}) },
  setNavigationBarTitle: () => {},
  pageScrollTo: () => {},
  showTabBarRedDot: (o) => uniCalls.push('redDot:' + (o && o.index)),
  hideTabBarRedDot: () => {},
  stopPullDownRefresh: () => {},
  showActionSheet: () => {},
  env: { USER_DATA_PATH: 'wxfile://usr' },
  getFileSystemManager: () => ({ writeFile: (o) => { uniCalls.push('writeFile'); if (o && o.success) o.success({}) } }),
}
globalThis.wx = globalThis.uni
globalThis.getApp = () => ({ globalData: { currentBarn: 'barn01', role: 'admin' } })

/* ================= 2. 渲染 ================= */
const logs = []
const origWarn = console.warn
const origError = console.error
console.warn = (...a) => logs.push('warn: ' + a.map(String).join(' '))
console.error = (...a) => logs.push('error: ' + a.map(String).join(' '))

const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'))
data.setCurrentBarn('barn01')
if (data.setRole) data.setRole('admin')

const barnBarMod = await import('./components/barn-bar.mjs')
const barnBar = Object.assign({}, barnBarMod.default, { __runMountedEarly: true })

/* 模拟 uni-app 的 easycom：uni-app 侧 pages.json 有 easycom.autoscan，
   components/<name>/<name>.vue 会被自动注册；SSR 这里也要注册，否则 <skeleton> 之类的
   自定义组件会被当成未知标签，产生「Failed to resolve component」假告警。 */
const easycom = {}
for (const cname of manifest.components || []) {
  if (cname === 'barn-bar') { easycom[cname] = barnBar; continue }
  const m = await import('./components/' + cname + '.mjs')
  easycom[cname] = Object.assign({}, m.default, { __runMountedEarly: true })
}

function strip(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
}

async function renderOne(name, kind) {
  const problems = []
  let lifecycleError = null
  let html = ''
  const mod = await import('./' + kind + 's/' + name + '.mjs')
  const cmp = mod.default
  const query = Object.assign({}, manifest.queries[name] || {})
  // 让 alarm-detail 走「找到该告警」分支：传一条真实告警 id
  if (name === 'alarm-detail' && !query.id) {
    const all = data.getAlarms(null, {}) || []
    if (all.length) query.id = all[0].id
  }
  if (process.env.DEBUG_ONE && process.env.DEBUG_ONE !== name) return

  const app = createSSRApp(Object.assign({}, cmp, { __isPage: kind === 'page', __runMountedEarly: kind === 'component', __query: query, __name: name }))
  Object.keys(easycom).forEach((cname) => app.component(cname, easycom[cname]))
  app.mixin(shim)
  app.mixin({
    created() {
      const opts = this.$options
      if (opts.__runMountedEarly && typeof opts.mounted === 'function') {
        try {
          opts.mounted.call(this)
          if (process.env.DEBUG_ONE) say('  [debug] ' + opts.__name + ' mounted 后 info=' + JSON.stringify(this.info).slice(0, 160))
        } catch (e) { lifecycleError = e }
      } else if (process.env.DEBUG_ONE) {
        say('  [debug] ' + opts.__name + ' runMountedEarly=' + !!opts.__runMountedEarly + ' mounted=' + typeof opts.mounted)
      }
      if (!opts.__isPage) return
      try {
        if (typeof opts.onLoad === 'function') opts.onLoad.call(this, opts.__query || {})
        if (typeof opts.onShow === 'function') opts.onShow.call(this)
        if (typeof opts.onReady === 'function') opts.onReady.call(this)
        // 页面骨架屏靠 nav.skeletonDone 里的 setTimeout（至少展示 420 ms）收尾，而 SSR 渲染是同步的、
        // 定时器不可能先触发。这里**真实调用** nav.skeletonDone（把 _skAt 拨到 10 s 前让等待时间归零），
        // 而不是直接把 loading 置 false —— 后者会掩盖「骨架屏永不解除」这类真 bug：uni-app 的页面实例
        // 没有 page.data（只有 Vue 的 this.$data），过去 nav.skeletonBegin/Done 因此静默空转，
        // 每个页面都永远停在骨架屏上（用户报的「点进去一直在渲染中」就是这个）。
        this._skAt = Date.now() - 10000
        if (typeof nav.skeletonDone === 'function') nav.skeletonDone(this)
        if (this.loading === true) problems.push('骨架屏未解除：nav.skeletonDone 调用后 loading 仍为 true（页面会永远停在骨架屏）')
        if (process.env.DEBUG_ONE) say('  [debug] ' + opts.__name + ' loading=' + this.loading)
      } catch (e) { lifecycleError = e }
    },
  })

  const before = logs.length
  try {
    html = await renderToString(app)
  } catch (e) {
    problems.push('渲染抛异常：' + e.message)
  }
  if (lifecycleError) problems.push('生命周期抛异常：' + lifecycleError.message + ' @ ' + String(lifecycleError.stack || '').split('\n')[1])
  const newLogs = logs.slice(before)
  newLogs.forEach((l) => {
    if (l.indexOf('warn: [Vue warn]') === 0) problems.push(l.slice(0, 220))
    else if (l.indexOf('error:') === 0) problems.push(l.slice(0, 220))
  })

  const text = strip(html)
  const tagCount = (html.match(/</g) || []).length
  results.push({ name, kind, len: html.length, nodes: tagCount, text, problems })
}

const results = []
for (const name of manifest.pages) await renderOne(name, 'page')
for (const name of manifest.components) await renderOne(name, 'component')

/* ================= 3. 结论 ================= */
console.warn = origWarn
console.error = origError

let bad = 0
say('='.repeat(78))
results.forEach((r) => {
  const status = r.problems.length ? 'FAIL' : 'ok  '
  if (r.problems.length) bad++
  say('[' + status + '] ' + r.name + '  html=' + r.len + 'B nodes=' + r.nodes)
  say('        ' + (r.text || '(空)').slice(0, process.env.VERBOSE === '1' ? 4000 : 150))
  r.problems.forEach((p) => say('        ! ' + p))
})
say('='.repeat(78))
say('页面/组件：' + results.length + '，失败：' + bad)
say('canvas 绘图调用：' + canvasCalls.length + ' 次，涉及 ' + [...new Set(canvasCalls)].length + ' 种方法')
say('uni 交互调用：' + (uniCalls.length ? [...new Set(uniCalls)].join(' | ') : '（无）'))
engine.stop()
process.exit(bad ? 1 : 0)
