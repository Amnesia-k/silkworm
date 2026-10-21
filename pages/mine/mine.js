// pages/mine/mine.js —— 个人中心（tabBar 第 5 格）
//
// 数据全部来自 utils/data.js（模拟演示引擎），角色切换只影响本机权限判定
// （规格书 11.5 角色权限矩阵）；真实权限由服务端在 H5 管理后台下发。
const data = require('../../utils/data.js')
const engine = require('../../utils/engine.js')
const spec = require('../../utils/spec.js')
const nav = require('../../utils/nav.js')
const clamp = require('../../utils/clamp.js')

/** 功能入口（路由在 onNav 里按 key 分发） */
const ENTRIES = [
  { key: 'config', title: '参数配置', code: 'P05', sub: '目标区间 / 采集周期 / 告警阈值 / 执行策略' },
  { key: 'report', title: '日报报表', code: 'P06', sub: '分钟级聚合、越限统计与 CSV 导出' },
  { key: 'agent', title: 'Agent 问答', code: 'P07', sub: '只读建议与巡检报告，禁止下发控制指令' },
  { key: 'control', title: '手动控制', code: 'P04', sub: '设备开关、维护模式与安全联锁解除' },
  { key: 'machine', title: '机械化设备', code: 'P04', sub: '空调 / 排气扇 / 投叶漏斗 / 抓取机 / 码垛机 · 预设工作范围' },
  { key: 'alerts', title: '告警列表', code: 'P03', sub: '分级告警、确认与处置建议' },
  { key: 'history', title: '历史曲线', code: 'P02', sub: '温湿度趋势与越限区间回看' },
]

Page({
  data: {
    loading: true,
    barnKey: '',
    status: null,
    config: null,
    role: null,
    roleList: spec.ROLES,
    perms: { setConfig: false, report: false, agent: false, audit: false },
    /** 各入口右侧权限徽标 */
    badges: {},
    entries: ENTRIES,
    devices: [],
    auditList: [],
    auditOpen: false,
    aboutVer: '',
    roleDesc: '',
    /** 后端接口（病蚕识别 / 夹取作业，utils/clamp.js） */
    apiOpen: false,
    api: {},
    apiLog: [],
  },

  onLoad() {
    nav.skeletonBegin(this)
    if (!nav.ensureBarn()) return
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

  /* ---------------- 刷新（全局引擎每 4 s 回调一次） ---------------- */
  refresh() {
    const cur = data.getCurrentBarn()
    if (!cur) { nav.skeletonDone(this); return }
    const barnKey = cur.barn
    const role = data.getRole()
    const config = data.getConfigView(barnKey)
    this.setData({
      barnKey: barnKey,
      status: data.getStatusSummary(barnKey),
      config: config,
      role: role,
      roleList: spec.ROLES,
      perms: {
        setConfig: data.can('setConfig').ok,
        report: data.can('report').ok,
        agent: data.can('agent').ok,
        audit: data.can('audit').ok,
      },
      badges: {
        config: data.can('setConfig').ok ? '可修改' : '仅管理员',
        report: data.can('report').ok ? '可查看' : '无权限',
        agent: data.can('agent').ok ? '可提问' : '无权限',
        audit: data.can('audit').ok ? '可查看' : '仅管理员',
        machine: data.can('manual').ok ? '可操作' : '无权限',
      },
      aboutVer: config.ver,
      devices: data.getDevices(barnKey),
      roleDesc: role.scope + ' · ' + role.terminals + ' · ' + role.headcount,
      api: this.apiView(),
      apiLog: this.apiLogView(),
    })
    // 首次数据构建完成（所有 setData 之后）：关闭骨架屏
    nav.skeletonDone(this)
  },

  /* ---------------- 角色切换（规格书 11.5） ---------------- */
  onRole(e) {
    const key = e.currentTarget.dataset.key
    const cur = data.getRole()
    if (key === cur.key) {
      wx.showToast({ title: '当前已是' + cur.name, icon: 'none' })
      return
    }
    const r = data.setRole(key)
    this.refresh()
    wx.showToast({ title: '已切换为' + r.name + '，权限已按规格书 11.5 生效', icon: 'success' })
  },

  /* ---------------- 功能入口分发 ---------------- */
  onNav(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'config' && !this.data.perms.setConfig) {
      wx.showToast({ title: data.can('setConfig').reason, icon: 'none' })
      return
    }
    if (key === 'agent' && !this.data.perms.agent) {
      wx.showToast({ title: data.can('agent').reason, icon: 'none' })
      return
    }
    if (key === 'report' && !this.data.perms.report) {
      wx.showToast({ title: data.can('report').reason, icon: 'none' })
      return
    }
    if (key === 'config') {
      wx.navigateTo({ url: '/pages/config/config?from=' + encodeURIComponent('/pages/mine/mine') })
    } else if (key === 'report') {
      wx.navigateTo({ url: '/pages/report/report?from=' + encodeURIComponent('/pages/mine/mine') })
    } else if (key === 'agent') {
      wx.navigateTo({ url: '/pages/agent/agent?from=' + encodeURIComponent('/pages/mine/mine') })
    } else if (key === 'control') {
      wx.switchTab({ url: '/pages/control/control' })
    } else if (key === 'machine') {
      if (!data.can('manual').ok) {
        wx.showToast({ title: data.can('manual').reason, icon: 'none' })
        return
      }
      wx.navigateTo({ url: '/pages/machine/machine?from=' + encodeURIComponent('/pages/mine/mine') })
    } else if (key === 'alerts') {
      wx.switchTab({ url: '/pages/alerts/alerts' })
    } else if (key === 'history') {
      wx.switchTab({ url: '/pages/history/history' })
    }
  },

  /* ---------------- 审计日志展开 / 收起 ---------------- */
  onToggleAudit() {
    const open = !this.data.auditOpen
    const patch = { auditOpen: open }
    if (open) {
      const list = data.getAudit(this.data.barnKey).slice(0, 10)
      patch.auditList = list.map(function (log, i) {
        return {
          key: 'au' + i,
          timeText: data.formatTime(log.ts),
          user: log.user,
          role: log.role,
          action: log.action,
          target: log.target,
          tokenId: log.tokenId,
          memo: log.memo,
        }
      })
    }
    this.setData(patch)
  },

  /* ---------------- 切换蚕房 ---------------- */
  onSwitchBarn() {
    nav.goSelect('/pages/mine/mine')
  },

  /* ---------------- 后端接口（病蚕识别 / 夹取作业） ---------------- */
  /** 接口配置与状态视图 */
  apiView() {
    const cfg = clamp.getConfig()
    const st = clamp.getState()
    return {
      baseUrl: cfg.baseUrl,
      token: cfg.token,
      zone: cfg.zone,
      pollText: Math.round(cfg.pollMs / 1000) + ' s',
      ok: st.ok !== false,
      requests: st.requests || 0,
      lastSyncText: st.lastSyncText || '—',
      message: st.ok === false ? (st.code || '') + ' · ' + (st.message || '') : '',
      pending: (st.pending || []).length,
      jobs: (st.jobs || []).length,
    }
  },

  /** 最近请求日志（最多 5 条） */
  apiLogView() {
    return clamp.getLog(5).map(function (log, i) {
      return {
        key: 'api' + i + '-' + log.ts,
        clock: data.formatClock(log.ts),
        method: log.method,
        ok: !!log.ok,
        code: log.code || '-',
        ms: log.ms || 0,
      }
    })
  },

  onToggleApi() {
    this.setData({ apiOpen: !this.data.apiOpen })
  },

  /** 输入即回显（不落盘，失焦时保存） */
  onApiInput(e) {
    const k = e.currentTarget.dataset.k
    const patch = {}
    patch['api.' + k] = e.detail.value
    this.setData(patch)
  },

  /** 失焦保存：写入接口配置（地址与轮询间隔校验在 clamp.setConfig 内） */
  onApiSave(e) {
    const k = e.currentTarget.dataset.k
    const input = {}
    input[k] = e.detail.value
    const r = clamp.setConfig(input)
    if (!r.ok) wx.showToast({ title: r.message || r.code, icon: 'none' })
    this.refresh()
  },

  /** 测试连接：拉一次待裁定病蚕列表 */
  onApiTest() {
    wx.showToast({ title: '正在测试连接…', icon: 'none' })
    clamp.ping().then((r) => {
      wx.showToast({
        title: r.ok ? '连接正常 · ' + r.ms + ' ms' : (r.message || r.code),
        icon: 'none',
        duration: r.ok ? 1500 : 3000,
      })
      this.refresh()
    })
  },

  /** 立即同步一次（待裁定病蚕 + 夹取作业） */
  onApiRefresh() {
    wx.showToast({ title: '正在同步…', icon: 'none' })
    clamp.refreshAll(this.data.barnKey).then((p) => {
      wx.showToast({
        title: p.ok ? '已同步：待裁定 ' + (p.diseased || []).length + ' 条 · 作业 ' + (p.jobs || []).length + ' 条' : (p.message || p.code),
        icon: 'none',
        duration: 2200,
      })
      this.refresh()
    })
  },

  /** 恢复默认接口配置 */
  onApiReset() {
    clamp.resetConfig()
    this.refresh()
    wx.showToast({ title: '已恢复默认接口配置', icon: 'success' })
  },

  /* ---------------- 关于 / 重置演示数据 ---------------- */
  onReset() {
    wx.showModal({
      title: '重置演示数据',
      content: '将清空本机演示引擎的遥测、告警、审计与配置历史，并回到默认蚕房。该操作不可撤销，确认继续？',
      confirmText: '确认下发',
      success: (r) => {
        if (!r.confirm) return
        data.resetDemo()
        if (!data.getCurrentBarn()) data.setCurrentBarn('barn01')
        this.refresh()
        wx.showToast({ title: '演示数据已重置', icon: 'success' })
      },
    })
  },

  /* ---------------- 设备台账入口（带设备 id 进设备详情） ---------------- */
  onGoDevice(e) {
    const id = e.currentTarget.dataset.id || 'heat01'
    wx.navigateTo({
      url: '/pages/device-detail/device-detail?id=' + id + '&from=' + encodeURIComponent('/pages/mine/mine'),
    })
  },
})
