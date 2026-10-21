/**
 * utils/spec.js —— 《环境调控规格书》静态参数表
 * 说明：本文件只存放"规格书里写死的常量"，页面与数据层只读引用，不做运行时状态计算。
 * 每个区块都标注了规格书章节号，便于与原文对照。
 */

/* ================= 6.1 龄期 ================= */
const INSTARS = [
  { code: 'I1', name: '1龄', days: '约3~4天', memo: '收蚁→第1次眠，小蚕全防干育，温湿度极敏感' },
  { code: 'I2', name: '2龄', days: '约3天', memo: '持续保温保湿、减少通风' },
  { code: 'I3', name: '3龄', days: '约3~4天', memo: '半防干育、适度通风、小蚕共育末期' },
  { code: 'I4', name: '4龄', days: '约4~5天', memo: '壮蚕开始、加大通风、高原夜间警惕低温、保温板房注意排湿' },
  { code: 'I5', name: '5龄', days: '约6~8天', memo: '代谢旺盛、严防高温高湿、防控脓病僵病' },
  { code: 'I6', name: '上蔟期', days: '约2~3天', memo: '必须通风、湿度过高产生死笼茧霉茧' },
]

/* ================= 6.2 品种 ================= */
const VARIETIES = [
  { code: 'V1', name: '两广二号', memo: '夏秋蚕主力、多化杂交、耐高温；红河/蒙自/文山规模化主推' },
  { code: 'V2', name: '云蚕7号/云蚕8号', memo: '云南本土选育、滇中/曲靖春蚕，最优温度整体下调 0.5-1℃' },
  { code: 'V3', name: '菁松×皓月', memo: '高海拔二化春蚕、不耐持续高温、夏季禁止使用' },
]

/* ================= 6.3 温湿度目标区间 =================
 * 结构：[温度下限℃, 温度上限℃, 湿度下限%RH, 湿度上限%RH, 容许越限时长min]
 */
const TARGET_RANGES = {
  I1: { V1: [27.5, 28.0, 85, 90, 15], V2: [26.5, 27.0, 85, 90, 30], V3: [26.5, 27.0, 85, 88, 15] },
  I2: { V1: [26.5, 27.0, 80, 85, 15], V2: [25.5, 26.0, 80, 85, 15], V3: [26.0, 26.5, 83, 85, 20] },
  I3: { V1: [25.0, 26.0, 75, 80, 20], V2: [24.0, 25.0, 75, 80, 20], V3: [25.0, 25.5, 80, 82, 20] },
  I4: { V1: [24.0, 25.0, 70, 75, 20], V2: [23.0, 24.0, 70, 75, 20], V3: [24.0, 24.5, 75, 78, 30] },
  I5: { V1: [23.0, 24.0, 65, 70, 30], V2: [22.0, 23.0, 65, 70, 30], V3: [22.0, 22.5, 70, 73, 30] },
  I6: { V1: [24.0, 25.0, 65, 70, 30], V2: [23.0, 24.0, 65, 70, 30], V3: [22.0, 24.0, 68, 72, 30] },
}

/** 取目标区间，附带设定值（区间中心）与文本，1.19 设定值 */
function getTargetRange(instar, variety) {
  const row = (TARGET_RANGES[instar] || TARGET_RANGES.I4)[variety] || TARGET_RANGES.I4.V1
  const tMin = row[0]
  const tMax = row[1]
  const hMin = row[2]
  const hMax = row[3]
  return {
    instar,
    variety,
    tMin,
    tMax,
    hMin,
    hMax,
    tol: row[4],
    tSet: Number(((tMin + tMax) / 2).toFixed(2)),
    hSet: Number(((hMin + hMax) / 2).toFixed(1)),
    tempText: tMin.toFixed(1) + ' ~ ' + tMax.toFixed(1) + '℃',
    humiText: hMin + ' ~ ' + hMax + '%RH',
    tolText: '容许越限 ' + row[4] + ' min',
  }
}

/* ================= 6.4 变化速率限制（每小时） ================= */
const RATE_LIMITS = [
  { key: 'tempUp', label: '升温速率', value: '≤1.5', unit: '℃/h' },
  { key: 'tempDown', label: '降温速率', value: '≤2.0', unit: '℃/h' },
  { key: 'humiUp', label: '加湿速率', value: '≤10', unit: '%RH/h' },
  { key: 'humiDown', label: '除湿速率', value: '≤12', unit: '%RH/h' },
]
const RATE_LIMIT_VALUES = { tempUp: 1.5, tempDown: 2.0, humiUp: 10, humiDown: 12 }

/* ================= 5.1 采集参数 / 5.2 有效性判定 ================= */
const SAMPLING = [
  { label: '传感器', value: 'DHT22（数据脚 GPIO4）' },
  { label: '本地采样间隔', value: '2 s' },
  { label: '上云上报间隔', value: '60 s（变化超阈值立即上报）' },
  { label: '控制计算周期', value: '10 s' },
  { label: '变化上报阈值', value: '温度 >0.5℃ 或 湿度 >3%RH' },
  { label: '多采样取值', value: '连续 3 次取中位数' },
]
const QUALITY_RULES = [
  { code: 'Q1', label: '超物理量程', rule: '读数 >80℃ 或 <0%RH → 无效，丢弃该点并记录' },
  { code: 'Q2', label: '读数卡死', rule: '连续 15 次读数完全相同 → 疑似卡死，标记故障并告警' },
  { code: 'Q3', label: '疑似干扰', rule: '1 min 内跳变 >3℃ 或 >10%RH → 丢弃并复测，连续 3 次判故障' },
  { code: 'Q4', label: '通信故障', rule: '上报超时 >180 s → 通信故障，告警并进入降级模式' },
  { code: 'Q5', label: '多传感器偏差', rule: '偏差 >1.5℃ 或 >8%RH 持续 10 min → 取更靠近危险侧的值并告警' },
]

/* ================= 7.3 控制参数（默认值｜可调范围｜生效位置） ================= */
/* short：折叠态摘要用的简称；group：页面折叠分组（见 PARAM_GROUPS） */
const CONTROL_PARAMS = [
  { key: 't_hys', label: '温度滞回带宽 T_hys', short: '温度滞回', group: 'temp', value: 0.4, min: 0.2, max: 1.0, step: 0.1, unit: '℃', side: '设备侧' },
  { key: 'h_hys', label: '湿度滞回带宽 H_hys', short: '湿度滞回', group: 'humi', value: 3, min: 0.5, max: 5, step: 0.5, unit: '%RH', side: '设备侧' },
  { key: 't_cool', label: '冷静期 T_cool', short: '冷静期', group: 'prot', value: 3, min: 2, max: 5, step: 1, unit: 'min', side: '设备侧' },
  { key: 't_on_min', label: '最短运行时长 T_on_min', short: '最短运行', group: 'prot', value: 60, min: 30, max: 180, step: 10, unit: 's', side: '设备侧' },
  { key: 't_off_min', label: '最短停顿时长 T_off_min', short: '最短停顿', group: 'prot', value: 60, min: 30, max: 180, step: 10, unit: 's', side: '设备侧' },
  { key: 't_ctrl', label: '控制周期 T_ctrl', short: '控制周期', group: 'prot', value: 10, min: 5, max: 30, step: 1, unit: 's', side: '设备侧' },
  { key: 't_ack', label: '指令超时 T_ack', short: '指令超时', group: 'prot', value: 5, min: 2, max: 10, step: 1, unit: 's', side: '服务端' },
  { key: 'n_retry', label: '指令重试次数 N_retry', short: '重试次数', group: 'prot', value: 2, min: 0, max: 3, step: 1, unit: '次', side: '服务端' },
]

/** 控制参数折叠分组（配置页把 8 个滑杆折成 3 组，避免页面过长） */
const PARAM_GROUPS = [
  { key: 'temp', name: '温度', desc: '温度闭环带宽' },
  { key: 'humi', name: '湿度', desc: '湿度闭环带宽' },
  { key: 'prot', name: '保护', desc: '冷静期 · 最短启停 · 周期 · 指令重试' },
]

/** 7.6 设备启停保护 */
const START_STOP_RULES = [
  { label: '防抖（冷静期）', value: '同设备状态切换最小间隔 3 min（可调 2~5 min）' },
  { label: '加热片 + 风扇', value: '允许同时开，累计同时开启单次上限 5 min，超过强制关闭风扇' },
  { label: '雾化片 + 风扇', value: '禁止同时开启（雾被吹散且湿度读数失真）' },
  { label: '风扇寿命轮换', value: '两台风扇累计运行时长差 >20 h 时优先启动另一台（仅 auto 模式）' },
  { label: '单日启停次数', value: '≤100 次/天/设备，超出记 info 告警（不锁设备）' },
]

/* ================= 7.2 控制模式（5 种） ================= */
const MODES = [
  {
    key: 'auto', name: '自动模式', tone: 'green',
    enter: 'BOOT→NET_INIT 完成、收到有效 config、不在安全锁定/维护',
    exit: '触发安全锁定 / 收到合法手动指令 / 心跳超时 90 s 断网',
    behavior: '本地按目标区间 + 滞回闭环控制并上报遥测/状态/事件',
  },
  {
    key: 'offline', name: '离线自治', tone: 'orange',
    enter: 'WiFi 心跳超时 90 s 判定与 Broker 断开',
    exit: '重连成功并完成状态对齐',
    behavior: '读 Flash 最后参数，完整执行安全联锁/冷静期/启停时长保护，缓存遥测事件等待补传',
  },
  {
    key: 'manual', name: '手动模式', tone: 'blue',
    enter: '收到携带合法 ACTION_TOKEN 的手动指令',
    exit: '30 min 超时 / 管理员切回 auto / 触发安全锁定',
    behavior: '冻结自动决策仅执行人工动作，冷静期与安全联锁依然生效并写审计日志',
  },
  {
    key: 'safe_lock', name: '安全锁定', tone: 'red',
    enter: 'L1 触发（超危险温度 / 加热超时 / 传感器故障 / 双风扇同时失效）',
    exit: '仅管理员人工解除，需填原因',
    behavior: '危险负载强制断电、禁止任何自动启动、持续上报事件告警',
  },
  {
    key: 'maint', name: '维护模式', tone: 'gray',
    enter: '管理员手动切换',
    exit: '管理员切回 auto',
    behavior: '不下发自动指令、执行器保持现有状态、正常采集上报、抑制非 critical 告警',
  },
]

/* ================= 7.4 温湿度耦合仲裁 A1~A9 ================= */
const COUPLING = [
  { code: 'A1', case: '温低湿低', temp: '低', humi: '低', action: '启动加热片', forbid: '禁启动降温风扇' },
  { code: 'A2', case: '温低湿正常', temp: '低', humi: '正常', action: '启动加热片', forbid: '禁启动降温风扇' },
  { code: 'A3', case: '温低湿高', temp: '低', humi: '高', action: '启动加热片 + 短时除湿风扇', forbid: '禁启动加湿片' },
  { code: 'A4', case: '温正常湿低', temp: '正常', humi: '低', action: '启动加湿片', forbid: '禁启动加热片' },
  { code: 'A5', case: '温正常湿高', temp: '正常', humi: '高', action: '启动除湿风扇', forbid: '禁启动加湿片' },
  { code: 'A6', case: '温高湿低', temp: '高', humi: '低', action: '交替启动降温风扇和加湿片', forbid: '禁启动加热片' },
  { code: 'A7', case: '温高湿正常', temp: '高', humi: '正常', action: '启动降温风扇', forbid: '禁启动加热片' },
  { code: 'A8', case: '温高湿高（最危险）', temp: '高', humi: '高', action: '风扇强排', forbid: '禁启动加湿片与加热片' },
  { code: 'A9', case: '温湿均正常', temp: '正常', humi: '正常', action: '无需动作，设备全关', forbid: '—' },
]

/* ================= 7.5 安全联锁 S1~S6 ================= */
const INTERLOCKS = [
  { code: 'S1', name: '温度超过硬上限', trigger: '目标上限 +1.5℃', action: '加热片强制断电、风扇允许继续散热（最高优先级）', release: '温度回落且人工确认' },
  { code: 'S2', name: '加热片连续工作超时', trigger: '连续通电 >15 min', action: '加热片强制断电并进入 safe_lock', release: '人工检查后解除' },
  { code: 'S3', name: '温度超过危险值', trigger: '实测 ≥32℃（固定绝对值，不受龄期品种影响）', action: '加热、雾化等危险负载强制断电、进入 safe_lock、上报 critical', release: '人工解除' },
  { code: 'S4', name: '传感器失效', trigger: 'sensor_ok=false（卡死/断路/读数越量程）', action: '加热片与雾化片强制断电、风扇开启 5 min 后关闭、进入 safe_lock、上报 critical', release: '人工确认解除' },
  { code: 'S5', name: '雾化片缺水', trigger: '硬件水位浮子开关断开', action: '硬件级切断雾化片供电、上报 warn', release: '补水后自动恢复' },
  { code: 'S6', name: '服务端失联超时', trigger: '失联 >5 min', action: '转离线自治、拒绝新远端指令', release: '重连成功' },
]

/* ================= 13.1 告警分级 ================= */
const ALARM_LEVELS = {
  info: { key: 'info', name: '提示', color: '#3d6df2', channel: '站内消息', response: '无需即时响应', autoAction: '仅记录' },
  warn: { key: 'warn', name: '警告', color: '#f59e0b', channel: '站内消息', response: '30 min 内处置', autoAction: '自动调控继续、缩紧滞回、不切断负载、记录越限统计' },
  critical: { key: 'critical', name: '紧急', color: '#ef4444', channel: '站内 + 电话/短信', response: '立即处置', autoAction: '固件硬件侧危险负载强制断电、进入 SAFE_LOCK' },
}

/* ================= 12.3 通知规则 ================= */
const NOTIFY_RULES = [
  { level: 'info', name: '提示', channel: '站内消息', roles: '操作员 + 管理员', quiet: '免打扰 22:00-06:00', escalate: '不升级' },
  { level: 'warn', name: '警告', channel: '站内消息', roles: '操作员 + 管理员', quiet: '免打扰 22:00-06:00，滞留 30 min 后推送', escalate: '30 min 未确认升级为紧急' },
  { level: 'critical', name: '紧急', channel: '站内 / 短信', roles: '管理员 + 现场值守', quiet: '无免打扰', escalate: '5 min 未确认重复呼叫，最多重复 3 次' },
]

/* ================= 13.2 告警清单 AL01~AL08 ================= */
const ALARMS = [
  { code: 'AL01', name: '温度越上限', trigger: '温度 > 上限 +1.0℃，持续 5 min', clear: '回到上限以下持续 5 min', level: 'warn', advice: '仅关加热不足以降温，确认风扇是否工作，必要时手动通风' },
  { code: 'AL02', name: '温度越下限', trigger: '温度 < 下限 -1.0℃，持续 5 min', clear: '回到下限以上持续 5 min', level: 'warn', advice: '检查加热片与门窗、围护密封' },
  { code: 'AL03', name: '湿度越上限', trigger: '湿度 > 上限 +5%RH，持续 10 min', clear: '回到上限以下持续 5 min', level: 'warn', advice: '开通风排湿；检查雾化片是否误持续工作；检查是否漏水结露' },
  { code: 'AL04', name: '湿度越下限', trigger: '湿度 < 下限 -5%RH，持续 10 min', clear: '回到下限以上持续 5 min', level: 'info', advice: '检查水箱水位与雾化片；检查通风量是否过大' },
  { code: 'AL05', name: '传感器异常', trigger: '读取超时 / 读数卡死不变 / 读数超出物理量程', clear: '连续 3 次采样有效且人工前端确认', level: 'critical', advice: '检查接线与探头，必要时更换' },
  { code: 'AL06', name: '设备离线', trigger: '心跳超时 180 s', clear: '收到设备正常状态心跳', level: 'warn', advice: '检查供电、WiFi 信号、路由器、MQTT 服务' },
  { code: 'AL07', name: '加热片超时锁定', trigger: '加热片连续通电 >15 min', clear: '管理员人工解除安全锁定', level: 'critical', advice: '立刻现场检查加热片、继电器是否粘连；排查控制逻辑' },
  { code: 'AL08', name: '设备频繁启停', trigger: '单设备 1 h 内启停 >20 次', clear: '管理员调整滞回/冷静期参数、启停恢复正常', level: 'info', advice: '增大滞回带宽、延长冷静期，排查传感器抖动' },
]

/** 13.3 抑制与去重 */
const ALARM_DEDUP = {
  suppressWindow: 15,
  dedupKey: '告警 code + barn + zone + device_id',
  recover: '告警清除后发送【告警已恢复】事件通知',
}

/* ================= 2.4 / 11.5 角色与权限 ================= */
const ROLES = [
  {
    key: 'admin', name: '管理员',
    scope: '配置龄期-品种目标区间与控制参数；签发硬件操作审批令牌；解除安全锁定并填原因；查看完整审计日志；账号权限管理；确认重大参数变更',
    terminals: 'uniapp + H5 管理后台', headcount: '1~2 人',
  },
  {
    key: 'operator', name: '操作员',
    scope: '查看实时环境与历史曲线；查看告警列表并确认普通告警；接收通知；拿到管理员令牌后执行手动控制；生成环境日报',
    terminals: 'uniapp', headcount: '2~3 人',
  },
  {
    key: 'viewer', name: '观察员',
    scope: '仅查看实时看板与历史曲线；可导出 CSV；无任何设备控制 / 告警确认 / 改参数权限',
    terminals: 'uniapp（只读）', headcount: '不限人数',
  },
]

/** 权限矩阵：'✓' 允许、'token' 需管理员审批令牌、'✗' 禁止 */
const PERMISSIONS = {
  view: { admin: true, operator: true, viewer: true },
  exportCsv: { admin: true, operator: true, viewer: true },
  manual: { admin: true, operator: 'token', viewer: false },
  ackAlarm: { admin: true, operator: true, viewer: false },
  setConfig: { admin: true, operator: false, viewer: false },
  unlock: { admin: true, operator: false, viewer: false },
  maint: { admin: true, operator: false, viewer: false },
  report: { admin: true, operator: true, viewer: false },
  agent: { admin: true, operator: true, viewer: false },
  audit: { admin: true, operator: false, viewer: false },
}

/** 校验权限，返回 {ok, needToken, reason} */
function checkPermission(role, action) {
  const row = PERMISSIONS[action]
  if (!row) return { ok: false, needToken: false, reason: '未知权限项' }
  const v = row[role]
  if (v === true) return { ok: true, needToken: false, reason: '' }
  if (v === 'token') return { ok: true, needToken: true, reason: '需管理员签发的 ACTION_TOKEN 审批令牌' }
  return { ok: false, needToken: false, reason: '当前角色无权执行该操作' }
}

/* ================= 11.6 审批令牌 ================= */
const TOKEN_RULES = {
  type: 'ACTION_TOKEN',
  issuer: '管理员在管理后台签发',
  ttlMin: 5,
  limit: '仅限令牌内部写明的 barn + zone + target 设备 + action 动作，不能挪作其他设备动作',
  use: '单次',
  revoke: '使用完毕自动作废；管理员可手动撤销；超时自动作废',
}

/* ================= 9.1 / 9.2 状态机 ================= */
const DEVICE_STATES = [
  { code: 'BOOT', name: '上电自检', memo: '仅自检，不动作执行器、不连 MQTT' },
  { code: 'NET_INIT', name: '网络初始化', memo: '连 WiFi/NTP/Broker 并读 Flash 参数，成功或超时 60 s 退出' },
  { code: 'IDLE', name: '待配置', memo: '已联网未收到有效 config，执行器全关，收到新 config 转 AUTO' },
  { code: 'AUTO', name: '自动调控', memo: '本地滞回闭环 + 冷静期 + 最短启停 + 全部安全联锁 + 周期上报' },
  { code: 'OFFLINE_AUTO', name: '离线自治', memo: '读 Flash 最后参数继续闭环，RAM 缓存遥测与事件，拒绝新远端 cmd' },
  { code: 'MANUAL', name: '人工接管', memo: '冻结自动闭环，仅执行人工开关，启动 30 min 倒计时' },
  { code: 'SAFE_LOCK', name: '安全锁定', memo: '危险负载强制断电，只允许上报 status/event' },
  { code: 'MAINT', name: '维护模式', memo: '停止自动闭环，执行器维持当前状态，抑制非 critical 告警' },
]
const SERVER_STATES = [
  { code: 'NORMAL', name: '正常', memo: '设备在线且无告警，下发 config / 记录遥测 / 处理指令 / 推送通知' },
  { code: 'DEGRADED', name: '降级', memo: '设备心跳超时或数据无效，仅记录与告警，不下发控制指令' },
  { code: 'ALARM', name: '告警', memo: '收到 level ≥ warn 事件，推送通知、生成处置建议、记录告警全生命周期' },
  { code: 'PENDING_APPROVAL', name: '待审批', memo: '需审批动作被冻结等待令牌，审批通过 / 超时作废' },
  { code: 'MAINTENANCE', name: '维护窗口', memo: '屏蔽非紧急告警、不下发自动控制、正常接收遥测' },
]
const TRANSITIONS = [
  { code: 'TR01', from: 'AUTO', to: 'OFFLINE_AUTO', event: '心跳 >90 s', memo: '记录断网时刻、切 Flash 参数、开 RAM 缓存' },
  { code: 'TR02', from: 'AUTO / OFFLINE_AUTO', to: 'SAFE_LOCK', event: '温度 > 目标上限 +1.5℃', memo: '加热片断电、上报 E2002 安全锁定事件、危险负载全部切断' },
  { code: 'TR03', from: 'OFFLINE_AUTO', to: 'AUTO', event: '重连成功并收到最新 config', memo: '补传缓存、对齐状态' },
  { code: 'TR04', from: 'SAFE_LOCK', to: 'AUTO', event: '管理员解除（现场确认故障排除）', memo: '清告警事件、读当前 config 恢复闭环、审计记录' },
]

/* ================= 4.1 设备清单 BOM ================= */
const BOM = [
  { code: 'D01', name: '温湿度传感器', model: 'DHT22', qty: '×1 片', spec: '温度 -40~80℃ ±0.5℃；湿度 0~99.9%RH ±2%RH；单总线数字输出；DC3.3~5.5V；约 1.5 mA', pos: '蚕架中部（贴近蚕座，离地 0.3 m 以内）', device: 'th01' },
  { code: 'D02', name: '主控板', model: 'ESP32-CH340', qty: '×1 块', spec: '双核 Tensilica LX6；板载 WiFi + 蓝牙；LDO 3.3V；DC5V，平均 80 mA / WiFi 峰值 240 mA', pos: '配电箱旁 IP54 防护盒', device: '' },
  { code: 'D03', name: '加热片', model: 'ST201 5W 自限温 PTC', qty: '×1 片', spec: '最高表面 60℃；绝缘封装；DC5V / 约 0.42 A；继电器常开触点', pos: '蚕架下方', device: 'heat01' },
  { code: 'D04', name: '风扇', model: '4010 DC5V', qty: '×2 台', spec: '3000 rpm 低噪；风量 2~3 CFM；0.15 A；继电器仅开关无档位', pos: '对角墙面，一送一排', device: 'fan01 / fan02' },
  { code: 'D05', name: '雾化片 + 驱动器', model: '超声波 φ20 + 专用驱动板', qty: '×1 套', spec: '雾化量约 300 mL/h；频率 108 kHz；缺水保护；DC5V / 约 0.8 A', pos: '水箱上方，出雾口朝上', device: 'mist01' },
  { code: 'D06', name: '继电器模块', model: '1 路光耦隔离', qty: '×4 块', spec: '触点 10A/250VAC；低电平触发；每路吸合约 20 mA', pos: '与 ESP32 同防护盒', device: 'heat01 / fan01 / fan02 / mist01' },
  { code: 'D07', name: '电源', model: 'AC220V 转 DC12V/5A + DC5V/3A', qty: '×1', spec: '双路带过流保护；总功率余量 ≥30%', pos: '配电箱内', device: '' },
]

/* ================= 3 命名规范 ================= */
const NAMING_RULES = [
  { item: '对象层级', value: '蚕房 barn → 控制区 zone → 设备组 group → 设备 device' },
  { item: '蚕房编号', value: 'barn + 两位序号（barn01 ~ barn04）' },
  { item: '控制区编号', value: 'zone + 两位序号（zone01 ~ zone04），每栋蚕房默认对应一个 zone' },
  { item: '设备组编号', value: 'grp + 两位序号（grp01），与 zone 一一对应' },
  { item: '设备编号', value: '类型缩写 + 两位序号：heat01 / fan01 / fan02 / mist01（全局唯一）' },
  { item: '传感器编号', value: 'th + 两位序号：th01' },
  { item: 'MQTT Topic', value: '{barn}/{zone}/子主题，全小写、斜杠分隔、首尾不带斜杠，例 barn01/zone01/telemetry' },
  { item: '时间戳', value: '统一 UTC、ISO8601 到毫秒、字段名 ts，例 2026-09-18T10:00:00.000Z' },
  { item: '代码文件', value: '小写下划线按模块分目录，禁驼峰/中文/空格，例 rule_engine.py' },
  { item: '数据库表', value: '小写下划线单数名词，禁复数大写，例 telemetry / control_cmd / alarm' },
]
const TOPICS = ['telemetry', 'status', 'cmd', 'cmd_ack', 'event', 'config']

/* ================= 14.2 关键配置项 ================= */
const CONFIG_KEYS = [
  { key: 'MQTT_HOST', type: 'string', def: '192.168.1.10', secret: false, memo: 'MQTT broker 服务地址' },
  { key: 'MQTT_PORT_INNER', type: 'integer', def: '1883', secret: false, memo: '内网明文端口' },
  { key: 'MQTT_PORT_TLS', type: 'integer', def: '8883', secret: false, memo: 'TLS 加密端口' },
  { key: 'MQTT_USER', type: 'string', def: 'silk_barn_dev', secret: true, memo: 'MQTT 基础账号模板' },
  { key: 'MQTT_PASSWORD', type: 'string', def: '无默认，必填', secret: true, memo: '服务端连接 MQTT 密码' },
  { key: 'DB_HOST', type: 'string', def: 'postgres', secret: false, memo: '数据库地址' },
  { key: 'DB_USER', type: 'string', def: 'silkuser', secret: true, memo: '数据库账号' },
  { key: 'DB_PASSWORD', type: 'string', def: '无默认，必填', secret: true, memo: '数据库密码' },
  { key: 'TEMP_SAFETY_MAX', type: 'float', def: '32.0', secret: false, memo: '固件硬编码危险温度阈值' },
  { key: 'LLM_API_KEY', type: 'string', def: '无默认，必填', secret: true, memo: '大模型 API 密钥' },
  { key: 'SMS_API_CONFIG', type: 'json', def: 'null', secret: true, memo: '短信告警推送接口配置' },
  { key: 'AUTO_BACKUP_CRON', type: 'string', def: '0 2 * * *', secret: false, memo: '数据库定时备份 crontab 表达式' },
]

/* ================= 11.3 Agent 工具契约 ================= */
const AGENT_TOOLS = [
  { name: 'get_telemetry', use: '取当前温湿度与设备运行状态', perm: '观察员及以上', timeout: '3 s' },
  { name: 'query_history', use: '按时间段查历史遥感时序数据', perm: '观察员及以上', timeout: '10 s' },
  { name: 'get_device_status', use: '查设备在线/故障/控制/模式', perm: '观察员及以上', timeout: '3 s' },
  { name: 'propose_action', use: '提出设备动作建议，不执行', perm: '操作员及以上', timeout: '5 s' },
  { name: 'execute_action', use: '执行设备动作（切换物理继电器）', perm: '需审批令牌（管理员）', timeout: '8 s' },
  { name: 'get_forecast', use: '取未来 1 h 温湿度预测', perm: '观察员及以上', timeout: '5 s' },
  { name: 'diagnose_anomaly', use: '异常诊断分析（传感器/设备/环境）', perm: '操作员及以上', timeout: '20 s' },
  { name: 'list_alarms / ack_alarm', use: '列出 / 确认告警', perm: '操作员及以上', timeout: '5 s' },
  { name: 'generate_report', use: '生成日报 / 周报', perm: '操作员及以上', timeout: '60 s' },
  { name: 'set_config', use: '修改目标区间参数', perm: '需令牌（管理员）', timeout: '8 s' },
]

/* ================= 11.7 限流与脱敏 ================= */
const AI_LIMITS = [
  { label: '单用户每分钟请求上限', value: '10 次', memo: '超过上限返回 429，提示稍后重试' },
  { label: '单会话 token 上限', value: '100 k/天', memo: '超出后转本地模型或提示次日再用' },
  { label: '需脱敏字段', value: '手机号、账号、服务器 IP、MQTT 账号密钥、LLM-API-KEY', memo: '进 prompt 前替换为占位符' },
]

/* ================= 10.3 聚合计算规则 ================= */
const AGG_RULES = [
  { level: '原始 telemetry_raw', use: '故障深度排查、离线补传原始数据源', logic: '设备直接上报的原始遥测报文入库', keep: '90 天' },
  { level: '分钟 telemetry_agg_min', use: '前端历史曲线展示、越限分钟统计', logic: '每分钟窗口计算温湿度 avg/max/min，统计越限秒数与有效采样点数', keep: '1 年' },
  { level: '小时 telemetry_agg_hour', use: '日报、周报、长期养蚕环境指标、月度统计', logic: '对分钟聚合再聚合：小时均值、极值、小时总越限时长', keep: '永久' },
]

/* ================= 2.2 功能范围（MVP 边界） ================= */
const FUNCTIONS = [
  { code: 'F1', name: '温湿度采集', mvp: true, memo: 'DHT22 每 10 s 采一次 / 60 s 上报 / 突变立即上报 / 多次取中位数' },
  { code: 'F2', name: '阈值滞回自动调控', mvp: true, memo: 'ESP32 本地闭环，MQTT 热更新，断网自治' },
  { code: 'F3', name: '安全联锁与强制断电', mvp: true, memo: '最高优先级，固件硬编码，优先级高于自动逻辑与远程手动' },
  { code: 'F4', name: '远程手动控制', mvp: true, memo: '仅管理员与操作员，二次确认，高危需审批令牌，30 min 超时退回自动，写审计日志' },
  { code: 'F5', name: '告警与通知', mvp: true, memo: '三级分级，设备端产生事件上报，告警落库保存 1 年，抑制去重' },
  { code: 'F6', name: '历史数据查询与曲线', mvp: true, memo: '时间段查询 + 曲线 + 导出 CSV；原始 90 天 / 分钟聚合 1 年' },
  { code: 'F7', name: '下一小时温湿度预测', mvp: false, memo: 'M4 阶段' },
  { code: 'F8', name: 'LLM Agent 问答/报告/诊断', mvp: false, memo: 'M3 阶段；仅建议，禁止下发硬件控制，执行动作必须人工审批令牌' },
  { code: 'F9', name: '离线自治', mvp: true, memo: '心跳超时 90 s 进入，读 Flash 最后参数，安全联锁仍生效，恢复后补传' },
  { code: 'F10', name: '多栋蚕房统一看板', mvp: false, memo: '试点后考虑；数据模型预留 barn 层级，MVP 只做单蚕房试点' },
]

export {
  INSTARS,
  VARIETIES,
  TARGET_RANGES,
  getTargetRange,
  RATE_LIMITS,
  RATE_LIMIT_VALUES,
  SAMPLING,
  QUALITY_RULES,
  CONTROL_PARAMS,
  PARAM_GROUPS,
  START_STOP_RULES,
  MODES,
  COUPLING,
  INTERLOCKS,
  ALARM_LEVELS,
  NOTIFY_RULES,
  ALARMS,
  ALARM_DEDUP,
  ROLES,
  PERMISSIONS,
  checkPermission,
  TOKEN_RULES,
  DEVICE_STATES,
  SERVER_STATES,
  TRANSITIONS,
  BOM,
  NAMING_RULES,
  TOPICS,
  CONFIG_KEYS,
  AGENT_TOOLS,
  AI_LIMITS,
  AGG_RULES,
  FUNCTIONS,
}
