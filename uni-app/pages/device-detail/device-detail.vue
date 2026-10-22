<template>
  <view class="page-wrap">
    <!-- pages/device-detail/device-detail.wxml —— P01 下钻页：设备详情 -->
    <barn-bar from="/pages/device-detail/device-detail" />

    <view class="page-body">

      <!-- ============ 设备信息卡 ============ -->
      <view v-if="info" class="card">
        <view class="card-header">
          <text class="card-title">{{info.name}}</text>
          <text class="badge badge-blue card-right">{{info.kindName}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">设备编号</text>
          <text class="kv-value mono">{{info.id}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">型号</text>
          <text class="kv-value">{{info.model}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">规格</text>
          <text class="kv-value">{{info.spec}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">所属蚕房 / 控制区</text>
          <text class="kv-value">{{info.barn}} / {{info.zone}}</text>
        </view>
        <view v-if="info.group" class="kv-row">
          <text class="kv-label">设备组</text>
          <text class="kv-value">{{info.group}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">在线状态</text>
          <text :class="'kv-value ' + (info.online ? 'text-ok' : 'text-danger')">{{info.onlineText}}</text>
        </view>
      </view>
      <view v-else class="card">
        <view class="empty">未找到设备（{{deviceId}}）</view>
      </view>

      <!-- ============ BOM 清单条目卡（规格书 4.1） ============ -->
      <view v-if="bom" class="card">
        <view class="card-header">
          <text class="card-title">{{bom.name}}</text>
          <text class="card-sub">BOM 清单</text>
          <text class="badge badge-gray card-right">{{bom.code}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">配置型号</text>
          <text class="kv-value">{{bom.model}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">数量</text>
          <text class="kv-value">{{bom.qty}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">技术规格</text>
          <text class="kv-value">{{bom.spec}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">安装位置</text>
          <text class="kv-value">{{bom.pos}}</text>
        </view>
        <view v-if="bom.device" class="kv-row">
          <text class="kv-label">对应下发设备</text>
          <text class="kv-value mono">{{bom.device}}</text>
        </view>
      </view>

      <!-- ============ 实时运行卡 ============ -->
      <view v-if="dev" class="card">
        <view class="card-header">
          <text class="card-title">实时运行</text>
          <text :class="'badge ' + (dev.on ? 'badge-green' : 'badge-gray') + ' card-right'">{{dev.stateText}}</text>
        </view>
        <view class="list-meta">
          <view :class="'dot ' + (dev.on ? 'dot-green' : 'dot-gray')"></view>
          <text :class="dev.on ? 'text-ok' : 'text-sub'">{{dev.stateText}}</text>
          <text class="text-sub"> · 今日启停 {{dev.switchesToday}} 次</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">累计运行时长</text>
          <text class="kv-value">{{dev.runtimeText}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">最近一次启停</text>
          <text class="kv-value">{{dev.lastSwitchText}}</text>
        </view>
        <view v-if="dev.locked" class="kv-row">
          <text class="kv-label">联锁状态</text>
          <text class="kv-value text-danger">🔒 {{dev.lockText}}</text>
        </view>
        <view v-if="dev.faultCode" class="kv-row">
          <text class="kv-label">故障码</text>
          <text class="kv-value text-danger">{{dev.faultCode}}</text>
        </view>
        <view v-if="!dev.canSwitch" class="tip">当前状态不允许手动控制（安全锁定 / 离线 / 传感器失效 / 联锁）。</view>
      </view>

      <!-- ============ 近 6 小时环境曲线 ============ -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">近 6 小时环境曲线</text>
          <text class="card-sub">{{seriesCount}} 点 · 分钟聚合</text>
        </view>
        <canvas type="2d" id="envChart" class="env-chart"></canvas>
        <view class="tip">蓝线 温度 ℃ ｜ 绿线 湿度 %RH ｜ 绿色带 目标区间 ｜ 灰虚线 平均温度</view>
      </view>

      <!-- ============ 相关告警卡 ============ -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">相关告警</text>
          <text class="card-sub">最近 {{alarms.length}} 条</text>
        </view>
        <view v-for="(item, index) in alarms" :key="item.id" class="list-item">
          <view class="list-main">
            <view class="list-name">
              <text :class="'badge badge-' + (item.level === 'critical' ? 'red' : (item.level === 'warn' ? 'orange' : 'blue')) + ' alarm-level'">{{item.levelName}}</text>
              {{item.defName || item.code}}
            </view>
            <view class="list-meta">{{item.text}}</view>
            <view class="list-meta text-sub">{{item.timeText}} · {{item.agoText}}</view>
          </view>
          <view class="list-tail">
            <text :class="'badge badge-' + (item.statusTone)">{{item.statusText}}</text>
          </view>
        </view>
        <view v-if="alarms.length === 0" class="empty">该设备近期无告警记录</view>
      </view>

      <!-- ============ 快捷操作 ============ -->
      <view v-if="dev" class="card">
        <view class="card-header">
          <text class="card-title">快捷操作</text>
          <text class="card-sub">{{info ? info.name : deviceId}}</text>
        </view>
        <input v-if="permManual.needToken" class="memo-input" :value="tokenInput" @input="onTokenInput" placeholder="粘贴管理员签发的 ACTION_TOKEN" />
        <view v-if="permManual.needToken" class="tip">操作员手动开关需携带管理员签发的令牌（5 min 内单次有效）。</view>
        <view v-if="!permManual.ok" class="tip">{{permManual.reason}}，无法执行手动控制。</view>
        <view class="btn-row">
          <view :class="'btn-primary ' + ((permManual.ok && dev.canSwitch) ? '' : 'btn-disabled')" @tap="onToggle">{{dev.actionText}}{{dev.name}}</view>
          <view class="btn-ghost" @tap="goBack">返回手动控制</view>
        </view>
        <view class="tip">开关需二次确认，成功后进入手动模式并倒计时 30 min。</view>
      </view>

    </view>
  </view>
</template>

<script>
import { mpPage } from '@/utils/uni-shim.js'
// pages/device-detail/device-detail.js —— P01 看板下钻：设备详情
import * as data from '@/utils/data.js'
import * as engine from '@/utils/engine.js'
import * as spec from '@/utils/spec.js'
import * as nav from '@/utils/nav.js'
import * as chart from '@/utils/chart.js'
import * as live from '@/utils/live.js'

/** 设备 → 规格书 4.1 BOM 条目编号映射 */
const BOM_CODE = {
  heat01: 'D03',
  fan01: 'D04',
  fan02: 'D04',
  mist01: 'D05',
}

const VALID_IDS = ['heat01', 'fan01', 'fan02', 'mist01']

export default mpPage({
  data: {
    barnKey: '',
    deviceId: 'heat01',
    info: null,
    bomCode: '',
    bom: null,
    dev: null,
    permManual: { ok: false, needToken: false, reason: '' },
    tokenInput: '',
    alarms: [],
    seriesCount: 0,
  },

  onLoad(options) {
    if (!nav.ensureBarn()) return
    const b = data.getCurrentBarn()
    this._barn = b.barn
    let id = options && options.id ? options.id : 'heat01'
    if (VALID_IDS.indexOf(id) < 0) id = 'heat01'
    this.setData({
      barnKey: b.barn,
      deviceId: id,
      bomCode: BOM_CODE[id] || '',
      permManual: data.can('manual'),
    })
    this.refresh()
  },

  onReady() {
    this._ready = true
    this.drawChart()
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
    this._tick = null
  },

  refresh() {
    const barnKey = this._barn || this.barnKey
    const id = this.deviceId
    if (!barnKey) return
    const b = data.getBarn(barnKey)
    const st = data.getStatusSummary(barnKey)
    const raw = data.getDevices(barnKey).filter((x) => x.id === id)[0] || null
    const live = st.devices.list.filter((x) => x.id === id)[0] || null

    const info = raw
      ? {
          id: raw.id,
          name: raw.name,
          kindName: raw.kindName,
          model: raw.model,
          spec: raw.spec,
          barn: b.barn,
          zone: b.zone,
          group: b.group || '',
          online: raw.online,
          onlineText: raw.online ? '在线' : '离线',
        }
      : null

    const code = BOM_CODE[id] || ''
    const bom = code ? spec.BOM.filter((x) => x.code === code)[0] || null : null

    const alarms = data
      .getAlarms(barnKey, {})
      .filter((a) => a.deviceId === id)
      .slice(0, 5)

    this.setData({
      info,
      bom: bom
        ? { code: bom.code, name: bom.name, model: bom.model, qty: bom.qty, spec: bom.spec, pos: bom.pos, device: bom.device }
        : null,
      dev: live
        ? {
            name: live.name,
            on: live.on,
            stateText: live.stateText,
            locked: live.locked,
            lockText: live.lockText,
            runtimeText: live.runtimeText,
            switchesToday: live.switchesToday,
            lastSwitchText: live.lastSwitchText,
            faultCode: live.faultCode,
            canSwitch: live.canSwitch,
            actionText: live.on ? '关闭' : '开启',
          }
        : null,
      alarms,
      permManual: data.can('manual'),
    })
    this.drawChart()
  },

  /** 近 6 小时环境曲线（onReady 后绘制，每次 refresh 后重绘） */
  drawChart() {
    if (!this._ready) return
    const barnKey = this._barn || this.barnKey
    if (!barnKey) return
    const st = data.getState()
    const nowTs = live.enabled() ? Date.now() : st.simClock
    const from = nowTs - 6 * 3600000
    const to = nowTs
    const series = data.getSeries(barnKey, from, to)
    if (live.enabled()) {
      live.series(barnKey, from, to, { limit: 200 }).then((res) => {
        const pts = res.ok && res.points.length
          ? res.points.map((p) => ({ ts: p.ts, temp: p.temp, humi: p.humi, outSec: 0 }))
          : series
        this._paint(pts, barnKey)
      }).catch(() => this._paint(series, barnKey))
      return
    }
    this._paint(series, barnKey)
  },

  _paint(series, barnKey) {
    const src = series.length > 96 ? series.filter((p, i) => i % Math.ceil(series.length / 72) === 0) : series
    const labels = src.map((p) => data.formatClock(p.ts))
    const temp = src.map((p) => p.temp)
    const humi = src.map((p) => p.humi)
    const outMask = src.map((p) => (p.outSec > 0 ? 1 : 0))
    const range = data.getTarget(barnKey)
    const p = chart.getCanvas('#envChart')
    if (!p || typeof p.then !== 'function') return
    p.then((cv) => chart.drawEnvChart(cv, { labels, temp, humi, range, outMask, annotate: true, avg: true }))
      .catch(() => {})
    if (this.seriesCount !== series.length) this.setData({ seriesCount: series.length })
  },

  onTokenInput(e) {
    this.setData({ tokenInput: e.detail.value })
  },

  onToggle() {
    const barnKey = this._barn || this.barnKey
    const id = this.deviceId
    const dev = this.dev
    const perm = data.can('manual')
    if (!dev) {
      uni.showToast({ title: '设备信息不可用', icon: 'none' })
      return
    }
    if (!perm.ok) {
      uni.showToast({ title: perm.reason || '当前角色无权执行手动控制', icon: 'none' })
      return
    }
    if (!dev.canSwitch) {
      uni.showToast({ title: dev.locked ? (dev.lockText || '设备已联锁锁定') : '当前状态不允许远端手动控制', icon: 'none' })
      return
    }
    const tokenId = (this.tokenInput || '').trim()
    if (perm.needToken && !tokenId) {
      uni.showToast({ title: '操作员需先填写管理员签发的 ACTION_TOKEN', icon: 'none' })
      return
    }
    const content = '确认要' + dev.actionText + '「' + dev.name + '（' + id + '）」吗？'
      + (perm.needToken ? '\n将消耗令牌 ' + tokenId + '（单次有效）' : '')
    uni.showModal({
      title: '手动控制确认',
      content,
      confirmText: '确认下发',
      success: (r) => {
        if (!r.confirm) return
        const res = engine.toggleDevice(barnKey, id, tokenId)
        uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) this.setData({ tokenInput: '' })
        this.refresh()
      },
    })
  },

  goBack() {
    uni.navigateBack({ delta: 1 })
  },
})
</script>

<style>
/* device-detail.wxss（与原生小程序工程逐字节一致） */
/* pages/device-detail/device-detail.wxss —— 仅补充全局样式未覆盖的新类 */

.card-right { margin-left: auto; }

.env-chart {
  width: 100%;
  height: 420rpx;
  margin-top: 12rpx;
}

.alarm-level {
  margin-right: 12rpx;
}

.memo-input {
  margin: 12rpx 0;
  padding: 18rpx 24rpx;
  background: #f4f6f9;
  border-radius: 12rpx;
  font-size: 26rpx;
  color: #2c3542;
}
</style>
