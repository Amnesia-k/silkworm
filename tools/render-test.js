/**
 * tools/render-test.js —— uni-app 导出产物的**运行时**验证
 *
 * 思路：把 uni-app/*.vue 拆成「模板编译出的 render 函数」+「转换后的 <script> 选项」，
 * 用 Vue 3 的 @vue/server-renderer 真实渲染一遍（含手动触发 onLoad / onShow / onReady 生命周期），
 * 从而验证：模板表达式合法、null 安全、事件方法存在、canvas 绘图代码不抛异常。
 *
 * 依赖 vue / @vue/server-renderer / @vue/compiler-sfc 来自
 * E:\deepseek\silkworm\web\untitled\node_modules（通过 .tmp-verify/node_modules 目录联接解析）。
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'uni-app')
const TMP = path.join(ROOT, '.tmp-verify')
const NM = 'E:/deepseek/silkworm/web/untitled/node_modules'
const SFC = require(path.join(NM, '@vue/compiler-sfc'))

/** 沙箱不允许在工程内建目录联接，故把裸模块 'vue' 改写成绝对 file URL */
const VUE_URL = 'file:///' + NM + '/vue/dist/vue.runtime.esm-bundler.js'

const pages = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8')).pages

/** 微信/uni-app 原生组件：不能当 Vue 组件解析，否则会报 Failed to resolve component */
const NATIVE = new Set([
  'view', 'text', 'block', 'image', 'button', 'input', 'textarea', 'canvas', 'picker', 'picker-view',
  'picker-view-column', 'slider', 'switch', 'checkbox', 'checkbox-group', 'radio', 'radio-group', 'label',
  'form', 'scroll-view', 'swiper', 'swiper-item', 'movable-area', 'movable-view', 'cover-view', 'cover-image',
  'rich-text', 'progress', 'icon', 'navigator', 'open-data', 'web-view', 'map', 'video', 'audio', 'camera',
  'live-player', 'live-pusher', 'ad', 'official-account', 'functional-page-navigator', 'editor',
  'match-media', 'page-meta', 'navigation-bar', 'keyboard-accessory', 'voip-room',
])

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }) }
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8') }
function read(p) { return fs.readFileSync(p, 'utf8') }

/** 把 @/utils/x.js 之类的别名改成目标文件里的相对路径 */
function rewriteImports(code, prefix) {
  return code
    .replace(/from\s+'@\/utils\/([\w.-]+)'/g, (m, f) => "from '" + prefix + f.replace(/\.js$/, '.mjs') + "'")
    .replace(/from\s+["']vue["']/g, 'from "' + VUE_URL + '"')
}

function main() {
  rmrf(TMP)
  fs.mkdirSync(TMP, { recursive: true })
  write(path.join(TMP, 'package.json'), JSON.stringify({ name: 'verify', type: 'module', private: true }, null, 2))

  // --- utils：复制为 .mjs（内容与导出产物一致，仅改扩展名与 import 路径）---
  fs.readdirSync(path.join(OUT, 'utils')).filter((f) => f.endsWith('.js')).forEach((f) => {
    const code = rewriteImports(read(path.join(OUT, 'utils', f)), './')
      // utils 之间是相对引用（uni-app 里原样可用），这里仅为 .mjs 扩展名做适配
      .replace(/from\s+'\.\/([\w.-]+)\.js'/g, "from './$1.mjs'")
    write(path.join(TMP, 'utils', f.replace(/\.js$/, '.mjs')), code)
  })

  // --- 每个 .vue → render-xx.mjs + script-xx.mjs + 组装模块 ---
  const list = []
  function handle(vueFile, kind) {
    const rel = path.relative(OUT, vueFile).replace(/\\/g, '/')
    const name = path.basename(rel, '.vue')
    const src = read(vueFile)
    const d = SFC.parse(src, { filename: rel }).descriptor
    const renderOut = d.template
      ? SFC.compileTemplate({
        source: d.template.content,
        filename: rel,
        id: rel,
        compilerOptions: { mode: 'module', isCustomElement: (tag) => NATIVE.has(tag) },
      })
      : null

    if (renderOut && renderOut.code) {
      write(path.join(TMP, 'render-' + name + '.mjs'), rewriteImports(renderOut.code, ''))
    }
    if (d.script) {
      // script-xx.mjs 落在 .tmp-verify/ 根下
      write(path.join(TMP, 'script-' + name + '.mjs'), rewriteImports(d.script.content, './utils/'))
    }
    const lines = []
    if (renderOut && renderOut.code) lines.push("import { render } from '../render-" + name + ".mjs'")
    lines.push("import options from '../script-" + name + ".mjs'")
    if (renderOut && renderOut.code) lines.push('export default Object.assign({}, options, { render })')
    else lines.push('export default options')
    write(path.join(TMP, kind + 's', name + '.mjs'), lines.join('\n') + '\n')
    list.push({ rel: rel, name: name, kind: kind })
  }

  pages.forEach((p) => handle(path.join(OUT, p + '.vue'), 'page'))
  fs.readdirSync(path.join(OUT, 'components')).forEach((c) => handle(path.join(OUT, 'components', c, c + '.vue'), 'component'))

  // --- 测试清单（页面查询参数 + 期望在渲染结果中出现的片段）---
  const manifest = {
    pages: list.filter((x) => x.kind === 'page').map((x) => x.name),
    components: list.filter((x) => x.kind === 'component').map((x) => x.name),
    queries: {
      'device-detail': { id: 'heat01' },
      'alarm-detail': { id: '' },
      history: {},
    },
  }
  write(path.join(TMP, 'manifest.json'), JSON.stringify(manifest, null, 2))

  // --- 运行 harness ---
  write(path.join(TMP, 'run.mjs'), read(path.join(__dirname, 'render-harness.mjs')))
  return import(require('url').pathToFileURL(path.join(TMP, 'run.mjs')).href)
}

main().catch((e) => {
  process.stderr.write('render-test 失败：' + ((e && e.stack) || e) + '\n')
  process.exitCode = 1
})
