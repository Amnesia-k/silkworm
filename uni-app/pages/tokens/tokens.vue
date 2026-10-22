<template>
<view class="page-body">

  <view class="card">
    <view class="card-header">
      <view class="card-title">签发审批令牌</view>
      <view class="card-more">5 分钟 · 单次</view>
    </view>
    <view class="card-sub">操作员执行手动控制或手动改机械参数时，必须持有管理员签发的 ACTION_TOKEN；令牌只对选中的设备与动作有效。</view>

    <view class="form">
      <view class="form-row">
        <text class="form-label">作用设备</text>
        <picker mode="selector" :range="targets" range-key="name" :value="targetIdx" @change="onPickTarget">
          <view class="form-pick">{{targetName || '选择设备'}}</view>
        </picker>
      </view>
      <view class="form-row">
        <text class="form-label">备注</text>
        <input class="form-input" :value="memo" placeholder="选填，例如「投叶漏斗补料」" @input="onMemoInput" />
      </view>
      <view class="btn-row">
        <view :class="'btn-primary ' + (busy ? 'btn-busy' : '')" @tap="onIssue">签发令牌</view>
      </view>
    </view>
  </view>

  <view class="card">
    <view class="card-header">
      <view class="card-title">最近令牌</view>
      <view class="card-more" @tap="refresh">刷新</view>
    </view>

    <view v-if="loading" class="empty">加载中…</view>
    <view v-if="error" class="api-err">{{error}}</view>
    <view v-if="!loading && !error && !list.length" class="empty">还没有签发过令牌</view>

    <view v-for="(t, index) in list" :key="t.id" class="t-item">
      <view class="t-main">
        <view class="t-target">{{t.target}} <text :class="'badge badge-' + (t.tone)">{{t.stateText}}</text></view>
        <view class="t-meta">到期 {{t.expireText}}<text v-if="t.memo"> · {{t.memo}}</text></view>
        <view class="t-id mono">{{t.id}}</view>
      </view>
      <view class="t-act">
        <text v-if="!t.used && !t.revoked" class="t-btn" :data-id="t.id" @tap="onRevoke">撤销</text>
      </view>
    </view>
  </view>

  <view class="tip">令牌由服务端落库与校验；使用后自动作废，管理员也可手动撤销。</view>
</view>
</template>

<script>
import { mpPage } from '@/utils/uni-shim.js'
/**
 * pages/tokens —— 审批令牌（ACTION_TOKEN）签发与撤销（仅管理员）
 * 用途：操作员执行手动控制/手动改机械参数时，必须持有管理员签发的令牌（5 min 单次有效）。
 * ⚠️ 令牌的落库与校验在服务端；前端只负责签发/撤销与展示（字段映射见 utils/auth.js normalizeToken）。
 */
import * as auth from '@/utils/auth.js'
import * as data from '@/utils/data.js'

function pad(n) { return n < 10 ? '0' + n : '' + n }

function timeText(ms) {
  if (!ms) return '--'
  const d = new Date(ms)
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

function decorate(t) {
  const left = t.expireAt ? Math.max(0, Math.round((t.expireAt - Date.now()) / 1000)) : 0
  let stateText = '有效'
  let tone = 'green'
  if (t.revoked) { stateText = '已撤销'; tone = 'gray' }
  else if (t.used) { stateText = '已使用'; tone = 'gray' }
  else if (t.expireAt && left <= 0) { stateText = '已过期'; tone = 'gray' }
  else if (left > 0) { stateText = '有效 ' + Math.floor(left / 60) + ' 分 ' + (left % 60) + ' 秒'; tone = left < 60 ? 'orange' : 'green' }
  return Object.assign({}, t, {
    stateText: stateText,
    tone: tone,
    expireText: timeText(t.expireAt),
  })
}

export default mpPage({
  data: {
    loading: true,
    error: '',
    list: [],
    targets: [],
    targetIdx: 0,
    targetName: '',
    memo: '',
    busy: false,
  },

  onLoad() {
    this.loadTargets()
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh()
    uni.stopPullDownRefresh()
  },

  /** 可签发令牌的目标：当前蚕房的全部设备 + 机械 */
  loadTargets() {
    const barn = data.getCurrentBarn()
    if (!barn) {
      this.setData({ targets: [], targetName: '' })
      return
    }
    const devs = data.getDevices(barn.barn) || []
    const machines = data.getMachines(barn.barn) || []
    const targets = devs.map((d) => ({ id: d.id, name: d.name, kind: '设备' }))
      .concat(machines.map((m) => ({ id: m.id, name: m.name, kind: '机械' })))
    this.setData({
      targets: targets,
      targetName: targets.length ? (targets[0].name + '（' + targets[0].kind + '）') : '',
    })
  },

  refresh() {
    if (!auth.isLoggedIn()) {
      this.setData({ loading: false, error: '未登录：请先以管理员账号登录', list: [] })
      return
    }
    if (!auth.isAdmin()) {
      this.setData({ loading: false, error: '仅管理员可以签发审批令牌', list: [] })
      return
    }
    this.setData({ loading: true, error: '' })
    auth.listTokens().then((res) => {
      if (!res.ok) {
        this.setData({ loading: false, error: res.message || '读取令牌失败', list: [] })
        return
      }
      this.setData({ loading: false, error: '', list: res.tokens.map(decorate) })
    })
  },

  onPickTarget(e) {
    const idx = parseInt(e.detail.value, 10) || 0
    const t = this.targets[idx]
    this.setData({ targetIdx: idx, targetName: t ? (t.name + '（' + t.kind + '）') : '' })
  },

  onMemoInput(e) {
    this.setData({ memo: e.detail.value })
  },

  onIssue() {
    if (this.busy) return
    const t = this.targets[this.targetIdx]
    if (!t) {
      uni.showToast({ title: '请先选择设备', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    auth.issueToken({ target: t.id, action: 'manual', memo: this.memo }).then((res) => {
      this.setData({ busy: false })
      if (!res.ok) {
        uni.showToast({ title: res.message || '签发失败', icon: 'none' })
        return
      }
      this.setData({ memo: '' })
      uni.showToast({ title: '已签发，5 分钟内单次有效', icon: 'success' })
      this.refresh()
    })
  },

  onRevoke(e) {
    const id = e.currentTarget.dataset.id
    uni.showModal({
      title: '撤销令牌',
      content: '撤销后该令牌立即失效，操作员将无法用它执行手动操作。',
      success: (r) => {
        if (!r.confirm) return
        auth.revokeToken(id).then((res) => {
          uni.showToast({ title: res.ok ? '已撤销' : (res.message || '撤销失败'), icon: res.ok ? 'success' : 'none' })
          if (res.ok) this.refresh()
        })
      },
    })
  },
})
</script>

<style>
/* tokens.wxss（与原生小程序工程逐字节一致） */
/* pages/tokens 审批令牌 */
page {
  background: #f4f6f9;
}

.page-body {
  padding: 24rpx;
}

/* ---------- 表单 ---------- */
.form {
  margin: 20rpx 0 8rpx;
  padding: 24rpx;
  background: #f7f9fc;
  border: 2rpx solid #eef2f8;
  border-radius: 20rpx;
}

.form-row {
  display: flex;
  align-items: center;
  margin-bottom: 16rpx;
}

.form-label {
  width: 150rpx;
  font-size: 26rpx;
  color: #5b6577;
  flex-shrink: 0;
}

.form-input,
.form-pick {
  flex: 1;
  height: 76rpx;
  line-height: 76rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  background: #fff;
  border: 2rpx solid #eef2f8;
  border-radius: 14rpx;
  font-size: 28rpx;
  color: #1f2b3d;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.btn-busy {
  opacity: 0.6;
}

/* ---------- 令牌行 ---------- */
.t-item {
  display: flex;
  align-items: flex-start;
  padding: 22rpx 0;
  border-top: 2rpx solid #f2f5fa;
}

.t-main {
  flex: 1;
  min-width: 0;
}

.t-target {
  font-size: 28rpx;
  color: #1f2b3d;
  font-weight: 600;
}

.t-target .badge {
  margin-left: 10rpx;
  font-weight: 400;
}

.t-meta {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #8b95a7;
}

.t-id {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #b8c0ce;
  word-break: break-all;
}

.t-act {
  margin-left: 16rpx;
}

.t-btn {
  font-size: 24rpx;
  color: #ef4444;
  padding: 8rpx 4rpx;
}
</style>
