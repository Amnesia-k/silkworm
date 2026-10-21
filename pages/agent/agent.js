// pages/agent/agent.js —— P07 Agent 问答（规格书 12.1 P07 / 7.1 L4 / 11.3 工具契约 / 11.7 限流与审计）
//
// 演示环境没有后端：回答由「本地规则 + utils/data.js 的真实模拟数据」组装，
// 每个结论都能在回答里核对应答字段；Agent 只输出文字建议与巡检报告，
// 禁止下发硬件控制指令、不参与实时闭环，设备动作一律转成建议卡由人工确认（规格书 F8）。
const data = require('../../utils/data.js')
const engine = require('../../utils/engine.js')
const spec = require('../../utils/spec.js')
const nav = require('../../utils/nav.js')

/** 11.7 单用户请求限流：每 60 s 最多 10 次 */
const RATE_LIMIT = 10
const RATE_WINDOW = 60000

/** 快捷问题（点击即作为用户输入） */
const QUICK_QUESTIONS = [
  '当前温湿度是否正常？',
  '为什么湿度偏高？',
  '加热片今天开了多久？',
  '今天的日报摘要',
  '有哪些活跃告警？',
]

let msgSeq = 0
let toolSeq = 0
let srcSeq = 0

function nextMsgId() {
  msgSeq += 1
  return 'm' + Date.now().toString(36) + '-' + msgSeq
}

/** 在 spec.AGENT_TOOLS 里找工具契约（'list_alarms / ack_alarm' 这类合并命名用包含匹配） */
function toolOf(name) {
  return spec.AGENT_TOOLS.filter(function (t) { return t.name === name })[0] ||
    spec.AGENT_TOOLS.filter(function (t) { return t.name.indexOf(name) >= 0 })[0] || null
}

/** 组装一条工具调用记录：名字/入参取 spec 契约，耗时按契约超时上限截断 */
function makeTool(name, args, costMs, result) {
  const def = toolOf(name)
  const timeout = def ? def.timeout : '—'
  const budget = Math.round(parseFloat(timeout) * 1000)
  toolSeq += 1
  return {
    key: 'tl' + toolSeq,
    name: def ? def.name : name,
    use: def ? def.use : '',
    args: args,
    costMs: budget > 0 && costMs > budget ? budget : costMs,
    timeout: timeout,
    result: result,
  }
}

function metricName(metric) {
  return metric === 'temp' ? '温度' : '湿度'
}

function metricUnit(metric) {
  return metric === 'temp' ? '℃' : '%RH'
}

/** 越限项 → 可核对的一句话 */
function itemText(it, tolSec) {
  return metricName(it.metric) + (it.dir === 'high' ? '高于上限 ' : '低于下限 ') +
    it.limit + metricUnit(it.metric) + '，实际 ' + it.value + metricUnit(it.metric) +
    '，偏差 ' + it.delta + '，已越限 ' + Math.round(it.dueSec / 60) + ' min' +
    '（容许 ' + Math.round(tolSec / 60) + ' min）'
}

Page({
  data: {
    barnKey: '',
    status: null,
    roleName: '',
    agentPerm: { ok: true, needToken: false, reason: '' },
    messages: [],
    input: '',
    quickList: QUICK_QUESTIONS,
    tools: spec.AGENT_TOOLS,
    toolNames: '',
    toolsOpen: false,
    rateCount: 0,
    rateLimit: RATE_LIMIT,
  },

  onLoad() {
    if (!nav.ensureBarn()) return
    this._rateTimes = []
    this.refresh()
  },

  onShow() {
    this.refresh()
    if (!this._tick) this._tick = () => this.refresh()
    engine.subscribe(this._tick)
  },

  onHide() {
    engine.unsubscribe(this._tick)
  },

  onUnload() {
    engine.unsubscribe(this._tick)
  },

  /* ---------------- 刷新（全局引擎每 4 s 回调一次） ---------------- */
  refresh() {
    const cur = data.getCurrentBarn()
    if (!cur) return
    const barnKey = cur.barn
    const patch = {
      barnKey: barnKey,
      status: data.getStatusSummary(barnKey),
      roleName: data.getRole().name,
      agentPerm: data.can('agent'),
      quickList: QUICK_QUESTIONS,
      tools: spec.AGENT_TOOLS,
      toolNames: spec.AGENT_TOOLS.map(function (t) { return t.name }).join(' · '),
      rateCount: (this._rateTimes || []).length,
      rateLimit: RATE_LIMIT,
    }
    // 首次进入或切换蚕房：重置对话流，给出当前蚕房的开场白
    if (barnKey !== this.data.barnKey || !this.data.messages.length) {
      patch.messages = [this.greeting(barnKey)]
    }
    this.setData(patch)
  },

  /* ---------------- 开场白 ---------------- */
  greeting(barnKey) {
    const s = data.getStatusSummary(barnKey)
    const scope = s.barn + '/' + s.zone
    const now = data.formatTime(s.simClock)
    return {
      id: nextMsgId(),
      role: 'agent',
      ts: s.simClock,
      text: '你好，我是蚕房环境 Agent（演示环境：本地规则 + 真实模拟数据，无后端）。\n' +
        '我已接管「' + s.name + '」的只读上下文：' + s.tempText + '℃ / ' + s.humiText + '%RH，目标 ' +
        s.target.tempText + ' / ' + s.target.humiText + '，模式「' + s.modeName + '」。\n' +
        '可问我：当前温湿度是否正常 / 为什么湿度偏高 / 加热片今天开了多久 / 今天的日报摘要 / 有哪些活跃告警。\n' +
        '能力边界：只提供文字建议与巡检报告，禁止下发硬件控制指令，不参与实时闭环；执行动作需人工确认。',
      sources: [this.source('get_telemetry', scope, now)],
      tools: [makeTool('get_telemetry', '{barn:' + s.barn + ', zone:' + s.zone + '}', 180,
        'temp=' + s.temp.toFixed(2) + '℃, humi=' + s.humi.toFixed(1) + '%RH, mode=' + s.mode +
        ', online=' + s.online + ', device_on=' + s.devices.on + '/' + s.devices.total)],
      actions: [],
      showTools: false,
    }
  },

  source(tool, scope, time) {
    srcSeq += 1
    return { key: 'src' + srcSeq, tool: tool, scope: scope, time: time }
  },

  /* ---------------- 本地回答规则 ---------------- */
  answer(question) {
    const q = question || ''
    const s = data.getStatusSummary(this.data.barnKey)
    const scope = s.barn + '/' + s.zone
    const now = data.formatTime(s.simClock)
    if (q.indexOf('温湿度') >= 0 || q.indexOf('温度') >= 0 || q.indexOf('正常') >= 0) {
      return this.ansEnv(s, scope, now)
    }
    if (q.indexOf('湿度') >= 0 || q.indexOf('偏高') >= 0 || q.indexOf('偏低') >= 0 || q.indexOf('偏湿') >= 0) {
      return this.ansHumi(s, scope, now)
    }
    if (this.hasDeviceWord(q)) {
      return this.ansDevice(s, scope, now, q)
    }
    if (q.indexOf('日报') >= 0 || q.indexOf('报表') >= 0 || q.indexOf('周报') >= 0 || q.indexOf('摘要') >= 0) {
      return this.ansReport(s, scope, now)
    }
    if (q.indexOf('告警') >= 0) {
      return this.ansAlarm(s, scope, now)
    }
    return this.ansFallback(s, scope, now)
  },

  hasDeviceWord(q) {
    const words = ['加热', '风扇', '雾化', '加湿', '通风', '多久', '运行时长', '设备', 'heat', 'fan', 'mist']
    for (let i = 0; i < words.length; i++) {
      if (q.indexOf(words[i]) >= 0) return true
    }
    return false
  },

  /** 分支 1：温湿度是否正常（get_telemetry） */
  ansEnv(s, scope, now) {
    const oo = s.outOfRange
    const lines = []
    lines.push('【实时环境】' + s.name + '（' + s.barn + '/' + s.zone + '）温度 ' + s.tempText + '℃、湿度 ' +
      s.humiText + '%RH、露点 ' + s.dewp + '℃。')
    lines.push('【目标区间】' + s.instarName + ' · ' + s.varietyName + ' → 温度 ' + s.target.tempText +
      '、湿度 ' + s.target.humiText + '，' + s.target.tolText + '。')
    if (oo.inRange) {
      lines.push('【越限判定】' + oo.levelName + '：温度' + (oo.tempIn ? '在区间内' : '已越限') +
        '、湿度' + (oo.humiIn ? '在区间内' : '已越限') + '，越限项 0 项。')
    } else {
      lines.push('【越限判定】' + oo.levelName + '：越限 ' + oo.items.length + ' 项 —— ' +
        oo.items.map(function (it) { return itemText(it, oo.tolSec) }).join('；') + '。')
    }
    lines.push('【设备 / 模式】' + s.devices.total + ' 台设备中 ' + s.devices.on + ' 台运行' +
      (s.devices.locked ? '，' + s.devices.locked + ' 台锁定' : '') + '；控制模式「' + s.modeName + '」' +
      (s.mode === 'auto'
        ? '（' + s.modeInfo.behavior + '）'
        : '：' + s.modeInfo.behavior + '（进入条件：' + s.modeInfo.enter + '）') +
      '；通信' + (s.online ? '在线（' + s.wifiText + '）' : '离线 ' + s.offlineText) + '。')
    if (s.interlock && s.interlock.active) {
      lines.push('【安全联锁】' + s.interlock.code + ' ' + s.interlock.name + '：' + s.interlock.reason)
    }
    lines.push('【结论】' + (oo.inRange
      ? '温湿度均在目标区间内，自动闭环正常，无需人工干预。'
      : '建议按下方动作建议人工处置；危险负载（加热/雾化）在越限时会被联锁限制。'))
    return {
      text: lines.join('\n'),
      sources: [this.source('get_telemetry', scope, now)],
      tools: [makeTool('get_telemetry', '{barn:' + s.barn + ', zone:' + s.zone + '}', 180,
        'temp=' + s.temp.toFixed(2) + '℃, humi=' + s.humi.toFixed(1) + '%RH, out_level=' + oo.level +
        ', temp_in=' + oo.tempIn + ', humi_in=' + oo.humiIn + ', devices_on=' + s.devices.on + '/' + s.devices.total)],
      actions: this.buildActions(s, oo),
    }
  },

  /** 分支 2：湿度偏高 / 偏低（get_out_of_range + get_device_status + 耦合仲裁 7.4） */
  ansHumi(s, scope, now) {
    const oo = s.outOfRange
    const mist = s.devices.mist
    const ci = s.couplingInfo
    const humiItem = oo.items.filter(function (it) { return it.metric === 'humi' })[0] || null
    const dir = humiItem ? humiItem.dir : 'in'
    const code = dir === 'high' ? 'AL03' : (dir === 'low' ? 'AL04' : '')
    const def = code ? spec.ALARMS.filter(function (a) { return a.code === code })[0] : null
    const lines = []
    lines.push('【湿度现状】' + s.name + ' 当前湿度 ' + s.humiText + '%RH，目标区间 ' + s.target.humiText +
      '（' + s.instarName + ' · ' + s.varietyName + '），' +
      (dir === 'in' ? '当前在区间内。' : (dir === 'high' ? '已高于上限。' : '已低于下限。')))
    if (humiItem) {
      lines.push('【越限明细】' + (dir === 'high' ? '高于上限 ' : '低于下限 ') + humiItem.limit + '%RH，实际 ' +
        humiItem.value + '%RH，偏差 ' + humiItem.delta + '%RH，已持续 ' + Math.round(humiItem.dueSec / 60) +
        ' min；整体越限等级「' + oo.levelName + '」（容许 ' + Math.round(oo.tolSec / 60) + ' min）。')
      if (def) {
        lines.push('【告警口径】' + def.code + ' ' + def.name + '：触发 ' + def.trigger + '；恢复 ' + def.clear + '。')
      }
    } else {
      lines.push('【越限明细】湿度未越限，越限项仅含温度或无越限项；整体等级「' + oo.levelName + '」。')
    }
    lines.push('【加湿设备】雾化片 ' + (mist ? mist.name + ' ' + mist.stateText + '，今日累计运行 ' + mist.runtimeText +
      '，今日启停 ' + mist.switchesToday + ' 次，最近一次切换 ' + mist.lastSwitchText +
      (mist.locked ? '，当前锁定：' + mist.lockText : '') : '缺失') + '。')
    lines.push('【耦合工况】' + s.coupling + ' ' + ci.case + '（温度' + ci.temp + '、湿度' + ci.humi +
      '）→ 规格书 7.4 动作：' + ci.action + '；禁止：' + ci.forbid + '。')
    if (s.devices.fans && s.devices.fans.length) {
      const f = s.devices.fans[0]
      lines.push('【除湿通道】' + s.name + ' 有 ' + s.devices.fans.length + ' 台风扇（' + f.name + ' ' + f.stateText +
        '，今日 ' + f.switchesToday + ' 次启停）；注意 7.6 禁止雾化片与风扇同时开启。')
    }
    lines.push('【建议】' + (def ? def.advice : '湿度在目标区间内，保持自动闭环；若房间漏湿或结露，检查门窗与围护密封。'))
    return {
      text: lines.join('\n'),
      sources: [
        this.source('get_telemetry', scope, now),
        this.source('get_device_status', scope, now),
      ],
      tools: [
        makeTool('get_telemetry', '{barn:' + s.barn + ', zone:' + s.zone + '}', 180,
          'humi=' + s.humi.toFixed(1) + '%RH, target=' + s.target.humiText + ', out_level=' + oo.level),
        makeTool('get_device_status', '{barn:' + s.barn + ', device:mist01}', 150,
          'mist01=' + (mist ? mist.stateText + ', runtime=' + mist.runtimeMin + 'min, switches_today=' + mist.switchesToday : 'n/a')),
        makeTool('diagnose_anomaly', '{barn:' + s.barn + ', focus:humi}', 12000,
          'coupling=' + s.coupling + ' (' + ci.case + '), action=' + ci.action + ', forbid=' + ci.forbid),
      ],
      actions: this.humiActions(s, dir, ci),
    }
  },

  /** 分支 3：设备运行时长 / 启停 / 锁定（get_device_status） */
  ansDevice(s, scope, now, q) {
    const list = data.getDevices(s.barn)
    const hits = this.pickDevices(q, list)
    const lines = []
    lines.push('【设备台账】' + s.name + ' 共 ' + list.length + ' 台：运行 ' + s.devices.on + ' 台、锁定 ' +
      s.devices.locked + ' 台、离线 ' + s.devices.offline + ' 台；控制模式「' + s.modeName + '」。')
    hits.forEach(function (d) {
      lines.push('· ' + d.name + '（' + d.id + '）' + d.stateText + '：今日累计运行 ' + d.runtimeText +
        '（' + d.runtimeMin + ' min），今日启停 ' + d.switchesToday + ' 次，最近一次切换 ' + d.lastSwitchText +
        (d.locked ? '，已锁定：' + d.lockText : '') + '，' + (d.online ? '在线' : '离线') + '。')
    })
    if (hits.length === 1 && hits[0].kind === 'heat') {
      lines.push('【约束提示】加热片受 7.5 S2 联锁：连续通电 >15 min 会强制断电并进入 SAFE_LOCK；单日启停 >20 次会产生 AL08。')
    }
    if (s.mode === 'manual') {
      lines.push('【手动模式】当前为人工接管，剩余自动退回时间 ' + data.formatDuration(s.manualLeftSec) + '（超时自动回到自动模式）。')
    }
    return {
      text: lines.join('\n'),
      sources: [this.source('get_device_status', scope, now)],
      tools: [makeTool('get_device_status', '{barn:' + s.barn + ', devices:[' +
        hits.map(function (d) { return d.id }).join(',') + ']}', 150,
      hits.map(function (d) {
        return d.id + '=' + (d.on ? 'ON' : 'OFF') + '/runtime ' + d.runtimeMin + 'min/switches ' + d.switchesToday
      }).join('; '))],
      actions: [],
    }
  },

  /** 分支 4：日报摘要（generate_report） */
  ansReport(s, scope, now) {
    const r = data.getDayReport(s.barn, data.getState().simClock)
    const sw = r.switches || {}
    const lines = []
    lines.push('【日报 ' + r.date + '】' + r.barnName + '（' + r.barn + '/' + r.zone + '）' + r.instarName + ' · ' + r.varietyName + '。')
    lines.push('【温度】均值 ' + r.tempAvg + '℃、最高 ' + r.tempMax + '℃、最低 ' + r.tempMin + '℃；目标 ' +
      r.range.tempText + '；累计越限 ' + r.tempOutText + '（' + r.tempOutMin + ' min）。')
    lines.push('【湿度】均值 ' + r.humiAvg + '%RH、最高 ' + r.humiMax + '%RH、最低 ' + r.humiMin + '%RH；目标 ' +
      r.range.humiText + '；累计越限 ' + r.humiOutText + '（' + r.humiOutMin + ' min）。')
    lines.push('【告警】共 ' + r.alarmTotal + ' 条：紧急 ' + r.alarmCritical + ' / 警告 ' + r.alarmWarn + ' / 提示 ' + r.alarmInfo + '。')
    lines.push('【样本与启停】分钟级样本 ' + r.samples + ' 个，越限时长占比 ' + r.outRate + '%；设备启停 heat01 ' +
      sw.heat01 + ' 次、fan01 ' + sw.fan01 + ' 次、fan02 ' + sw.fan02 + ' 次、mist01 ' + sw.mist01 + ' 次。')
    lines.push('【说明】该日报为演示数据（分钟聚合按确定性函数推算，规格书 10.3），完整报表见 P06 日报报表页。')
    return {
      text: lines.join('\n'),
      sources: [this.source('generate_report', scope, now)],
      tools: [makeTool('generate_report', '{barn:' + s.barn + ', date:' + r.date + ', type:daily}', 45000,
        'samples=' + r.samples + ', temp_avg=' + r.tempAvg + ', humi_avg=' + r.humiAvg +
        ', temp_out=' + r.tempOutMin + 'min, humi_out=' + r.humiOutMin + 'min, alarms=' + r.alarmTotal)],
      actions: [],
    }
  },

  /** 分支 5：活跃告警（list_alarms） */
  ansAlarm(s, scope, now) {
    const list = data.getAlarms(s.barn, { status: 'active' })
    const stats = data.getAlarmStats(s.barn)
    const lines = []
    lines.push('【活跃告警】' + s.name + ' 当前活跃 ' + stats.active + ' 条：紧急 ' + stats.critical + ' / 警告 ' +
      stats.warn + ' / 提示 ' + stats.info + '，其中未确认 ' + stats.unacked + ' 条。')
    if (!list.length) {
      lines.push('当前没有活跃告警（历史累计 ' + stats.total + ' 条，已恢复 ' + stats.cleared + ' 条）。')
    } else {
      list.slice(0, 3).forEach(function (a, i) {
        lines.push((i + 1) + '. ' + a.code + ' [' + a.levelName + '] ' + a.text + '（' + a.timeText + '，' +
          a.agoText + '）处置建议：' + a.advice)
      })
      if (list.length > 3) lines.push('（本地演示仅列最新 3 条，共 ' + list.length + ' 条，完整列表见 P03 告警页）')
    }
    lines.push('【口径】' + spec.ALARM_LEVELS.critical.name + '：' + spec.ALARM_LEVELS.critical.channel + '、' +
      spec.ALARM_LEVELS.critical.response + '；' + spec.ALARM_LEVELS.warn.name + '：' +
      spec.ALARM_LEVELS.warn.channel + '、' + spec.ALARM_LEVELS.warn.response + '。')
    return {
      text: lines.join('\n'),
      sources: [this.source('list_alarms', scope, now)],
      tools: [makeTool('list_alarms', '{barn:' + s.barn + ', status:active, limit:3}', 260,
        'active=' + stats.active + ', critical=' + stats.critical + ', warn=' + stats.warn +
        ', info=' + stats.info + ', unacked=' + stats.unacked)],
      actions: [],
    }
  },

  /** 兜底：能力边界 + 可用问题清单 */
  ansFallback(s, scope, now) {
    const oo = s.outOfRange
    const lines = []
    lines.push('【能力边界】我是蚕房环境 Agent，在本地演示环境里只做「只读查询 + 文字建议 + 巡检报告」：' +
      '禁止下发硬件控制指令，不参与实时闭环；任何设备动作都必须由你在手动控制页二次确认，' +
      '操作员还需管理员签发的 ACTION_TOKEN（规格书 7.1 L4 / F8 / 11.6）。')
    lines.push('【可用问题】' + QUICK_QUESTIONS.join(' / ') + '；也可以直接问设备名（加热片 / 风扇 / 雾化片）、' +
      '某段时间的历史（query_history）、异常诊断（diagnose_anomaly）。')
    lines.push('【当前速览】' + s.name + '：' + s.tempText + '℃ / ' + s.humiText + '%RH，目标 ' + s.target.tempText +
      ' / ' + s.target.humiText + '，' + oo.levelName + '，模式「' + s.modeName + '」，' + s.devices.on +
      '/' + s.devices.total + ' 台设备运行，活跃告警 ' + s.alarms.active + ' 条。')
    return {
      text: lines.join('\n'),
      sources: [this.source('get_telemetry', scope, now)],
      tools: [makeTool('get_telemetry', '{barn:' + s.barn + ', zone:' + s.zone + '}', 180,
        'temp=' + s.temp.toFixed(2) + '℃, humi=' + s.humi.toFixed(1) + '%RH, mode=' + s.mode +
        ', alarm_active=' + s.alarms.active)],
      actions: [],
    }
  },

  /** 越限项 → 动作建议卡（只建议、不执行） */
  buildActions(s, oo) {
    const out = []
    oo.items.forEach(function (it) {
      if (it.metric === 'humi' && it.dir === 'high') {
        out.push({
          target: 'mist01', action: '关闭雾化片',
          reason: '湿度 ' + it.value + '%RH 高于上限 ' + it.limit + '%RH（超出 ' + it.delta + '，已持续 ' +
            Math.round(it.dueSec / 60) + ' min）',
          risk: '低：切断加湿负载不会造成危险，但湿度回落慢',
        })
        out.push({
          target: 'fan01', action: '开启除湿通风风扇',
          reason: '7.4 耦合仲裁 ' + s.coupling + ' ' + s.couplingInfo.case + ' → ' + s.couplingInfo.action,
          risk: '中：' + s.couplingInfo.forbid + '，同时会带来降温',
        })
      } else if (it.metric === 'humi' && it.dir === 'low') {
        out.push({
          target: 'mist01', action: '开启雾化片加湿',
          reason: '湿度 ' + it.value + '%RH 低于下限 ' + it.limit + '%RH（差额 ' + it.delta + '）',
          risk: '低：注意水箱水位与 S5 缺水保护；与风扇禁止同时开',
        })
      } else if (it.metric === 'temp' && it.dir === 'high') {
        out.push({
          target: 'fan01', action: '开启降温风扇',
          reason: '温度 ' + it.value + '℃ 高于上限 ' + it.limit + '℃（超出 ' + it.delta + '）',
          risk: '中：降温同时降湿；≥32℃ 会触发 S3 硬联锁',
        })
      } else if (it.metric === 'temp' && it.dir === 'low') {
        out.push({
          target: 'heat01', action: '开启加热片',
          reason: '温度 ' + it.value + '℃ 低于下限 ' + it.limit + '℃（差额 ' + it.delta + '）',
          risk: '中：S2 连续通电 >15 min 会联锁断电并进入 SAFE_LOCK',
        })
      }
    })
    out.forEach(function (a, i) { a.key = 'act' + i })
    return out
  },

  /** 湿度分支的动作建议 */
  humiActions(s, dir, ci) {
    const out = []
    if (dir === 'high') {
      out.push({
        target: 'mist01', action: '关闭雾化片',
        reason: '湿度 ' + s.humiText + '%RH 高于上限 ' + s.target.hMax + '%RH（规格书 AL03）',
        risk: '低：立即切断加湿源',
      })
      out.push({
        target: 'fan01', action: '开启排湿风扇',
        reason: '7.4 耦合仲裁 ' + s.coupling + ' ' + ci.case + ' → ' + ci.action,
        risk: '中：' + ci.forbid + '；通风会同时降温',
      })
    } else if (dir === 'low') {
      out.push({
        target: 'mist01', action: '开启雾化片加湿',
        reason: '湿度 ' + s.humiText + '%RH 低于下限 ' + s.target.hMin + '%RH（规格书 AL04）',
        risk: '低：先确认水箱水位，缺水会触发 S5 硬件切断',
      })
      out.push({
        target: 'fan01', action: '关闭通风风扇',
        reason: '7.4 耦合仲裁 ' + s.coupling + ' ' + ci.case + '：' + ci.forbid,
        risk: '低：通风量过大会持续带走水分',
      })
    }
    out.forEach(function (a, i) { a.key = 'act' + i })
    return out
  },

  pickDevices(q, list) {
    const hits = list.filter(function (d) {
      if (q.indexOf(d.id) >= 0 || q.indexOf(d.name) >= 0) return true
      if (d.kind === 'heat' && q.indexOf('加热') >= 0) return true
      if (d.kind === 'fan' && (q.indexOf('风扇') >= 0 || q.indexOf('通风') >= 0)) return true
      if (d.kind === 'mist' && (q.indexOf('雾化') >= 0 || q.indexOf('加湿') >= 0)) return true
      return false
    })
    return hits.length ? hits : list
  },

  /* ---------------- 交互 ---------------- */
  toggleTools() {
    this.setData({ toolsOpen: !this.data.toolsOpen })
  },

  onToggleTools(e) {
    const i = Number(e.currentTarget.dataset.index)
    const key = 'messages[' + i + '].showTools'
    const patch = {}
    patch[key] = !this.data.messages[i].showTools
    this.setData(patch)
  },

  onInput(e) {
    this.setData({ input: e.detail.value })
  },

  onQuick(e) {
    const q = e.currentTarget.dataset.q
    this.setData({ input: q })
    this.onSend()
  },

  /** 11.7 限流：单用户每分钟最多 10 次 */
  allowAsk() {
    const now = Date.now()
    if (!this._rateTimes) this._rateTimes = []
    this._rateTimes = this._rateTimes.filter(function (t) { return now - t < RATE_WINDOW })
    if (this._rateTimes.length >= RATE_LIMIT) {
      wx.showToast({ title: '单用户每分钟最多 ' + RATE_LIMIT + ' 次，请稍后再试', icon: 'none' })
      this.setData({ rateCount: this._rateTimes.length })
      return false
    }
    this._rateTimes.push(now)
    return true
  },

  onSend() {
    const q = (this.data.input || '').replace(/^\s+|\s+$/g, '')
    if (!q) {
      wx.showToast({ title: '请输入问题', icon: 'none' })
      return
    }
    const perm = data.can('agent')
    if (!perm.ok) {
      wx.showToast({ title: perm.reason, icon: 'none' })
      return
    }
    if (!this.allowAsk()) return

    const clock = data.getState().simClock
    const res = this.answer(q)
    const messages = this.data.messages.concat([
      { id: nextMsgId(), role: 'user', text: q, sources: [], tools: [], actions: [], showTools: false, ts: clock },
      {
        id: nextMsgId(), role: 'agent', text: res.text, sources: res.sources, tools: res.tools,
        actions: res.actions, showTools: false, ts: clock,
      },
    ])
    this.setData({ messages: messages, input: '', rateCount: this._rateTimes.length }, () => {
      this.scrollBottom()
    })
  },

  scrollBottom() {
    wx.pageScrollTo({ selector: '#chat-bottom', duration: 200, fail: function () {} })
  },

  onGoControl() {
    wx.switchTab({ url: '/pages/control/control' })
  },

  /** 申请审批令牌：仅管理员可签发（规格书 11.6） */
  onIssueToken(e) {
    const target = e.currentTarget.dataset.target
    const reason = e.currentTarget.dataset.reason
    if (data.getRole().key !== 'admin') {
      wx.showModal({
        title: '需管理员签发',
        content: '审批令牌（ACTION_TOKEN）只能由管理员签发。请让管理员在手动控制页签发后把令牌 ID 给你：需管理员在管理后台签发，可让管理员在手动控制页签发后把令牌 ID 给你。',
        showCancel: false,
        confirmText: '知道了',
      })
      return
    }
    const res = engine.issueToken(this.data.barnKey, target, 'toggle', 'Agent 建议动作：' + reason)
    wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
  },
})
