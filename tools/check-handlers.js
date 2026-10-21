/* tools/check-handlers.js —— 校验每个页面/组件的 wxml 事件绑定在对应 js 中确有实现
 * 用法：node tools/check-handlers.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
let bad = 0
let checked = 0

function handlersOf(wxml) {
  const names = new Set()
  const re = /\b(?:bind|catch|capture-bind|capture-catch)[:\-]?([a-zA-Z]+)\s*=\s*"([^"]*)"/g
  let m
  while ((m = re.exec(wxml))) {
    const v = m[2].trim()
    if (!v || v.indexOf('{{') >= 0) continue
    names.add(v)
  }
  return names
}

;['pages', 'components'].forEach((root) => {
  const base = path.join(ROOT, root)
  fs.readdirSync(base).forEach((name) => {
    const dir = path.join(base, name)
    if (!fs.statSync(dir).isDirectory()) return
    const wxmlPath = path.join(dir, name + '.wxml')
    const jsPath = path.join(dir, name + '.js')
    if (!fs.existsSync(wxmlPath) || !fs.existsSync(jsPath)) return
    checked++
    const w = fs.readFileSync(wxmlPath, 'utf8')
    const j = fs.readFileSync(jsPath, 'utf8')
    const missing = [...handlersOf(w)].filter(
      (n) => !new RegExp('(^|[^\\w.])' + n + '\\s*[(:]', 'm').test(j),
    )
    if (missing.length) {
      bad++
      console.log('MISSING ' + name + ': ' + missing.join(', '))
    }
  })
})

console.log(bad ? 'handlers missing in ' + bad + ' file(s)' : 'handlers ok (' + checked + ' 页面/组件)')
process.exit(bad ? 1 : 0)
