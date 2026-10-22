<template>
  <view class="page-wrap">
    <!-- pages/alerts/alerts.wxml —— P03 告警列表 -->
    <!-- 加载态：骨架屏（barn-bar 在 page-body 之内，随 page-body 一起隐藏） -->
    <skeleton v-if="loading" :rows="3" />

    <view v-if="!loading" class="page-body">
      <!-- 顶部当前蚕房信息条 -->
      <barn-bar from="/pages/alerts/alerts" />

      <!-- 统计区 -->
      <view class="card stat-card">
        <view class="card-header">
          <text class="card-title">告警概览</text>
          <text class="card-sub">{{allBarns ? '全部蚕房' : barnName}}</text>
        </view>
        <view class="stat-grid">
          <view class="stat-tile">
            <view class="stat-value">{{stat.active}}</view>
            <view class="stat-label">活跃告警</view>
          </view>
          <view class="stat-tile">
            <view class="stat-value text-danger">{{stat.critical}}</view>
            <view class="stat-label">紧急</view>
          </view>
          <view class="stat-tile">
            <view class="stat-value text-warn">{{stat.warn}}</view>
            <view class="stat-label">警告</view>
          </view>
          <view class="stat-tile">
            <view class="stat-value text-primary">{{stat.info}}</view>
            <view class="stat-label">提示</view>
          </view>
        </view>
        <view class="tip stat-note">累计 {{stat.total}} 条 · 未处理 {{stat.unacked}} · 已确认 {{stat.acked}} · 已恢复 {{stat.cleared}}</view>
      </view>

      <!-- 筛选 + 规格书 13.3 抑制去重说明 -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">筛选</text>
          <text class="card-sub">共 {{list.length}} 条</text>
        </view>
        <view class="chip-row">
          <view v-for="(item, index) in levelOptions" :key="item.key" :class="'chip ' + (level === item.key ? 'chip-on' : '')" :data-key="item.key" @tap="onLevelTap">{{item.label}}</view>
        </view>
        <view class="chip-row filter-gap">
          <view v-for="(item, index) in statusOptions" :key="item.key" :class="'chip ' + (status === item.key ? 'chip-on' : '')" :data-key="item.key" @tap="onStatusTap">{{item.label}}</view>
        </view>
        <view class="divider"></view>
        <view class="tip dedup-tip">同一设备 {{dedupWindow}} min 内的重复告警自动合并（去重键 {{dedupKey}}）</view>
      </view>

      <!-- 告警列表 -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">告警列表</text>
          <text class="card-sub">{{allBarns ? '全部蚕房' : '当前蚕房'}}</text>
        </view>

        <view v-if="list.length === 0" class="empty">当前筛选条件下暂无告警</view>

        <view v-for="(item, index) in list" :key="item.id" class="alarm-item" :data-id="item.id" @tap="onOpenAlarm">
          <view class="alarm-bar" :style="'background: ' + (item.levelColor) + ';'"></view>
          <view class="alarm-body">
            <view class="alarm-top">
              <text :class="'badge ' + (item.levelBadge)">{{item.levelName}}</text>
              <text class="alarm-code mono">{{item.code}}</text>
              <text :class="'badge ' + (item.statusBadge) + ' alarm-status'">{{item.statusText}}</text>
            </view>
            <view class="alarm-text">{{item.text}}</view>
            <view class="alarm-meta">
              <text class="mono">{{item.deviceId}}</text>
              <text class="alarm-dot">·</text>
              <text>{{item.barnName}}</text>
              <text class="alarm-dot">·</text>
              <text>{{item.agoText}}</text>
              <text class="alarm-dot">·</text>
              <text>{{item.timeText}}</text>
            </view>
          </view>
          <view v-if="item.active && !item.acked && !item.cleared" :class="'alarm-ack ' + (canAck ? '' : 'btn-disabled')" :data-id="item.id" @tap.stop="onAckOne">确认</view>
        </view>
      </view>

      <!-- 底部操作 -->
      <view class="btn-row">
        <view :class="'btn-ghost ' + (canAck ? '' : 'btn-disabled')" @tap="onAckAll">批量确认</view>
        <view class="btn-primary" @tap="onToggleScope">{{allBarns ? '仅看当前蚕房' : '全部蚕房'}}</view>
      </view>

      <view class="tip foot-tip">升级规则：提示只记录；警告滞留 30 min 未确认升级为紧急；紧急无免打扰。</view>
    </view>
  </view>
</template>

<script>
import { mpPage } from '@/utils/uni-shim.js'
// pages/alerts/alerts.js —— P03 告警列表（规格书 12.1 P03 / 13.1 告警分级 / 13.3 抑制与去重）
import * as data from '@/utils/data.js'
import * as engine from '@/utils/engine.js'
import * as spec from '@/utils/spec.js'
import * as nav from '@/utils/nav.js'
import * as live from '@/utils/live.js'
import * as env from '@/utils/env.js'

/** 级别筛选（chip 一） */
const LEVEL_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'info', label: '提示' },
  { key: 'warn', label: '警告' },
  { key: 'critical', label: '紧急' },
]

/** 状态筛选（chip 二） */
const STATUS_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'unacked', label: '未处理' },
  { key: 'acked', label: '已确认' },
  { key: 'cleared', label: '已恢复' },
]

/** 级别 → 徽标配色（info 蓝 / warn 橙 / critical 红） */
const LEVEL_BADGE = { info: 'badge-blue', warn: 'badge-orange', critical: 'badge-red' }

const EMPTY_STAT = {
  total: 0,
  active: 0,
  critical: 0,
  warn: 0,
  info: 0,
  unacked: 0,
  acked: 0,
  cleared: 0,
}

export default mpPage({
  data: {
    loading: true,
    barnKey: '',
    barnName: '',
    allBarns: false,
    level: 'all',
    status: 'all',
    levelOptions: LEVEL_OPTIONS,
    statusOptions: STATUS_OPTIONS,
    stat: EMPTY_STAT,
    list: [],
    canAck: false,
    ackReason: '',
    dedupWindow: spec.ALARM_DEDUP.suppressWindow,
    dedupKey: spec.ALARM_DEDUP.dedupKey,
  },

  onLoad() {
    nav.skeletonBegin(this)
    // tab 页：未选蚕房自动回跳选择页
    if (!nav.ensureBarn()) return
    const perm = data.can('ackAlarm')
    this.setData({ canAck: !!perm.ok, ackReason: perm.reason || '' })
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

  /** 汇总统计 + 按筛选条件取列表（订阅引擎后统一走这里） */
  refresh() {
    const b = data.getCurrentBarn()
    if (!b) {
      this.setData({ stat: EMPTY_STAT, list: [] })
      // 兜底：没有当前蚕房时也要收掉骨架屏，避免一直停在加载态
      nav.skeletonDone(this)
      return
    }
    const perm = data.can('ackAlarm')
    // 切到「全部蚕房」时 getAlarms / getAlarmStats 传 null
    const scope = this.allBarns ? null : b.barn
    const list = data.getAlarms(scope, { level: this.level, status: this.status })
    this.setData({
      barnKey: b.barn,
      barnName: b.name,
      canAck: !!perm.ok,
      ackReason: perm.reason || '',
      stat: data.getAlarmStats(scope),
      list: list.map((a) =>
        Object.assign({}, a, {
          levelBadge: LEVEL_BADGE[a.level] || 'badge-gray',
          statusBadge: 'badge-' + (a.statusTone || 'gray'),
        })
      ),
    })

    // 首次数据构建完成（所有 setData 之后）：关闭骨架屏
    nav.skeletonDone(this)
  },

  onLevelTap(e) {
    this.setData({ level: e.currentTarget.dataset.key })
    this.refresh()
  },

  onStatusTap(e) {
    this.setData({ status: e.currentTarget.dataset.key })
    this.refresh()
  },

  /** 当前蚕房 / 全部蚕房 切换 */
  onToggleScope() {
    this.setData({ allBarns: !this.allBarns })
    this.refresh()
  },

  /** 点击条目 → 告警详情 */
  onOpenAlarm(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    uni.navigateTo({ url: '/pages/alarm-detail/alarm-detail?id=' + encodeURIComponent(id) })
  },

  /** 单条确认（条目内 catchtap，阻止冒泡到详情跳转） */
  onAckOne(e) {
    if (!this.canAck) {
      uni.showToast({ title: this.ackReason || '当前角色无权执行该操作', icon: 'none' })
      return
    }
    /* 登录后走真实接口 POST /alarms/{event_id}/confirm；未登录走本机模拟 */
    if (live.enabled()) {
      const id = e.currentTarget.dataset.id
      env.confirmAlarm(id).then((res) => {
        uni.showToast({ title: res.ok ? '告警已确认' : res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) live.refresh()
        setTimeout(() => this.refresh(), 800)
      })
      return
    }
    const res = engine.ackAlarm(e.currentTarget.dataset.id, '')
    uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
    this.refresh()
  },

  /** 批量确认（engine.ackAll 按蚕房范围执行） */
  onAckAll() {
    if (!this.canAck) {
      uni.showToast({ title: this.ackReason || '当前角色无权执行该操作', icon: 'none' })
      return
    }
    uni.showModal({
      title: '批量确认告警',
      content: '将确认「' + this.barnName + '」全部未处理告警，确认继续？',
      confirmText: '确认',
      success: (r) => {
        if (!r.confirm) return
        if (live.enabled()) {
          const ids = (this.list || []).filter((a) => !a.acked && a.status !== 'acked').map((a) => a.id)
          if (!ids.length) { uni.showToast({ title: '没有未处理告警', icon: 'none' }); return }
          Promise.all(ids.map((id) => env.confirmAlarm(id))).then((rs) => {
            const bad = rs.filter((x) => !x.ok).length
            uni.showToast({ title: bad ? ('部分确认失败 ' + bad + ' 条') : ('已确认 ' + ids.length + ' 条'), icon: bad ? 'none' : 'success' })
            live.refresh()
            setTimeout(() => this.refresh(), 800)
          })
          return
        }
        const res = engine.ackAll(this.barnKey)
        uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        this.refresh()
      },
    })
  },
})
</script>

<style>
/* alerts.wxss（与原生小程序工程逐字节一致） */
/* pages/alerts/alerts.wxss —— P03 告警列表补充样式（其余用 app.wxss 全局类） */

.stat-card {
  padding-bottom: 20rpx;
}

.stat-note {
  margin-top: 12rpx;
}

.filter-gap {
  margin-top: 16rpx;
}

.dedup-tip {
  margin-top: 4rpx;
}

.foot-tip {
  margin: 20rpx 24rpx 0;
}

/* ---------------- 告警条目 ---------------- */
.alarm-item {
  display: flex;
  align-items: stretch;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f2f5fa;
}

.alarm-item:last-child {
  border-bottom: none;
}

/* 级别左侧色条（颜色由 item.levelColor 内联） */
.alarm-bar {
  flex: none;
  width: 8rpx;
  border-radius: 999rpx;
  margin-right: 16rpx;
}

.alarm-body {
  flex: 1;
  min-width: 0;
}

.alarm-top {
  display: flex;
  align-items: center;
}

.alarm-code {
  font-size: 24rpx;
  color: #5b6474;
  margin-left: 12rpx;
}

.alarm-status {
  margin-left: auto;
}

.alarm-text {
  font-size: 28rpx;
  font-weight: 500;
  color: #1f2937;
  line-height: 1.45;
  margin-top: 8rpx;
}

.alarm-meta {
  font-size: 22rpx;
  color: #8b95a7;
  margin-top: 8rpx;
}

.alarm-dot {
  margin: 0 8rpx;
}

/* 条目内「确认」按钮（catchtap，不触发整行跳转） */
.alarm-ack {
  flex: none;
  align-self: center;
  margin-left: 16rpx;
  padding: 8rpx 24rpx;
  border-radius: 999rpx;
  background: rgba(61, 109, 242, 0.12);
  color: #3d6df2;
  font-size: 24rpx;
  line-height: 36rpx;
}
</style>
