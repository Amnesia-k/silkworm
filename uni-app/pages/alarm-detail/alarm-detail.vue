<template>
<!-- pages/alarm-detail/alarm-detail.wxml —— 告警详情 -->
<view class="page-body">
  <!-- 正常：找到告警 -->
  <template v-if="alarm">
    <!-- 告警基本信息 -->
    <view class="card">
      <view class="card-header">
        <text class="card-title mono">{{alarm.code}}</text>
        <text :class="'badge ' + (levelBadge)">{{alarm.levelName}}</text>
        <text :class="'badge ' + (statusBadge) + ' status-tail'">{{alarm.statusText}}</text>
      </view>
      <view class="detail-text">{{alarm.text}}</view>
      <view class="divider"></view>
      <view class="kv-row">
        <text class="kv-label">来源设备</text>
        <text class="kv-value mono">{{alarm.deviceId}}</text>
      </view>
      <view class="kv-row">
        <text class="kv-label">所属蚕房</text>
        <text class="kv-value">{{barn.name}}（{{barn.barn}} / {{barn.zone}}）</text>
      </view>
      <view class="kv-row">
        <text class="kv-label">发生时间</text>
        <text class="kv-value">{{alarm.timeText}} · {{alarm.agoText}}</text>
      </view>
      <view class="kv-row">
        <text class="kv-label">ISO8601</text>
        <text class="kv-value mono">{{alarm.isoText}}</text>
      </view>
      <view class="kv-row">
        <text class="kv-label">当前状态</text>
        <text class="kv-value">{{alarm.statusText}}</text>
      </view>
      <view v-if="alarm.acked" class="kv-row">
        <text class="kv-label">确认人</text>
        <text class="kv-value">{{alarm.ackBy}}</text>
      </view>
      <view v-if="clearedText" class="kv-row">
        <text class="kv-label">恢复时间</text>
        <text class="kv-value">{{clearedText}}</text>
      </view>
    </view>

    <!-- 规格书定义（13.1 分级 + 13.2 清单） -->
    <view class="card">
      <view class="card-header">
        <text class="card-title">分级与清单</text>
        <text class="card-sub">告警清单</text>
      </view>
      <view class="kv-row">
        <text class="kv-label">告警名称</text>
        <text class="kv-value">{{alarm.defName}}</text>
      </view>
      <view class="kv-row">
        <text class="kv-label">触发条件</text>
        <text class="kv-value def-value">{{alarm.defTrigger}}</text>
      </view>
      <view class="kv-row">
        <text class="kv-label">恢复条件</text>
        <text class="kv-value def-value">{{alarm.defClear}}</text>
      </view>
      <view class="kv-row">
        <text class="kv-label">通知渠道</text>
        <text class="kv-value">{{alarm.levelChannel}}</text>
      </view>
      <view class="kv-row">
        <text class="kv-label">响应时限</text>
        <text class="kv-value">{{alarm.levelResponse}}</text>
      </view>
      <view class="divider"></view>
      <view class="tip-label">处置建议</view>
      <view class="advice-box">{{alarm.advice}}</view>
    </view>

    <!-- 告警清单 AL01~AL08，当前这条高亮 -->
    <view class="card">
      <view class="card-header">
        <text class="card-title">告警清单</text>
        <text class="card-sub">AL01 ~ AL08</text>
      </view>
      <view v-for="(item, index) in catalog" :key="item.code" :class="'cat-item ' + (item.current ? 'cat-current' : '')">
        <view class="cat-left">
          <text class="cat-code mono">{{item.code}}</text>
          <text :class="'badge ' + (item.levelBadge)">{{item.levelName}}</text>
        </view>
        <view class="cat-body">
          <view class="cat-name">{{item.name}}</view>
          <view class="cat-trigger">{{item.trigger}}</view>
        </view>
      </view>
    </view>

    <!-- 操作 -->
    <view class="btn-row">
      <view :class="'btn-primary ' + (canAck ? '' : 'btn-disabled')" @tap="onAck">确认告警</view>
    </view>
    <view class="btn-row">
      <view class="btn-ghost" @tap="onGoDashboard">查看该蚕房看板</view>
      <view class="btn-ghost" @tap="onGoControl">前往手动控制</view>
    </view>
  </template>

  <!-- 异常：找不到该告警 -->
  <view v-if="!alarm" class="card">
    <view class="empty">未找到该告警，可能已被清除或编号无效</view>
    <view class="tip">id：{{id || '（空）'}}</view>
    <view class="btn-row inner-row">
      <view class="btn-ghost" @tap="onBack">返回告警列表</view>
    </view>
  </view>
</view>
</template>

<script>
import { mpPage } from '@/utils/uni-shim.js'
// pages/alarm-detail/alarm-detail.js —— 告警详情（规格书 13.1 分级 / 13.2 清单 / 5.3 时间格式）
import * as data from '@/utils/data.js'
import * as engine from '@/utils/engine.js'
import * as spec from '@/utils/spec.js'

/** 级别 → 徽标配色 */
const LEVEL_BADGE = { info: 'badge-blue', warn: 'badge-orange', critical: 'badge-red' }

/** 查询参数可能是编码过的，容错解码 */
function decodeId(v) {
  if (!v) return ''
  try {
    return decodeURIComponent(v)
  } catch (e) {
    return v
  }
}

export default mpPage({
  data: {
    id: '',
    barn: null,
    alarm: null,
    canAck: false,
    ackReason: '',
    levelBadge: 'badge-gray',
    statusBadge: 'badge-gray',
    clearedText: '',
    catalog: [],
  },

  onLoad(options) {
    this.setData({ id: decodeId(options && options.id) })
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

  /** 按 id 取告警（data.findAlarm → { barn, alarm } 或 null） */
  refresh() {
    const hit = this.id ? data.findAlarm(this.id) : null
    if (!hit) {
      this.setData({
        barn: null,
        alarm: null,
        canAck: false,
        ackReason: '',
        levelBadge: 'badge-gray',
        statusBadge: 'badge-gray',
        clearedText: '',
        catalog: this.buildCatalog(''),
      })
      return
    }
    const perm = data.can('ackAlarm')
    const a = hit.alarm
    this.setData({
      barn: {
        barn: hit.barn.barn,
        zone: hit.barn.zone,
        group: hit.barn.group,
        name: hit.barn.name,
      },
      alarm: a,
      canAck: !!perm.ok,
      ackReason: perm.reason || '',
      levelBadge: LEVEL_BADGE[a.level] || 'badge-gray',
      statusBadge: 'badge-' + (a.statusTone || 'gray'),
      clearedText: a.cleared && a.clearedAt ? data.formatTime(a.clearedAt) : '',
      catalog: this.buildCatalog(a.code),
    })
  },

  /** 规格书 13.2 告警清单 AL01~AL08，当前这条高亮 */
  buildCatalog(code) {
    return spec.ALARMS.map((x) => ({
      code: x.code,
      name: x.name,
      trigger: x.trigger,
      level: x.level,
      levelName: (spec.ALARM_LEVELS[x.level] || {}).name || x.level,
      levelBadge: LEVEL_BADGE[x.level] || 'badge-gray',
      current: !!code && x.code === code,
    }))
  },

  /** 确认告警 */
  onAck() {
    if (!this.canAck) {
      uni.showToast({ title: this.ackReason || '当前角色无权执行该操作', icon: 'none' })
      return
    }
    const a = this.alarm
    if (!a) return
    uni.showModal({
      title: '确认告警',
      content: '确认 ' + a.code + '「' + a.text + '」？',
      confirmText: '确认',
      success: (r) => {
        if (!r.confirm) return
        const res = engine.ackAlarm(a.id, '')
        uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        this.refresh()
      },
    })
  },

  /** 切到该告警所属蚕房并跳看板 */
  onGoDashboard() {
    if (!this.barn) return
    data.setCurrentBarn(this.barn.barn)
    uni.switchTab({ url: '/pages/index/index' })
  },

  /** 切到该告警所属蚕房并跳手动控制 */
  onGoControl() {
    if (!this.barn) return
    data.setCurrentBarn(this.barn.barn)
    uni.switchTab({ url: '/pages/control/control' })
  },

  onBack() {
    uni.navigateBack({ delta: 1 })
  },
})
</script>

<style>
/* alarm-detail.wxss（与原生小程序工程逐字节一致） */
/* pages/alarm-detail/alarm-detail.wxss —— 告警详情补充样式（其余用 app.wxss 全局类） */

.status-tail {
  margin-left: auto;
}

.detail-text {
  font-size: 30rpx;
  font-weight: 600;
  color: #1f2937;
  line-height: 1.5;
  margin: 4rpx 0 8rpx;
}

/* 规格书长文本（触发/恢复条件）：不挤压、右对齐换行 */
.def-value {
  flex: 1;
  margin-left: 24rpx;
  text-align: right;
  font-weight: 400;
  font-size: 24rpx;
  color: #5b6474;
  line-height: 1.5;
}

.tip-label {
  font-size: 24rpx;
  color: #8b95a7;
  margin-bottom: 8rpx;
}

.advice-box {
  background: #f7f9fc;
  border-radius: 12rpx;
  padding: 16rpx 20rpx;
  font-size: 26rpx;
  color: #1f2937;
  line-height: 1.6;
}

/* ---------------- 告警清单 ---------------- */
.cat-item {
  display: flex;
  align-items: flex-start;
  padding: 16rpx 12rpx;
  border-radius: 12rpx;
  border-bottom: 1rpx solid #f2f5fa;
}

.cat-item:last-child {
  border-bottom: none;
}

.cat-current {
  background: rgba(61, 109, 242, 0.08);
}

.cat-left {
  flex: none;
  width: 168rpx;
}

.cat-code {
  font-size: 24rpx;
  font-weight: 600;
  color: #1f2937;
  margin-right: 10rpx;
}

.cat-body {
  flex: 1;
  min-width: 0;
}

.cat-name {
  font-size: 26rpx;
  font-weight: 500;
  color: #1f2937;
}

.cat-trigger {
  font-size: 22rpx;
  color: #8b95a7;
  margin-top: 4rpx;
  line-height: 1.45;
}

.inner-row {
  margin: 20rpx 0 0;
}
</style>
