/**
 * tools/migrate-to-uniapp.js —— 原生微信小程序 → uni-app(Vue3 非 CLI 工程) 机械转换器
 *
 * 设计原则：**只做文本改写，不改业务逻辑**。
 *   wxml → <template>      wx:if/elif/else → v-if/v-else-if/v-else；wx:for → v-for；bind 与 catch 事件 → @事件
 *                          （Vue 不支持属性内插值，任何含 {{}} 的属性统一改写为 :attr="'字面量' + (表达式)"）
 *   js   → <script>        require → import；Page({})/Component({}) → mpPage/mpComponent（见 utils/uni-shim.js）
 *                          this.data.x → this.x；wx.* → uni.*
 *   wxss → <style>         原样搬移（保持逐字节一致）
 *   json → pages.json      页面标题 / 下拉刷新等并入 pages.json 的 style
 *
 * 用法：node tools/migrate-to-uniapp.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'uni-app')
const PAGES_DIR = path.join(ROOT, 'pages')
const COMPONENTS_DIR = path.join(ROOT, 'components')

const warnings = []
const stats = { pages: 0, components: 0, utils: 0, attrs: 0 }

function warn(msg) { warnings.push(msg) }
function readText(p) { return fs.readFileSync(p, 'utf8') }
function writeText(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, s, 'utf8')
}
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }) }

/* ================================================================== */
/* 1. WXML → <template>                                                */
/* ================================================================== */

/** 取 {{ expr }} 里的表达式；不是插值则返回 null */
function innerOf(value) {
  const m = /^\s*\{\{([\s\S]*)\}\}\s*$/.exec(value)
  return m ? m[1].trim() : null
}

/** 含插值的属性值 → Vue 表达式：'a-' + (x) + 'rpx' */
function bindExpr(value, where) {
  const parts = []
  let last = 0
  const re = /\{\{([\s\S]*?)\}\}/g
  let m
  while ((m = re.exec(value))) {
    if (m.index > last) parts.push({ lit: value.slice(last, m.index) })
    parts.push({ expr: m[1].trim() })
    last = m.index + m[0].length
  }
  if (last < value.length) parts.push({ lit: value.slice(last) })
  if (!parts.length) return null
  // 纯单插值：直接用表达式本身，不加括号，便于 v-if 阅读
  if (parts.length === 1 && parts[0].expr) return parts[0].expr
  return parts
    .map((p) => {
      if (p.expr) return '(' + p.expr + ')'
      return "'" + String(p.lit).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n') + "'"
    })
    .join(' + ')
}

const EVENTS = {
  bindtap: '@tap', bindinput: '@input', bindchange: '@change', bindchanging: '@changing',
  bindconfirm: '@confirm', bindblur: '@blur', bindfocus: '@focus', bindsubmit: '@submit',
  bindlongpress: '@longpress', bindload: '@load', binderror: '@error', bindscroll: '@scroll',
  catchtap: '@tap.stop', catchtouchmove: '@touchmove.stop',
  catchtouchstart: '@touchstart.stop', catchtouchend: '@touchend.stop',
  catchtouchcancel: '@touchcancel.stop',
}

/** 重写单个标签的属性列表 */
function rewriteAttrs(tag, attrsStr, selfClose) {
  const attrs = []
  const re = /([a-zA-Z][\w:.-]*)\s*=\s*"([^"]*)"|([a-zA-Z][\w:.-]*)/g
  let m
  while ((m = re.exec(attrsStr))) {
    if (m[1]) attrs.push({ name: m[1], value: m[2] })
    else if (m[3]) attrs.push({ name: m[3], value: null })
  }

  let forExpr = null
  let forItem = 'item'
  let forIndex = 'index'
  let rawKey = null
  const head = []
  const rest = []

  // 第一遍：先取出 wx:for-item / wx:for-index / wx:key
  // （wxml 里 wx:key 常写在 wx:for-item 之前，必须等别名确定后再生成 :key）
  attrs.forEach((a) => {
    if (a.name === 'wx:for-item') forItem = a.value
    else if (a.name === 'wx:for-index') forIndex = a.value
    else if (a.name === 'wx:key') rawKey = a.value
  })

  attrs.forEach((a) => {
    const n = a.name
    const v = a.value
    if (n === 'wx:for') { forExpr = innerOf(v || ''); if (forExpr === null) warn('wx:for 非插值：' + v); return }
    if (n === 'wx:for-item' || n === 'wx:for-index' || n === 'wx:key') return
    if (n === 'wx:if') { head.push('v-if="' + (innerOf(v || '') || v) + '"'); return }
    if (n === 'wx:elif') { head.push('v-else-if="' + (innerOf(v || '') || v) + '"'); return }
    if (n === 'wx:else') { head.push('v-else'); return }
    if (n.indexOf('wx:') === 0) { warn(tag + ' 存在未支持的指令 ' + n); return }
    if (EVENTS[n]) { rest.push(EVENTS[n] + '="' + (v || '') + '"'); return }
    if (/^catch/.test(n)) {
      // catch 语义＝阻止冒泡，uni-app 用 .stop 修饰符表达；未列举的 catch 事件（如 catchtouchstart）默认按此处理
      warn(tag + ' 存在未列举的 catch 事件 ' + n + '，已按 @' + n.replace(/^catch/, '') + '.stop 处理')
      rest.push('@' + n.replace(/^catch/, '') + '.stop="' + (v || '') + '"')
      return
    }
    if (/^bind/.test(n)) { warn(tag + ' 存在未映射的事件 ' + n + '，已按 @' + n.replace(/^bind/, '') + ' 处理'); rest.push('@' + n.replace(/^bind/, '') + '="' + (v || '') + '"'); return }
    if (v !== null && v.indexOf('{{') >= 0) {
      const expr = bindExpr(v, n)
      rest.push(':' + n + '="' + expr + '"')
      stats.attrs++
      return
    }
    if (v === null) rest.push(n)
    else rest.push(n + '="' + v + '"')
  })

  let keyAttr = null
  if (rawKey !== null) {
    const k = innerOf(rawKey)
    const key = k !== null ? k : (rawKey === '*this' ? forItem : forItem + '.' + rawKey)
    keyAttr = ':key="' + key + '"'
  }

  const ordered = []
  if (forExpr !== null) ordered.push('v-for="(' + forItem + ', ' + forIndex + ') in ' + forExpr + '"')
  ordered.push.apply(ordered, head)
  if (keyAttr) ordered.push(keyAttr)
  ordered.push.apply(ordered, rest)

  return '<' + tag + (ordered.length ? ' ' + ordered.join(' ') : '') + (selfClose ? ' />' : '>')
}

function convertWxml(src) {
  // <block> → <template>
  let s = src.replace(/<block(\s|>)/g, '<template$1').replace(/<\/block>/g, '</template>')
  // 逐个标签处理（注释原样保留）
  s = s.replace(/<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<\s*([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g,
    (all, closeTag, openTag, attrsStr, selfClose) => {
      if (all.indexOf('<!--') === 0) return all
      if (closeTag) return '</' + closeTag + '>'
      const tag = openTag === 'block' ? 'template' : openTag
      return rewriteAttrs(tag, attrsStr || '', !!selfClose)
    })
  return s
}

/** 顶层元素个数（判断是否需要包一个根节点） */
function countRoots(src) {
  const body = src.replace(/<!--[\s\S]*?-->/g, '')
  const VOID = ['input', 'image', 'canvas', 'slider', 'switch', 'icon', 'textarea', 'progress', 'import', 'include']
  let depth = 0
  let roots = 0
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let m
  while ((m = re.exec(body))) {
    const closing = m[1] === '/'
    const tag = m[2]
    const selfClose = m[4] === '/' || VOID.indexOf(tag) >= 0
    if (closing) { depth--; continue }
    if (depth === 0) roots++
    if (!selfClose) depth++
  }
  return roots
}

/* ================================================================== */
/* 2. JS → <script>                                                    */
/* ================================================================== */
function toImportPath(p) {
  const clean = p.replace(/^(?:\.\.?\/)+/, '').replace(/^utils\//, '')
  return '@/utils/' + clean
}

/** kind: 'page' | 'component' | 'app' */
function convertJs(src, kind) {
  let out = src

  // require → import（相对 utils 路径统一为 @/utils 别名）
  out = out.replace(/const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)/g,
    (m, name, q, p) => "import * as " + name + " from '" + toImportPath(p) + "'")
  if (/\brequire\s*\(/.test(out)) warn('仍有未转换的 require(')

  if (kind === 'app') {
    // App({...}) → Vue 根组件选项：globalData 必须留在根级，供 getApp().globalData 读取
    out = out.replace(/\bApp\s*\(\s*\{/, 'export default {')
    // 对应的收尾 }) → }
    out = out.replace(/\}\)(\s*)$/, '}$1')
    if (/\bApp\s*\(/.test(out)) warn('仍有未转换的 App(')
  } else {
    out = out.replace(/\bPage\s*\(\s*\{/, 'export default mpPage({')
    out = out.replace(/\bComponent\s*\(\s*\{/, 'export default mpComponent({')
    if (/\bPage\s*\(/.test(out) || /\bComponent\s*\(/.test(out)) warn('仍有未转换的 Page(/Component(')
  }

  // 小程序 this.data.x → Vue this.x
  out = out.replace(/this\.data\./g, 'this.')
  if (/this\.data\b/.test(out)) warn('存在裸 this.data 用法，需人工确认')

  // wx.* → uni.*
  out = out.replace(/\bwx\./g, 'uni.')
  if (/\bwx\./.test(out)) warn('仍有未转换的 wx.')

  if (kind === 'component') out = "import { mpComponent } from '@/utils/uni-shim.js'\n" + out
  else if (kind === 'page') out = "import { mpPage } from '@/utils/uni-shim.js'\n" + out
  return out
}

/* ================================================================== */
/* 3. 组装 .vue                                                       */
/* ================================================================== */
function buildVue(wxml, jsText, wxss, opts) {
  const isComponent = !!opts.isComponent
  const body = convertWxml(wxml)
  const roots = countRoots(wxml)
  const inner = !isComponent && roots > 1
    ? '  <view class="page-wrap">\n' + indent(body.trim(), 2) + '\n  </view>\n'
    : (roots > 1 ? indent(body.trim(), 1) + '\n' : body.trim() + '\n')
  return [
    '<template>',
    inner.replace(/\s+$/, ''),
    '</template>',
    '',
    '<script>',
    convertJs(jsText, isComponent ? 'component' : 'page').replace(/\s+$/, ''),
    '</script>',
    '',
    '<style>',
    '/* ' + opts.wxssName + '（与原生小程序工程逐字节一致） */',
    wxss.trim(),
    '</style>',
    '',
  ].join('\n')
}

function indent(s, n) {
  const pad = '  '.repeat(n)
  return s.split('\n').map((l) => (l.trim() ? pad + l : l)).join('\n')
}

/* ================================================================== */
/* 4. utils 转换                                                       */
/* ================================================================== */
function convertUtil(src) {
  let out = src
  out = out.replace(/const\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)/g,
    (m, name, q, p) => "import * as " + name + " from '" + (p.indexOf('.') === 0 ? p : toImportPath(p)) + "'")
  out = out.replace(/module\.exports\s*=\s*\{/, 'export {')
  if (/\brequire\s*\(|module\.exports/.test(out)) warn('utils 中仍有 require/module.exports')
  return out
}

/* ================================================================== */
/* 5. 主流程                                                           */
/* ================================================================== */
function main() {
  const appJson = JSON.parse(readText(path.join(ROOT, 'app.json')))
  const pages = appJson.pages

  rmrf(path.join(OUT, 'pages'))
  rmrf(path.join(OUT, 'components'))

  // --- utils ---
  fs.mkdirSync(path.join(OUT, 'utils'), { recursive: true })
  fs.readdirSync(path.join(OUT, 'utils')).forEach((f) => {
    if (f !== 'uni-shim.js' && f.endsWith('.js')) fs.rmSync(path.join(OUT, 'utils', f))
  })
  fs.readdirSync(path.join(ROOT, 'utils')).filter((f) => f.endsWith('.js') && f !== 'util.js').forEach((f) => {
    writeText(path.join(OUT, 'utils', f), convertUtil(readText(path.join(ROOT, 'utils', f))))
    stats.utils++
  })

  // --- pages ---
  const pageEntries = []
  pages.forEach((p) => {
    const name = p.split('/').pop()
    const dir = path.join(PAGES_DIR, name)
    const wxml = readText(path.join(dir, name + '.wxml'))
    const js = readText(path.join(dir, name + '.js'))
    const wxss = readText(path.join(dir, name + '.wxss'))
    const json = JSON.parse(readText(path.join(dir, name + '.json')))
    writeText(path.join(OUT, p + '.vue'), buildVue(wxml, js, wxss, {
      isComponent: false, wxssName: name + '.wxss',
    }))
    const style = { navigationBarTitleText: json.navigationBarTitleText || '' }
    if (json.enablePullDownRefresh) style.enablePullDownRefresh = true
    if (json.backgroundTextStyle) style.backgroundTextStyle = json.backgroundTextStyle
    pageEntries.push({ path: p, style })
    stats.pages++
  })

  // --- components ---
  fs.readdirSync(COMPONENTS_DIR).forEach((name) => {
    const dir = path.join(COMPONENTS_DIR, name)
    if (!fs.statSync(dir).isDirectory()) return
    const wxml = readText(path.join(dir, name + '.wxml'))
    const js = readText(path.join(dir, name + '.js'))
    const wxss = readText(path.join(dir, name + '.wxss'))
    writeText(path.join(OUT, 'components', name, name + '.vue'), buildVue(wxml, js, wxss, {
      isComponent: true, wxssName: name + '.wxss',
    }))
    stats.components++
  })

  // --- pages.json ---
  const pagesJson = {
    easycom: { autoscan: true },
    pages: pageEntries,
    globalStyle: {
      navigationBarTextStyle: appJson.window.navigationBarTextStyle || 'black',
      navigationBarTitleText: appJson.window.navigationBarTitleText || '',
      navigationBarBackgroundColor: appJson.window.navigationBarBackgroundColor || '#ffffff',
      backgroundColor: appJson.window.backgroundColor || '#f4f6f9',
    },
    tabBar: appJson.tabBar,
  }
  writeText(path.join(OUT, 'pages.json'), JSON.stringify(pagesJson, null, 2) + '\n')

  // --- App.vue（全局样式 + 全局数据） ---
  const appWxss = readText(path.join(ROOT, 'app.wxss'))
  const appJs = readText(path.join(ROOT, 'app.js'))
  writeText(path.join(OUT, 'App.vue'), [
    '<script>',
    convertJs(appJs, 'app').replace(/\s+$/, ''),
    '</script>',
    '',
    '<style>',
    '/* app.wxss（与原生小程序工程逐字节一致） */',
    appWxss.trim(),
    '</style>',
    '',
  ].join('\n'))

  // --- main.js ---
  writeText(path.join(OUT, 'main.js'), [
    "import App from './App'",
    "import { createSSRApp } from 'vue'",
    "import { shim } from './utils/uni-shim.js'",
    '',
    'export function createApp() {',
    '  const app = createSSRApp(App)',
    '  // 小程序写法兼容层：为每个组件实例提供 setData(patch, cb)',
    '  app.mixin(shim)',
    '  return { app }',
    '}',
    '',
  ].join('\n'))

  // --- manifest.json（保留原配置，更新名称/描述） ---
  const mfPath = path.join(OUT, 'manifest.json')
  if (fs.existsSync(mfPath)) {
    const mf = JSON.parse(readText(mfPath))
    mf.name = '养蚕环境调控系统'
    mf.description = '依据《环境调控规格书》的蚕房环境监控与调控演示：实时看板 / 历史曲线 / 告警 / 手动控制 / 参数配置 / 日报 / Agent 问答'
    mf.vueVersion = '3'
    writeText(mfPath, JSON.stringify(mf, null, 2) + '\n')
  }

  console.log('== 转换完成 ==')
  console.log('  页面 .vue      : ' + stats.pages)
  console.log('  组件 .vue      : ' + stats.components)
  console.log('  utils 模块     : ' + stats.utils)
  console.log('  动态绑定属性   : ' + stats.attrs)
  console.log('  输出目录       : ' + OUT)
  if (warnings.length) {
    console.log('\n== 需人工确认（' + warnings.length + '）==')
    warnings.forEach((w) => console.log('  ! ' + w))
  } else {
    console.log('  无告警')
  }
}

main()
