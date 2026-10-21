/**
 * tools/check-stub.js —— 桩服务自测（零依赖）
 *
 * 自己拉一个 tools/stub-clamp-server.js 起来，按交付单 v1.0 的口径逐条打接口，
 * 跑完自动关掉。用来验证「联通性 + 信封 + 错误码 + canConfirm + placed」这套约定。
 *
 *   node tools/check-stub.js
 *   node tools/check-stub.js --url http://127.0.0.1:8787/api    # 测一个已在跑的服务
 */

'use strict'

const http = require('http')
const path = require('path')
const { spawn } = require('child_process')

const argUrl = (() => {
  const i = process.argv.indexOf('--url')
  return i >= 0 ? process.argv[i + 1] : null
})()

const PORT = 8899
let BASE = argUrl || ('http://127.0.0.1:' + PORT + '/api')
let child = null

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
/* HTTP 小工具                                                         */
/* ------------------------------------------------------------------ */
function req(method, url, opts) {
  const o = opts || {}
  const u = new URL(url)
  const body = o.body === undefined ? null : JSON.stringify(o.body)
  const headers = { 'content-type': 'application/json' }
  if (o.auth !== false) headers.authorization = 'Bearer ' + (o.token || 'test')
  if (o.idempotencyKey) headers['x-idempotency-key'] = o.idempotencyKey
  if (body) headers['content-length'] = Buffer.byteLength(body)

  return new Promise((resolve) => {
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: method, headers: headers, timeout: 40000,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        const ct = String(res.headers['content-type'] || '')
        let json = null
        if (ct.indexOf('json') >= 0) { try { json = JSON.parse(buf.toString('utf8')) } catch (e) { json = null } }
        resolve({ status: res.statusCode, json: json, headers: res.headers, buf: buf })
      })
    })
    r.on('error', (e) => resolve({ status: 0, json: null, error: e.message, headers: {}, buf: Buffer.alloc(0) }))
    r.on('timeout', () => { r.destroy(); resolve({ status: 0, json: null, error: 'timeout', headers: {}, buf: Buffer.alloc(0) }) })
    if (body) r.write(body)
    r.end()
  })
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

async function waitReady(maxMs) {
  const deadline = Date.now() + (maxMs || 8000)
  while (Date.now() < deadline) {
    const r = await req('GET', BASE + '/health')
    if (r.status === 200 && r.json && r.json.ok) return true
    await sleep(120)
  }
  return false
}

const TRY_BARN = 'barn01'

/* ------------------------------------------------------------------ */
/* 断言                                                                */
/* ------------------------------------------------------------------ */
async function run() {
  console.log('')
  console.log('[1] 鉴权')
  {
    const r = await req('GET', BASE + '/barns/' + TRY_BARN + '/diseased', { auth: false })
    eq(r.status, 401, '缺 Authorization 应 401')
    eq(r.json && r.json.ok, false, '信封 ok=false')
    eq(r.json && r.json.error && r.json.error.code, 'unauthorized', '错误码 unauthorized')
  }

  console.log('[2] 病蚕列表（成功 + 派生字段）')
  let pendingList = []
  {
    const r = await req('GET', BASE + '/barns/' + TRY_BARN + '/diseased?status=pending&limit=50&zone=zone01')
    eq(r.status, 200, '状态 200')
    eq(r.json && r.json.ok, true, '信封 ok=true')
    ok(Array.isArray(r.json && r.json.data), 'data 是数组')
    pendingList = (r.json && r.json.data) || []
    eq(pendingList.length, 3, 'pending 有 3 条')
    const t = pendingList[0] || {}
    ok(t.trayId, '有 trayId')
    ok(typeof t.at === 'number' && t.at > 1e12, 'at 是 UTC 毫秒整数')
    ok(t.display && t.display.indexOf('层') >= 0, 'display 已给（第 n 层 · 第 m 排 · 第 k 列）')
    eq(t.canConfirm, true, 'info + pending → canConfirm true')
    ok(Array.isArray(t.images) && /^http:\/\//.test(t.images[0]), 'images 是绝对 URL')
    ok(t.env && typeof t.env.outSec === 'number', 'env 带 outSec')
    const warn = pendingList.filter((x) => x.level === 'warn')[0]
    ok(warn, '有一条 warn 级记录')
    eq(warn && warn.canConfirm, false, 'warn 级 canConfirm false（按钮不出现）')
  }

  console.log('[3] 参数校验')
  {
    const a = await req('GET', BASE + '/barns/' + TRY_BARN + '/diseased?status=bogus')
    eq(a.status, 400, '非法 status 应 400')
    eq(a.json && a.json.error && a.json.error.code, 'bad_status', '错误码 bad_status')

    const b = await req('GET', BASE + '/barns/' + TRY_BARN + '/diseased?status=pending&limit=0')
    eq(b.status, 422, 'limit=0 应 422（不是 400）')

    const c = await req('GET', BASE + '/barns/' + TRY_BARN + '/diseased?status=pending&limit=501')
    eq(c.status, 422, 'limit=501 应 422')
  }

  console.log('[4] 人工裁定')
  const trayYes = (pendingList[0] || {}).trayId
  const trayNo = (pendingList[1] || {}).trayId
  {
    const a = await req('POST', BASE + '/barns/' + TRY_BARN + '/diseased/' + trayYes + '/confirm?zone=zone01',
      { body: { decision: 'maybe' } })
    eq(a.status, 400, '非法裁定应 400')
    eq(a.json && a.json.error && a.json.error.code, 'bad_decision', '错误码 bad_decision')

    const b = await req('POST', BASE + '/barns/' + TRY_BARN + '/diseased/NO-SUCH-TRAY/confirm?zone=zone01',
      { body: { decision: 'yes' } })
    eq(b.status, 404, '不存在的盘应 404')
    eq(b.json && b.json.error && b.json.error.code, 'tray_not_found', '错误码 tray_not_found')

    // yes：阻塞到阶段回执（桩里 1.2 s）
    const t0 = Date.now()
    const c = await req('POST', BASE + '/barns/' + TRY_BARN + '/diseased/' + trayYes + '/confirm?zone=zone01',
      { body: { decision: 'yes', operator: 'operator', at: Date.now() }, idempotencyKey: 'k-' + Date.now() })
    const cost = Date.now() - t0
    eq(c.status, 200, 'yes 裁定 200')
    eq(c.json && c.json.data && c.json.data.status, 'running', 'status 变 running')
    eq(c.json && c.json.data && c.json.data.decision, 'yes', 'decision=yes')
    ok(c.json && c.json.data && c.json.data.clampTaskId, 'clampTaskId 有值')
    eq(c.json && c.json.data && c.json.data.placed, true, 'placed=true（有阶段回执才为真）')
    ok(cost >= 1000, 'yes 阻塞到回执（实测 ' + cost + ' ms）')

    // 相同裁定重复提交：幂等，不再新建作业
    const d = await req('POST', BASE + '/barns/' + TRY_BARN + '/diseased/' + trayYes + '/confirm?zone=zone01',
      { body: { decision: 'yes' } })
    eq(d.status, 200, '相同裁定重复提交仍是 200（幂等）')
    eq(d.json && d.json.data && d.json.data.clampTaskId, c.json.data.clampTaskId, '幂等返回同一个夹取任务')

    // 不同裁定 → 409 already_decided
    const e = await req('POST', BASE + '/barns/' + TRY_BARN + '/diseased/' + trayYes + '/confirm?zone=zone01',
      { body: { decision: 'no' } })
    eq(e.status, 409, '改成相反裁定应 409')
    eq(e.json && e.json.error && e.json.error.code, 'already_decided', '错误码 already_decided')
    eq(e.json && e.json.conflict, true, 'body 带 conflict:true')

    // no：仅本轮忽略
    const f = await req('POST', BASE + '/barns/' + TRY_BARN + '/diseased/' + trayNo + '/confirm?zone=zone01',
      { body: { decision: 'no' } })
    eq(f.status, 200, 'no 裁定 200')
    eq(f.json && f.json.data && f.json.data.status, 'ignored', 'status 变 ignored')
    eq(f.json && f.json.data && f.json.data.placed, false, 'no 不会放到位')
  }

  console.log('[5] 夹取作业')
  {
    const r = await req('GET', BASE + '/barns/' + TRY_BARN + '/clamp/jobs?status=all&limit=50&zone=zone01')
    eq(r.status, 200, '作业列表 200')
    const list = (r.json && r.json.data) || []
    ok(list.length >= 2, '至少有 2 条作业（含刚下发的一条）')
    const placed = list.filter((j) => j.placed === true)
    ok(placed.length >= 1, '存在 placed=true 的作业')
    ok(list[0].jobId && list[0].id === list[0].jobId, 'id 与 jobId 相同')
    ok(['auto', 'confirmed'].indexOf(list[0].source) >= 0, 'source ∈ auto/confirmed')

    const a = await req('GET', BASE + '/barns/' + TRY_BARN + '/clamp/jobs?status=running')
    eq(a.status, 200, 'running 过滤 200')
    ok((a.json.data || []).every((j) => j.placed !== true), 'running 里没有已完成的作业')

    const b = await req('GET', BASE + '/barns/' + TRY_BARN + '/clamp/jobs?status=done')
    ok((b.json.data || []).every((j) => ['placed', 'failed', 'ignored', 'cancelled'].indexOf(j.status) >= 0), 'done 里都是终态')
  }

  console.log('[6] 巡检状态（只读）')
  {
    const r = await req('GET', BASE + '/barns/' + TRY_BARN + '/patrol/status')
    eq(r.status, 200, 'patrol/status 200')
    ok(r.json && r.json.data && 'mqtt_ready' in r.json.data, '带 mqtt_ready')
  }

  console.log('[7] 图片是绝对 URL，可直接取')
  {
    const r = await req('GET', BASE + '/barns/' + TRY_BARN + '/diseased?status=done&limit=10')
    const withImg = ((r.json && r.json.data) || []).filter((t) => t.images && t.images.length)[0]
    ok(withImg, '有带图的记录')
    if (withImg) {
      const img = await req('GET', withImg.images[0])
      eq(img.status, 200, '图片 200')
      ok(String(img.headers['content-type'] || '').indexOf('image/png') >= 0, 'content-type 是 image/png')
      ok(Buffer.isBuffer(img.buf) && img.buf.length > 100, '图片有内容（' + img.buf.length + ' B）')
    }
  }

  console.log('[8] 未实现的路径')
  {
    const r = await req('GET', BASE + '/barns/' + TRY_BARN + '/nope')
    eq(r.status, 404, '未知路径 404')
  }
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */
async function main() {
  if (!argUrl) {
    const stub = path.join(__dirname, 'stub-clamp-server.js')
    child = spawn(process.execPath, [stub, '--port', String(PORT)], { stdio: 'ignore' })
    const ready = await waitReady(8000)
    if (!ready) {
      console.error('桩服务没起来（端口 ' + PORT + ' 可能被占用），可换端口或用 --url 指向已在跑的服务')
      process.exit(1)
    }
    BASE = 'http://127.0.0.1:' + PORT + '/api'
  } else {
    const ready = await waitReady(4000)
    if (!ready) {
      console.error('目标服务未就绪：' + BASE)
      process.exit(1)
    }
  }

  console.log('  目标：' + BASE)
  await run()

  console.log('')
  console.log('─'.repeat(60))
  if (fail === 0) {
    console.log('全部通过：' + pass + ' / ' + (pass + fail) + ' 项')
  } else {
    console.log('失败 ' + fail + ' 项，通过 ' + pass + ' 项：')
    failures.forEach((f) => console.log('  ✗ ' + f))
  }
  console.log('─'.repeat(60))

  if (child) child.kill()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  if (child) child.kill()
  console.error('自测异常：', e)
  process.exit(1)
})
