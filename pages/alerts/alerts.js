// pages/alerts/alerts.js —— P03 告警列表（规格书 12.1 P03 / 13.1 告警分级 / 13.3 抑制与去重）
const data = require('../../utils/data.js')
const engine = require('../../utils/engine.js')
const spec = require('../../utils/spec.js')
const nav = require('../../utils/nav.js')

/** 级别筛选（chip 一） */
const LEVEL_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'info', label: '提示' },
  { key: 'warn', label: '警告' },
  { key: 'critical', label: '紧急' },
]

/** 状态筛选（chip 二） */
const STATUS_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'unacked', label: '未处理' },
  { key: 'acked', label: '已确认' },
  { key: 'cleared', label: '已恢复' },
]

/** 级别 → 徽标配色（info 蓝 / warn 橙 / critical 红） */
const LEVEL_BADGE = { info: 'badge-blue', warn: 'badge-orange', critical: 'badge-red' }

const EMPTY_STAT = {
  total: 0,
  active: 0,
  critical: 0,
  warn: 0,
  info: 0,
  unacked: 0,
  acked: 0,
  cleared: 0,
}

Page({
  data: {
    loading: true,
    barnKey: '',
    barnName: '',
    allBarns: false,
    level: 'all',
    status: 'all',
    levelOptions: LEVEL_OPTIONS,
    statusOptions: STATUS_OPTIONS,
    stat: EMPTY_STAT,
    list: [],
    canAck: false,
    ackReason: '',
    dedupWindow: spec.ALARM_DEDUP.suppressWindow,
    dedupKey: spec.ALARM_DEDUP.dedupKey,
  },

  onLoad() {
    nav.skeletonBegin(this)
    // tab 页：未选蚕房自动回跳选择页
    if (!nav.ensureBarn()) return
    const perm = data.can('ackAlarm')
    this.setData({ canAck: !!perm.ok, ackReason: perm.reason || '' })
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

  /** 汇总统计 + 按筛选条件取列表（订阅引擎后统一走这里） */
  refresh() {
    const b = data.getCurrentBarn()
    if (!b) {
      this.setData({ stat: EMPTY_STAT, list: [] })
      // 兜底：没有当前蚕房时也要收掉骨架屏，避免一直停在加载态
      nav.skeletonDone(this)
      return
    }
    const perm = data.can('ackAlarm')
    // 切到「全部蚕房」时 getAlarms / getAlarmStats 传 null
    const scope = this.data.allBarns ? null : b.barn
    const list = data.getAlarms(scope, { level: this.data.level, status: this.data.status })
    this.setData({
      barnKey: b.barn,
      barnName: b.name,
      canAck: !!perm.ok,
      ackReason: perm.reason || '',
      stat: data.getAlarmStats(scope),
      list: list.map((a) =>
        Object.assign({}, a, {
          levelBadge: LEVEL_BADGE[a.level] || 'badge-gray',
          statusBadge: 'badge-' + (a.statusTone || 'gray'),
        })
      ),
    })

    // 首次数据构建完成（所有 setData 之后）：关闭骨架屏
    nav.skeletonDone(this)
  },

  onLevelTap(e) {
    this.setData({ level: e.currentTarget.dataset.key })
    this.refresh()
  },

  onStatusTap(e) {
    this.setData({ status: e.currentTarget.dataset.key })
    this.refresh()
  },

  /** 当前蚕房 / 全部蚕房 切换 */
  onToggleScope() {
    this.setData({ allBarns: !this.data.allBarns })
    this.refresh()
  },

  /** 点击条目 → 告警详情 */
  onOpenAlarm(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/alarm-detail/alarm-detail?id=' + encodeURIComponent(id) })
  },

  /** 单条确认（条目内 catchtap，阻止冒泡到详情跳转） */
  onAckOne(e) {
    if (!this.data.canAck) {
      wx.showToast({ title: this.data.ackReason || '当前角色无权执行该操作', icon: 'none' })
      return
    }
    const res = engine.ackAlarm(e.currentTarget.dataset.id, '')
    wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
    this.refresh()
  },

  /** 批量确认（engine.ackAll 按蚕房范围执行） */
  onAckAll() {
    if (!this.data.canAck) {
      wx.showToast({ title: this.data.ackReason || '当前角色无权执行该操作', icon: 'none' })
      return
    }
    wx.showModal({
      title: '批量确认告警',
      content: '将确认「' + this.data.barnName + '」全部未处理告警，确认继续？',
      confirmText: '确认',
      success: (r) => {
        if (!r.confirm) return
        const res = engine.ackAll(this.data.barnKey)
        wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        this.refresh()
      },
    })
  },
})
