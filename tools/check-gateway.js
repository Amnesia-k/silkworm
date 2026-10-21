/**
 * tools/check-gateway.js —— 实机对接适配层（utils/gateway.js）桩件测试
 *
 * 用法：node tools/check-gateway.js
 *
 * 用桩 global.wx（内存 storage + 可编程 request/connectSocket）模拟现场后端，
 * 覆盖：配置校验与持久化、模拟/实机切换、请求构建（URL/方法/鉴权头/幂等键）、
 * 统一错误码（HTTP_4xx|5xx、TIMEOUT、ENVELOPE、REJECTED、NO_BARN）、
 * 超时重试次数、字段归一化（time/temperature/humidity → ts/temp/humi）、
 * 覆盖层写回 data.js（页面无感切换）、小时聚合、控制指令、
 * WebSocket 订阅与推送、轮询启停、日志与状态。
 */
const path = require('path')

/* ---------------- 断言 ---------------- */
let pass = 0
let failCount = 0
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label) }
  else { failCount++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')) }
}
function eq(a, b, label) { ok(a === b, label, '期望 ' + JSON.stringify(b) + '，实得 ' + JSON.stringify(a)) }

/* ---------------- wx 桩件 ---------------- */
const store = {}
let HANDLER = () => ({ status: 200, body: { ok: true, data: {} } })
let CALLS = []
const ws = { opened: 0, sent: [], handlers: {}, closed: 0 }

global.wx = {
  getStorageSync: (k) => (k in store ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v },
  removeStorageSync: (k) => { delete store[k] },
  request(o) {
    const rec = { url: o.url, method: o.method, header: o.header, data: o.data, timeout: o.timeout }
    CALLS.push(rec)
    let r
    try { r = HANDLER(rec.url, rec) || {} } catch (e) { r = { throw: e } }
    if (r.throw) { o.fail({ errMsg: 'request:fail ' + r.throw.message }); return }
    if (r.fail) { o.fail(r.fail); return }
    setTimeout(() => o.success({ statusCode: r.status === undefined ? 200 : r.status, data: r.body }), 0)
  },
  connectSocket() {
    ws.opened++
    return {
      onOpen(fn) { ws.handlers.open = fn },
      onMessage(fn) { ws.handlers.message = fn },
      onClose(fn) { ws.handlers.close = fn },
      onError(fn) { ws.handlers.error = fn },
      send(o) { ws.sent.push(o.data) },
      close() { ws.closed++ },
    }
  },
}
function resetCalls() { CALLS = [] }
function callCount() { return CALLS.length }

const data = require(path.join('..', 'utils', 'data.js'))
const gw = require(path.join('..', 'utils', 'gateway.js'))

const BARN = 'barn01'
const FROM = 1791400000000
const TO = FROM + 3600000

async function main() {
  data.setCurrentBarn(BARN)

  /* ================= 1. 默认＝模拟模式，行为与现状一致 ================= */
  console.log('\n[1] 默认模拟模式')
  eq(gw.getConfig().mode, 'sim', '默认 mode === sim')
  eq(gw.isLive(), false, 'isLive() === false')
  const simStatus = await gw.fetchStatus(BARN)
  eq(simStatus.ok, true, '模拟态 fetchStatus 返回 ok')
  eq(simStatus.code, 'SIM', '模拟态结果标记 code === SIM')
  eq(callCount(), 0, '模拟态不产生任何网络请求')
  const notLive = await gw.request('GET', '/x', {})
  eq(notLive.code, 'NOT_LIVE', '模拟态 request 直接返回 NOT_LIVE')
  eq(data.hasLive(), false, '模拟态 data.hasLive() === false')

  /* ================= 2. 配置校验与持久化 ================= */
  console.log('\n[2] 配置校验与持久化')
  eq(gw.setConfig({ mode: 'live' }).ok, false, 'live 模式缺少后端地址被拒绝')
  eq(gw.setConfig({ baseUrl: 'api.example.com' }).ok, false, '非 http(s) 地址被拒绝')
  eq(gw.setConfig({ wsUrl: 'http://x' }).ok, false, '非 ws(s) 推送地址被拒绝')
  const saved = gw.setConfig({ mode: 'live', baseUrl: 'https://api.example.com/v1/', wsUrl: 'wss://api.example.com/v1/stream', token: 'TK-1', timeoutMs: 999999, retry: 9, pollMs: 100 })
  eq(saved.ok, true, '合法配置保存成功')
  eq(saved.config.baseUrl, 'https://api.example.com/v1', '地址去掉结尾斜杠')
  eq(saved.config.timeoutMs, 30000, 'timeoutMs 夹到 30000')
  eq(saved.config.retry, 3, 'retry 夹到 3')
  eq(saved.config.pollMs, 5000, 'pollMs 夹到 5000')
  eq(store['silk_gateway_v1'] && store['silk_gateway_v1'].mode, 'live', '配置已持久化到 storage')
  eq(gw.isLive(), true, 'isLive() === true')

  /* ================= 3. 实机请求构建 ================= */
  console.log('\n[3] 请求构建（URL / 方法 / 鉴权 / 幂等键）')
  gw.setConfig({ baseUrl: 'https://api.example.com/v1', token: 'TK-1', retry: 0, timeoutMs: 8000 })
  HANDLER = () => ({ status: 200, body: { ok: true, data: { temp: 26.5 } } })
  resetCalls()
  const live = await gw.fetchStatus(BARN)
  eq(live.ok, true, '实机 fetchStatus ok')
  eq(live.code, 'LIVE', '实机结果标记 code === LIVE')
  eq(CALLS[0].url, 'https://api.example.com/v1/barns/barn01/status', 'URL 拼接正确（无多余斜杠）')
  eq(CALLS[0].method, 'GET', '方法 GET')
  eq(CALLS[0].header.Authorization, 'Bearer TK-1', '带 Bearer 鉴权头')
  eq(CALLS[0].timeout, 8000, '超时透传给 wx.request')
  eq(live.data.temp, 26.5, '返回实机温度 26.5')

  resetCalls()
  await gw.fetchSeries(BARN, FROM, TO, 'min')
  eq(CALLS[0].url, 'https://api.example.com/v1/barns/barn01/series?from=' + FROM + '&to=' + TO + '&agg=min', '曲线 URL 带 from/to/agg 查询串')

  /* ================= 4. 覆盖层：页面无感读到实机值 ================= */
  console.log('\n[4] 覆盖层（页面不改代码即读到实机值）')
  eq(data.getStatusSummary(BARN).temp, 26.5, 'data.getStatusSummary() 已返回实机温度')
  ok(!!data.getStatusSummary(BARN).instarName, '实机未返回的字段沿用模拟值（merge 语义）：instarName=' + data.getStatusSummary(BARN).instarName)
  eq(data.getStatusSummary(BARN).barn, BARN, '覆盖层对象始终带正确的 barn 标识')
  eq(data.hasLive(), true, 'data.hasLive() === true')

  /* ================= 5. 字段归一化 ================= */
  console.log('\n[5] 字段归一化（后端字段名 → 内部字段名）')
  const range = data.getTarget(BARN)
  const p = gw.normalizePoint({ time: TO, temperature: 30, humidity: 80 }, range)
  eq(p.ts, TO, 'time → ts')
  eq(p.temp, 30, 'temperature → temp')
  eq(p.humi, 80, 'humidity → humi')
  eq(p.outTemp, 1, '超上限自动算 outTemp = 1')
  eq(p.outHumi, 1, '超上限自动算 outHumi = 1')
  eq(p.outSec, 60, '越限秒数累加（温 30 s + 湿 30 s）')
  eq(p.tMin, range.tMin, '缺目标区间时用本机规格补齐')

  resetCalls()
  HANDLER = () => ({ status: 200, body: { points: [{ time: TO - 60000, temperature: 24.2, humidity: 71 }, { time: TO, temperature: 24.4, humidity: 72 }] } })
  const s = await gw.fetchSeries(BARN, FROM, TO, 'min')
  eq(s.data.length, 2, '裸数组/points 两种形状都接受')
  eq(s.data[0].ts, TO - 60000, '曲线点归一化 ts')
  const fromData = data.getSeries(BARN, FROM, TO)
  eq(fromData.length, 2, 'data.getSeries() 命中实机覆盖层')
  eq(fromData[0].temp, 24.2, 'data.getSeries() 返回实机温度点')

  resetCalls()
  HANDLER = () => ({ status: 200, body: { list: [{ time: TO, tempAvg: 25, tempMax: 27, tempMin: 23, humiAvg: 70, humiMax: 73, humiMin: 66, samples: 60 }] } })
  const h = await gw.fetchSeries(BARN, FROM, TO, 'hour')
  eq(h.data[0].tempMax, 27, '小时聚合归一化 tempMax')
  eq(h.data[0].samples, 60, '小时聚合归一化 samples')
  eq(data.getHourlyAgg(BARN, FROM, TO)[0].tempAvg, 25, 'data.getHourlyAgg() 命中实机覆盖层')

  /* ================= 6. 错误码与重试 ================= */
  console.log('\n[6] 统一错误码与重试')
  resetCalls()
  gw.setConfig({ retry: 0 })
  HANDLER = () => ({ status: 200, body: { ok: false, code: 'E_LOCK', message: '设备已锁定' } })
  let r = await gw.fetchStatus(BARN)
  eq(r.ok, false, 'ok:false 信封判为失败')
  eq(r.code, 'E_LOCK', '错误码透传 E_LOCK')
  eq(r.message, '设备已锁定', '错误文案透传')

  resetCalls()
  HANDLER = () => ({ status: 500, body: { message: 'boom' } })
  r = await gw.fetchStatus(BARN)
  eq(r.code, 'HTTP_500', 'HTTP 500 → HTTP_500')
  eq(callCount(), 1, 'retry=0 时只请求 1 次')

  resetCalls()
  gw.setConfig({ retry: 2 })
  r = await gw.fetchStatus(BARN)
  eq(callCount(), 3, 'retry=2 时共请求 3 次')

  resetCalls()
  HANDLER = () => ({ status: 404, body: {} })
  r = await gw.fetchStatus(BARN)
  eq(r.code, 'HTTP_404', 'HTTP 404 → HTTP_404')
  eq(callCount(), 1, '4xx 不重试')

  resetCalls()
  HANDLER = () => ({ fail: { errMsg: 'request:fail timeout' } })
  r = await gw.fetchStatus(BARN)
  eq(r.code, 'TIMEOUT', '超时 → TIMEOUT')
  eq(callCount(), 3, '超时按 retry 重试')

  resetCalls()
  HANDLER = () => ({ status: 200, body: null })
  r = await gw.fetchStatus(BARN)
  eq(r.code, 'ENVELOPE', '空报文 → ENVELOPE')
  eq(gw.getState().ok, false, '失败后 state.ok === false')
  ok(/TIMEOUT|ENVELOPE/.test(gw.getState().lastError), 'lastError 记录最近错误：' + gw.getState().lastError)

  /* ================= 7. 控制指令（实机绝不回落本地） ================= */
  console.log('\n[7] 控制指令与配置下发')
  resetCalls()
  gw.setConfig({ retry: 0 })
  HANDLER = (url) => ({ status: 200, body: { ok: true, data: { accepted: true, url: url } } })
  const cmd = await gw.command(BARN, { target: 'machine', id: 'ac01', action: 'toggle', params: {}, tokenId: 'TK9', note: '现场手动' })
  eq(cmd.ok, true, '指令下发返回 ok')
  eq(CALLS[0].method, 'POST', '指令用 POST')
  eq(CALLS[0].url, 'https://api.example.com/v1/barns/barn01/commands', '指令地址正确')
  eq(CALLS[0].data.target, 'machine', '报文体 target')
  eq(CALLS[0].data.tokenId, 'TK9', '报文体携带审批令牌')
  ok(/^gw-barn01-\d+-\d+$/.test(CALLS[0].data.clientId), '报文体含幂等键 clientId=' + CALLS[0].data.clientId)
  eq(CALLS[0].header['X-Idempotency-Key'], CALLS[0].data.clientId, '幂等键同时进请求头')
  ok(CALLS[0].data.at > 0, '报文体带时间戳')

  const cfgPush = await gw.pushConfig(BARN, { tMin: 24, tMax: 25 }, '现场调整', 'v1.02.0')
  eq(cfgPush.ok, true, '配置下发 ok')
  eq(CALLS[1].url, 'https://api.example.com/v1/barns/barn01/config', '配置下发地址正确')
  eq(CALLS[1].data.patch.tMax, 25, '配置 patch 透传')

  const job = await gw.palletJob(BARN, 'pallet01', { coords: { x: 120, y: 340 }, diseased: 'D02' })
  eq(job.ok, true, '码垛机作业 ok')
  eq(CALLS[2].data.action, 'startJob', '作业报文 action=startJob')
  eq(CALLS[2].data.coords.x, 120, '作业报文携带坐坐标')

  /* ================= 8. 可插拔传输（MQTT / 硬件网关） ================= */
  console.log('\n[8] 可插拔传输')
  resetCalls()
  let seen = null
  gw.setTransport((o) => { seen = o; return Promise.resolve({ status: 200, body: { ok: true, data: { temp: 11 } }, ms: 3 }) })
  const viaMqtt = await gw.fetchStatus(BARN)
  eq(viaMqtt.data.temp, 11, '自定义传输的返回值生效')
  eq(callCount(), 0, '自定义传输下不再走 wx.request')
  ok(seen && seen.url.indexOf('/barns/barn01/status') > 0, '自定义传输收到同一份请求描述')
  gw.useDefaultTransport()

  /* ================= 9. WebSocket 订阅与推送 ================= */
  console.log('\n[9] WebSocket 订阅与推送')
  resetCalls()
  HANDLER = () => ({ status: 200, body: { ok: true, data: {} } })
  gw.setConfig({ wsUrl: 'wss://api.example.com/v1/stream' })
  eq(gw.start(BARN), true, 'start() 建立实机数据流')
  eq(ws.opened, 1, '已调用 connectSocket')
  ws.handlers.open && ws.handlers.open()
  eq(ws.sent.length, 1, '连接后发送订阅报文')
  eq(JSON.parse(ws.sent[0]).type, 'subscribe', '订阅报文 type=subscribe')
  eq(JSON.parse(ws.sent[0]).barn, BARN, '订阅报文带蚕房')
  ws.handlers.message && ws.handlers.message({ data: JSON.stringify({ type: 'status', barn: BARN, data: { temp: 9.9 } }) })
  eq(data.getStatusSummary(BARN).temp, 9.9, '推送的 status 写入覆盖层')
  ws.handlers.message && ws.handlers.message({ data: JSON.stringify({ type: 'alarm', barn: BARN, filter: { status: 'active' }, data: [{ id: 'AL99' }] }) })
  eq(data.getAlarms(BARN, { status: 'active' })[0].id, 'AL99', '推送的 alarm 写入覆盖层')
  ok(ws.handlers.close && ws.handlers.error, '已注册 close/error 回调（断线自动重连）')

  /* ================= 10. 轮询兜底 ================= */
  console.log('\n[10] 无推送地址时退化为轮询')
  gw.stop()
  resetCalls()
  gw.setConfig({ wsUrl: '', pollMs: 5000 })
  eq(gw.start(BARN), true, '无 wsUrl 时 start() 仍返回 true')
  eq(callCount() >= 6, true, 'start() 立即拉取一轮（6 个只读接口）：' + callCount() + ' 次请求')
  gw.stop()

  /* ================= 11. 日志 / 状态 / 回退到模拟 ================= */
  console.log('\n[11] 日志、状态与切回模拟')
  ok(gw.getLog(60).length > 0, '请求日志已记录：' + gw.getLog(1).length + ' 条最新')
  ok(gw.getState().requests > 0, 'getState().requests 累计：' + gw.getState().requests)
  let fired = 0
  const onSt = () => { fired++ }
  gw.onState(onSt)
  gw.setConfig({ mode: 'sim' })
  ok(fired > 0, '配置变更触发 onState 回调')
  eq(data.hasLive(), false, '切回模拟后覆盖层被清空')
  eq(data.getStatusSummary(BARN).temp, simStatus.data.temp, '切回模拟后数据恢复本地模拟值')
  const simCmd = await gw.command(BARN, { target: 'device', id: 'heat01', action: 'toggle' })
  eq(simCmd.code, 'SIM', '模拟态指令标记 SIM（不产生网络请求）')

  const backToLive = gw.setConfig({ mode: 'live', baseUrl: 'https://api.example.com/v1' })
  eq(backToLive.ok, true, '再次切回实机模式成功')
  gw.resetConfig()
  eq(gw.getConfig().mode, 'sim', 'resetConfig 回到模拟模式')
  eq(gw.getConfig().baseUrl, '', 'resetConfig 清空地址')
  eq(data.hasLive(), false, 'resetConfig 清空覆盖层')

  /* ================= 汇总 ================= */
  console.log('\n============================================')
  console.log('通过 ' + pass + ' / 失败 ' + failCount)
  console.log('============================================')
  process.exit(failCount ? 1 : 0)
}

main().catch((e) => {
  console.error('[check-gateway] 未捕获异常', e)
  process.exit(1)
})
