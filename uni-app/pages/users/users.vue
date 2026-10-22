<template>
<view class="page-body">

  <view class="card">
    <view class="card-header">
      <view class="card-title">操作员账户</view>
      <view class="card-more" @tap="onAddOpen">＋ 新增</view>
    </view>
    <view class="card-sub">账号、角色与密码由后端账号库维护；角色决定可执行的操作，管理员可签发审批令牌。</view>

    <!-- 新增表单（内联，不用弹层） -->
    <view v-if="addOpen" class="form">
      <view class="form-title">新增账号</view>
      <view class="form-row">
        <text class="form-label">账号</text>
        <input class="form-input" :value="form.username" data-k="username" placeholder="登录用户名" @input="onFormInput" />
      </view>
      <view class="form-row">
        <text class="form-label">姓名</text>
        <input class="form-input" :value="form.name" data-k="name" placeholder="选填，用于审计留痕" @input="onFormInput" />
      </view>
      <view class="form-row">
        <text class="form-label">初始密码</text>
        <input class="form-input" :value="form.password" data-k="password" password placeholder="至少 6 位" @input="onFormInput" />
      </view>
      <view class="form-row">
        <text class="form-label">角色</text>
        <view class="chip-row">
          <view v-for="(item, index) in roleOptions" :key="item.key" :class="'chip ' + (form.role === item.key ? 'chip-on' : '')" :data-key="item.key" @tap="onPickRole">{{item.name}}</view>
        </view>
      </view>
      <view class="btn-row">
        <view :class="'btn-primary ' + (busy ? 'btn-busy' : '')" @tap="onCreate">确定新增</view>
        <view class="btn-ghost" @tap="onAddClose">取消</view>
      </view>
    </view>

    <view v-if="loading" class="empty">加载中…</view>
    <view v-if="error" class="api-err">{{error}}</view>
    <view v-if="!loading && !error && !list.length" class="empty">还没有账号，点右上角「新增」</view>

    <view v-for="(u, index) in list" :key="u.id" class="u-item">
      <view class="u-main">
        <view class="u-name">
          {{u.name || u.username}}
          <text :class="'badge ' + (u.role === 'admin' ? 'badge-orange' : 'badge-blue')">{{u.roleText}}</text>
          <text v-if="u.disabled" class="badge badge-gray">已禁用</text>
        </view>
        <view class="u-meta">{{u.username}}<text v-if="u.phone"> · {{u.phone}}</text></view>
      </view>
      <view class="u-act">
        <text class="u-btn" :data-id="u.id" @tap="onResetPwd">重置密码</text>
        <text :class="'u-btn ' + (u.disabled ? 'u-btn-on' : 'u-btn-off')" :data-id="u.id" :data-disabled="u.disabled" @tap="onToggleDisabled">{{u.disabled ? '启用' : '禁用'}}</text>
      </view>
    </view>
  </view>

  <view class="tip">管理员账号一般由后端初始化，前端只管理操作员与观察员；所有变更由服务端落库留痕。</view>
</view>
</template>

<script>
import { mpPage } from '@/utils/uni-shim.js'
/**
 * pages/users —— 操作员账户管理（仅管理员）
 * 账号、角色、密码全部由后端账号库维护；本页只做增改与禁用。
 * ⚠️ 字段映射见 utils/auth.js 的 normalizeUser，后端文档定稿后只改那里。
 */
import * as auth from '@/utils/auth.js'

/** 可分配的角色（管理员账号一般由后端初始化，前端不再新建管理员） */
const ROLE_OPTIONS = [
  { key: 'operator', name: '操作员' },
  { key: 'viewer', name: '观察员' },
]

function decorate(u) {
  return Object.assign({}, u, {
    roleText: u.roleText || (u.role === 'admin' ? '管理员' : u.role === 'operator' ? '操作员' : '观察员'),
    disabledText: u.disabled ? '已禁用' : '正常',
  })
}

export default mpPage({
  data: {
    loading: true,
    error: '',
    list: [],
    roleOptions: ROLE_OPTIONS,
    addOpen: false,
    form: { username: '', name: '', password: '', role: 'operator' },
    busy: false,
  },

  onLoad() {
    this.refresh()
  },

  onPullDownRefresh() {
    this.refresh()
    uni.stopPullDownRefresh()
  },

  refresh() {
    if (!auth.isLoggedIn()) {
      this.setData({ loading: false, error: '未登录：请先以管理员账号登录', list: [] })
      return
    }
    if (!auth.isAdmin()) {
      this.setData({ loading: false, error: '仅管理员可以管理操作员账户', list: [] })
      return
    }
    this.setData({ loading: true, error: '' })
    auth.listUsers().then((res) => {
      if (!res.ok) {
        this.setData({ loading: false, error: res.message || '读取账号失败', list: [] })
        return
      }
      this.setData({ loading: false, error: '', list: res.users.map(decorate) })
    })
  },

  /* ---------------- 新增 ---------------- */
  onAddOpen() {
    if (!auth.isAdmin()) {
      uni.showToast({ title: '仅管理员可新增账号', icon: 'none' })
      return
    }
    this.setData({ addOpen: true, form: { username: '', name: '', password: '', role: 'operator' } })
  },

  onAddClose() {
    this.setData({ addOpen: false })
  },

  onFormInput(e) {
    const k = e.currentTarget.dataset.k
    const form = Object.assign({}, this.form)
    form[k] = e.detail.value
    this.setData({ form: form })
  },

  onPickRole(e) {
    const form = Object.assign({}, this.form)
    form.role = e.currentTarget.dataset.key
    this.setData({ form: form })
  },

  onCreate() {
    const f = this.form
    if (!String(f.username || '').trim()) { uni.showToast({ title: '请输入账号', icon: 'none' }); return }
    if (String(f.password || '').length < 6) { uni.showToast({ title: '密码至少 6 位', icon: 'none' }); return }
    if (this.busy) return
    this.setData({ busy: true })
    auth.createUser(f).then((res) => {
      this.setData({ busy: false })
      if (!res.ok) {
        uni.showToast({ title: res.message || '新增失败', icon: 'none' })
        return
      }
      uni.showToast({ title: '已添加', icon: 'success' })
      this.setData({ addOpen: false })
      this.refresh()
    })
  },

  /* ---------------- 改资料 ---------------- */
  onResetPwd(e) {
    const id = e.currentTarget.dataset.id
    uni.showModal({
      title: '重置密码',
      editable: true,
      placeholderText: '输入新密码（至少 6 位）',
      success: (r) => {
        if (!r.confirm) return
        const pwd = String(r.content || '').trim()
        if (pwd.length < 6) {
          uni.showToast({ title: '密码至少 6 位', icon: 'none' })
          return
        }
        auth.resetPassword(id, pwd).then((res) => {
          uni.showToast({ title: res.ok ? '已重置' : (res.message || '重置失败'), icon: res.ok ? 'success' : 'none' })
        })
      },
    })
  },

  onToggleDisabled(e) {
    const id = e.currentTarget.dataset.id
    const disabled = !!e.currentTarget.dataset.disabled
    const word = disabled ? '启用' : '禁用'
    uni.showModal({
      title: word + '账号',
      content: '确定要' + word + '这个账号吗？' + (disabled ? '' : '禁用后该账号将无法登录。'),
      success: (r) => {
        if (!r.confirm) return
        auth.updateUser(id, { disabled: !disabled }).then((res) => {
          uni.showToast({ title: res.ok ? ('已' + word) : (res.message || '操作失败'), icon: res.ok ? 'success' : 'none' })
          if (res.ok) this.refresh()
        })
      },
    })
  },

  onBack() {
    uni.navigateBack()
  },
})
</script>

<style>
/* users.wxss（与原生小程序工程逐字节一致） */
/* pages/users 操作员账户管理 */
page {
  background: #f4f6f9;
}

.page-body {
  padding: 24rpx;
}

/* ---------- 新增表单 ---------- */
.form {
  margin: 20rpx 0 8rpx;
  padding: 24rpx;
  background: #f7f9fc;
  border: 2rpx solid #eef2f8;
  border-radius: 20rpx;
}

.form-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #1f2b3d;
  margin-bottom: 16rpx;
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

.form-input {
  flex: 1;
  height: 76rpx;
  padding: 0 20rpx;
  box-sizing: border-box;
  background: #fff;
  border: 2rpx solid #eef2f8;
  border-radius: 14rpx;
  font-size: 28rpx;
  color: #1f2b3d;
}

.btn-busy {
  opacity: 0.6;
}

/* ---------- 账号行 ---------- */
.u-item {
  display: flex;
  align-items: center;
  padding: 22rpx 0;
  border-top: 2rpx solid #f2f5fa;
}

.u-main {
  flex: 1;
  min-width: 0;
}

.u-name {
  font-size: 28rpx;
  color: #1f2b3d;
  font-weight: 600;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.u-name .badge {
  margin-left: 10rpx;
}

.u-meta {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #8b95a7;
}

.u-act {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  margin-left: 16rpx;
}

.u-btn {
  font-size: 24rpx;
  color: #3d6df2;
  padding: 8rpx 4rpx;
}

.u-btn-off {
  color: #ef4444;
}

.u-btn-on {
  color: #10b981;
}
</style>
