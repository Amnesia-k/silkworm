<template>
<view class="login-page">
  <view class="brand">
    <view class="brand-mark">蚕</view>
    <view class="brand-title">养蚕环境调控</view>
    <view class="brand-sub">账号登录 · 管理员 / 操作员</view>
  </view>

  <view class="login-card">
    <view class="field">
      <text class="field-label">账号</text>
      <input class="field-input" :value="user" placeholder="请输入账号" placeholder-class="ph" @input="onUserInput" cursor-spacing="24" />
    </view>

    <view class="field">
      <text class="field-label">密码</text>
      <view class="pwd-wrap">
        <input class="field-input pwd-input" :password="!pwdShow" :value="pwd" placeholder="请输入密码" placeholder-class="ph" @input="onPwdInput" cursor-spacing="24" confirm-type="go" @confirm="onLogin" />
        <text class="pwd-eye" @tap="onTogglePwd">{{pwdShow ? '隐藏' : '显示'}}</text>
      </view>
    </view>

    <view v-if="error" class="err">{{error}}</view>

    <view :class="'btn-login ' + (submitting ? 'btn-busy' : '')" @tap="onLogin">
      {{submitting ? '登录中…' : '登 录'}}
    </view>

    <view class="adv">
      <view class="adv-head" @tap="onToggleAdv">
        <text class="adv-title">服务器设置</text>
        <text class="adv-arrow">{{advOpen ? '收起' : '展开'}}</text>
      </view>
      <view v-if="advOpen" class="adv-body">
        <input class="field-input" :value="baseUrl" placeholder="http://10.66.66.1/api" placeholder-class="ph" @input="onBaseInput" />
        <view class="adv-act">
          <text class="adv-tip">含 /api，需先连 WireGuard 隧道</text>
          <text class="adv-save" @tap="onSaveBase">保存</text>
        </view>
      </view>
    </view>
  </view>

  <view v-if="!gate" class="skip" @tap="onSkip">后端未就绪？跳过登录，直接进入演示模式</view>

  <view class="foot">账号由后端账号库校验；管理员可签发操作令牌、管理操作员账户</view>
</view>
</template>

<script>
import { mpPage } from '@/utils/uni-shim.js'
/**
 * pages/login 登录页
 * 账号密码由后端账号库校验；登录成功后把角色写进 data.setRole()，
 * 全工程既有的权限矩阵（管理员 / 操作员 / 观察员）立即生效。
 */
import * as auth from '@/utils/auth.js'

export default mpPage({
  data: {
    loading: false,
    user: '',
    pwd: '',
    pwdShow: false,
    error: '',
    gate: false,
    advOpen: false,
    baseUrl: '',
    submitting: false,
  },

  onLoad() {
    const st = auth.getState()
    this.setData({
      gate: st.gate,
      baseUrl: st.baseUrl,
      user: st.lastUser || '',
    })
    // 已登录则直接进主流程（例如从「我的」里误点进来）
    if (auth.isLoggedIn()) this.goNext()
  },

  onUserInput(e) {
    this.setData({ user: e.detail.value, error: '' })
  },

  onPwdInput(e) {
    this.setData({ pwd: e.detail.value, error: '' })
  },

  onTogglePwd() {
    this.setData({ pwdShow: !this.pwdShow })
  },

  onToggleAdv() {
    this.setData({ advOpen: !this.advOpen })
  },

  onBaseInput(e) {
    this.setData({ baseUrl: e.detail.value })
  },

  onSaveBase() {
    const r = auth.setConfig({ baseUrl: this.baseUrl })
    if (!r.ok) {
      this.setData({ error: r.message })
      return
    }
    this.setData({ baseUrl: r.config.baseUrl, error: '' })
    uni.showToast({ title: '已保存', icon: 'success' })
  },

  onLogin() {
    if (this.submitting) return
    const u = String(this.user || '').trim()
    const p = String(this.pwd || '')
    if (!u) { this.setData({ error: '请输入账号' }); return }
    if (!p) { this.setData({ error: '请输入密码' }); return }
    this.setData({ submitting: true, loading: true, error: '' })
    auth.rememberUser(u)
    auth.login(u, p).then((res) => {
      this.setData({ submitting: false, loading: false })
      if (!res.ok) {
        this.setData({ error: res.message || '登录失败' })
        return
      }
      uni.showToast({ title: '登录成功', icon: 'success' })
      setTimeout(() => this.goNext(), 400)
    })
  },

  /** 演示模式：后端未就绪时直接进（gate 关闭时才显示入口） */
  onSkip() {
    uni.showToast({ title: '演示模式', icon: 'none' })
    setTimeout(() => this.goNext(), 300)
  },

  goNext() {
    uni.reLaunch({ url: '/pages/room-select/room-select' })
  },

  onPullDownRefresh() {
    uni.stopPullDownRefresh()
  },
})
</script>

<style>
/* login.wxss（与原生小程序工程逐字节一致） */
/* pages/login 登录页 */
page {
  background: #f4f6f9;
}

.login-page {
  min-height: 100vh;
  padding: 120rpx 48rpx 60rpx;
  box-sizing: border-box;
}

/* ---------- 品牌区 ---------- */
.brand {
  text-align: center;
  margin-bottom: 56rpx;
}

.brand-mark {
  width: 112rpx;
  height: 112rpx;
  line-height: 112rpx;
  margin: 0 auto 24rpx;
  border-radius: 32rpx;
  background: linear-gradient(135deg, #3d6df2, #5b86ff);
  color: #fff;
  font-size: 56rpx;
  font-weight: 700;
  box-shadow: 0 12rpx 32rpx rgba(61, 109, 242, 0.28);
}

.brand-title {
  font-size: 42rpx;
  font-weight: 700;
  color: #1f2b3d;
  letter-spacing: 1rpx;
}

.brand-sub {
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #8b95a7;
}

/* ---------- 卡片 ---------- */
.login-card {
  background: #fff;
  border-radius: 28rpx;
  padding: 40rpx 32rpx 24rpx;
  box-shadow: 0 8rpx 32rpx rgba(31, 43, 61, 0.06);
}

.field {
  margin-bottom: 32rpx;
}

.field-label {
  display: block;
  font-size: 26rpx;
  color: #5b6577;
  margin-bottom: 12rpx;
}

.field-input {
  width: 100%;
  height: 88rpx;
  padding: 0 24rpx;
  box-sizing: border-box;
  background: #f7f9fc;
  border: 2rpx solid #eef2f8;
  border-radius: 18rpx;
  font-size: 30rpx;
  color: #1f2b3d;
}

.ph {
  color: #b8c0ce;
}

.pwd-wrap {
  position: relative;
}

.pwd-input {
  padding-right: 110rpx;
}

.pwd-eye {
  position: absolute;
  right: 24rpx;
  top: 0;
  height: 88rpx;
  line-height: 88rpx;
  font-size: 24rpx;
  color: #3d6df2;
}

.err {
  margin: -8rpx 0 24rpx;
  padding: 16rpx 20rpx;
  background: #fef2f2;
  border-radius: 14rpx;
  color: #ef4444;
  font-size: 24rpx;
  line-height: 1.5;
}

.btn-login {
  height: 92rpx;
  line-height: 92rpx;
  text-align: center;
  border-radius: 20rpx;
  background: #3d6df2;
  color: #fff;
  font-size: 32rpx;
  font-weight: 600;
  letter-spacing: 2rpx;
  box-shadow: 0 10rpx 24rpx rgba(61, 109, 242, 0.28);
}

.btn-busy {
  opacity: 0.6;
}

/* ---------- 服务器设置 ---------- */
.adv {
  margin-top: 28rpx;
  border-top: 2rpx solid #eef2f8;
  padding-top: 20rpx;
}

.adv-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8rpx 0;
}

.adv-title {
  font-size: 26rpx;
  color: #8b95a7;
}

.adv-arrow {
  font-size: 24rpx;
  color: #3d6df2;
}

.adv-body {
  padding-top: 16rpx;
}

.adv-act {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 14rpx;
}

.adv-tip {
  font-size: 22rpx;
  color: #b8c0ce;
  flex: 1;
}

.adv-save {
  font-size: 26rpx;
  color: #3d6df2;
  padding: 8rpx 20rpx;
  border-radius: 12rpx;
  background: #eef3ff;
}

/* ---------- 底部 ---------- */
.skip {
  margin-top: 36rpx;
  text-align: center;
  font-size: 26rpx;
  color: #3d6df2;
}

.foot {
  margin-top: 48rpx;
  text-align: center;
  font-size: 22rpx;
  color: #b8c0ce;
  line-height: 1.6;
}
</style>
