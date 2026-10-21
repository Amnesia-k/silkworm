// pages/config/config.js —— P05 参数配置（规格书 12.1 P05，仅管理员可修改）
// 依据《环境调控规格书》2.4 / 6.3 / 7.3 / 7.5 / 7.7 / 11.5
const data = require('../../utils/data.js')
const engine = require('../../utils/engine.js')
const spec = require('../../utils/spec.js')
const nav = require('../../utils/nav.js')

/** 数字文本（最多两位小数，去掉多余的 0） */
function numText(v) {
  const n = Number(v)
  if (isNaN(n)) return '--'
  return String(Math.round(n * 100) / 100)
}

/** 温度文本：固定一位小数（与规格书 6.3 目标区间表一致） */
function tempText(v) {
  const n = Number(v)
  if (isNaN(n)) return '--'
  return n.toFixed(1)
}

Page({
  data: {
    barnKey: '',
    loading: true,
    // 页面级权限：仅管理员可修改调控参数（规格书 2.4 / 11.5）
    canConfig: false,
    permReason: '',
    // 当前配置（data.getConfigView）
    config: null,
    // 历史版本
    history: [],
    // 龄期 / 品种 chip
    instars: [],
    varieties: [],
    instar: '',
    variety: '',
    // 目标区间编辑（首次进入或切换龄期品种时回填）
    tMin: 0,
    tMax: 0,
    hMin: 0,
    hMax: 0,
    // 所选组合的目标区间预览（spec.getTargetRange）
    preview: null,
    // 控制参数（spec.CONTROL_PARAMS + engine.getParams 当前值）
    params: [],
    // 控制参数折叠分组（spec.PARAM_GROUPS，默认只展开第一组）
    paramGroups: [],
    groupOpen: 'temp',
    paramChanged: 0,
    // 变更备注
    note: '',
    localError: '',
    // 安全联锁（只读）
    interlocks: [],
  },

  onLoad() {
    nav.skeletonBegin(this)
    const b = nav.ensureBarn()
    if (!b) return
    this._barnKey = b.barn
    this._seededBarn = ''
    this._pending = {}
    this._note = ''
    this._edit = { tMin: 0, tMax: 0, hMin: 0, hMax: 0 }
    this.setData({
      barnKey: b.barn,
      instars: spec.INSTARS.map((i) => ({ code: i.code, name: i.name })),
      varieties: spec.VARIETIES.map((v) => ({ code: v.code, name: v.name })),
      interlocks: spec.INTERLOCKS.slice(0, 4).map((s) => ({
        code: s.code,
        name: s.name,
        trigger: s.trigger,
        action: s.action,
      })),
    })
  },

  onShow() {
    const b = nav.ensureBarn()
    if (!b) return
    if (this._barnKey !== b.barn) {
      this._barnKey = b.barn
      this._seededBarn = ''
      this._pending = {}
      this._note = ''
      this.setData({ barnKey: b.barn, note: '', paramChanged: 0 })
    }
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

  /** 统一刷新：配置卡 + 历史版本随引擎刷新；编辑区只在首次进入/切换蚕房时回填 */
  refresh() {
    if (!this._barnKey) { nav.skeletonDone(this); return }
    const view = data.getConfigView(this._barnKey)
    const perm = data.can('setConfig')
    const history = data.getConfigHistory(this._barnKey).map((h) => ({
      ver: h.ver,
      timeText: data.formatTime(h.updatedAt),
      by: h.by,
      note: h.note,
      rangeText: h.instar + '/' + h.variety + ' ' + tempText(h.tMin) + '~' + tempText(h.tMax) + '℃ / ' +
        numText(h.hMin) + '~' + numText(h.hMax) + '%RH',
    }))
    const patch = {
      config: view,
      history,
      canConfig: perm.ok,
      permReason: perm.reason || '',
      params: this.buildParams(),
      paramGroups: this.buildParamGroups(),
      paramChanged: Object.keys(this._pending).length,
    }
    if (this._seededBarn !== this._barnKey && view.range) {
      this._seededBarn = this._barnKey
      this._edit = {
        tMin: view.range.tMin,
        tMax: view.range.tMax,
        hMin: view.range.hMin,
        hMax: view.range.hMax,
      }
      patch.instar = view.instar
      patch.variety = view.variety
      patch.tMin = view.range.tMin
      patch.tMax = view.range.tMax
      patch.hMin = view.range.hMin
      patch.hMax = view.range.hMax
      patch.preview = this.previewOf(view.instar, view.variety)
      patch.localError = ''
    }
    this.setData(patch)
    nav.skeletonDone(this)
  },

  /** 规格书 6.3：某一龄期-品种组合的目标区间与容许越限时长 */
  previewOf(instar, variety) {
    const r = spec.getTargetRange(instar, variety)
    return { tempText: r.tempText, humiText: r.humiText, tolText: r.tolText }
  },

  /** 控制参数行：当前值 = 本地待下发值优先，否则引擎当前值（spec.CONTROL_PARAMS[].key） */
  buildParams() {
    const live = engine.getParams()
    const pend = this._pending
    return spec.CONTROL_PARAMS.map((p, i) => {
      const changed = Object.prototype.hasOwnProperty.call(pend, p.key)
      const raw = Number(changed ? pend[p.key] : live[p.key])
      const v = isNaN(raw) ? Number(p.value) : raw
      return {
        key: p.key,
        label: p.label,
        short: p.short || p.label,
        group: p.group || '',
        flat: i,
        min: p.min,
        max: p.max,
        step: p.step,
        unit: p.unit,
        side: p.side,
        minText: numText(p.min),
        maxText: numText(p.max),
        value: v,
        showValue: numText(v),
        changed,
      }
    })
  },

  /** 折叠分组：按 spec.PARAM_GROUPS 把参数分到三组，折叠态用摘要展示当前值 */
  buildParamGroups() {
    const flat = this.buildParams()
    const open = this.data.groupOpen
    const groups = spec.PARAM_GROUPS || []
    return groups.map((g) => {
      const list = flat.filter((p) => p.group === g.key)
      return {
        key: g.key,
        name: g.name,
        desc: g.desc || '',
        count: list.length,
        changedCount: list.filter((p) => p.changed).length,
        open: open === g.key,
        summary: list.map((p) => p.short + ' ' + p.showValue + p.unit).join(' · '),
        list,
      }
    })
  },

  /** 展开/收起某一组（手风琴式：同时只展开一组） */
  onToggleGroup(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ groupOpen: this.data.groupOpen === key ? '' : key })
  },

  onPickInstar(e) {
    this.applyPick(e.currentTarget.dataset.code, this.data.variety)
  },

  onPickVariety(e) {
    this.applyPick(this.data.instar, e.currentTarget.dataset.code)
  },

  /** 选择龄期/品种后立即带出该组合的目标区间并回填输入框（规格书 6.3 十八行表） */
  applyPick(instar, variety) {
    const r = spec.getTargetRange(instar, variety)
    this._edit = { tMin: r.tMin, tMax: r.tMax, hMin: r.hMin, hMax: r.hMax }
    this.setData({
      instar,
      variety,
      tMin: r.tMin,
      tMax: r.tMax,
      hMin: r.hMin,
      hMax: r.hMax,
      preview: { tempText: r.tempText, humiText: r.humiText, tolText: r.tolText },
      localError: '',
    })
  },

  onRangeInput(e) {
    this._edit[e.currentTarget.dataset.key] = e.detail.value
    if (this.data.localError) this.setData({ localError: '' })
  },

  /** 拖动中：只更新展示值（同时写扁平 params 与分组列表，分组列表才是渲染源） */
  onParamChanging(e) {
    const ds = e.currentTarget.dataset
    const raw = Number(e.detail.value)
    const v = isNaN(raw) ? 0 : raw
    const text = numText(v)
    const patch = {}
    patch['params[' + ds.flat + '].value'] = v
    patch['params[' + ds.flat + '].showValue'] = text
    if (ds.gi !== undefined && ds.gi !== null && ds.li !== undefined && ds.li !== null) {
      patch['paramGroups[' + ds.gi + '].list[' + ds.li + '].value'] = v
      patch['paramGroups[' + ds.gi + '].list[' + ds.li + '].showValue'] = text
    }
    this.setData(patch)
  },

  /** 松手：写入本地待下发 pending 对象（不直接下发） */
  onParamChange(e) {
    const perm = data.can('setConfig')
    if (!perm.ok) {
      wx.showToast({ title: perm.reason, icon: 'none' })
      return
    }
    const ds = e.currentTarget.dataset
    const raw = Number(e.detail.value)
    const v = isNaN(raw) ? 0 : raw
    this._pending[ds.key] = v
    this.setData({
      paramChanged: Object.keys(this._pending).length,
      params: this.buildParams(),
      paramGroups: this.buildParamGroups(),
    })
  },

  onNoteInput(e) {
    this._note = e.detail.value
    // 同步到视图，保证受控输入框回显
    this.setData({ note: e.detail.value })
  },

  /** 规格书 7.7 合法性校验：温度 -10~40℃、湿度 0~100%RH、下限必须小于上限 */
  legalCheck(tMin, tMax, hMin, hMax) {
    if (isNaN(tMin) || isNaN(tMax) || isNaN(hMin) || isNaN(hMax)) return '目标区间必须填写数字'
    if (tMin < -10 || tMax > 40) return '温度超出合法范围（-10 ~ 40℃）'
    if (hMin < 0 || hMax > 100) return '湿度超出合法范围（0 ~ 100%RH）'
    if (tMin >= tMax) return '温度下限必须小于上限'
    if (hMin >= hMax) return '湿度下限必须小于上限'
    return ''
  },

  /** 下发配置：二次确认（规格书 7.7）→ engine.applyConfig */
  onApply() {
    const perm = data.can('setConfig')
    if (!perm.ok) {
      wx.showToast({ title: perm.reason, icon: 'none' })
      return
    }
    const ed = this._edit
    const tMin = Number(ed.tMin)
    const tMax = Number(ed.tMax)
    const hMin = Number(ed.hMin)
    const hMax = Number(ed.hMax)
    const err = this.legalCheck(tMin, tMax, hMin, hMax)
    if (err) {
      this.setData({ localError: err })
      wx.showToast({ title: err, icon: 'none' })
      return
    }
    const note = (this._note || '').trim()
    if (!note) {
      wx.showToast({ title: '请填写变更原因（写入 config_history）', icon: 'none' })
      return
    }
    const instar = this.data.instar
    const variety = this.data.variety
    const base = spec.getTargetRange(instar, variety)
    const changedCount = Object.keys(this._pending).length
    const content = '将下发：' + instar + '/' + variety + ' ' + tempText(tMin) + '~' + tempText(tMax) + '℃ / ' +
      numText(hMin) + '~' + numText(hMax) + '%RH（' + base.tolText + '），变更原因：' + note +
      (changedCount ? '；含 ' + changedCount + ' 项控制参数调整' : '')
    wx.showModal({
      title: '确认下发配置',
      content,
      confirmText: '确认下发',
      success: (r) => {
        if (!r.confirm) return
        const patch = {
          instar,
          variety,
          range: { tMin, tMax, hMin, hMax, tol: base.tol },
        }
        if (changedCount) patch.params = Object.assign({}, this._pending)
        const res = engine.applyConfig(this._barnKey, patch, note)
        wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) {
          this._pending = {}
          this._note = ''
          this._seededBarn = ''
          this.setData({ note: '', paramChanged: 0, localError: '' })
          this.refresh()
        }
      },
    })
  },

  /** 回滚历史版本：二次确认 → engine.rollbackConfig */
  onRollback(e) {
    const perm = data.can('setConfig')
    if (!perm.ok) {
      wx.showToast({ title: perm.reason, icon: 'none' })
      return
    }
    const ver = e.currentTarget.dataset.ver
    const note = '回滚到 ' + ver
    wx.showModal({
      title: '确认回滚配置',
      content: '将把龄期/品种与目标区间回滚到版本 ' + ver + '，并写入 config_history。变更原因：' + note,
      confirmText: '确认下发',
      success: (r) => {
        if (!r.confirm) return
        const res = engine.rollbackConfig(this._barnKey, ver, note)
        wx.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) {
          this._pending = {}
          this._note = ''
          this._seededBarn = ''
          this.setData({ note: '', paramChanged: 0, localError: '' })
          this.refresh()
        }
      },
    })
  },
})
