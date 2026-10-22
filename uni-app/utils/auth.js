/**
 * utils/auth.js —— 登录 / 身份 / 能力 / 操作员账户 / 审批令牌（对接后端 barn-api）
 *
 * 依据《前端接口交付.md》§1.2 / §3.2 / §4：
 *  - 环境调控 `{ENV}`（默认 http://10.66.66.1/api）使用 **JWT 真验签**：
 *      POST /auth/login   {username,password} → {access_token,refresh_token,expires_in,user{user_id,username,role,display_name}}
 *      GET  /auth/me      → {user_id,username,role,display_name,capabilities[]}
 *      POST /auth/refresh {refresh_token}     → {access_token,expires_in}
 *      POST /auth/logout  → {ok:true}
 *  - access 7200 s；401 先 refresh 重试一次，仍失败才回登录页；
 *  - 按钮权限按 **capabilities[]** 判断（不要硬编码 role），role 只用于展示与兜底；
 *  - 账号管理（/auth/users×4）与审批令牌（/control/tokens×3）为 admin 专属，
 *    详细版接口文档未随本次交付提供 → ENPOINTS 集中在此，定稿后只需改这里。
 */
import * as http from './http.js'
import * as DATA from './data.js'

const CONFIG_KEY = 'silk_auth_v1'
const SESSION_KEY = 'silk_auth_session_v1'
const LAST_USER_KEY = 'silk_auth_user_v1'
const LOG_MAX = 40

const DEFAULT_CONFIG = {
  gate: false,                                  /* true = 冷启动必须登录；false = 允许演示模式直接进 */
  baseUrl: 'http://10.66.66.1/api',             /* 环境调控 ENV（已含 /api） */
  timeoutMs: 12000,
}

/* 后端路径集中表（详细文档到位后只改这里） */
const ENDPOINTS = {
  login: '/auth/login',
  refresh: '/auth/refresh',
  logout: '/auth/logout',
  me: '/auth/me',
  users: '/auth/users',
  userOf: (id) => '/auth/users/' + encodeURIComponent(id),
  userPassword: (id) => '/auth/users/' + encodeURIComponent(id) + '/password',
  tokens: '/control/tokens',
  tokenRevoke: (id) => '/control/tokens/' + encodeURIComponent(id) + '/revoke',
}

const ROLE_TEXT = { admin: '管理员', operator: '操作员', viewer: '只读访客' }

const ERROR_TEXT = {
  invalid_credentials: '账号或密码错误',
  unauthorized: '登录已过期，请重新登录',
  forbidden: '当前账号没有该操作权限',
  account_disabled: '账号已被禁用，请联系管理员',
  user_exists: '账号已存在',
  user_not_found: '账号不存在',
  weak_password: '密码强度不足（至少 6 位）',
  invalid_token: '令牌无效',
  token_used: '令牌已被使用',
  token_expired: '令牌已过期',
  token_revoked: '令牌已被撤销',
  NO_BASE: '请先填写服务器地址',
  NO_API: '当前环境不支持网络请求',
  TIMEOUT: '请求超时，请检查隧道/网络',
  NETWORK: '连接失败：请确认已连上 WireGuard 隧道或网络可达',
  ENVELOPE: '服务端响应格式不符',
  UNAUTHORIZED: '未登录或登录已过期，请先登录',
}

/* ---------------- 配置 / 会话持久化 ---------------- */
function readJson(key, fallback) {
  const raw = http.store(key)
  if (!raw) return fallback
  if (typeof raw === 'object') return raw
  try { return JSON.parse(raw) } catch (e) { return fallback }
}
function writeJson(key, value) { http.store(key, JSON.stringify(value)) }

let CONFIG = Object.assign({}, DEFAULT_CONFIG)
let SESSION = null
let LOG = []

function loadConfig() {
  const c = readJson(CONFIG_KEY, null)
  CONFIG = Object.assign({}, DEFAULT_CONFIG, c || {})
  SESSION = readJson(SESSION_KEY, null)
  return CONFIG
}

function getConfig() { return Object.assign({}, CONFIG) }
function setConfig(patch) {
  const p = patch || {}
  if (p.baseUrl !== undefined) {
    const url = String(p.baseUrl || '').trim()
    if (url && !/^https?:\/\//i.test(url)) return { ok: false, message: '服务器地址需以 http:// 或 https:// 开头' }
    p.baseUrl = url || DEFAULT_CONFIG.baseUrl
  }
  if (p.timeoutMs !== undefined) p.timeoutMs = Math.min(60000, Math.max(3000, Number(p.timeoutMs) || DEFAULT_CONFIG.timeoutMs))
  if (p.gate !== undefined) p.gate = !!p.gate
  CONFIG = Object.assign({}, CONFIG, p)
  writeJson(CONFIG_KEY, CONFIG)
  return { ok: true, config: getConfig() }
}
function resetConfig() { CONFIG = Object.assign({}, DEFAULT_CONFIG); writeJson(CONFIG_KEY, CONFIG); return getConfig() }

/* ---------------- 小工具 ---------------- */
function log(entry) {
  LOG.unshift(Object.assign({ at: Date.now() }, entry))
  if (LOG.length > LOG_MAX) LOG.length = LOG_MAX
}
function getLog(n) { return LOG.slice(0, n || LOG_MAX) }
function clearLog() { LOG = [] }

function roleText(role) { return ROLE_TEXT[role] || '访客' }
function normalizeRole(raw) {
  const r = String(raw || '').toLowerCase()
  if (r === 'admin' || r === 'administrator' || r === '管理员' || r === 'superadmin' || r === 'owner') return 'admin'
  if (r === 'operator' || r === 'op' || r === '操作员' || r === 'user') return 'operator'
  return 'viewer'
}

/* 角色 → 默认能力（后端没给 capabilities[] 时的兜底） */
const ROLE_CAPS = {
  admin: ['view', 'hist', 'ack', 'manual', 'config_change', 'token_issue', 'user_manage', 'export', 'agent'],
  operator: ['view', 'hist', 'ack', 'manual'],
  viewer: ['view', 'hist'],
}

function normalizeUser(raw) {
  const r = raw || {}
  const role = normalizeRole(r.role || r.role_name || r.user_role)
  const id = r.user_id !== undefined ? r.user_id : (r.id !== undefined ? r.id : r.uid)
  const caps = Array.isArray(r.capabilities) ? r.capabilities.slice() : ROLE_CAPS[role].slice()
  return {
    id: id === undefined ? '' : String(id),
    userId: id === undefined ? '' : id,
    username: r.username || r.account || r.login || '',
    name: r.display_name || r.name || r.nickname || r.username || '',
    role: role,
    roleText: roleText(role),
    capabilities: caps,
    disabled: r.disabled === true || r.enabled === false || r.status === 'disabled',
    createdAt: r.created_at || r.createdAt || 0,
    lastLogin: r.last_login || r.lastLogin || 0,
    raw: r,
  }
}

function normalizeToken(raw) {
  const r = raw || {}
  const id = r.token_id !== undefined ? r.token_id : (r.id !== undefined ? r.id : r.token)
  const expireAt = Number(r.expire_at || r.expires_at || r.expireAt || 0)
  const expireMs = expireAt > 1e12 ? expireAt : expireAt * 1000
  const status = r.status || (r.used ? 'used' : (r.revoked ? 'revoked' : 'active'))
  return {
    id: id === undefined ? '' : String(id),
    token: r.token || r.code || '',
    target: r.target || r.device_id || '',
    action: r.action || 'manual',
    memo: r.memo || r.remark || r.note || '',
    used: status === 'used' || r.used === true,
    revoked: status === 'revoked' || r.revoked === true,
    status: status,
    expireAt: expireMs || 0,
    createdAt: Number(r.created_at || 0) * (Number(r.created_at) < 1e12 && r.created_at ? 1000 : 1),
    issuer: r.issuer || r.created_by || '',
    raw: r,
  }
}

/* ---------------- 会话 ---------------- */
function token() { return SESSION ? SESSION.accessToken : '' }
function refreshToken() { return SESSION ? SESSION.refreshToken : '' }
function isLoggedIn() {
  if (!SESSION || !SESSION.accessToken) return false
  if (SESSION.expireAt && SESSION.expireAt - 30000 < Date.now()) return false
  return true
}
function needsLogin() { return !!CONFIG.gate && !isLoggedIn() }
function getSession() { return SESSION ? Object.assign({}, SESSION) : null }
function getUser() { return SESSION && SESSION.user ? SESSION.user : null }
function getRole() { const u = getUser(); return u ? u.role : 'viewer' }
function isAdmin() { return getRole() === 'admin' }
function capabilities() { return SESSION && Array.isArray(SESSION.capabilities) ? SESSION.capabilities.slice() : [] }
function can(cap) {
  if (!cap) return true
  const caps = capabilities()
  if (caps.length) return caps.indexOf(cap) >= 0
  return ROLE_CAPS[getRole()].indexOf(cap) >= 0
}
function applyRole() {
  let role = getRole()
  try {
    /* 注意：这里必须是模块顶部的 require（迁移到 uni-app 时会被改写为 import，
       函数内动态 require 会变成函数内 import，语法非法） */
    DATA.setRole(getRole() === 'admin' ? 'admin' : (getRole() === 'operator' ? 'operator' : 'viewer'))
  } catch (e) { /* 演示环境下 data.js 可能不可用 */ }
  return role
}

function saveSession(s) {
  SESSION = s
  writeJson(SESSION_KEY, s)
  if (s && s.user) writeJson(LAST_USER_KEY, s.user)
  applyRole()
  return s
}
function clearSession() {
  SESSION = null
  try { http.store(SESSION_KEY, null) } catch (e) {}
}

function rememberUser(username) { http.store(LAST_USER_KEY + '_name', username || '') }
function lastUser() { return http.store(LAST_USER_KEY + '_name') || '' }

/* ---------------- 请求封装（带上 token / 401 刷新） ---------------- */
function call(method, path, opts) {
  const o = opts || {}
  return http.request({
    base: o.base || CONFIG.baseUrl,
    path: path,
    method: method,
    query: o.query,
    body: o.body,
    token: o.auth === false ? '' : token(),
    timeout: o.timeout || CONFIG.timeoutMs,
    retry: o.retry === undefined ? 1 : o.retry,
    envelope: 'env',
    refresh: o.refresh !== false,
  }).then((res) => {
    log({ method: method, path: path, ok: res.ok, code: res.code || '', status: res.status || 0 })
    if (!res.ok && res.status === 401 && o.auth !== false) clearSession()
    return res
  })
}

/* 注入 401 刷新：返回 true 表示已换到新 token，可重试 */
http.onUnauthorized(() => doRefresh())
http.onUnauthorized.token = () => token()

let refreshing = null
function doRefresh() {
  if (refreshing) return refreshing
  const rt = refreshToken()
  if (!rt) return Promise.resolve(false)
  refreshing = http.request({
    base: CONFIG.baseUrl,
    path: ENDPOINTS.refresh,
    method: 'POST',
    body: { refresh_token: rt },
    auth: false,
    timeout: CONFIG.timeoutMs,
    retry: 0,
    envelope: 'env',
    refresh: false,
  }).then((res) => {
    refreshing = null
    if (!res.ok || !res.data || !res.data.access_token) { clearSession(); return false }
    SESSION.accessToken = res.data.access_token
    SESSION.expireAt = Date.now() + Math.max(60, Number(res.data.expires_in) || 7200) * 1000
    writeJson(SESSION_KEY, SESSION)
    return true
  }).catch(() => { refreshing = null; return false })
  return refreshing
}

/* ---------------- 登录 / 登出 / 身份 ---------------- */
function login(username, password) {
  const u = String(username || '').trim()
  const p = String(password || '')
  if (!u) return Promise.resolve({ ok: false, code: 'NO_USER', message: '请输入账号' })
  if (!p) return Promise.resolve({ ok: false, code: 'NO_PWD', message: '请输入密码' })
  if (!CONFIG.baseUrl) return Promise.resolve({ ok: false, code: 'NO_BASE', message: ERROR_TEXT.NO_BASE })
  return http.request({
    base: CONFIG.baseUrl,
    path: ENDPOINTS.login,
    method: 'POST',
    body: { username: u, password: p },
    auth: false,
    timeout: CONFIG.timeoutMs,
    retry: 0,
    envelope: 'env',
    refresh: false,
  }).then((res) => {
    log({ method: 'POST', path: ENDPOINTS.login, ok: res.ok, code: res.code || '', status: res.status || 0 })
    if (!res.ok) {
      return { ok: false, code: res.code, message: ERROR_TEXT[res.code] || res.message || '登录失败', status: res.status }
    }
    const d = res.data || {}
    const user = normalizeUser(d.user || {})
    const s = saveSession({
      accessToken: d.access_token || '',
      refreshToken: d.refresh_token || '',
      expireAt: Date.now() + Math.max(60, Number(d.expires_in) || 7200) * 1000,
      user: user,
      capabilities: user.capabilities,
      loginAt: Date.now(),
    })
    rememberUser(u)
    return { ok: true, user: s.user, session: getSession(), message: '登录成功' }
  })
}

function refreshMe() {
  if (!isLoggedIn()) return Promise.resolve({ ok: false, code: 'UNAUTHORIZED', message: ERROR_TEXT.UNAUTHORIZED })
  return call('GET', ENDPOINTS.me).then((res) => {
    if (!res.ok) return { ok: false, code: res.code, message: ERROR_TEXT[res.code] || res.message }
    const user = normalizeUser(res.data || {})
    SESSION.user = user
    SESSION.capabilities = user.capabilities
    writeJson(SESSION_KEY, SESSION)
    applyRole()
    return { ok: true, user: user }
  })
}

function logout() {
  const done = () => { clearSession(); return { ok: true, message: '已退出登录' } }
  if (!isLoggedIn()) return Promise.resolve(done())
  return call('POST', ENDPOINTS.logout, { retry: 0 }).then((res) => {
    if (!res.ok && res.code !== 'UNAUTHORIZED') log({ method: 'POST', path: ENDPOINTS.logout, ok: false, code: res.code })
    return done()
  }).catch(done)
}

/* ---------------- 操作员账户（admin） ---------------- */
function listUsers() {
  return call('GET', ENDPOINTS.users).then((res) => {
    if (!res.ok) return { ok: false, code: res.code, message: ERROR_TEXT[res.code] || res.message }
    const d = res.data
    const list = Array.isArray(d) ? d : (d && (d.items || d.users || d.data)) || []
    return { ok: true, list: list.map(normalizeUser) }
  })
}

function createUser(form) {
  const f = form || {}
  const body = {
    username: String(f.username || '').trim(),
    password: String(f.password || ''),
    display_name: String(f.name || f.display_name || '').trim() || String(f.username || '').trim(),
    role: normalizeRole(f.role),
  }
  if (!body.username) return Promise.resolve({ ok: false, code: 'NO_USER', message: '请输入账号' })
  if (body.password.length < 6) return Promise.resolve({ ok: false, code: 'weak_password', message: ERROR_TEXT.weak_password })
  return call('POST', ENDPOINTS.users, { body: body, retry: 0 }).then((res) => {
    if (!res.ok) return { ok: false, code: res.code, message: ERROR_TEXT[res.code] || res.message }
    return { ok: true, user: normalizeUser(res.data || body), message: '账号已创建' }
  })
}

function updateUser(id, patch) {
  const body = Object.assign({}, patch || {})
  if (body.role) body.role = normalizeRole(body.role)
  if (body.name) { body.display_name = body.name; delete body.name }
  return call('PATCH', ENDPOINTS.userOf(id), { body: body, retry: 0 }).then((res) => {
    if (!res.ok) return { ok: false, code: res.code, message: ERROR_TEXT[res.code] || res.message }
    return { ok: true, message: '已更新' }
  })
}

function resetPassword(id, password) {
  const pwd = String(password || '')
  if (pwd.length < 6) return Promise.resolve({ ok: false, code: 'weak_password', message: ERROR_TEXT.weak_password })
  return call('POST', ENDPOINTS.userPassword(id), { body: { password: pwd }, retry: 0 }).then((res) => {
    if (!res.ok) return { ok: false, code: res.code, message: ERROR_TEXT[res.code] || res.message }
    return { ok: true, message: '密码已重置' }
  })
}

/* ---------------- 审批令牌（admin 签发） ---------------- */
function listTokens() {
  return call('GET', ENDPOINTS.tokens).then((res) => {
    if (!res.ok) return { ok: false, code: res.code, message: ERROR_TEXT[res.code] || res.message }
    const d = res.data
    const list = Array.isArray(d) ? d : (d && (d.items || d.tokens || d.data)) || []
    return { ok: true, list: list.map(normalizeToken) }
  })
}

function issueToken(opts) {
  const o = opts || {}
  if (!o.target) return Promise.resolve({ ok: false, code: 'NO_TARGET', message: '请选择作用设备' })
  const body = { target: o.target, action: o.action || 'manual', memo: o.memo || '', ttl_min: o.ttlMin || 5 }
  return call('POST', ENDPOINTS.tokens, { body: body, retry: 0 }).then((res) => {
    if (!res.ok) return { ok: false, code: res.code, message: ERROR_TEXT[res.code] || res.message }
    return { ok: true, token: normalizeToken(res.data || body), message: '令牌已签发' }
  })
}

function revokeToken(id) {
  return call('POST', ENDPOINTS.tokenRevoke(id), { retry: 0 }).then((res) => {
    if (!res.ok) return { ok: false, code: res.code, message: ERROR_TEXT[res.code] || res.message }
    return { ok: true, message: '令牌已撤销' }
  })
}

/* ---------------- 状态聚合（页面用） ---------------- */
function getState() {
  const u = getUser()
  return {
    ok: !!u,
    loggedIn: isLoggedIn(),
    gate: !!CONFIG.gate,
    baseUrl: CONFIG.baseUrl,
    user: u,
    username: u ? u.username : '',
    name: u ? u.name : '',
    role: getRole(),
    roleText: roleText(getRole()),
    isAdmin: isAdmin(),
    capabilities: capabilities(),
    expireAt: SESSION ? SESSION.expireAt : 0,
    expireText: SESSION && SESSION.expireAt ? (new Date(SESSION.expireAt).getHours() + ':' + ('0' + new Date(SESSION.expireAt).getMinutes()).slice(-2)) : '',
    message: u ? '' : '未登录：请先以管理员账号登录',
    requests: LOG.slice(0, 5),
    lastUser: lastUser(),
  }
}

loadConfig()

export {
  ENDPOINTS, CONFIG_KEY, SESSION_KEY, DEFAULT_CONFIG, ERROR_TEXT, ROLE_TEXT, ROLE_CAPS,
  loadConfig, getConfig, setConfig, resetConfig,
  getSession, isLoggedIn, needsLogin, getUser, getRole, roleText, isAdmin, capabilities, can, applyRole,
  normalizeRole, normalizeUser, normalizeToken,
  login, logout, refreshMe, rememberUser, lastUser,
  listUsers, createUser, updateUser, resetPassword,
  listTokens, issueToken, revokeToken,
  getState, getLog, clearLog, token, refreshToken, doRefresh,
}
