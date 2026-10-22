/**
 * pages/users —— 操作员账户管理（仅管理员）
 * 账号、角色、密码全部由后端账号库维护；本页只做增改与禁用。
 * ⚠️ 字段映射见 utils/auth.js 的 normalizeUser，后端文档定稿后只改那里。
 */
const auth = require('../../utils/auth.js')

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

Page({
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
    wx.stopPullDownRefresh()
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
      wx.showToast({ title: '仅管理员可新增账号', icon: 'none' })
      return
    }
    this.setData({ addOpen: true, form: { username: '', name: '', password: '', role: 'operator' } })
  },

  onAddClose() {
    this.setData({ addOpen: false })
  },

  onFormInput(e) {
    const k = e.currentTarget.dataset.k
    const form = Object.assign({}, this.data.form)
    form[k] = e.detail.value
    this.setData({ form: form })
  },

  onPickRole(e) {
    const form = Object.assign({}, this.data.form)
    form.role = e.currentTarget.dataset.key
    this.setData({ form: form })
  },

  onCreate() {
    const f = this.data.form
    if (!String(f.username || '').trim()) { wx.showToast({ title: '请输入账号', icon: 'none' }); return }
    if (String(f.password || '').length < 6) { wx.showToast({ title: '密码至少 6 位', icon: 'none' }); return }
    if (this.data.busy) return
    this.setData({ busy: true })
    auth.createUser(f).then((res) => {
      this.setData({ busy: false })
      if (!res.ok) {
        wx.showToast({ title: res.message || '新增失败', icon: 'none' })
        return
      }
      wx.showToast({ title: '已添加', icon: 'success' })
      this.setData({ addOpen: false })
      this.refresh()
    })
  },

  /* ---------------- 改资料 ---------------- */
  onResetPwd(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '重置密码',
      editable: true,
      placeholderText: '输入新密码（至少 6 位）',
      success: (r) => {
        if (!r.confirm) return
        const pwd = String(r.content || '').trim()
        if (pwd.length < 6) {
          wx.showToast({ title: '密码至少 6 位', icon: 'none' })
          return
        }
        auth.resetPassword(id, pwd).then((res) => {
          wx.showToast({ title: res.ok ? '已重置' : (res.message || '重置失败'), icon: res.ok ? 'success' : 'none' })
        })
      },
    })
  },

  onToggleDisabled(e) {
    const id = e.currentTarget.dataset.id
    const disabled = !!e.currentTarget.dataset.disabled
    const word = disabled ? '启用' : '禁用'
    wx.showModal({
      title: word + '账号',
      content: '确定要' + word + '这个账号吗？' + (disabled ? '' : '禁用后该账号将无法登录。'),
      success: (r) => {
        if (!r.confirm) return
        auth.updateUser(id, { disabled: !disabled }).then((res) => {
          wx.showToast({ title: res.ok ? ('已' + word) : (res.message || '操作失败'), icon: res.ok ? 'success' : 'none' })
          if (res.ok) this.refresh()
        })
      },
    })
  },

  onBack() {
    wx.navigateBack()
  },
})
