<script>
/**
 * app.js —— 全局入口
 * 启动模拟引擎（utils/engine.js 全局定时器），各页面只订阅、不各自起定时器，
 * 保证看板 / 曲线 / 告警 / 控制各页看到的是同一时刻的同一份状态。
 */

import * as data from '@/utils/data.js'
import * as engine from '@/utils/engine.js'
import * as live from '@/utils/live.js'

export default {
  globalData: {
    /** 当前蚕房 key，如 barn01（规格书 1.6） */
    currentBarn: '',
    /** 当前角色：admin / operator / viewer（规格书 2.4、11.5） */
    role: 'admin',
  },

  onLaunch() {
    const b = data.getCurrentBarn()
    this.globalData.currentBarn = b ? b.barn : ''
    this.globalData.role = data.getState().role
    engine.start()
    // 已登录 = 实时数据：轮询 barn-api 的 realtime / alarms，写入 data.js 实机覆盖层；
    // 未登录 = 演示模式：页面读本机模拟引擎，不发任何网络请求。
    if (live.enabled() && this.globalData.currentBarn) live.start(this.globalData.currentBarn)
  },

  onShow() {
    engine.start()
    if (live.enabled() && this.globalData.currentBarn) live.start(this.globalData.currentBarn)
  },

  onHide() {
    engine.stop()
    live.stop()
  },

  onError(err) {
    console.error('[app error]', err)
  },
}
</script>

<style>
/* app.wxss（与原生小程序工程逐字节一致） */
/* app.wxss —— 全局样式（配色沿用养蚕设备管理系统：主蓝 #3d6df2 / 绿 #047857 / 橙 #b45309 / 红 #b3261e） */

page {
  background: #f4f6f9;
  font-size: 28rpx;
  color: #1f2937;
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  line-height: 1.5;
}

.page-body {
  padding-bottom: 40rpx;
}

/* ---------------- 卡片 ---------------- */
.card {
  background: #ffffff;
  border-radius: 20rpx;
  padding: 24rpx;
  margin: 20rpx 24rpx;
  box-shadow: 0 4rpx 16rpx rgba(61, 109, 242, 0.06);
}

.card-header {
  display: flex;
  align-items: center;
  margin-bottom: 16rpx;
}

.card-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #1f2937;
}

.card-sub {
  font-size: 24rpx;
  color: #6b7280;
  margin-left: 12rpx;
}

.card-more {
  margin-left: auto;
  font-size: 26rpx;
  color: #3d6df2;
  /* 视觉上仍是一行小字，热区撑到 88rpx */
  padding: 26rpx 0 26rpx 24rpx;
  margin-top: -26rpx;
  margin-bottom: -26rpx;
}

.divider {
  height: 1rpx;
  background: #eef2f8;
  margin: 16rpx 0;
}

/* ---------------- 徽标 / 圆点 ---------------- */
.badge {
  display: inline-block;
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  font-size: 24rpx;
  line-height: 36rpx;
}

.badge-blue { background: rgba(61, 109, 242, 0.12); color: #3d6df2; }
.badge-green { background: rgba(16, 185, 129, 0.12); color: #047857; }
.badge-orange { background: rgba(245, 158, 11, 0.14); color: #b45309; }
.badge-red { background: rgba(239, 68, 68, 0.12); color: #b3261e; }
.badge-gray { background: rgba(139, 149, 167, 0.14); color: #6b7280; }

.dot {
  display: inline-block;
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  margin-right: 8rpx;
  vertical-align: middle;
}

.dot-green { background: #047857; }
.dot-orange { background: #b45309; }
.dot-red { background: #b3261e; }
.dot-gray { background: #c3cbd8; }
.dot-blue { background: #3d6df2; }

/* 控制模式配色（规格书 7.2，与 spec.MODES.tone 对应） */
.mode-green { background: rgba(16, 185, 129, 0.12); color: #047857; }
.mode-orange { background: rgba(245, 158, 11, 0.14); color: #b45309; }
.mode-blue { background: rgba(61, 109, 242, 0.12); color: #3d6df2; }
.mode-red { background: rgba(239, 68, 68, 0.12); color: #b3261e; }
.mode-gray { background: rgba(139, 149, 167, 0.14); color: #6b7280; }

/* ---------------- 按钮 ---------------- */
.btn-primary {
  background: #3d6df2;
  color: #ffffff;
  border-radius: 999rpx;
  text-align: center;
  font-size: 28rpx;
  font-weight: 600;
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 32rpx;
  border: none;
  box-sizing: border-box;
}

.btn-primary::after { border: none; }

.btn-ghost {
  background: #ffffff;
  color: #3d6df2;
  border: 1rpx solid rgba(61, 109, 242, 0.4);
  border-radius: 999rpx;
  text-align: center;
  font-size: 28rpx;
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 28rpx;
  box-sizing: border-box;
}

.btn-ghost::after { border: none; }

.btn-danger {
  background: rgba(179, 38, 30, 0.06);
  color: #b3261e;
  border: 1rpx solid rgba(179, 38, 30, 0.4);
  border-radius: 999rpx;
  text-align: center;
  font-size: 28rpx;
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 28rpx;
  box-sizing: border-box;
}

.btn-danger::after { border: none; }

.btn-disabled {
  background: #eef1f6 !important;
  color: #5b6474 !important;
  border-color: #e2e7ef !important;
}

.btn-row {
  display: flex;
  gap: 20rpx;
  margin: 20rpx 24rpx;
}

.btn-row .btn-primary,
.btn-row .btn-ghost,
.btn-row .btn-danger {
  flex: 1;
}

/* ---------------- 键值行 / 网格 ---------------- */
.kv-row {
  display: flex;
  align-items: center;
  padding: 14rpx 0;
}

.kv-label {
  font-size: 26rpx;
  color: #6b7280;
}

.kv-value {
  margin-left: auto;
  font-size: 26rpx;
  color: #1f2937;
  font-weight: 500;
}

.kv-grid {
  display: flex;
  flex-wrap: wrap;
}

.kv-grid .kv-item {
  width: 50%;
  padding: 12rpx 0;
  box-sizing: border-box;
}

.kv-item .kv-item-label {
  font-size: 24rpx;
  color: #6b7280;
}

.kv-item .kv-item-value {
  font-size: 30rpx;
  font-weight: 600;
  color: #1f2937;
  margin-top: 4rpx;
}

.kv-item .kv-item-unit {
  font-size: 24rpx;
  font-weight: 400;
  color: #6b7280;
  margin-left: 4rpx;
}

/* ---------------- 统计块 ---------------- */
.stat-grid {
  display: flex;
  flex-wrap: wrap;
}

.stat-tile {
  width: 25%;
  text-align: center;
  padding: 10rpx 0;
}

.stat-tile.half { width: 50%; }

.stat-value {
  font-size: 40rpx;
  font-weight: 700;
  line-height: 1.2;
}

.stat-label {
  font-size: 24rpx;
  color: #6b7280;
  margin-top: 4rpx;
}

/* ---------------- 选择芯片 ---------------- */
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 88rpx;
  box-sizing: border-box;
  padding: 0 30rpx;
  border-radius: 999rpx;
  background: #f4f6f9;
  color: #4b5563;
  font-size: 26rpx;
}

.chip-on {
  background: rgba(61, 109, 242, 0.12);
  color: #3d6df2;
  font-weight: 600;
}

.chip-scroll {
  white-space: nowrap;
  margin-bottom: 8rpx;
}

.chip-scroll .chip {
  display: inline-flex;
  margin-right: 16rpx;
}

/* ---------------- 进度条 ---------------- */
.bar {
  height: 12rpx;
  border-radius: 999rpx;
  background: #eef2f8;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  border-radius: 999rpx;
}

/* ---------------- 列表 ---------------- */
.list-item {
  display: flex;
  align-items: center;
  padding: 20rpx 0;
  border-bottom: 1rpx solid #f2f5fa;
}

.list-item:last-child { border-bottom: none; }

.list-main {
  flex: 1;
  min-width: 0;
}

.list-name {
  font-size: 28rpx;
  color: #1f2937;
  font-weight: 500;
}

.list-meta {
  font-size: 24rpx;
  color: #6b7280;
  margin-top: 4rpx;
}

.list-tail {
  margin-left: 16rpx;
  text-align: right;
}

/* ---------------- 头部渐变 hero ---------------- */
.hero {
  background: linear-gradient(135deg, #1f4fd0 0%, #3d6df2 100%);
  padding: 32rpx 32rpx 40rpx;
  color: #ffffff;
}

.hero-title {
  font-size: 34rpx;
  font-weight: 600;
}

.hero-sub {
  font-size: 24rpx;
  opacity: 0.85;
  margin-top: 6rpx;
}

.hero-metrics {
  display: flex;
  margin-top: 28rpx;
}

.hero-metric {
  flex: 1;
}

.hero-metric-value {
  font-size: 46rpx;
  font-weight: 700;
  line-height: 1.1;
}

.hero-metric-label {
  font-size: 24rpx;
  opacity: 0.85;
  margin-top: 4rpx;
}

/* ---------------- 其它 ---------------- */
.empty {
  text-align: center;
  color: #6b7280;
  font-size: 26rpx;
  padding: 60rpx 0;
}

.section-title {
  font-size: 26rpx;
  color: #6b7280;
  margin: 24rpx 24rpx 8rpx;
}

.tip {
  font-size: 24rpx;
  color: #6b7280;
  line-height: 1.6;
}

.tag-solid {
  display: inline-block;
  padding: 4rpx 16rpx;
  border-radius: 8rpx;
  font-size: 24rpx;
  color: #ffffff;
}

.mono {
  font-family: "SF Mono", Consolas, Menlo, monospace;
}

.text-warn { color: #b45309; }
.text-danger { color: #b3261e; }
.text-ok { color: #047857; }
.text-primary { color: #3d6df2; }
.text-sub { color: #6b7280; }
</style>
