/**
 * tools/check-uniapp.js —— uni-app 导出产物的静态自检
 *
 * 1) 结构检查：每个 .vue 都有 <template>/<script>/<style>，pages.json 与 app.json 对齐
 * 2) 残留检查：不应再出现 wx:if / bindtap / this.data. / wx. / module.exports / require( / {{ 属性内插值
 * 3) 样式检查：<style> 内容与原生工程的 .wxss 逐字节一致
 * 4) 真实编译校验：用 @vue/compiler-sfc 的 parse + compileTemplate + compileScript 逐文件编译
 */
const fs = require('fs')
const path = require('path')
const SFC = require(path.join('E:/deepseek/silkworm/web/untitled/node_modules/@vue/compiler-sfc'))

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'uni-app')

let pass = 0
const fails = []
function ok(name) { pass++; }
function bad(name, detail) { fails.push(name + (detail ? ' —— ' + detail : '')) }

function readText(p) { return fs.readFileSync(p, 'utf8') }
function walk(dir, ext, out) {
  out = out || []
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'unpackage') walk(p, ext, out) }
    else if (p.endsWith(ext)) out.push(p)
  })
  return out
}

const vueFiles = walk(OUT, '.vue')
const appJson = JSON.parse(readText(path.join(ROOT, 'app.json')))

/* ---------- 1. 结构 + 编译 ---------- */
vueFiles.forEach((file) => {
  const rel = path.relative(OUT, file).replace(/\\/g, '/')
  const src = readText(file)
  const isApp = rel === 'App.vue'

  // 1.1 三段齐全（App.vue 按 uni-app 约定允许没有 <template>）
  const needTags = isApp
    ? ['<script>', '</script>', '<style>', '</style>']
    : ['<template>', '</template>', '<script>', '</script>', '<style>', '</style>']
  needTags.forEach((tag) => {
    if (src.indexOf(tag) < 0) bad(rel + ' 缺少 ' + tag)
  })

  // 1.2 残留写法（模板段 + 去注释后的脚本段，分开检查）
  const tpl = /<template>([\s\S]*)<\/template>/.exec(src)
  const tplSrc = tpl ? tpl[1] : ''
  const scriptM = /<script>([\s\S]*)<\/script>/.exec(src)
  const scriptSrc = (scriptM ? scriptM[1] : src)
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // 行注释（避开 http://）

  ;[[tplSrc, 'template'], [scriptSrc, 'script']].forEach((pair) => {
    const seg = pair[0]
    const where = pair[1]
    const leftovers = [
      [/wx:if|wx:elif|wx:else|wx:for|wx:key/, 'wx: 指令'],
      [/\bbind[a-z]+\s*=|\bcatch[a-z]+\s*=/, 'bind*/catch* 属性'],
      [/this\.data\./, 'this.data.'],
      [/\bwx\./, 'wx.'],
      [/module\.exports/, 'module.exports'],
      [/\brequire\s*\(/, 'require('],
      [/\bPage\s*\(|\bComponent\s*\(|\bApp\s*\(/, 'Page(/Component(/App('],
    ]
    leftovers.forEach((p) => {
      const m = p[0].exec(seg)
      if (m) bad(rel + ' ' + where + ' 残留 ' + p[1], JSON.stringify(seg.substr(m.index, 40)))
    })
  })

  // 1.3 属性内不得再有插值（模板段内）
  if (tpl) {
    const attrMustache = /[a-zA-Z-]+\s*=\s*"[^"]*\{\{/.exec(tpl[1])
    if (attrMustache) bad(rel + ' 属性内仍有插值', attrMustache[0])
    if (/<block[\s>]/.test(tpl[1])) bad(rel + ' 仍有 <block>')
  }

  // 1.3b v-for 的 :key 必须用该元素自己的别名（wxml 里 wx:key 常写在 wx:for-item 之前）
  if (tpl) {
    const tags = tpl[1].split('<').slice(1).map((s) => s.slice(0, s.indexOf('>') + 1))
    tags.forEach((tag) => {
      const f = /v-for="\(\s*([\w$]+)\s*,/.exec(tag)
      if (!f) return
      const alias = f[1]
      const k = /:key="([^"]*)"/.exec(tag)
      if (!k) return
      if (/(^|[^\w$.])item\b/.test(k[1]) && alias !== 'item') bad(rel + ' :key 用了未定义的 item（别名 ' + alias + '）', k[0])
      if (/(^|[^\w$.])index\b/.test(k[1]) && alias !== 'index') bad(rel + ' :key 用了未定义的 index（别名 ' + alias + '）', k[0])
    })
  }

  // 1.4 @vue/compiler-sfc 真实编译
  const parsed = SFC.parse(src, { filename: rel })
  if (parsed.errors && parsed.errors.length) {
    bad(rel + ' SFC 解析错误', parsed.errors.map((e) => e.message || String(e)).join(' | '))
  } else {
    const d = parsed.descriptor
    if (!isApp && !d.template) bad(rel + ' 无 template 块')
    if (!d.script && !d.scriptSetup) bad(rel + ' 无 script 块')
    if (d.template) {
      const c = SFC.compileTemplate({
        source: d.template.content,
        filename: rel,
        id: rel,
        compilerOptions: { mode: 'module' },
      })
      if (c.errors && c.errors.length) {
        bad(rel + ' 模板编译错误', c.errors.map((e) => e.message || String(e)).join(' | '))
      }
    }
    if (d.script) {
      try {
        SFC.compileScript(d, { id: rel })
      } catch (e) {
        bad(rel + ' 脚本编译错误', e.message)
      }
    }
  }
  ok(rel)
})

/* ---------- 2. pages.json ---------- */
const pagesJson = JSON.parse(readText(path.join(OUT, 'pages.json')))
if (pagesJson.pages.length !== appJson.pages.length) {
  bad('pages.json 页数', pagesJson.pages.length + ' vs ' + appJson.pages.length)
} else {
  appJson.pages.forEach((p, i) => {
    if (pagesJson.pages[i].path !== p) bad('pages.json 第' + (i + 1) + '页顺序', pagesJson.pages[i].path + ' vs ' + p)
    const n = p.split('/').pop()
    const j = JSON.parse(readText(path.join(ROOT, 'pages', n, n + '.json')))
    if (pagesJson.pages[i].style.navigationBarTitleText !== j.navigationBarTitleText) {
      bad('pages.json 标题 ' + p, pagesJson.pages[i].style.navigationBarTitleText + ' vs ' + j.navigationBarTitleText)
    }
    if (!!pagesJson.pages[i].style.enablePullDownRefresh !== !!j.enablePullDownRefresh) {
      bad('pages.json 下拉刷新 ' + p)
    }
  })
}
if (!pagesJson.tabBar || pagesJson.tabBar.list.length !== appJson.tabBar.list.length) bad('pages.json tabBar')
else {
  appJson.tabBar.list.forEach((t, i) => {
    if (pagesJson.tabBar.list[i].pagePath !== t.pagePath) bad('tabBar 第' + (i + 1) + '项', pagesJson.tabBar.list[i].pagePath)
  })
}
if (!pagesJson.easycom || !pagesJson.easycom.autoscan) bad('pages.json 缺少 easycom.autoscan')

/* ---------- 3. manifest / main.js / App.vue ---------- */
const mf = JSON.parse(readText(path.join(OUT, 'manifest.json')))
if (mf.vueVersion !== '3') bad('manifest.json vueVersion')
if (!mf['mp-weixin'] || !mf['mp-weixin'].appid) bad('manifest.json mp-weixin.appid')
const mainJs = readText(path.join(OUT, 'main.js'))
if (!/createSSRApp/.test(mainJs)) bad('main.js 未使用 createSSRApp')
if (!/app\.mixin\(shim\)/.test(mainJs)) bad('main.js 未挂载 shim mixin')

/* ---------- 4. 样式逐字节一致 ---------- */
vueFiles.forEach((file) => {
  const rel = path.relative(OUT, file).replace(/\\/g, '/')
  const src = readText(file)
  const m = /<style>\s*(?:\/\* [^*]*\*\/\s*)?([\s\S]*?)\s*<\/style>/.exec(src)
  if (!m) { bad(rel + ' 无 style 内容'); return }
  const got = m[1]
  let origin
  if (rel === 'App.vue') origin = path.join(ROOT, 'app.wxss')
  else if (rel.indexOf('components/') === 0) {
    const n = rel.split('/')[1]
    origin = path.join(ROOT, 'components', n, n + '.wxss')
  } else {
    const n = rel.split('/')[1]
    origin = path.join(ROOT, 'pages', n, n + '.wxss')
  }
  const want = readText(origin).trim()
  if (got !== want) {
    let i = 0
    while (i < Math.min(got.length, want.length) && got[i] === want[i]) i++
    bad(rel + ' style 与 ' + path.basename(origin) + ' 不一致 @' + i,
      JSON.stringify(got.substr(i, 30)) + ' vs ' + JSON.stringify(want.substr(i, 30)))
  }
})

/* ---------- 5. shim 存在 ---------- */
if (!fs.existsSync(path.join(OUT, 'utils', 'uni-shim.js'))) bad('缺少 utils/uni-shim.js')
else {
  const shim = readText(path.join(OUT, 'utils', 'uni-shim.js'))
  ;['mpPage', 'mpComponent', 'shim'].forEach((k) => {
    if (shim.indexOf('export') < 0 || shim.indexOf(k) < 0) bad('uni-shim.js 缺少导出 ' + k)
  })
}
;['data.js', 'engine.js', 'spec.js', 'chart.js', 'nav.js'].forEach((f) => {
  const p = path.join(OUT, 'utils', f)
  if (!fs.existsSync(p)) bad('缺少 utils/' + f)
  else if (readText(p).indexOf('export {') < 0 && readText(p).indexOf('export ') < 0) bad('utils/' + f + ' 无 ESM 导出')
})

console.log('文件数：' + vueFiles.length + ' 个 .vue')
console.log('通过：' + pass + ' 项检查')
if (fails.length) {
  console.log('\n失败 ' + fails.length + ' 项：')
  fails.forEach((f) => console.log('  ! ' + f))
  process.exitCode = 1
} else {
  console.log('失败：0 项')
}
