/**
 * 蚕房数据模型 —— 比赛演示版：4 个蚕房，各占 1 个厂区
 *
 * 与《蚕房环境调控系统 规格书》v1.0 的对齐关系：
 *   §3.1  对象层级      barn → zone → group → device（本演示 4 栋 = barn01～barn04）
 *   §3.2  编号规范      barn01/zone01、th01/heat01/fan01/fan02/mist01
 *   §6.1  ～6.3         每栋绑定额期 + 品种，目标区间取自 §6.3 权威数值表
 *   §1.5  越限判定      轻度（≤容许越限时长）/ 重度（>容许越限时长）
 *   §7.2  控制模式      auto / offline / manual / safe_lock / maint
 *   §8.6  事件码        E1001～E3002
 *   §13.2 告警清单      AL01～AL08 + info/warn/critical
 *
 * 机械化输送系统（蚕架 / 传送带 / 码垛机 / 抓取机 / 投叶漏斗）依据规格书 §2.3 N2
 * 「不做饲料投喂与除沙自动化，机械结构另立项」，在本演示中仅作展示，不计入设备台账。
 */

import {
  ALARM_DEFS,
  type AlarmLevel,
  type ControlMode,
  type DeviceKind,
  DEVICE_SPECS,
  getTargetRange,
  instarName,
  judgeOverrun,
  type InstarId,
  type OverrunState,
  type TargetRange,
  varietyName,
  type VarietyId,
  alarmLevelMeta,
  type AlarmDef,
} from '@/mock/spec'

export type { DeviceKind } from '@/mock/spec'

export type HouseStatus = 'normal' | 'warning' | 'critical' | 'offline'
export type DeviceState = HouseStatus

export interface HouseDevice {
  id: string
  kind: DeviceKind
  label: string
  model: string
  /** 继电器吸合状态（规格书 status.states.*） */
  on: boolean
  /** 健康度 */
  state: DeviceState
}

export interface HouseAlarm {
  id: string
  /** §13.2 告警编号 AL01～AL08 */
  no: string
  name: string
  /** §8.6 事件码 */
  code: string
  level: AlarmLevel
  deviceLabel: string
  /** 越限数值 / 故障参数 */
  value: string
  detail: string
  ts: string
  status: 'active' | 'confirmed' | 'cleared'
  advice: string
  trigger: string
}

export interface HouseTrend {
  times: string[]
  temp: number[]
  hum: number[]
  /** 该点是否越限（用于曲线越限高亮） */
  overrun: boolean[]
}

export interface HouseNode {
  id: string
  code: string
  name: string
  /** §3.2 barn 编号 */
  barn: string
  /** §3.2 zone 编号 */
  zone: string
  zoneId: string
  zoneName: string
  row: number
  col: number
  /** 厂区世界坐标（米） */
  x: number
  z: number
  status: HouseStatus
  temp: number
  hum: number
  /** §6.1 / §6.2 当前龄期与品种 */
  instar: InstarId
  variety: VarietyId
  instarName: string
  varietyName: string
  /** §6.3 目标区间 + 容许越限时长 */
  target: TargetRange
  /** §1.5 越限状态 */
  overrun: OverrunState
  /** §7.2 控制模式 */
  mode: ControlMode
  /** §8.5.2 status.rssi WiFi 信号强度 dBm */
  rssi: number
  /** §8.5.2 status.uptime */
  uptimeH: number
  fwVer: string
  /** §5.2 数据有效性判定：sensor_ok */
  sensorOk: boolean
  /** 数据最后更新时刻 */
  updatedAt: string
  chartColor: string
  devices: HouseDevice[]
  alarms: HouseAlarm[]
  trend: HouseTrend
  /** 机械化输送系统（§2.3 N2 另立项，仅展示） */
  mech: { trays: number; note: string }
}

export interface ZoneNode {
  id: string
  name: string
  x: number
  z: number
  width: number
  depth: number
  houses: HouseNode[]
  total: number
  normal: number
  warning: number
  critical: number
  offline: number
}

/* ==================== 状态元信息 ==================== */
export const houseStatusMeta: Record<HouseStatus, { label: string; color: string; fill: string }> = {
  normal: { label: '正常', color: '#00E5FF', fill: 'rgba(0, 229, 255, 0.26)' },
  warning: { label: '预警', color: '#FFD500', fill: 'rgba(255, 213, 0, 0.46)' },
  critical: { label: '严重', color: '#FF3333', fill: 'rgba(255, 51, 51, 0.6)' },
  offline: { label: '离线', color: '#5B6B8C', fill: 'rgba(91, 107, 140, 0.32)' },
}

export const deviceStateMeta: Record<DeviceState, { label: string; color: string }> = {
  normal: { label: '正常', color: '#00FFAA' },
  warning: { label: '异常', color: '#FFD500' },
  critical: { label: '故障', color: '#FF3333' },
  offline: { label: '离线', color: '#5B6B8C' },
}

/* ==================== 布局参数（蚕房 16m × 15m，留足空间） ==================== */
export const LAYOUT = {
  houseW: 16,
  houseD: 15,
  houseH: 5.5,
  colGap: 12,
  rowGap: 9,
  colsPerZone: 1,
  rowsPerZone: 1,
  zoneGapX: 14,
  zoneGapZ: 12,
  zoneCols: 2,
  zoneRows: 2,
}

const BLOCK_W = (LAYOUT.colsPerZone - 1) * LAYOUT.colGap + LAYOUT.houseW
const BLOCK_D = (LAYOUT.rowsPerZone - 1) * LAYOUT.rowGap + LAYOUT.houseD

export const PARK = {
  width: LAYOUT.zoneCols * BLOCK_W + (LAYOUT.zoneCols - 1) * LAYOUT.zoneGapX,
  depth: LAYOUT.zoneRows * BLOCK_D + (LAYOUT.zoneRows - 1) * LAYOUT.zoneGapZ,
  blockW: BLOCK_W,
  blockD: BLOCK_D,
}

/** 机械化输送系统标注（§2.3 N2） */
export const MECH_NOTE = '机械化输送系统 · 规格书 §2.3 N2 另立项'

/* ==================== 四个蚕房 ==================== */
interface AlarmDefRef {
  no: string
  value: string
  detail: string
  ts: string
  device: DeviceKind
  status?: 'active' | 'confirmed' | 'cleared'
}

interface HouseDef {
  barn: string
  zone: string
  zoneIndex: number
  code: string
  name: string
  status: HouseStatus
  instar: InstarId
  variety: VarietyId
  temp: number
  hum: number
  /** 今日越限累计分钟（温度 / 湿度） */
  overMinutes: { temp: number; hum: number }
  mode: ControlMode
  rssi: number
  uptimeH: number
  fwVer: string
  sensorOk: boolean
  updatedAt: string
  chartColor: string
  devices: Record<DeviceKind, { state: DeviceState; on: boolean }>
  alarms: AlarmDefRef[]
  base: { temp: number; tempAmp: number; hum: number; humAmp: number; drift: number }
}

const HOUSE_DEFS: HouseDef[] = [
  {
    // 正常样本：区间内运行，执行器全关（规格书 §7.4 A9）
    barn: 'barn01',
    zone: 'zone01',
    zoneIndex: 0,
    code: 'A-01',
    name: '1号蚕房',
    status: 'normal',
    instar: 'I4',
    variety: 'V1',
    temp: 24.6,
    hum: 72.3,
    overMinutes: { temp: 0, hum: 0 },
    mode: 'auto',
    rssi: -58,
    uptimeH: 9264,
    fwVer: 'v1.0.0',
    sensorOk: true,
    updatedAt: '刚刚',
    chartColor: '#00E5FF',
    devices: {
      th01: { state: 'normal', on: true },
      heat01: { state: 'normal', on: false },
      fan01: { state: 'normal', on: false },
      fan02: { state: 'normal', on: false },
      mist01: { state: 'normal', on: false },
    },
    alarms: [],
    base: { temp: 24.4, tempAmp: 0.5, hum: 71, humAmp: 3, drift: 0.2 },
  },
  {
    // S2 加热片连续通电超时 → safe_lock（§7.5 S2 / §13.2 AL07）
    barn: 'barn02',
    zone: 'zone02',
    zoneIndex: 1,
    code: 'B-01',
    name: '2号蚕房',
    status: 'critical',
    instar: 'I5',
    variety: 'V1',
    temp: 25.4,
    hum: 68.2,
    overMinutes: { temp: 38, hum: 0 },
    mode: 'safe_lock',
    rssi: -62,
    uptimeH: 9264,
    fwVer: 'v1.0.0',
    sensorOk: true,
    updatedAt: '2 分钟前',
    chartColor: '#FF3333',
    devices: {
      th01: { state: 'normal', on: true },
      heat01: { state: 'critical', on: false },
      fan01: { state: 'normal', on: true },
      fan02: { state: 'offline', on: false },
      mist01: { state: 'normal', on: false },
    },
    alarms: [
      {
        no: 'AL07',
        value: '18.4 min',
        detail: '加热片连续通电 18.4 min > 15 min，已强制断电并进入 SAFE_LOCK',
        ts: '10:12:08',
        device: 'heat01',
      },
      {
        no: 'AL01',
        value: '25.4 ℃',
        detail: '温度超过上限 24.0 ℃ 达 1.4 ℃，持续 38 min',
        ts: '10:06:41',
        device: 'heat01',
      },
    ],
    base: { temp: 24.6, tempAmp: 0.9, hum: 67, humAmp: 3, drift: 0.8 },
  },
  {
    // AL01 温度越上限 + AL08 频繁启停 + AL06 设备离线
    barn: 'barn03',
    zone: 'zone03',
    zoneIndex: 2,
    code: 'C-01',
    name: '3号蚕房',
    status: 'warning',
    instar: 'I2',
    variety: 'V2',
    temp: 27.2,
    hum: 84.1,
    overMinutes: { temp: 24, hum: 0 },
    mode: 'auto',
    rssi: -71,
    uptimeH: 4102,
    fwVer: 'v1.0.0',
    sensorOk: true,
    updatedAt: '5 分钟前',
    chartColor: '#FFD500',
    devices: {
      th01: { state: 'normal', on: true },
      heat01: { state: 'normal', on: false },
      fan01: { state: 'warning', on: true },
      fan02: { state: 'normal', on: true },
      mist01: { state: 'offline', on: false },
    },
    alarms: [
      {
        no: 'AL01',
        value: '27.2 ℃',
        detail: '温度超过上限 26.0 ℃ 达 1.2 ℃，持续 24 min',
        ts: '09:58:12',
        device: 'fan01',
      },
      {
        no: 'AL06',
        value: '212 s',
        detail: '雾化片心跳超时 212 s，平台侧标记离线',
        ts: '09:52:30',
        device: 'mist01',
      },
      {
        no: 'AL08',
        value: '23 次/h',
        detail: '风扇 1 近 1 h 启停 23 次，建议调整滞回 / 冷静期',
        ts: '09:40:05',
        device: 'fan01',
      },
    ],
    base: { temp: 26.4, tempAmp: 0.8, hum: 83, humAmp: 3, drift: 1.1 },
  },
  {
    // S4 传感器失效 → safe_lock（§7.5 S4 / §13.2 AL05）
    barn: 'barn04',
    zone: 'zone04',
    zoneIndex: 3,
    code: 'D-01',
    name: '4号蚕房',
    status: 'critical',
    instar: 'I3',
    variety: 'V3',
    temp: 25.9,
    hum: 83.5,
    overMinutes: { temp: 17, hum: 9 },
    mode: 'safe_lock',
    rssi: -88,
    uptimeH: 9264,
    fwVer: 'v0.9.8',
    sensorOk: false,
    updatedAt: '1 分钟前',
    chartColor: '#FF7A45',
    devices: {
      th01: { state: 'offline', on: false },
      heat01: { state: 'offline', on: false },
      fan01: { state: 'normal', on: true },
      fan02: { state: 'normal', on: false },
      mist01: { state: 'normal', on: false },
    },
    alarms: [
      {
        no: 'AL05',
        value: 'sensor_ok=false',
        detail: 'DHT22 连续 3 次读取超时，读数停留在 25.9 ℃ / 83.5 %RH（E1001）',
        ts: '10:20:33',
        device: 'th01',
      },
      {
        no: 'AL06',
        value: '184 s',
        detail: '温湿度传感器、加热片心跳超时 184 s',
        ts: '10:20:33',
        device: 'th01',
      },
    ],
    base: { temp: 25.1, tempAmp: 0.6, hum: 82, humAmp: 4, drift: 0.6 },
  },
]

const ZONE_NAMES = ['1号厂区', '2号厂区', '3号厂区', '4号厂区']
const TREND_TIMES = [
  '00:00',
  '02:00',
  '04:00',
  '06:00',
  '08:00',
  '10:00',
  '12:00',
  '14:00',
  '16:00',
  '18:00',
  '20:00',
  '22:00',
]

const round1 = (n: number) => Math.round(n * 10) / 10

/** 生成某栋蚕房的 12 点温湿度趋势（确定性），并按目标区间标出越限点 */
function buildTrend(def: HouseDef, target: TargetRange, seed: number): HouseTrend {
  const temp: number[] = []
  const hum: number[] = []
  const overrun: boolean[] = []
  for (let i = 0; i < TREND_TIMES.length; i++) {
    const wave = Math.sin((i / TREND_TIMES.length) * Math.PI * 2 + seed) * def.base.tempAmp
    const humWave = Math.cos((i / TREND_TIMES.length) * Math.PI * 2 + seed * 1.7) * def.base.humAmp
    const drift = (i / (TREND_TIMES.length - 1)) * def.base.drift
    const t = round1(def.base.temp + wave + drift)
    const h = Math.round(def.base.hum + humWave - drift * 1.6)
    temp.push(t)
    hum.push(h)
    overrun.push(t > target.tMax || t < target.tMin || h > target.hMax || h < target.hMin)
  }
  // 末点对齐当前实测值，并重新判定越限
  temp[temp.length - 1] = def.temp
  hum[hum.length - 1] = def.hum
  overrun[overrun.length - 1] =
    def.temp > target.tMax ||
    def.temp < target.tMin ||
    def.hum > target.hMax ||
    def.hum < target.hMin
  return { times: [...TREND_TIMES], temp, hum, overrun }
}

function buildAlarm(ref: AlarmDefRef, houseCode: string, index: number): HouseAlarm {
  const def: AlarmDef | undefined = ALARM_DEFS.find((a) => a.no === ref.no)
  const spec = DEVICE_SPECS.find((d) => d.kind === ref.device)
  return {
    id: `${houseCode}-${ref.no}-${index}`,
    no: ref.no,
    name: def?.name ?? ref.no,
    code: def?.code ?? '—',
    level: def?.level ?? 'warn',
    deviceLabel: spec?.label ?? '设备',
    value: ref.value,
    detail: ref.detail,
    ts: ref.ts,
    status: ref.status ?? 'active',
    advice: def?.advice ?? '',
    trigger: def?.trigger ?? '',
  }
}

/* ==================== 生成厂区 / 蚕房 ==================== */
function build(): { houses: HouseNode[]; zones: ZoneNode[] } {
  const houses: HouseNode[] = []
  const zones: ZoneNode[] = []

  HOUSE_DEFS.forEach((def, index) => {
    const zi = def.zoneIndex
    const zc = zi % LAYOUT.zoneCols
    const zr = Math.floor(zi / LAYOUT.zoneCols)
    const zoneX = -PARK.width / 2 + BLOCK_W / 2 + zc * (BLOCK_W + LAYOUT.zoneGapX)
    const zoneZ = -PARK.depth / 2 + BLOCK_D / 2 + zr * (BLOCK_D + LAYOUT.zoneGapZ)

    const target = getTargetRange(def.instar, def.variety)
    const devices: HouseDevice[] = DEVICE_SPECS.map((d) => ({
      id: d.id,
      kind: d.kind,
      label: d.label,
      model: d.model,
      on: def.devices[d.kind].on,
      state: def.devices[d.kind].state,
    }))

    const alarms = def.alarms.map((a, i) => buildAlarm(a, def.code, i))
    const overrun = judgeOverrun(def.temp, def.hum, target, def.overMinutes)

    const house: HouseNode = {
      id: def.code,
      code: def.code,
      name: def.name,
      barn: def.barn,
      zone: def.zone,
      zoneId: `Z${zi + 1}`,
      zoneName: ZONE_NAMES[zi] ?? `${zi + 1}号厂区`,
      row: 0,
      col: 0,
      x: round1(zoneX),
      z: round1(zoneZ),
      status: def.status,
      temp: def.temp,
      hum: def.hum,
      instar: def.instar,
      variety: def.variety,
      instarName: instarName(def.instar),
      varietyName: varietyName(def.variety),
      target,
      overrun,
      mode: def.mode,
      rssi: def.rssi,
      uptimeH: def.uptimeH,
      fwVer: def.fwVer,
      sensorOk: def.sensorOk,
      updatedAt: def.updatedAt,
      chartColor: def.chartColor,
      devices,
      alarms,
      trend: buildTrend(def, target, index * 1.3),
      mech: { trays: [320, 300, 300, 360][index] ?? 300, note: MECH_NOTE },
    }

    houses.push(house)
    zones.push({
      id: `Z${zi + 1}`,
      name: ZONE_NAMES[zi] ?? `${zi + 1}号厂区`,
      x: round1(zoneX),
      z: round1(zoneZ),
      width: BLOCK_W,
      depth: BLOCK_D,
      houses: [house],
      total: 1,
      normal: house.status === 'normal' ? 1 : 0,
      warning: house.status === 'warning' ? 1 : 0,
      critical: house.status === 'critical' ? 1 : 0,
      offline: house.status === 'offline' ? 1 : 0,
    })
  })

  return { houses, zones }
}

const built = build()

export const houses: HouseNode[] = built.houses
export const zones: ZoneNode[] = built.zones

export const parkSummary = {
  total: houses.length,
  normal: houses.filter((h) => h.status === 'normal').length,
  warning: houses.filter((h) => h.status === 'warning').length,
  critical: houses.filter((h) => h.status === 'critical').length,
  offline: houses.filter((h) => h.status === 'offline').length,
}

/** 机械化输送系统蚕盘数（§2.3 N2 另立项，仅展示） */
export const traySummary = {
  total: houses.reduce((sum, h) => sum + h.mech.trays, 0),
  average: Math.round(houses.reduce((sum, h) => sum + h.mech.trays, 0) / houses.length),
}

/** 设备统计：在线 / 总数 / 在线率（§3.1 设备层级） */
export const deviceSummary = (() => {
  const all = houses.flatMap((h) => h.devices)
  const online = all.filter((d) => d.state !== 'offline').length
  return {
    total: all.length,
    online,
    offline: all.length - online,
    rate: Math.round((online / all.length) * 100),
    /** 运行中的执行器数（继电器吸合） */
    running: all.filter((d) => d.on && d.kind !== 'th01').length,
    actuatorTotal: all.filter((d) => d.kind !== 'th01').length,
  }
})()

/** 告警级别统计（§13.1 提示 / 警告 / 紧急） */
export const alarmSummary = (['info', 'warn', 'critical'] as AlarmLevel[]).map((level) => ({
  name: alarmLevelMeta(level).label,
  level,
  value: houses.reduce((n, h) => n + h.alarms.filter((a) => a.level === level).length, 0),
  color: alarmLevelMeta(level).color,
}))

/** 告警处理状态统计（§10.2 alarm.status） */
export const alarmStatusSummary = (['active', 'confirmed', 'cleared'] as const).map((st) => ({
  status: st,
  value: houses.reduce((n, h) => n + h.alarms.filter((a) => a.status === st).length, 0),
}))

/** 今日园区越限累计时长（§15.5 验收指标：重度越限 ≤30 min/日） */
export const overrunSummary = (() => {
  const minutes = houses.map((h) => h.overrun.minutesToday)
  const total = minutes.reduce((a, b) => a + b, 0)
  const overTarget = houses.filter((h) => h.overrun.tempMinutes > 30 || h.overrun.humMinutes > 30)
  return {
    total,
    average: Math.round(total / houses.length),
    max: Math.max(...minutes),
    overTargetHouses: overTarget.length,
    /** 处于安全锁定的蚕房数（§7.5 任意联锁触发） */
    safeLockHouses: houses.filter((h) => h.mode === 'safe_lock').length,
    offlineHouses: houses.filter((h) => h.mode === 'offline').length,
  }
})()

export function findHouse(id: string | null): HouseNode | null {
  if (!id) return null
  return houses.find((h) => h.id === id) ?? null
}

/** 某栋蚕房的首个未清除告警（用于 3D 引线标注） */
export function firstActiveAlarm(house: HouseNode): HouseAlarm | null {
  return house.alarms.find((a) => a.status !== 'cleared') ?? null
}
