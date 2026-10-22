/**
 * pages/tokens —— 审批令牌（ACTION_TOKEN）签发与撤销（仅管理员）
 * 用途：操作员执行手动控制/手动改机械参数时，必须持有管理员签发的令牌（5 min 单次有效）。
 * ⚠️ 令牌的落库与校验在服务端；前端只负责签发/撤销与展示（字段映射见 utils/auth.js normalizeToken）。
 */
const auth = require('../../utils/auth.js')
const data = require('../../utils/data.js')

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

Page({
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
    wx.stopPullDownRefresh()
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
    const t = this.data.targets[idx]
    this.setData({ targetIdx: idx, targetName: t ? (t.name + '（' + t.kind + '）') : '' })
  },

  onMemoInput(e) {
    this.setData({ memo: e.detail.value })
  },

  onIssue() {
    if (this.data.busy) return
    const t = this.data.targets[this.data.targetIdx]
    if (!t) {
      wx.showToast({ title: '请先选择设备', icon: 'none' })
      return
    }
    this.setData({ busy: true })
    auth.issueToken({ target: t.id, action: 'manual', memo: this.data.memo }).then((res) => {
      this.setData({ busy: false })
      if (!res.ok) {
        wx.showToast({ title: res.message || '签发失败', icon: 'none' })
        return
      }
      this.setData({ memo: '' })
      wx.showToast({ title: '已签发，5 分钟内单次有效', icon: 'success' })
      this.refresh()
    })
  },

  onRevoke(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '撤销令牌',
      content: '撤销后该令牌立即失效，操作员将无法用它执行手动操作。',
      success: (r) => {
        if (!r.confirm) return
        auth.revokeToken(id).then((res) => {
          wx.showToast({ title: res.ok ? '已撤销' : (res.message || '撤销失败'), icon: res.ok ? 'success' : 'none' })
          if (res.ok) this.refresh()
        })
      },
    })
  },
})
