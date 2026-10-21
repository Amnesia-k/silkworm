/**
 * utils/data.js —— 规格书对象模型（barn / zone / group / device）运行态与查询层
 *
 * 约定：
 *  - 本文件只负责"数据"，控制逻辑在 utils/engine.js；
 *  - 演示态保存在内存中，仅把轻量设置（角色 / 当前蚕房 / 参数覆盖 / 审计尾部）落本地缓存，
 *    避免把 24 h 曲线写进 storage（小程序单 key 上限 1 MB）；
 *  - 历史曲线与日报所需的"过去数据"由确定性函数 basePoint() 按时间戳推算，
 *    不占用存储，任意时间段都能查（对应规格书 10.3 分钟/小时聚合）。
 */

const spec = require('./spec.js')

const STORAGE_KEY = 'silk_settings_v2'
/** 每 tick 推进的模拟秒数：全局定时器每 4 s 触发一次 → 约 30 倍速演示 */
const SIM_STEP = 120
/** 在线滚动趋势点数量 */
const TREND_MAX = 160

/* ------------------------------------------------------------------ */
/* 实机对接覆盖层（utils/gateway.js 写入；未接入实机时始终为空）         */
/* 约定：实机模式下页面照旧调本文件的 getter，读到的是覆盖层里的实机值；  */
/*       覆盖层为空（模拟模式 / 实机未就绪）时按原模拟逻辑计算，行为一致。 */
/* ------------------------------------------------------------------ */
let LIVE = { status: {}, series: {}, hourly: {}, alarms: {}, devices: {}, machines: {}, config: {}, report: {} }

function liveKey(barn) {
  const b = getBarn(barn)
  return b ? b.barn : ''
}
function putLive(kind, key, value) { if (key) LIVE[kind][key] = value }
function setLiveStatus(barnKey, value) { putLive('status', liveKey(barnKey), value) }
function setLiveSeries(barnKey, from, to, points) { putLive('series', liveKey(barnKey) + ':' + from + ':' + to, points) }
function setLiveHourly(barnKey, from, to, rows) { putLive('hourly', liveKey(barnKey) + ':' + from + ':' + to, rows) }
function setLiveAlarms(barnKey, list, filter) {
  const fk = typeof filter === 'string' ? filter : ((filter && filter.status) || '')
  putLive('alarms', liveKey(barnKey) + ':' + fk, list)
}
function setLiveDevices(barnKey, list) { putLive('devices', liveKey(barnKey), list) }
function setLiveMachines(barnKey, list) { putLive('machines', liveKey(barnKey), list) }
function setLiveConfig(barnKey, view) { putLive('config', liveKey(barnKey), view) }
function setLiveReport(barnKey, dateMs, view) { putLive('report', liveKey(barnKey) + ':' + dateMs, view) }
function clearLive() { LIVE = { status: {}, series: {}, hourly: {}, alarms: {}, devices: {}, machines: {}, config: {}, report: {} } }
function hasLive() { return Object.keys(LIVE.status).length + Object.keys(LIVE.series).length > 0 }

/* ------------------------------------------------------------------ */
/* 蚕房台账（barn / zone / group 一一对应，编号遵循 3.2 规范）        */
/* ------------------------------------------------------------------ */
const BARN_SEEDS = [
  {
    barn: 'barn01', zone: 'zone01', group: 'grp01', name: '1号蚕房',
    area: 30, variety: 'V1', instar: 'I4', tempBase: 24.6, humiBase: 72.0,
    online: true, wifi: -52, sensorOk: true, mode: 'auto',
  },
  {
    barn: 'barn02', zone: 'zone02', group: 'grp02', name: '2号蚕房',
    area: 30, variety: 'V2', instar: 'I2', tempBase: 25.6, humiBase: 88.5,
    online: true, wifi: -61, sensorOk: true, mode: 'auto',
  },
  {
    barn: 'barn03', zone: 'zone03', group: 'grp03', name: '3号蚕房',
    area: 30, variety: 'V3', instar: 'I5', tempBase: 22.0, humiBase: 67.0,
    online: false, wifi: -78, sensorOk: true, mode: 'auto',
  },
  {
    barn: 'barn04', zone: 'zone04', group: 'grp04', name: '4号蚕房',
    area: 30, variety: 'V1', instar: 'I6', tempBase: 24.8, humiBase: 69.0,
    online: true, wifi: -55, sensorOk: true, mode: 'auto',
  },
]

const DEVICE_SEEDS = [
  { id: 'heat01', name: '加热片', kind: 'heat', model: 'ST201 5W PTC', spec: 'DC5V / 约 0.42 A，继电器常开触点', effect: { temp: 0.9, humi: -0.4 } },
  { id: 'fan01', name: '风扇 1', kind: 'fan', model: '4010 DC5V', spec: '3000 rpm，2~3 CFM，0.15 A', effect: { temp: -0.7, humi: -1.6 } },
  { id: 'fan02', name: '风扇 2', kind: 'fan', model: '4010 DC5V', spec: '3000 rpm，2~3 CFM，0.15 A', effect: { temp: -0.7, humi: -1.6 } },
  { id: 'mist01', name: '雾化片', kind: 'mist', model: '超声波 φ20 + 驱动板', spec: '约 300 mL/h，108 kHz，缺水保护，DC5V / 约 0.8 A', effect: { temp: -0.2, humi: 1.4 } },
]

/* ------------------------------------------------------------------ */
/* 机械化设备（空调/排气扇/投叶漏斗/抓取机/码垛机）                     */
/* 每台设备都带「预设工作数据范围」：参数实际值超出上限或低于下限        */
/* 即为「需人为干涉」，由人工在小程序里修正参数或改预设范围。            */
/* ------------------------------------------------------------------ */
const MACHINE_SEEDS = [
  {
    id: 'ac01', name: '空调', kind: 'hvac', kindName: '加热',
    model: '壁挂 1.5 P', spec: '负责蚕房加热，是加热片（D03）之外的补强热源，与加热片禁止同时运行',
    effect: { temp: 1.0, humi: -0.5 },
    params: [
      { key: 'targetTemp', label: '目标温度', unit: '℃', min: 18, max: 35, step: 0.5, value: 25.5, presetLo: 24, presetHi: 27 },
      { key: 'level', label: '运行档位', unit: '档', min: 1, max: 5, step: 1, value: 2, presetLo: 1, presetHi: 3 },
    ],
  },
  {
    id: 'exh01', name: '排气扇', kind: 'exhaust', kindName: '换气',
    model: '轴流 200 mm', spec: '负责换气排湿，与雾化片禁止同时开启（雾被吹散且湿度读数失真）',
    effect: { temp: -0.5, humi: -2.0 },
    params: [
      { key: 'airflow', label: '换气档位', unit: '档', min: 1, max: 5, step: 1, value: 3, presetLo: 2, presetHi: 4 },
      { key: 'duration', label: '单次时长', unit: 'min', min: 1, max: 30, step: 1, value: 10, presetLo: 5, presetHi: 15 },
    ],
  },
  {
    id: 'feed01', name: '投叶漏斗', kind: 'feed', kindName: '投叶',
    model: '振动式投叶机', spec: '按设定间隔定时定量投放桑叶，投叶量需随龄期人工调整',
    effect: null,
    params: [
      { key: 'dose', label: '单次投叶量', unit: 'g', min: 50, max: 1000, step: 10, value: 320, presetLo: 200, presetHi: 500 },
      { key: 'interval', label: '投叶间隔', unit: 'min', min: 30, max: 720, step: 10, value: 240, presetLo: 180, presetHi: 360 },
    ],
  },
  {
    id: 'grab01', name: '抓取机', kind: 'grab', kindName: '搬运',
    model: '三轴抓取臂', spec: '抓取蚕箔并放到传送带，速度与单次层数按作业需要调整',
    effect: null,
    params: [
      { key: 'speed', label: '抓取速度', unit: '%', min: 10, max: 100, step: 5, value: 60, presetLo: 40, presetHi: 80 },
      { key: 'layers', label: '单次层数', unit: '层', min: 1, max: 10, step: 1, value: 3, presetLo: 1, presetHi: 6 },
    ],
  },
  {
    id: 'pal01', name: '码垛机', kind: 'pallet', kindName: '码垛',
    model: '直角坐标码垛机', spec: '识别到病蚕后由人工输入坐标 → 抓取该箔 → 码放到传送带',
    effect: null,
    params: [
      { key: 'stackH', label: '码垛高度', unit: 'mm', min: 300, max: 900, step: 10, value: 620, presetLo: 400, presetHi: 800 },
      { key: 'beltSpeed', label: '传送带速度', unit: '%', min: 30, max: 100, step: 5, value: 70, presetLo: 50, presetHi: 90 },
    ],
  },
]

/** 蚕架物理范围（码垛机坐标必须落在此范围内，超出即需人工修正） */
// 蚕架坐标范围（按后端交付单：3 列 × 1 排 × 4 层）
const FRAME_LIMIT = { colMin: 1, colMax: 3, rowMin: 1, rowMax: 1, layerMin: 1, layerMax: 4 }

const ROLE_SEEDS = { key: 'admin', name: '管理员' }

/* ------------------------------------------------------------------ */
/* 工具函数                                                            */
/* ------------------------------------------------------------------ */
function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

/** 时间戳格式化为 YYYY-MM-DD HH:mm */
function formatTime(ts) {
  if (!ts) return '--'
  const d = new Date(ts)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** 时间戳格式化为 HH:mm */
function formatClock(ts) {
  if (!ts) return '--'
  const d = new Date(ts)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

/** 时间戳格式化为 YYYY-MM-DD */
function formatDate(ts) {
  const d = new Date(ts)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

/** ISO8601 到毫秒（规格书 5.3 时间戳格式，UTC） */
function isoUtc(ts) {
  return new Date(ts).toISOString()
}

/** 相对时间：3 分钟前 */
function fromNow(ts, now) {
  const diff = Math.max(0, Math.floor(((now || Date.now()) - ts) / 1000))
  if (diff < 60) return diff + ' 秒前'
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前'
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前'
  return Math.floor(diff / 86400) + ' 天前'
}

/** 把秒数格式化为 1 h 20 min */
function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return h + ' h ' + m + ' min'
  if (m > 0) return m + ' min ' + (s % 60) + ' s'
  return s + ' s'
}

/** WiFi 信号强度 → 格数（-40 极好 … -90 无信号） */
function wifiBars(dbm) {
  if (dbm >= -50) return 4
  if (dbm >= -60) return 3
  if (dbm >= -70) return 2
  if (dbm >= -85) return 1
  return 0
}

function wifiText(dbm) {
  const bars = wifiBars(dbm)
  if (bars >= 3) return '信号良好'
  if (bars === 2) return '信号一般'
  if (bars === 1) return '信号偏弱'
  return '无信号'
}

/** 稳定伪随机：同一 (种子, 时间片) 永远得到同一个 0~1 的数 */
function hashNoise(seed, ts) {
  let x = ((ts / 60000) | 0) >>> 0
  x = (x ^ Math.imul(seed, 2654435761)) >>> 0
  x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0
  x = Math.imul(x ^ (x >>> 13), 3266489917) >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  return x / 4294967296
}

/* ------------------------------------------------------------------ */
/* 确定性历史：任意时间戳都能推算出该时刻的温湿度                      */
/* ------------------------------------------------------------------ */
function basePoint(barn, ts, variety, instar) {
  const range = spec.getTargetRange(instar || barn.instar, variety || barn.variety)
  const d = new Date(ts)
  const hour = d.getHours() + d.getMinutes() / 60
  // 高原昼夜温差：14:00 前后最高、04:00 前后最低
  const wave = Math.sin(((hour - 8) / 24) * Math.PI * 2)
  const n1 = hashNoise(ts / 3600000 + 7, ts) - 0.5
  const n2 = hashNoise(ts / 3600000 + 31, ts) - 0.5
  const temp = barn.tempBase + wave * 1.1 + n1 * 0.9
  const humi = barn.humiBase - wave * 4.5 + n2 * 2.6
  return {
    ts,
    temp: Number(temp.toFixed(2)),
    humi: Number(humi.toFixed(1)),
    tMin: range.tMin, tMax: range.tMax, hMin: range.hMin, hMax: range.hMax,
    tol: range.tol,
  }
}

/* ------------------------------------------------------------------ */
/* 状态单例                                                            */
/* ------------------------------------------------------------------ */
let state = null

/** 机械化设备运行态：参数对象带 presetLo/presetHi（预设工作范围）与变更历史 */
function createMachines(seed, now) {
  const machines = {}
  MACHINE_SEEDS.forEach((m, i) => {
    machines[m.id] = {
      id: m.id,
      name: m.name,
      kind: m.kind,
      kindName: m.kindName,
      model: m.model,
      spec: m.spec,
      effect: m.effect,
      on: false,
      online: seed.online,
      locked: false,
      runtimeMin: 60 + i * 41,
      lastSwitchAt: now - (i + 2) * 120000,
      switchesToday: 1 + (i % 3),
      params: m.params.map((p) => ({
        key: p.key, label: p.label, unit: p.unit,
        min: p.min, max: p.max, step: p.step,
        value: p.value, presetLo: p.presetLo, presetHi: p.presetHi,
        edited: false, editedBy: '', editedAt: 0,
      })),
      paramLog: [],
      cycles: 0,
      cycleAt: now,
      lastCycleText: '',
      job: null,
    }
  })
  // 演示：奇数号蚕房的投叶量低于预设下限，进页面即可看到「需人为干涉」提示
  const idx = Number(seed.barn.slice(-2)) || 1
  if (idx % 2 === 1 && machines.feed01) {
    const dose = machines.feed01.params.filter((x) => x.key === 'dose')[0]
    if (dose) dose.value = 120
  }
  return machines
}

function createBarn(seed, now) {
  const p = basePoint(seed, now)
  const devices = {}
  DEVICE_SEEDS.forEach((d, i) => {
    devices[d.id] = {
      id: d.id,
      name: d.name,
      kind: d.kind,
      model: d.model,
      spec: d.spec,
      effect: d.effect,
      on: false,
      online: seed.online,
      locked: false,
      runtimeMin: 120 + i * 37,
      lastSwitchAt: now - (i + 1) * 90000,
      switchesToday: 2 + i,
      switchLog: [now - (i + 1) * 90000],
      faultCode: '',
    }
  })
  return {
    barn: seed.barn,
    zone: seed.zone,
    group: seed.group,
    name: seed.name,
    area: seed.area,
    variety: seed.variety,
    instar: seed.instar,
    // 该蚕房的环境基准（engine 的 ambientOf 与 basePoint 都依赖，必须带入运行态）
    tempBase: seed.tempBase,
    humiBase: seed.humiBase,
    mode: seed.mode,
    manualUntil: 0,
    online: seed.online,
    offlineSince: seed.online ? 0 : now - 30 * 60 * 1000,
    wifi: seed.wifi,
    sensorOk: seed.sensorOk,
    stuckCount: 0,
    lastReportAt: now - 20000,
    temp: p.temp,
    humi: p.humi,
    devices,
    machines: createMachines(seed, now),
    // 病蚕识别记录改由后端接口提供（utils/clamp.js），本地不再造数据
    diseased: [],
    interlock: { active: false, code: '', name: '', at: 0, reason: '', fanVentUntil: 0, heatOnSince: 0 },
    due: { tempHigh: 0, tempLow: 0, humiHigh: 0, humiLow: 0 },
    alarms: [],
    trend: [],
    lastSample: { temp: p.temp, humi: p.humi },
    serverState: seed.online ? 'NORMAL' : 'DEGRADED',
    config: {
      ver: 'v1.' + seed.barn.slice(-2) + '.0',
      updatedAt: now - 3 * 86400000,
      by: '系统默认值',
      note: '初始目标区间按默认配置下发',
      history: [],
    },
    audit: [],
    tokens: [],
    activeCoupling: 'A9',
  }
}

function seedInitialAlarms(st) {
  const now = st.now
  const add = (barnKey, item) => {
    const b = st.barns[barnKey]
    item.id = item.code + '-' + barnKey + '-' + now + '-' + b.alarms.length
    item.barn = b.barn
    item.zone = b.zone
    item.ackBy = ''
    b.alarms.unshift(item)
  }
  add('barn02', {
    code: 'AL03', level: 'warn', deviceId: 'mist01', ts: now - 16 * 60 * 1000, value: 91.5,
    text: '湿度 91.5%RH 高于上限 85%RH +5%RH，已持续 16 min', advice: spec.ALARMS[2].advice,
    acked: false, active: true, clearedAt: 0, cleared: false,
  })
  add('barn03', {
    code: 'AL06', level: 'warn', deviceId: 'th01', ts: now - 12 * 60 * 1000, value: 0,
    text: '设备心跳超时 180 s 未收到正常状态，已进入离线自治', advice: spec.ALARMS[5].advice,
    acked: false, active: true, clearedAt: 0, cleared: false,
  })
  add('barn04', {
    code: 'AL07', level: 'critical', deviceId: 'heat01', ts: now - 8 * 60 * 1000, value: 15.4,
    text: '加热片连续通电 15.4 min，超时锁定并进入 SAFE_LOCK', advice: spec.ALARMS[6].advice,
    acked: false, active: true, clearedAt: 0, cleared: false,
  })
  add('barn01', {
    code: 'AL08', level: 'info', deviceId: 'fan01', ts: now - 42 * 60 * 1000, value: 21,
    text: 'fan01 近 1 h 内启停 21 次，超过 20 次阈值', advice: spec.ALARMS[7].advice,
    acked: true, ackBy: '操作员 · 杨丽', active: false, cleared: true, clearedAt: now - 35 * 60 * 1000,
  })
}

function createState() {
  const now = Date.now()
  const barns = {}
  BARN_SEEDS.forEach((seed) => {
    const b = createBarn(seed, now)
    // 预置 24 h 分钟级历史（内存中，不落 storage）
    const minute = 60000
    for (let i = 1440; i > 0; i--) {
      const p = basePoint(seed, now - i * minute)
      b.trend.push({ ts: p.ts, temp: p.temp, humi: p.humi })
    }
    barns[seed.barn] = b
  })

  const st = {
    now,
    simClock: now,
    role: ROLE_SEEDS.key,
    currentBarn: 'barn01',
    barns,
    bootedAt: now,
  }

  // 让几栋蚕房开机即处于有代表性的工况，便于演示各类页面
  const b2 = barns.barn02
  b2.mode = 'auto'
  b2.humi = 91.5
  b2.devices.mist01.on = true

  const b3 = barns.barn03
  b3.mode = 'offline'
  b3.offlineSince = now - 12 * 60 * 1000
  b3.serverState = 'DEGRADED'
  Object.keys(b3.devices).forEach((k) => { b3.devices[k].online = false })
  b3.devices.heat01.on = true
  b3.devices.heat01.locked = true

  const b4 = barns.barn04
  b4.mode = 'safe_lock'
  b4.devices.heat01.on = false
  b4.devices.heat01.locked = true
  b4.devices.mist01.locked = true
  b4.devices.fan01.on = true
  b4.interlock = {
    active: true, code: 'S2', name: '加热片连续工作超时',
    at: now - 8 * 60 * 1000, reason: '加热片连续通电超过 15 min，已强制断电并进入 safe_lock',
    fanVentUntil: 0, heatOnSince: 0,
  }
  b4.serverState = 'ALARM'

  Object.keys(barns).forEach((k) => {
    const b = barns[k]
    b.trend.push({ ts: now, temp: b.temp, humi: b.humi })
  })

  seedInitialAlarms(st)
  return st
}

/** 读取轻量设置（跨启动保留） */
function loadSettings() {
  try {
    const s = wx.getStorageSync(STORAGE_KEY)
    if (s && typeof s === 'object') return s
  } catch (e) { /* 忽略缓存异常 */ }
  return null
}

function saveSettings() {
  if (!state) return
  const overrides = {}
  Object.keys(state.barns).forEach((k) => {
    const b = state.barns[k]
    overrides[k] = {
      variety: b.variety,
      instar: b.instar,
      config: {
        ver: b.config.ver,
        updatedAt: b.config.updatedAt,
        by: b.config.by,
        note: b.config.note,
        history: b.config.history.slice(0, 8),
      },
      audit: b.audit.slice(0, 30),
    }
  })
  try {
    wx.setStorageSync(STORAGE_KEY, {
      role: state.role,
      currentBarn: state.currentBarn,
      overrides,
    })
  } catch (e) { /* 存储失败不影响运行 */ }
}

function applySettings(st, s) {
  if (!s) return
  if (s.role) st.role = s.role
  if (s.currentBarn && st.barns[s.currentBarn]) st.currentBarn = s.currentBarn
  const ov = s.overrides || {}
  Object.keys(ov).forEach((k) => {
    const b = st.barns[k]
    const o = ov[k]
    if (!b || !o) return
    if (o.variety) b.variety = o.variety
    if (o.instar) b.instar = o.instar
    if (o.config) b.config = Object.assign({}, b.config, o.config)
    if (o.audit) b.audit = o.audit
  })
}

/** 取状态（首次调用时初始化） */
function getState() {
  if (!state) {
    state = createState()
    applySettings(state, loadSettings())
  }
  return state
}

/** 重置演示数据 */
function resetDemo() {
  state = createState()
  saveSettings()
  return state
}

/* ------------------------------------------------------------------ */
/* 查询：蚕房 / 目标区间 / 越限                                        */
/* ------------------------------------------------------------------ */
function getBarnsAll() {
  const st = getState()
  return Object.keys(st.barns).map((k) => st.barns[k])
}

function getBarnList() {
  const st = getState()
  return Object.keys(st.barns).map((k) => {
    const b = st.barns[k]
    const range = spec.getTargetRange(b.instar, b.variety)
    const oo = evaluateOutOfRange(b, range)
    const activeAlarms = b.alarms.filter((a) => a.active && !a.cleared)
    return {
      barn: b.barn,
      zone: b.zone,
      group: b.group,
      name: b.name,
      area: b.area,
      variety: b.variety,
      varietyName: varietyName(b.variety),
      instar: b.instar,
      instarName: instarName(b.instar),
      mode: b.mode,
      modeName: modeName(b.mode),
      modeTone: modeTone(b.mode),
      temp: b.temp,
      humi: b.humi,
      target: range,
      online: b.online,
      wifi: b.wifi,
      wifiBars: wifiBars(b.wifi),
      outOfRange: oo,
      tempText: b.temp.toFixed(1),
      humiText: b.humi.toFixed(1),
      deviceOn: countDevicesOn(b),
      deviceTotal: DEVICE_SEEDS.length,
      alarmCount: activeAlarms.length,
      criticalCount: activeAlarms.filter((a) => a.level === 'critical').length,
      warnCount: activeAlarms.filter((a) => a.level === 'warn').length,
      infoCount: activeAlarms.filter((a) => a.level === 'info').length,
    }
  })
}

function getBarn(barnKey) {
  const st = getState()
  return st.barns[barnKey] || st.barns[st.currentBarn]
}

function getCurrentBarn() {
  return getBarn(getState().currentBarn)
}

function setCurrentBarn(barnKey) {
  const st = getState()
  if (st.barns[barnKey]) {
    st.currentBarn = barnKey
    saveSettings()
  }
  return getBarn(barnKey)
}

function instarName(code) {
  const it = spec.INSTARS.filter((i) => i.code === code)[0]
  return it ? it.name : code
}

function varietyName(code) {
  const v = spec.VARIETIES.filter((i) => i.code === code)[0]
  return v ? v.name : code
}

function modeName(key) {
  const m = spec.MODES.filter((i) => i.key === key)[0]
  return m ? m.name : key
}

function modeTone(key) {
  const m = spec.MODES.filter((i) => i.key === key)[0]
  return m ? m.tone : 'gray'
}

function modeInfo(key) {
  return spec.MODES.filter((i) => i.key === key)[0] || spec.MODES[0]
}

/** 1.5 越限判定：正常 / 轻度越限 / 重度越限 */
function evaluateOutOfRange(b, range) {
  const items = []
  if (b.temp > range.tMax) {
    items.push({ metric: 'temp', dir: 'high', value: b.temp, limit: range.tMax, delta: Number((b.temp - range.tMax).toFixed(2)), dueSec: Math.round(b.due.tempHigh) })
  } else if (b.temp < range.tMin) {
    items.push({ metric: 'temp', dir: 'low', value: b.temp, limit: range.tMin, delta: Number((range.tMin - b.temp).toFixed(2)), dueSec: Math.round(b.due.tempLow) })
  }
  if (b.humi > range.hMax) {
    items.push({ metric: 'humi', dir: 'high', value: b.humi, limit: range.hMax, delta: Number((b.humi - range.hMax).toFixed(1)), dueSec: Math.round(b.due.humiHigh) })
  } else if (b.humi < range.hMin) {
    items.push({ metric: 'humi', dir: 'low', value: b.humi, limit: range.hMin, delta: Number((range.hMin - b.humi).toFixed(1)), dueSec: Math.round(b.due.humiLow) })
  }
  let level = 'normal'
  items.forEach((it) => {
    if (it.dueSec > range.tol * 60) level = 'heavy'
    else if (level !== 'heavy') level = 'light'
  })
  return {
    level,
    levelName: level === 'normal' ? '正常' : (level === 'light' ? '轻度越限' : '重度越限'),
    items,
    inRange: level === 'normal',
    tempIn: b.temp >= range.tMin && b.temp <= range.tMax,
    humiIn: b.humi >= range.hMin && b.humi <= range.hMax,
    maxDueSec: items.reduce((m, it) => Math.max(m, it.dueSec), 0),
    tolSec: range.tol * 60,
  }
}

function getOutOfRange(barn) {
  const b = getBarn(barn)
  return evaluateOutOfRange(b, spec.getTargetRange(b.instar, b.variety))
}

function getTarget(barn) {
  const b = getBarn(barn)
  return spec.getTargetRange(b.instar, b.variety)
}

/* ------------------------------------------------------------------ */
/* 查询：设备                                                          */
/* ------------------------------------------------------------------ */
function countDevicesOn(b) {
  return Object.keys(b.devices).filter((k) => b.devices[k].on).length
}

function getDevices(barn) {
  const b = getBarn(barn)
  const liveOv = LIVE.devices[b.barn]
  if (liveOv) return liveOv
  const st = getState()
  return Object.keys(b.devices).map((k) => {
    const d = b.devices[k]
    const canSwitch = b.mode !== 'safe_lock' && !d.locked && b.sensorOk !== false
    return {
      id: d.id,
      name: d.name,
      kind: d.kind,
      kindName: d.kind === 'heat' ? '加热' : (d.kind === 'fan' ? '通风' : '加湿'),
      model: d.model,
      spec: d.spec,
      on: d.on,
      stateText: d.on ? '运行中' : '已停止',
      online: d.online,
      locked: d.locked,
      lockText: d.locked ? (b.mode === 'safe_lock' ? '安全联锁断电' : '锁定') : '',
      runtimeMin: Math.round(d.runtimeMin),
      runtimeText: formatDuration(d.runtimeMin * 60),
      switchesToday: d.switchesToday,
      lastSwitchText: fromNow(d.lastSwitchAt, st.simClock),
      canSwitch,
      cooldownLeft: Math.max(0, Math.round((st.simClock - d.lastSwitchAt) / 1000)),
      faultCode: d.faultCode || '',
    }
  })
}

function getDeviceSummary(barn) {
  const list = getDevices(barn)
  return {
    total: list.length,
    on: list.filter((d) => d.on).length,
    offline: list.filter((d) => !d.online).length,
    locked: list.filter((d) => d.locked).length,
    heat: list.filter((d) => d.kind === 'heat')[0] || null,
    fans: list.filter((d) => d.kind === 'fan'),
    mist: list.filter((d) => d.kind === 'mist')[0] || null,
    list,
  }
}

/* ------------------------------------------------------------------ */
/* 查询：机械化设备与病蚕识别                                          */
/* ------------------------------------------------------------------ */
/** 参数实际值与预设工作范围的关系（ok / low 不够 / high 超出） */
function paramState(p) {
  if (p.value < p.presetLo) {
    return { ok: false, dir: 'low', outText: '低于预设下限 ' + (p.presetLo - p.value) + ' ' + p.unit }
  }
  if (p.value > p.presetHi) {
    return { ok: false, dir: 'high', outText: '超出预设上限 ' + (p.value - p.presetHi) + ' ' + p.unit }
  }
  return { ok: true, dir: 'ok', outText: '在预设范围内' }
}

function machineParamView(p) {
  const st = paramState(p)
  return {
    key: p.key, label: p.label, unit: p.unit,
    value: p.value, text: p.value + ' ' + p.unit,
    min: p.min, max: p.max, step: p.step,
    presetLo: p.presetLo, presetHi: p.presetHi,
    presetText: p.presetLo + ' ~ ' + p.presetHi + ' ' + p.unit,
    ok: st.ok, dir: st.dir, outText: st.outText,
    edited: !!p.edited, editedBy: p.editedBy || '', editedAt: p.editedAt || 0,
    editedText: p.editedAt ? formatTime(p.editedAt) + ' ' + (p.editedBy || '') : '',
  }
}

function machineJobView(m, now) {
  if (!m.job) return null
  const j = m.job
  const total = Math.max(1, j.endsAt - j.startedAt)
  const pct = j.status === 'done' ? 100 : Math.min(99, Math.max(0, Math.round(((now - j.startedAt) / total) * 100)))
  return {
    id: j.id,
    coord: '第 ' + j.col + ' 列 · 第 ' + j.row + ' 排 · 第 ' + j.layer + ' 层',
    col: j.col, row: j.row, layer: j.layer,
    reason: j.reason || '人工指定坐标',
    recordId: j.recordId || '',
    status: j.status,
    statusText: j.status === 'done' ? '已完成' : '作业中',
    running: j.status !== 'done',
    progress: pct,
    progressText: pct + '%',
    startedText: formatClock(j.startedAt),
    etaText: j.status === 'done' ? '完成于 ' + formatClock(j.endsAt) : '预计 ' + formatClock(j.endsAt) + ' 完成',
  }
}

function getMachines(barn) {
  const b = getBarn(barn)
  const liveOv = LIVE.machines[b.barn]
  if (liveOv) return liveOv
  const st = getState()
  const now = st.simClock
  return Object.keys(b.machines).map((k) => {
    const m = b.machines[k]
    const params = m.params.map(machineParamView)
    const outList = params.filter((p) => !p.ok)
    const job = machineJobView(m, now)
    return {
      id: m.id, name: m.name, kind: m.kind, kindName: m.kindName,
      model: m.model, spec: m.spec,
      on: m.on, online: m.online, locked: m.locked,
      stateText: m.locked ? '已锁定' : (!m.online ? '离线' : (m.on ? (job && job.running ? '作业中' : '运行中') : '已停止')),
      runtimeMin: m.runtimeMin,
      runtimeText: m.runtimeMin >= 60 ? Math.floor(m.runtimeMin / 60) + ' h ' + (m.runtimeMin % 60) + ' min' : m.runtimeMin + ' min',
      switchesToday: m.switchesToday,
      lastSwitchText: formatClock(m.lastSwitchAt),
      cycles: m.cycles,
      lastCycleText: m.lastCycleText || '--',
      params,
      outCount: outList.length,
      outText: outList.length ? outList.map((p) => p.label + ' ' + p.outText).join('；') : '参数均在预设范围内',
      needHuman: outList.length > 0,
      job,
      isPallet: m.kind === 'pallet',
      paramLog: (m.paramLog || []).slice(-8).reverse().map((l) => ({
        at: l.at, timeText: formatTime(l.at), text: l.text, by: l.by || '',
      })),
    }
  })
}

function getMachine(barn, id) {
  return getMachines(barn).filter((m) => m.id === id)[0] || null
}

function getDiseased(barn) {
  const b = getBarn(barn)
  const st = getState()
  return b.diseased.slice().sort((a, c) => c.at - a.at).map((d) => ({
    id: d.id,
    at: d.at,
    timeText: formatTime(d.at),
    agoText: fromNow(d.at, st.simClock),
    pos: d.layer + ' 层 · ' + d.row + ' 排 · ' + d.col + ' 列',
    layer: d.layer, row: d.row, col: d.col,
    conf: d.conf,
    confText: Math.round(d.conf * 100) + '%',
    status: d.status,
    statusText: d.status === 'pending' ? '待处理' : (d.status === 'running' ? '码垛中' : '已码垛'),
    done: d.status === 'done',
  }))
}

function getMachineSummary(barn) {
  const list = getMachines(barn)
  const diseased = getDiseased(barn)
  const outOfPreset = list.filter((m) => m.needHuman).length
  const pending = diseased.filter((d) => !d.done).length
  return {
    total: list.length,
    on: list.filter((m) => m.on).length,
    needHuman: outOfPreset + pending,
    outOfPreset,
    pending,
    running: list.filter((m) => m.job && m.job.running).length,
    outList: list.filter((m) => m.needHuman),
    list,
    diseased,
  }
}

/* ------------------------------------------------------------------ */
/* 查询：告警                                                          */
/* ------------------------------------------------------------------ */
function getAlarms(barn, filter) {
  const st = getState()
  if (barn) {
    const liveFk = typeof filter === 'string' ? filter : ((filter && filter.status) || '')
    const liveOv = LIVE.alarms[liveKey(barn) + ':' + liveFk]
    if (liveOv) return liveOv
  }
  const f = filter || {}
  const keys = barn ? [barn] : Object.keys(st.barns)
  let list = []
  keys.forEach((k) => {
    const b = st.barns[k]
    if (!b) return
    b.alarms.forEach((a) => {
      list.push(Object.assign({ barnName: b.name }, a))
    })
  })
  if (f.level && f.level !== 'all') list = list.filter((a) => a.level === f.level)
  if (f.status === 'active') list = list.filter((a) => a.active && !a.cleared)
  if (f.status === 'acked') list = list.filter((a) => a.acked && !a.cleared)
  if (f.status === 'cleared') list = list.filter((a) => a.cleared)
  if (f.status === 'unacked') list = list.filter((a) => !a.acked && a.active && !a.cleared)
  list.sort((a, b2) => b2.ts - a.ts)
  return list.map((a) => decorateAlarm(a))
}

function decorateAlarm(a) {
  const lv = spec.ALARM_LEVELS[a.level] || spec.ALARM_LEVELS.info
  const def = spec.ALARMS.filter((x) => x.code === a.code)[0] || {}
  const st = getState()
  return Object.assign({}, a, {
    levelName: lv.name,
    levelColor: lv.color,
    levelChannel: lv.channel,
    levelResponse: lv.response,
    defName: def.name || a.code,
    defTrigger: def.trigger || '',
    defClear: def.clear || '',
    advice: a.advice || def.advice || '',
    statusText: a.cleared ? '已恢复' : (a.acked ? '已确认' : '未处理'),
    statusTone: a.cleared ? 'gray' : (a.acked ? 'blue' : 'orange'),
    timeText: formatTime(a.ts),
    agoText: fromNow(a.ts, st.simClock),
    isoText: isoUtc(a.ts),
  })
}

function getAlarmStats(barn) {
  const list = getAlarms(barn, {})
  const active = list.filter((a) => a.active && !a.cleared)
  return {
    total: list.length,
    active: active.length,
    critical: active.filter((a) => a.level === 'critical').length,
    warn: active.filter((a) => a.level === 'warn').length,
    info: active.filter((a) => a.level === 'info').length,
    unacked: active.filter((a) => !a.acked).length,
    acked: active.filter((a) => a.acked).length,
    cleared: list.filter((a) => a.cleared).length,
  }
}

function findAlarm(id) {
  const st = getState()
  const keys = Object.keys(st.barns)
  for (let i = 0; i < keys.length; i++) {
    const b = st.barns[keys[i]]
    for (let j = 0; j < b.alarms.length; j++) {
      if (b.alarms[j].id === id) {
        return { barn: b, alarm: decorateAlarm(Object.assign({ barnName: b.name }, b.alarms[j])) }
      }
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* 查询：曲线 / 日报                                                   */
/* ------------------------------------------------------------------ */
/** 分钟聚合序列：规格书 10.3 telemetry_agg_min */
function getSeries(barn, fromMs, toMs) {
  const b = getBarn(barn)
  const st = getState()
  const from = fromMs || st.simClock - 6 * 3600000
  const to = toMs || st.simClock
  const stepMs = 60000
  const liveOv = LIVE.series[b.barn + ':' + from + ':' + to]
  if (liveOv && liveOv.length) return liveOv
  const range = spec.getTargetRange(b.instar, b.variety)
  const out = []
  for (let ts = Math.ceil(from / stepMs) * stepMs; ts <= to; ts += stepMs) {
    let p = null
    if (ts >= st.bootedAt - stepMs) {
      // 本次运行期间用真实模拟点（取时间上不晚于 ts 的最近一点），保证曲线连贯
      for (let i = b.trend.length - 1; i >= 0; i--) {
        if (b.trend[i].ts <= ts) { p = b.trend[i]; break }
      }
    }
    if (!p) p = basePoint(b, ts)
    const outSec =
      (p.temp > range.tMax || p.temp < range.tMin ? 30 : 0) +
      (p.humi > range.hMax || p.humi < range.hMin ? 30 : 0)
    out.push({
      ts,
      temp: p.temp,
      humi: p.humi,
      tMin: range.tMin, tMax: range.tMax, hMin: range.hMin, hMax: range.hMax,
      outTemp: p.temp > range.tMax ? 1 : (p.temp < range.tMin ? -1 : 0),
      outHumi: p.humi > range.hMax ? 1 : (p.humi < range.hMin ? -1 : 0),
      outSec,
    })
  }
  return out
}

/** 小时聚合：规格书 10.3 telemetry_agg_hour */
function getHourlyAgg(barn, fromMs, toMs) {
  const series = getSeries(barn, fromMs, toMs)
  const liveOv = LIVE.hourly[liveKey(barn) + ':' + (fromMs || 0) + ':' + (toMs || 0)]
  if (liveOv && liveOv.length) return liveOv
  const groups = {}
  series.forEach((p) => {
    const key = Math.floor(p.ts / 3600000) * 3600000
    if (!groups[key]) groups[key] = { ts: key, temps: [], humis: [], outSec: 0, n: 0 }
    const g = groups[key]
    g.temps.push(p.temp)
    g.humis.push(p.humi)
    g.outSec += p.outSec
    g.n++
  })
  return Object.keys(groups).map((k) => {
    const g = groups[k]
    const sum = (arr) => arr.reduce((a, c) => a + c, 0)
    return {
      ts: g.ts,
      tempAvg: Number((sum(g.temps) / g.n).toFixed(2)),
      tempMax: Math.max.apply(null, g.temps),
      tempMin: Math.min.apply(null, g.temps),
      humiAvg: Number((sum(g.humis) / g.n).toFixed(1)),
      humiMax: Math.max.apply(null, g.humis),
      humiMin: Math.min.apply(null, g.humis),
      outSec: g.outSec,
      samples: g.n,
    }
  }).sort((a, b2) => a.ts - b2.ts)
}

/** 日报统计：规格书 12.1 P06 */
function getDayReport(barn, dateMs) {
  const b = getBarn(barn)
  const liveOv = LIVE.report[b.barn + ':' + dateMs]
  if (liveOv) return liveOv
  const st = getState()
  const d = new Date(dateMs)
  d.setHours(0, 0, 0, 0)
  const from = d.getTime()
  const todayStart = new Date(st.simClock)
  todayStart.setHours(0, 0, 0, 0)
  const isToday = from === todayStart.getTime()
  const to = isToday ? st.simClock : from + 86400000
  const series = getSeries(barn, from, to)
  const range = spec.getTargetRange(b.instar, b.variety)
  const temps = series.map((p) => p.temp)
  const humis = series.map((p) => p.humi)
  const sum = (arr) => arr.reduce((a, c) => a + c, 0)
  const avg = (arr) => (arr.length ? sum(arr) / arr.length : 0)
  let tempOutSec = 0
  let humiOutSec = 0
  series.forEach((p) => {
    if (p.temp > range.tMax || p.temp < range.tMin) tempOutSec += 60
    if (p.humi > range.hMax || p.humi < range.hMin) humiOutSec += 60
  })
  const alarms = b.alarms.filter((a) => a.ts >= from && a.ts <= to)
  const switches = {}
  Object.keys(b.devices).forEach((k) => { switches[k] = b.devices[k].switchesToday })
  const hours = getHourlyAgg(barn, from, to)
  return {
    barn: b.barn,
    barnName: b.name,
    zone: b.zone,
    date: formatDate(from),
    instar: b.instar,
    instarName: instarName(b.instar),
    variety: b.variety,
    varietyName: varietyName(b.variety),
    range,
    samples: series.length,
    tempAvg: Number(avg(temps).toFixed(2)),
    tempMax: temps.length ? Math.max.apply(null, temps) : 0,
    tempMin: temps.length ? Math.min.apply(null, temps) : 0,
    humiAvg: Number(avg(humis).toFixed(1)),
    humiMax: humis.length ? Math.max.apply(null, humis) : 0,
    humiMin: humis.length ? Math.min.apply(null, humis) : 0,
    tempOutText: formatDuration(tempOutSec),
    humiOutText: formatDuration(humiOutSec),
    tempOutMin: Math.round(tempOutSec / 60),
    humiOutMin: Math.round(humiOutSec / 60),
    outRate: series.length ? Math.round(((tempOutSec + humiOutSec) / (series.length * 120)) * 1000) / 10 : 0,
    alarmTotal: alarms.length,
    alarmCritical: alarms.filter((a) => a.level === 'critical').length,
    alarmWarn: alarms.filter((a) => a.level === 'warn').length,
    alarmInfo: alarms.filter((a) => a.level === 'info').length,
    switches,
    hours,
  }
}

/* ------------------------------------------------------------------ */
/* 查询：审计 / 令牌 / 配置版本                                        */
/* ------------------------------------------------------------------ */
function getAudit(barn) {
  const st = getState()
  const keys = barn ? [barn] : Object.keys(st.barns)
  let list = []
  keys.forEach((k) => {
    const b = st.barns[k]
    if (!b) return
    list = list.concat(b.audit.map((a) => Object.assign({ barnName: b.name, barn: b.barn, zone: b.zone }, a)))
  })
  return list.sort((a, b2) => b2.ts - a.ts)
}

function getTokens(barn) {
  const b = getBarn(barn)
  const st = getState()
  return b.tokens.map((t) => Object.assign({}, t, {
    statusText: t.used ? '已使用' : (t.expireAt < st.simClock ? '已过期' : '有效'),
    remainText: t.used ? '—' : formatDuration((t.expireAt - st.simClock) / 1000),
    issuedText: formatTime(t.issuedAt),
    expireText: formatTime(t.expireAt),
  }))
}

function getConfigHistory(barn) {
  const b = getBarn(barn)
  return b.config.history.slice().sort((a, b2) => b2.updatedAt - a.updatedAt)
}

function getConfigView(barn) {
  const b = getBarn(barn)
  const liveOv = LIVE.config[b.barn]
  if (liveOv) return liveOv
  const range = spec.getTargetRange(b.instar, b.variety)
  return {
    barn: b.barn,
    zone: b.zone,
    instar: b.instar,
    instarName: instarName(b.instar),
    variety: b.variety,
    varietyName: varietyName(b.variety),
    ver: b.config.ver,
    updatedAt: b.config.updatedAt,
    updatedText: formatTime(b.config.updatedAt),
    by: b.config.by,
    note: b.config.note,
    range,
  }
}

function getStatusSummary(barn) {
  const b = getBarn(barn)
  const liveOv = LIVE.status[b.barn]
  if (liveOv) return liveOv
  const st = getState()
  const range = spec.getTargetRange(b.instar, b.variety)
  const oo = evaluateOutOfRange(b, range)
  const dev = getDeviceSummary(barn)
  const alarm = getAlarmStats(barn)
  return {
    barn: b.barn,
    zone: b.zone,
    group: b.group,
    name: b.name,
    area: b.area,
    instar: b.instar,
    instarName: instarName(b.instar),
    variety: b.variety,
    varietyName: varietyName(b.variety),
    temp: b.temp,
    humi: b.humi,
    tempText: b.temp.toFixed(1),
    humiText: b.humi.toFixed(1),
    dewp: Number((b.humi > 0 ? b.temp - (100 - b.humi) / 5 : b.temp).toFixed(1)),
    mode: b.mode,
    modeName: modeName(b.mode),
    modeTone: modeTone(b.mode),
    modeInfo: modeInfo(b.mode),
    manualLeftSec: b.mode === 'manual' ? Math.max(0, Math.round((b.manualUntil - st.simClock) / 1000)) : 0,
    online: b.online,
    offlineText: b.online ? '' : formatDuration((st.simClock - b.offlineSince) / 1000),
    wifi: b.wifi,
    wifiBars: wifiBars(b.wifi),
    wifiText: wifiText(b.wifi),
    sensorOk: b.sensorOk,
    lastReportText: fromNow(b.lastReportAt, st.simClock),
    target: range,
    outOfRange: oo,
    interlock: Object.assign({}, b.interlock),
    coupling: b.activeCoupling,
    couplingInfo: spec.COUPLING.filter((c) => c.code === b.activeCoupling)[0] || spec.COUPLING[8],
    devices: dev,
    alarms: alarm,
    serverState: b.serverState,
    serverStateName: (spec.SERVER_STATES.filter((s) => s.code === b.serverState)[0] || {}).name || b.serverState,
    simClock: st.simClock,
    simClockText: formatTime(st.simClock),
    isoText: isoUtc(st.simClock),
  }
}

/* ------------------------------------------------------------------ */
/* 角色                                                                */
/* ------------------------------------------------------------------ */
function getRole() {
  const st = getState()
  return spec.ROLES.filter((r) => r.key === st.role)[0] || spec.ROLES[0]
}

function setRole(key) {
  const st = getState()
  const hit = spec.ROLES.filter((r) => r.key === key)[0]
  if (hit) {
    st.role = key
    saveSettings()
  }
  return getRole()
}

function can(action) {
  return spec.checkPermission(getState().role, action)
}

module.exports = {
  SIM_STEP,
  setLiveStatus,
  setLiveSeries,
  setLiveHourly,
  setLiveAlarms,
  setLiveDevices,
  setLiveMachines,
  setLiveConfig,
  setLiveReport,
  clearLive,
  hasLive,
  getState,
  resetDemo,
  saveSettings,
  getBarnsAll,
  getBarnList,
  getBarn,
  getCurrentBarn,
  setCurrentBarn,
  getOutOfRange,
  getTarget,
  getDevices,
  getDeviceSummary,
  getMachines,
  getMachine,
  getMachineSummary,
  getDiseased,
  getAlarms,
  getAlarmStats,
  findAlarm,
  decorateAlarm,
  getSeries,
  getHourlyAgg,
  getDayReport,
  getAudit,
  getTokens,
  getConfigHistory,
  getConfigView,
  getStatusSummary,
  basePoint,
  getRole,
  setRole,
  can,
  instarName,
  varietyName,
  modeName,
  modeTone,
  modeInfo,
  formatTime,
  formatClock,
  formatDate,
  formatDuration,
  fromNow,
  isoUtc,
  wifiBars,
  wifiText,
  hashNoise,
  DEVICE_SEEDS,
  MACHINE_SEEDS,
  FRAME_LIMIT,
  paramState,
  TREND_MAX,
}
