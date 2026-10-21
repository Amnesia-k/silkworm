/**
 * pages/report —— P06 日报 / 报表（规格书 12.1，优先级：低，主要角色：操作员及以上）
 * 核心字段：统计时间段、温湿度均值、最高最低温湿度、温湿度累计越限时长、
 *           设备启停次数统计、告警统计记录
 * 主要操作：选择日期范围生成日报、预览报表、分享、导出 Markdown / PDF 文件
 * 数据源：data.getDayReport（规格书 12.1 P06）/ data.getHourlyAgg（10.3 telemetry_agg_hour）
 * 图表：canvas 2D —— 逐小时越限时长柱状图（drawBars）+ 逐小时均值曲线（drawEnvChart）
 */

const data = require('../../utils/data.js')
const engine = require('../../utils/engine.js')
const spec = require('../../utils/spec.js')
const nav = require('../../utils/nav.js')
const chart = require('../../utils/chart.js')

const DAY_MS = 86400000
/** 日报最多展示 24 个整点小时 */
const MAX_HOURS = 24
/** 告警分级 → 徽标 / 文字配色（app.wxss 的 badge-* / text-* 类） */
const LEVEL_TONE = { critical: 'red', warn: 'orange', info: 'blue' }

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

/** 取某个时间戳所在自然日 00:00 的毫秒时间戳 */
function dayStart(ms) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 'YYYY-MM-DD' → 当日 00:00 毫秒时间戳，非法返回 0 */
function parseDay(str) {
  const p = (str || '').split('-')
  if (p.length !== 3) return 0
  const ms = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 0, 0, 0, 0).getTime()
  return isNaN(ms) ? 0 : ms
}

Page({
  data: {
    loading: true,
    barnKey: '',
    barnName: '',
    zone: '',
    // 日期 chip（今天 / 昨天 / 前天），毫秒时间戳由模拟时钟 simClock 推算
    chips: [],
    dateKey: 'today',
    dateMs: 0,
    customDate: '',
    dateText: '--',
    rangeText: '--',
    aggText: '小时聚合',
    roleName: '',
    simClockText: '--',
    // 日报主体（可能为 null，模板必须用 wx:if 包裹后再取子属性）
    report: null,
    switchRows: [],
    switchTotal: 0,
    alarmRows: [],
    alarmList: [],
    canReport: false,
    denyReason: '',
    chartEmpty: true,
  },

  onLoad() {
    nav.skeletonBegin(this)
    if (!nav.ensureBarn()) return
    const b = data.getCurrentBarn()
    const st = data.getState()
    const today = dayStart(st.simClock)
    const aggHour = spec.AGG_RULES.filter((a) => a.level.indexOf('hour') >= 0)[0]
    this.setData({
      barnKey: b.barn,
      barnName: b.name,
      zone: b.zone,
      chips: [
        { key: 'today', label: '今天', ms: today },
        { key: 'yesterday', label: '昨天', ms: today - DAY_MS },
        { key: 'before', label: '前天', ms: today - 2 * DAY_MS },
      ],
      dateKey: 'today',
      dateMs: today,
      customDate: data.formatDate(today),
      aggText: aggHour ? '小时聚合（' + aggHour.level + '）' : '小时聚合',
      roleName: data.getRole().name,
    })
  },

  onReady() {
    this._ready = true
    this.refresh()
  },

  onShow() {
    if (!this.data.barnKey) {
      if (!nav.ensureBarn()) return
      const b = data.getCurrentBarn()
      this.setData({ barnKey: b.barn, barnName: b.name, zone: b.zone })
    }
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

  onPullDownRefresh() {
    this.refresh()
    wx.stopPullDownRefresh()
  },

  /** 生成当日日报并刷新统计块、启停表、告警统计与两张图 */
  refresh() {
    const key = this.data.barnKey
    const ms = this.data.dateMs
    if (!key || !ms) { nav.skeletonDone(this); return }
    const r = data.getDayReport(key, ms)
    const st = data.getState()

    // 设备启停次数：report.switches 形如 { heat01: 3, fan01: 12, ... }，设备名取自 getDevices
    const devices = data.getDevices(key)
    const sw = r.switches || {}
    let maxSw = 1
    devices.forEach((d) => { maxSw = Math.max(maxSw, sw[d.id] || 0) })
    const switchRows = devices.map((d) => {
      const count = sw[d.id] || 0
      return {
        id: d.id,
        name: d.name,
        kindName: d.kindName,
        count,
        pct: Math.round((count / maxSw) * 100),
      }
    })
    const switchTotal = switchRows.reduce((a, c) => a + c.count, 0)

    // 告警分级计数（名称取自 spec.ALARM_LEVELS，13.1）
    const alarmRows = ['critical', 'warn', 'info'].map((k) => {
      const lv = spec.ALARM_LEVELS[k] || { name: k }
      const count = k === 'critical' ? r.alarmCritical : (k === 'warn' ? r.alarmWarn : r.alarmInfo)
      return { key: k, name: lv.name, tone: LEVEL_TONE[k] || 'gray', count }
    })

    // 当日告警明细（最近 6 条）
    const from = ms
    const to = ms + DAY_MS
    const alarmList = data.getAlarms(key, {})
      .filter((a) => a.ts >= from && a.ts <= to)
      .slice(0, 6)
      .map((a) => ({
        id: a.id,
        defName: a.defName,
        timeText: a.timeText,
        levelName: a.levelName,
        tone: LEVEL_TONE[a.level] || 'gray',
        statusText: a.statusText,
      }))

    const perm = data.can('report')
    this.setData({
      report: r,
      dateText: r.date,
      rangeText: r.range.tempText + ' / ' + r.range.humiText,
      switchRows,
      switchTotal,
      alarmRows,
      alarmList,
      canReport: perm.ok,
      denyReason: perm.reason,
      simClockText: data.formatTime(st.simClock),
      chartEmpty: !r.hours || r.hours.length === 0,
    })
    this.drawCharts(r)

    // 首次数据构建完成（所有 setData 之后）：关闭骨架屏
    nav.skeletonDone(this)
  },

  /** 逐小时越限时长柱状图 + 逐小时均值曲线 */
  drawCharts(r) {
    if (!this._ready || !r) return
    const hours = (r.hours || []).slice(0, MAX_HOURS)
    if (!hours.length) return
    const labels = hours.map((h) => data.formatClock(h.ts))
    const outMin = hours.map((h) => Math.round((h.outSec || 0) / 60))
    const temp = hours.map((h) => h.tempAvg)
    const humi = hours.map((h) => h.humiAvg)

    chart.getCanvas('#outBars').then((cv) => {
      chart.drawBars(cv, { labels, values: outMin, color: '#f59e0b' })
    }).catch(() => {})

    chart.getCanvas('#hourEnv').then((cv) => {
      chart.drawEnvChart(cv, { labels, temp, humi, range: r.range, showHumi: true })
    }).catch(() => {})
  },

  onDateTap(e) {
    const k = e.currentTarget.dataset.k
    const hit = this.data.chips.filter((c) => c.key === k)[0]
    if (!hit) return
    this.setData({ dateKey: k, dateMs: hit.ms, customDate: data.formatDate(hit.ms) }, () => this.refresh())
  },

  onDatePicker(e) {
    const val = e.detail.value
    const ms = parseDay(val)
    if (!ms) {
      wx.showToast({ title: '日期不合法', icon: 'none' })
      return
    }
    const today = dayStart(data.getState().simClock)
    if (ms > today) {
      wx.showToast({ title: '不可选择未来日期', icon: 'none' })
      return
    }
    if (ms < today - 2 * DAY_MS) {
      wx.showToast({ title: '超出近 3 天，为推算数据', icon: 'none' })
    }
    this.setData({ dateKey: 'custom', dateMs: ms, customDate: val }, () => this.refresh())
  },

  /** 用当天统计拼 Markdown 文本（含温湿度统计、越限时长、启停次数、告警分级、逐小时表） */
  buildMarkdown() {
    const r = this.data.report
    if (!r) return ''
    const lines = []
    lines.push('# 养蚕环境日报 · ' + r.barnName)
    lines.push('')
    lines.push('- 统计日期：' + r.date)
    lines.push('- 蚕房 / 区域：' + r.barn + ' / ' + r.zone)
    lines.push('- 龄期 / 品种：' + r.instarName + ' / ' + r.varietyName)
    lines.push('- 目标区间：' + r.range.tempText + ' / ' + r.range.humiText + '（' + r.range.tolText + '）')
    lines.push('- 采样点数：' + r.samples + '（分钟聚合 telemetry_agg_min，规格书 10.3）')
    lines.push('')
    lines.push('## 温湿度统计')
    lines.push('')
    lines.push('| 指标 | 平均 | 最高 | 最低 |')
    lines.push('| --- | --- | --- | --- |')
    lines.push('| 温度 ℃ | ' + r.tempAvg + ' | ' + r.tempMax + ' | ' + r.tempMin + ' |')
    lines.push('| 湿度 %RH | ' + r.humiAvg + ' | ' + r.humiMax + ' | ' + r.humiMin + ' |')
    lines.push('')
    lines.push('## 累计越限时长')
    lines.push('')
    lines.push('- 温度越限：' + r.tempOutText + '（' + r.tempOutMin + ' min）')
    lines.push('- 湿度越限：' + r.humiOutText + '（' + r.humiOutMin + ' min）')
    lines.push('- 综合越限占比：' + r.outRate + '%')
    lines.push('')
    lines.push('## 设备启停次数')
    lines.push('')
    lines.push('- 当日合计：' + this.data.switchTotal + ' 次')
    this.data.switchRows.forEach((d) => {
      lines.push('- ' + d.name + '（' + d.id + '）：' + d.count + ' 次')
    })
    lines.push('')
    lines.push('## 告警统计')
    lines.push('')
    lines.push('- 合计 ' + r.alarmTotal + ' 条：紧急 ' + r.alarmCritical + ' / 警告 ' + r.alarmWarn + ' / 提示 ' + r.alarmInfo)
    this.data.alarmRows.forEach((lv) => {
      lines.push('- ' + lv.name + '：' + lv.count + ' 条')
    })
    lines.push('')
    lines.push('## 逐小时越限时长（h 为整体越限时长，聚合自 telemetry_agg_hour）')
    lines.push('')
    const hours = r.hours || []
    hours.forEach((h) => {
      lines.push('- ' + data.formatClock(h.ts) + '：越限 ' + Math.round((h.outSec || 0) / 60) +
        ' min，均温 ' + h.tempAvg + '℃，均湿 ' + h.humiAvg + '%RH（' + h.samples + ' 点）')
    })
    lines.push('')
    lines.push('> 数据来源：本地模拟 telemetry_agg_min / telemetry_agg_hour（规格书 10.3 / 12.1 P06）；生成时间 ' +
      data.formatTime(data.getState().simClock))
    return lines.join('\n')
  },

  /** 导出 Markdown：写用户目录 + 复制剪贴板，需要 report 权限 */
  onExportMd() {
    const perm = data.can('report')
    if (!perm.ok) {
      wx.showModal({ title: '无导出权限', content: perm.reason, showCancel: false })
      return
    }
    const r = this.data.report
    if (!r) {
      wx.showToast({ title: '日报尚未生成', icon: 'none' })
      return
    }
    const md = this.buildMarkdown()
    const path = wx.env.USER_DATA_PATH + '/report_' + r.barn + '_' + r.date + '.md'
    const copy = (saved) => {
      wx.setClipboardData({
        data: md,
        success: () => {
          if (saved) {
            wx.showModal({
              title: 'Markdown 已生成',
              content: '已写入：' + path + '\n内容已复制到剪贴板，可粘贴到文件或发送给自己。',
              showCancel: false,
            })
          } else {
            wx.showToast({ title: 'Markdown 已复制到剪贴板', icon: 'success' })
          }
        },
      })
    }
    try {
      wx.getFileSystemManager().writeFile({
        filePath: path,
        data: md,
        encoding: 'utf8',
        success: () => {
          engine.logAudit(data.getBarn(this.data.barnKey), '导出环境日报', 'report/' + r.date, '导出 Markdown 文件 ' + path)
          copy(true)
        },
        fail: () => copy(false),
      })
    } catch (err) {
      copy(false)
    }
  },

  onShareDenied() {
    wx.showModal({
      title: '无分享权限',
      content: this.data.denyReason || '当前角色无权分享日报（规格书 2.4）',
      showCancel: false,
    })
  },

  onShareAppMessage() {
    const perm = data.can('report')
    if (!perm.ok) {
      wx.showModal({ title: '无分享权限', content: perm.reason, showCancel: false })
      return { title: '日报报表', path: '/pages/report/report' }
    }
    const r = this.data.report
    const title = r
      ? (r.barnName + ' ' + r.date + ' 环境日报：均温 ' + r.tempAvg + '℃ / 均湿 ' + r.humiAvg + '%RH')
      : '蚕房环境日报报表'
    return { title: title, path: '/pages/report/report' }
  },

  onShareTimeline() {
    const r = this.data.report
    return {
      title: r ? (r.barnName + ' ' + r.date + ' 环境日报') : '蚕房环境日报报表',
      query: '',
    }
  },
})
