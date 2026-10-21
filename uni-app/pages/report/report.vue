<template>
  <view class="page-wrap">
    <barn-bar from="/pages/report/report" />

    <!-- 加载态：骨架屏（字段多，占位 4 行） -->
    <skeleton v-if="loading" :rows="4" />

    <view v-if="!loading" class="page-body">
      <!-- 统计时间段 -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">统计时间段</text>
          <text class="card-sub">{{aggText}}</text>
        </view>
        <view class="chip-row">
          <text v-for="(item, index) in chips" :key="item.key" :class="'chip ' + (dateKey === item.key ? 'chip-on' : '')" :data-k="item.key" @tap="onDateTap">{{item.label}}</text>
          <picker mode="date" :value="customDate" @change="onDatePicker">
            <text :class="'chip ' + (dateKey === 'custom' ? 'chip-on' : '')">自定义…</text>
          </picker>
        </view>
        <view class="window-text">统计日期 {{dateText}}（00:00 ~ 24:00）</view>
        <view v-if="report" class="window-text">目标区间 {{rangeText}} · 采样点 {{report.samples}} 个</view>
        <view class="window-text">模拟时钟 {{simClockText}}</view>
      </view>

      <!-- 温湿度统计卡片 -->
      <view v-if="report" class="card">
        <view class="card-header">
          <text class="card-title">温湿度统计</text>
          <text class="card-sub">{{report.instarName}} / {{report.varietyName}}</text>
        </view>
        <view class="stat-grid">
          <view class="stat-tile half">
            <view class="stat-value text-primary">{{report.tempAvg}}<text class="unit">℃</text></view>
            <view class="stat-label">温度均值</view>
          </view>
          <view class="stat-tile half">
            <view class="stat-value text-ok">{{report.humiAvg}}<text class="unit">%RH</text></view>
            <view class="stat-label">湿度均值</view>
          </view>
        </view>
        <view class="divider"></view>
        <view class="kv-grid">
          <view class="kv-item">
            <view class="kv-item-label">温度最高</view>
            <view class="kv-item-value">{{report.tempMax}}<text class="kv-item-unit">℃</text></view>
          </view>
          <view class="kv-item">
            <view class="kv-item-label">温度最低</view>
            <view class="kv-item-value">{{report.tempMin}}<text class="kv-item-unit">℃</text></view>
          </view>
          <view class="kv-item">
            <view class="kv-item-label">湿度最高</view>
            <view class="kv-item-value">{{report.humiMax}}<text class="kv-item-unit">%RH</text></view>
          </view>
          <view class="kv-item">
            <view class="kv-item-label">湿度最低</view>
            <view class="kv-item-value">{{report.humiMin}}<text class="kv-item-unit">%RH</text></view>
          </view>
        </view>
        <view class="divider"></view>
        <view class="kv-row">
          <text class="kv-label">温度累计越限时长</text>
          <text :class="'kv-value ' + (report.tempOutMin > 0 ? 'text-danger' : '')">{{report.tempOutText}}（{{report.tempOutMin}} min）</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">湿度累计越限时长</text>
          <text :class="'kv-value ' + (report.humiOutMin > 0 ? 'text-danger' : '')">{{report.humiOutText}}（{{report.humiOutMin}} min）</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">综合越限占比</text>
          <text class="kv-value">{{report.outRate}} %</text>
        </view>
      </view>

      <!-- 逐小时越限时长柱状图 -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">逐小时越限时长</text>
          <text class="card-sub">单位 min（小时聚合）</text>
        </view>
        <canvas type="2d" id="outBars" class="chart-bars"></canvas>
        <view v-if="chartEmpty" class="empty">当日暂无采样数据</view>
      </view>

      <!-- 逐小时均值曲线 -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">逐小时均值曲线</text>
          <text class="card-sub">小时均值</text>
        </view>
        <canvas type="2d" id="hourEnv" class="chart"></canvas>
        <view class="legend">
          <text class="legend-item"><text class="lg-dot lg-blue"></text>小时均温℃</text>
          <text class="legend-item"><text class="lg-dot lg-green"></text>小时均湿%RH</text>
          <text class="legend-item"><text class="lg-band"></text>目标区间</text>
          <text class="legend-item"><text class="lg-dot lg-red"></text>温度越限点</text>
        </view>
        <view v-if="chartEmpty" class="empty">当日暂无采样数据</view>
      </view>

      <!-- 设备启停次数统计 -->
      <view v-if="switchRows.length > 0" class="card">
        <view class="card-header">
          <text class="card-title">设备启停次数</text>
          <text class="card-sub">当日合计 {{switchTotal}} 次</text>
        </view>
        <view v-for="(item, index) in switchRows" :key="item.id" class="sw-item">
          <view class="sw-line">
            <text class="sw-name">{{item.name}}</text>
            <text class="sw-kind">{{item.kindName}} · {{item.id}}</text>
            <text class="sw-count">{{item.count}} 次</text>
          </view>
          <view class="bar">
            <view class="bar-fill" :style="'width:' + (item.pct) + '%; background:#3d6df2;'"></view>
          </view>
        </view>
        <view class="tip">启停次数为当日累计，超过 20 次触发 AL08 提示告警。</view>
      </view>

      <!-- 告警统计记录 -->
      <view v-if="report" class="card">
        <view class="card-header">
          <text class="card-title">告警统计</text>
          <text class="card-sub">当日合计 {{report.alarmTotal}} 条</text>
        </view>
        <view class="stat-grid">
          <view v-for="(item, index) in alarmRows" :key="item.key" class="stat-tile">
            <view :class="'stat-value text-' + (item.tone)">{{item.count}}</view>
            <view class="stat-label">{{item.name}}</view>
          </view>
          <view class="stat-tile">
            <view class="stat-value">{{report.alarmCritical + report.alarmWarn + report.alarmInfo}}</view>
            <view class="stat-label">分级合计</view>
          </view>
        </view>
        <view v-if="alarmList.length > 0" class="divider"></view>
        <view v-for="(item, index) in alarmList" :key="item.id" class="list-item">
          <view class="list-main">
            <view class="list-name">{{item.defName}}</view>
            <view class="list-meta">{{item.timeText}} · {{item.levelName}}</view>
          </view>
          <view class="list-tail">
            <text :class="'badge badge-' + (item.tone)">{{item.statusText}}</text>
          </view>
        </view>
        <view v-if="alarmList.length === 0" class="tip">当日无告警记录。</view>
      </view>

      <!-- 报表操作 -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">报表操作</text>
          <text class="card-sub">操作员及以上</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">当前角色</text>
          <text class="kv-value">{{roleName}} · {{canReport ? '可导出 / 分享' : '无报表权限'}}</text>
        </view>
        <view class="btn-row">
          <button :class="canReport ? 'btn-ghost' : 'btn-ghost btn-disabled'" @tap="onExportMd">导出 Markdown</button>
          <button v-if="canReport" class="btn-primary" open-type="share">分享</button>
          <button v-else class="btn-primary btn-disabled" @tap="onShareDenied">分享</button>
        </view>
        <view class="tip">导出后写入用户目录并复制到剪贴板，可直接粘贴成 .md 文件。</view>
      </view>

    </view>
  </view>
</template>

<script>
import { mpPage } from '@/utils/uni-shim.js'
/**
 * pages/report —— P06 日报 / 报表（规格书 12.1，优先级：低，主要角色：操作员及以上）
 * 核心字段：统计时间段、温湿度均值、最高最低温湿度、温湿度累计越限时长、
 *           设备启停次数统计、告警统计记录
 * 主要操作：选择日期范围生成日报、预览报表、分享、导出 Markdown / PDF 文件
 * 数据源：data.getDayReport（规格书 12.1 P06）/ data.getHourlyAgg（10.3 telemetry_agg_hour）
 * 图表：canvas 2D —— 逐小时越限时长柱状图（drawBars）+ 逐小时均值曲线（drawEnvChart）
 */

import * as data from '@/utils/data.js'
import * as engine from '@/utils/engine.js'
import * as spec from '@/utils/spec.js'
import * as nav from '@/utils/nav.js'
import * as chart from '@/utils/chart.js'

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

export default mpPage({
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
    if (!this.barnKey) {
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
    uni.stopPullDownRefresh()
  },

  /** 生成当日日报并刷新统计块、启停表、告警统计与两张图 */
  refresh() {
    const key = this.barnKey
    const ms = this.dateMs
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
    const hit = this.chips.filter((c) => c.key === k)[0]
    if (!hit) return
    this.setData({ dateKey: k, dateMs: hit.ms, customDate: data.formatDate(hit.ms) }, () => this.refresh())
  },

  onDatePicker(e) {
    const val = e.detail.value
    const ms = parseDay(val)
    if (!ms) {
      uni.showToast({ title: '日期不合法', icon: 'none' })
      return
    }
    const today = dayStart(data.getState().simClock)
    if (ms > today) {
      uni.showToast({ title: '不可选择未来日期', icon: 'none' })
      return
    }
    if (ms < today - 2 * DAY_MS) {
      uni.showToast({ title: '超出近 3 天，为推算数据', icon: 'none' })
    }
    this.setData({ dateKey: 'custom', dateMs: ms, customDate: val }, () => this.refresh())
  },

  /** 用当天统计拼 Markdown 文本（含温湿度统计、越限时长、启停次数、告警分级、逐小时表） */
  buildMarkdown() {
    const r = this.report
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
    lines.push('- 当日合计：' + this.switchTotal + ' 次')
    this.switchRows.forEach((d) => {
      lines.push('- ' + d.name + '（' + d.id + '）：' + d.count + ' 次')
    })
    lines.push('')
    lines.push('## 告警统计')
    lines.push('')
    lines.push('- 合计 ' + r.alarmTotal + ' 条：紧急 ' + r.alarmCritical + ' / 警告 ' + r.alarmWarn + ' / 提示 ' + r.alarmInfo)
    this.alarmRows.forEach((lv) => {
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
      uni.showModal({ title: '无导出权限', content: perm.reason, showCancel: false })
      return
    }
    const r = this.report
    if (!r) {
      uni.showToast({ title: '日报尚未生成', icon: 'none' })
      return
    }
    const md = this.buildMarkdown()
    const path = uni.env.USER_DATA_PATH + '/report_' + r.barn + '_' + r.date + '.md'
    const copy = (saved) => {
      uni.setClipboardData({
        data: md,
        success: () => {
          if (saved) {
            uni.showModal({
              title: 'Markdown 已生成',
              content: '已写入：' + path + '\n内容已复制到剪贴板，可粘贴到文件或发送给自己。',
              showCancel: false,
            })
          } else {
            uni.showToast({ title: 'Markdown 已复制到剪贴板', icon: 'success' })
          }
        },
      })
    }
    try {
      uni.getFileSystemManager().writeFile({
        filePath: path,
        data: md,
        encoding: 'utf8',
        success: () => {
          engine.logAudit(data.getBarn(this.barnKey), '导出环境日报', 'report/' + r.date, '导出 Markdown 文件 ' + path)
          copy(true)
        },
        fail: () => copy(false),
      })
    } catch (err) {
      copy(false)
    }
  },

  onShareDenied() {
    uni.showModal({
      title: '无分享权限',
      content: this.denyReason || '当前角色无权分享日报（规格书 2.4）',
      showCancel: false,
    })
  },

  onShareAppMessage() {
    const perm = data.can('report')
    if (!perm.ok) {
      uni.showModal({ title: '无分享权限', content: perm.reason, showCancel: false })
      return { title: '日报报表', path: '/pages/report/report' }
    }
    const r = this.report
    const title = r
      ? (r.barnName + ' ' + r.date + ' 环境日报：均温 ' + r.tempAvg + '℃ / 均湿 ' + r.humiAvg + '%RH')
      : '蚕房环境日报报表'
    return { title: title, path: '/pages/report/report' }
  },

  onShareTimeline() {
    const r = this.report
    return {
      title: r ? (r.barnName + ' ' + r.date + ' 环境日报') : '蚕房环境日报报表',
      query: '',
    }
  },
})
</script>

<style>
/* report.wxss（与原生小程序工程逐字节一致） */
/* pages/report/report.wxss —— P06 日报 / 报表私有样式（全局类见 app.wxss） */

.window-text {
  font-size: 22rpx;
  color: #8b95a7;
  margin-top: 12rpx;
}

/* 统计数值里的小单位 */
.unit {
  font-size: 22rpx;
  font-weight: 400;
  color: #8b95a7;
  margin-left: 4rpx;
}

/* 逐小时越限时长柱状图 */
.chart-bars {
  width: 100%;
  height: 320rpx;
}

/* 逐小时均值曲线 */
.chart {
  width: 100%;
  height: 420rpx;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  margin-top: 10rpx;
  font-size: 20rpx;
  color: #8b95a7;
}

.legend-item {
  margin-right: 24rpx;
}

.lg-dot {
  display: inline-block;
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  margin-right: 6rpx;
}

.lg-blue { background: #3d6df2; }
.lg-green { background: #10b981; }
.lg-red { background: #ef4444; }

.lg-band {
  display: inline-block;
  width: 22rpx;
  height: 12rpx;
  border-radius: 3rpx;
  background: rgba(16, 185, 129, 0.35);
  margin-right: 6rpx;
}

/* 设备启停次数行 */
.sw-item {
  padding: 14rpx 0;
}

.sw-line {
  display: flex;
  align-items: center;
  margin-bottom: 10rpx;
}

.sw-name {
  font-size: 26rpx;
  color: #1f2937;
  font-weight: 500;
}

.sw-kind {
  font-size: 22rpx;
  color: #8b95a7;
  margin-left: 12rpx;
}

.sw-count {
  margin-left: auto;
  font-size: 26rpx;
  color: #1f2937;
  font-weight: 600;
}

.foot-tip {
  margin: 20rpx 24rpx;
}
</style>
