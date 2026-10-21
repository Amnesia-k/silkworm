/**
 * tools/check-clamp.js —— utils/clamp.js 桩件测试
 *
 * 本机没有后端、没有真机，所以用桩件模拟 wx.request 的响应，验证：
 *   ① 配置读写与校验（地址格式、轮询间隔、裁定超时下限）
 *   ② 请求构造（URL / 头 / 体 / 超时 / 幂等键 / 重试策略）
 *   ③ 信封与错误码解包（ok:true / ok:false / 401 / 404 / 409 / 422 / 5xx）
 *   ④ 视图归一化（病蚕记录、夹取作业、canConfirm 判据）
 *   ⑤ 轮询订阅（页面不各自起定时器）
 *
 * 运行：node tools/check-clamp.js
 */
'use strict'

const path = require('path')
const ROOT = path.join(__dirname, '..')

/* ---------------- wx 桩件 ---------------- */
let CALLS = []
let RESP = []
const STORE = {}

global.wx = {
  request(opts) {
    CALLS.push({
      url: opts.url,
      method: opts.method,
      header: opts.header,
      data: opts.data,
      timeout: opts.timeout,
    })
    const next = RESP.length ? RESP.shift() : { statusCode: 500, data: { ok: false, error: { code: 'no_more_stub', message: '桩件响应已用尽' } } }
    setTimeout(() => {
      if (next.errMsg) {
        opts.fail({ errMsg: next.errMsg })
        return
      }
      opts.success({ statusCode: next.statusCode, data: next.data })
    }, 1)
  },
  getStorageSync(k) { return STORE[k] === undefined ? '' : STORE[k] },
  setStorageSync(k, v) { STORE[k] = v },
  showToast() {},
  showModal() {},
  showLoading() {},
  hideLoading() {},
}

const data = require(path.join(ROOT, 'utils/data.js'))
const clamp = require(path.join(ROOT, 'utils/clamp.js'))

/* ---------------- 断言工具 ---------------- */
let pass = 0
const fails = []
function ok(cond, label) {
  if (cond) { pass += 1; return }
  fails.push(label)
  console.log('  ✗ ' + label)
}
function eq(actual, expect, label) {
  ok(actual === expect, label + '（期望 ' + JSON.stringify(expect) + '，实际 ' + JSON.stringify(actual) + '）')
}
function lastCall() { return CALLS[CALLS.length - 1] }
function reset(resps) { CALLS = []; RESP = (resps || []).slice() }

function envelope(items, total) {
  return { statusCode: 200, data: { ok: true, data: items, total: total === undefined ? (items || []).length : total } }
}

/* ---------------- 测试用例 ---------------- */
async function main() {
  data.setCurrentBarn('barn01')

  console.log('\n[1] 配置读写与校验')
  const def = clamp.resetConfig()
  eq(def.baseUrl, 'http://10.66.66.1/api', '默认基址')
  eq(def.token, 'test', '默认令牌')
  eq(def.zone, 'zone01', '默认 zone')
  eq(def.pollMs, 20000, '默认轮询 20 s')
  eq(def.confirmTimeoutMs, 35000, '默认裁定超时 35 s（交付单要求 ≥30 s）')

  eq(clamp.setConfig({ baseUrl: 'ftp://x' }).ok, false, '非 http(s) 地址被拒')
  const c2 = clamp.setConfig({ baseUrl: 'http://10.66.66.1/api/', pollMs: 1000, confirmTimeoutMs: 1000 })
  eq(c2.ok, true, '合法地址可保存')
  eq(c2.config.baseUrl, 'http://10.66.66.1/api', '基址去掉尾部斜杠')
  eq(c2.config.pollMs, 5000, '轮询间隔下限 5 s')
  eq(c2.config.confirmTimeoutMs, 30000, '裁定超时下限 30 s')

  console.log('\n[2] URL 拼接')
  eq(clamp.joinUrl('http://h/api/', '/barns/barn01/diseased', { status: 'pending', limit: 0, empty: '', n: null }),
    'http://h/api/barns/barn01/diseased?status=pending&limit=0', '单斜杠 + 跳过空参数')

  console.log('\n[3] 病蚕列表（成功）')
  const now = Date.now()
  reset([envelope([{
    trayId: 'T-100', at: now - 65000, layer: 1, row: 1, col: 2,
    display: '第 1 层 · 第 1 排 · 第 2 列', conf: 0.93, level: 'info',
    status: 'pending', clampStatus: 'none', grade: 'auto',
    canConfirm: true, causeText: '疑似脓病', subHits: [1, 2],
    env: { t: 24.6, h: 72, tMin: 23, tMax: 26, hMin: 65, hMax: 80, outSec: 0 },
    images: ['http://10.66.66.1/images/a.jpg'],
  }], 1)])
  const r1 = await clamp.listDiseased({ status: 'pending', limit: 10 })
  eq(r1.ok, true, '列表请求成功')
  eq(r1.data.length, 1, '一条记录')
  const d1 = r1.data[0]
  eq(d1.id, 'T-100', 'id 取 trayId')
  eq(d1.display, '第 1 层 · 第 1 排 · 第 2 列', '优先用后端 display')
  eq(d1.confText, '93%', '置信度百分比')
  eq(d1.canConfirm, true, 'canConfirm 透传')
  eq(Array.isArray(d1.images) && d1.images[0].indexOf('http://') === 0, true, '图片是绝对 URL')
  eq(!!d1.envText, true, '环境行文本非空')
  const c = lastCall()
  eq(c.url, 'http://10.66.66.1/api/barns/barn01/diseased?status=pending&limit=10&zone=zone01', '列表 URL')
  eq(c.header.Authorization, 'Bearer test', 'Bearer 头')
  eq(c.method, 'GET', '方法 GET')
  eq(c.timeout, 12000, 'GET 用普通超时')

  console.log('\n[4] 错误码解包与重试策略')
  reset([{ statusCode: 400, data: { ok: false, error: { code: 'bad_status', message: 'status 只能是 pending/done/all' } } }])
  const r4 = await clamp.listDiseased({ status: 'x' })
  eq(r4.ok, false, '400 判失败')
  eq(r4.code, 'bad_status', '保留服务端错误码')
  eq(r4.message.indexOf('pending') >= 0, true, '保留服务端提示')

  reset([{ statusCode: 401, data: { ok: false, error: { code: 'unauthorized', message: '' } } }])
  const r5 = await clamp.listDiseased({ status: 'pending' })
  eq(r5.code, 'unauthorized', '401 → unauthorized')
  eq(CALLS.length, 1, '401 不重试')

  reset([{ statusCode: 500, data: null }, { statusCode: 500, data: null }])
  const r6 = await clamp.listDiseased({ status: 'pending' })
  eq(r6.code, 'HTTP_500', '5xx 最终失败')
  eq(CALLS.length, 2, '5xx 重试 1 次（共 2 次请求）')

  reset([{ errMsg: 'request:fail timeout' }, { errMsg: 'request:fail timeout' }])
  const r7 = await clamp.listDiseased({ status: 'pending' })
  eq(r7.code, 'TIMEOUT', '超时归一为 TIMEOUT')
  eq(CALLS.length, 2, '网络错误 GET 重试 1 次')

  reset([{ statusCode: 200, data: { ok: false } }, { statusCode: 200, data: { ok: false } }])
  const r8 = await clamp.listDiseased({ status: 'pending' })
  eq(r8.code, 'service_unavailable', 'ok:false 无 error → service_unavailable')
  eq(CALLS.length, 2, 'service_unavailable 属 5xx 类，重试 1 次')

  console.log('\n[5] 人工裁定（POST）')
  clamp.setConfig({ confirmTimeoutMs: 35000 })
  reset([envelope({
    trayId: 'T-100', status: 'done', decision: 'yes', operator: '管理员', at: Date.now(),
    clampTaskId: 'CT-9', placed: true, forwardedToAlertCenter: true, forwardedRaw: 'raw',
  })])
  const r9 = await clamp.confirmDiseased('T-100', { decision: 'yes', operator: '管理员' })
  eq(r9.ok, true, '裁定成功')
  eq(r9.data.clampTaskId, 'CT-9', '返回夹取任务号')
  eq(r9.data.placedText, '已放到位', 'placed=true 的文案')
  const c9 = lastCall()
  eq(c9.method, 'POST', '裁定用 POST')
  eq(c9.url, 'http://10.66.66.1/api/barns/barn01/diseased/T-100/confirm?zone=zone01', '裁定 URL')
  eq(c9.data.decision, 'yes', '请求体 decision')
  eq(c9.data.operator, '管理员', '请求体 operator')
  eq(typeof c9.data.at === 'number' && c9.data.at > 0, true, '请求体 at 是毫秒时间戳')
  eq(/^clamp-barn01-T-100-/.test(c9.header['X-Idempotency-Key']), true, '带幂等键')
  eq(c9.timeout, 35000, '裁定超时 35 s')

  reset([{ statusCode: 409, data: { ok: false, error: { code: 'already_decided', message: '已裁定' } } }])
  const r10 = await clamp.confirmDiseased('T-100', { decision: 'no' })
  eq(r10.code, 'already_decided', '409 → already_decided')
  eq(CALLS.length, 1, 'POST 不重试')

  reset([{ errMsg: 'request:fail network' }])
  const r11 = await clamp.confirmDiseased('T-101', { decision: 'yes' })
  eq(r11.code, 'NETWORK', '网络失败归一为 NETWORK')
  eq(CALLS.length, 1, '裁定失败不重试（避免重复下发）')

  reset([envelope({ trayId: 'T-102', status: 'done', decision: 'yes', placed: false }, 1)])
  const r12 = await clamp.confirmDiseased('T-102', { decision: 'yes' })
  eq(r12.data.placed, false, 'placed=false')
  eq(r12.data.placedText, '已下发，尚未放到位', '未放到位时的文案')

  console.log('\n[6] 夹取作业列表')
  reset([envelope([
    { id: 'J-1', trayId: 'T-100', layer: 2, row: 1, col: 3, source: 'confirmed', status: 'moving', placed: false, startedAt: now - 20000, finishedAt: 0 },
    { id: 'J-2', trayId: 'T-101', layer: 1, row: 1, col: 1, display: '第 1 层 · 第 1 排 · 第 1 列', source: 'auto', status: 'placed', placed: true, startedAt: now - 90000, finishedAt: now - 30000 },
  ], 2)])
  const r13 = await clamp.listJobs({ status: 'all', limit: 20 })
  eq(r13.ok, true, '作业列表成功')
  eq(r13.data.length, 2, '两条作业')
  eq(r13.data[0].statusText, '搬运中', 'moving 中文')
  eq(r13.data[0].display, '第 2 层 · 第 1 排 · 第 3 列', '无 display 时按坐标拼')
  eq(r13.data[1].placedText, '已放到位', 'placed 文案')
  eq(!!r13.data[1].durationText, true, '已完成作业有用时')
  eq(lastCall().url.indexOf('/clamp/jobs?status=all&limit=20') > 0, true, '作业 URL')

  reset([envelope([], 0)])
  const r14 = await clamp.listJobs()
  eq(r14.ok, true, '空列表也算成功')
  eq(r14.data.length, 0, '空列表长度为 0')

  console.log('\n[7] 视图归一化')
  const n1 = clamp.normalizeDiseased({ trayId: 'X1', status: 'pending', level: 'warn', images: [] })
  eq(n1.canConfirm, false, 'level=warn 时不可裁定')
  eq(n1.display, '坐标未提供', '缺坐标时的文案')
  const n2 = clamp.normalizeDiseased({ trayId: 'X2', status: 'done', level: 'info' })
  eq(n2.canConfirm, false, 'status=done 时不可裁定')
  eq(n2.done, true, 'done 标记')
  const n3 = clamp.normalizeDiseased({ trayId: 'X3', status: 'pending', level: 'info', clampStatus: 'placed' })
  eq(n3.canConfirm, true, 'pending+info 可裁定（按钮唯一判据）')
  eq(n3.clampText, '已放到位', 'clampStatus=placed 文案')
  eq(n3.statusTone, 'badge-orange', '状态色带 badge- 前缀（与全局样式一致）')
  eq(n3.clampTone, 'badge-green', '夹取状态色')
  const n4 = clamp.normalizeJob({ id: 'J9', status: 'failed', placed: false, reason: '夹爪未闭合' })
  eq(n4.statusText, '失败', 'failed 中文')
  eq(n4.reason, '夹爪未闭合', '保留原因')

  console.log('\n[8] 轮询订阅（页面不各自起定时器）')
  reset([envelope([{ trayId: 'T-A', status: 'pending', level: 'info' }], 1), envelope([{ id: 'J-A', status: 'placed', placed: true }], 1)])
  const got = []
  const fn = (p) => got.push(p)
  clamp.startPolling('barn01', fn)
  await new Promise((r) => setTimeout(r, 60))
  eq(got.length, 1, '订阅者立刻收到一次广播')
  eq(got[0].diseased.length, 1, '广播带病蚕列表')
  eq(got[0].jobs.length, 1, '广播带作业列表')
  eq(CALLS.length, 2, '一次刷新 = 2 个请求（列表 + 作业）')

  reset([envelope([], 0), envelope([], 0)])
  clamp.startPolling('barn01', fn)
  await new Promise((r) => setTimeout(r, 60))
  eq(got.length, 2, '同一个 fn 重复订阅只记一次')

  clamp.stopPolling(fn)
  reset([envelope([], 0), envelope([], 0)])
  await clamp.refreshAll('barn01')
  eq(got.length, 2, '退订后不再收到广播')

  reset([envelope([], 0), envelope([], 0)])
  clamp.startPolling('barn01', fn)
  await new Promise((r) => setTimeout(r, 60))
  clamp.stopPolling()
  reset([envelope([], 0), envelope([], 0)])
  await clamp.refreshAll('barn01')
  eq(got.length, 3, 'stopPolling() 清空全部订阅者')

  console.log('\n[9] 状态与日志')
  const st = clamp.getState()
  eq(st.requests > 0, true, '请求计数递增')
  eq(typeof st.lastSyncText === 'string', true, '最近同步时间文本')
  const log = clamp.getLog(3)
  eq(log.length === 3, true, '日志最多返回 3 条')
  eq(typeof log[0].method === 'string', true, '日志含方法')
  clamp.clearLog()
  eq(clamp.getLog(3).length, 0, 'clearLog 清空')

  console.log('\n[10] 连通性测试')
  reset([envelope([], 0)])
  const r15 = await clamp.ping()
  eq(r15.ok, true, 'ping 成功')
  eq(lastCall().url.indexOf('limit=1') > 0, true, 'ping 用最小请求')

  /* ---------------- 汇总 ---------------- */
  const total = pass + fails.length
  console.log('\n' + '─'.repeat(58))
  if (fails.length) {
    console.log('失败 ' + fails.length + ' / ' + total + ' 项：')
    fails.forEach((f, i) => console.log('  ' + (i + 1) + '. ' + f))
  } else {
    console.log('全部通过：' + pass + ' / ' + total + ' 项')
  }
  console.log('HTTP 桩件共 ' + CALLS.length + ' 次调用（最后一次：' + (lastCall() ? lastCall().method + ' ' + lastCall().url : '无') + '）')

  // 清理定时器，避免进程挂住
  clamp.stopPolling()
  process.exit(fails.length ? 1 : 0)
}

main().catch((e) => {
  console.error('测试异常：', e && e.stack ? e.stack : e)
  process.exit(1)
})
