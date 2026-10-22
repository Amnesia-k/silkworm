/**
 * tools/check-e2e.js —— 全链路联调自测：**真实前端客户端** → 真实 HTTP → 桩服务
 *
 * 与 check-clamp.js 的区别：
 *   check-clamp.js  只测客户端逻辑（桩掉 wx.request，不出网）
 *   check-e2e.js    用 utils/clamp.js 的真实代码走真实 HTTP，打到 tools/stub-clamp-server.js
 *
 * 这证明了「前端代码 → 网络 → 后端契约」整条链路是通的；等 WireGuard 隧道建好，
 * 把 baseUrl 换成 http://115.191.10.217:8000（**不含 /api**，客户端自己拼 /api）再跑一次，就是真实后端的验收。
 *
 *   node tools/check-e2e.js
 *   node tools/check-e2e.js --url http://115.191.10.217:8000 --token test
 */

'use strict'

const http = require('http')
const path = require('path')
const { spawn } = require('child_process')

const argv = process.argv.slice(2)
function argOf(flag, dflt) {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}

const PORT = 8901
const EXTERNAL = argOf('--url', null)
const BASE = EXTERNAL || ('http://127.0.0.1:' + PORT)
const TOKEN = argOf('--token', 'test')

let pass = 0
let fail = 0
const failures = []

function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  failures.push(label + '\n    期望 ' + e + '\n    实际 ' + a)
}
function ok(v, label) {
  if (v) { pass++; return }
  fail++
  failures.push(label)
}

/* ------------------------------------------------------------------ */
/* 用真实 HTTP 实现一个最小 wx 运行时，喂给真实的 utils/clamp.js        */
/* ------------------------------------------------------------------ */
const STORAGE = {}

global.wx = {
  getStorageSync: (k) => (k in STORAGE ? STORAGE[k] : ''),
  setStorageSync: (k, v) => { STORAGE[k] = v },
  removeStorageSync: (k) => { delete STORAGE[k] },
  showToast: () => {},
  getSystemInfoSync: () => ({ platform: 'devtools', SDKVersion: '3.0.0' }),
  request(param) {
    let u
    try { u = new URL(param.url) } catch (e) {
      param.fail({ errMsg: 'request:fail invalid url' })
      return
    }
    const body = param.data === undefined ? null : JSON.stringify(param.data)
    const headers = Object.assign({}, param.header || {})
    if (body) headers['content-length'] = Buffer.byteLength(body)

    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: param.method || 'GET', headers: headers, timeout: param.timeout || 15000,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let data = text
        try { data = JSON.parse(text) } catch (e) { /* 保持原样 */ }
        param.success({ statusCode: res.statusCode, data: data, header: res.headers })
      })
    })
    r.on('error', (e) => param.fail({ errMsg: 'request:fail ' + e.message }))
    r.on('timeout', () => { r.destroy(); param.fail({ errMsg: 'request:fail timeout' }) })
    if (body) r.write(body)
    r.end()
  },
}

// 必须在定义 global.wx 之后 require，clamp.js 才会认到运行时
const clamp = require(path.join(__dirname, '..', 'utils', 'clamp.js'))

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function waitHealthy(maxMs) {
  const deadline = Date.now() + (maxMs || 8000)
  return new Promise((resolve) => {
    const tick = () => {
      const u = new URL(BASE + '/health')
      http.get({ hostname: u.hostname, port: u.port, path: u.pathname, timeout: 1500,
        headers: { authorization: 'Bearer ' + TOKEN } }, (res) => {
        res.resume()
        if (res.statusCode === 200) return resolve(true)
        retry()
      }).on('error', retry)
    }
    const retry = () => { if (Date.now() > deadline) resolve(false); else setTimeout(tick, 150) }
    tick()
  })
}

/* ------------------------------------------------------------------ */
let child = null
const TRAY_PREFIX = 'E2E-'

async function run() {
  console.log('  目标：' + BASE + (EXTERNAL ? '（真实后端）' : '（本地桩服务）'))

  const cfg = clamp.setConfig({ baseUrl: BASE, token: TOKEN, zone: 'zone01', pollMs: 20000 })
  eq(cfg.ok, true, '配置写入成功')
  eq(clamp.getConfig().baseUrl, BASE.replace(/\/+$/, ''), 'baseUrl 已生效')

  console.log('[1] ping（真实 HTTP 探活）')
  {
    const r = await clamp.ping()
    eq(r.ok, true, 'ping 成功（隧道/桩服务可达）')
    ok(r.httpStatus === 200, 'HTTP 200，实际 ' + r.httpStatus)
    ok(r.ms >= 0, '有耗时统计：' + r.ms + ' ms')
  }

  console.log('[2] 病蚕列表 → 视图模型')
  let list = []
  {
    const r = await clamp.listDiseased({ barn: 'barn01', status: 'pending', limit: 50 })
    eq(r.ok, true, '列表成功')
    list = r.data || []
    ok(list.length >= 1, '取到 ' + list.length + ' 条待裁定')
    const t = list[0]
    ok(t.trayId, 'trayId 有值')
    ok(t.display && t.display.indexOf('层') >= 0, 'display 归一化正常：' + t.display)
    ok(t.confText && /%$/.test(t.confText), 'confText 百分比：' + t.confText)
    ok(t.statusTone && t.statusTone.indexOf('badge-') === 0, 'statusTone 自带 badge- 前缀')
    ok(typeof t.canConfirm === 'boolean', 'canConfirm 是布尔值')
    ok(t.timeText && t.timeText !== '--', 'timeText 已格式化：' + t.timeText)
    if (t.env) ok(t.envText.indexOf('越限') >= 0, 'envText 拼好：' + t.envText)
  }

  console.log('[3] 真实错误码（走真实 HTTP，不是桩函数）')
  {
    const savedToken = clamp.getConfig().token
    clamp.setConfig({ token: '' })
    const r401 = await clamp.ping()
    eq(r401.ok, false, '空令牌 → 失败')
    eq(r401.code, 'unauthorized', '空令牌 → unauthorized（401）')
    eq(r401.httpStatus, 401, 'HTTP 状态 401')
    clamp.setConfig({ token: savedToken })

    const bad = await clamp.listDiseased({ barn: 'barn01', status: 'bogus' })
    eq(bad.ok, false, '非法 status → 失败')
    eq(bad.code, 'bad_status', '错误码 bad_status（400）')
    eq(bad.httpStatus, 400, 'HTTP 状态 400')
  }

  console.log('[4] 裁定放行（yes 阻塞到回执）')
  const target = (list.filter((x) => x.canConfirm)[0] || list[0] || {})
  {
    const t0 = Date.now()
    const r = await clamp.confirmDiseased(target.trayId, { barn: 'barn01', decision: 'yes', operator: 'e2e' })
    const cost = Date.now() - t0
    eq(r.ok, true, '裁定成功（' + cost + ' ms）')
    if (r.ok) {
      eq(r.data.status, 'running', 'status=running')
      eq(r.data.decision, 'yes', 'decision=yes')
      ok(r.data.clampTaskId, '拿到夹取任务号：' + r.data.clampTaskId)
      ok(typeof r.data.placed === 'boolean', 'placed 是布尔值：' + r.data.placed)
      ok(r.data.placedText, 'placedText：' + r.data.placedText)
    }
  }

  console.log('[5] 相反裁定 → 409 already_decided')
  {
    const r = await clamp.confirmDiseased(target.trayId, { barn: 'barn01', decision: 'no' })
    eq(r.ok, false, '相反裁定被拒')
    eq(r.code, 'already_decided', '错误码 already_decided')
    eq(r.httpStatus, 409, 'HTTP 409')
  }

  console.log('[6] 夹取作业列表')
  {
    const r = await clamp.listJobs({ barn: 'barn01', status: 'all', limit: 50 })
    eq(r.ok, true, '作业列表成功')
    const jobs = r.data || []
    ok(jobs.length >= 1, '取到 ' + jobs.length + ' 条作业')
    const j = jobs[0]
    ok(j.jobId, 'jobId 有值')
    ok(j.statusText, 'statusText：' + j.statusText)
    ok(typeof j.placed === 'boolean', 'placed 是布尔值')
    ok(j.placedText, 'placedText：' + j.placedText)
    ok(j.durationText, 'durationText：' + j.durationText)
  }

  console.log('[7] 巡检状态（只读）')
  {
    const r = await clamp.patrolStatus({ barn: 'barn01' })
    eq(r.ok, true, 'patrol/status 成功')
    ok(r.data && typeof r.data === 'object', 'data 是对象')
  }

  console.log('[8] refreshAll（页面轮询用的聚合入口）')
  {
    const p = await clamp.refreshAll('barn01')
    ok('diseased' in p && 'jobs' in p, '返回 diseased + jobs')
    ok('state' in p && typeof p.state.lastSyncText === 'string', '带 state.lastSyncText')
    eq(p.ok, true, '聚合结果 ok')
  }

  console.log('[9] 请求日志（我的页面展示的就是它）')
  {
    const log = clamp.getLog(5)
    ok(log.length >= 1, '有 ' + log.length + ' 条日志')
    ok(log[0].method && log[0].url, '日志带 method + url')
  }
}

async function main() {
  if (!EXTERNAL) {
    child = spawn(process.execPath, [path.join(__dirname, 'stub-clamp-server.js'), '--port', String(PORT)], { stdio: 'ignore' })
  }
  const ready = await waitHealthy(EXTERNAL ? 5000 : 8000)
  if (!ready) {
    console.error('服务未就绪：' + BASE)
    if (child) child.kill()
    process.exit(1)
  }

  try {
    await run()
  } catch (e) {
    fail++
    failures.push('异常中断：' + (e && e.message))
  }

  console.log('')
  console.log('─'.repeat(60))
  if (fail === 0) {
    console.log('全链路通过：' + pass + ' / ' + (pass + fail) + ' 项')
  } else {
    console.log('失败 ' + fail + ' 项，通过 ' + pass + ' 项：')
    failures.forEach((f) => console.log('  ✗ ' + f))
  }
  console.log('─'.repeat(60))

  clamp.stopPolling()
  if (child) child.kill()
  process.exit(fail === 0 ? 0 : 1)
}

main()
