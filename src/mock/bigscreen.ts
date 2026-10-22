/**
 * 大屏模拟数据源（比赛演示版：4 个蚕房 / 4 个厂区）
 *
 * 所有数字都必须能追溯到《蚕房环境调控系统 规格书》v1.0：
 *   设备与蚕房相关数字由 houses.ts 汇总得出，保证与 3D、2D 总览完全一致。
 *   越限时长口径来自 §1.5 / §15.5；告警口径来自 §13.1 / §13.2；控制参数来自 §7.3。
 */
import {
  alarmSummary,
  alarmStatusSummary,
  deviceSummary,
  houses,
  overrunSummary,
  traySummary,
} from '@/mock/houses'
import {
  ALARM_DEFS,
  alarmLevelMeta,
  CONTROL_PARAMS,
  DAILY_OVERRUN_TARGET_MIN,
  DEVICE_SPECS,
  RATE_LIMITS,
  SAFETY_INTERLOCKS,
  TEMP_SAFETY_MAX,
  type AlarmLevel,
} from '@/mock/spec'

export type LogLevel = AlarmLevel

export interface LogItem {
  id: number
  level: LogLevel
  time: string
  source: string
  content: string
}

export interface CameraFeed {
  id: string
  name: string
  location: string
  online: boolean
  /** 接入真实视频流时填写（HLS / WebRTC / FLV 地址） */
  streamUrl?: string
}

/* ==================== 顶部概览 ==================== */
export const overview = {
  title: '智能蚕房环境调控监控中心',
  subtitle: '蚕房环境调控系统 · 规格书 v1.0 · 4 栋 / 4 控制区',
  weather: { text: '晴', temp: '24℃', humidity: '58%' },
}

/* ==================== 左侧面板 ==================== */
export const leftData = {
  /** §3.1 在线设备总数（4 个蚕房 × 5 台 = 20 台） */
  onlineDevices: deviceSummary.online,
  deviceTotal: deviceSummary.total,
  onlineRate: deviceSummary.rate,
  offlineDevices: deviceSummary.offline,

  /** §1.5 / §15.5 越限时长趋势：园区重度越限累计时长（min/日） */
  overrunTrend: {
    categories: ['09-19', '09-20', '09-21', '09-22', '09-23', '09-24'],
    current: [36, 44, 29, 33, 25, overrunSummary.total],
    limit: DAILY_OVERRUN_TARGET_MIN,
    limitLabel: '验收红线 30 min/日',
  },
  overrunToday: overrunSummary.total,
  overrunAverage: overrunSummary.average,
  overrunMax: overrunSummary.max,
  overrunOverTarget: overrunSummary.overTargetHouses,

  /** §13.1 告警级别统计 */
  alertRange: '当前未清除告警',
  alertTypes: alarmSummary,
  alarmStatus: alarmStatusSummary,
}

/* ==================== 右侧面板 ==================== */
export const rightData = {
  /** 机械化输送系统蚕盘总数（§2.3 N2 另立项，仅展示） */
  trayTotal: traySummary.total,
  trayAverage: traySummary.average,
  trayHouseCount: houses.length,

  /** §4.1 执行器运行率（加热片 / 风扇 1 / 风扇 2 / 雾化片） */
  running: DEVICE_SPECS.filter((d) => d.kind !== 'th01').map((d, i) => {
    const list = houses.flatMap((h) => h.devices.filter((x) => x.kind === d.kind))
    const healthy = list.filter((x) => x.state === 'normal' || x.state === 'warning').length
    return {
      name: d.label.replace('（送风）', '').replace('（排风）', ''),
      value: Math.round((healthy / list.length) * 100),
      color: ['#FF7A45', '#00FFAA', '#7C4DFF', '#00D5FF'][i] ?? '#00E5FF',
    }
  }),

  /** §7.3 控制参数（下发给设备的 control_params） */
  params: CONTROL_PARAMS,
  paramHighlight: ['hysteresis_t', 'hysteresis_h', 'cool_min', 'ctrl_period'],

  /** §7.5 安全联锁（编号 / 优先级 / 阈值） */
  interlocks: SAFETY_INTERLOCKS,
  tempSafetyMax: TEMP_SAFETY_MAX,
  safeLockHouses: overrunSummary.safeLockHouses,

  /** §6.4 变化速率限制 */
  rateLimits: RATE_LIMITS,
}

/* ==================== 中央核心指标（3D 环绕数字块） ==================== */
export const coreMetrics = [
  { key: 'safe', label: '累计安全运行', value: '386', unit: '天', color: '#00FFAA' },
  {
    key: 'overrun',
    label: '今日越限时长',
    value: String(overrunSummary.total),
    unit: 'min',
    color: overrunSummary.total > DAILY_OVERRUN_TARGET_MIN * houses.length ? '#FF3333' : '#FFD500',
  },
  { key: 'lock', label: '安全联锁触发', value: String(overrunSummary.safeLockHouses), unit: '栋', color: '#FF7A45' },
  { key: 'online', label: '设备在线率', value: String(deviceSummary.rate), unit: '%', color: '#FFD500' },
]

/* ==================== 最新告警 / 操作日志（§8.6 事件码 + §13.2 告警编号） ==================== */
export const logs: LogItem[] = [
  {
    id: 1,
    level: 'critical',
    time: '10:20:33',
    source: '4号蚕房·th01',
    content: 'AL05 传感器异常 E1001：DHT22 连续 3 次读取超时，sensor_ok=false，触发 S4 联锁进入 SAFE_LOCK',
  },
  {
    id: 2,
    level: 'critical',
    time: '10:12:08',
    source: '2号蚕房·heat01',
    content: 'AL07 加热片超时锁定 E2002：连续通电 18.4 min > 15 min，加热片强制断电并锁定',
  },
  {
    id: 3,
    level: 'warn',
    time: '10:06:41',
    source: '2号蚕房',
    content: 'AL01 温度越上限：25.4 ℃ 超过 5 龄目标上限 24.0 ℃ 达 1.4 ℃，已启动风扇 1 通风降温',
  },
  {
    id: 4,
    level: 'warn',
    time: '09:58:12',
    source: '3号蚕房',
    content: 'AL01 温度越上限：27.2 ℃ 超过 2 龄(云蚕7/8号)上限 26.0 ℃ 达 1.2 ℃，持续 24 min',
  },
  {
    id: 5,
    level: 'warn',
    time: '09:52:30',
    source: '3号蚕房·mist01',
    content: 'AL06 设备离线：雾化片心跳超时 212 s，除湿能力暂不受影响，已派发检修工单',
  },
  {
    id: 6,
    level: 'info',
    time: '09:41:03',
    source: '管理员·张工',
    content: '配置下发 config_ver 20260924-02：3号蚕房切换为 2 龄 · 云蚕7/8号，目标区间 25.5~26.0 ℃ / 80~85 %RH',
  },
  {
    id: 7,
    level: 'info',
    time: '09:40:05',
    source: '3号蚕房·fan01',
    content: 'AL08 设备频繁启停：风扇 1 近 1 h 启停 23 次 > 20 次，建议增大滞回带宽或延长冷静期',
  },
  {
    id: 8,
    level: 'info',
    time: '09:22:47',
    source: '系统',
    content: '自动巡检完成：扫描 4 栋 / 4 个控制区 / 20 台设备，在线 16 台，未清除告警 7 条',
  },
  {
    id: 9,
    level: 'info',
    time: '08:56:20',
    source: '4号蚕房',
    content: 'E3001 离线自治：WiFi 心跳超时 90 s，转入 OFFLINE_AUTO，继续使用 Flash 本地参数闭环控制',
  },
  {
    id: 10,
    level: 'warn',
    time: '08:30:11',
    source: '管理员·李工',
    content: '冷静期 T_cool 由 3 min 调整为 4 min（可调范围 2~5 min），热更新已下发设备',
  },
  {
    id: 11,
    level: 'info',
    time: '08:02:36',
    source: '5号机械化线',
    content: '输送线码垛作业完成，本批次上架 160 盘（机械化输送系统 · 规格书 N2 另立项）',
  },
  {
    id: 12,
    level: 'info',
    time: '07:48:02',
    source: '1号蚕房',
    content: '温度回落至 24.6 ℃，处于 4 龄目标区间 24.0~25.0 ℃ 内，加热片保持关闭（§7.4 A9）',
  },
  {
    id: 13,
    level: 'info',
    time: '07:20:15',
    source: '2号蚕房',
    content: 'E2004 设备复位：ESP32 看门狗复位，uptime 归零，复位后执行器默认全关',
  },
  {
    id: 14,
    level: 'info',
    time: '06:50:11',
    source: '系统',
    content: '分钟聚合任务完成 telemetry_agg_min：写入 240 条，越限累计 46 min',
  },
  {
    id: 15,
    level: 'info',
    time: '06:00:00',
    source: '系统',
    content: '数据库全量备份完成（§10.4），本次 268 MB，耗时 12 秒，保留最近 14 份',
  },
  {
    id: 16,
    level: 'warn',
    time: '05:34:22',
    source: '3号蚕房·mist01',
    content: 'E2005 雾化片水位缺水保护：浮子开关断开，硬件级切断雾化片供电，补水后自动恢复',
  },
]

/** 告警定义速查（用于告警详情弹层 / 图例） */
export const alarmDefs = ALARM_DEFS
export const levelMeta = alarmLevelMeta

/* ==================== 实景监控（§2.3 N1 明确不做，仅作独立项目演示） ==================== */
export const cameras: CameraFeed[] = [
  { id: 'cam-1', name: '1号蚕房 · 全景', location: '1号厂区', online: true },
  { id: 'cam-2', name: '2号蚕房 · 蚕架', location: '2号厂区', online: true },
  { id: 'cam-3', name: '3号蚕房 · 出入口', location: '3号厂区', online: true },
  { id: 'cam-4', name: '4号蚕房 · 配电箱', location: '4号厂区', online: false },
]

/** 视频监控模块的范围说明（规格书 §2.3 N1） */
export const cameraScopeNote = '视频图像监控与蚕病识别：规格书 §2.3 N1 明确不在本系统范围，另有独立项目'
