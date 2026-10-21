<template>
<!-- components/skeleton/skeleton.wxml —— 骨架屏占位块（卡片风格与全局 .card 一致） -->
<view class="sk-wrap">
  <view v-if="hero" class="sk-hero">
    <view class="sk-bar sk-bar-title w60"></view>
    <view class="sk-bar sk-bar-sub w40"></view>
  </view>

  <view v-for="(item, index) in rowList" :key="item" class="sk-card">
    <view class="sk-head">
      <view class="sk-bar w40"></view>
      <view class="sk-pill"></view>
    </view>
    <view class="sk-bar w90"></view>
    <view class="sk-bar w70"></view>
    <view class="sk-nums">
      <view class="sk-num"></view>
      <view class="sk-num"></view>
    </view>
  </view>
</view>
</template>

<script>
import { mpComponent } from '@/utils/uni-shim.js'
/**
 * components/skeleton —— 通用骨架屏（加载态占位）
 * 用法：<skeleton wx:if="{{loading}}" rows="3" /> / <skeleton wx:if="{{loading}}" rows="4" hero="true" />
 * rows 会收敛到 1~6，避免传入异常值时渲染出过多占位卡片。
 */
export default mpComponent({
  properties: {
    rows: { type: Number, value: 3 },
    hero: { type: Boolean, value: false },
  },
  data: { rowList: [0, 1, 2] },
  observers: {},
  lifetimes: {
    attached() {
      const n = Math.max(1, Math.min(6, Number(this.rows) || 3))
      const list = []
      for (let i = 0; i < n; i++) list.push(i)
      this.setData({ rowList: list })
    },
  },
})
</script>

<style>
/* skeleton.wxss（与原生小程序工程逐字节一致） */
/* components/skeleton/skeleton.wxss —— 骨架屏样式：白底卡片 + 淡灰占位块 + 流光动画 */

.sk-wrap {
  display: block;
}

/* 顶部头图占位（hero=true 时才渲染） */
.sk-hero {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 28rpx;
  margin: 24rpx;
  box-shadow: 0 4rpx 16rpx rgba(61, 109, 242, 0.06);
}

.sk-card {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 28rpx;
  margin: 24rpx;
  box-shadow: 0 4rpx 16rpx rgba(61, 109, 242, 0.06);
}

.sk-card + .sk-card {
  margin-top: 20rpx;
}

/* 标题行：标题占位 + 右侧徽标占位 */
.sk-head {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16rpx;
}

.sk-bar {
  background: #eef2f8;
  border-radius: 8rpx;
  height: 28rpx;
}

.sk-bar + .sk-bar {
  margin-top: 16rpx;
}

.sk-bar-title {
  height: 36rpx;
}

.sk-bar-sub {
  height: 24rpx;
}

.sk-pill {
  background: #eef2f8;
  border-radius: 999rpx;
  height: 32rpx;
  width: 96rpx;
}

/* 数值块（两个并排） */
.sk-nums {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-top: 20rpx;
}

.sk-num {
  background: #eef2f8;
  border-radius: 8rpx;
  height: 56rpx;
  width: 40%;
}

/* 宽度类 */
.w40 {
  width: 40%;
}

.w60 {
  width: 60%;
}

.w70 {
  width: 70%;
}

.w90 {
  width: 90%;
}

/* 流光动画：呼吸式明暗变化 */
@keyframes skShimmer {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
  100% {
    opacity: 1;
  }
}

.sk-bar,
.sk-pill,
.sk-num {
  animation: skShimmer 1.4s ease-in-out infinite;
}
</style>
