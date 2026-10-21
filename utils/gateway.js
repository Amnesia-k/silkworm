/**
 * utils/gateway.js —— 实机对接适配层（预留接口）
 *
 * 现状：App 的全部数据来自 utils/data.js 的本地模拟（演示态）。
 * 目标：现场网关 / 云平台就绪后，在「我的 → 数据源」把模式切成「实机」，
 *       本层就用**同一套语义**去访问真实后端，页面与渲染逻辑一行不改。
 *
 * 三条设计约束：
 *  1. 同一份 API —— 本层每个函数与 data.js / engine.js 的能力一一对应，
 *     映射关系与报文格式见 docs/实机对接接口.md；
 *  2. 零侵入接入 —— 实机数据以「覆盖层」写回 data.js
 *     （data.setLiveStatus / setLiveSeries / …），页面照旧调
 *     data.getStatusSummary() / data.getSeries()，读到的就是实机值；
 *     mode === 'sim' 时覆盖层始终为空，行为与现在完全一致；
 *  3. 可插拔传输 —— 默认 HTTP(S)（wx.request / uni.request）+ WebSocket 推送；
 *     现场若走 MQTT 或硬件网关盒，只需 setTransport() 换一个实现，其余不动。
 *
 * 重要安全约定：
 *  - 实机模式下**控制指令永不回落到本地模拟**（否则现场会看到"下发成功"的假象）；
 *  - 只读接口在实机失败时不写覆盖层，保留上一次的值并把错误记进 getState()，
 *    「我的 → 数据源」卡会显示红字，绝不静默用模拟数据顶替实机数据。
 */
const data = require('./data.js')

/* ------------------------------------------------------------------ */
/* 配置                                                                */
/* ------------------------------------------------------------------ */
const CONFIG_KEY = 'silk_gateway_v1'
const LOG_MAX = 60

const DEFAULT_CONFIG = {
  /** sim＝本地模拟演示；live＝实机后端 */
  mode: 'sim',
  /** 实机后端地址，如 https://api.example.com/v1（不带结尾斜杠） */
  baseUrl: '',
  /** 实时推送地址，如 wss://api.example.com/v1/stream；留空则退化为轮询 */
  wsUrl: '',
  /** Bearer Token（服务端下发，或对接期临时写死） */
  token: '',
  /** 单请求超时（ms，1000 ~ 30000） */
  timeoutMs: 8000,
  /** 失败重试次数（0 ~ 3，仅对网络/超时/5xx 生效，4xx 不重试） */
  retry: 1,
  /** 轮询间隔（ms，无 WebSocket 时的兜底刷新） */
  pollMs: 20000,
  /** 实机对接期锁定蚕房，如 barn01；留空＝跟随当前蚕房 */
  barnKey: '',
}

let CONFIG = null
let STATE = {
  live: false,
  ok: true,
  barnKey: '',
  lastSyncAt: 0,
  lastSyncText: '--',
  lastError: '',
  requests: 0,
}
const LOG = []
const STATE_HANDLERS = []
const LOG_HANDLERS = []

function api() {
  if (typeof wx !== 'undefined' && wx && typeof wx.request === 'function') return wx
  if (typeof uni !== 'undefined' && uni && typeof uni.request === 'function') return uni
  return null
}

function nowLabel() {
  const d = new Date()
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}

function pushLog(entry) {
  const row = Object.assign({ at: Date.now(), clock: nowLabel() }, entry)
  LOG.unshift(row)
  if (LOG.length > LOG_MAX) LOG.pop()
  LOG_HANDLERS.slice().forEach((fn) => {
    try { fn(row) } catch (e) { console.error('[gateway] log handler error', e) }
  })
}

function pushState(patch) {
  STATE = Object.assign({}, STATE, patch)
  STATE_HANDLERS.slice().forEach((fn) => {
    try { fn(getState()) } catch (e) { console.error('[gateway] state handler error', e) }
  })
}

function getConfig() {
  if (CONFIG) return Object.assign({}, CONFIG)
  let saved = null
  const w = api()
  if (w && typeof w.getStorageSync === 'function') {
    try { saved = w.getStorageSync(CONFIG_KEY) } catch (e) { saved = null }
  }
  CONFIG = Object.assign({}, DEFAULT_CONFIG, saved && typeof saved === 'object' ? saved : {})
  return Object.assign({}, CONFIG)
}

/** 校验并保存配置；返回 { ok, message, config } */
function setConfig(patch) {
  const cur = getConfig()
  const next = Object.assign({}, cur, patch || {})
  if (next.mode !== 'sim' && next.mode !== 'live') return { ok: false, message: '模式只能是 sim 或 live' }
  if (next.mode === 'live' && !/^https?:\/\//.test(String(next.baseUrl || ''))) {
    return { ok: false, message: '实机模式需要 http(s):// 开头的后端地址' }
  }
  if (next.baseUrl && !/^https?:\/\//.test(String(next.baseUrl))) return { ok: false, message: '后端地址需以 http(s):// 开头' }
  if (next.wsUrl && !/^wss?:\/\//.test(String(next.wsUrl))) return { ok: false, message: '推送地址需以 ws(s):// 开头' }
  next.baseUrl = String(next.baseUrl || '').replace(/\/+$/, '')
  next.wsUrl = String(next.wsUrl || '').replace(/\/+$/, '')
  next.timeoutMs = clamp(Number(next.timeoutMs) || DEFAULT_CONFIG.timeoutMs, 1000, 30000)
  next.retry = Math.round(clamp(Number(next.retry) || 0, 0, 3))
  next.pollMs = clamp(Number(next.pollMs) || DEFAULT_CONFIG.pollMs, 5000, 300000)
  next.token = String(next.token || '')
  next.barnKey = String(next.barnKey || '')
  CONFIG = next
  const w = api()
  if (w && typeof w.setStorageSync === 'function') {
    try { w.setStorageSync(CONFIG_KEY, next) } catch (e) { console.error('[gateway] 保存配置失败', e) }
  }
  pushLog({ kind: 'config', method: 'LOCAL', url: '-', note: '数据源=' + next.mode + (next.baseUrl ? ' ' + next.baseUrl : '') })
  pushState({ live: next.mode === 'live' })
  if (next.mode !== 'live') {
    data.clearLive()
    stop()
    pushState({ ok: true, lastError: '' })
  }
  return { ok: true, message: '已保存', config: next }
}

function resetConfig() {
  CONFIG = Object.assign({}, DEFAULT_CONFIG)
  const w = api()
  if (w && typeof w.setStorageSync === 'function') {
    try { w.setStorageSync(CONFIG_KEY, CONFIG) } catch (e) { console.error('[gateway] 重置配置失败', e) }
  }
  data.clearLive()
  stop()
  pushState({ live: false, ok: true, lastError: '', lastSyncAt: 0, lastSyncText: '--' })
  return getConfig()
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v) }

function isLive() { return getConfig().mode === 'live' }

/** 实机模式下的目标蚕房：配置里锁定的 → 当前蚕房 */
function resolveBarn(barnKey) {
  const cfg = getConfig()
  if (barnKey) return barnKey
  if (cfg.barnKey) return cfg.barnKey
  const cur = data.getCurrentBarn()
  return cur ? cur.barn : ''
}

function getState() { return Object.assign({}, STATE, { mode: getConfig().mode, baseUrl: getConfig().baseUrl, wsUrl: getConfig().wsUrl }) }
function onState(fn) { if (typeof fn === 'function' && STATE_HANDLERS.indexOf(fn) < 0) STATE_HANDLERS.push(fn) }
function offState(fn) { const i = STATE_HANDLERS.indexOf(fn); if (i >= 0) STATE_HANDLERS.splice(i, 1) }
function getLog(n) { return LOG.slice(0, n || 10) }
function onLog(fn) { if (typeof fn === 'function' && LOG_HANDLERS.indexOf(fn) < 0) LOG_HANDLERS.push(fn) }
function offLog(fn) { const i = LOG_HANDLERS.indexOf(fn); if (i >= 0) LOG_HANDLERS.splice(i, 1) }
function clearLog() { LOG.length = 0 }

/* ------------------------------------------------------------------ */
/* 传输层（可插拔）                                                     */
/* ------------------------------------------------------------------ */
/** 默认 HTTP 传输：{url, method, data, header, timeoutMs} → Promise<{status, body, raw, ms}> */
function httpTransport(o) {
  return new Promise((resolve, reject) => {
    const w = api()
    if (!w || typeof w.request !== 'function') {
      reject({ code: 'NO_API', message: '当前环境不支持 wx.request/uni.request（Node 测试请 setTransport）' })
      return
    }
    const started = Date.now()
    w.request({
      url: o.url,
      method: o.method || 'GET',
      data: o.data,
      header: o.header,
      timeout: o.timeoutMs,
      success: (res) => {
        resolve({ status: res.statusCode || 0, body: res.data, raw: res, ms: Date.now() - started })
      },
      fail: (err) => {
        const msg = (err && (err.errMsg || err.message)) || '网络异常'
        reject({ code: /timeout/i.test(msg) ? 'TIMEOUT' : 'NETWORK', message: msg })
      },
    })
  })
}

let TRANSPORT = httpTransport

/** 现场若走 MQTT / 硬件网关盒：换掉这一层的实现即可，业务函数无需改动 */
function setTransport(fn) { TRANSPORT = typeof fn === 'function' ? fn : httpTransport }
function useDefaultTransport() { TRANSPORT = httpTransport }

function joinUrl(base, path, query) {
  const url = String(base || '').replace(/\/+$/, '') + '/' + String(path || '').replace(/^\/+/, '')
  const qs = []
  if (query) {
    Object.keys(query).forEach((k) => {
      const v = query[k]
      if (v === undefined || v === null || v === '') return
      qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v))
    })
  }
  return qs.length ? url + (url.indexOf('?') >= 0 ? '&' : '?') + qs.join('&') : url
}

function ok(data2, extra) { return Object.assign({ ok: true, code: 'OK', message: '', data: data2, ms: 0 }, extra || {}) }
function fail(code, message, extra) { return Object.assign({ ok: false, code: code, message: message, data: null, ms: 0 }, extra || {}) }

/** 统一报文解析：{ok:true,data:{}} / 裸 JSON 都接受 */
function unwrap(res) {
  const body = res.body
  if (body === undefined || body === null) return fail('ENVELOPE', '后端返回空报文')
  if (typeof body === 'object' && body.ok === false) {
    return fail(body.code || 'REJECTED', body.message || '后端拒绝', { httpStatus: res.status })
  }
  if (res.status < 200 || res.status >= 300) return fail('HTTP_' + res.status, 'HTTP ' + res.status, { httpStatus: res.status })
  const payload = (typeof body === 'object' && body.data !== undefined) ? body.data : body
  return ok(payload, { httpStatus: res.status })
}

/**
 * 发起一次请求（含超时 / 重试 / 统一错误码）。
 * 错误码：NO_CONFIG（未配地址）| TIMEOUT | NETWORK | NO_API | HTTP_4xx/5xx | ENVELOPE | REJECTED
 */
function request(method, path, opts) {
  const o = opts || {}
  const cfg = getConfig()
  if (cfg.mode !== 'live') return Promise.resolve(fail('NOT_LIVE', '当前为模拟模式，未接入实机'))
  if (!cfg.baseUrl) return Promise.resolve(fail('NO_CONFIG', '未配置实机后端地址'))
  const url = joinUrl(cfg.baseUrl, path, o.query)
  const header = { 'content-type': 'application/json' }
  if (cfg.token) header.Authorization = 'Bearer ' + cfg.token
  if (o.idempotencyKey) header['X-Idempotency-Key'] = o.idempotencyKey
  Object.assign(header, o.header || {})
  const timeoutMs = o.timeoutMs || cfg.timeoutMs
  const maxTry = 1 + clamp(o.retry === undefined ? cfg.retry : o.retry, 0, 3)

  const attempt = (n) => {
    pushState({ requests: STATE.requests + 1 })
    return TRANSPORT({ url: url, method: method, data: o.data, header: header, timeoutMs: timeoutMs })
      .then((res) => {
        const out = unwrap(res)
        out.ms = res.ms
        out.url = url
        if (/^HTTP_5/.test(out.code) && n < maxTry) {
          pushLog({ kind: 'retry', method: method, url: url, status: res.status, ok: false, code: out.code, ms: res.ms, note: '第 ' + n + ' 次重试（服务端 ' + res.status + '）' })
          return attempt(n + 1)
        }
        pushLog({ kind: o.kind || 'read', method: method, url: url, status: res.status, ok: out.ok, code: out.code, ms: res.ms })
        return out
      })
      .catch((e) => {
        const code = (e && e.code) || 'NETWORK'
        const message = (e && e.message) || '网络异常'
        const retriable = (code === 'NETWORK' || code === 'TIMEOUT' || code === 'HTTP_5xx')
        if (retriable && n < maxTry) {
          pushLog({ kind: 'retry', method: method, url: url, status: 0, ok: false, code: code, ms: 0, note: '第 ' + n + ' 次重试' })
          return attempt(n + 1)
        }
        pushLog({ kind: o.kind || 'read', method: method, url: url, status: 0, ok: false, code: code, ms: 0 })
        return fail(code, message)
      })
  }
  return attempt(1)
}

/* ------------------------------------------------------------------ */
/* 字段归一化（后端字段名与内部字段名对齐）                              */
/* ------------------------------------------------------------------ */
const ALIAS = {
  ts: ['ts', 'time', 'timestamp', 'at', 'collectAt', 'sampleAt'],
  temp: ['temp', 'temperature', 'tempC', 'tempVal'],
  humi: ['humi', 'humidity', 'rh', 'humiPct', 'humidityPct'],
  outSec: ['outSec', 'outSeconds', 'out_of_range_sec'],
}
function pick(obj, names) {
  for (let i = 0; i < names.length; i++) {
    const v = obj[names[i]]
    if (v !== undefined && v !== null) return v
  }
  return undefined
}

/** 把后端一分钟点归一化成内部点结构；缺目标区间时用本机规格补齐 */
function normalizePoint(raw, range) {
  const ts = Number(pick(raw, ALIAS.ts))
  const temp = Number(pick(raw, ALIAS.temp))
  const humi = Number(pick(raw, ALIAS.humi))
  const tMin = raw.tMin !== undefined ? Number(raw.tMin) : range.tMin
  const tMax = raw.tMax !== undefined ? Number(raw.tMax) : range.tMax
  const hMin = raw.hMin !== undefined ? Number(raw.hMin) : range.hMin
  const hMax = raw.hMax !== undefined ? Number(raw.hMax) : range.hMax
  const outTemp = temp > tMax ? 1 : (temp < tMin ? -1 : 0)
  const outHumi = humi > hMax ? 1 : (humi < hMin ? -1 : 0)
  let outSec = pick(raw, ALIAS.outSec)
  outSec = outSec === undefined ? (outTemp ? 30 : 0) + (outHumi ? 30 : 0) : Number(outSec)
  return {
    ts: ts, temp: temp, humi: humi,
    tMin: tMin, tMax: tMax, hMin: hMin, hMax: hMax,
    outTemp: outTemp, outHumi: outHumi, outSec: outSec,
  }
}

/** 把后端小时聚合行归一化成内部结构（对齐 data.getHourlyAgg 的字段） */
function normalizeHour(raw, range) {
  const ts = Number(pick(raw, ALIAS.ts))
  const tempAvg = Number(raw.tempAvg !== undefined ? raw.tempAvg : raw.temp)
  const tempMax = Number(raw.tempMax !== undefined ? raw.tempMax : tempAvg)
  const tempMin = Number(raw.tempMin !== undefined ? raw.tempMin : tempAvg)
  const humiAvg = Number(raw.humiAvg !== undefined ? raw.humiAvg : raw.humi)
  const humiMax = Number(raw.humiMax !== undefined ? raw.humiMax : humiAvg)
  const humiMin = Number(raw.humiMin !== undefined ? raw.humiMin : humiAvg)
  let outSec = Number(pick(raw, ALIAS.outSec))
  if (!outSec) {
    // 后端未给越限秒数时的兜底口径（与本机模拟一致：单点越限按 30 s 计）
    outSec = (tempMax > range.tMax || tempMin < range.tMin ? 30 : 0) + (humiMax > range.hMax || humiMin < range.hMin ? 30 : 0)
  }
  const samples = Number(raw.samples !== undefined ? raw.samples : (raw.n !== undefined ? raw.n : 1))
  return { ts, tempAvg, tempMax, tempMin, humiAvg, humiMax, humiMin, outSec, samples }
}

/** 实机返回的字段覆盖同名模拟字段，未返回的沿用模拟值（便于字段逐步补齐） */
function merge(base, patch) {
  if (!patch || typeof patch !== 'object') return base
  const out = Object.assign({}, base)
  Object.keys(patch).forEach((k) => {
    if (patch[k] === undefined || patch[k] === null) return
    out[k] = patch[k]
  })
  return out
}

/* ------------------------------------------------------------------ */
/* 业务读接口（与 data.js 能力一一对应）                                 */
/* ------------------------------------------------------------------ */
function syncPreview(barnKey, patch) {
  pushState({ barnKey: barnKey, lastSyncAt: Date.now(), lastSyncText: nowLabel(), ok: true, lastError: '' })
  pushLog({ kind: 'sync', method: 'GET', url: patch || '-', status: 200, ok: true, code: 'OK', ms: 0, note: '同步 ' + barnKey })
}

/** GET /health —— 连通性测试 */
function ping() {
  return request('GET', '/health', { kind: 'ping', retry: 0 })
}

/** GET /barns/{barn}/status —— 工况快照（温度/湿度/模式/在线/目标区间/设备/告警统计） */
function fetchStatus(barnKey) {
  const key = resolveBarn(barnKey)
  if (!isLive()) return Promise.resolve(ok(data.getStatusSummary(key), { code: 'SIM' }))
  if (!key) return Promise.resolve(fail('NO_BARN', '未选择蚕房'))
  const base = data.getStatusSummary(key)
  return request('GET', '/barns/' + key + '/status', { kind: 'status' }).then((r) => {
    if (!r.ok) { pushState({ ok: false, lastError: r.code + ' ' + r.message, live: true }); return r }
    const live = merge(base, r.data)
    live.barn = key
    live.simClock = Number(r.data && (r.data.serverAt || r.data.simClock)) || Date.now()
    live.serverState = (r.data && r.data.serverState) || base.serverState
    data.setLiveStatus(key, live)
    syncPreview(key, r.url)
    return ok(live, { ms: r.ms, code: 'LIVE' })
  })
}

/** GET /barns/{barn}/series?from=&to=&agg=min|hour —— 历史曲线（分钟点 / 小时聚合） */
function fetchSeries(barnKey, from, to, agg) {
  const key = resolveBarn(barnKey)
  const range = data.getTarget(key)
  if (!isLive()) {
    return Promise.resolve(ok(agg === 'hour' ? data.getHourlyAgg(key, from, to) : data.getSeries(key, from, to), { code: 'SIM' }))
  }
  const a = agg === 'hour' ? 'hour' : 'min'
  return request('GET', '/barns/' + key + '/series', { kind: 'series', query: { from: from, to: to, agg: a } }).then((r) => {
    if (!r.ok) { pushState({ ok: false, lastError: r.code + ' ' + r.message, live: true }); return r }
    const rows = (r.data && (r.data.points || r.data.list || r.data)) || []
    const list = Array.isArray(rows) ? rows : []
    if (a === 'hour') {
      const hours = list.map((p) => normalizeHour(p, range))
      data.setLiveHourly(key, from, to, hours)
      syncPreview(key, r.url)
      return ok(hours, { ms: r.ms, code: 'LIVE' })
    }
    const points = list.map((p) => normalizePoint(p, range))
    data.setLiveSeries(key, from, to, points)
    syncPreview(key, r.url)
    return ok(points, { ms: r.ms, code: 'LIVE' })
  })
}

/** GET /barns/{barn}/alarms?status= —— 告警列表 */
function fetchAlarms(barnKey, filter) {
  const key = resolveBarn(barnKey)
  if (!isLive()) return Promise.resolve(ok(data.getAlarms(key, filter), { code: 'SIM' }))
  return request('GET', '/barns/' + key + '/alarms', { kind: 'alarms', query: { status: filter || '' } }).then((r) => {
    if (!r.ok) return r
    const list = (r.data && (r.data.list || r.data)) || []
    data.setLiveAlarms(key, list, filter)
    syncPreview(key, r.url)
    return ok(list, { ms: r.ms, code: 'LIVE' })
  })
}

/** GET /barns/{barn}/devices —— 设备台账与运行摘要 */
function fetchDevices(barnKey) {
  const key = resolveBarn(barnKey)
  if (!isLive()) return Promise.resolve(ok(data.getDeviceSummary(key), { code: 'SIM' }))
  return request('GET', '/barns/' + key + '/devices', { kind: 'devices' }).then((r) => {
    if (!r.ok) return r
    const base = data.getDevices(key)
    const rows = (r.data && (r.data.list || r.data)) || []
    const live = Array.isArray(rows)
      ? rows.map((row) => merge(base.filter((d) => d.id === row.id)[0] || {}, row))
      : base
    data.setLiveDevices(key, live)
    syncPreview(key, r.url)
    return ok(live, { ms: r.ms, code: 'LIVE' })
  })
}

/** GET /barns/{barn}/machines —— 机械化设备（空调/排气扇/投叶漏斗/抓取机/码垛机） */
function fetchMachines(barnKey) {
  const key = resolveBarn(barnKey)
  if (!isLive()) return Promise.resolve(ok(data.getMachines(key), { code: 'SIM' }))
  return request('GET', '/barns/' + key + '/machines', { kind: 'machines' }).then((r) => {
    if (!r.ok) return r
    const base = data.getMachines(key)
    const rows = (r.data && (r.data.list || r.data)) || []
    const live = Array.isArray(rows)
      ? rows.map((row) => merge(base.filter((m) => m.id === row.id)[0] || {}, row))
      : base
    data.setLiveMachines(key, live)
    syncPreview(key, r.url)
    return ok(live, { ms: r.ms, code: 'LIVE' })
  })
}

/** GET /barns/{barn}/config —— 当前生效配置（目标区间 / 控制参数 / 版本） */
function fetchConfig(barnKey) {
  const key = resolveBarn(barnKey)
  if (!isLive()) return Promise.resolve(ok(data.getConfigView(key), { code: 'SIM' }))
  return request('GET', '/barns/' + key + '/config', { kind: 'config' }).then((r) => {
    if (!r.ok) return r
    const base = data.getConfigView(key)
    const live = merge(base, r.data)
    live.range = merge(base.range, (r.data && r.data.range) || {})
    data.setLiveConfig(key, live)
    syncPreview(key, r.url)
    return ok(live, { ms: r.ms, code: 'LIVE' })
  })
}

/** GET /barns/{barn}/report?date=&agg= —— 日报统计 */
function fetchReport(barnKey, dateMs, agg) {
  const key = resolveBarn(barnKey)
  if (!isLive()) return Promise.resolve(ok(data.getDayReport(key, dateMs, agg), { code: 'SIM' }))
  return request('GET', '/barns/' + key + '/report', { kind: 'report', query: { date: dateMs, agg: agg || '' } }).then((r) => {
    if (!r.ok) return r
    const live = merge(data.getDayReport(key, dateMs, agg), (r.data && r.data.summary) || r.data)
    data.setLiveReport(key, dateMs, live)
    syncPreview(key, r.url)
    return ok(live, { ms: r.ms, code: 'LIVE' })
  })
}

/* ------------------------------------------------------------------ */
/* 业务写接口（实机模式绝不回落本地）                                    */
/* ------------------------------------------------------------------ */
let SEQ = 0
function clientId(barnKey) { SEQ += 1; return 'gw-' + barnKey + '-' + Date.now() + '-' + SEQ }

/**
 * POST /barns/{barn}/commands —— 统一控制指令（设备开关 / 改参数 / 机械作业 / 退出手动 / 维护 / 解锁 / 确认告警）
 * payload: { target:'device'|'machine'|'system', id, action, params, tokenId, note }
 */
function command(barnKey, payload) {
  const key = resolveBarn(barnKey)
  const p = payload || {}
  if (!isLive()) {
    return Promise.resolve(ok({ accepted: true, simulated: true, barn: key, cmd: p }, { code: 'SIM', message: '模拟模式：指令由本地引擎执行' }))
  }
  if (!p.tokenId && p.target === 'device' && p.action === 'toggle' && String(p.id || '').indexOf('heat') < 0) {
    // 审批令牌由页面在需要时签发；这里只做提示，不替代后端校验
    pushLog({ kind: 'command', method: 'POST', url: '-', status: 0, ok: false, code: 'NO_TOKEN', ms: 0, note: '未携带审批令牌：' + p.id })
  }
  const body = {
    clientId: clientId(key),
    target: p.target || 'device',
    id: p.id || '',
    action: p.action || '',
    params: p.params || {},
    tokenId: p.tokenId || '',
    note: p.note || '',
    at: Date.now(),
  }
  return request('POST', '/barns/' + key + '/commands', {
    kind: 'command', method: 'POST', data: body, idempotencyKey: body.clientId, retry: 0,
  }).then((r) => {
    if (!r.ok) { pushState({ ok: false, lastError: r.code + ' ' + r.message, live: true }) }
    return r
  })
}

/** POST /barns/{barn}/config —— 下发配置（目标区间 / 控制参数），需管理员令牌 */
function pushConfig(barnKey, patch, note, ver) {
  const key = resolveBarn(barnKey)
  if (!isLive()) return Promise.resolve(ok({ accepted: true, simulated: true, barn: key, patch: patch }, { code: 'SIM' }))
  const body = { ver: ver || '', note: note || '', patch: patch || {}, at: Date.now(), clientId: clientId(key) }
  return request('POST', '/barns/' + key + '/config', {
    kind: 'config', method: 'POST', data: body, idempotencyKey: body.clientId, retry: 0,
  })
}

/** POST /barns/{barn}/commands —— 码垛机作业（人工输入病蚕坐标 → 抓取 → 放传送带） */
function palletJob(barnKey, machineId, payload) {
  const key = resolveBarn(barnKey)
  if (!isLive()) return Promise.resolve(ok({ accepted: true, simulated: true, barn: key, machineId: machineId }, { code: 'SIM' }))
  const body = Object.assign({ machineId: machineId, at: Date.now(), clientId: clientId(key) }, payload || {})
  return request('POST', '/barns/' + key + '/commands', {
    kind: 'job', method: 'POST', data: Object.assign({ target: 'machine', action: 'startJob' }, body),
    idempotencyKey: body.clientId, retry: 0,
  })
}

/** POST /barns/{barn}/tokens —— 签发硬件操作审批令牌 */
function issueToken(barnKey, payload) {
  const key = resolveBarn(barnKey)
  if (!isLive()) return Promise.resolve(ok({ simulated: true }, { code: 'SIM' }))
  return request('POST', '/barns/' + key + '/tokens', { kind: 'token', method: 'POST', data: Object.assign({ at: Date.now() }, payload || {}) })
}

/** POST /barns/{barn}/alarms/{id}/ack —— 确认告警 */
function ackAlarm(barnKey, alarmId, memo) {
  const key = resolveBarn(barnKey)
  if (!isLive()) return Promise.resolve(ok({ simulated: true }, { code: 'SIM' }))
  return request('POST', '/barns/' + key + '/alarms/' + alarmId + '/ack', { kind: 'ack', method: 'POST', data: { memo: memo || '', at: Date.now() } })
}

/* ------------------------------------------------------------------ */
/* 实时推送 / 轮询                                                      */
/* ------------------------------------------------------------------ */
let WS = null
let WS_TRY = 0
let POLL = null
let STARTED_BARN = ''
let SUB_HANDLERS = []

/** 处理一条推送：{type:'status'|'series'|'alarm'|'device'|'machine', barn, data} */
function ingest(msg) {
  if (!msg || !msg.type) return
  const key = resolveBarn(msg.barn)
  if (msg.type === 'status' && msg.data) { data.setLiveStatus(key, merge(data.getStatusSummary(key), msg.data)); syncPreview(key, 'ws://status') }
  else if (msg.type === 'series' && msg.data) {
    const from = msg.from || 0, to = msg.to || Date.now()
    data.setLiveSeries(key, from, to, msg.data.map((p) => normalizePoint(p, data.getTarget(key))))
    syncPreview(key, 'ws://series')
  } else if (msg.type === 'alarm' && msg.data) { data.setLiveAlarms(key, msg.data, msg.filter); syncPreview(key, 'ws://alarm') }
  else if (msg.type === 'device' && msg.data) { data.setLiveDevices(key, msg.data); syncPreview(key, 'ws://device') }
  else if (msg.type === 'machine' && msg.data) { data.setLiveMachines(key, msg.data); syncPreview(key, 'ws://machine') }
  SUB_HANDLERS.slice().forEach((fn) => { try { fn(msg) } catch (e) { console.error('[gateway] sub handler error', e) } })
}

function connectWs(barnKey) {
  const cfg = getConfig()
  const w = api()
  if (!cfg.wsUrl || !w || typeof w.connectSocket !== 'function') return false
  try {
    WS = w.connectSocket({ url: cfg.wsUrl })
    if (!WS) return false
    WS.onOpen(() => {
      WS_TRY = 0
      const hello = { type: 'subscribe', barn: barnKey, token: cfg.token }
      WS.send({ data: JSON.stringify(hello) })
      pushLog({ kind: 'ws', method: 'WS', url: cfg.wsUrl, status: 101, ok: true, code: 'OK', ms: 0, note: '已订阅 ' + barnKey })
    })
    WS.onMessage((res) => {
      let msg = res && res.data
      try { msg = JSON.parse(msg) } catch (e) { msg = null }
      ingest(msg)
    })
    WS.onClose(() => {
      WS = null
      if (!isLive()) return
      WS_TRY += 1
      const delay = Math.min(30000, 2000 * WS_TRY)
      pushLog({ kind: 'ws', method: 'WS', url: cfg.wsUrl, status: 0, ok: false, code: 'CLOSED', ms: 0, note: delay + ' ms 后重连（第 ' + WS_TRY + ' 次）' })
      setTimeout(() => { if (isLive()) connectWs(resolveBarn('')) }, delay)
    })
    WS.onError((e) => {
      pushLog({ kind: 'ws', method: 'WS', url: cfg.wsUrl, status: 0, ok: false, code: 'WS_ERROR', ms: 0, note: (e && e.errMsg) || '推送连接异常' })
    })
    return true
  } catch (e) {
    pushLog({ kind: 'ws', method: 'WS', url: getConfig().wsUrl, status: 0, ok: false, code: 'WS_THROW', ms: 0, note: String(e && e.message) })
    return false
  }
}

/** 拉取一轮全部只读数据（实机模式下由 start() 周期调用） */
function pullAll(barnKey) {
  const key = resolveBarn(barnKey)
  if (!isLive() || !key) return Promise.resolve(fail('NOT_LIVE', '当前为模拟模式'))
  const now = Date.now()
  const one = (fn) => fn.catch(() => fail('NETWORK', '拉取失败'))
  return Promise.all([
    one(fetchStatus(key)),
    one(fetchSeries(key, now - 6 * 3600000, now, 'min')),
    one(fetchAlarms(key)),
    one(fetchDevices(key)),
    one(fetchMachines(key)),
    one(fetchConfig(key)),
  ]).then((rs) => {
    const bad = rs.filter((r) => !r.ok)
    pushState({ live: true, ok: bad.length === 0, lastError: bad.length ? (bad[0].code + ' ' + bad[0].message) : '' })
    return ok({ pulled: rs.length, failed: bad.length, results: rs })
  })
}

function subscribe(fn) { if (typeof fn === 'function' && SUB_HANDLERS.indexOf(fn) < 0) SUB_HANDLERS.push(fn) }
function unsubscribe(fn) { const i = SUB_HANDLERS.indexOf(fn); if (i >= 0) SUB_HANDLERS.splice(i, 1) }

/** 打开实机数据流：有 wsUrl 走推送，否则按 pollMs 轮询 */
function start(barnKey) {
  if (!isLive()) { STARTED_BARN = ''; return false }
  const key = resolveBarn(barnKey)
  if (!key) return false
  // 幂等：onLaunch 与 onShow 都会调用，同一蚕房已在跑则直接返回，避免重复建连/重复轮询
  if (STARTED_BARN === key && (WS || POLL)) return true
  STARTED_BARN = key
  pushState({ live: true, barnKey: key })
  const viaWs = connectWs(key)
  pullAll(key)
  stopPoll()
  if (!viaWs) {
    POLL = setInterval(() => { pullAll(resolveBarn('')) }, getConfig().pollMs)
  }
  pushLog({ kind: 'start', method: viaWs ? 'WS' : 'POLL', url: viaWs ? getConfig().wsUrl : getConfig().baseUrl, status: 0, ok: true, code: 'OK', ms: 0, note: '实机数据流已启动（' + (viaWs ? 'WebSocket 推送' : '轮询 ' + getConfig().pollMs + ' ms') + '）' })
  return true
}

function stopPoll() { if (POLL) { clearInterval(POLL); POLL = null } }

function stop() {
  stopPoll()
  if (WS && typeof WS.close === 'function') { try { WS.close() } catch (e) { /* 忽略关闭异常 */ } }
  WS = null
  STARTED_BARN = ''
  pushState({ live: false })
}

/* ------------------------------------------------------------------ */
module.exports = {
  DEFAULT_CONFIG,
  CONFIG_KEY,
  getConfig,
  setConfig,
  resetConfig,
  isLive,
  resolveBarn,
  getState,
  onState,
  offState,
  getLog,
  onLog,
  offLog,
  clearLog,
  setTransport,
  useDefaultTransport,
  request,
  joinUrl,
  normalizePoint,
  normalizeHour,
  merge,
  ping,
  fetchStatus,
  fetchSeries,
  fetchAlarms,
  fetchDevices,
  fetchMachines,
  fetchConfig,
  fetchReport,
  command,
  pushConfig,
  palletJob,
  issueToken,
  ackAlarm,
  pullAll,
  subscribe,
  unsubscribe,
  ingest,
  start,
  stop,
}
