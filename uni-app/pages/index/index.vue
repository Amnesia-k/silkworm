<template>
  <view class="page-wrap">
    <barn-bar from="/pages/index/index" />

    <!-- 加载态：骨架屏 -->
    <skeleton v-if="loading" :rows="3" :hero="true" />

    <view v-if="!loading && info" class="page-body oura">
      <!-- 全局安全状态条：安全锁定 / 离线自治 / 传感器失效时压在最顶部 -->
      <safety-bar from="/pages/index/index" />

      <!-- 生命体征：两个数字就是这一屏的主角 -->
      <view class="vitals">
        <view class="vital" @tap="goControl">
          <view class="vital-head">
            <text class="vital-cap">温度</text>
            <text :class="'badge ' + (levelBadge)">{{info.outOfRange.levelName}}</text>
          </view>
          <view class="vital-num-row">
            <text :class="'vital-num ' + (info.outOfRange.tempIn ? '' : 'is-out')">{{info.tempText}}</text>
            <text class="vital-unit">℃</text>
          </view>
          <view class="vital-scale">
            <view class="vs-band" :style="'left:' + (scale.temp.l) + '%; width:' + (scale.temp.w) + '%;'"></view>
            <view :class="'vs-dot ' + (info.outOfRange.tempIn ? '' : 'is-out')" :style="'left:' + (scale.temp.dot) + '%;'"></view>
          </view>
          <view class="vital-foot">目标 {{info.target.tempText}}</view>
        </view>

        <view class="vital" @tap="goControl">
          <view class="vital-head">
            <text class="vital-cap">湿度</text>
            <text class="vital-upd">上报 {{info.lastReportText}}</text>
          </view>
          <view class="vital-num-row">
            <text :class="'vital-num ' + (info.outOfRange.humiIn ? '' : 'is-out')">{{info.humiText}}</text>
            <text class="vital-unit">%RH</text>
          </view>
          <view class="vital-scale">
            <view class="vs-band" :style="'left:' + (scale.humi.l) + '%; width:' + (scale.humi.w) + '%;'"></view>
            <view :class="'vs-dot ' + (info.outOfRange.humiIn ? '' : 'is-out')" :style="'left:' + (scale.humi.dot) + '%;'"></view>
          </view>
          <view class="vital-foot">目标 {{info.target.humiText}}</view>
        </view>
      </view>

      <!-- 越限：一条带底色的 note，不是一列红字 -->
      <view v-if="info.outOfRange.items.length > 0" class="note">
        <view v-for="(item, index) in info.outOfRange.items" :key="item.metric" class="note-line">
          {{item.metric === 'temp' ? '温度' : '湿度'}}{{item.dir === 'high' ? '偏高' : '偏低'}} {{item.value}}，限值 {{item.limit}}，已持续 {{item.dueSec}} 秒
        </view>
        <view class="note-act" @tap="goControl">去控制 ›</view>
      </view>

      <view class="meta-line">露点 {{info.dewp}} ℃ · WiFi {{info.wifiText}} · 传感器{{info.sensorOk ? '正常' : '失效'}} · 联锁 {{interlockText}} · {{info.instarName}} · {{info.varietyName}}</view>

      <!-- 环境趋势：进入视口后才画出（曲线自己长出来） -->
      <view class="card chart-card" id="envChartWrap">
        <view class="card-header">
          <text class="card-title">环境趋势</text>
          <text class="card-sub">近 6 小时</text>
          <text class="card-more" @tap="goHistory">全屏曲线 ›</text>
        </view>
        <view v-if="chartStats" class="chart-stats">
          <text class="cs-item">最高 <text class="cs-num">{{chartStats.tempMax}}</text> ℃</text>
          <text class="cs-item">最低 <text class="cs-num">{{chartStats.tempMin}}</text> ℃</text>
          <text class="cs-item">平均 <text class="cs-num">{{chartStats.tempAvg}}</text> ℃</text>
          <text :class="'cs-item ' + (chartStats.outWarn ? 'text-danger' : '')">越限 {{chartStats.outText}}</text>
        </view>
        <canvas type="2d" id="envChart" class="chart"></canvas>
        <view class="legend">
          <text class="legend-item"><text class="lg-dot lg-ink"></text>温度 ℃</text>
          <text class="legend-item"><text class="lg-dot lg-sage"></text>湿度 %RH</text>
          <text class="legend-item"><text class="lg-band"></text>目标区间</text>
          <text class="legend-item"><text class="lg-dash"></text>平均温度</text>
        </view>
      </view>

      <!-- 三格速览 -->
      <view class="mini-grid">
        <view class="mini-tile" @tap="goControl">
          <text class="mini-num">{{info.devices.on}}/{{info.devices.total}}</text>
          <text class="mini-cap">环控设备</text>
        </view>
        <view class="mini-tile" @tap="goAlarms">
          <text :class="'mini-num ' + (info.alarms.active > 0 ? 'is-alert' : '')">{{info.alarms.active}}</text>
          <text class="mini-cap">活跃告警</text>
        </view>
        <view class="mini-tile" @tap="goMachine">
          <text :class="'mini-num ' + (machineWarn ? 'is-warn' : '')">{{machineText}}</text>
          <text class="mini-cap">{{machineWarn ? '机械待干预' : '机械作业'}}</text>
        </view>
      </view>

      <!-- 环控设备状态（一行一台） -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">环控设备</text>
          <text :class="'badge mode-' + (info.modeTone)">{{info.modeName}}</text>
          <text class="card-more" @tap="goControl">手动控制 ›</text>
        </view>
        <view v-for="(item, index) in devices" :key="item.id" class="dev-row" :data-id="item.id" @tap="goDevice">
          <text :class="'dot ' + (item.on ? 'dot-green' : 'dot-gray')"></text>
          <text class="dev-name">{{item.name}}</text>
          <text class="dev-kind">{{item.kindName}}</text>
          <text :class="'badge ' + (item.locked ? 'badge-red' : (item.on ? 'badge-green' : 'badge-gray'))">{{item.locked ? item.lockText : item.stateText}}</text>
        </view>
        <view class="tip env-line">耦合工况 {{couplingText}} · 服务端 {{info.serverStateName}}<template v-if="info.mode === 'manual'"> · 手动剩余 {{info.manualLeftSec}} s</template><template v-if="!info.online"> · 离线自治 {{info.offlineText}}</template></view>
      </view>

      <!-- 活跃告警 -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">活跃告警</text>
          <text class="card-sub">紧急 {{info.alarms.critical}} · 警告 {{info.alarms.warn}} · 提示 {{info.alarms.info}}</text>
          <text class="card-more" @tap="goAlarms">全部 ›</text>
        </view>
        <view v-for="(item, index) in alarmList" :key="item.id" class="alarm-row" :data-id="item.id" @tap="goAlarmDetail">
          <view class="alarm-head">
            <text :class="'badge ' + (item.badge)">{{item.levelName}}</text>
            <text class="alarm-code mono">{{item.code}}</text>
            <text class="alarm-time">{{item.agoText}}</text>
          </view>
          <view class="alarm-text">{{item.text}}</view>
        </view>
        <view v-if="alarmList.length === 0" class="empty">当前无活跃告警</view>
      </view>

      <view class="tip foot-tip">下拉刷新 · 模拟时钟 {{info.simClockText}}</view>
    </view>
  </view>
</template>

<script>
import { mpPage } from '@/utils/uni-shim.js'
/**
 * pages/index —— P01 实时看板（规格书 12.1，优先级：最高，全部角色可见）
 * 字段：蚕房/控制区选择器、实时温度、实时湿度、设备状态、当前控制模式、
 *       当前蚕龄品种、越限状态标记、WiFi 信号强度
 * 操作：下拉刷新数据、切换蚕房、查看告警红点提示
 *
 * 界面约定：信息压到「主数值 + 一行次要字段」，曲线提到第二张卡并放大；
 *          曲线在元素进入视口后才绘制，并逐帧画出（见 utils/chart.js whenVisible）。
 */

import * as data from '@/utils/data.js'
import * as engine from '@/utils/engine.js'
import * as nav from '@/utils/nav.js'
import * as chart from '@/utils/chart.js'
import * as clamp from '@/utils/clamp.js'
import * as live from '@/utils/live.js'

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

export default mpPage({
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
    if (!this.barnKey) {
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
    clamp.startPolling(this.barnKey, this._clampTick)
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

  /* ---------------- 数据刷新 ---------------- */
  refresh() {
    const key = this.barnKey
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
    const clampPending = this.clampPending || 0
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
      uni.showTabBarRedDot({ index: 2 })
    } else {
      uni.hideTabBarRedDot({ index: 2 })
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
    const key = this.barnKey
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
    uni.navigateTo({ url: '/pages/device-detail/device-detail?id=' + id })
  },

  goAlarms() {
    uni.switchTab({ url: '/pages/alerts/alerts' })
  },

  goAlarmDetail(e) {
    const id = e.currentTarget.dataset.id
    uni.navigateTo({ url: '/pages/alarm-detail/alarm-detail?id=' + encodeURIComponent(id) })
  },

  goControl() {
    uni.switchTab({ url: '/pages/control/control' })
  },

  goHistory() {
    uni.switchTab({ url: '/pages/history/history' })
  },

  goMachine() {
    uni.navigateTo({ url: '/pages/machine/machine' })
  },
})
</script>

<style>
/* index.wxss（与原生小程序工程逐字节一致） */
/* pages/index —— 看板（Oura 方向打样）
 *
 * 这一页把「两个数字」当主角：暖纸底、无卡片、发丝线分区、衬线大数字、
 * 数字下方一条目标区间刻度尺。状态色只作文字，不再用彩色胶囊。
 */

page {
  background: #f7f1e8;
}

.oura {
  color: #1c1b1a;
}

/* ---------------- 卡片退成「分段」 ---------------- */
.oura .card {
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  margin: 0 36rpx;
  padding: 36rpx 0;
  border-top: 1rpx solid #e1dcd3;
}

.oura .card-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #1c1b1a;
}

.oura .card-sub {
  color: #6b6257;
}

.oura .card-more {
  color: #224228;
  font-weight: 600;
}

.oura .badge {
  background: transparent;
  padding-left: 0;
  padding-right: 0;
  font-size: 24rpx;
  font-weight: 600;
}

.oura .badge-green,
.oura .mode-green { color: #224228; }
.oura .badge-orange,
.oura .mode-orange { color: #8a5a12; }
.oura .badge-red,
.oura .mode-red { color: #8f1d14; }
.oura .badge-gray,
.oura .mode-gray { color: #6b6257; }
.oura .badge-blue,
.oura .mode-blue { color: #2454c9; }

.oura .dot-green { background: #224228; }
.oura .dot-gray { background: #b3aa9c; }

.oura .tip {
  color: #6b6257;
}

.oura .empty {
  color: #6b6257;
}

/* ---------------- 生命体征 ---------------- */
.vitals {
  display: flex;
  padding: 12rpx 36rpx 4rpx;
}

.vital {
  flex: 1;
  min-width: 0;
  padding: 24rpx 0 28rpx;
}

.vital + .vital {
  border-left: 1rpx solid #e1dcd3;
  padding-left: 34rpx;
}

.vital-head {
  display: flex;
  align-items: center;
}

.vital-cap {
  font-size: 24rpx;
  letter-spacing: 3rpx;
  color: #6b6257;
}

.vital-upd {
  margin-left: auto;
  font-size: 24rpx;
  color: #6b6257;
}

.vital-num-row {
  display: flex;
  align-items: baseline;
  margin-top: 6rpx;
}

.vital-num {
  font-family: Georgia, "Times New Roman", "Songti SC", serif;
  font-size: 104rpx;
  line-height: 1.05;
  font-weight: 400;
  letter-spacing: -3rpx;
  color: #1c1b1a;
}

.vital-num.is-out {
  color: #8f1d14;
}

.vital-unit {
  font-size: 26rpx;
  color: #6b6257;
  margin-left: 8rpx;
}

/* 目标区间刻度尺：浅色段＝目标区间，竖线＝当前值 */
.vital-scale {
  position: relative;
  height: 10rpx;
  margin-top: 16rpx;
  background: #e8e1d5;
  border-radius: 999rpx;
}

.vs-band {
  position: absolute;
  top: 0;
  height: 10rpx;
  background: #ced4b8;
  border-radius: 999rpx;
}

.vs-dot {
  position: absolute;
  top: -6rpx;
  width: 6rpx;
  height: 22rpx;
  margin-left: -3rpx;
  background: #224228;
  border-radius: 3rpx;
}

.vs-dot.is-out {
  background: #8f1d14;
}

.vital-foot {
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #6b6257;
}

/* ---------------- 越限提示（暖底 note，无左边框） ---------------- */
.note {
  margin: 6rpx 36rpx 0;
  padding: 20rpx 24rpx;
  background: rgba(175, 117, 27, 0.12);
  border-radius: 6rpx;
}

.note-line {
  font-size: 24rpx;
  color: #7a4f0e;
  line-height: 1.6;
}

.note-act {
  margin-top: 6rpx;
  font-size: 24rpx;
  font-weight: 600;
  color: #8a5a12;
  padding: 30rpx 0 24rpx;
}

.meta-line {
  margin: 22rpx 36rpx 0;
  font-size: 24rpx;
  color: #6b6257;
  line-height: 1.7;
}

/* ---------------- 曲线 ---------------- */
.chart-card {
  padding-bottom: 20rpx;
}

.chart {
  width: 100%;
  height: 500rpx;
}

.chart-stats {
  display: flex;
  flex-wrap: wrap;
  margin: 4rpx 0 8rpx;
  font-size: 24rpx;
  color: #6b6257;
}

.cs-item {
  margin-right: 26rpx;
}

.cs-num {
  font-family: Georgia, "Times New Roman", "Songti SC", serif;
  font-size: 30rpx;
  color: #1c1b1a;
  margin: 0 2rpx;
}

.legend {
  display: flex;
  flex-wrap: wrap;
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #6b6257;
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

.lg-ink { background: #224228; }
.lg-sage { background: #849671; }

.lg-band {
  display: inline-block;
  width: 22rpx;
  height: 12rpx;
  border-radius: 3rpx;
  background: #ced4b8;
  margin-right: 6rpx;
}

.lg-dash {
  display: inline-block;
  width: 22rpx;
  height: 0;
  border-top: 2rpx dashed #af751b;
  margin-right: 6rpx;
  vertical-align: middle;
}

/* ---------------- 三格速览（发丝线分隔，无卡片） ---------------- */
.mini-grid {
  display: flex;
  margin: 28rpx 36rpx 0;
  border-top: 1rpx solid #e1dcd3;
  border-bottom: 1rpx solid #e1dcd3;
}

.mini-tile {
  flex: 1;
  text-align: center;
  padding: 26rpx 4rpx;
  background: transparent;
  border-radius: 0;
  box-shadow: none;
  margin-right: 0;
}

.mini-tile + .mini-tile {
  border-left: 1rpx solid #e1dcd3;
}

.mini-num {
  display: block;
  font-family: Georgia, "Times New Roman", "Songti SC", serif;
  font-size: 52rpx;
  font-weight: 400;
  color: #1c1b1a;
  line-height: 1.15;
}

.mini-num.is-alert {
  color: #8f1d14;
}

.mini-num.is-warn {
  color: #8a5a12;
}

.mini-cap {
  display: block;
  font-size: 24rpx;
  color: #6b6257;
  margin-top: 4rpx;
}

/* ---------------- 设备行 ---------------- */
.dev-row {
  display: flex;
  align-items: center;
  padding: 22rpx 0;
  border-bottom: 1rpx solid #ece5d8;
}

.dev-row:last-child {
  border-bottom: none;
}

.dev-name {
  font-size: 28rpx;
  color: #1c1b1a;
  margin-left: 6rpx;
}

.dev-kind {
  font-size: 24rpx;
  color: #6b6257;
  margin-left: 10rpx;
  margin-right: auto;
}

.env-line {
  margin-top: 18rpx;
  padding-top: 16rpx;
  border-top: 1rpx solid #ece5d8;
}

/* ---------------- 告警 ---------------- */
.alarm-row {
  padding: 22rpx 0;
  border-bottom: 1rpx solid #ece5d8;
}

.alarm-row:last-child {
  border-bottom: none;
}

.alarm-head {
  display: flex;
  align-items: center;
}

.alarm-code {
  margin-left: 12rpx;
  font-size: 24rpx;
  color: #6b6257;
}

.alarm-time {
  margin-left: auto;
  font-size: 24rpx;
  color: #6b6257;
}

.alarm-text {
  font-size: 28rpx;
  color: #1c1b1a;
  margin-top: 8rpx;
  line-height: 1.6;
}

.foot-tip {
  margin: 24rpx 36rpx;
  color: #6b6257;
}
</style>
