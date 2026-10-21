/**
 * utils/engine.js —— 环境调控模拟 + 规则引擎（规格书 7 章的软件化演示）
 *
 * 实现范围：
 *  7.2 控制模式(auto/offline/manual/safe_lock/maint)
 *  7.3 控制参数(滞回 T_hys/H_hys、冷静期、最短启停)
 *  7.4 温湿度耦合仲裁 A1~A9
 *  7.5 安全联锁 S1~S6
 *  7.6 设备启停保护（雾化/风扇互斥、加热风扇同时开 5 min 上限、风扇寿命轮换、单日启停）
 *  13.2 告警清单 AL01~AL08（含 13.3 抑制 15 min 与去重）
 *  6.4 变化速率限制（升温 ≤1.5℃/h、降温 ≤2.0℃/h、加湿 ≤10%RH/h、除湿 ≤12%RH/h）
 *
 * 说明：真实系统里闭环跑在 ESP32 固件（L2 本地规则层），本文件是前端演示用的等价模拟，
 *       让页面上的设备状态、越限判定、告警三者始终自洽。
 */

import * as data from './data.js'
import * as spec from './spec.js'

/** 全局定时器周期（真实时间，毫秒） */
const TICK_MS = 4000
/** 每分钟模拟时间对应的实时倍速 ≈ SIM_STEP / (TICK_MS/1000) */
const TICK_COUNT = {}

const USERS = {
  admin: '管理员 · 段明',
  operator: '操作员 · 杨丽',
  viewer: '观察员 · 李工',
}

let timer = null
const listeners = []
let started = false

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */
function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v)
}

function nowClock() {
  return data.getState().simClock
}

function currentUser() {
  const st = data.getState()
  return USERS[st.role] || USERS.viewer
}

/** 写审计日志（规格书 7.7 要求记录账号/时间戳/barn-zone/target/action/令牌 ID） */
function logAudit(b, action, target, memo, tokenId) {
  const st = data.getState()
  b.audit.unshift({
    ts: st.simClock,
    role: st.role,
    user: currentUser(),
    action,
    target: target || (b.barn + '/' + b.zone),
    tokenId: tokenId || '',
    memo: memo || '',
  })
  if (b.audit.length > 200) b.audit.length = 200
  data.saveSettings()
}

/** 告警去重与抑制（13.3：去重键 code+barn+zone+device_id，抑制窗口 15 min） */
function raise(b, code, level, deviceId, text, value) {
  const st = data.getState()
  const def = spec.ALARMS.filter((a) => a.code === code)[0] || {}
  const live = b.alarms.filter((a) => a.code === code && a.deviceId === deviceId && !a.cleared)[0]
  if (live) {
    live.text = text // 已有同类活跃告警：只刷新描述，不重复落库
    live.value = value
    return live
  }
  const windowMs = spec.ALARM_DEDUP.suppressWindow * 60000
  const recent = b.alarms.filter((a) => a.code === code && a.deviceId === deviceId && st.simClock - a.ts < windowMs)[0]
  if (recent) return null // 抑制窗口内不再重复告警
  const item = {
    id: code + '-' + b.barn + '-' + st.simClock + '-' + b.alarms.length,
    code,
    level,
    barn: b.barn,
    zone: b.zone,
    deviceId,
    ts: st.simClock,
    value,
    text,
    advice: def.advice || '',
    acked: false,
    ackBy: '',
    active: true,
    cleared: false,
    clearedAt: 0,
  }
  b.alarms.unshift(item)
  if (b.alarms.length > 120) b.alarms.length = 120
  if (level === 'critical') b.serverState = 'ALARM'
  else if (b.serverState === 'NORMAL') b.serverState = 'ALARM'
  return item
}

/** 告警恢复（13.3：发送【告警已恢复】事件通知） */
function clearAlarm(b, code, deviceId) {
  const st = data.getState()
  let hit = false
  b.alarms.forEach((a) => {
    if (a.code === code && a.deviceId === deviceId && a.active && !a.cleared) {
      a.active = false
      a.cleared = true
      a.clearedAt = st.simClock
      hit = true
    }
  })
  if (hit) {
    const active = b.alarms.filter((a) => a.active && !a.cleared)
    if (!active.length) b.serverState = b.online ? 'NORMAL' : 'DEGRADED'
  }
  return hit
}

/** 危险负载强制断电（规格书 1.13 安全侧） */
function cutDangerous(b, keepFanMs) {
  const st = data.getState()
  if (b.devices.heat01.on) {
    b.devices.heat01.on = false
    b.devices.heat01.lastSwitchAt = st.simClock
  }
  if (b.devices.mist01.on) {
    b.devices.mist01.on = false
    b.devices.mist01.lastSwitchAt = st.simClock
  }
  b.devices.heat01.locked = true
  b.devices.mist01.locked = true
  if (keepFanMs) {
    b.devices.fan01.on = true
    b.devices.fan01.locked = true
    b.interlock.fanVentUntil = st.simClock + keepFanMs
  }
}

/** 切换设备（受冷静期 / 最短运行 / 最短停顿时长约束） */
function trySwitch(b, d, want) {
  if (d.on === want) return false
  const st = data.getState()
  const params = getParams()
  const elapsed = (st.simClock - d.lastSwitchAt) / 1000
  if (elapsed < params.t_cool * 60) return false
  if (d.on && !want && elapsed < params.t_on_min) return false
  if (!d.on && want && elapsed < params.t_off_min) return false
  d.on = want
  d.lastSwitchAt = st.simClock
  d.switchesToday += 1
  d.switchLog.push(st.simClock)
  if (d.switchLog.length > 60) d.switchLog.shift()
  return true
}

/** 7.3 控制参数（后续可被参数配置页覆盖） */
let paramOverride = null
function getParams() {
  const out = {}
  spec.CONTROL_PARAMS.forEach((p) => { out[p.key] = p.value })
  if (paramOverride) Object.keys(paramOverride).forEach((k) => { out[k] = paramOverride[k] })
  return out
}
function setParamOverride(patch) {
  paramOverride = Object.assign({}, paramOverride, patch)
}
function getParamOverride() {
  return paramOverride || {}
}

/* ------------------------------------------------------------------ */
/* 环境物理（含 6.4 变化速率限制）                                      */
/* ------------------------------------------------------------------ */
function ambientOf(b, clock) {
  const d = new Date(clock)
  const hour = d.getHours() + d.getMinutes() / 60
  const wave = Math.sin(((hour - 8) / 24) * Math.PI * 2)
  return {
    temp: b.tempBase - 1.4 + wave * 3.0,
    humi: b.humiBase - wave * 6.0 - 2.0,
  }
}

function stepPhysics(b, stepSec) {
  // 自愈：任何原因导致温湿度非有限值时，用确定性基准点复位，避免 NaN 扩散
  if (!isFinite(b.temp) || !isFinite(b.humi)) {
    const p = data.basePoint(b, data.getState().simClock)
    b.temp = p.temp
    b.humi = p.humi
  }
  const amb = ambientOf(b, data.getState().simClock)
  let dT = (amb.temp - b.temp) * 0.012
  let dH = (amb.humi - b.humi) * 0.006
  const on = (id) => b.devices[id] && b.devices[id].on
  if (on('heat01')) { dT += 0.05; dH -= 0.010 }
  if (on('fan01')) { dT -= 0.050; dH -= 0.050 }
  if (on('fan02')) { dT -= 0.050; dH -= 0.050 }
  if (on('mist01')) { dT -= 0.010; dH += 0.330 }

  // 机械化设备对环境的净影响（空调加热 / 排气扇换气排湿）
  const mon = (id) => b.machines && b.machines[id] && b.machines[id].on
  if (mon('ac01')) { dT += 0.045; dH -= 0.015 }
  if (mon('exh01')) { dT -= 0.030; dH -= 0.120 }

  const k = stepSec / 3600
  dT = clamp(dT, -spec.RATE_LIMIT_VALUES.tempDown * k, spec.RATE_LIMIT_VALUES.tempUp * k)
  dH = clamp(dH, -spec.RATE_LIMIT_VALUES.humiDown * k, spec.RATE_LIMIT_VALUES.humiUp * k)

  b.temp = Number(clamp(b.temp + dT, 5, 45).toFixed(2))
  b.humi = Number(clamp(b.humi + dH, 20, 99).toFixed(1))
}

/* ------------------------------------------------------------------ */
/* 7.4 耦合仲裁                                                        */
/* ------------------------------------------------------------------ */
const COUPLING_MAP = {
  'low|low': 'A1', 'low|normal': 'A2', 'low|high': 'A3',
  'normal|low': 'A4', 'normal|normal': 'A9', 'normal|high': 'A5',
  'high|low': 'A6', 'high|normal': 'A7', 'high|high': 'A8',
}

/** 带滞回的区间判定：进入越限立即判定，回到区间需越过滞回带 */
function classify(prev, v, lo, hi, hys) {
  if (v > hi) return 'high'
  if (v < lo) return 'low'
  if (prev === 'high' && v > hi - hys) return 'high'
  if (prev === 'low' && v < lo + hys) return 'low'
  return 'normal'
}

/** 7.6 风扇寿命轮换：优先启动累计运行时长更短的一台 */
function pickFan(b) {
  const f1 = b.devices.fan01
  const f2 = b.devices.fan02
  if (Math.abs(f1.runtimeMin - f2.runtimeMin) > 20 * 60) {
    return f1.runtimeMin <= f2.runtimeMin ? f1 : f2
  }
  return f1
}

function applyCoupling(b, range, stepSec) {
  const params = getParams()
  const tState = classify(b.tempState || 'normal', b.temp, range.tMin, range.tMax, params.t_hys)
  const hState = classify(b.humiState || 'normal', b.humi, range.hMin, range.hMax, params.h_hys)
  b.tempState = tState
  b.humiState = hState
  const code = COUPLING_MAP[tState + '|' + hState] || 'A9'
  b.activeCoupling = code

  const heat = b.devices.heat01
  const mist = b.devices.mist01
  const fanA = pickFan(b)
  const fanB = fanA.id === 'fan01' ? b.devices.fan02 : b.devices.fan01

  let wantHeat = false
  let wantMist = false
  let wantFan = 0
  switch (code) {
    case 'A1': case 'A2': wantHeat = true; break
    case 'A3': wantHeat = true; wantFan = 1; break
    case 'A4': wantMist = true; break
    case 'A5': wantFan = 1; break
    case 'A6': if ((TICK_COUNT[b.barn] || 0) % 2 === 0) wantFan = 1; else wantMist = true; break
    case 'A7': wantFan = 1; break
    case 'A8': wantFan = 2; break
    default: break
  }

  // A9 及安全锁定：全部关停
  if (b.mode === 'safe_lock') {
    wantHeat = false
    wantMist = false
    wantFan = 0
  }

  // 7.6 雾化与风扇禁止同时开启
  if (wantMist && wantFan > 0) wantFan = 0
  if (wantFan > 0 && mist.on) {
    trySwitch(b, mist, false)
    if (mist.on) wantFan = 0
  }

  trySwitch(b, heat, wantHeat)
  trySwitch(b, mist, wantMist)

  // 7.6 加热片与风扇同时开启累计单次上限 5 min，超过强制关闭风扇
  if (heat.on && wantFan > 0) {
    if (!b.coHeatSince) b.coHeatSince = nowClock()
    if (nowClock() - b.coHeatSince > 5 * 60 * 1000) {
      trySwitch(b, fanA, false)
      wantFan = 0
    }
  } else {
    b.coHeatSince = 0
  }

  if (wantFan >= 2) {
    trySwitch(b, fanA, true)
    trySwitch(b, fanB, true)
  } else if (wantFan === 1) {
    trySwitch(b, fanA, true)
    trySwitch(b, fanB, false)
  } else {
    trySwitch(b, fanA, false)
    trySwitch(b, fanB, false)
  }
}

/* ------------------------------------------------------------------ */
/* 7.5 安全联锁                                                        */
/* ------------------------------------------------------------------ */
function checkInterlocks(b, range) {
  const st = data.getState()
  const heat = b.devices.heat01
  const params = getParams()

  // S3 温度超过危险值（固定 32℃，不受龄期品种影响）
  if (b.temp >= 32) {
    if (b.mode !== 'safe_lock') {
      b.interlock = { active: true, code: 'S3', name: '温度超过危险值', at: st.simClock, reason: '实测 ' + b.temp.toFixed(1) + '℃ ≥ 32℃，危险负载强制断电并进入安全锁定', fanVentUntil: 0, heatOnSince: 0 }
      b.mode = 'safe_lock'
      cutDangerous(b, 0)
      raise(b, 'AL05', 'critical', 'th01', '实测温度 ' + b.temp.toFixed(1) + '℃ 达到危险值 32℃，触发 S3 安全联锁')
      logAudit(b, '安全联锁触发', 'grp04', 'S3 温度超过危险值 → SAFE_LOCK')
    }
    return
  }

  // S2 加热片连续工作超时 15 min
  if (heat.on) {
    if (!b.interlock.heatOnSince) b.interlock.heatOnSince = st.simClock
    if (st.simClock - b.interlock.heatOnSince > 15 * 60 * 1000) {
      b.interlock = { active: true, code: 'S2', name: '加热片连续工作超时', at: st.simClock, reason: '加热片连续通电超过 15 min，已强制断电并进入 safe_lock', fanVentUntil: 0, heatOnSince: 0 }
      b.mode = 'safe_lock'
      cutDangerous(b, 0)
      raise(b, 'AL07', 'critical', 'heat01', '加热片连续通电超过 15 min，超时锁定并进入 SAFE_LOCK')
      logAudit(b, '安全联锁触发', 'heat01', 'S2 加热片连续工作超时 → SAFE_LOCK')
      return
    }
  } else {
    b.interlock.heatOnSince = 0
  }

  // S4 传感器失效
  if (!b.sensorOk && b.mode !== 'safe_lock') {
    b.interlock = { active: true, code: 'S4', name: '传感器失效', at: st.simClock, reason: 'sensor_ok=false，加热片与雾化片强制断电、风扇开启 5 min 后关闭', fanVentUntil: 0, heatOnSince: 0 }
    b.mode = 'safe_lock'
    cutDangerous(b, 5 * 60 * 1000)
    raise(b, 'AL05', 'critical', 'th01', '传感器读取异常（卡死/断路/越量程），已进入安全锁定')
    logAudit(b, '安全联锁触发', 'th01', 'S4 传感器失效 → SAFE_LOCK')
    return
  }

  // S1 温度超过“目标上限 +1.5℃”：加热片强制断电（TR02 同时进入 SAFE_LOCK）
  if (b.temp > range.tMax + 1.5) {
    if (heat.on) trySwitch(b, heat, false)
    heat.locked = true
    if (b.mode !== 'safe_lock' && b.mode !== 'maint') {
      b.interlock = { active: true, code: 'S1', name: '温度超过硬上限', at: st.simClock, reason: '温度超过目标上限 +1.5℃（' + (range.tMax + 1.5).toFixed(1) + '℃），加热片强制断电', fanVentUntil: 0, heatOnSince: 0 }
      b.mode = 'safe_lock'
      raise(b, 'AL01', 'warn', 'heat01', '温度 ' + b.temp.toFixed(1) + '℃ 超过硬上限 ' + (range.tMax + 1.5).toFixed(1) + '℃，触发 S1 联锁')
      logAudit(b, '安全联锁触发', 'heat01', 'S1 温度超过硬上限 → 加热片断电，TR02 → SAFE_LOCK')
    }
  }
}

/* ------------------------------------------------------------------ */
/* 告警判定（13.2）                                                    */
/* ------------------------------------------------------------------ */
function checkAlarms(b, range, stepSec) {
  const st = data.getState()
  const c = b.alarmCnt || (b.alarmCnt = { a1: 0, a2: 0, a3: 0, a4: 0, c1: 0, c2: 0, c3: 0, c4: 0 })
  const on = (id) => b.devices[id] && b.devices[id].on

  // AL01 温度越上限：> 上限+1.0℃ 持续 5 min
  if (b.temp > range.tMax + 1.0) { c.a1 += stepSec; c.c1 = 0 } else { c.c1 += stepSec; if (c.c1 >= 300) { c.a1 = 0; clearAlarm(b, 'AL01', 'heat01') } }
  if (c.a1 >= 300) raise(b, 'AL01', 'warn', 'heat01', '温度 ' + b.temp.toFixed(1) + '℃ 高于上限 ' + range.tMax.toFixed(1) + '℃ +1.0℃，已持续 ' + Math.round(c.a1 / 60) + ' min', Number(b.temp.toFixed(1)))

  // AL02 温度越下限：< 下限-1.0℃ 持续 5 min
  if (b.temp < range.tMin - 1.0) { c.a2 += stepSec; c.c2 = 0 } else { c.c2 += stepSec; if (c.c2 >= 300) { c.a2 = 0; clearAlarm(b, 'AL02', 'heat01') } }
  if (c.a2 >= 300) raise(b, 'AL02', 'warn', 'heat01', '温度 ' + b.temp.toFixed(1) + '℃ 低于下限 ' + range.tMin.toFixed(1) + '℃ -1.0℃，已持续 ' + Math.round(c.a2 / 60) + ' min', Number(b.temp.toFixed(1)))

  // AL03 湿度越上限：> 上限+5%RH 持续 10 min
  if (b.humi > range.hMax + 5) { c.a3 += stepSec; c.c3 = 0 } else { c.c3 += stepSec; if (c.c3 >= 300) { c.a3 = 0; clearAlarm(b, 'AL03', 'mist01') } }
  if (c.a3 >= 600) raise(b, 'AL03', 'warn', 'mist01', '湿度 ' + b.humi.toFixed(1) + '%RH 高于上限 ' + range.hMax + '%RH +5%RH，已持续 ' + Math.round(c.a3 / 60) + ' min', b.humi)

  // AL04 湿度越下限：< 下限-5%RH 持续 10 min
  if (b.humi < range.hMin - 5) { c.a4 += stepSec; c.c4 = 0 } else { c.c4 += stepSec; if (c.c4 >= 300) { c.a4 = 0; clearAlarm(b, 'AL04', 'mist01') } }
  if (c.a4 >= 600) raise(b, 'AL04', 'info', 'mist01', '湿度 ' + b.humi.toFixed(1) + '%RH 低于下限 ' + range.hMin + '%RH -5%RH，已持续 ' + Math.round(c.a4 / 60) + ' min', b.humi)

  // AL06 设备离线：心跳超时 180 s
  if (!b.online) raise(b, 'AL06', 'warn', 'th01', '设备心跳超时 180 s 未收到正常状态，已进入离线自治')
  else clearAlarm(b, 'AL06', 'th01')

  // AL08 设备频繁启停：单设备 1 h 内启停 >20 次
  const hourAgo = st.simClock - 3600000
  Object.keys(b.devices).forEach((k) => {
    const d = b.devices[k]
    const n = d.switchLog.filter((t) => t >= hourAgo).length
    if (n > 20) raise(b, 'AL08', 'info', d.id, d.id + ' 近 1 h 内启停 ' + n + ' 次，超过 20 次阈值', n)
  })
  // 注：加热片超时锁定 AL07 与传感器异常 AL05 由安全联锁（S2/S3/S4）负责产生
}

/* ------------------------------------------------------------------ */
/* 单栋 tick                                                           */
/* ------------------------------------------------------------------ */
function tickBarn(b, stepSec) {
  const st = data.getState()
  TICK_COUNT[b.barn] = (TICK_COUNT[b.barn] || 0) + 1
  const range = spec.getTargetRange(b.instar, b.variety)

  // 1) 手动模式 30 min 超时 → 自动
  if (b.mode === 'manual' && st.simClock >= b.manualUntil) {
    b.mode = b.online ? 'auto' : 'offline'
    Object.keys(b.devices).forEach((k) => { b.devices[k].locked = false })
    logAudit(b, '手动模式超时退出', b.barn + '/' + b.zone, '30 min 计时到期，自动切回 ' + data.modeName(b.mode))
  }

  // 2) 心跳 / 离线自治判定（心跳超时 90 s）
  const beatGap = st.simClock - b.lastHeartbeatAt
  if (!b.online) {
    if (!b.offlineSince) b.offlineSince = st.simClock
    if (b.mode !== 'safe_lock' && b.mode !== 'maint') b.mode = 'offline'
  } else if (b.mode === 'offline') {
    b.mode = 'auto'
    b.offlineSince = 0
    logAudit(b, '离线自治恢复', b.barn + '/' + b.zone, '重连成功并完成状态对齐（TR03）')
  }

  // 3) 安全联锁（最高优先级）
  checkInterlocks(b, range)

  // 4) 自动闭环（safe_lock / maint 不动作；manual 冻结自动决策）
  if (b.mode === 'auto' || b.mode === 'offline') {
    applyCoupling(b, range, stepSec)
  } else if (b.mode === 'safe_lock') {
    // 只允许风扇散热
    Object.keys(b.devices).forEach((k) => {
      const d = b.devices[k]
      if (d.kind === 'fan') {
        if (b.interlock.fanVentUntil && st.simClock < b.interlock.fanVentUntil) d.on = true
        else d.on = false
      } else {
        d.on = false
        d.locked = true
      }
    })
  }

  // 5) 物理演进
  const before = { temp: b.temp, humi: b.humi }
  stepPhysics(b, stepSec)
  if (b.sensorOk === false) {
    // 传感器失效时读数保持最后一次有效值（卡死），用于演示 AL05
    b.temp = before.temp
    b.humi = before.humi
  } else {
    b.lastSample = { temp: b.temp, humi: b.humi }
  }

  // 6) 时钟推进（驱动运行时长、启停统计、上报时间）
  Object.keys(b.devices).forEach((k) => {
    const d = b.devices[k]
    if (d.on) d.runtimeMin += stepSec / 60
    d.online = b.online
  })
  // 6.1) 机械化设备：运行时长、周期作业计数、码垛作业推进
  tickMachines(b, stepSec)
  if (!b.lastHeartbeatAt) b.lastHeartbeatAt = st.simClock
  if (b.online) b.lastHeartbeatAt = st.simClock
  if (st.simClock - b.lastReportAt >= 60000) b.lastReportAt = st.simClock

  // 7) 越限累计（1.5 轻度/重度越限判定用）
  if (b.temp > range.tMax) b.due.tempHigh += stepSec
  else if (b.temp < range.tMin) b.due.tempLow += stepSec
  else { b.due.tempHigh = 0; b.due.tempLow = 0 }
  if (b.humi > range.hMax) b.due.humiHigh += stepSec
  else if (b.humi < range.hMin) b.due.humiLow += stepSec
  else { b.due.humiHigh = 0; b.due.humiLow = 0 }

  // 8) 告警（maint 维护模式抑制非 critical 告警）
  if (b.mode !== 'maint') checkAlarms(b, range, stepSec)

  // 9) 趋势点
  b.trend.push({ ts: st.simClock, temp: b.temp, humi: b.humi })
  const liveFrom = st.bootedAt
  while (b.trend.length > 1 && b.trend[1].ts < liveFrom - 3600000) b.trend.shift()
  if (b.trend.length > data.TREND_MAX + 1440) b.trend.splice(0, b.trend.length - (data.TREND_MAX + 1440))
}

/** 推进一个模拟步 */
function tick() {
  const st = data.getState()
  st.simClock += data.SIM_STEP * 1000
  Object.keys(st.barns).forEach((k) => {
    const b = st.barns[k]
    // 每天 0 点重置单日启停计数（7.6 单日最大启停 ≤100 次）
    const d = new Date(st.simClock)
    if (d.getHours() === 0 && d.getMinutes() < 3) {
      Object.keys(b.devices).forEach((id) => { b.devices[id].switchesToday = 0 })
      Object.keys(b.machines).forEach((id) => { b.machines[id].switchesToday = 0 })
    }
    tickBarn(b, data.SIM_STEP)
  })
  notify()
}

function notify() {
  listeners.forEach((fn) => {
    try { fn(data.getState()) } catch (e) { /* 单个订阅者异常不影响其它页面 */ }
  })
}

/* ------------------------------------------------------------------ */
/* 全局定时器                                                          */
/* ------------------------------------------------------------------ */
function start() {
  if (started) return
  started = true
  tick() // 立即跑一步，页面首屏就有完整状态
  timer = setInterval(tick, TICK_MS)
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
  started = false
}

function subscribe(fn) {
  if (listeners.indexOf(fn) < 0) listeners.push(fn)
  return fn
}

function unsubscribe(fn) {
  const i = listeners.indexOf(fn)
  if (i >= 0) listeners.splice(i, 1)
}

/* ------------------------------------------------------------------ */
/* 人工操作（7.7 手动控制规则 + 11.6 审批令牌）                         */
/* ------------------------------------------------------------------ */
function requireRole(b, action) {
  const st = data.getState()
  const p = spec.checkPermission(st.role, action)
  if (!p.ok) {
    logAudit(b, '操作被拒绝', b.barn + '/' + b.zone, '角色权限不足：' + action)
    return { ok: false, message: '当前角色为「' + data.getRole().name + '」，' + p.reason }
  }
  return { ok: true, needToken: p.needToken, message: '' }
}

/** 手动开关单台设备 */
function toggleDevice(barn, deviceId, tokenId) {
  const b = data.getBarn(barn)
  const st = data.getState()
  const dev = b.devices[deviceId]
  if (!dev) return { ok: false, message: '设备不存在：' + deviceId }
  const perm = requireRole(b, 'manual')
  if (!perm.ok) return perm
  if (b.mode === 'safe_lock') return { ok: false, message: '当前为安全锁定（SAFE_LOCK），危险负载禁止开启，请先由管理员解除锁定' }
  if (!b.online) return { ok: false, message: '设备离线（离线自治中），远端指令被拒绝' }
  if (b.sensorOk === false) return { ok: false, message: '传感器失效，加热与雾化负载已联锁断电' }

  // 操作员必须携带管理员签发的 ACTION_TOKEN（维护模式不受令牌限制）
  if (perm.needToken && b.mode !== 'maint') {
    const tk = b.tokens.filter((t) => t.id === tokenId && !t.used && t.expireAt >= st.simClock && t.target === deviceId)[0]
    if (!tk) return { ok: false, message: '需要有效的 ACTION_TOKEN 审批令牌（限 ' + deviceId + '，5 min 内单次有效）' }
    tk.used = true
  }

  const want = !dev.on
  if (want && dev.kind === 'fan') {
    if (b.devices.mist01.on) return { ok: false, message: '7.6 禁止雾化片与风扇同时开启，请先关闭雾化片' }
  }
  if (want && dev.kind === 'mist' && (b.devices.fan01.on || b.devices.fan02.on)) {
    return { ok: false, message: '7.6 禁止雾化片与风扇同时开启，请先关闭风扇' }
  }
  if (want && dev.kind === 'heat' && b.devices.heat01.locked) {
    return { ok: false, message: '加热片处于联锁断电状态，不可开启' }
  }
  if (want && dev.kind === 'heat' && b.machines.ac01 && b.machines.ac01.on) {
    return { ok: false, message: '空调正在运行，加热片与空调禁止同时开启（避免局部过热）' }
  }
  if (want && dev.kind === 'mist' && b.machines.exh01 && b.machines.exh01.on) {
    return { ok: false, message: '排气扇正在运行，雾化片与排气扇禁止同时开启' }
  }

  dev.on = want
  dev.lastSwitchAt = st.simClock
  dev.switchesToday += 1
  dev.switchLog.push(st.simClock)

  // 首次人工操作进入 manual 模式（30 min 倒计时）
  if (b.mode !== 'manual' && b.mode !== 'maint') {
    b.mode = 'manual'
    b.manualUntil = st.simClock + 30 * 60 * 1000
  }
  logAudit(b, want ? '手动开启设备' : '手动关闭设备', deviceId, '手动模式 30 min 计时中，超时自动退回自动', tokenId || '')
  notify()
  return { ok: true, message: dev.name + '已' + (want ? '开启' : '关闭') + '（手动模式 30 min 倒计时开始）' }
}

/** 退出手动模式，回到自动 */
function exitManual(barn) {
  const b = data.getBarn(barn)
  if (b.mode !== 'manual') return { ok: false, message: '当前不在手动模式' }
  b.mode = b.online ? 'auto' : 'offline'
  logAudit(b, '退出手动模式', b.barn + '/' + b.zone, '人工切回 ' + data.modeName(b.mode))
  notify()
  return { ok: true, message: '已切回「' + data.modeName(b.mode) + '」' }
}

/** 切换维护模式（仅管理员） */
function switchMaintenance(barn, on, memo) {
  const b = data.getBarn(barn)
  if (b.mode === 'safe_lock') return { ok: false, message: '存在安全锁定，无法进入维护模式' }
  const perm = requireRole(b, 'maint')
  if (!perm.ok) return perm
  const from = b.mode
  b.mode = on ? 'maint' : (b.online ? 'auto' : 'offline')
  logAudit(b, on ? '进入维护模式' : '退出维护模式', b.barn + '/' + b.zone, '切换前模式 ' + data.modeName(from) + (memo ? '；备注：' + memo : ''))
  notify()
  return { ok: true, message: '已切换到「' + data.modeName(b.mode) + '」' }
}

/** 解除安全锁定（仅管理员，须填原因） */
function unlockSafety(barn, reason) {
  const b = data.getBarn(barn)
  const perm = requireRole(b, 'unlock')
  if (!perm.ok) return perm
  if (b.mode !== 'safe_lock') return { ok: false, message: '当前不在安全锁定状态' }
  if (!reason || !reason.trim()) return { ok: false, message: '解除安全锁定必须填写解除原因' }
  const code = b.interlock.code
  b.mode = b.online ? 'auto' : 'offline'
  Object.keys(b.devices).forEach((k) => {
    b.devices[k].locked = false
  })
  clearAlarm(b, 'AL07', 'heat01')
  clearAlarm(b, 'AL05', 'th01')
  b.alarmCnt = { a1: 0, a2: 0, a3: 0, a4: 0, c1: 0, c2: 0, c3: 0, c4: 0 }
  b.interlock = { active: false, code: '', name: '', at: 0, reason: '', fanVentUntil: 0, heatOnSince: 0 }
  b.serverState = 'NORMAL'
  logAudit(b, '解除安全锁定', b.barn + '/' + b.zone, '故障原始事件 code=' + code + '；解除原因：' + reason)
  notify()
  return { ok: true, message: '安全锁定已解除，已回到「' + data.modeName(b.mode) + '」' }
}

/** 确认告警 */
function ackAlarm(alarmId, memo) {
  const hit = data.findAlarm(alarmId)
  if (!hit) return { ok: false, message: '告警不存在' }
  const b = hit.barn
  const perm = requireRole(b, 'ackAlarm')
  if (!perm.ok) return perm
  const target = b.alarms.filter((a) => a.id === alarmId)[0]
  if (!target) return { ok: false, message: '告警不存在' }
  if (target.cleared) return { ok: false, message: '告警已恢复，无需确认' }
  target.acked = true
  target.ackBy = currentUser()
  logAudit(b, '确认告警', target.deviceId, target.code + ' ' + target.text + (memo ? '；备注：' + memo : ''))
  notify()
  return { ok: true, message: '已确认 ' + target.code }
}

/** 批量确认 */
function ackAll(barn) {
  const list = data.getAlarms(barn, { status: 'unacked' })
  if (!list.length) return { ok: false, message: '没有待确认的告警' }
  const perm = requireRole(data.getBarn(barn), 'ackAlarm')
  if (!perm.ok) return perm
  let n = 0
  list.forEach((a) => {
    const hit = data.findAlarm(a.id)
    if (hit) {
      const t = hit.barn.alarms.filter((x) => x.id === a.id)[0]
      if (t && !t.cleared) { t.acked = true; t.ackBy = currentUser(); n++ }
    }
  })
  logAudit(data.getBarn(barn), '批量确认告警', data.getBarn(barn).barn + '/' + data.getBarn(barn).zone, '共确认 ' + n + ' 条告警')
  notify()
  return { ok: true, message: '已确认 ' + n + ' 条告警' }
}

/** 签发 ACTION_TOKEN（仅管理员） */
function issueToken(barn, target, action, memo) {
  const b = data.getBarn(barn)
  const perm = requireRole(b, 'manual')
  if (!perm.ok) return perm
  const st = data.getState()
  if (st.role !== 'admin') return { ok: false, message: '审批令牌只能由管理员签发' }
  const tk = {
    id: 'TK-' + b.barn.slice(-2) + '-' + String(st.simClock).slice(-6),
    barn: b.barn,
    zone: b.zone,
    target: target || 'heat01',
    action: action || 'toggle',
    issuedBy: currentUser(),
    issuedAt: st.simClock,
    expireAt: st.simClock + spec.TOKEN_RULES.ttlMin * 60 * 1000,
    used: false,
  }
  b.tokens.unshift(tk)
  if (b.tokens.length > 30) b.tokens.length = 30
  logAudit(b, '签发审批令牌', tk.target, 'ACTION_TOKEN ' + tk.id + '，有效期 5 min，单次使用' + (memo ? '；备注：' + memo : ''), tk.id)
  notify()
  return { ok: true, message: '已签发令牌 ' + tk.id + '（5 min 内单次有效）', token: tk }
}

function revokeToken(barn, tokenId) {
  const b = data.getBarn(barn)
  const tk = b.tokens.filter((t) => t.id === tokenId)[0]
  if (!tk) return { ok: false, message: '令牌不存在' }
  tk.used = true
  tk.revoked = true
  logAudit(b, '撤销审批令牌', tk.target, 'ACTION_TOKEN ' + tk.id + ' 已被管理员撤销', tk.id)
  notify()
  return { ok: true, message: '令牌已撤销' }
}

/* ------------------------------------------------------------------ */
/* 参数与配置（6.5 / 7.7 / 12.1 P05）                                   */
/* ------------------------------------------------------------------ */
function legalCheck(tMin, tMax, hMin, hMax) {
  if (tMin < -10 || tMax > 40) return '温度超出合法范围（-10 ~ 40℃）'
  if (hMin < 0 || hMax > 100) return '湿度超出合法范围（0 ~ 100%RH）'
  if (tMin >= tMax) return '温度下限必须小于上限'
  if (hMin >= hMax) return '湿度下限必须小于上限'
  return ''
}

/** 修改龄期/品种/目标区间（仅管理员，二次确认 + 变更原因） */
function applyConfig(barn, patch, note) {
  const b = data.getBarn(barn)
  const perm = requireRole(b, 'setConfig')
  if (!perm.ok) return perm
  if (!note || !note.trim()) return { ok: false, message: '下发配置必须填写变更原因（写入 config_history）' }
  const st = data.getState()
  const oldRange = spec.getTargetRange(b.instar, b.variety)
  const nextInstar = patch.instar || b.instar
  const nextVariety = patch.variety || b.variety
  let nextRange = spec.getTargetRange(nextInstar, nextVariety)
  if (patch.range) {
    nextRange = Object.assign({}, nextRange, patch.range)
    const err = legalCheck(nextRange.tMin, nextRange.tMax, nextRange.hMin, nextRange.hMax)
    if (err) return { ok: false, message: '合法性校验失败：' + err }
  }
  const snapshot = {
    ver: b.config.ver,
    updatedAt: b.config.updatedAt,
    by: b.config.by,
    note: b.config.note,
    instar: b.instar,
    variety: b.variety,
    tMin: oldRange.tMin, tMax: oldRange.tMax, hMin: oldRange.hMin, hMax: oldRange.hMax, tol: oldRange.tol,
  }
  b.config.history.unshift(snapshot)
  if (b.config.history.length > 20) b.config.history.length = 20
  b.instar = nextInstar
  b.variety = nextVariety
  const seg = b.config.ver.split('.')
  const nextVer = 'v' + seg[0].replace('v', '') + '.' + seg[1] + '.' + (Number(seg[2] || 0) + 1)
  b.config = {
    ver: nextVer,
    updatedAt: st.simClock,
    by: currentUser(),
    note,
    history: b.config.history,
  }
  if (patch.params) setParamOverride(patch.params)
  logAudit(b, '下发目标区间配置', b.barn + '/' + b.zone, 'config_ver ' + nextVer + '；' +
    b.instar + '/' + b.variety + ' 目标 ' + nextRange.tMin.toFixed(1) + '~' + nextRange.tMax.toFixed(1) + '℃ / ' +
    nextRange.hMin + '~' + nextRange.hMax + '%RH；变更原因：' + note)
  notify()
  return { ok: true, message: '已下发配置 ' + nextVer + '（设备 60 s 内生效）', ver: nextVer }
}

/** 回滚到历史版本 */
function rollbackConfig(barn, ver, note) {
  const b = data.getBarn(barn)
  const snap = b.config.history.filter((h) => h.ver === ver)[0]
  if (!snap) return { ok: false, message: '未找到版本 ' + ver }
  return applyConfig(barn, { instar: snap.instar, variety: snap.variety, range: { tMin: snap.tMin, tMax: snap.tMax, hMin: snap.hMin, hMax: snap.hMax, tol: snap.tol } }, note || ('回滚到 ' + ver))
}

/* ------------------------------------------------------------------ */
/* 导出 CSV（规格书 F6 / P02 导出 CSV）                                 */
/* ------------------------------------------------------------------ */
function buildCsv(barn, from, to) {
  const b = data.getBarn(barn)
  const series = data.getSeries(barn, from, to)
  const range = spec.getTargetRange(b.instar, b.variety)
  const lines = ['ts,temp_c,humi_rh,t_min,t_max,h_min,h_max,out_of_range']
  series.forEach((p) => {
    const out = p.outTemp !== 0 || p.outHumi !== 0 ? 1 : 0
    lines.push([data.isoUtc(p.ts), p.temp, p.humi, range.tMin, range.tMax, range.hMin, range.hMax, out].join(','))
  })
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* 机械化设备（空调 / 排气扇 / 投叶漏斗 / 抓取机 / 码垛机）             */
/* 都可以人为控制；每台设备带预设工作数据范围，实际参数超出上限或低于   */
/* 下限即「需人为干涉」，人工修正参数或修改预设范围都会写审计日志。      */
/* ------------------------------------------------------------------ */
function getMachines(barn) {
  return data.getMachines(barn)
}

function getMachineSummary(barn) {
  return data.getMachineSummary(barn)
}

function getDiseased(barn) {
  return data.getDiseased(barn)
}

/** 校验操作员令牌（限该机械/设备，5 min 内单次有效） */
function checkToken(b, target, tokenId, needToken) {
  const st = data.getState()
  if (!needToken || b.mode === 'maint') return { ok: true, message: '' }
  const tk = b.tokens.filter((t) => t.id === tokenId && !t.used && t.expireAt >= st.simClock && t.target === target)[0]
  if (!tk) return { ok: false, message: '需要有效的 ACTION_TOKEN 审批令牌（限 ' + target + '，5 min 内单次有效）' }
  tk.used = true
  return { ok: true, message: '' }
}

/** 人为控制机械启停 */
function toggleMachine(barn, machineId, tokenId) {
  const b = data.getBarn(barn)
  const st = data.getState()
  const m = b.machines[machineId]
  if (!m) return { ok: false, message: '机械不存在：' + machineId }
  const perm = requireRole(b, 'manual')
  if (!perm.ok) return perm
  const want = !m.on
  if (want && b.mode === 'safe_lock' && m.kind !== 'exhaust') {
    return { ok: false, message: '当前为安全锁定（SAFE_LOCK），仅排气扇允许运行散热，其余机械禁止启动' }
  }
  if (!b.online) return { ok: false, message: '设备离线（离线自治中），远端指令被拒绝' }
  if (m.locked) return { ok: false, message: m.name + '处于锁定状态，不可操作' }
  const tk = checkToken(b, machineId, tokenId, perm.needToken)
  if (!tk.ok) return tk
  if (want && m.kind === 'hvac' && b.devices.heat01.on) {
    return { ok: false, message: '空调与加热片禁止同时运行（避免局部过热），请先关闭加热片' }
  }
  if (want && m.kind === 'exhaust' && b.devices.mist01.on) {
    return { ok: false, message: '排气扇与雾化片禁止同时开启，请先关闭雾化片' }
  }

  m.on = want
  m.lastSwitchAt = st.simClock
  m.switchesToday += 1
  m.cycleAt = st.simClock
  if (b.mode !== 'manual' && b.mode !== 'maint') {
    b.mode = 'manual'
    b.manualUntil = st.simClock + 30 * 60 * 1000
  }
  logAudit(b, want ? '手动启动机械' : '手动停止机械', machineId,
    m.name + '（' + m.kindName + '）已' + (want ? '启动' : '停止') + '，手动模式 30 min 计时中', tokenId || '')
  notify()
  return { ok: true, message: m.name + '已' + (want ? '启动' : '停止') }
}

/** 人工修正机械工作参数：超出预设范围时必须填写干涉原因 */
function setMachineParam(barn, machineId, key, value, note, tokenId) {
  const b = data.getBarn(barn)
  const st = data.getState()
  const m = b.machines[machineId]
  if (!m) return { ok: false, message: '机械不存在：' + machineId }
  const perm = requireRole(b, 'manual')
  if (!perm.ok) return perm
  const p = m.params.filter((x) => x.key === key)[0]
  if (!p) return { ok: false, message: '参数不存在：' + key }
  const v = Number(value)
  if (!isFinite(v)) return { ok: false, message: '请输入有效的数字' }
  if (v < p.min || v > p.max) {
    return { ok: false, message: p.label + '允许范围 ' + p.min + ' ~ ' + p.max + ' ' + p.unit + '，' + v + ' 超出硬件安全范围' }
  }
  const outOfPreset = v < p.presetLo || v > p.presetHi
  if (outOfPreset && !(note && String(note).trim())) {
    return { ok: false, message: p.label + ' ' + v + ' ' + p.unit + ' 不在预设范围（' + p.presetLo + ' ~ ' + p.presetHi + '）内，请填写人工干涉原因' }
  }
  const tk = checkToken(b, machineId, tokenId, perm.needToken)
  if (!tk.ok) return tk

  const from = p.value
  p.value = v
  p.edited = true
  p.editedBy = currentUser()
  p.editedAt = st.simClock
  m.paramLog.push({
    at: st.simClock, by: currentUser(),
    text: p.label + ' ' + from + ' → ' + v + ' ' + p.unit + (outOfPreset ? '（人工干涉：' + note + '）' : ''),
  })
  if (m.paramLog.length > 60) m.paramLog.shift()
  logAudit(b, outOfPreset ? '人工干涉机械参数' : '修改机械工作参数', machineId,
    p.label + ' ' + from + ' → ' + v + ' ' + p.unit + (note ? '；原因：' + note : ''), tokenId || '')
  notify()
  return { ok: true, message: p.label + '已设为 ' + v + ' ' + p.unit + (outOfPreset ? '（已记录人工干涉原因）' : '') }
}

/** 修改机械预设工作范围（仅管理员，需填写变更原因） */
function setMachinePreset(barn, machineId, key, lo, hi, note) {
  const b = data.getBarn(barn)
  const st = data.getState()
  const m = b.machines[machineId]
  if (!m) return { ok: false, message: '机械不存在：' + machineId }
  const perm = requireRole(b, 'setConfig')
  if (!perm.ok) return perm
  const p = m.params.filter((x) => x.key === key)[0]
  if (!p) return { ok: false, message: '参数不存在：' + key }
  const a = Number(lo)
  const c = Number(hi)
  if (!isFinite(a) || !isFinite(c)) return { ok: false, message: '预设上下限必须是数字' }
  if (a >= c) return { ok: false, message: '预设下限必须小于上限' }
  if (a < p.min || c > p.max) {
    return { ok: false, message: '预设范围必须落在硬件允许范围 ' + p.min + ' ~ ' + p.max + ' ' + p.unit + ' 内' }
  }
  if (!(note && String(note).trim())) return { ok: false, message: '修改预设工作范围需填写变更原因' }
  const fromText = p.presetLo + ' ~ ' + p.presetHi + ' ' + p.unit
  p.presetLo = a
  p.presetHi = c
  m.paramLog.push({ at: st.simClock, by: currentUser(), text: '预设范围 ' + p.label + ' ' + fromText + ' → ' + a + ' ~ ' + c + ' ' + p.unit + '（' + note + '）' })
  if (m.paramLog.length > 60) m.paramLog.shift()
  logAudit(b, '修改机械预设工作范围', machineId, p.label + ' ' + fromText + ' → ' + a + ' ~ ' + c + ' ' + p.unit + '；原因：' + note)
  notify()
  return { ok: true, message: p.label + '预设范围已改为 ' + a + ' ~ ' + c + ' ' + p.unit }
}

/** 机械化设备周期推进：运行时长、投叶/抓取计数（病蚕夹取作业由后端服务端下发，见 utils/clamp.js） */
function tickMachines(b, stepSec) {
  const st = data.getState()
  if (!b.machines) return
  Object.keys(b.machines).forEach((k) => {
    const m = b.machines[k]
    m.online = b.online
    if (m.on) m.runtimeMin += stepSec / 60

    if (m.on && m.kind === 'feed') {
      const iv = m.params.filter((x) => x.key === 'interval')[0]
      const dose = m.params.filter((x) => x.key === 'dose')[0]
      if (st.simClock - m.cycleAt >= iv.value * 60000) {
        m.cycleAt = st.simClock
        m.cycles += 1
        m.lastCycleText = '第 ' + m.cycles + ' 次投叶 ' + dose.value + ' g（' + data.formatClock(st.simClock) + '）'
      }
    }
    if (m.on && m.kind === 'grab') {
      const sp = m.params.filter((x) => x.key === 'speed')[0]
      const ly = m.params.filter((x) => x.key === 'layers')[0]
      const periodSec = Math.max(45, Math.round(240 * (60 / Math.max(10, sp.value))))
      if (st.simClock - m.cycleAt >= periodSec * 1000) {
        m.cycleAt = st.simClock
        m.cycles += 1
        m.lastCycleText = '第 ' + m.cycles + ' 次抓取 ' + ly.value + ' 层（' + data.formatClock(st.simClock) + '）'
      }
    }
  })
}

export {
  TICK_MS,
  start,
  stop,
  tick,
  subscribe,
  unsubscribe,
  toggleDevice,
  getMachines,
  getMachineSummary,
  getDiseased,
  toggleMachine,
  setMachineParam,
  setMachinePreset,
  tickMachines,
  exitManual,
  switchMaintenance,
  unlockSafety,
  ackAlarm,
  ackAll,
  issueToken,
  revokeToken,
  applyConfig,
  rollbackConfig,
  buildCsv,
  getParams,
  setParamOverride,
  getParamOverride,
  logAudit,
  raise,
  clearAlarm,
}
