<script>
/**
 * app.js —— 全局入口
 * 启动模拟引擎（utils/engine.js 全局定时器），各页面只订阅、不各自起定时器，
 * 保证看板 / 曲线 / 告警 / 控制各页看到的是同一时刻的同一份状态。
 */

import * as data from '@/utils/data.js'
import * as engine from '@/utils/engine.js'
import * as gateway from '@/utils/gateway.js'

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
    // 实机对接（预留）：默认 sim 模式下 start() 直接返回 false，不发起任何网络请求；
    // 切到 live 后按配置走 WebSocket 推送或 HTTP 轮询，数据写入 utils/data.js 的实机覆盖层。
    gateway.start()
  },

  onShow() {
    engine.start()
    gateway.start()
  },

  onHide() {
    engine.stop()
    gateway.stop()
  },

  onError(err) {
    console.error('[app error]', err)
  },
}
</script>

<style>
/* app.wxss（与原生小程序工程逐字节一致） */
/* app.wxss —— 全局样式（配色沿用养蚕设备管理系统：主蓝 #3d6df2 / 绿 #10b981 / 橙 #f59e0b / 红 #ef4444） */

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
  font-size: 22rpx;
  color: #8b95a7;
  margin-left: 12rpx;
}

.card-more {
  margin-left: auto;
  font-size: 24rpx;
  color: #3d6df2;
}

.divider {
  height: 1rpx;
  background: #eef2f8;
  margin: 16rpx 0;
}

/* ---------------- 徽标 / 圆点 ---------------- */
.badge {
  display: inline-block;
  padding: 2rpx 14rpx;
  border-radius: 999rpx;
  font-size: 20rpx;
  line-height: 32rpx;
}

.badge-blue { background: rgba(61, 109, 242, 0.12); color: #3d6df2; }
.badge-green { background: rgba(16, 185, 129, 0.12); color: #10b981; }
.badge-orange { background: rgba(245, 158, 11, 0.14); color: #f59e0b; }
.badge-red { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
.badge-gray { background: rgba(139, 149, 167, 0.14); color: #8b95a7; }

.dot {
  display: inline-block;
  width: 14rpx;
  height: 14rpx;
  border-radius: 50%;
  margin-right: 8rpx;
  vertical-align: middle;
}

.dot-green { background: #10b981; }
.dot-orange { background: #f59e0b; }
.dot-red { background: #ef4444; }
.dot-gray { background: #c3cbd8; }
.dot-blue { background: #3d6df2; }

/* 控制模式配色（规格书 7.2，与 spec.MODES.tone 对应） */
.mode-green { background: rgba(16, 185, 129, 0.12); color: #10b981; }
.mode-orange { background: rgba(245, 158, 11, 0.14); color: #f59e0b; }
.mode-blue { background: rgba(61, 109, 242, 0.12); color: #3d6df2; }
.mode-red { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
.mode-gray { background: rgba(139, 149, 167, 0.14); color: #8b95a7; }

/* ---------------- 按钮 ---------------- */
.btn-primary {
  background: linear-gradient(135deg, #3d6df2 0%, #5b8cff 100%);
  color: #ffffff;
  border-radius: 999rpx;
  text-align: center;
  font-size: 28rpx;
  padding: 20rpx 0;
  border: none;
}

.btn-primary::after { border: none; }

.btn-ghost {
  background: #ffffff;
  color: #3d6df2;
  border: 1rpx solid rgba(61, 109, 242, 0.4);
  border-radius: 999rpx;
  text-align: center;
  font-size: 28rpx;
  padding: 18rpx 0;
}

.btn-ghost::after { border: none; }

.btn-danger {
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
  border: 1rpx solid rgba(239, 68, 68, 0.35);
  border-radius: 999rpx;
  text-align: center;
  font-size: 28rpx;
  padding: 18rpx 0;
}

.btn-danger::after { border: none; }

.btn-disabled {
  background: #eef1f6 !important;
  color: #a8b1c0 !important;
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
  color: #8b95a7;
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
  font-size: 22rpx;
  color: #8b95a7;
}

.kv-item .kv-item-value {
  font-size: 30rpx;
  font-weight: 600;
  color: #1f2937;
  margin-top: 4rpx;
}

.kv-item .kv-item-unit {
  font-size: 22rpx;
  font-weight: 400;
  color: #8b95a7;
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
  font-size: 22rpx;
  color: #8b95a7;
  margin-top: 4rpx;
}

/* ---------------- 选择芯片 ---------------- */
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.chip {
  padding: 10rpx 26rpx;
  border-radius: 999rpx;
  background: #f4f6f9;
  color: #5b6474;
  font-size: 24rpx;
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
  display: inline-block;
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
  font-size: 22rpx;
  color: #8b95a7;
  margin-top: 4rpx;
}

.list-tail {
  margin-left: 16rpx;
  text-align: right;
}

/* ---------------- 头部渐变 hero ---------------- */
.hero {
  background: linear-gradient(135deg, #3d6df2 0%, #5b8cff 60%, #7aa2ff 100%);
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
  font-size: 22rpx;
  opacity: 0.85;
  margin-top: 4rpx;
}

/* ---------------- 其它 ---------------- */
.empty {
  text-align: center;
  color: #a8b1c0;
  font-size: 26rpx;
  padding: 60rpx 0;
}

.section-title {
  font-size: 26rpx;
  color: #8b95a7;
  margin: 24rpx 24rpx 8rpx;
}

.tip {
  font-size: 22rpx;
  color: #a8b1c0;
  line-height: 1.6;
}

.tag-solid {
  display: inline-block;
  padding: 4rpx 16rpx;
  border-radius: 8rpx;
  font-size: 22rpx;
  color: #ffffff;
}

.mono {
  font-family: "SF Mono", Consolas, Menlo, monospace;
}

.text-warn { color: #f59e0b; }
.text-danger { color: #ef4444; }
.text-ok { color: #10b981; }
.text-primary { color: #3d6df2; }
.text-sub { color: #8b95a7; }
</style>
