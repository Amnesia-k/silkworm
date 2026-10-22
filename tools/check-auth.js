/**
 * tools/check-auth.js —— utils/auth.js 桩件测试（登录闸门 / 会话 / 过期回登录）
 *
 * 本机没有后端、没有真机，所以用桩件模拟 wx.request 的响应，验证：
 *   ① 冷启动必须登录（默认 gate:true，无会话时 needsLogin() 为 true）
 *   ② 登录参数校验、请求构造（/auth/login、无 Authorization、无重试）
 *   ③ 登录成功后会话落地、角色映射进 data 权限矩阵
 *   ④ 登录失败（401 invalid_credentials）不重试、仍是未登录
 *   ⑤ 会话过期 handleExpired()：清会话、回登录页、3 秒去重
 *   ⑥ gate 关闭后允许演示模式直接进
 *
 * 运行：node tools/check-auth.js
 */
'use strict'

const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '..')

/* ---------------- wx 桩件 ---------------- */
let CALLS = []
let RESP = []
let RELAUNCH = []
const STORE = {}

global.wx = {
  request(opts) {
    CALLS.push({
      url: opts.url,
      method: opts.method,
      header: opts.header || {},
      data: opts.data,
      timeout: opts.timeout,
    })
    const next = RESP.length ? RESP.shift() : { statusCode: 500, data: { ok: false, error: { code: 'no_more_stub', message: '桩件响应已用尽' } } }
    setTimeout(() => {
      if (next.errMsg) { opts.fail({ errMsg: next.errMsg }); return }
      opts.success({ statusCode: next.statusCode, data: next.data })
    }, 1)
  },
  getStorageSync(k) { return STORE[k] === undefined ? '' : STORE[k] },
  setStorageSync(k, v) { STORE[k] = v },
  reLaunch(o) { RELAUNCH.push((o && o.url) || '') },
  showToast() {},
  showModal() {},
  showLoading() {},
  hideLoading() {},
}
global.getCurrentPages = () => [{ route: 'pages/index/index' }]

const data = require(path.join(ROOT, 'utils/data.js'))
const auth = require(path.join(ROOT, 'utils/auth.js'))

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

function loginOk(user) {
  /* 环境调控 barn-api 成功响应是裸对象（不是 {ok,data} 信封） */
  return {
    statusCode: 200,
    data: {
      access_token: 'AT-1',
      refresh_token: 'RT-1',
      expires_in: 7200,
      user: user || { id: 1, username: 'admin', display_name: '管理员', role: 'admin', capabilities: ['view', 'hist', 'ack', 'manual', 'setConfig', 'user_manage'] },
    },
  }
}
function errEnvelope(status, code) {
  /* 失败固定 {error:{code,message,detail}} */
  return { statusCode: status, data: { error: { code: code, message: 'stub ' + code } } }
}

/* ---------------- 测试用例 ---------------- */
async function main() {
  console.log('\n[1] 冷启动必须登录（默认闸门开）')
  const def = auth.resetConfig()
  eq(def.gate, true, '默认 gate 为 true（冷启动先登录）')
  eq(auth.needsLogin(), true, '无会话时 needsLogin() 为 true')
  eq(auth.isLoggedIn(), false, '无会话时 isLoggedIn() 为 false')
  eq(auth.getRole(), 'viewer', '未登录角色为 viewer')
  eq(auth.isAdmin(), false, '未登录不是管理员')

  console.log('\n[2] 登录参数校验（不打网络）')
  reset([])
  let r = await auth.login('', 'x')
  eq(r.code, 'NO_USER', '空账号直接返回 NO_USER')
  r = await auth.login('u', '')
  eq(r.code, 'NO_PWD', '空密码直接返回 NO_PWD')
  eq(CALLS.length, 0, '参数不合法不发请求')

  console.log('\n[3] 管理员登录成功')
  reset([loginOk()])
  r = await auth.login('admin', '123456')
  eq(r.ok, true, '登录返回 ok')
  eq(r.user.role, 'admin', '角色映射为 admin')
  const c = lastCall()
  eq(c.method, 'POST', '登录用 POST')
  eq(c.url, 'http://10.66.66.1/api/auth/login', '登录地址 /auth/login')
  eq(JSON.stringify(c.data), JSON.stringify({ username: 'admin', password: '123456' }), '登录体只有账号密码')
  ok(!c.header.Authorization, '登录请求不带 Authorization')
  eq(auth.needsLogin(), false, '登录后不再拦人')
  eq(auth.isLoggedIn(), true, '登录后 isLoggedIn() 为 true')
  eq(auth.isAdmin(), true, '登录后 isAdmin() 为 true')
  eq(auth.getUser().name, '管理员', '会话里带显示名')
  eq(auth.can('manual'), true, 'capabilities 里的 manual 可用')
  eq(auth.can('nope'), false, '未下发的 capability 不可用')
  eq(data.can('setConfig').ok, true, 'data 权限矩阵已切到管理员（可改配置）')
  eq(data.getRole().key, 'admin', 'data.setRole 已同步为 admin')
  ok(!!STORE['silk_auth_session_v1'], '会话已落本地存储')

  console.log('\n[4] 操作员登录：能手动控制、不能改配置/管账户')
  reset([loginOk({ id: 2, username: 'operator01', display_name: '操作员甲', role: 'operator', capabilities: ['view_reading', 'control'] })])
  r = await auth.login('operator01', '123456')
  eq(r.ok, true, '操作员登录成功')
  eq(r.user.role, 'operator', '角色为 operator')
  eq(data.getRole().key, 'operator', 'data 角色切到 operator')
  eq(data.can('manual').ok, true, '操作员可手动控制（需令牌）')
  eq(data.can('manual').needToken, true, '操作员手动控制要令牌')
  eq(data.can('setConfig').ok, false, '操作员不能改配置')
  eq(data.can('audit').ok, false, '操作员不能管账户')

  console.log('\n[5] 登录失败（401）不重试、仍是未登录')
  auth.clearSession()
  reset([errEnvelope(401, 'invalid_credentials')])
  r = await auth.login('admin', 'bad')
  eq(r.ok, false, '密码错误返回失败')
  eq(r.message, '账号或密码错误', '错误文案已翻译')
  eq(CALLS.length, 1, '401 不重试（只有 1 次请求）')
  eq(auth.needsLogin(), true, '失败后仍然需要登录')

  console.log('\n[6] 会话过期：清会话 + 回登录页 + 3 秒去重')
  reset([loginOk()])
  await auth.login('admin', '123456')
  eq(auth.isLoggedIn(), true, '先回到已登录')
  RELAUNCH = []
  auth.handleExpired()
  eq(auth.isLoggedIn(), false, '过期后会话已清')
  eq(auth.getRole(), 'viewer', '过期后角色降为 viewer')
  eq(RELAUNCH.length, 1, '过期后跳登录页一次')
  eq(RELAUNCH[0], '/pages/login/login?expired=1', '跳转地址带 expired=1')
  auth.handleExpired()
  eq(RELAUNCH.length, 1, '3 秒内重复过期只跳一次')

  console.log('\n[7] 关闭闸门后允许演示模式')
  auth.setConfig({ gate: false })
  eq(auth.needsLogin(), false, 'gate:false 时未登录也放行')
  eq(auth.getState().gate, false, 'getState 反映 gate 关闭')
  auth.setConfig({ gate: true })
  eq(auth.needsLogin(), true, '重新打开闸门后又开始拦人')

  console.log('\n──────────────────────────────────────────────────────────')
  if (fails.length) {
    fs.writeSync(1, '失败 ' + fails.length + ' / 通过 ' + pass + '\n')
    fails.forEach((f) => fs.writeSync(1, '  ✗ ' + f + '\n'))
    process.exit(1)
  }
  fs.writeSync(1, '全部通过：' + pass + ' / ' + pass + ' 项\n')
  fs.writeSync(1, 'HTTP 桩件共 ' + CALLS.length + ' 次调用（最后一次：' + (CALLS.length ? CALLS[CALLS.length - 1].method + ' ' + CALLS[CALLS.length - 1].url : '无') + '）\n')
}

main().catch((e) => {
  fs.writeSync(1, '异常：' + (e && e.stack ? e.stack : e) + '\n')
  process.exit(1)
})
