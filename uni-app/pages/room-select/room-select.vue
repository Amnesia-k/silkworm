<template>
  <view class="page-wrap">
    <view class="hero">
      <view class="hero-title">选择蚕房</view>
      <view class="hero-sub">{{heroSub}}</view>
      <view class="hero-sub">系统时钟 {{simText}}（模拟演示）</view>
    </view>

    <view class="page-body">
      <view class="section-title">共 {{list.length}} 栋蚕房 · 点击卡片进入</view>

      <view v-for="(item, index) in list" :key="item.barn" class="card barn-card" :data-barn="item.barn" @tap="onPick">
        <view class="card-header">
          <text class="card-title">{{item.name}}</text>
          <text :class="'badge mode-' + (item.modeTone)">{{item.modeName}}</text>
          <text v-if="item.criticalCount > 0" class="badge badge-red">紧急 {{item.criticalCount}}</text>
          <text v-if="item.isCurrent" class="current-tag">上次选择</text>
        </view>

        <view class="barn-meta">
          <text class="mono">{{item.barn}}</text>
          <text class="sep">/</text>
          <text class="mono">{{item.zone}}</text>
          <text class="sep">·</text>
          <text>{{item.area}}㎡</text>
          <text class="sep">·</text>
          <text>{{item.varietyName}} · {{item.instarName}}</text>
        </view>

        <view class="barn-metrics">
          <view class="bm">
            <text :class="'bm-value ' + (item.tempOut)">{{item.tempText}}</text>
            <text class="bm-unit">℃</text>
          </view>
          <view class="bm">
            <text :class="'bm-value ' + (item.humiOut)">{{item.humiText}}</text>
            <text class="bm-unit">%RH</text>
          </view>
          <view class="bm bm-right">
            <text :class="'badge badge-' + (item.outTone)">{{item.outText}}</text>
          </view>
        </view>

        <view class="barn-target">目标区间 {{item.targetText}}</view>

        <view class="divider"></view>

        <view class="barn-foot">
          <text class="foot-item">
            <text :class="'dot ' + (item.online ? 'dot-green' : 'dot-red')"></text>{{item.online ? '设备在线' : '设备离线'}}
          </text>
          <text class="foot-item">执行器 {{item.deviceText}}</text>
          <text class="foot-item">告警 {{item.alarmCount}}</text>
          <text class="foot-item">WiFi {{item.wifiText}}</text>
        </view>
      </view>

      <view class="tip reset-tip">演示环境：数据由本机模拟规则引擎生成。</view>
      <view class="btn-row">
        <button class="btn-ghost" @tap="onReset">重置演示数据</button>
      </view>
    </view>
  </view>
</template>

<script>
import { mpPage } from '@/utils/uni-shim.js'
/**
 * pages/room-select —— 选择蚕房（控制区）
 * 规格书 1.6 蚕房 barn / 1.7 控制区 zone：每栋蚕房对应一个控制区，
 * 传感器与设备组一一对应；本页是启动页，选完才进入后续页面。
 */

import * as data from '@/utils/data.js'
import * as engine from '@/utils/engine.js'
import * as nav from '@/utils/nav.js'
import * as auth from '@/utils/auth.js'

export default mpPage({
  data: {
    list: [],
    from: '',
    simText: '',
    heroSub: '每栋蚕房对应一个控制区（zone），传感器与设备组一一对应',
  },

  onLoad(options) {
    // 冷启动闸门：需要登录但还没有会话时，直接去登录页（gate 关闭时不拦人）
    if (auth.needsLogin()) {
      uni.reLaunch({ url: '/pages/login/login' })
      return
    }
    const from = options && options.from ? decodeURIComponent(options.from) : ''
    this.setData({ from })
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

  refresh() {
    const st = data.getState()
    const list = data.getBarnList().map((b) => ({
      barn: b.barn,
      zone: b.zone,
      name: b.name,
      area: b.area,
      varietyName: b.varietyName,
      instarName: b.instarName,
      modeName: b.modeName,
      modeTone: b.modeTone,
      tempText: b.tempText,
      humiText: b.humiText,
      targetText: b.target.tempText + ' / ' + b.target.humiText,
      outText: b.outOfRange.levelName,
      outTone: b.outOfRange.level === 'normal' ? 'green' : (b.outOfRange.level === 'light' ? 'orange' : 'red'),
      tempOut: b.outOfRange.tempIn ? '' : 'text-danger',
      humiOut: b.outOfRange.humiIn ? '' : 'text-danger',
      deviceText: b.deviceOn + '/' + b.deviceTotal,
      alarmCount: b.alarmCount,
      criticalCount: b.criticalCount,
      wifiText: data.wifiText(b.wifi),
      wifiBars: b.wifiBars,
      online: b.online,
      isCurrent: b.barn === st.currentBarn,
    }))
    this.setData({ list, simText: data.formatTime(st.simClock) })
  },

  onPick(e) {
    const barn = e.currentTarget.dataset.barn
    const b = data.setCurrentBarn(barn)
    const app = getApp()
    if (app && app.globalData) app.globalData.currentBarn = barn
    uni.showToast({ title: '已进入 ' + b.name, icon: 'success' })
    setTimeout(() => nav.backFrom(this.from), 260)
  },

  onReset() {
    uni.showModal({
      title: '重置演示数据',
      content: '将恢复四栋蚕房的初始工况与目标区间，确定继续？',
      success: (r) => {
        if (!r.confirm) return
        data.resetDemo()
        data.setCurrentBarn('barn01')
        this.refresh()
        uni.showToast({ title: '已重置', icon: 'success' })
      },
    })
  },
})
</script>

<style>
/* room-select.wxss（与原生小程序工程逐字节一致） */
.barn-card {
  position: relative;
}

.current-tag {
  margin-left: auto;
  font-size: 20rpx;
  color: #3d6df2;
  background: rgba(61, 109, 242, 0.1);
  border-radius: 999rpx;
  padding: 2rpx 14rpx;
}

.barn-meta {
  font-size: 24rpx;
  color: #5b6474;
  margin-top: 4rpx;
}

.barn-meta .sep {
  margin: 0 10rpx;
  color: #c3cbd8;
}

.barn-metrics {
  display: flex;
  align-items: flex-end;
  margin-top: 18rpx;
}

.bm {
  display: flex;
  align-items: flex-end;
  margin-right: 36rpx;
}

.bm-right {
  margin-right: 0;
  margin-left: auto;
  align-items: center;
}

.bm-value {
  font-size: 52rpx;
  font-weight: 700;
  line-height: 1;
  color: #1f2937;
}

.bm-unit {
  font-size: 22rpx;
  color: #8b95a7;
  margin-left: 6rpx;
}

.barn-target {
  font-size: 22rpx;
  color: #8b95a7;
  margin-top: 10rpx;
}

.barn-foot {
  display: flex;
  flex-wrap: wrap;
  font-size: 22rpx;
  color: #8b95a7;
}

.foot-item {
  margin-right: 24rpx;
}

.reset-tip {
  margin: 10rpx 24rpx 0;
}
</style>
