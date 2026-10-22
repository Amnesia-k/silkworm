// pages/machine/machine.js —— 机械化设备
//
// 数据来源分两段（交付单 v1.0 只给了病蚕/夹取这 3 个接口）：
//   ① 病蚕识别记录 + 夹取作业：后端接口 utils/clamp.js（真实数据，轮询刷新）
//   ② 5 台机械的运行状态与参数预设：本机模拟 utils/engine.js（后端暂无对应接口）
// 人工裁定「放行」后由服务端自动下发夹取，App 不再自己输入坐标启动作业。
const data = require('../../utils/data.js')
const engine = require('../../utils/engine.js')
const clamp = require('../../utils/clamp.js')
const nav = require('../../utils/nav.js')

Page({
  data: {
    loading: true,
    barnKey: '',
    info: null,
    summary: { total: 0, on: 0, outOfPreset: 0, pending: 0, needHuman: 0 },
    list: [],
    // 病蚕与作业（后端接口）
    diseased: [],
    jobs: [],
    clampOk: true,
    clampMsg: '',
    clampSyncText: '--',
    confirmingId: '',
    canConfirmRole: false,
    // 本机模拟部分
    canManual: { ok: false, needToken: false, reason: '' },
    canConfig: false,
    isAdmin: false,
    tokenInput: '',
    edit: null,
    editInput: '',
    editNote: '',
    editLo: '',
    editHi: '',
  },

  onLoad() {
    nav.skeletonBegin(this)
    if (!nav.ensureBarn()) return
    const b = data.getCurrentBarn()
    this._barn = b.barn
    const st = data.getState()
    this.setData({
      barnKey: b.barn,
      isAdmin: st.role === 'admin',
      canManual: data.can('manual'),
      canConfig: data.can('setConfig').ok,
      canConfirmRole: data.can('manual').ok,
    })
    this.refresh()
  },

  onShow() {
    this.refresh()
    if (!this._tick) this._tick = () => this.refresh()
    engine.subscribe(this._tick)
    // 后端无推送：进入页面立即拉一次，之后按 config.pollMs 轮询
    if (!this._clampTick) this._clampTick = (payload) => this.applyClamp(payload)
    clamp.startPolling(this._barn || this.data.barnKey, this._clampTick)
  },

  onHide() {
    engine.unsubscribe(this._tick)
    clamp.stopPolling(this._clampTick)
  },

  onUnload() {
    engine.unsubscribe(this._tick)
    this._tick = null
    clamp.stopPolling(this._clampTick)
    this._clampTick = null
  },

  onPullDownRefresh() {
    this.refresh()
    clamp.refreshAll(this._barn || this.data.barnKey)
    wx.stopPullDownRefresh()
  },

  refresh() {
    const key = this._barn || this.data.barnKey
    if (!key) { nav.skeletonDone(this); return }
    const s = engine.getMachineSummary(key)
    const st = data.getStatusSummary(key)
    const pending = (this.data.diseased || []).length
    this.setData({
      info: {
        name: st.name,
        zone: st.zone,
        modeName: st.modeInfo.name,
        modeTone: st.modeInfo.tone,
        online: st.online,
      },
      summary: {
        total: s.total,
        on: s.on,
        outOfPreset: s.outOfPreset,
        pending: pending,
        needHuman: s.outOfPreset + pending,
      },
      list: s.list,
      canManual: data.can('manual'),
      canConfig: data.can('setConfig').ok,
      canConfirmRole: data.can('manual').ok,
    })
    if (this.data.edit) this.syncEdit(key)

    // 首次数据构建完成（所有 setData 之后）：关闭骨架屏
    nav.skeletonDone(this)
  },

  /** 后端轮询回调：病蚕列表 + 夹取作业 */
  applyClamp(p) {
    const pending = (p.diseased || []).length
    this.setData({
      diseased: p.diseased || [],
      jobs: p.jobs || [],
      clampOk: p.ok !== false,
      clampMsg: p.ok === false ? (p.code || '') + ' · ' + (p.message || '接口异常') : '',
      clampSyncText: (p.state && p.state.lastSyncText) || '--',
      summary: Object.assign({}, this.data.summary, {
        pending: pending,
        needHuman: (this.data.summary.outOfPreset || 0) + pending,
      }),
    })
    nav.skeletonDone(this)
  },

  /** 手动刷新（接口异常时给用户的出口） */
  onRefreshClamp() {
    wx.showLoading({ title: '刷新中…', mask: true })
    clamp.refreshAll(this._barn || this.data.barnKey).then((p) => {
      wx.hideLoading()
      this.applyClamp(p)
      if (p.ok) wx.showToast({ title: '已刷新', icon: 'success' })
      else wx.showToast({ title: '刷新失败：' + (p.message || p.code), icon: 'none', duration: 2600 })
    })
  },

  /* ---------------- 人工裁定（放行 / 忽略本轮） ---------------- */
  /** 轻点「放行」只提示手势，真正下发必须长按（防止拇指滚动误触到唯一不可逆动作） */
  onReleaseHint() {
    wx.showToast({ title: '长按 0.8 秒才能放行', icon: 'none', duration: 1600 })
  },

  onConfirmYes(e) {
    // 长按触发：先震一下，让手指确认「这一下真的算数」
    if (wx.vibrateShort) {
      try {
        wx.vibrateShort({ type: 'heavy' })
      } catch (err) {
        /* 部分机型不支持，忽略 */
      }
    }
    this.doConfirm(e, 'yes')
  },

  onConfirmNo(e) {
    this.doConfirm(e, 'no')
  },

  doConfirm(e, decision) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    const id = ds.id
    const item = (this.data.diseased || []).filter((x) => x.id === id)[0]
    if (!item) return
    if (!this.data.canConfirmRole) {
      wx.showToast({ title: data.can('manual').reason || '当前角色无权裁定', icon: 'none' })
      return
    }
    if (this.data.confirmingId) {
      wx.showToast({ title: '正在下发，请稍候', icon: 'none' })
      return
    }
    const isYes = decision === 'yes'
    wx.showModal({
      title: isYes ? '确认放行该病蚕箔' : '忽略本轮识别',
      content: isYes
        ? '「' + item.display + '」（置信度 ' + item.confText + '，疑似虫 ' + item.count + ' 头）\n放行后服务端会立即下发夹取，机械会真实动作：抓取该箔 → 码放到传送带。'
        : '「' + item.display + '」本轮不做处理；下一轮识别仍可能重新推送。',
      confirmText: isYes ? '确认放行' : '确认忽略',
      confirmColor: isYes ? '#8f1d14' : '#2454c9',
      success: (r) => {
        if (!r.confirm) return
        this.setData({ confirmingId: id })
        wx.showLoading({ title: isYes ? '正在下发夹取…' : '正在提交…', mask: true })
        clamp
          .confirmDiseased(id, {
            decision: decision,
            operator: data.getRole().name,
            note: '',
          })
          .then((res) => {
            wx.hideLoading()
            this.setData({ confirmingId: '' })
            if (res.ok) {
              const d = res.data || {}
              const msg = isYes
                ? '已放行' + (d.clampTaskId ? ' · 任务 ' + d.clampTaskId : '') + ' · ' + (d.placedText || '')
                : '已忽略本轮'
              wx.showToast({ title: msg, icon: 'none', duration: 2600 })
            } else {
              wx.showToast({ title: res.message || ('裁定失败：' + res.code), icon: 'none', duration: 3000 })
            }
            // 裁定成功后立即重拉列表与作业（交付单建议）
            clamp.refreshAll(this._barn || this.data.barnKey).then((p) => this.applyClamp(p))
          })
      },
    })
  },

  /** 查看病蚕图片（后端给的是绝对 URL，直接预览，不再拼 baseUrl） */
  onPreviewImage(e) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    const id = ds.id
    const src = ds.src
    const item = (this.data.diseased || []).filter((x) => x.id === id)[0]
    const urls = item && item.images && item.images.length ? item.images : (src ? [src] : [])
    if (!urls.length) return
    wx.previewImage({ current: src || urls[0], urls: urls })
  },

  /** 参数面板打开时同步最新值（不动用户正在输入的内容） */
  syncEdit(key) {
    const e = this.data.edit
    const m = engine.getMachines(key).filter((x) => x.id === e.id)[0]
    if (!m) {
      this.setData({ edit: null })
      return
    }
    const p = m.params.filter((x) => x.key === e.key)[0]
    if (!p) {
      this.setData({ edit: null })
      return
    }
    this.setData({
      edit: {
        id: m.id, name: m.name, key: p.key, label: p.label, unit: p.unit,
        value: p.value, min: p.min, max: p.max, step: p.step,
        presetLo: p.presetLo, presetHi: p.presetHi,
      },
    })
  },

  /* ---------------- 启停 ---------------- */
  onToggle(e) {
    const key = this._barn || this.data.barnKey
    const id = e.currentTarget.dataset.id
    const m = this.data.list.filter((x) => x.id === id)[0]
    if (!m) return
    if (!this.data.canManual.ok) {
      wx.showToast({ title: this.data.canManual.reason || '当前角色无权控制机械', icon: 'none' })
      return
    }
    const tokenId = (this.data.tokenInput || '').trim()
    if (this.data.canManual.needToken && !tokenId) {
      wx.showToast({ title: '操作员需先填写管理员签发的 ACTION_TOKEN', icon: 'none' })
      return
    }
    const act = m.on ? '停止' : '启动'
    wx.showModal({
      title: '机械控制确认',
      content: '确认要' + act + '「' + m.name + '（' + m.id + '）」吗？'
        + (this.data.canManual.needToken ? '\n将消耗令牌 ' + tokenId + '（单次有效）' : ''),
      confirmText: '确认' + act,
      success: (r) => {
        if (!r.confirm) return
        const res = engine.toggleMachine(key, id, tokenId)
        wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) this.setData({ tokenInput: '' })
        this.refresh()
      },
    })
  },

  onTokenInput(e) {
    this.setData({ tokenInput: e.detail.value })
  },

  /* ---------------- 参数与预设范围 ---------------- */
  onEditParam(e) {
    const id = e.currentTarget.dataset.m
    const k = e.currentTarget.dataset.k
    const m = this.data.list.filter((x) => x.id === id)[0]
    if (!m) return
    const p = m.params.filter((x) => x.key === k)[0]
    if (!p) return
    this.setData({
      edit: {
        id: m.id, name: m.name, key: p.key, label: p.label, unit: p.unit,
        value: p.value, min: p.min, max: p.max, step: p.step,
        presetLo: p.presetLo, presetHi: p.presetHi,
      },
      editInput: String(p.value),
      editNote: '',
      editLo: String(p.presetLo),
      editHi: String(p.presetHi),
    })
  },

  onEditInput(e) {
    this.setData({ editInput: e.detail.value })
  },

  onNoteInput(e) {
    this.setData({ editNote: e.detail.value })
  },

  onLoInput(e) {
    this.setData({ editLo: e.detail.value })
  },

  onHiInput(e) {
    this.setData({ editHi: e.detail.value })
  },

  onCloseEdit() {
    this.setData({ edit: null, editNote: '' })
  },

  onSaveParam() {
    const key = this._barn || this.data.barnKey
    const e = this.data.edit
    if (!e) return
    if (!this.data.canManual.ok) {
      wx.showToast({ title: this.data.canManual.reason || '当前角色无权修改参数', icon: 'none' })
      return
    }
    const v = Number(this.data.editInput)
    const note = (this.data.editNote || '').trim()
    const outOfPreset = isFinite(v) && (v < e.presetLo || v > e.presetHi)
    if (outOfPreset && !note) {
      wx.showToast({ title: '超出预设范围需填写人工干涉原因', icon: 'none' })
      return
    }
    const content = '将「' + e.name + ' · ' + e.label + '」由 ' + e.value + ' ' + e.unit + ' 改为 ' + this.data.editInput + ' ' + e.unit
      + (outOfPreset ? '\n该值超出预设范围（' + e.presetLo + ' ~ ' + e.presetHi + ' ' + e.unit + '），将记录为人工干涉' : '')
    wx.showModal({
      title: '参数变更确认',
      content,
      confirmText: '确认修改',
      success: (r) => {
        if (!r.confirm) return
        const res = engine.setMachineParam(key, e.id, e.key, this.data.editInput, note, '')
        wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) this.setData({ edit: null, editNote: '' })
        this.refresh()
      },
    })
  },

  onSavePreset() {
    const key = this._barn || this.data.barnKey
    const e = this.data.edit
    if (!e) return
    if (!this.data.canConfig) {
      wx.showToast({ title: '仅管理员可修改预设工作范围', icon: 'none' })
      return
    }
    const note = (this.data.editNote || '').trim()
    if (!note) {
      wx.showToast({ title: '修改预设范围需填写变更原因', icon: 'none' })
      return
    }
    wx.showModal({
      title: '预设范围变更确认',
      content: '「' + e.name + ' · ' + e.label + '」预设范围由 ' + e.presetLo + ' ~ ' + e.presetHi + ' ' + e.unit +
        ' 改为 ' + this.data.editLo + ' ~ ' + this.data.editHi + ' ' + e.unit + '\n变更原因：' + note,
      confirmText: '确认变更',
      success: (r) => {
        if (!r.confirm) return
        const res = engine.setMachinePreset(key, e.id, e.key, this.data.editLo, this.data.editHi, note)
        wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) this.setData({ edit: null, editNote: '' })
        this.refresh()
      },
    })
  },

  goControl() {
    wx.switchTab({ url: '/pages/control/control' })
  },

  goDevice() {
    wx.navigateTo({ url: '/pages/device-detail/device-detail?id=heat01' })
  },

  goMine() {
    wx.switchTab({ url: '/pages/mine/mine' })
  },
})
