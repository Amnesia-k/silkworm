// pages/alarm-detail/alarm-detail.js —— 告警详情（规格书 13.1 分级 / 13.2 清单 / 5.3 时间格式）
const data = require('../../utils/data.js')
const engine = require('../../utils/engine.js')
const spec = require('../../utils/spec.js')
const live = require('../../utils/live.js')
const env = require('../../utils/env.js')

/** 级别 → 徽标配色 */
const LEVEL_BADGE = { info: 'badge-blue', warn: 'badge-orange', critical: 'badge-red' }

/** 查询参数可能是编码过的，容错解码 */
function decodeId(v) {
  if (!v) return ''
  try {
    return decodeURIComponent(v)
  } catch (e) {
    return v
  }
}

Page({
  data: {
    id: '',
    barn: null,
    alarm: null,
    canAck: false,
    ackReason: '',
    levelBadge: 'badge-gray',
    statusBadge: 'badge-gray',
    clearedText: '',
    catalog: [],
  },

  onLoad(options) {
    this.setData({ id: decodeId(options && options.id) })
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

  /** 按 id 取告警（data.findAlarm → { barn, alarm } 或 null） */
  refresh() {
    const hit = this.data.id ? data.findAlarm(this.data.id) : null
    if (!hit) {
      this.setData({
        barn: null,
        alarm: null,
        canAck: false,
        ackReason: '',
        levelBadge: 'badge-gray',
        statusBadge: 'badge-gray',
        clearedText: '',
        catalog: this.buildCatalog(''),
      })
      return
    }
    const perm = data.can('ackAlarm')
    const a = hit.alarm
    this.setData({
      barn: {
        barn: hit.barn.barn,
        zone: hit.barn.zone,
        group: hit.barn.group,
        name: hit.barn.name,
      },
      alarm: a,
      canAck: !!perm.ok,
      ackReason: perm.reason || '',
      levelBadge: LEVEL_BADGE[a.level] || 'badge-gray',
      statusBadge: 'badge-' + (a.statusTone || 'gray'),
      clearedText: a.cleared && a.clearedAt ? data.formatTime(a.clearedAt) : '',
      catalog: this.buildCatalog(a.code),
    })
  },

  /** 规格书 13.2 告警清单 AL01~AL08，当前这条高亮 */
  buildCatalog(code) {
    return spec.ALARMS.map((x) => ({
      code: x.code,
      name: x.name,
      trigger: x.trigger,
      level: x.level,
      levelName: (spec.ALARM_LEVELS[x.level] || {}).name || x.level,
      levelBadge: LEVEL_BADGE[x.level] || 'badge-gray',
      current: !!code && x.code === code,
    }))
  },

  /** 确认告警 */
  onAck() {
    if (!this.data.canAck) {
      wx.showToast({ title: this.data.ackReason || '当前角色无权执行该操作', icon: 'none' })
      return
    }
    const a = this.data.alarm
    if (!a) return
    wx.showModal({
      title: '确认告警',
      content: '确认 ' + a.code + '「' + a.text + '」？',
      confirmText: '确认',
      success: (r) => {
        if (!r.confirm) return
        if (live.enabled()) {
          env.confirmAlarm(a.id).then((res) => {
            wx.showToast({ title: res.ok ? '告警已确认' : res.message, icon: res.ok ? 'success' : 'none' })
            if (res.ok) live.refresh()
            setTimeout(() => this.refresh(), 800)
          })
          return
        }
        const res = engine.ackAlarm(a.id, '')
        wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        this.refresh()
      },
    })
  },

  /** 切到该告警所属蚕房并跳看板 */
  onGoDashboard() {
    if (!this.data.barn) return
    data.setCurrentBarn(this.data.barn.barn)
    wx.switchTab({ url: '/pages/index/index' })
  },

  /** 切到该告警所属蚕房并跳手动控制 */
  onGoControl() {
    if (!this.data.barn) return
    data.setCurrentBarn(this.data.barn.barn)
    wx.switchTab({ url: '/pages/control/control' })
  },

  onBack() {
    wx.navigateBack({ delta: 1 })
  },
})
