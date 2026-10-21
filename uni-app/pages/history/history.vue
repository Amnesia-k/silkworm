<template>
  <view class="page-wrap">
    <barn-bar from="/pages/history/history" />

    <skeleton v-if="loading" :rows="3" />

    <view v-if="!loading" class="page-body">
      <!-- 时间段：一行 chip + 当前窗口，自定义收进面板 -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">时间段</text>
          <text class="card-sub">{{granText}}</text>
        </view>
        <view class="chip-row">
          <text v-for="(item, index) in ranges" :key="item.key" :class="'chip ' + (rangeKey === item.key ? 'chip-on' : '')" :data-k="item.key" @tap="onRangeTap">{{item.label}}</text>
          <text :class="'chip ' + (rangeKey === 'custom' ? 'chip-on' : '')" data-k="custom" @tap="onRangeTap">自定义…</text>
        </view>

        <view class="window-text">{{fromText}} ~ {{toText}}</view>

        <view v-if="showCustom" class="custom-panel">
          <view class="cp-row">
            <text class="cp-label">开始</text>
            <picker mode="date" :value="custom.startDate" data-k="startDate" @change="onPicker">
              <view class="picker-box">{{custom.startDate}}</view>
            </picker>
            <picker mode="time" :value="custom.startTime" data-k="startTime" @change="onPicker">
              <view class="picker-box">{{custom.startTime}}</view>
            </picker>
          </view>
          <view class="cp-row">
            <text class="cp-label">结束</text>
            <picker mode="date" :value="custom.endDate" data-k="endDate" @change="onPicker">
              <view class="picker-box">{{custom.endDate}}</view>
            </picker>
            <picker mode="time" :value="custom.endTime" data-k="endTime" @change="onPicker">
              <view class="picker-box">{{custom.endTime}}</view>
            </picker>
          </view>
          <view class="btn-row">
            <button class="btn-ghost" @tap="onCloseCustom">取消</button>
            <button class="btn-primary" @tap="onApplyCustom">应用时间段</button>
          </view>
        </view>
      </view>

      <!-- 曲线：进入视口后才画出；标注只留最高/最低，另给平均温度 -->
      <view class="card chart-card" id="envChartWrap">
        <view class="card-header">
          <text class="card-title">温湿度曲线</text>
          <text :class="'card-sub ' + (stats.outPoints > 0 ? 'text-danger' : '')">累计越限 {{stats.outText}}</text>
          <text class="card-more" @tap="onExport">导出 CSV</text>
        </view>

        <view v-if="stats" class="stat-rows">
          <view class="sr-row">
            <text class="sr-tag">温度</text>
            <text class="sr-cell">最高 <text class="sr-num">{{stats.tempMax}}</text> ℃</text>
            <text class="sr-cell">最低 <text class="sr-num">{{stats.tempMin}}</text> ℃</text>
            <text class="sr-cell">平均 <text class="sr-num">{{stats.tempAvg}}</text> ℃</text>
          </view>
          <view class="sr-row">
            <text class="sr-tag">湿度</text>
            <text class="sr-cell">最高 <text class="sr-num">{{stats.humiMax}}</text> %</text>
            <text class="sr-cell">最低 <text class="sr-num">{{stats.humiMin}}</text> %</text>
            <text class="sr-cell">平均 <text class="sr-num">{{stats.humiAvg}}</text> %</text>
          </view>
        </view>

        <view class="chart-box" id="envChartBox" @touchstart.stop="onChartTouchStart" @touchmove.stop="onChartTouchMove" @touchend.stop="onChartTouchEnd" @touchcancel.stop="onChartTouchEnd">
          <canvas type="2d" id="envChart" class="chart"></canvas>
        </view>
        <view class="chart-bar">
          <text class="cb-hint">双指缩放 · 单指拖动 · 双击复位</text>
          <text v-if="zoomed" class="cb-zoom">{{zoomText}}</text>
          <text v-if="zoomed" class="cb-reset" @tap="onResetZoom">重置</text>
        </view>
        <view class="legend">
          <text class="legend-item"><text class="lg-dot lg-blue"></text>温度 ℃</text>
          <text class="legend-item"><text class="lg-dot lg-green"></text>湿度 %RH</text>
          <text class="legend-item"><text class="lg-band"></text>目标区间</text>
          <text class="legend-item"><text class="lg-dash"></text>平均温度</text>
        </view>
        <view v-if="chartEmpty" class="empty">该时间段无采样数据</view>
      </view>

      <!-- 越限区间 -->
      <view v-if="segments.length > 0" class="card">
        <view class="card-header">
          <text class="card-title">越限区间</text>
          <text class="card-sub">最近 {{segments.length}} 段</text>
        </view>
        <view v-for="(item, index) in segments" :key="item.fromText" class="seg">
          <view class="seg-head">
            <text class="badge badge-red">越限</text>
            <text class="seg-time">{{item.fromText}} ~ {{item.toText}}</text>
            <text class="seg-dur">{{item.minText}}</text>
          </view>
          <view class="seg-body">温度 {{item.tempText}} · 湿度 {{item.humiText}}</view>
        </view>
      </view>

      <!-- 采样点明细（默认折叠） -->
      <view v-if="samples.length > 0" class="card">
        <view class="card-header">
          <text class="card-title">采样点明细</text>
          <text class="card-sub">最近 {{samples.length}} 点</text>
          <text class="card-more" @tap="onToggleSamples">{{showSamples ? '收起' : '展开'}}</text>
        </view>
        <template v-if="showSamples">
          <view class="sample-row sample-head">
            <text class="s-col s-time">时间</text>
            <text class="s-col">温度℃</text>
            <text class="s-col">湿度%RH</text>
            <text class="s-col">状态</text>
          </view>
          <view v-for="(item, index) in samples" :key="item.ts" class="sample-row">
            <text class="s-col s-time">{{item.timeText}}</text>
            <text class="s-col">{{item.tempText}}</text>
            <text class="s-col">{{item.humiText}}</text>
            <text class="s-col"><text :class="'badge badge-' + (item.tone)">{{item.flagText}}</text></text>
          </view>
        </template>
      </view>

      <view class="tip">越限按目标区间判定；长时间段自动按小时聚合。</view>
    </view>
  </view>
</template>

<script>
import { mpPage } from '@/utils/uni-shim.js'
/**
 * pages/history —— P02 历史曲线（规格书 12.1，优先级：高，全部角色）
 * 字段：温湿度双轴曲线图、时间选择器、越限区间高亮底色、最大/最小/平均值标注、数据采样点
 * 操作：自定义选择查询时间段、缩放曲线、导出 CSV 数据文件、切换蚕房
 * 数据源：data.getSeries（10.3 telemetry_agg_min）/ data.getHourlyAgg（10.3 telemetry_agg_hour）
 */

import * as data from '@/utils/data.js'
import * as engine from '@/utils/engine.js'
import * as nav from '@/utils/nav.js'
import * as chart from '@/utils/chart.js'

const RANGES = [
  { key: '1h', label: '近1小时', ms: 3600000 },
  { key: '6h', label: '近6小时', ms: 6 * 3600000 },
  { key: '24h', label: '近24小时', ms: 24 * 3600000 },
  { key: '3d', label: '近3天', ms: 3 * 86400000 },
  { key: '7d', label: '近7天', ms: 7 * 86400000 },
]

function pad(n) {
  return n < 10 ? '0' + n : '' + n
}

function parseDateTime(dateStr, timeStr) {
  const d = (dateStr || '').split('-')
  const t = (timeStr || '').split(':')
  if (d.length !== 3 || t.length !== 2) return NaN
  return new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2]), Number(t[0]), Number(t[1]), 0, 0).getTime()
}

export default mpPage({
  data: {
    barnKey: '',
    loading: true,
    ranges: RANGES,
    rangeKey: '6h',
    showCustom: false,
    custom: { startDate: '', startTime: '00:00', endDate: '', endTime: '23:59' },
    customFrom: 0,
    customTo: 0,
    fromText: '',
    toText: '',
    stats: null,
    segments: [],
    samples: [],
    info: null,
    granText: '',
    chartEmpty: true,
    showSamples: false,
    // 手势缩放：zoomed 表示当前是放大视图，zoomText 给出提示
    zoomed: false,
    zoomText: '',
  },

  onLoad() {
    nav.skeletonBegin(this)
    if (!nav.ensureBarn()) return
    const key = data.getCurrentBarn().barn
    const st = data.getState()
    const now = new Date(st.simClock)
    this.setData({
      barnKey: key,
      custom: {
        startDate: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
        startTime: '00:00',
        endDate: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
        endTime: pad(now.getHours()) + ':' + pad(now.getMinutes()),
      },
    })
  },

  onReady() {
    this.compute(true)
    this.watchChart()
    this.measureChart()
  },

  onShow() {
    if (!this.barnKey) {
      if (!nav.ensureBarn()) return
      this.setData({ barnKey: data.getCurrentBarn().barn })
    }
    this.compute()
    if (!this._tick) this._tick = () => this.compute()
    engine.subscribe(this._tick)
  },

  onHide() {
    engine.unsubscribe(this._tick)
  },

  onUnload() {
    engine.unsubscribe(this._tick)
    this.stopReveal()
    if (this._chartIO) {
      try {
        this._chartIO.disconnect()
      } catch (e) {
        /* 忽略 */
      }
      this._chartIO = null
    }
  },

  onPullDownRefresh() {
    this.compute(true)
    uni.stopPullDownRefresh()
  },

  /* ---------------- 曲线：进入视口才画 ---------------- */
  watchChart() {
    if (this._chartIO || this._chartSeen) return
    this._chartIO = chart.whenVisible(this, '#envChartWrap', () => {
      this._chartSeen = true
      this._chartIO = null
      this.drawChart(true)
    })
  },

  stopReveal() {
    if (this._reveal) {
      this._reveal.cancel()
      this._reveal = null
    }
  },

  onToggleSamples() {
    this.setData({ showSamples: !this.showSamples })
  },

  /** 计算当前窗口 [from, to]（时间段选择给出的基准窗口，不含手势缩放） */
  window() {
    const st = data.getState()
    if (this.rangeKey === 'custom' && this.customTo > this.customFrom) {
      return { from: this.customFrom, to: this.customTo }
    }
    const item = RANGES.filter((r) => r.key === this.rangeKey)[0] || RANGES[1]
    return { from: st.simClock - item.ms, to: st.simClock }
  },

  /* ---------------- 手势缩放（双指捏合缩放 / 单指拖动平移 / 双击复位） ---------------- */

  /** 显示窗口 = 基准窗口 ∩ 缩放手势给出的窗口；跨度限制在 10 min ~ 基准跨度之间 */
  zoomWindow(base) {
    const z = this._zoom
    const baseSpan = base.to - base.from
    if (!z) return { from: base.from, to: base.to }
    const span = Math.max(10 * 60000, Math.min(baseSpan, z.to - z.from))
    // 手势没能把窗口收窄（例如未放大时拖动到底、或基准窗口本身不足 10 min）→ 退出缩放态，
    // 否则会出现「窗口已是完整时间段，却还显示重置按钮」的错觉
    if (span >= baseSpan) {
      this._zoom = null
      return { from: base.from, to: base.to }
    }
    const from = Math.max(base.from, Math.min(z.from, base.to - span))
    return { from, to: from + span }
  },

  /** 量取曲线区域宽度（手势换算用），失败就退回默认宽度 */
  measureChart() {
    try {
      uni.createSelectorQuery()
        .select('#envChartBox')
        .boundingClientRect((r) => {
          if (r && r.width) this._rect = { left: r.left || 0, width: r.width }
        })
        .exec()
    } catch (e) {
      /* 忽略：没有宽度也能用默认值缩放 */
    }
  },

  onChartTouchStart(e) {
    const base = this._base
    const touches = e.touches || []
    if (!base || this.chartEmpty) return
    this._moved = false
    if (touches.length >= 2) {
      const dist = Math.abs(touches[0].clientX - touches[1].clientX) || 1
      this._gest = { mode: 'pinch', dist, view: this.zoomWindow(base) }
      this._lastTap = 0
      return
    }
    if (touches.length === 1) {
      const now = Date.now()
      if (this._lastTap && now - this._lastTap < 300) {
        this._lastTap = 0
        this._gest = null
        this.resetZoom()
        return
      }
      this._lastTap = now
      this._gest = { mode: 'pan', x: touches[0].clientX, view: this.zoomWindow(base) }
    }
  },

  onChartTouchMove(e) {
    const g = this._gest
    const base = this._base
    const touches = e.touches || []
    if (!g || !base) return
    const w = this._rect && this._rect.width ? this._rect.width : 320
    const left = this._rect ? this._rect.left : 0
    const minSpan = 10 * 60000

    if (g.mode === 'pinch' && touches.length >= 2) {
      const dist = Math.abs(touches[0].clientX - touches[1].clientX) || 1
      const startSpan = g.view.to - g.view.from
      // 两指距离变大 → 跨度变小（放大）
      const span = Math.max(minSpan, Math.min(base.to - base.from, (startSpan * g.dist) / dist))
      const mid = ((touches[0].clientX + touches[1].clientX) / 2 - left) / w
      const r = Math.max(0, Math.min(1, mid))
      const anchor = g.view.from + startSpan * r
      this._zoom = { from: anchor - span * r, to: anchor - span * r + span }
      this._moved = true
      this.refreshZoom()
      return
    }

    if (g.mode === 'pan' && touches.length === 1) {
      const span = g.view.to - g.view.from
      const dx = touches[0].clientX - g.x
      if (Math.abs(dx) < 3) return
      this._moved = true
      const shift = (dx / w) * span
      this._zoom = { from: g.view.from - shift, to: g.view.to - shift }
      this.refreshZoom()
    }
  },

  onChartTouchEnd() {
    const moved = this._moved
    this._gest = null
    this._moved = false
    if (!moved) return
    // 手势结束再按最终窗口重新取数（必要时切换分钟/小时聚合）
    this.compute()
  },

  /** 缩放中：用已取到的序列重算绘图参数并立刻重画（不再查库，保证跟手） */
  refreshZoom() {
    const base = this._base
    if (!base) return
    const win = this.zoomWindow(base)
    const raw = this._raw || []
    const series = raw.filter((p) => p.ts >= win.from && p.ts <= win.to)
    this.buildChartArgs(series, this._range)
    this.setData({
      fromText: data.formatTime(win.from),
      toText: data.formatTime(win.to),
      zoomed: !!this._zoom,
      zoomText: this.zoomTextOf(win),
    })
    if (this._chartSeen) this.drawChart(false)
  },

  /** 缩放提示文案：跨度 + 放大倍数 */
  zoomTextOf(win) {
    const base = this._base
    const mins = Math.round((win.to - win.from) / 60000)
    const span = mins >= 60 ? Math.round((mins / 60) * 10) / 10 + ' 小时' : mins + ' 分钟'
    const k = base ? Math.round(((base.to - base.from) / (win.to - win.from)) * 10) / 10 : 1
    return span + ' · ' + (k > 1.05 ? k + '×' : '全时段')
  },

  onResetZoom() {
    if (!this._zoom) return
    this.resetZoom()
    uni.showToast({ title: '已回到完整时间段', icon: 'none' })
  },

  resetZoom() {
    this._zoom = null
    this.compute()
  },

  compute(force) {
    const key = this.barnKey
    if (!key) return
    const base = this.window()
    const win = this.zoomWindow(base)
    this._base = base
    const span = win.to - win.from
    const useHour = span > 30 * 3600000
    const series = useHour ? data.getHourlyAgg(key, win.from, win.to) : data.getSeries(key, win.from, win.to)
    const unit = useHour ? '小时' : '分钟'

    const temps = series.map((p) => (p.tempAvg !== undefined ? p.tempAvg : p.temp))
    const humis = series.map((p) => (p.humiAvg !== undefined ? p.humiAvg : p.humi))
    const sum = (arr) => arr.reduce((a, c) => a + c, 0)
    const avg = (arr) => (arr.length ? sum(arr) / arr.length : 0)
    let outSec = 0
    let outPoints = 0
    series.forEach((p) => {
      const out = p.outTemp !== undefined ? (p.outTemp !== 0 || p.outHumi !== 0) : p.outSec > 0
      if (out) outPoints++
      outSec += p.outSec || 0
    })
    const range = data.getTarget(key)
    const stats = {
      samples: series.length,
      tempAvg: Number(avg(temps).toFixed(2)),
      tempMax: temps.length ? Math.max.apply(null, temps) : 0,
      tempMin: temps.length ? Math.min.apply(null, temps) : 0,
      humiAvg: Number(avg(humis).toFixed(1)),
      humiMax: humis.length ? Math.max.apply(null, humis) : 0,
      humiMin: humis.length ? Math.min.apply(null, humis) : 0,
      outPoints,
      outText: data.formatDuration(outSec),
      range,
      unit,
    }

    // 越限时段（连续区间）
    const segments = []
    let cur = null
    series.forEach((p) => {
      const t = p.temp !== undefined ? p.temp : p.tempAvg
      const h = p.humi !== undefined ? p.humi : p.humiAvg
      const isOut = (p.outTemp !== undefined ? (p.outTemp !== 0 || p.outHumi !== 0) : p.outSec > 0) || t > range.tMax || t < range.tMin || h > range.hMax || h < range.hMin
      if (isOut) {
        if (!cur) cur = { from: p.ts, to: p.ts, tempMax: t, tempMin: t, humiMax: h, humiMin: h }
        else {
          cur.to = p.ts
          cur.tempMax = Math.max(cur.tempMax, t)
          cur.tempMin = Math.min(cur.tempMin, t)
          cur.humiMax = Math.max(cur.humiMax, h)
          cur.humiMin = Math.min(cur.humiMin, h)
        }
      } else if (cur) {
        segments.push(cur)
        cur = null
      }
    })
    if (cur) segments.push(cur)
    const segs = segments.reverse().slice(0, 6).map((s) => ({
      fromText: data.formatTime(s.from),
      toText: data.formatTime(s.to),
      minText: Math.round((s.to - s.from) / 60000) + ' 分钟',
      tempText: s.tempMin.toFixed(1) + ' ~ ' + s.tempMax.toFixed(1) + '℃',
      humiText: s.humiMin.toFixed(1) + ' ~ ' + s.humiMax.toFixed(1) + '%RH',
    }))

    // 采样点（窗口内最近 10 个）
    const tail = series.slice(-10).reverse().map((p) => {
      const t = p.temp !== undefined ? p.temp : p.tempAvg
      const h = p.humi !== undefined ? p.humi : p.humiAvg
      const out = (p.outTemp !== undefined ? (p.outTemp !== 0 || p.outHumi !== 0) : p.outSec > 0) || t > range.tMax || t < range.tMin || h > range.hMax || h < range.hMin
      return {
        ts: p.ts,
        timeText: useHour ? data.formatTime(p.ts) : data.formatTime(p.ts),
        tempText: t.toFixed(1),
        humiText: h.toFixed(1),
        flagText: out ? '越限' : '正常',
        tone: out ? 'red' : 'green',
      }
    })

    this._raw = series
    this._range = range
    this.setData({
      fromText: data.formatTime(win.from),
      toText: data.formatTime(win.to),
      stats,
      segments: segs,
      samples: tail,
      granText: useHour ? '小时聚合（telemetry_agg_hour）' : '分钟聚合（telemetry_agg_min）',
      chartEmpty: series.length === 0,
      zoomed: !!this._zoom,
      zoomText: this.zoomTextOf(win),
    })

    // 绘图参数先缓存，等曲线进入视口再画（见 watchChart）
    this.buildChartArgs(series, range)
    if (this._chartSeen) this.drawChart(false)
    nav.skeletonDone(this)
  },

  /** 把序列降采样成绘图参数（最多 96 点，点太密曲线就成一条毛线） */
  buildChartArgs(series, range) {
    if (!series || series.length === 0) {
      this._chartArgs = null
      return
    }
    const maxPoints = 96
    const stepN = Math.ceil(series.length / maxPoints)
    const labels = []
    const temp = []
    const humi = []
    const outMask = []
    for (let i = 0; i < series.length; i += stepN) {
      const p = series[i]
      const t = p.temp !== undefined ? p.temp : p.tempAvg
      const h = p.humi !== undefined ? p.humi : p.humiAvg
      labels.push(data.formatClock(p.ts))
      temp.push(t)
      humi.push(h)
      const out = (p.outTemp !== undefined ? (p.outTemp !== 0 || p.outHumi !== 0) : p.outSec > 0) ||
        t > range.tMax || t < range.tMin || h > range.hMax || h < range.hMin
      outMask.push(out ? 1 : 0)
    }
    this._chartArgs = { labels, temp, humi, range, outMask, annotate: true, avg: true }
  },

  /**
   * 绘制曲线
   * @param {boolean} animate true=逐帧画出
   */
  drawChart(animate) {
    const args = this._chartArgs
    if (!args) return
    this.stopReveal()
    chart.getCanvas('#envChart').then((cv) => {
      if (animate) {
        this._reveal = chart.drawEnvChartReveal(cv, args, 820, () => {
          this._reveal = null
        })
      } else {
        chart.drawEnvChart(cv, args)
      }
    }).catch(() => {})
  },

  onRangeTap(e) {
    const k = e.currentTarget.dataset.k
    if (k === 'custom') {
      this.setData({ showCustom: true })
      return
    }
    this.setData({ rangeKey: k, showCustom: false }, () => {
      this._zoom = null
      this.compute()
    })
  },

  onPicker(e) {
    const k = e.currentTarget.dataset.k
    const patch = {}
    patch['custom.' + k] = e.detail.value
    this.setData(patch)
  },

  onApplyCustom() {
    const c = this.custom
    const from = parseDateTime(c.startDate, c.startTime)
    const to = parseDateTime(c.endDate, c.endTime)
    if (!from || !to || isNaN(from) || isNaN(to)) {
      uni.showToast({ title: '时间格式不合法', icon: 'none' })
      return
    }
    if (to <= from) {
      uni.showToast({ title: '结束时间须晚于开始时间', icon: 'none' })
      return
    }
    const st = data.getState()
    if (from < st.bootedAt - 7 * 86400000) {
      uni.showToast({ title: '仅保留近 7 天数据（10.1）', icon: 'none' })
    }
    this.setData({ rangeKey: 'custom', customFrom: from, customTo: to, showCustom: false }, () => {
      this._zoom = null
      this.compute()
    })
  },

  onCloseCustom() {
    this.setData({ showCustom: false })
  },

  onExport() {
    const perm = data.can('exportCsv')
    if (!perm.ok) {
      uni.showModal({ title: '无导出权限', content: perm.reason, showCancel: false })
      return
    }
    const win = this.window()
    const csv = engine.buildCsv(this.barnKey, win.from, win.to)
    const path = uni.env.USER_DATA_PATH + '/curves_' + this.barnKey + '.csv'
    try {
      uni.getFileSystemManager().writeFile({
        filePath: path,
        data: csv,
        encoding: 'utf8',
        success: () => {
          uni.setClipboardData({
            data: csv,
            success: () => {
              uni.showModal({
                title: 'CSV 已生成',
                content: '已写入：' + path + '\n内容已复制到剪贴板，可粘贴到文件或发送给自己。',
                showCancel: false,
              })
            },
          })
        },
        fail: () => {
          uni.setClipboardData({ data: csv, success: () => uni.showToast({ title: 'CSV 已复制到剪贴板', icon: 'success' }) })
        },
      })
    } catch (err) {
      uni.setClipboardData({ data: csv, success: () => uni.showToast({ title: 'CSV 已复制到剪贴板', icon: 'success' }) })
    }
  },

  goControl() {
    uni.switchTab({ url: '/pages/control/control' })
  },
})
</script>

<style>
/* history.wxss（与原生小程序工程逐字节一致） */
.window-text {
  font-size: 22rpx;
  color: #8b95a7;
  margin-top: 12rpx;
}

.custom-panel {
  margin-top: 14rpx;
  background: #f7f9fc;
  border-radius: 14rpx;
  padding: 16rpx;
}

.cp-row {
  display: flex;
  align-items: center;
  margin-bottom: 12rpx;
}

.cp-label {
  width: 70rpx;
  font-size: 24rpx;
  color: #5b6474;
}

.picker-box {
  background: #fff;
  border: 1rpx solid #e3e9f2;
  border-radius: 10rpx;
  padding: 10rpx 18rpx;
  font-size: 24rpx;
  color: #1f2937;
  margin-right: 14rpx;
  min-width: 180rpx;
  text-align: center;
}

.chip-label {
  font-size: 22rpx;
  color: #8b95a7;
  margin-right: 12rpx;
  align-self: center;
}

/* 曲线：放大为页面视觉重心，统计做成两行（温度一行 / 湿度一行） */
.chart-card {
  padding-bottom: 20rpx;
}

/* 曲线区域：接手势（双指缩放 / 单指拖动），挡住页面滚动 */
.chart-box {
  position: relative;
  width: 100%;
}

.chart {
  width: 100%;
  height: 520rpx;
}

/* 手势提示条 */
.chart-bar {
  display: flex;
  align-items: center;
  margin-top: 4rpx;
}

.cb-hint {
  flex: 1;
  font-size: 20rpx;
  color: #a8b1c2;
}

.cb-zoom {
  font-size: 20rpx;
  color: #3d6df2;
  background: #eef3ff;
  border-radius: 999rpx;
  padding: 2rpx 14rpx;
  margin-right: 10rpx;
}

.cb-reset {
  font-size: 20rpx;
  color: #3d6df2;
  padding: 2rpx 12rpx;
  border: 1rpx solid #d3ddf5;
  border-radius: 999rpx;
}

.stat-rows {
  background: #f7f9fc;
  border-radius: 12rpx;
  padding: 10rpx 16rpx;
  margin-bottom: 8rpx;
}

.sr-row {
  display: flex;
  align-items: center;
  padding: 8rpx 0;
  font-size: 21rpx;
  color: #8b95a7;
}

.sr-row:first-child {
  border-bottom: 1rpx solid #edf1f7;
}

.sr-tag {
  width: 66rpx;
  font-size: 21rpx;
  color: #5b6474;
  flex-shrink: 0;
}

.sr-cell {
  flex: 1;
  text-align: center;
}

.sr-num {
  font-size: 25rpx;
  font-weight: 600;
  color: #1f2937;
  margin: 0 2rpx;
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

.lg-dash {
  display: inline-block;
  width: 22rpx;
  height: 0;
  border-top: 2rpx dashed #b8c1d1;
  margin-right: 6rpx;
  vertical-align: middle;
}

.seg {
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f2f5fa;
}

.seg:last-child {
  border-bottom: none;
}

.seg-head {
  display: flex;
  align-items: center;
}

.seg-time {
  font-size: 24rpx;
  color: #1f2937;
  margin-left: 12rpx;
}

.seg-dur {
  margin-left: auto;
  font-size: 20rpx;
  color: #8b95a7;
}

.seg-body {
  font-size: 22rpx;
  color: #5b6474;
  margin-top: 6rpx;
}

.sample-row {
  display: flex;
  align-items: center;
  padding: 14rpx 0;
  border-bottom: 1rpx solid #f2f5fa;
  font-size: 24rpx;
  color: #1f2937;
}

.sample-row:last-child {
  border-bottom: none;
}

.sample-head {
  font-size: 20rpx;
  color: #8b95a7;
}

.s-col {
  flex: 1;
  text-align: center;
}

.s-time {
  flex: 1.4;
  text-align: left;
}

.foot-tip {
  margin: 20rpx 24rpx;
}
</style>
