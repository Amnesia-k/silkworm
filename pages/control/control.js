// pages/control/control.js —— P04 手动控制（主要角色：管理员、操作员）
const data = require('../../utils/data.js')
const engine = require('../../utils/engine.js')
const spec = require('../../utils/spec.js')
const nav = require('../../utils/nav.js')
const clamp = require('../../utils/clamp.js')
const live = require('../../utils/live.js')
const auth = require('../../utils/auth.js')

/** S1~S4 会进入 SAFE_LOCK，说明卡中标红 */
const SAFE_LOCK_CODES = ['S1', 'S2', 'S3', 'S4']

Page({
  data: {
    loading: true,
    barnKey: '',
    role: '',
    roleName: '',
    isAdmin: false,
    st: null,
    modeInfo: null,
    manualLeftSec: 0,
    manualLeftText: '',
    interlock: null,
    interlockAtText: '',
    devices: [],
    mSummary: null,
    /** 待裁定病蚕数（后端接口，见 utils/clamp.js） */
    clampPending: 0,
    tokenTargets: [],
    tokens: [],
    ilOpen: false,
    lastTokenId: '',
    interlocks: spec.INTERLOCKS.map((s) => ({
      code: s.code,
      name: s.name,
      trigger: s.trigger,
      action: s.action,
      release: s.release,
      danger: SAFE_LOCK_CODES.indexOf(s.code) >= 0,
    })),
    permManual: { ok: false, needToken: false, reason: '' },
    permMaint: { ok: false, needToken: false, reason: '' },
    permUnlock: { ok: false, needToken: false, reason: '' },
    tokenInput: '',
    issueTarget: 'heat01',
    issueMemo: '',
    maintMemo: '',
    unlockReason: '',
    showUnlock: false,
  },

  onLoad() {
    nav.skeletonBegin(this)
    if (!nav.ensureBarn()) return
    const b = data.getCurrentBarn()
    this._barn = b.barn
    const st = data.getState()
    this.setData({
      barnKey: b.barn,
      role: st.role,
      roleName: data.getRole().name,
      isAdmin: st.role === 'admin',
      permManual: data.can('manual'),
      permMaint: data.can('maint'),
      permUnlock: data.can('unlock'),
    })
    this.refresh()
  },

  onShow() {
    this.refresh()
    if (!this._tick) this._tick = () => this.refresh()
    engine.subscribe(this._tick)
    // 本地 1 s 定时器：只做手动模式倒计时显示，业务数据仍由 engine 订阅刷新
    if (!this._leftTimer) this._leftTimer = setInterval(() => this.tickLeft(), 1000)
    // 待裁定病蚕数来自后端接口（轮询由 utils/clamp.js 统一管理）
    if (!this._clampTick) this._clampTick = (p) => this.applyClamp(p)
    clamp.startPolling(this._barn || this.data.barnKey, this._clampTick)
  },

  onHide() {
    engine.unsubscribe(this._tick)
    this.clearLeftTimer()
    clamp.stopPolling(this._clampTick)
  },

  onUnload() {
    engine.unsubscribe(this._tick)
    this._tick = null
    this.clearLeftTimer()
    clamp.stopPolling(this._clampTick)
    this._clampTick = null
  },

  /** 后端轮询回调：只取待裁定病蚕数 */
  applyClamp(p) {
    const pending = (p.diseased || []).length
    const ms = this.data.mSummary || {}
    this.setData({
      clampPending: pending,
      mSummary: Object.assign({}, ms, {
        pending: pending,
        needHuman: (ms.outOfPreset || 0) + pending,
      }),
    })
  },

  clearLeftTimer() {
    if (this._leftTimer) {
      clearInterval(this._leftTimer)
      this._leftTimer = null
    }
  },

  /** 每秒递减手动倒计时（仅显示层） */
  tickLeft() {
    const st = this.data.st
    if (!st || st.mode !== 'manual') return
    const left = Math.max(0, this.data.manualLeftSec - 1)
    this.setData({ manualLeftSec: left, manualLeftText: data.formatDuration(left) })
  },

  refresh() {
    const barnKey = this._barn || this.data.barnKey
    if (!barnKey) { nav.skeletonDone(this); return }
    const st = data.getStatusSummary(barnKey)
    const permManual = data.can('manual')
    const devices = st.devices.list.map((d) => ({
      id: d.id,
      name: d.name,
      kindName: d.kindName,
      model: d.model,
      on: d.on,
      stateText: d.stateText,
      locked: d.locked,
      lockText: d.lockText,
      runtimeText: d.runtimeText,
      switchesToday: d.switchesToday,
      lastSwitchText: d.lastSwitchText,
      faultCode: d.faultCode,
      canSwitch: d.canSwitch,
      disabled: !permManual.ok || !d.canSwitch,
      actionText: d.on ? '关闭' : '开启',
    }))
    const il = st.interlock && st.interlock.active ? st.interlock : null
    // 令牌签发目标：4 台环境执行器 + 5 台机械化设备
    const mSummary = engine.getMachineSummary(barnKey)
    // 待裁定病蚕数是后端数据，不能由本机模拟覆盖
    const clampPending = this.data.clampPending || 0
    mSummary.pending = clampPending
    mSummary.needHuman = mSummary.outOfPreset + clampPending
    const tokenTargets = devices
      .map((d) => ({ id: d.id, name: d.name, kindName: d.kindName }))
      .concat(mSummary.list.map((m) => ({ id: m.id, name: m.name, kindName: m.kindName })))
    this.setData({
      st,
      modeInfo: st.modeInfo,
      manualLeftSec: st.manualLeftSec,
      manualLeftText: data.formatDuration(st.manualLeftSec),
      interlock: il,
      interlockAtText: il ? data.formatTime(il.at) : '',
      devices,
      mSummary,
      tokenTargets,
      tokens: data.getTokens(barnKey),
      permManual,
      permMaint: data.can('maint'),
      permUnlock: data.can('unlock'),
      role: data.getState().role,
      roleName: data.getRole().name,
      isAdmin: data.getState().role === 'admin',
    })

    // 首次数据构建完成（所有 setData 之后）：关闭骨架屏
    nav.skeletonDone(this)
  },

  /* ---------------- 设备控制 ---------------- */
  onToggleDevice(e) {
    const id = e.currentTarget.dataset.id
    const barnKey = this._barn || this.data.barnKey
    const dev = this.data.devices.filter((d) => d.id === id)[0]
    if (!dev) return
    if (!this.data.permManual.ok) {
      wx.showToast({ title: this.data.permManual.reason || '当前角色无权执行手动控制', icon: 'none' })
      return
    }
    if (!dev.canSwitch) {
      wx.showToast({ title: dev.locked ? (dev.lockText || '设备已联锁锁定') : '当前状态不允许远端手动控制', icon: 'none' })
      return
    }
    const tokenId = (this.data.tokenInput || '').trim()
    if (this.data.permManual.needToken && !tokenId) {
      wx.showToast({ title: '操作员需先填写管理员签发的 ACTION_TOKEN', icon: 'none' })
      return
    }
    const content = '确认要' + dev.actionText + '「' + dev.name + '（' + dev.id + '）」吗？'
      + (this.data.permManual.needToken ? '\n将消耗令牌 ' + tokenId + '（单次有效）' : '')
    wx.showModal({
      title: '手动控制确认',
      content,
      confirmText: '确认下发',
      success: (r) => {
        if (!r.confirm) return
        /* 登录后走真实下发接口 POST /control/manual；未登录走本机模拟 */
        if (live.enabled()) {
          live.toggle(barnKey, id, !dev.on, { token: tokenId }).then((res) => {
            wx.showToast({
              title: res.ok ? (res.mode === 'manual' ? '已下发，进入手动模式' : '指令已下发') : res.message,
              icon: res.ok ? 'success' : 'none',
            })
            if (res.ok) this.setData({ tokenInput: '' })
            setTimeout(() => this.refresh(), 1200)
          })
          return
        }
        const res = engine.toggleDevice(barnKey, id, tokenId)
        wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) this.setData({ tokenInput: '' })
        this.refresh()
      },
    })
  },

  goDevice(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/device-detail/device-detail?id=' + id })
  },

  goMachine() {
    wx.navigateTo({ url: '/pages/machine/machine' })
  },

  /** 安全联锁说明默认收起，避免页面信息过载 */
  onToggleIl() {
    this.setData({ ilOpen: !this.data.ilOpen })
  },

  /* ---------------- 审批令牌 ---------------- */
  onTokenInput(e) {
    this.setData({ tokenInput: e.detail.value })
  },

  onIssueTarget(e) {
    this.setData({ issueTarget: e.currentTarget.dataset.id })
  },

  onIssueMemo(e) {
    this.setData({ issueMemo: e.detail.value })
  },

  onIssueToken() {
    const barnKey = this._barn || this.data.barnKey
    if (!this.data.isAdmin) {
      wx.showToast({ title: '审批令牌只能由管理员签发', icon: 'none' })
      return
    }
    /* 登录后令牌由后端签发（POST /control/tokens）；未登录走本机模拟 */
    if (auth.isLoggedIn()) {
      auth.issueToken({ target: this.data.issueTarget, action: 'manual', memo: this.data.issueMemo }).then((res) => {
        wx.showToast({ title: res.ok ? '令牌已签发' : res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) {
          this.setData({ lastTokenId: res.token ? res.token.id : '', issueMemo: '' })
          this.refresh()
        }
      })
      return
    }
    const res = engine.issueToken(barnKey, this.data.issueTarget, 'toggle', this.data.issueMemo)
    wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
    if (res.ok) {
      this.setData({
        lastTokenId: res.token ? res.token.id : '',
        issueMemo: '',
      })
    }
    this.refresh()
  },

  onRevokeToken(e) {
    const id = e.currentTarget.dataset.id
    const barnKey = this._barn || this.data.barnKey
    wx.showModal({
      title: '撤销令牌',
      content: '确认撤销令牌 ' + id + '？撤销后立即作废。',
      confirmText: '确认下发',
      success: (r) => {
        if (!r.confirm) return
        const res = engine.revokeToken(barnKey, id)
        wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        this.refresh()
      },
    })
  },

  /* ---------------- 模式操作 ---------------- */
  onExitManual() {
    const barnKey = this._barn || this.data.barnKey
    const st = this.data.st
    if (!st || st.mode !== 'manual') {
      wx.showToast({ title: '当前不在手动模式', icon: 'none' })
      return
    }
    wx.showModal({
      title: '退出手动模式',
      content: '退出后设备交回『' + (st.online ? '自动' : '离线自治') + '』调控。确认退出？',
      confirmText: '确认下发',
      success: (r) => {
        if (!r.confirm) return
        if (live.enabled()) {
          live.exitManual(barnKey).then((res) => {
            wx.showToast({ title: res.ok ? '已退出手动模式' : res.message, icon: res.ok ? 'success' : 'none' })
            setTimeout(() => this.refresh(), 1200)
          })
          return
        }
        const res = engine.exitManual(barnKey)
        wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        this.refresh()
      },
    })
  },

  onMaintMemo(e) {
    this.setData({ maintMemo: e.detail.value })
  },

  onToggleMaint() {
    const barnKey = this._barn || this.data.barnKey
    const st = this.data.st
    if (!this.data.permMaint.ok) {
      wx.showToast({ title: this.data.permMaint.reason || '仅管理员可切换维护模式', icon: 'none' })
      return
    }
    if (!st) return
    const on = st.mode !== 'maint'
    const memo = (this.data.maintMemo || '').trim()
    wx.showModal({
      title: on ? '进入维护模式' : '退出维护模式',
      content: on
        ? '维护模式不下发自动指令、抑制非 critical 告警，需管理员操作。确认进入？'
        : '退出维护模式后将回到『' + (st.online ? '自动' : '离线自治') + '』。确认退出？',
      confirmText: '确认下发',
      success: (r) => {
        if (!r.confirm) return
        const res = engine.switchMaintenance(barnKey, on, memo)
        wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) this.setData({ maintMemo: '' })
        this.refresh()
      },
    })
  },

  /* ---------------- 解除安全锁定（二次确认 + 必填原因） ---------------- */
  onUnlock() {
    const st = this.data.st
    if (!this.data.permUnlock.ok) {
      wx.showToast({ title: this.data.permUnlock.reason || '仅管理员可解除安全锁定', icon: 'none' })
      return
    }
    if (!st || st.mode !== 'safe_lock') {
      wx.showToast({ title: '当前不在安全锁定状态', icon: 'none' })
      return
    }
    wx.showModal({
      title: '解除安全锁定',
      content: '请先现场确认故障已排除。解除后须填写解除原因，操作写入审计日志。确认继续？',
      confirmText: '确认下发',
      success: (r) => {
        if (r.confirm) this.setData({ showUnlock: true, unlockReason: '' })
      },
    })
  },

  onUnlockReason(e) {
    this.setData({ unlockReason: e.detail.value })
  },

  onUnlockCancel() {
    this.setData({ showUnlock: false, unlockReason: '' })
  },

  onUnlockSubmit() {
    const barnKey = this._barn || this.data.barnKey
    const reason = (this.data.unlockReason || '').trim()
    if (!reason) {
      wx.showToast({ title: '请填写解除安全锁定的原因', icon: 'none' })
      return
    }
    const res = engine.unlockSafety(barnKey, reason)
    wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
    if (res.ok) this.setData({ showUnlock: false, unlockReason: '' })
    this.refresh()
  },
})
