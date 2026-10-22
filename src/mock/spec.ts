/**
 * 规格书权威数据（《蚕房环境调控系统 规格书》v1.0）
 *
 * 本文件是「规格书 → 程序」的唯一真值来源，所有面板数字都必须能在这里找到出处。
 * 章节对应关系：
 *   §1   术语表          → INSTARS / VARIETIES / CONTROL_MODES
 *   §4.1 设备清单 BOM    → BOM / DEVICE_SPECS
 *   §6.3 温湿度目标区间   → TARGET_RANGES（全系统最关键数值表）
 *   §6.4 变化速率限制     → RATE_LIMITS
 *   §7.2 控制模式         → CONTROL_MODES
 *   §7.3 控制参数         → CONTROL_PARAMS
 *   §7.5 安全联锁         → SAFETY_INTERLOCKS
 *   §7.6 设备启停保护     → START_STOP_RULES
 *   §8.6 事件码           → EVENT_CODES
 *   §13.1 告警分级        → ALARM_LEVEL_META
 *   §13.2 告警清单        → ALARM_DEFS
 */

/* ==================== §6.1 龄期定义 ==================== */
export type InstarId = 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6'

export interface InstarDef {
  id: InstarId
  name: string
  days: string
  criterion: string
  note: string
}

export const INSTARS: InstarDef[] = [
  { id: 'I1', name: '1 龄', days: '约 3～4 天', criterion: '收蚁至第 1 次眠', note: '小蚕全防干育，对温湿度极敏感' },
  { id: 'I2', name: '2 龄', days: '约 3 天', criterion: '第 1 次眠起至第 2 次眠', note: '持续保温保湿，减少通风' },
  { id: 'I3', name: '3 龄', days: '约 3～4 天', criterion: '第 2 次眠起至第 3 次眠', note: '半防干育，适度通风；小蚕共育末期' },
  { id: 'I4', name: '4 龄', days: '约 4～5 天', criterion: '第 3 次眠起至第 4 次眠', note: '壮蚕开始，加大通风；夜间警惕低温' },
  { id: 'I5', name: '5 龄', days: '约 6～8 天', criterion: '第 4 次眠起至熟蚕', note: '代谢旺盛，严防高温高湿，防控脓病僵病' },
  { id: 'I6', name: '上蔟期', days: '约 2～3 天', criterion: '熟蚕上蔟至采茧', note: '必须通风；湿度过高产生死笼茧霉茧' },
]

export const instarName = (id: InstarId): string => INSTARS.find((i) => i.id === id)?.name ?? id

/* ==================== §6.2 品种清单 ==================== */
export type VarietyId = 'V1' | 'V2' | 'V3'

export interface VarietyDef {
  id: VarietyId
  name: string
  note: string
}

export const VARIETIES: VarietyDef[] = [
  { id: 'V1', name: '两广二号', note: '夏秋蚕主力，多化杂交，耐高温' },
  { id: 'V2', name: '云蚕 7/8 号', note: '云南本土选育，最优温度整体下调 0.5‑1℃' },
  { id: 'V3', name: '菁松×皓月', note: '高海拔二化春蚕，不耐持续高温' },
]

export const varietyName = (id: VarietyId): string => VARIETIES.find((v) => v.id === id)?.name ?? id

/* ==================== §6.3 温湿度目标区间（最关键数值表） ==================== */
export interface TargetRange {
  /** 温度下限 ℃ */
  tMin: number
  /** 温度上限 ℃ */
  tMax: number
  /** 湿度下限 %RH */
  hMin: number
  /** 湿度上限 %RH */
  hMax: number
  /** 容许越限时长 min */
  toleranceMin: number
}

export const TARGET_RANGES: Record<string, TargetRange> = {
  'I1-V1': { tMin: 27.5, tMax: 28.0, hMin: 85, hMax: 90, toleranceMin: 15 },
  'I2-V1': { tMin: 26.5, tMax: 27.0, hMin: 80, hMax: 85, toleranceMin: 15 },
  'I3-V1': { tMin: 25.0, tMax: 26.0, hMin: 75, hMax: 80, toleranceMin: 20 },
  'I4-V1': { tMin: 24.0, tMax: 25.0, hMin: 70, hMax: 75, toleranceMin: 20 },
  'I5-V1': { tMin: 23.0, tMax: 24.0, hMin: 65, hMax: 70, toleranceMin: 30 },
  'I6-V1': { tMin: 24.0, tMax: 25.0, hMin: 65, hMax: 70, toleranceMin: 30 },
  'I1-V2': { tMin: 26.5, tMax: 27.0, hMin: 85, hMax: 90, toleranceMin: 30 },
  'I2-V2': { tMin: 25.5, tMax: 26.0, hMin: 80, hMax: 85, toleranceMin: 15 },
  'I3-V2': { tMin: 24.0, tMax: 25.0, hMin: 75, hMax: 80, toleranceMin: 20 },
  'I4-V2': { tMin: 23.0, tMax: 24.0, hMin: 70, hMax: 75, toleranceMin: 20 },
  'I5-V2': { tMin: 22.0, tMax: 23.0, hMin: 65, hMax: 70, toleranceMin: 30 },
  'I6-V2': { tMin: 23.0, tMax: 24.0, hMin: 65, hMax: 70, toleranceMin: 30 },
  'I1-V3': { tMin: 26.5, tMax: 27.0, hMin: 85, hMax: 88, toleranceMin: 15 },
  'I2-V3': { tMin: 26.0, tMax: 26.5, hMin: 83, hMax: 85, toleranceMin: 20 },
  'I3-V3': { tMin: 25.0, tMax: 25.5, hMin: 80, hMax: 82, toleranceMin: 20 },
  'I4-V3': { tMin: 24.0, tMax: 24.5, hMin: 75, hMax: 78, toleranceMin: 30 },
  'I5-V3': { tMin: 22.0, tMax: 22.5, hMin: 70, hMax: 73, toleranceMin: 30 },
  // 注：规格书 §6.3 该行「容许越限时长」原文写作 30mon（应为 30min），此处按 30 处理并已在差异清单中反馈
  'I6-V3': { tMin: 22.0, tMax: 24.0, hMin: 68, hMax: 72, toleranceMin: 30 },
}

export function getTargetRange(instar: InstarId, variety: VarietyId): TargetRange {
  const r = TARGET_RANGES[`${instar}-${variety}`]
  if (!r) throw new Error(`未定义的龄期-品种组合：${instar}-${variety}`)
  return r
}

/** §1.19 设定值 = 目标区间中心值（仅用于计算控制动作，不直接作为开关阈值） */
export function setpoint(r: TargetRange): { t: number; h: number } {
  return {
    t: Math.round(((r.tMin + r.tMax) / 2) * 10) / 10,
    h: Math.round((r.hMin + r.hMax) / 2),
  }
}

/* ==================== §4.1 设备清单 BOM ==================== */
export interface BomItem {
  no: string
  name: string
  model: string
  key: string
  voltage: string
  current: string
  drive: string
  qty: string
  place: string
}

export const BOM: BomItem[] = [
  {
    no: 'D01',
    name: '温湿度传感器',
    model: 'DHT22',
    key: '温度 -40~80℃ ±0.5℃；湿度 0~99.9%RH ±2%RH，单总线数字输出',
    voltage: 'DC 3.3~5.5 V',
    current: '约 1.5 mA（采样峰值）',
    drive: '单总线',
    qty: '1 个',
    place: '蚕架中部',
  },
  {
    no: 'D02',
    name: '主控单片机',
    model: 'ESP32-CH340',
    key: '双核 Tensilica LX6，板载 WiFi+蓝牙，板载 LDO 稳压 3.3V',
    voltage: 'DC 5 V 供电',
    current: '平均 80 mA，WiFi 峰值 240 mA',
    drive: '—',
    qty: '1 块',
    place: '配电箱旁 IP54 防护盒内',
  },
  {
    no: 'D03',
    name: '加热片',
    model: 'ST201',
    key: '5 W，自限温型 PTC 加热，最高表面温度 60℃，绝缘封装',
    voltage: 'DC 5 V',
    current: '约 0.42 A',
    drive: '继电器（常开触点）',
    qty: '1 片',
    place: '蚕架下方',
  },
  {
    no: 'D04',
    name: '风扇',
    model: '4010 DC5V',
    key: '3000 rpm 低噪款，风量 2~3 CFM',
    voltage: 'DC 5 V',
    current: '0.15 A',
    drive: '继电器（仅开关，无档位）',
    qty: '2 台',
    place: '对角墙面，一送一排',
  },
  {
    no: 'D05',
    name: '雾化片 + 驱动器',
    model: '超声波雾化片 φ20 + 专用驱动板',
    key: '雾化量约 300 mL/h、频率 108 kHz，缺水保护',
    voltage: 'DC 5 V（驱动板输入）',
    current: '约 0.8 A',
    drive: '继电器',
    qty: '1 套',
    place: '水箱上方，出雾口朝上',
  },
  {
    no: 'D06',
    name: '继电器模块',
    model: '1 路光耦隔离继电器模块',
    key: '触点 10 A / 250 VAC，光耦隔离，低电平触发',
    voltage: 'DC 5 V（线圈）',
    current: '每路吸合约 20 mA',
    drive: '低电平触发',
    qty: '4 块（1 路）',
    place: '与 ESP32 同一防护盒',
  },
  {
    no: 'D07',
    name: '电源',
    model: 'AC220V 转 DC12V/5A + DC5V/3A',
    key: '双路输出、带过流保护',
    voltage: 'AC 220 V 输入',
    current: '总功率余量 ≥30 %',
    drive: '—',
    qty: '1 个',
    place: '配电箱内',
  },
]

/* ==================== §3.2 设备编号 / 执行器定义 ==================== */
export type DeviceKind = 'th01' | 'heat01' | 'fan01' | 'fan02' | 'mist01'

export interface DeviceSpec {
  kind: DeviceKind
  /** 规格书 §3.2 编号 */
  id: DeviceKind
  label: string
  model: string
  /** §4.3 安全侧定义：失效应到达的状态 */
  failSafe: string
  /** 附加保护器件 */
  protect: string
  /** 3D 场景颜色 */
  color: number
  cssColor: string
}

export const DEVICE_SPECS: DeviceSpec[] = [
  {
    kind: 'th01',
    id: 'th01',
    label: '温湿度传感器',
    model: 'DHT22',
    failSafe: '全关并告警（进入安全锁定）',
    protect: '结露防护',
    color: 0x00e5ff,
    cssColor: '#00E5FF',
  },
  {
    kind: 'heat01',
    id: 'heat01',
    label: '加热片',
    model: 'ST201 · 5W PTC',
    failSafe: '断电',
    protect: '串联 120 ℃ 热熔断器',
    color: 0xff7a45,
    cssColor: '#FF7A45',
  },
  {
    kind: 'fan01',
    id: 'fan01',
    label: '风扇 1（送风）',
    model: '4010 DC5V · 3000rpm',
    failSafe: '允许保持通电（辅助散热）',
    protect: '无',
    color: 0x00ffaa,
    cssColor: '#00FFAA',
  },
  {
    kind: 'fan02',
    id: 'fan02',
    label: '风扇 2（排风）',
    model: '4010 DC5V · 3000rpm',
    failSafe: '允许保持通电（辅助除湿）',
    protect: '无',
    color: 0x7c4dff,
    cssColor: '#7C4DFF',
  },
  {
    kind: 'mist01',
    id: 'mist01',
    label: '雾化片',
    model: '超声波 φ20 · 300mL/h',
    failSafe: '断电',
    protect: '浮子水位开关串联',
    color: 0x00d5ff,
    cssColor: '#00D5FF',
  },
]

export const deviceSpec = (kind: DeviceKind): DeviceSpec =>
  DEVICE_SPECS.find((d) => d.kind === kind) ?? DEVICE_SPECS[0]!

/* ==================== §7.2 控制模式 ==================== */
export type ControlMode = 'auto' | 'offline' | 'manual' | 'safe_lock' | 'maint'

export interface ControlModeMeta {
  id: ControlMode
  /** 规格书 §9.1 设备侧状态机枚举字符串 */
  state: string
  label: string
  color: string
  desc: string
}

export const CONTROL_MODES: ControlModeMeta[] = [
  { id: 'auto', state: 'AUTO', label: '自动调控', color: '#00FFAA', desc: '本地滞回闭环控制，全部保护约束生效' },
  { id: 'offline', state: 'OFFLINE_AUTO', label: '离线自治', color: '#FFD500', desc: '断网 90s 进入，Flash 本地参数继续闭环' },
  { id: 'manual', state: 'MANUAL', label: '人工接管', color: '#00E5FF', desc: '需 ACTION_TOKEN，30 min 超时回落自动' },
  { id: 'safe_lock', state: 'SAFE_LOCK', label: '安全锁定', color: '#FF3333', desc: '危险负载强制断电，仅管理员人工解除' },
  { id: 'maint', state: 'MAINT', label: '维护模式', color: '#7C4DFF', desc: '停止自动决策，抑制非 critical 告警' },
]

export const controlModeMeta = (id: ControlMode): ControlModeMeta =>
  CONTROL_MODES.find((m) => m.id === id) ?? CONTROL_MODES[0]!

/* ==================== §7.3 控制参数 ==================== */
export interface ControlParam {
  key: string
  symbol: string
  label: string
  value: string
  range: string
  place: string
}

export const CONTROL_PARAMS: ControlParam[] = [
  { key: 'hysteresis_t', symbol: 'T_hys', label: '温度滞回带宽', value: '0.4 ℃', range: '0.2～1.0 ℃', place: '设备侧' },
  { key: 'hysteresis_h', symbol: 'H_hys', label: '湿度滞回带宽', value: '3 %RH', range: '0.5～5 %RH', place: '设备侧' },
  { key: 'cool_min', symbol: 'T_cool', label: '冷静期', value: '3 min', range: '2～5 min', place: '设备侧' },
  { key: 'on_min', symbol: 'T_on_min', label: '最短运行时长', value: '60 s', range: '30～180 s', place: '设备侧' },
  { key: 'off_min', symbol: 'T_off_min', label: '最短停顿时长', value: '60 s', range: '30～180 s', place: '设备侧' },
  { key: 'ctrl_period', symbol: 'T_ctrl', label: '控制周期', value: '10 s', range: '5～30 s', place: '设备侧' },
  { key: 'ack_timeout', symbol: 'T_ack', label: '指令超时', value: '5 s', range: '2～10 s', place: '服务端' },
  { key: 'retry', symbol: 'N_retry', label: '指令重试次数', value: '2 次', range: '0～3 次', place: '服务端' },
]

/** 下发给设备的 control_params 对象（§8.5.6 config） */
export const CONTROL_PARAMS_PAYLOAD = {
  hysteresis_t: 0.4,
  hysteresis_h: 3,
  cool_min: 3,
  on_min: 60,
  off_min: 60,
}

/* ==================== §6.4 变化速率限制 ==================== */
export const RATE_LIMITS = [
  { name: '升温速率', value: '≤1.5 ℃/h', note: '限制升温斜率，防止冲过温度上限' },
  { name: '降温速率', value: '≤2.0 ℃/h', note: '主要依靠风扇通风降温' },
  { name: '加湿速率', value: '≤10 %RH/h', note: '保温密闭空间严防结露' },
  { name: '除湿速率', value: '≤12 %RH/h', note: '不能骤降湿度造成蚕应激' },
]

/* ==================== §7.5 安全联锁 ==================== */
export interface Interlock {
  id: string
  trigger: string
  threshold: string
  action: string
  priority: '最高' | '高' | '中'
  recover: string
}

export const SAFETY_INTERLOCKS: Interlock[] = [
  {
    id: 'S1',
    trigger: '温度超过上限',
    threshold: '目标上限 +1.5 ℃',
    action: '加热片强制断电，风扇允许继续运行散热',
    priority: '最高',
    recover: '温度回落且人工确认',
  },
  {
    id: 'S2',
    trigger: '加热片连续工作超时',
    threshold: '15 min',
    action: '加热片强制断电并进入 safe_lock',
    priority: '最高',
    recover: '人工检查后解除封锁',
  },
  {
    id: 'S3',
    trigger: '温度超过危险值',
    threshold: '实测 ≥32 ℃（绝对值，不受参数影响）',
    action: '危险负载（加热、雾化）强制断电，进入 safe_lock，上报 critical',
    priority: '最高',
    recover: '人工确认现场后复位',
  },
  {
    id: 'S4',
    trigger: '传感器失效',
    threshold: '卡死 / 断路 / 越量程（sensor_ok=false）',
    action: '加热片、雾化片强制断电；风扇开启 5 min 后关闭；进入 safe_lock',
    priority: '高',
    recover: '读数恢复 + 人工解除',
  },
  {
    id: 'S5',
    trigger: '雾化片缺水',
    threshold: '硬件水位浮子开关断开',
    action: '硬件级切断雾化片供电，上报 warn',
    priority: '高',
    recover: '补水后自动恢复',
  },
  {
    id: 'S6',
    trigger: '服务端失联超时',
    threshold: '5 min',
    action: '转离线自治，拒绝新远端指令',
    priority: '中',
    recover: '重连并完成状态对齐',
  },
]

/** §7.5 S3 固件硬编码危险温度阈值（§14.2 TEMP_SAFETY_MAX） */
export const TEMP_SAFETY_MAX = 32.0

/* ==================== §7.6 设备启停保护 ==================== */
export const START_STOP_RULES = [
  { rule: '防抖：同一设备状态切换最小间隔', value: '3 min（可调 2‑5 min）' },
  { rule: '风扇与加热片同时开', value: '允许，单次累计上限 5 min' },
  { rule: '雾化与风扇同时开', value: '禁止（雾被吹散且湿度读数失真）' },
  { rule: '风扇寿命轮换', value: '累计运行时长差 >20 h 优先启动另一台' },
  { rule: '单日最大启停次数', value: '≤100 次/天/设备' },
]

/* ==================== §8.6 事件码 ==================== */
export interface EventCode {
  code: string
  name: string
  mean: string
  level: 'info' | 'warn' | 'critical'
}

export const EVENT_CODES: EventCode[] = [
  { code: 'E1001', name: 'SENSOR_TIMEOUT', mean: '传感器连续读取超时', level: 'critical' },
  { code: 'E1002', name: 'SENSOR_FROZEN', mean: '读数长时间无变化，判为卡死', level: 'critical' },
  { code: 'E1003', name: 'SENSOR_DRIFT', mean: '传感器读数漂移跳变失真', level: 'warn' },
  { code: 'E1004', name: 'SENSOR_MULTI_DEV_BIAS', mean: '多传感器读数偏差过大', level: 'warn' },
  { code: 'E2001', name: 'CMD_REJECTED', mean: '指令被拒绝（冷静期、互斥、ttl 过期）', level: 'warn' },
  { code: 'E2002', name: 'SAFETY_LOCK', mean: '触发安全联锁并锁定，需人工解除', level: 'critical' },
  { code: 'E2003', name: 'SAFETY_LOCK_RELEASE', mean: '管理员人工解除安全锁定', level: 'info' },
  { code: 'E2004', name: 'DEVICE_RESET', mean: 'ESP32 设备发生复位重启', level: 'info' },
  { code: 'E2005', name: 'WATER_SHORTAGE', mean: '雾化片水位缺水保护触发', level: 'warn' },
  { code: 'E3001', name: 'OFFLINE_ENTER', mean: '设备进入离线自治模式', level: 'info' },
  { code: 'E3002', name: 'OFFLINE_EXIT', mean: '设备网络恢复退出离线自治模式', level: 'info' },
]

export const eventCode = (code: string): EventCode | undefined => EVENT_CODES.find((e) => e.code === code)

/* ==================== §13.1 告警分级 ==================== */
export type AlarmLevel = 'info' | 'warn' | 'critical'

export interface AlarmLevelMeta {
  id: AlarmLevel
  label: string
  color: string
  channel: string
  response: string
  autoAction: string
}

export const ALARM_LEVEL_META: AlarmLevelMeta[] = [
  {
    id: 'info',
    label: '提示',
    color: '#00E5FF',
    channel: '站内',
    response: '无需即时响应',
    autoAction: '仅记录',
  },
  {
    id: 'warn',
    label: '警告',
    color: '#FFD500',
    channel: '站内',
    response: '30 min 内处置',
    autoAction: '自动调控继续，缩紧滞回，不切断负载',
  },
  {
    id: 'critical',
    label: '紧急',
    color: '#FF3333',
    channel: '站内 + 电话',
    response: '立即',
    autoAction: '危险负载强制断电，进入 SAFE_LOCK 安全锁定',
  },
]

export const alarmLevelMeta = (id: AlarmLevel): AlarmLevelMeta =>
  ALARM_LEVEL_META.find((l) => l.id === id) ?? ALARM_LEVEL_META[0]!

/* ==================== §13.2 告警清单 ==================== */
export interface AlarmDef {
  no: string
  name: string
  trigger: string
  clear: string
  level: AlarmLevel
  advice: string
  /** 关联事件码 */
  code: string
}

export const ALARM_DEFS: AlarmDef[] = [
  {
    no: 'AL01',
    name: '温度越上限',
    trigger: '> 上限 +1.0 ℃ 持续 5 min',
    clear: '回到上限以下持续 5 min',
    level: 'warn',
    advice: '仅关闭加热不足以降温，确认风扇是否工作，必要时手动通风',
    code: 'E1003',
  },
  {
    no: 'AL02',
    name: '温度越下限',
    trigger: '< 下限 -1.0 ℃ 持续 5 min',
    clear: '回到下限以上持续 5 min',
    level: 'warn',
    advice: '检查加热片与门窗、围护密封',
    code: 'E1003',
  },
  {
    no: 'AL03',
    name: '湿度越上限',
    trigger: '> 上限 +5 %RH 持续 10 min',
    clear: '回到上限以下持续 5 min',
    level: 'warn',
    advice: '开启通风排湿；检查雾化片是否误持续工作；检查是否漏水结露',
    code: 'E1003',
  },
  {
    no: 'AL04',
    name: '湿度越下限',
    trigger: '< 下限 -5 %RH 持续 10 min',
    clear: '回到下限以上持续 5 min',
    level: 'info',
    advice: '检查水箱水位与雾化片；检查通风量是否过大',
    code: 'E2005',
  },
  {
    no: 'AL05',
    name: '传感器异常',
    trigger: '读取超时 / 读数卡死不变 / 超出物理量程',
    clear: '连续 3 次采样读数有效，并且人工在前端确认清除',
    level: 'critical',
    advice: '检查接线与探头，必要时更换',
    code: 'E1002',
  },
  {
    no: 'AL06',
    name: '设备离线',
    trigger: '心跳超时 180 s',
    clear: '收到设备正常状态心跳报文',
    level: 'warn',
    advice: '检查设备供电、WiFi 信号、路由器；检查 MQTT 服务状态',
    code: 'E3001',
  },
  {
    no: 'AL07',
    name: '加热片超时锁定',
    trigger: '连续通电 >15 min',
    clear: '管理员人工解除安全锁定',
    level: 'critical',
    advice: '立刻现场检查加热片、继电器是否粘连；排查控制逻辑',
    code: 'E2002',
  },
  {
    no: 'AL08',
    name: '设备频繁启停',
    trigger: '单设备 1 h 内启停 >20 次',
    clear: '管理员调整滞回 / 冷静期参数，启停恢复正常频率',
    level: 'info',
    advice: '增大滞回带宽、延长冷静期，排查传感器是否读数抖动',
    code: 'E2001',
  },
]

export const alarmDef = (no: string): AlarmDef | undefined => ALARM_DEFS.find((a) => a.no === no)

/* ==================== §6.3 越限判定（§1.5） ==================== */
export type OverrunLevel = 'normal' | 'mild' | 'severe'

export interface OverrunState {
  temp: OverrunLevel
  hum: OverrunLevel
  worst: OverrunLevel
  /** 今日累计越限分钟 */
  minutesToday: number
  /** 今日温度越限分钟 */
  tempMinutes: number
  /** 今日湿度越限分钟 */
  humMinutes: number
  /** 当前越限已持续分钟 */
  currentMin: number
  worstSide: 'high' | 'low' | null
}

export const overrunLevelMeta: Record<OverrunLevel, { label: string; color: string }> = {
  normal: { label: '正常', color: '#00FFAA' },
  mild: { label: '轻度越限', color: '#FFD500' },
  severe: { label: '重度越限', color: '#FF3333' },
}

/**
 * 依据 §1.5：越限=温湿度任意一项超出目标最优区间；
 * 持续 ≤ 容许越限时长 = 轻度（仅记录），> 容许越限时长 = 重度（触发告警）。
 */
export function judgeOverrun(
  temp: number,
  hum: number,
  range: TargetRange,
  overMinutes: { temp: number; hum: number },
): OverrunState {
  const tOut = temp > range.tMax || temp < range.tMin
  const hOut = hum > range.hMax || hum < range.hMin
  const tLevel: OverrunLevel = !tOut ? 'normal' : overMinutes.temp > range.toleranceMin ? 'severe' : 'mild'
  const hLevel: OverrunLevel = !hOut ? 'normal' : overMinutes.hum > range.toleranceMin ? 'severe' : 'mild'
  const rank: Record<OverrunLevel, number> = { normal: 0, mild: 1, severe: 2 }
  const worst = rank[tLevel] >= rank[hLevel] ? tLevel : hLevel
  const worstSide = temp > range.tMax || hum > range.hMax ? 'high' : temp < range.tMin || hum < range.hMin ? 'low' : null
  return {
    temp: tLevel,
    hum: hLevel,
    worst,
    minutesToday: overMinutes.temp + overMinutes.hum,
    tempMinutes: overMinutes.temp,
    humMinutes: overMinutes.hum,
    currentMin: Math.max(overMinutes.temp, overMinutes.hum),
    worstSide,
  }
}

/** §15.5 验收硬指标：重度温湿度越限累计时长 ≤ 30 min/日 */
export const DAILY_OVERRUN_TARGET_MIN = 30
