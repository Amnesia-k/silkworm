<template>
<view v-if="show" :class="'sbar ' + (tone)" :data-from="from" @tap="onTap">
  <view class="sbar-main">
    <view class="sbar-title">{{title}}</view>
    <view class="sbar-detail">{{detail}}</view>
  </view>
  <view class="sbar-act">{{act}}</view>
</view>
</template>

<script>
import { mpComponent } from '@/utils/uni-shim.js'
/**
 * components/safety-bar —— 全局安全状态条
 * 只在「安全锁定 / 离线自治 / 传感器失效」时出现，压在页面最顶部。
 * 这三件事都不该藏在徽标或脚注里：蚕房已经断电或失联时，用户第一眼必须看到。
 */

import * as data from '@/utils/data.js'
import * as engine from '@/utils/engine.js'

export default mpComponent({
  properties: {
    /** 来源页（预留，便于后续埋点或回跳） */
    from: { type: String, value: '' },
  },

  data: {
    show: false,
    tone: '',
    title: '',
    detail: '',
    act: '处理 ›',
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
        if (this.show) this.setData({ show: false })
        return
      }
      const s = data.getStatusSummary(b.barn)
      let patch = { show: false, tone: '', title: '', detail: '', act: '处理 ›' }

      if (s.mode === 'safe_lock') {
        patch = {
          show: true,
          tone: 'red',
          title: '安全锁定 · 仅排气扇可运行',
          detail: (s.interlock && s.interlock.active && s.interlock.reason)
            ? s.interlock.reason
            : '温湿度触发硬限保护，加热与雾化已强制断电',
          act: '去解除 ›',
        }
      } else if (!s.online) {
        patch = {
          show: true,
          tone: 'slate',
          title: '离线自治' + (s.offlineText ? ' · 已 ' + s.offlineText : ''),
          detail: '与服务器失联，正按本地策略维持；设置与控制暂不可用',
          act: '查看 ›',
        }
      } else if (!s.sensorOk) {
        patch = {
          show: true,
          tone: 'amber',
          title: '传感器失效 · 已切强制通风',
          detail: '温湿度读数不可信，自动控制暂停，等待人工处理',
          act: '查看 ›',
        }
      }

      // 每 4 s 会刷新一次，内容没变就不 setData
      const sig = patch.show + '|' + patch.tone + '|' + patch.title + '|' + patch.detail
      if (sig === this._sig) return
      this._sig = sig
      this.setData(patch)
    },

    onTap() {
      uni.switchTab({ url: '/pages/control/control' })
    },
  },
})
</script>

<style>
/* safety-bar.wxss（与原生小程序工程逐字节一致） */
/* 全局安全状态条：白字压在深色实底上，对比度 ≥7:1 —— 蚕房里必须一眼看清 */
.sbar {
  display: flex;
  align-items: center;
  padding: 22rpx 32rpx;
}

.sbar.red { background: #8f1d14; }
.sbar.amber { background: #7a4f0e; }
.sbar.slate { background: #2f3540; }

.sbar-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #ffffff;
  line-height: 1.4;
}

.sbar-detail {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.5;
  margin-top: 6rpx;
}

.sbar-main {
  flex: 1;
  min-width: 0;
}

.sbar-act {
  flex-shrink: 0;
  margin-left: 20rpx;
  font-size: 26rpx;
  font-weight: 600;
  color: #ffffff;
  /* 撑到 88rpx 的点击高度，但用负外边距不让状态条变高 */
  padding: 26rpx 0 26rpx 20rpx;
  margin-top: -26rpx;
  margin-bottom: -26rpx;
}
</style>
