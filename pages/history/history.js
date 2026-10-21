/**
 * pages/history —— P02 历史曲线（规格书 12.1，优先级：高，全部角色）
 * 字段：温湿度双轴曲线图、时间选择器、越限区间高亮底色、最大/最小/平均值标注、数据采样点
 * 操作：自定义选择查询时间段、缩放曲线、导出 CSV 数据文件、切换蚕房
 * 数据源：data.getSeries（10.3 telemetry_agg_min）/ data.getHourlyAgg（10.3 telemetry_agg_hour）
 */

const data = require('../../utils/data.js')
const engine = require('../../utils/engine.js')
const nav = require('../../utils/nav.js')
const chart = require('../../utils/chart.js')

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

Page({
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
    if (!this.data.barnKey) {
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
    wx.stopPullDownRefresh()
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
    this.setData({ showSamples: !this.data.showSamples })
  },

  /** 计算当前窗口 [from, to]（时间段选择给出的基准窗口，不含手势缩放） */
  window() {
    const st = data.getState()
    if (this.data.rangeKey === 'custom' && this.data.customTo > this.data.customFrom) {
      return { from: this.data.customFrom, to: this.data.customTo }
    }
    const item = RANGES.filter((r) => r.key === this.data.rangeKey)[0] || RANGES[1]
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
      wx.createSelectorQuery()
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
    if (!base || this.data.chartEmpty) return
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
    wx.showToast({ title: '已回到完整时间段', icon: 'none' })
  },

  resetZoom() {
    this._zoom = null
    this.compute()
  },

  compute(force) {
    const key = this.data.barnKey
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
    const c = this.data.custom
    const from = parseDateTime(c.startDate, c.startTime)
    const to = parseDateTime(c.endDate, c.endTime)
    if (!from || !to || isNaN(from) || isNaN(to)) {
      wx.showToast({ title: '时间格式不合法', icon: 'none' })
      return
    }
    if (to <= from) {
      wx.showToast({ title: '结束时间须晚于开始时间', icon: 'none' })
      return
    }
    const st = data.getState()
    if (from < st.bootedAt - 7 * 86400000) {
      wx.showToast({ title: '仅保留近 7 天数据（10.1）', icon: 'none' })
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
      wx.showModal({ title: '无导出权限', content: perm.reason, showCancel: false })
      return
    }
    const win = this.window()
    const csv = engine.buildCsv(this.data.barnKey, win.from, win.to)
    const path = wx.env.USER_DATA_PATH + '/curves_' + this.data.barnKey + '.csv'
    try {
      wx.getFileSystemManager().writeFile({
        filePath: path,
        data: csv,
        encoding: 'utf8',
        success: () => {
          wx.setClipboardData({
            data: csv,
            success: () => {
              wx.showModal({
                title: 'CSV 已生成',
                content: '已写入：' + path + '\n内容已复制到剪贴板，可粘贴到文件或发送给自己。',
                showCancel: false,
              })
            },
          })
        },
        fail: () => {
          wx.setClipboardData({ data: csv, success: () => wx.showToast({ title: 'CSV 已复制到剪贴板', icon: 'success' }) })
        },
      })
    } catch (err) {
      wx.setClipboardData({ data: csv, success: () => wx.showToast({ title: 'CSV 已复制到剪贴板', icon: 'success' }) })
    }
  },

  goControl() {
    wx.switchTab({ url: '/pages/control/control' })
  },
})
