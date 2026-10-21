<template>
<view v-if="info" class="barn-bar">
  <view class="bb-main">
    <view class="bb-line1">
      <text class="bb-name">{{info.name}}</text>
      <text :class="'bb-mode mode-' + (info.modeTone)">{{info.modeName}}</text>
      <text :class="'bb-online ' + (info.online ? 'text-ok' : 'text-danger')">{{info.online ? '在线' : '离线'}}</text>
    </view>
    <view class="bb-line2">
      <text>{{info.barn}} / {{info.zone}}</text>
      <text class="bb-sep">·</text>
      <text>{{info.varietyName}} · {{info.instarName}}</text>
      <text class="bb-sep">·</text>
      <text>{{info.area}}㎡</text>
    </view>
    <view class="bb-line3">目标区间 {{info.targetText}}</view>
  </view>

  <view v-if="showMetrics" class="bb-right">
    <view class="bb-metric">
      <text :class="'bb-value ' + (info.tempOut === 'high' ? 'text-danger' : (info.tempOut === 'low' ? 'text-primary' : ''))">{{info.temp}}</text>
      <text class="bb-unit">℃</text>
    </view>
    <view class="bb-metric">
      <text :class="'bb-value ' + (info.humiOut === 'high' ? 'text-danger' : (info.humiOut === 'low' ? 'text-primary' : ''))">{{info.humi}}</text>
      <text class="bb-unit">%</text>
    </view>
  </view>

  <view class="bb-switch" @tap="onSwitch">切换 ›</view>
</view>
</template>

<script>
import { mpComponent } from '@/utils/uni-shim.js'
/**
 * components/barn-bar —— 顶部「当前蚕房 / 控制区」信息条
 * 显示 蚕房名 · 区号 · 品种 · 龄期 · 实时温湿度 · 控制模式 · 切换入口
 */

import * as data from '@/utils/data.js'
import * as engine from '@/utils/engine.js'

export default mpComponent({
  properties: {
    /** 切换后要回到的页面路径（tab 页用 switchTab 回跳） */
    from: { type: String, value: '' },
    /** 是否显示右侧实时温湿度 */
    showMetrics: { type: Boolean, value: true },
  },

  data: {
    info: null,
  },

  lifetimes: {
    attached() {
      this._tick = () => this.refresh()
      engine.subscribe(this._tick)
      this.refresh()
    },
    detached() {
      engine.unsubscribe(this._tick)
    },
  },

  methods: {
    refresh() {
      const b = data.getCurrentBarn()
      if (!b) {
        this.setData({ info: null })
        return
      }
      const range = data.getTarget(b.barn)
      const out = data.getOutOfRange(b.barn)
      this.setData({
        info: {
          barn: b.barn,
          zone: b.zone,
          name: b.name,
          area: b.area,
          online: b.online,
          temp: b.temp.toFixed(1),
          humi: b.humi.toFixed(1),
          tempOut: out.temp,
          humiOut: out.humi,
          modeName: data.modeName(b.mode),
          modeTone: data.modeTone(b.mode),
          varietyName: data.varietyName(b.variety),
          instarName: data.instarName(b.instar),
          targetText: range.tempText + ' / ' + range.humiText,
        },
      })
    },

    onSwitch() {
      uni.navigateTo({
        url: '/pages/room-select/room-select?from=' + encodeURIComponent(this.from || ''),
      })
    },
  },
})
</script>

<style>
/* barn-bar.wxss（与原生小程序工程逐字节一致） */
.barn-bar {
  display: flex;
  align-items: center;
  padding: 20rpx 32rpx;
  background: linear-gradient(135deg, #3d6df2 0%, #5b8cff 100%);
  color: #ffffff;
}

.bb-main {
  flex: 1;
  min-width: 0;
}

.bb-line1 {
  display: flex;
  align-items: center;
}

.bb-name {
  font-size: 32rpx;
  font-weight: 600;
}

.bb-mode {
  margin-left: 14rpx;
  padding: 2rpx 14rpx;
  border-radius: 999rpx;
  font-size: 20rpx;
}

.bb-line1 .bb-mode {
  background: rgba(255, 255, 255, 0.22);
  color: #ffffff;
}

.bb-online {
  margin-left: 12rpx;
  font-size: 20rpx;
  opacity: 0.9;
}

.bb-line1 .bb-online { color: #ffffff !important; opacity: 0.85; }

.bb-line2 {
  font-size: 22rpx;
  opacity: 0.86;
  margin-top: 6rpx;
}

.bb-sep { margin: 0 8rpx; }

.bb-line3 {
  font-size: 22rpx;
  opacity: 0.78;
  margin-top: 4rpx;
}

.bb-right {
  display: flex;
  align-items: flex-end;
  margin-left: 16rpx;
}

.bb-metric {
  text-align: right;
  margin-left: 20rpx;
}

.bb-value {
  font-size: 40rpx;
  font-weight: 700;
  line-height: 1;
}

.bb-unit {
  font-size: 20rpx;
  opacity: 0.85;
  margin-left: 2rpx;
}

.bb-switch {
  margin-left: 20rpx;
  font-size: 22rpx;
  padding: 8rpx 16rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.2);
}
</style>
