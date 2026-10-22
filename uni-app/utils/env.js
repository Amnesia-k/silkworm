/**
 * utils/env.js —— 环境调控 barn-api 数据客户端（App 侧）
 *
 * 依据《前端接口交付.md》§1、§2.3、§3.2、§4：
 *  - baseUrl = `{ENV}` = http://10.66.66.1/api（**已含 /api**，只走 WireGuard 隧道）；
 *  - 鉴权用 auth.js 的 JWT（Bearer），401 由 http.js 自动 refresh 一次；
 *  - 成功响应是**裸对象**，失败固定 {error:{code,message,detail}}；
 *  - `granularity` 只支持 min / raw（hour → 400）；limit ≤ 2000；
 *  - 指令 target 与状态键不同名：heat01/mist01 ↔ heater/mist（§3.4 第 4 条）。
 */
import * as http from './http.js'
import * as auth from './auth.js'

const TARGET_DEVICE = { heat01: 'heater', mist01: 'mist', fan01: 'fan01', fan02: 'fan02' }
const DEVICE_TARGET = { heater: 'heat01', mist: 'mist01', fan01: 'fan01', fan02: 'fan02' }

const LEVEL_TEXT = { info: '提示', warn: '警告', critical: '紧急' }
const LEVEL_TONE = { info: 'blue', warn: 'orange', critical: 'red' }

const ALARM_TEXT = {
  AL01: '温度超上限', AL02: '温度低于下限', AL03: '湿度超上限', AL04: '湿度低于下限',
  AL05: '传感器异常', AL06: '设备离线', AL07: '加热超时', AL08: '设备频繁启停',
  E2001: '指令未确认', E2002: '安全联锁', E2003: '安全联锁', E2004: '设备复位',
  E2005: '雾化缺水', E3001: '缺水', E3002: '供水恢复',
  DC01: '病蚕识别', DC02: '病蚕裁定', DC03: '夹取下发', DC04: '夹取失败', DC05: '夹取完成',
}

const ERROR_TEXT = {
  bad_request: '请求参数不合法',
  invalid_target: '目标设备不合法（heat01/mist01/fan01/fan02）',
  invalid_action: '动作不合法（只支持 on / off）',
  token_required: '该操作需要审批令牌',
  token_scope_mismatch: '令牌作用范围与目标不一致',
  unauthorized: '登录已过期，请重新登录',
  forbidden: '当前账号没有该操作权限',
  invalid_token: '令牌无效',
  token_used: '令牌已被使用',
  token_expired: '令牌已过期',
  token_revoked: '令牌已被撤销',
  alarm_not_found: '告警不存在',
  zone_not_found: '区域不存在',
  conflict: '状态冲突，请刷新后重试',
  dispatch_blocked: '调度闸门拦截，指令未下发',
  retry_after: '请求过于频繁，请稍后再试',
  mqtt_unavailable: '设备通道不可用（MQTT 断开），指令未下发',
  publish_failed: '指令下发失败，请稍后重试',
  TIMEOUT: '请求超时，请检查隧道/网络',
  NETWORK: '连接失败：请确认已连上 WireGuard 隧道',
  UNAUTHORIZED: '未登录或登录已过期，请先登录',
}

function cfg() {
  const c = auth.getConfig()
  return { baseUrl: c.baseUrl, timeoutMs: c.timeoutMs }
}

function text(code, message) { return ERROR_TEXT[code] || message || '请求失败' }

function call(method, path, opts) {
  const o = opts || {}
  const c = cfg()
  return http.request({
    base: c.baseUrl,
    path: path,
    method: method,
    query: o.query,
    body: o.body,
    token: auth.token(),
    timeout: o.timeout || c.timeoutMs,
    retry: o.retry === undefined ? (method === 'GET' ? 1 : 0) : o.retry,
    envelope: 'env',
    headers: o.headers,
  }).then((res) => {
    if (res.ok) return res
    return Object.assign(res, { message: text(res.code, res.message) })
  })
}

/* ---------------- 归一化 ---------------- */
function targetRangeOf(tr, fallback) {
  const f = fallback || {}
  const t = tr || {}
  const tMin = Number(t.t_min !== undefined ? t.t_min : f.tMin)
  const tMax = Number(t.t_max !== undefined ? t.t_max : f.tMax)
  const hMin = Number(t.h_min !== undefined ? t.h_min : f.hMin)
  const hMax = Number(t.h_max !== undefined ? t.h_max : f.hMax)
  return {
    tMin: isFinite(tMin) ? tMin : 0, tMax: isFinite(tMax) ? tMax : 0,
    hMin: isFinite(hMin) ? hMin : 0, hMax: isFinite(hMax) ? hMax : 0,
    tempText: (isFinite(tMin) ? tMin.toFixed(1) : '--') + ' ~ ' + (isFinite(tMax) ? tMax.toFixed(1) : '--') + '℃',
    humiText: (isFinite(hMin) ? Math.round(hMin) : '--') + ' ~ ' + (isFinite(hMax) ? Math.round(hMax) : '--') + '%RH',
  }
}

function statesToDevices(raw) {
  const d = raw || {}
  return {
    heat01: { on: !!(d.heater && d.heater.on !== false && d.heater !== false), locked: !!(d.heater && d.heater.locked) },
    fan01: { on: !!(d.fan01 && d.fan01.on !== false && d.fan01 !== false), locked: false },
    fan02: { on: !!(d.fan02 && d.fan02.on !== false && d.fan02 !== false), locked: false },
    mist01: { on: !!(d.mist && d.mist.on !== false && d.mist !== false), locked: !!(d.mist && d.mist.locked) },
  }
}

function normalizeRealtime(raw, barn) {
  const r = raw || {}
  const t = Number(r.temp)
  const h = Number(r.humi)
  const devs = Array.isArray(r.devices) ? r.devices : []
  const states = {}
  devs.forEach((d) => {
    const id = d.device_id || d.id || ''
    if (!id) return
    const st = d.states || {}
    states[id] = { on: st.on === true || st.power === true || st.online === true, raw: st }
  })
  const heat = states.heat01 || {}
  const mist = states.mist01 || {}
  return {
    ok: true,
    ts: Number(r.ts) || Date.now(),
    temp: isFinite(t) ? t : null,
    humi: isFinite(h) ? h : null,
    sensorOk: r.sensor_ok !== false,
    mode: r.mode || 'auto',
    instar: r.instar || '',
    variety: r.variety || '',
    target: targetRangeOf(r.target_range),
    outOfRange: {
      temperature: !!(r.out_of_range && r.out_of_range.temperature),
      humidity: !!(r.out_of_range && r.out_of_range.humidity),
    },
    devices: devs.map((d) => ({
      id: d.device_id || d.id || '',
      status: d.status || (d.last_seen_ts ? 'online' : 'offline'),
      online: d.status !== 'offline',
      lastSeen: Number(d.last_seen_ts) || 0,
      states: d.states || {},
    })),
    deviceMap: {
      heat01: { on: heat.on === true, locked: !!(heat.raw && heat.raw.locked) },
      fan01: { on: (states.fan01 || {}).on === true },
      fan02: { on: (states.fan02 || {}).on === true },
      mist01: { on: mist.on === true, locked: !!(mist.raw && mist.raw.locked) },
    },
    activeAlarms: Number(r.active_alarms) || 0,
    barn: barn || r.barn || '',
    raw: r,
  }
}

function normalizeAlarm(raw) {
  const a = raw || {}
  const code = a.code || ''
  return {
    id: a.event_id !== undefined ? String(a.event_id) : (a.id !== undefined ? String(a.id) : ''),
    eventId: a.event_id !== undefined ? a.event_id : a.id,
    code: code,
    codeText: ALARM_TEXT[code] || '',
    name: a.name || ALARM_TEXT[code] || code || '告警',
    level: a.level || 'info',
    levelText: LEVEL_TEXT[a.level] || '提示',
    levelTone: LEVEL_TONE[a.level] || 'blue',
    status: a.status || 'active',
    statusText: a.status === 'confirmed' ? '已确认' : (a.status === 'cleared' ? '已恢复' : '未确认'),
    statusTone: a.status === 'confirmed' ? 'green' : (a.status === 'cleared' ? 'gray' : 'orange'),
    deviceId: a.device_id || '',
    at: Number(a.event_ts) || 0,
    timeText: a.event_ts ? formatTs(a.event_ts) : '--',
    detail: a.detail || '',
    confirmUser: a.confirm_user_id || '',
    confirmAt: Number(a.confirm_ts) || 0,
    clearedAt: Number(a.cleared_ts) || 0,
    canConfirm: a.status === 'active',
    raw: a,
  }
}

function formatTs(ts) {
  const n = Number(ts)
  if (!n) return '--'
  const d = new Date(n)
  const p = (x) => (x < 10 ? '0' + x : '' + x)
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

function normalizePoint(raw) {
  const p = raw || {}
  return { ts: Number(p.ts) || 0, temp: Number(p.temp), humi: Number(p.humi) }
}

/* ---------------- 接口 ---------------- */
function health() { return call('GET', '/health', { retry: 0 }) }

function realtime(barn, zone) {
  return call('GET', '/realtime/' + barn + '/' + zone).then((res) => {
    if (!res.ok) return res
    return { ok: true, data: normalizeRealtime(res.data, barn) }
  })
}

function devices(barn, zone) { return call('GET', '/devices/' + barn + '/' + zone) }

function alarms(opts) {
  const o = opts || {}
  const query = {
    barn: o.barn, zone: o.zone, level: o.level, status: o.status, code: o.code,
    start: o.start, end: o.end, limit: Math.min(1000, o.limit || 50), offset: o.offset || 0,
  }
  return call('GET', '/alarms', { query: query }).then((res) => {
    if (!res.ok) return res
    const d = res.data || {}
    const items = Array.isArray(d.items) ? d.items : (Array.isArray(d) ? d : [])
    return { ok: true, total: Number(d.total) || items.length, list: items.map(normalizeAlarm) }
  })
}

function alarmSummary(hours) {
  return call('GET', '/alarms/summary', { query: { hours: hours || 24 } }).then((res) => {
    if (!res.ok) return res
    const d = res.data || {}
    const byLevel = d.by_level || {}
    const byCode = Array.isArray(d.by_code) ? d.by_code : []
    return {
      ok: true,
      hours: Number(d.hours) || hours || 24,
      active: Number(d.active) || 0,
      byLevel: { info: Number(byLevel.info) || 0, warn: Number(byLevel.warn) || 0, critical: Number(byLevel.critical) || 0 },
      byCode: byCode.map((x) => ({ code: x.code || '', count: Number(x.count) || 0, name: ALARM_TEXT[x.code] || x.code || '' })),
    }
  })
}

function confirmAlarm(eventId) {
  return call('POST', '/alarms/' + eventId + '/confirm', { retry: 0 }).then((res) => {
    if (!res.ok) return res
    return { ok: true, message: '已确认', data: res.data }
  })
}

function alarmDetail(eventId) { return call('GET', '/alarms/' + eventId) }

function history(barn, zone, opts) {
  const o = opts || {}
  const query = {
    start: o.start, end: o.end,
    granularity: o.granularity === 'raw' ? 'raw' : 'min',
    limit: Math.min(2000, o.limit || 200),
  }
  return call('GET', '/history/' + barn + '/' + zone, { query: query }).then((res) => {
    if (!res.ok) return res
    const d = res.data || {}
    const points = Array.isArray(d.points) ? d.points.map(normalizePoint) : []
    return {
      ok: true,
      granularity: d.granularity || query.granularity,
      points: points.filter((p) => p.ts && isFinite(p.temp) && isFinite(p.humi)),
      overrange: Array.isArray(d.overrange) ? d.overrange : [],
      stats: d.stats || {},
    }
  })
}

function schedulerState(barn, zone) { return call('GET', '/scheduler/state/' + barn + '/' + zone) }

/** 手动控制：action = on | off；target = heat01 | mist01 | fan01 | fan02 */
function manual(barn, zone, target, action, opts) {
  const o = opts || {}
  const body = { barn: barn, zone: zone, target: target, action: action }
  if (o.token) body.token = o.token
  if (o.remark) body.remark = o.remark
  return call('POST', '/control/manual', { body: body, retry: 0, timeout: Math.max(15000, cfg().timeoutMs) }).then((res) => {
    if (!res.ok) return res
    const d = res.data || {}
    return { ok: true, cmdId: d.cmd_id || '', mode: d.mode || 'manual', remainSec: Number(d.remain_sec) || 0, target: d.target || target, action: d.action || action, data: d }
  })
}

function manualState(barn, zone) { return call('GET', '/control/manual/state', { query: { barn: barn, zone: zone } }) }

function manualExit(barn, zone) {
  return call('POST', '/control/manual/exit', { body: { barn: barn, zone: zone }, retry: 0 }).then((res) => {
    if (!res.ok) return res
    const d = res.data || {}
    return { ok: true, mode: d.mode || 'auto', cmdId: d.cmd_id || '', dispatched: !!d.dispatched, detail: d.detail || '' }
  })
}

export {
  TARGET_DEVICE, DEVICE_TARGET, LEVEL_TEXT, LEVEL_TONE, ALARM_TEXT, ERROR_TEXT,
  normalizeRealtime, normalizeAlarm, normalizePoint, formatTs, targetRangeOf, statesToDevices,
  health, realtime, devices, alarms, alarmSummary, confirmAlarm, alarmDetail,
  history, schedulerState, manual, manualState, manualExit,
}
