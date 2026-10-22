/**
 * utils/live.js —— 实时数据适配层（把 barn-api 的实时数据喂给现有页面）
 *
 * 设计取舍：
 *  - 页面（index / history / alerts / control）原本读 utils/data.js 的同步视图；
 *    这里把「登录后的真实数据」装配成**同样形状**的视图，页面只多一步 `live.*`。
 *  - 后端没有的字段（耦合仲裁 A1~A9、联锁明细、WiFi 信号）一律置空/置中性，
 *    不再用模拟值冒充实测值；视图里带 `live: true` 供页面隐藏那些区块。
 *  - 蚕房清单后端没有接口（交付单 §6），沿用 data.js 的静态台账。
 */
const data = require('./data.js')
const env = require('./env.js')
const auth = require('./auth.js')

const POLL_MS = 5000
let STATE = { ok: false, loading: false, message: '', at: 0, barn: '', users: [] }
let TIMER = null
let INFLIGHT = null

function enabled() { return auth.isLoggedIn() }
function pad(n) { return n < 10 ? '0' + n : '' + n }
function clockText(ms) {
  const d = new Date(ms || Date.now())
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}

function getState() { return Object.assign({}, STATE) }

/* ---------------- 状态视图（与 data.getStatusSummary 同形） ---------------- */
function buildStatus(barn, rt) {
  const base = data.getStatusSummary(barn) || {}
  const b = data.getBarn(barn) || {}
  const t = rt.temp
  const h = rt.humi
  const modeName = { auto: '自动模式', manual: '手动模式', offline: '离线自治', safe_lock: '安全锁定', maint: '维护模式' }[rt.mode] || rt.mode
  const modeTone = rt.mode === 'auto' ? 'green' : (rt.mode === 'manual' ? 'blue' : (rt.mode === 'safe_lock' ? 'red' : 'orange'))
  const out = Object.assign({}, base, {
    live: true,
    barn: b.barn || barn,
    zone: b.zone || '',
    group: b.group || '',
    name: b.name || barn,
    area: b.area || 0,
    instar: rt.instar || b.instar || '',
    variety: rt.variety || b.variety || '',
    temp: t === null ? base.temp : t,
    humi: h === null ? base.humi : h,
    tempText: t === null ? '--' : t.toFixed(1) + '℃',
    humiText: h === null ? '--' : h.toFixed(1) + '%RH',
    mode: rt.mode,
    modeName: modeName,
    modeTone: modeTone,
    modeInfo: { name: modeName, tone: modeTone },
    online: true,
    wifi: 0,
    wifiBars: 0,
    wifiText: '隧道直连',
    sensorOk: rt.sensorOk,
    lastReportText: clockText(rt.ts),
    target: rt.target,
    outOfRange: {
      temperature: rt.outOfRange.temperature,
      humidity: rt.outOfRange.humidity,
      level: (rt.outOfRange.temperature || rt.outOfRange.humidity) ? 'heavy' : 'normal',
      text: (rt.outOfRange.temperature || rt.outOfRange.humidity) ? '实时越限' : '区间内',
    },
    interlock: { active: false, code: '', name: '', at: 0, reason: '', fanVentUntil: 0, heatOnSince: 0 },
    coupling: '--',
    couplingInfo: { code: '--', case: '实时模式后端不提供耦合仲裁', name: '耦合仲裁' },
    devices: deviceSummary(barn, rt.deviceMap),
    alarms: { active: rt.activeAlarms, total: rt.activeAlarms, list: [] },
    serverState: 'live',
    serverStateName: '已连接',
    simClock: rt.ts,
    simClockText: clockText(rt.ts),
    isoText: new Date(rt.ts).toISOString(),
  })
  return out
}

function mergeDevices(barn, map) {
  const list = data.getDevices(barn) || []
  return list.map((d) => {
    const lv = map && map[d.id]
    if (!lv) return Object.assign({}, d, { live: true })
    const on = !!lv.on
    const locked = !!lv.locked
    return Object.assign({}, d, {
      live: true,
      on: on,
      locked: locked,
      stateText: on ? '运行中' : '已停止',
      lockText: locked ? '安全联锁断电' : '',
      canSwitch: !locked,
    })
  })
}

function deviceSummary(barn, map) {
  const list = mergeDevices(barn, map)
  return {
    total: list.length,
    on: list.filter((d) => d.on).length,
    offline: 0,
    locked: list.filter((d) => d.locked).length,
    heat: list.filter((d) => d.kind === 'heat')[0] || null,
    fans: list.filter((d) => d.kind === 'fan'),
    mist: list.filter((d) => d.kind === 'mist')[0] || null,
    list: list,
  }
}

/* ---------------- 告警视图（与 data.getAlarms 同形） ---------------- */
function toAlarmView(a) {
  return {
    id: a.id,
    eventId: a.eventId,
    code: a.code,
    codeText: a.codeText,
    name: a.name,
    level: a.level,
    levelText: a.levelText,
    levelTone: a.levelTone,
    status: a.status === 'confirmed' ? 'acked' : (a.status === 'cleared' ? 'cleared' : 'active'),
    statusText: a.statusText,
    statusTone: a.statusTone,
    deviceId: a.deviceId,
    at: a.at,
    timeText: a.timeText,
    detail: a.detail,
    confirmUser: a.confirmUser,
    confirmAt: a.confirmAt,
    clearedAt: a.clearedAt,
    canConfirm: a.canConfirm,
    live: true,
  }
}

/* ---------------- 对外接口 ---------------- */
function status(barn) {
  const key = (data.getBarn(barn) || {}).barn || barn
  return env.realtime(key, (data.getBarn(key) || {}).zone || 'zone01').then((res) => {
    if (!res.ok) {
      STATE.ok = false; STATE.message = res.message; return res
    }
    STATE.ok = true; STATE.message = ''; STATE.at = Date.now(); STATE.barn = key
    return { ok: true, data: buildStatus(key, res.data) }
  })
}

function alarms(barn, opts) {
  const key = (data.getBarn(barn) || {}).barn || barn
  const zone = (data.getBarn(key) || {}).zone || 'zone01'
  return env.alarms(Object.assign({ barn: key, zone: zone }, opts || {})).then((res) => {
    if (!res.ok) return res
    return { ok: true, total: res.total, list: res.list.map(toAlarmView) }
  })
}

function series(barn, from, to, opts) {
  const key = (data.getBarn(barn) || {}).barn || barn
  const zone = (data.getBarn(key) || {}).zone || 'zone01'
  return env.history(key, zone, Object.assign({ start: from, end: to }, opts || {}))
}

function toggle(barn, deviceId, on, opts) {
  const key = (data.getBarn(barn) || {}).barn || barn
  const zone = (data.getBarn(key) || {}).zone || 'zone01'
  const target = env.DEVICE_TARGET[deviceId] || deviceId
  return env.manual(key, zone, target, on ? 'on' : 'off', opts || {})
}

function exitManual(barn) {
  const key = (data.getBarn(barn) || {}).barn || barn
  const zone = (data.getBarn(key) || {}).zone || 'zone01'
  return env.manualExit(key, zone)
}

function manualState(barn) {
  const key = (data.getBarn(barn) || {}).barn || barn
  const zone = (data.getBarn(key) || {}).zone || 'zone01'
  return env.manualState(key, zone)
}

function confirmAlarm(eventId) { return env.confirmAlarm(eventId) }

/** 轮询：页面进入时 start，离开时 stop（模块级唯一定时器） */
function start(barn, fn) {
  STATE.barn = (data.getBarn(barn) || {}).barn || barn
  if (fn && STATE.users.indexOf(fn) < 0) STATE.users.push(fn)
  if (TIMER) return
  tick()
  TIMER = setInterval(tick, POLL_MS)
}

function stop(fn) {
  if (fn) {
    const i = STATE.users.indexOf(fn)
    if (i >= 0) STATE.users.splice(i, 1)
  } else {
    STATE.users.length = 0
  }
  if (!STATE.users.length && TIMER) { clearInterval(TIMER); TIMER = null }
}

function tick() {
  if (!enabled() || !STATE.barn) return
  if (INFLIGHT) return
  const key = STATE.barn
  INFLIGHT = Promise.all([status(key), alarms(key, { status: 'active', limit: 10 })])
    .then((rs) => {
      INFLIGHT = null
      if (!rs[0].ok) return
      const st = rs[0].data
      const list = rs[1] && rs[1].ok ? rs[1].list : []
      /* 写进 data.js 的实机覆盖层：页面照旧读 data.get*，读到的是实时值 */
      data.setLiveStatus(key, st)
      data.setLiveDevices(key, st.devices.list)
      data.setLiveAlarms(key, list, { status: 'active' })
      data.setLiveAlarms(key, list, { status: '' })
      const payload = { ok: true, status: st, alarms: list }
      STATE.users.slice().forEach((fn) => { try { fn(payload) } catch (e) { console.error('[live] 订阅回调异常', e) } })
    })
    .catch((e) => { INFLIGHT = null; console.error('[live] 轮询失败', e) })
}

/** 立即拉一次（页面手动刷新用；与轮询共用同一定时器逻辑） */
function refresh() {
  return tick()
}

module.exports = {
  POLL_MS, enabled, getState, buildStatus, toAlarmView,
  status, alarms, series, toggle, exitManual, manualState, confirmAlarm,
  start, stop, tick, refresh,
}
