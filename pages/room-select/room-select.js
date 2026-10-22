/**
 * pages/room-select —— 选择蚕房（控制区）
 * 规格书 1.6 蚕房 barn / 1.7 控制区 zone：每栋蚕房对应一个控制区，
 * 传感器与设备组一一对应；本页是启动页，选完才进入后续页面。
 */

const data = require('../../utils/data.js')
const engine = require('../../utils/engine.js')
const nav = require('../../utils/nav.js')
const auth = require('../../utils/auth.js')

Page({
  data: {
    list: [],
    from: '',
    simText: '',
    heroSub: '每栋蚕房对应一个控制区（zone），传感器与设备组一一对应',
  },

  onLoad(options) {
    // 冷启动闸门：需要登录但还没有会话时，直接去登录页（gate 关闭时不拦人）
    if (auth.needsLogin()) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    const from = options && options.from ? decodeURIComponent(options.from) : ''
    this.setData({ from })
    this.refresh()
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
  },

  refresh() {
    const st = data.getState()
    const list = data.getBarnList().map((b) => ({
      barn: b.barn,
      zone: b.zone,
      name: b.name,
      area: b.area,
      varietyName: b.varietyName,
      instarName: b.instarName,
      modeName: b.modeName,
      modeTone: b.modeTone,
      tempText: b.tempText,
      humiText: b.humiText,
      targetText: b.target.tempText + ' / ' + b.target.humiText,
      outText: b.outOfRange.levelName,
      outTone: b.outOfRange.level === 'normal' ? 'green' : (b.outOfRange.level === 'light' ? 'orange' : 'red'),
      tempOut: b.outOfRange.tempIn ? '' : 'text-danger',
      humiOut: b.outOfRange.humiIn ? '' : 'text-danger',
      deviceText: b.deviceOn + '/' + b.deviceTotal,
      alarmCount: b.alarmCount,
      criticalCount: b.criticalCount,
      wifiText: data.wifiText(b.wifi),
      wifiBars: b.wifiBars,
      online: b.online,
      isCurrent: b.barn === st.currentBarn,
    }))
    this.setData({ list, simText: data.formatTime(st.simClock) })
  },

  onPick(e) {
    const barn = e.currentTarget.dataset.barn
    const b = data.setCurrentBarn(barn)
    const app = getApp()
    if (app && app.globalData) app.globalData.currentBarn = barn
    wx.showToast({ title: '已进入 ' + b.name, icon: 'success' })
    setTimeout(() => nav.backFrom(this.data.from), 260)
  },

  onReset() {
    wx.showModal({
      title: '重置演示数据',
      content: '将恢复四栋蚕房的初始工况与目标区间，确定继续？',
      success: (r) => {
        if (!r.confirm) return
        data.resetDemo()
        data.setCurrentBarn('barn01')
        this.refresh()
        wx.showToast({ title: '已重置', icon: 'success' })
      },
    })
  },
})
