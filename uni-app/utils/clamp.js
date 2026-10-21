/**
 * utils/clamp.js —— 病蚕识别 / 人工裁定 / 夹取作业 接口客户端
 *
 * 对接依据：20_前端交付单（安卓App接口与传参）.md（v1.0）
 *   GET  {base}/barns/{barn}/diseased?status=pending|done|all&limit=1..500&zone=
 *   POST {base}/barns/{barn}/diseased/{trayId}/confirm?zone=
 *   GET  {base}/barns/{barn}/clamp/jobs?status=all|running|done&limit=1..500&zone=
 *   GET  {base}/barns/{barn}/patrol/status        （可选，仅展示，不下发）
 *
 * 约定（与交付单一致）：
 *  - 鉴权：`Authorization: Bearer <token>`，服务端只校验非空；
 *  - 时间：全部为 UTC 毫秒整数；
 *  - 信封：成功 {ok:true,data,total}；失败 {ok:false,error:{code,message}}；
 *  - 后端**没有推送**：页面 onShow 立即拉取 + 前台按 pollMs（默认 20 s）轮询；
 *  - confirm 的 yes 会阻塞到阶段回执（最坏约 19 s），因此该请求超时 ≥ 30 s；
 *  - 401 不重试、4xx 不重试、5xx/网络异常退避重试 1 次；
 *  - 只有 `placed === true` 才代表真的夹取放到位；`canConfirm` 是裁定按钮的唯一判据。
 */
import * as data from './data.js'

const CONFIG_KEY = 'silk_clamp_v1'
const LOG_MAX = 40

const DEFAULT_CONFIG = {
  /** 后端根地址（含 /api），默认按交付单的隧道地址 */
  baseUrl: 'http://10.66.66.1/api',
  /** 访问令牌：服务端只校验非空，默认填 test */
  token: 'test',
  /** 区域编号 */
  zone: 'zone01',
  /** 蚕房：留空＝跟随当前选中的蚕房 */
  barn: '',
  /** 列表轮询间隔（ms） */
  pollMs: 20000,
  /** 普通请求超时（ms） */
  timeoutMs: 12000,
  /** 裁定（confirm）请求超时（ms）：必须 ≥ 30000 */
  confirmTimeoutMs: 35000,
}

/** 服务端错误码 → 现场可读文案（保留原始 code 供排查） */
const ERROR_TEXT = {
  bad_status: '查询状态参数不合法（只支持 pending / done / all）',
  bad_decision: '裁定参数不合法（只支持 yes / no）',
  unauthorized: '未授权：访问令牌为空或被拒绝',
  tray_not_found: '该病蚕记录不存在（可能已被其他端处理）',
  already_decided: '该记录已由他人裁定，请刷新列表',
  pass_running: '识别轮次正在运行，请稍后再试',
  service_unavailable: '服务暂不可用（识别/机械模块未就绪）',
  patrol_failed: '巡检任务下发失败',
  TIMEOUT: '请求超时：请确认已连上 WireGuard 隧道',
  NETWORK: '网络不可达：请确认已连上 WireGuard 隧道与后端地址',
  NO_API: '当前环境不支持网络请求',
  ENVELOPE: '后端返回格式异常',
  HTTP_422: '分页参数超出允许范围（limit 1~500）',
}

const STATUS_TEXT = {
  pending: '待裁定', running: '处理中', done: '已处理', failed: '失败', ignored: '已忽略',
}
const STATUS_TONE = {
  pending: 'orange', running: 'blue', done: 'green', failed: 'red', ignored: 'gray',
}
const CLAMP_TEXT = { none: '未下发', dispatched: '已下发', placed: '已放到位', failed: '夹取失败' }
const CLAMP_TONE = { none: 'gray', dispatched: 'blue', placed: 'green', failed: 'red' }
const JOB_TEXT = {
  pending: '排队中', dispatched: '已下发', moving: '搬运中', gripping: '抓取中',
  placing: '码放中', placed: '已完成', failed: '失败', ignored: '已忽略', cancelled: '已取消',
}
const JOB_TONE = {
  pending: 'gray', dispatched: 'blue', moving: 'blue', gripping: 'blue',
  placing: 'blue', placed: 'green', failed: 'red', ignored: 'gray', cancelled: 'gray',
}
const GRADE_TEXT = { auto: '自动判定', review: '待复核', low: '低置信' }

let CONFIG = null
let STATE = { ok: true, code: 'OK', message: '', lastSyncAt: 0, lastSyncText: '--', requests: 0, pending: 0, jobs: 0 }
const LOG = []

function api() {
  if (typeof wx !== 'undefined' && wx && typeof wx.request === 'function') return wx
  if (typeof uni !== 'undefined' && uni && typeof uni.request === 'function') return uni
  return null
}

function pad(n) { return n < 10 ? '0' + n : '' + n }
function clockNow() {
  const d = new Date()
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}
function clampNum(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v) }

function pushLog(entry) {
  LOG.unshift(Object.assign({ at: Date.now(), clock: clockNow() }, entry))
  if (LOG.length > LOG_MAX) LOG.pop()
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

function setConfig(patch) {
  const next = Object.assign({}, getConfig(), patch || {})
  if (!/^https?:\/\//.test(String(next.baseUrl || ''))) return { ok: false, message: '后端地址需以 http:// 或 https:// 开头' }
  next.baseUrl = String(next.baseUrl).replace(/\/+$/, '')
  next.token = String(next.token || '')
  next.zone = String(next.zone || 'zone01')
  next.barn = String(next.barn || '')
  next.pollMs = clampNum(Number(next.pollMs) || DEFAULT_CONFIG.pollMs, 5000, 120000)
  next.timeoutMs = clampNum(Number(next.timeoutMs) || DEFAULT_CONFIG.timeoutMs, 3000, 60000)
  next.confirmTimeoutMs = clampNum(Number(next.confirmTimeoutMs) || DEFAULT_CONFIG.confirmTimeoutMs, 30000, 120000)
  CONFIG = next
  const w = api()
  if (w && typeof w.setStorageSync === 'function') {
    try { w.setStorageSync(CONFIG_KEY, next) } catch (e) { console.error('[clamp] 保存配置失败', e) }
  }
  return { ok: true, message: '已保存', config: next }
}

function resetConfig() {
  CONFIG = Object.assign({}, DEFAULT_CONFIG)
  const w = api()
  if (w && typeof w.setStorageSync === 'function') {
    try { w.setStorageSync(CONFIG_KEY, CONFIG) } catch (e) { console.error('[clamp] 重置配置失败', e) }
  }
  return getConfig()
}

function getBarn(barn) {
  if (barn) return barn
  const cfg = getConfig()
  if (cfg.barn) return cfg.barn
  const cur = data.getCurrentBarn()
  return cur ? cur.barn : 'barn01'
}

function getState() { return Object.assign({}, STATE) }
function getLog(n) { return LOG.slice(0, n || 6) }
function clearLog() { LOG.length = 0 }

function textOf(code, message) {
  if (message) return message
  return ERROR_TEXT[code] || ('接口错误：' + code)
}

function ok2(payload, extra) { return Object.assign({ ok: true, code: 'OK', message: '', data: payload }, extra || {}) }
function fail2(code, message, extra) {
  return Object.assign({ ok: false, code: code, message: textOf(code, message), data: null }, extra || {})
}

function joinUrl(base, path, query) {
  const url = String(base || '').replace(/\/+$/, '') + '/' + String(path || '').replace(/^\/+/, '')
  const qs = []
  Object.keys(query || {}).forEach((k) => {
    const v = query[k]
    if (v === undefined || v === null || v === '') return
    qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v))
  })
  return qs.length ? url + '?' + qs.join('&') : url
}

/**
 * 发起一次请求。GET 默认重试 1 次（网络/5xx），POST 默认不重试（避免重复下发）。
 * 返回 {ok, code, message, data, total, httpStatus, ms, url}
 */
function request(method, path, opts) {
  const o = opts || {}
  const cfg = getConfig()
  const url = joinUrl(cfg.baseUrl, path, o.query)
  const header = { 'content-type': 'application/json' }
  // 令牌为空就真的发空（服务端会 401）；早期这里兜底成 'test'，
  // 会让「未配置令牌」永远看不出来，与交付单「只校验非空」的口径冲突。
  header.Authorization = 'Bearer ' + (cfg.token || '')
  if (o.idempotencyKey) header['X-Idempotency-Key'] = o.idempotencyKey
  const timeoutMs = o.timeoutMs || (method === 'POST' ? cfg.confirmTimeoutMs : cfg.timeoutMs)
  const maxTry = 1 + clampNum(o.retry === undefined ? (method === 'POST' ? 0 : 1) : o.retry, 0, 2)

  const w = api()
  const attempt = (n) => {
    STATE.requests += 1
    if (!w || typeof w.request !== 'function') return Promise.resolve(fail2('NO_API', ''))
    return new Promise((resolve) => {
      const started = Date.now()
      w.request({
        url: url,
        method: method,
        data: o.data,
        header: header,
        timeout: timeoutMs,
        success: (res) => resolve({ status: res.statusCode || 0, body: res.data, ms: Date.now() - started }),
        fail: (err) => resolve({ status: 0, body: null, ms: Date.now() - started, err: (err && (err.errMsg || err.message)) || 'request:fail' }),
      })
    }).then((res) => {
      if (res.status === 0) {
        const code = /timeout/i.test(res.err || '') ? 'TIMEOUT' : 'NETWORK'
        pushLog({ kind: 'http', method: method, url: url, status: 0, ok: false, code: code, ms: res.ms })
        if (n < maxTry) return attempt(n + 1)
        return fail2(code, '')
      }
      const out = unwrap(res)
      out.ms = res.ms
      out.url = url
      pushLog({ kind: 'http', method: method, url: url, status: res.status, ok: out.ok, code: out.code, ms: res.ms })
      const retriable = /^HTTP_5/.test(out.code) || out.code === 'service_unavailable'
      if (!out.ok && retriable && n < maxTry) {
        pushLog({ kind: 'retry', method: method, url: url, status: res.status, ok: false, code: out.code, ms: res.ms, note: '第 ' + n + ' 次重试' })
        return attempt(n + 1)
      }
      return out
    })
  }
  return attempt(1)
}

function unwrap(res) {
  const body = res.body
  const status = res.status
  if (body && typeof body === 'object' && body.ok === false && body.error) {
    const code = body.error.code || ('HTTP_' + status)
    return fail2(code, body.error.message, { httpStatus: status })
  }
  if (status === 401) return fail2('unauthorized', '', { httpStatus: status })
  if (status === 404) return fail2('tray_not_found', '', { httpStatus: status })
  if (status === 409) return fail2('already_decided', '', { httpStatus: status })
  if (status === 422) return fail2('HTTP_422', '', { httpStatus: status })
  if (status < 200 || status >= 300) return fail2('HTTP_' + status, '', { httpStatus: status })
  if (body === null || body === undefined) return fail2('ENVELOPE', '', { httpStatus: status })
  if (typeof body === 'object' && body.ok === false) {
    return fail2('service_unavailable', body.message || '', { httpStatus: status })
  }
  const payload = (typeof body === 'object' && body.data !== undefined) ? body.data : body
  return ok2(payload, { httpStatus: status, total: (body && body.total) || 0 })
}

/* ------------------------------------------------------------------ */
/* 视图归一化                                                          */
/* ------------------------------------------------------------------ */
function pct(v) {
  const n = Number(v)
  if (!isFinite(n)) return '--'
  return Math.round(n * 100) + '%'
}

function coordText(raw) {
  if (raw.display) return raw.display
  if (raw.layer === undefined || raw.row === undefined || raw.col === undefined) return '坐标未提供'
  return '第 ' + raw.layer + ' 层 · 第 ' + raw.row + ' 排 · 第 ' + raw.col + ' 列'
}

function timeText(ms) {
  const n = Number(ms)
  if (!n) return '--'
  try { return data.formatTime(n) } catch (e) { return '--' }
}

function agoText(ms) {
  const n = Number(ms)
  if (!n) return ''
  try { return data.fromNow(n, Date.now()) } catch (e) { return '' }
}

/** 病蚕识别记录 → 视图模型 */
function normalizeDiseased(raw) {
  const r = raw || {}
  const status = r.status || 'pending'
  const clampStatus = r.clampStatus || 'none'
  const images = Array.isArray(r.images) ? r.images : []
  const env = r.env || null
  const level = r.level || 'info'
  // 交付单：canConfirm 是裁定按钮的唯一判据；后端未给该字段时按同一口径推导
  const canConfirm = r.canConfirm === undefined
    ? (status === 'pending' && level === 'info')
    : !!r.canConfirm
  return {
    id: r.trayId || r.id || '',
    trayId: r.trayId || r.id || '',
    at: Number(r.at) || 0,
    timeText: timeText(r.at),
    agoText: agoText(r.at),
    layer: r.layer, row: r.row, col: r.col,
    display: coordText(r),
    conf: Number(r.conf) || 0,
    confText: pct(r.conf),
    subHitsText: Array.isArray(r.subHits) && r.subHits.length ? '命中帧 ' + r.subHits.join('、') : '',
    count: Number(r.trayDiseaseCount) || 0,
    level: level,
    levelText: level === 'warn' ? '需复核' : '疑似病蚕',
    levelTone: 'badge-' + (level === 'warn' ? 'orange' : 'blue'),
    status: status,
    statusText: STATUS_TEXT[status] || status,
    statusTone: 'badge-' + (STATUS_TONE[status] || 'gray'),
    clampStatus: clampStatus,
    clampText: CLAMP_TEXT[clampStatus] || clampStatus,
    clampTone: 'badge-' + (CLAMP_TONE[clampStatus] || 'gray'),
    grade: r.grade || '',
    gradeText: GRADE_TEXT[r.grade] || '',
    canConfirm: canConfirm,
    causeText: r.causeText || '',
    env: env,
    envText: env ? (env.t + '℃ / ' + env.h + '%RH · 越限 ' + (env.outSec || 0) + ' s') : '',
    images: images,
    image: images[0] || '',
    imageCount: images.length,
    jobId: r.jobId || '',
    passId: r.passId || '',
    decidedAt: Number(r.decidedAt) || 0,
    decidedText: r.decidedAt ? timeText(r.decidedAt) : '',
    decision: r.decision || '',
    decisionText: r.decision === 'yes' ? '已放行' : (r.decision === 'no' ? '已忽略' : ''),
    operator: r.operator || '',
    done: status !== 'pending',
  }
}

/** 夹取作业 → 视图模型 */
function normalizeJob(raw) {
  const r = raw || {}
  const status = r.status || 'pending'
  const placed = r.placed === true
  const started = Number(r.startedAt) || 0
  const finished = Number(r.finishedAt) || 0
  let durationText = '--'
  if (started && finished && finished > started) durationText = Math.round((finished - started) / 1000) + ' s'
  else if (started && !finished) durationText = '进行中'
  return {
    id: r.id || r.jobId || '',
    jobId: r.jobId || r.id || '',
    trayId: r.trayId || '',
    layer: r.layer, row: r.row, col: r.col,
    display: coordText(r),
    source: r.source || '',
    sourceText: r.source === 'confirmed' ? '人工确认' : '自动识别',
    status: status,
    statusText: JOB_TEXT[status] || status,
    statusTone: 'badge-' + (JOB_TONE[status] || 'gray'),
    placed: placed,
    placedText: placed ? '已放到位' : '未放到位',
    placedTone: 'badge-' + (placed ? 'green' : 'gray'),
    startedAt: started,
    startedText: started ? timeText(started) : '--',
    finishedAt: finished,
    finishedText: finished ? timeText(finished) : '--',
    durationText: durationText,
    reason: r.reason || '',
  }
}

/* ------------------------------------------------------------------ */
/* 业务接口                                                            */
/* ------------------------------------------------------------------ */
/** 病蚕识别列表：status = pending | done | all */
function listDiseased(opts) {
  const o = opts || {}
  const barn = getBarn(o.barn)
  const query = { status: o.status || 'pending', limit: o.limit || 50, zone: o.zone || getConfig().zone }
  return request('GET', '/barns/' + barn + '/diseased', { query: query, kind: 'diseased' }).then((r) => {
    if (!r.ok) { STATE.ok = false; STATE.code = r.code; STATE.message = r.message; return r }
    const list = Array.isArray(r.data) ? r.data : []
    const items = list.map(normalizeDiseased)
    STATE.ok = true; STATE.code = 'OK'; STATE.message = ''
    STATE.lastSyncAt = Date.now(); STATE.lastSyncText = clockNow()
    if (query.status === 'pending') STATE.pending = items.length
    return ok2(items, { total: r.total || items.length, code: 'OK' })
  })
}

/** 人工裁定：decision = yes（放行并下发夹取）| no（仅本轮忽略） */
function confirmDiseased(trayId, opts) {
  const o = opts || {}
  const barn = getBarn(o.barn)
  const decision = o.decision === 'no' ? 'no' : 'yes'
  const body = {
    decision: decision,
    operator: o.operator || '',
    note: o.note || '',
    at: Date.now(),
  }
  const query = { zone: o.zone || getConfig().zone }
  const key = 'clamp-' + barn + '-' + trayId + '-' + Date.now()
  return request('POST', '/barns/' + barn + '/diseased/' + trayId + '/confirm', {
    query: query, data: body, idempotencyKey: key, kind: 'confirm',
    timeoutMs: getConfig().confirmTimeoutMs, retry: 0,
  }).then((r) => {
    if (!r.ok) {
      STATE.ok = false; STATE.code = r.code; STATE.message = r.message
      return r
    }
    STATE.ok = true; STATE.code = 'OK'; STATE.message = ''
    const d = r.data || {}
    return ok2({
      trayId: d.trayId || trayId,
      status: d.status || '',
      decision: d.decision || decision,
      operator: d.operator || body.operator,
      at: Number(d.at) || body.at,
      clampTaskId: d.clampTaskId || '',
      placed: d.placed === true,
      placedText: d.placed === true ? '已放到位' : '已下发，尚未放到位',
      forwardedToAlertCenter: !!d.forwardedToAlertCenter,
      forwardedRaw: d.forwardedRaw || '',
    })
  })
}

/** 夹取作业列表：status = all | running | done */
function listJobs(opts) {
  const o = opts || {}
  const barn = getBarn(o.barn)
  const query = { status: o.status || 'all', limit: o.limit || 50, zone: o.zone || getConfig().zone }
  return request('GET', '/barns/' + barn + '/clamp/jobs', { query: query, kind: 'jobs' }).then((r) => {
    if (!r.ok) { STATE.ok = false; STATE.code = r.code; STATE.message = r.message; return r }
    const list = Array.isArray(r.data) ? r.data : []
    const items = list.map(normalizeJob)
    STATE.jobs = items.length
    return ok2(items, { total: r.total || items.length })
  })
}

/** 巡检状态（可选，只读展示；绝不调用 /patrol/run） */
function patrolStatus(opts) {
  const barn = getBarn((opts || {}).barn)
  return request('GET', '/barns/' + barn + '/patrol/status', { kind: 'patrol' })
}

/** 连通性测试：用最小列表请求探活 */
function ping() {
  return request('GET', '/barns/' + getBarn() + '/diseased', { query: { status: 'pending', limit: 1, zone: getConfig().zone }, kind: 'ping', retry: 0 })
}

/* ------------------------------------------------------------------ */
/* 轮询（页面不各自起定时器，统一由本模块驱动）                          */
/* ------------------------------------------------------------------ */
let POLL_USERS = []
let POLL_TIMER = null

function refreshAll(barn) {
  return Promise.all([
    listDiseased({ barn: barn, status: 'pending', limit: 50 }),
    listJobs({ barn: barn, status: 'all', limit: 20 }),
  ]).then((rs) => {
    const payload = {
      ok: rs[0].ok && rs[1].ok,
      diseased: rs[0].ok ? rs[0].data : [],
      jobs: rs[1].ok ? rs[1].data : [],
      code: rs[0].ok ? rs[1].code : rs[0].code,
      message: rs[0].ok ? rs[1].message : rs[0].message,
      state: getState(),
    }
    POLL_USERS.slice().forEach((fn) => {
      try { fn(payload) } catch (e) { console.error('[clamp] poll handler error', e) }
    })
    return payload
  })
}

/** 订阅实时列表：页面 onShow 调它，onHide/onUnload 调 stopPolling(fn) */
function startPolling(barn, fn) {
  if (typeof fn === 'function' && POLL_USERS.indexOf(fn) < 0) POLL_USERS.push(fn)
  refreshAll(barn)
  if (!POLL_TIMER) {
    POLL_TIMER = setInterval(() => { refreshAll() }, getConfig().pollMs)
  }
  return true
}

function stopPolling(fn) {
  if (fn) {
    const i = POLL_USERS.indexOf(fn)
    if (i >= 0) POLL_USERS.splice(i, 1)
  } else {
    POLL_USERS = []
  }
  if (!POLL_USERS.length && POLL_TIMER) {
    clearInterval(POLL_TIMER)
    POLL_TIMER = null
  }
}

export {
  DEFAULT_CONFIG,
  CONFIG_KEY,
  STATUS_TEXT,
  CLAMP_TEXT,
  JOB_TEXT,
  ERROR_TEXT,
  getConfig,
  setConfig,
  resetConfig,
  getBarn,
  getState,
  getLog,
  clearLog,
  request,
  joinUrl,
  normalizeDiseased,
  normalizeJob,
  coordText,
  listDiseased,
  confirmDiseased,
  listJobs,
  patrolStatus,
  ping,
  refreshAll,
  startPolling,
  stopPolling,
}
