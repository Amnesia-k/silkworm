/**
 * pages/index —— P01 实时看板（规格书 12.1，优先级：最高，全部角色可见）
 * 字段：蚕房/控制区选择器、实时温度、实时湿度、设备状态、当前控制模式、
 *       当前蚕龄品种、越限状态标记、WiFi 信号强度
 * 操作：下拉刷新数据、切换蚕房、查看告警红点提示
 *
 * 界面约定：信息压到「主数值 + 一行次要字段」，曲线提到第二张卡并放大；
 *          曲线在元素进入视口后才绘制，并逐帧画出（见 utils/chart.js whenVisible）。
 */

const data = require('../../utils/data.js')
const engine = require('../../utils/engine.js')
const nav = require('../../utils/nav.js')
const chart = require('../../utils/chart.js')
const clamp = require('../../utils/clamp.js')
const live = require('../../utils/live.js')

/**
 * 目标区间刻度尺：把「目标 24.0~25.0 ℃」画成一段尺子
 * 刻度范围取「区间两端各留 1 个单位」与「当前值」的并集，当前值偏得越远，点越靠边
 * @returns {{l:number,w:number,dot:number}} 百分比（0~100）
 */
function scaleOf(lo, hi, v) {
  const min = Math.min(Number(lo) - 1, Number(v))
  const max = Math.max(Number(hi) + 1, Number(v))
  const span = max - min || 1
  const pct = (x) => Math.round(((Number(x) - min) / span) * 1000) / 10
  const l = Math.max(0, Math.min(100, pct(lo)))
  const w = Math.max(2, Math.min(100 - l, pct(hi) - pct(lo)))
  const dot = Math.max(0, Math.min(100, pct(v)))
  return { l, w, dot }
}

Page({
  data: {
    loading: true,
    barnKey: '',
    info: null,
    devices: [],
    alarmList: [],
    couplingText: '',
    interlockText: '',
    levelBadge: 'badge-green',
    machineText: '--',
    machineWarn: false,
    /** 待裁定病蚕数（后端接口，见 utils/clamp.js） */
    clampPending: 0,
    chartStats: null,
    /** 目标区间刻度尺的百分比位置（温度 / 湿度） */
    scale: {
      temp: { l: 40, w: 20, dot: 50 },
      humi: { l: 40, w: 20, dot: 50 },
    },
  },

  onLoad() {
    nav.skeletonBegin(this)
    if (!nav.ensureBarn()) return
    this.setData({ barnKey: data.getCurrentBarn().barn })
  },

  onReady() {
    // 首次渲染完成后才挂观察器：onShow 早于首次渲染，那时节点还不存在，观察器会一直不回调
    this._ready = true
    this.watchChart()
  },

  onShow() {
    if (!this.data.barnKey) {
      if (!nav.ensureBarn()) return
      this.setData({ barnKey: data.getCurrentBarn().barn })
    }
    this.refresh()
    if (!this._tick) this._tick = () => this.refresh()
    engine.subscribe(this._tick)
    // 待裁定病蚕数来自后端接口（轮询由 utils/clamp.js 统一管理）
    if (!this._clampTick) this._clampTick = (p) => {
      this.setData({ clampPending: (p.diseased || []).length })
      this.refresh()
    }
    clamp.startPolling(this.data.barnKey, this._clampTick)
    // 从其它页面返回时，若曲线尚未画出，重新挂一次观察
    if (this._ready && !this._chartSeen) this.watchChart()
  },

  onHide() {
    engine.unsubscribe(this._tick)
    clamp.stopPolling(this._clampTick)
  },

  onUnload() {
    engine.unsubscribe(this._tick)
    clamp.stopPolling(this._clampTick)
    this._clampTick = null
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
    this.refresh()
    this.stopReveal()
    this.drawChart(!this._chartSeen)
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

  /* ---------------- 数据刷新 ---------------- */
  refresh() {
    const key = this.data.barnKey
    if (!key) { nav.skeletonDone(this); return }
    const s = data.getStatusSummary(key)
    const devices = s.devices.list.map((d) => ({
      id: d.id,
      name: d.name,
      kindName: d.kindName,
      on: d.on,
      stateText: d.stateText,
      locked: d.locked,
      lockText: d.lockText,
    }))
    const alarms = data.getAlarms(key, { status: 'active' }).slice(0, 3).map((a) => ({
      id: a.id,
      code: a.code,
      level: a.level,
      text: a.text,
      agoText: a.agoText,
      badge: a.level === 'critical' ? 'badge-red' : (a.level === 'warn' ? 'badge-orange' : 'badge-blue'),
      levelName: a.levelName,
    }))
    const level = s.outOfRange.level
    const ms = engine.getMachineSummary ? engine.getMachineSummary(key) : null
    const clampPending = this.data.clampPending || 0
    this.setData({
      info: s,
      devices,
      alarmList: alarms,
      couplingText: s.coupling + ' ' + s.couplingInfo.case,
      interlockText: s.interlock.active ? (s.interlock.code + ' ' + s.interlock.name) : '无',
      levelBadge: level === 'normal' ? 'badge-green' : (level === 'light' ? 'badge-orange' : 'badge-red'),
      machineText: ms ? (ms.on + '/' + ms.total) : '--',
      machineWarn: ms ? (ms.outOfPreset + clampPending) > 0 : clampPending > 0,
      scale: {
        temp: scaleOf(s.target.tMin, s.target.tMax, s.temp),
        humi: scaleOf(s.target.hMin, s.target.hMax, s.humi),
      },
    })

    // tabBar 告警红点（P01：查看告警红点提示）
    if (s.alarms.active > 0) {
      wx.showTabBarRedDot({ index: 2 })
    } else {
      wx.hideTabBarRedDot({ index: 2 })
    }

    if (this._chartSeen) this.drawChart(false)

    // 首次数据构建完成（所有 setData 之后）：关闭骨架屏
    nav.skeletonDone(this)
  },

  /**
   * 绘制曲线
   * @param {boolean} animate true=逐帧画出（首次进入视口 / 下拉刷新），false=直接重画（周期刷新）
   */
  drawChart(animate) {
    const key = this.data.barnKey
    if (!key) return
    this.stopReveal()
    const st = data.getState()
    const to = live.enabled() ? Date.now() : st.simClock
    const from = to - 6 * 3600000
    const series = data.getSeries(key, from, to)
    const range = data.getTarget(key)
    /* 登录后走真实历史接口；未登录保持本机模拟（演示模式） */
    if (live.enabled()) {
      live.series(key, from, to, { limit: 200 }).then((res) => {
        const pts = res.ok && res.points.length
          ? res.points.map((p) => ({ ts: p.ts, temp: p.temp, humi: p.humi, outSec: 0 }))
          : series
        this._paintChart(pts, range, animate)
      }).catch(() => this._paintChart(series, range, animate))
      return
    }
    this._paintChart(series, range, animate)
  },

  /** 用给定序列画图（series 元素含 ts/temp/humi/outSec） */
  _paintChart(series, range, animate) {
    // 按 5 分钟降采样：600 个分钟点压到约 72 点，曲线才干净
    const src = series.length > 96 ? series.filter((p, i) => i % Math.ceil(series.length / 72) === 0) : series
    const labels = []
    const temp = []
    const humi = []
    const outMask = []
    let outSec = 0
    series.forEach((p) => {
      outSec += p.outSec || 0
    })
    src.forEach((p) => {
      labels.push(data.formatClock(p.ts))
      temp.push(p.temp)
      humi.push(p.humi)
      outMask.push(p.outSec > 0 ? 1 : 0)
    })
    const sum = (arr) => arr.reduce((a, c) => a + c, 0)
    const full = series.map((p) => p.temp)
    const fullH = series.map((p) => p.humi)
    this.setData({
      chartStats: full.length
        ? {
            tempMax: Math.max.apply(null, full).toFixed(1),
            tempMin: Math.min.apply(null, full).toFixed(1),
            tempAvg: (sum(full) / full.length).toFixed(1),
            humiAvg: (sum(fullH) / fullH.length).toFixed(0),
            outText: outSec > 0 ? data.formatDuration(outSec) : '无',
            outWarn: outSec > 0,
          }
        : null,
    })
    const opts = { labels, temp, humi, range, outMask, annotate: true, avg: true }
    chart.getCanvas('#envChart').then((cv) => {
      if (animate) {
        this._reveal = chart.drawEnvChartReveal(cv, opts, 780, () => {
          this._reveal = null
        })
      } else {
        chart.drawEnvChart(cv, opts)
      }
    }).catch(() => {})
  },

  /* ---------------- 跳转 ---------------- */
  goDevice(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/device-detail/device-detail?id=' + id })
  },

  goAlarms() {
    wx.switchTab({ url: '/pages/alerts/alerts' })
  },

  goAlarmDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/alarm-detail/alarm-detail?id=' + encodeURIComponent(id) })
  },

  goControl() {
    wx.switchTab({ url: '/pages/control/control' })
  },

  goHistory() {
    wx.switchTab({ url: '/pages/history/history' })
  },

  goMachine() {
    wx.navigateTo({ url: '/pages/machine/machine' })
  },
})
