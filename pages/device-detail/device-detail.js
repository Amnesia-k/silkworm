// pages/device-detail/device-detail.js —— P01 看板下钻：设备详情
const data = require('../../utils/data.js')
const engine = require('../../utils/engine.js')
const spec = require('../../utils/spec.js')
const nav = require('../../utils/nav.js')
const chart = require('../../utils/chart.js')

/** 设备 → 规格书 4.1 BOM 条目编号映射 */
const BOM_CODE = {
  heat01: 'D03',
  fan01: 'D04',
  fan02: 'D04',
  mist01: 'D05',
}

const VALID_IDS = ['heat01', 'fan01', 'fan02', 'mist01']

Page({
  data: {
    barnKey: '',
    deviceId: 'heat01',
    info: null,
    bomCode: '',
    bom: null,
    dev: null,
    permManual: { ok: false, needToken: false, reason: '' },
    tokenInput: '',
    alarms: [],
    seriesCount: 0,
  },

  onLoad(options) {
    if (!nav.ensureBarn()) return
    const b = data.getCurrentBarn()
    this._barn = b.barn
    let id = options && options.id ? options.id : 'heat01'
    if (VALID_IDS.indexOf(id) < 0) id = 'heat01'
    this.setData({
      barnKey: b.barn,
      deviceId: id,
      bomCode: BOM_CODE[id] || '',
      permManual: data.can('manual'),
    })
    this.refresh()
  },

  onReady() {
    this._ready = true
    this.drawChart()
  },

  onShow() {
    this.refresh()
    if (!this._tick) this._tick = () => this.refresh()
    engine.subscribe(this._tick)
  },

  onHide() {
    engine.unsubscribe(this._tick)
  },

  onUnload() {
    engine.unsubscribe(this._tick)
    this._tick = null
  },

  refresh() {
    const barnKey = this._barn || this.data.barnKey
    const id = this.data.deviceId
    if (!barnKey) return
    const b = data.getBarn(barnKey)
    const st = data.getStatusSummary(barnKey)
    const raw = data.getDevices(barnKey).filter((x) => x.id === id)[0] || null
    const live = st.devices.list.filter((x) => x.id === id)[0] || null

    const info = raw
      ? {
          id: raw.id,
          name: raw.name,
          kindName: raw.kindName,
          model: raw.model,
          spec: raw.spec,
          barn: b.barn,
          zone: b.zone,
          group: b.group || '',
          online: raw.online,
          onlineText: raw.online ? '在线' : '离线',
        }
      : null

    const code = BOM_CODE[id] || ''
    const bom = code ? spec.BOM.filter((x) => x.code === code)[0] || null : null

    const alarms = data
      .getAlarms(barnKey, {})
      .filter((a) => a.deviceId === id)
      .slice(0, 5)

    this.setData({
      info,
      bom: bom
        ? { code: bom.code, name: bom.name, model: bom.model, qty: bom.qty, spec: bom.spec, pos: bom.pos, device: bom.device }
        : null,
      dev: live
        ? {
            name: live.name,
            on: live.on,
            stateText: live.stateText,
            locked: live.locked,
            lockText: live.lockText,
            runtimeText: live.runtimeText,
            switchesToday: live.switchesToday,
            lastSwitchText: live.lastSwitchText,
            faultCode: live.faultCode,
            canSwitch: live.canSwitch,
            actionText: live.on ? '关闭' : '开启',
          }
        : null,
      alarms,
      permManual: data.can('manual'),
    })
    this.drawChart()
  },

  /** 近 6 小时环境曲线（onReady 后绘制，每次 refresh 后重绘） */
  drawChart() {
    if (!this._ready) return
    const barnKey = this._barn || this.data.barnKey
    if (!barnKey) return
    const st = data.getState()
    const from = st.simClock - 6 * 3600000
    const to = st.simClock
    const series = data.getSeries(barnKey, from, to)
    const src = series.length > 96 ? series.filter((p, i) => i % Math.ceil(series.length / 72) === 0) : series
    const labels = src.map((p) => data.formatClock(p.ts))
    const temp = src.map((p) => p.temp)
    const humi = src.map((p) => p.humi)
    const outMask = src.map((p) => (p.outSec > 0 ? 1 : 0))
    const range = data.getTarget(barnKey)
    const p = chart.getCanvas('#envChart')
    if (!p || typeof p.then !== 'function') return
    p.then((cv) => chart.drawEnvChart(cv, { labels, temp, humi, range, outMask, annotate: true, avg: true }))
      .catch(() => {})
    if (this.data.seriesCount !== series.length) this.setData({ seriesCount: series.length })
  },

  onTokenInput(e) {
    this.setData({ tokenInput: e.detail.value })
  },

  onToggle() {
    const barnKey = this._barn || this.data.barnKey
    const id = this.data.deviceId
    const dev = this.data.dev
    const perm = data.can('manual')
    if (!dev) {
      wx.showToast({ title: '设备信息不可用', icon: 'none' })
      return
    }
    if (!perm.ok) {
      wx.showToast({ title: perm.reason || '当前角色无权执行手动控制', icon: 'none' })
      return
    }
    if (!dev.canSwitch) {
      wx.showToast({ title: dev.locked ? (dev.lockText || '设备已联锁锁定') : '当前状态不允许远端手动控制', icon: 'none' })
      return
    }
    const tokenId = (this.data.tokenInput || '').trim()
    if (perm.needToken && !tokenId) {
      wx.showToast({ title: '操作员需先填写管理员签发的 ACTION_TOKEN', icon: 'none' })
      return
    }
    const content = '确认要' + dev.actionText + '「' + dev.name + '（' + id + '）」吗？'
      + (perm.needToken ? '\n将消耗令牌 ' + tokenId + '（单次有效）' : '')
    wx.showModal({
      title: '手动控制确认',
      content,
      confirmText: '确认下发',
      success: (r) => {
        if (!r.confirm) return
        const res = engine.toggleDevice(barnKey, id, tokenId)
        wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) this.setData({ tokenInput: '' })
        this.refresh()
      },
    })
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  },
})
