/**
 * pages/login 登录页
 * 账号密码由后端账号库校验；登录成功后把角色写进 data.setRole()，
 * 全工程既有的权限矩阵（管理员 / 操作员 / 观察员）立即生效。
 */
const auth = require('../../utils/auth.js')

Page({
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

  onLoad(q) {
    const st = auth.getState()
    this.setData({
      gate: st.gate,
      baseUrl: st.baseUrl,
      user: st.lastUser || '',
      error: q && q.expired ? '登录已过期，请重新登录' : '',
    })
    // 已登录（或演示模式）直接进主流程；否则停在本页，必须登录才能操作
    if (!auth.needsLogin()) this.goNext()
  },

  onUserInput(e) {
    this.setData({ user: e.detail.value, error: '' })
  },

  onPwdInput(e) {
    this.setData({ pwd: e.detail.value, error: '' })
  },

  onTogglePwd() {
    this.setData({ pwdShow: !this.data.pwdShow })
  },

  onToggleAdv() {
    this.setData({ advOpen: !this.data.advOpen })
  },

  onBaseInput(e) {
    this.setData({ baseUrl: e.detail.value })
  },

  onSaveBase() {
    const r = auth.setConfig({ baseUrl: this.data.baseUrl })
    if (!r.ok) {
      this.setData({ error: r.message })
      return
    }
    this.setData({ baseUrl: r.config.baseUrl, error: '' })
    wx.showToast({ title: '已保存', icon: 'success' })
  },

  onLogin() {
    if (this.data.submitting) return
    const u = String(this.data.user || '').trim()
    const p = String(this.data.pwd || '')
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
      wx.showToast({ title: '登录成功', icon: 'success' })
      setTimeout(() => this.goNext(), 400)
    })
  },

  /** 演示模式：后端未就绪时直接进（gate 关闭时才显示入口） */
  onSkip() {
    wx.showToast({ title: '演示模式', icon: 'none' })
    setTimeout(() => this.goNext(), 300)
  },

  goNext() {
    wx.reLaunch({ url: '/pages/room-select/room-select' })
  },

  onPullDownRefresh() {
    wx.stopPullDownRefresh()
  },
})
