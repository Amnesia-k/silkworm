/**
 * tools/check-pages.js —— 原生小程序页面静态自检（Node 运行，不属于小程序包）
 * 1) app.json 里每个页面四件套是否齐全、JSON 是否合法
 * 2) wxml 中 bind / catch 绑定的处理函数是否在同名 js 中定义
 * 3) wxml 插值表达式的根标识符是否来自 Page data / wx:for 的 item,index
 * 用法：node tools/check-pages.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const APP_JSON = path.join(ROOT, 'app.json')

const KEYWORDS = {
  true: 1, false: 1, null: 1, undefined: 1, item: 1, index: 1, idx: 1,
  Math: 1, Number: 1, String: 1, Date: 1, Object: 1, Array: 1, JSON: 1,
  isNaN: 1, parseInt: 1, parseFloat: 1, encodeURIComponent: 1, decodeURIComponent: 1,
}

let problems = 0
function bad(msg) {
  problems++
  console.log('  ! ' + msg)
}

function readJson(p) {
  const t = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')
  return JSON.parse(t)
}

/** 提取 Page({ data: { ... } }) 里 data 的一级键 */
function topKeys(js, name) {
  const m = js.match(new RegExp(name + '\\s*:\\s*\\{'))
  if (!m) return new Set()
  const start = m.index + m[0].length - 1
  let depth = 0
  let end = -1
  for (let i = start; i < js.length; i++) {
    const c = js[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end < 0) return new Set()
  const body = js.slice(start + 1, end)
  const keys = new Set()
  let d = 0
  let lineStart = true
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === '{' || c === '[' || c === '(') d++
    else if (c === '}' || c === ']' || c === ')') d--
    else if (c === '\n') lineStart = true
    else if (d === 0 && lineStart && /[A-Za-z_$]/.test(c)) {
      const rest = body.slice(i)
      const km = rest.match(/^([A-Za-z_$][\w$]*)\s*:/)
      if (km) { keys.add(km[1]); i += km[1].length }
      lineStart = false
    } else if (c !== ' ' && c !== '\t') lineStart = false
  }
  return keys
}

function dataKeys(js) {
  const keys = topKeys(js, 'data')
  const props = topKeys(js, 'properties')
  props.forEach((k) => keys.add(k))
  return keys
}

/** wx:for-item / wx:for-index 别名（以及默认 item/index） */
function loopAliases(wxml) {
  const out = new Set(['item', 'index'])
  const re = /wx:for-(?:item|index)\s*=\s*"([^"]+)"/g
  let m
  while ((m = re.exec(wxml))) out.add(m[1].trim())
  const re2 = /wx:for\s*=/g
  let m2
  while ((m2 = re2.exec(wxml))) out.add('item')
  return out
}

/** 模板中插值表达式的根标识符 */
function exprRoots(wxml, allow) {
  const roots = new Set()
  const re = /\{\{([\s\S]*?)\}\}/g
  let m
  while ((m = re.exec(wxml))) {
    const expr = m[1]
    const pathRe = /([A-Za-z_$][\w$]*)((?:\s*\.\s*[A-Za-z_$][\w$]*|\s*\[[^\]]*\])*)/g
    let pm
    while ((pm = pathRe.exec(expr))) {
      const root = pm[1]
      // 跳过对象字面量的键名与字符串内容
      const before = expr.slice(0, pm.index)
      const quotes = (before.match(/'/g) || []).length + (before.match(/"/g) || []).length
      if (quotes % 2 === 1) continue
      const isKey = /[:{,]\s*$/.test(before) && /^\s*:/.test(expr.slice(pm.index + pm[0].length))
      if (isKey) continue
      if (KEYWORDS[root]) continue
      if (allow && allow.has(root)) continue
      roots.add(root)
    }
  }
  return roots
}

function handlers(wxml) {
  const out = new Set()
  const re = /\b(?:bind|catch)([a-zA-Z]+)\s*=\s*"([^"{}]+)"/g
  let m
  while ((m = re.exec(wxml))) out.add(m[2].trim())
  return out
}

const app = readJson(APP_JSON)
console.log('pages: ' + app.pages.length)
app.pages.forEach((p) => {
  const base = p.split('/').pop()
  const dir = path.join(ROOT, p)
  const files = ['js', 'json', 'wxml', 'wxss']
  const missing = files.filter((e) => !fs.existsSync(dir + '.' + e))
  console.log('\n[' + p + ']')
  if (missing.length) bad('缺少文件: ' + missing.join(', '))
  try { readJson(dir + '.json') } catch (e) { bad('json 解析失败: ' + e.message) }
  if (!fs.existsSync(dir + '.js') || !fs.existsSync(dir + '.wxml')) return
  const js = fs.readFileSync(dir + '.js', 'utf8')
  const wxml = fs.readFileSync(dir + '.wxml', 'utf8')
  const dk = dataKeys(js)
  const alias = loopAliases(wxml)
  handlers(wxml).forEach((h) => {
    const re = new RegExp('(^|[^\\w$.])' + h.replace(/\$/g, '\\$') + '\\s*\\(', 'm')
    if (!re.test(js)) bad('模板事件 ' + h + ' 在 js 中未找到定义')
  })
  exprRoots(wxml, alias).forEach((r) => {
    if (!dk.has(r)) bad('模板引用 data 中不存在的字段: ' + r)
  })
  process.stdout.write('  data 字段 ' + dk.size + ' 个, 循环别名 ' + alias.size + ' 个, 模板根标识符校验完成')
})

// 组件
const comps = path.join(ROOT, 'components')
if (fs.existsSync(comps)) {
  fs.readdirSync(comps).forEach((name) => {
    const dir = path.join(comps, name, name)
    if (!fs.existsSync(dir + '.js')) return
    console.log('\n[components/' + name + ']')
    const js = fs.readFileSync(dir + '.js', 'utf8')
    const wxml = fs.readFileSync(dir + '.wxml', 'utf8')
    const dk = dataKeys(js)
    const alias = loopAliases(wxml)
    handlers(wxml).forEach((h) => {
      const re = new RegExp('(^|[^\\w$.])' + h + '\\s*\\(', 'm')
      if (!re.test(js)) bad('模板事件 ' + h + ' 在 js 中未找到定义')
    })
    exprRoots(wxml, alias).forEach((r) => {
      if (!dk.has(r)) bad('模板引用 data/properties 中不存在的字段: ' + r)
    })
    process.stdout.write('  data/properties 字段 ' + dk.size + ' 个')
  })
}

console.log('\n=== 问题数: ' + problems + ' ===')
process.exit(problems ? 1 : 0)
