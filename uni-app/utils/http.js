/**
 * utils/http.js —— 统一 HTTP 客户端（环境调控 ENV + 检测夹取 ISH 两套服务共用）
 *
 * 设计要点：
 *  1) 只做「发请求 / 解信封 / 归一化错误 / 401 自动 refresh 重试一次」，不懂业务；
 *  2) 两套后端的信封不同（ENV 成功=裸对象、失败 {error:{code,message}}；ISH {ok,data,total}），
 *     用 envelope 参数区分，调用方拿到统一的 {ok,data,total,code,message,status}；
 *  3) 401 由 auth.js 通过 onUnauthorized(fn) 注入「刷新令牌」逻辑，刷新失败时抛给调用方；
 *  4) 重试策略按交付单：网络错误 / 超时 / 5xx 退避重试（默认 1 次），4xx 一律不重试。
 */
const DEFAULT_TIMEOUT = 12000
const RETRY_DELAY = 400

function api() {
  if (typeof wx !== 'undefined' && wx && typeof wx.request === 'function') return wx
  if (typeof uni !== 'undefined' && uni && typeof uni.request === 'function') return uni
  return null
}

function store(k, v) {
  const a = api()
  if (!a) return v
  try {
    if (v === undefined) return a.getStorageSync(k) || ''
    if (v === null) { a.removeStorageSync(k); return null }
    a.setStorageSync(k, v)
    return v
  } catch (e) { return v }
}

function trimBase(base) { return String(base || '').replace(/\/+$/, '') }

function joinUrl(base, path) {
  const b = trimBase(base)
  const p = String(path || '')
  if (!p) return b
  return b + (p.charAt(0) === '/' ? p : '/' + p)
}

function withQuery(url, query) {
  if (!query) return url
  const parts = []
  Object.keys(query).forEach((k) => {
    const v = query[k]
    if (v === undefined || v === null || v === '') return
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v))
  })
  if (!parts.length) return url
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + parts.join('&')
}

function isTimeout(err) {
  const m = String((err && (err.errMsg || err.message)) || '')
  return m.indexOf('timeout') >= 0 || m.indexOf('超时') >= 0
}

function networkMessage(err) {
  const m = String((err && (err.errMsg || err.message)) || '')
  if (m.indexOf('domain') >= 0 || m.indexOf('合法域名') >= 0) return '域名未配置：请在「我的 → 后端接口」确认地址，或在开发者工具关闭域名校验'
  if (m.indexOf('ssl') >= 0 || m.indexOf('SSL') >= 0) return 'HTTPS 证书校验失败（后端为明文 HTTP，请放开明文流量）'
  return '连接失败：请确认已连上 WireGuard 隧道或网络可达'
}

/* 401 刷新钩子：由 auth.js 注入 */
let REFRESHER = null
let refreshing = null

function onUnauthorized(fn) { REFRESHER = fn }

function runRefresh() {
  if (!REFRESHER) return Promise.resolve(false)
  if (refreshing) return refreshing
  refreshing = Promise.resolve()
    .then(() => REFRESHER())
    .then((r) => !!r)
    .catch(() => false)
    .then((r) => { refreshing = null; return r })
  return refreshing
}

function rawRequest(opts) {
  return new Promise((resolve) => {
    const a = api()
    if (!a) { resolve({ ok: false, code: 'NO_API', message: '当前环境不支持网络请求' }); return }
    const method = String(opts.method || 'GET').toUpperCase()
    const url = withQuery(joinUrl(opts.base, opts.path), opts.query)
    const headers = Object.assign({}, opts.headers || {})
    if (opts.token) headers.Authorization = headers.Authorization || ('Bearer ' + opts.token)
    if (method !== 'GET' && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
    const timeout = opts.timeout || DEFAULT_TIMEOUT
    const started = Date.now()
    a.request({
      url,
      method,
      header: headers,
      data: method === 'GET' ? undefined : opts.body,
      timeout,
      success: (res) => resolve({ ok: true, status: res.statusCode || 0, body: res.data, url, method, ms: Date.now() - started }),
      fail: (err) => resolve({ ok: false, status: 0, err, code: isTimeout(err) ? 'TIMEOUT' : 'NETWORK', message: isTimeout(err) ? '请求超时（' + Math.round(timeout / 1000) + ' s），夹取裁定最坏需 19 s，请稍后重试' : networkMessage(err), url, method, ms: Date.now() - started }),
    })
  })
}

function unwrap(res, envelope) {
  if (!res.ok) return res
  const body = res.body
  const status = res.status
  if (envelope === 'ish') {
    if (body && typeof body === 'object' && body.ok === false) {
      const e = body.error || {}
      return { ok: false, code: e.code || 'UNKNOWN', message: e.message || '接口返回失败', status, raw: body }
    }
    if (status >= 200 && status < 300 && body && typeof body === 'object' && body.ok === true) {
      return { ok: true, data: body.data, total: body.total, status, raw: body }
    }
    /* ISH 旧端点：HTTP 200 但 body.code 表示业务码 */
    if (body && typeof body === 'object' && body.code !== undefined && body.code !== 200) {
      return { ok: false, code: 'BIZ_' + body.code, message: body.msg || body.message || '接口返回失败', status, raw: body }
    }
    return { ok: false, code: 'ENVELOPE', message: '响应不是 {ok,data} 信封（HTTP ' + status + '）', status, raw: body }
  }
  /* 环境调控：成功=裸对象；失败固定 {error:{code,message,detail}} */
  if (body && typeof body === 'object' && body.error && typeof body.error === 'object') {
    return { ok: false, code: body.error.code || 'UNKNOWN', message: body.error.message || '接口返回失败', detail: body.error.detail, status, raw: body }
  }
  if (status >= 200 && status < 300) return { ok: true, data: body, status, raw: body }
  return { ok: false, code: 'HTTP_' + status, message: 'HTTP ' + status, status, raw: body }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

/**
 * 发一次业务请求。
 * @param {object} opts {base,path,method,query,body,headers,token,timeout,retry,envelope,auth,refresh}
 * @returns {Promise<{ok,data,total,code,message,status,url,method,ms}>}
 */
function request(opts) {
  const o = opts || {}
  const envelope = o.envelope || 'env'
  const retry = o.retry === undefined ? 0 : o.retry
  const allowRefresh = o.refresh !== false

  function once(tries) {
    return rawRequest(o).then((res) => {
      /* 401：先刷新一次再重试 */
      if (res.ok && res.status === 401) {
        if (allowRefresh && REFRESHER) {
          return runRefresh().then((done) => {
            if (done) {
              const next = Object.assign({}, o)
              if (typeof REFRESHER.token === 'function') next.token = REFRESHER.token() || o.token
              return once(tries)
            }
            return { ok: false, code: 'UNAUTHORIZED', message: '登录已过期，请重新登录', status: 401, url: res.url, method: res.method, ms: res.ms }
          })
        }
        return { ok: false, code: 'UNAUTHORIZED', message: '未登录或登录已过期，请先登录', status: 401, url: res.url, method: res.method, ms: res.ms }
      }
      const out = unwrap(res, envelope)
      out.url = res.url
      out.method = res.method
      out.ms = res.ms
      const retryable = !out.ok && (!out.status || out.status >= 500 || out.code === 'NETWORK' || out.code === 'TIMEOUT')
      if (retryable && tries < retry) {
        return sleep(RETRY_DELAY * (tries + 1)).then(() => once(tries + 1))
      }
      return out
    })
  }
  return once(0)
}

export { DEFAULT_TIMEOUT, request, joinUrl, withQuery, trimBase, onUnauthorized, store }
