<template>
  <view class="page-wrap">
    <!-- 加载态：骨架屏（barn-bar 在 page 之内，随 page 一起隐藏） -->
    <skeleton v-if="loading" :rows="3" />

    <view v-if="!loading" class="page">
      <barn-bar from="/pages/machine/machine" />

      <!-- 安全状态条：只在安全锁定 / 离线 / 传感器失效时出现 -->
      <safety-bar from="/pages/machine/machine" />

      <!-- 概要 -->
      <view class="card">
        <view class="card-header">
          <view>
            <view class="card-title">机械化设备</view>
            <view class="card-sub">空调加热 · 排气扇换气 · 投叶漏斗 · 抓取机 · 码垛机</view>
          </view>
          <view class="card-more" @tap="goControl">环境控制 ›</view>
        </view>

        <view class="mini-grid">
          <view class="mini-tile">
            <text class="mini-num">{{summary.on}}/{{summary.total}}</text>
            <text class="mini-cap">运行中</text>
          </view>
          <view :class="'mini-tile ' + (summary.outOfPreset ? 'warn' : '')">
            <text class="mini-num">{{summary.outOfPreset}}</text>
            <text class="mini-cap">参数越界</text>
          </view>
          <view :class="'mini-tile ' + (summary.pending ? 'warn' : '')">
            <text class="mini-num">{{summary.pending}}</text>
            <text class="mini-cap">待裁定病蚕</text>
          </view>
        </view>

        <view v-if="canManual.needToken" class="token-row">
          <input class="token-input" :value="tokenInput" @input="onTokenInput" placeholder="操作员填写 ACTION_TOKEN" />
        </view>

        <view class="tip">每台设备都有预设工作范围，实际参数低于下限或超出上限即为「需人为干涉」。</view>
      </view>

      <!-- 病蚕识别记录：后端接口 GET /barns/{barn}/diseased -->
      <view class="card">
        <view class="card-header">
          <view>
            <view class="card-title">病蚕识别记录</view>
            <view class="card-sub">放行后由服务端自动下发夹取{{clampSyncText !== '--' ? ' · 更新 ' + clampSyncText : ''}}</view>
          </view>
          <view class="card-more" @tap="onRefreshClamp">刷新 ›</view>
        </view>

        <view v-if="!clampOk" class="api-warn">
          <text class="api-warn-text">接口异常：{{clampMsg}}</text>
          <text class="api-warn-act" @tap="goMine">去配置 ›</text>
        </view>

        <view v-if="diseased.length === 0" class="empty">{{clampOk ? '暂无待裁定病蚕' : '接口未连通，暂无数据'}}</view>

        <view v-for="(item, index) in diseased" :key="item.id" class="dz-row">
          <view v-if="item.image" class="dz-thumb-wrap">
            <image class="dz-thumb" :src="item.image" mode="aspectFill" lazy-load :data-id="item.id" :data-src="item.image" @tap="onPreviewImage" />
          </view>
          <view class="dz-main">
            <view class="dz-pos">
              <text>{{item.display}}</text>
              <text class="dz-count">疑似 {{item.count}} 头</text>
            </view>
            <view class="dz-meta">{{item.timeText}} · 置信度 {{item.confText}}{{item.agoText ? ' · ' + item.agoText : ''}}</view>
            <view v-if="item.causeText" class="dz-meta">{{item.causeText}}</view>
            <view v-if="item.envText" class="dz-env">{{item.envText}}</view>
            <view class="dz-badges">
              <text :class="'badge ' + (item.statusTone)">{{item.statusText}}</text>
              <text :class="'badge ' + (item.clampTone)">{{item.clampText}}</text>
              <text class="badge badge-gray">{{item.gradeText}}</text>
            </view>

            <view v-if="item.canConfirm" class="dz-verdict">
              <view :class="'vbar ' + (confirmingId === item.id ? 'is-busy' : '')" :data-id="item.id" @longpress="onConfirmYes" @tap="onReleaseHint">
                <text class="vbar-text">{{confirmingId === item.id ? '正在下发…' : '长按放行'}}</text>
                <text class="vbar-sub">{{confirmingId === item.id ? '等服务器回执' : '将下发夹取并码垛'}}</text>
              </view>
              <view class="vlink" :data-id="item.id" @tap="onConfirmNo">忽略这一条，下一轮再判</view>
            </view>
          </view>
        </view>
      </view>

      <!-- 夹取作业：后端接口 GET /barns/{barn}/clamp/jobs -->
      <view v-if="jobs.length" class="card">
        <view class="card-header">
          <view>
            <view class="card-title">夹取作业</view>
            <view class="card-sub">只有「已放到位」才代表机械真的把箔放到传送带上</view>
          </view>
        </view>
        <view v-for="(item, index) in jobs" :key="item.id" class="job-item">
          <view class="job-head">
            <text class="job-pos">{{item.display}}</text>
            <text :class="'badge ' + (item.statusTone)">{{item.statusText}}</text>
          </view>
          <view class="job-line">{{item.sourceText}} · {{item.startedText}}{{item.durationText ? ' · 用时 ' + item.durationText : ''}}</view>
          <view v-if="item.reason" class="job-line">{{item.reason}}</view>
          <view class="job-foot"><text :class="'badge ' + (item.placedTone)">{{item.placedText}}</text></view>
        </view>
      </view>

      <!-- 机械列表 -->
      <view v-for="(item, index) in list" :key="item.id" class="card">
        <view class="card-header">
          <view>
            <view class="card-title">{{item.name}}<text class="dev-kind">{{item.kindName}}</text></view>
            <view class="card-sub">{{item.model}}</view>
          </view>
          <view :class="'badge ' + (item.on ? 'badge-green' : 'badge-gray')">{{item.stateText}}</view>
        </view>

        <view class="m-spec">{{item.spec}}</view>
        <view class="kv-row"><text class="kv-label">运行时长</text><text class="kv-value">{{item.runtimeText}}</text></view>
        <view class="kv-row"><text class="kv-label">今日启停</text><text class="kv-value">{{item.switchesToday}} 次 · 最近 {{item.lastSwitchText}}</text></view>
        <view v-if="item.lastCycleText !== '--'" class="kv-row"><text class="kv-label">最近作业</text><text class="kv-value">{{item.lastCycleText}}</text></view>

        <!-- 工作参数与预设范围 -->
        <view class="m-sec">
          <view class="m-sec-title">工作参数 · 预设范围</view>
          <view v-for="(p, index) in item.params" :key="p.key" class="p-row" :data-m="item.id" :data-k="p.key" @tap="onEditParam">
            <view class="p-main">
              <view class="p-label">{{p.label}}</view>
              <view class="p-preset">预设 {{p.presetText}}</view>
            </view>
            <view class="p-side">
              <view :class="'p-val ' + (p.ok ? '' : 'p-out')">{{p.text}}</view>
              <view :class="'badge ' + (p.ok ? 'badge-gray' : 'badge-orange')">{{p.ok ? '范围内' : (p.dir === 'low' ? '不够' : '超出')}}</view>
            </view>
          </view>
          <view :class="'tip ' + (item.needHuman ? 'tip-warn' : '')">{{item.outText}}{{item.needHuman ? '，需人为干涉修正' : ''}}</view>
        </view>

        <!-- 参数变更记录 -->
        <view v-if="item.paramLog.length" class="m-sec">
          <view class="m-sec-title">参数变更记录</view>
          <view v-for="(l, index) in item.paramLog" :key="l.at" class="log-row">
            <text class="log-time">{{l.timeText}}</text>
            <text class="log-text">{{l.text}}</text>
          </view>
        </view>

        <view class="btn-row">
          <view :class="(item.on ? 'btn-danger' : 'btn-primary') + ' btn-flex'" :data-id="item.id" @tap="onToggle">{{item.on ? '停止' : '启动'}}{{item.name}}</view>
        </view>
      </view>

      <view class="foot-tip">管理员可直接操作，操作员需管理员签发的令牌；安全锁定期间仅排气扇可运行。病蚕放行后由服务端自动下发夹取，坐标范围为 1~3 列、1 排、1~4 层。</view>
    </view>

    <!-- 参数编辑弹层 -->
    <view v-if="edit" class="mask" @tap="onCloseEdit"></view>
    <view v-if="edit" class="sheet">
      <view class="sheet-title">{{edit.name}} · {{edit.label}}</view>
      <view class="sheet-sub">当前 {{edit.value}} {{edit.unit}} · 硬件允许 {{edit.min}} ~ {{edit.max}} {{edit.unit}} · 预设 {{edit.presetLo}} ~ {{edit.presetHi}} {{edit.unit}}</view>

      <view class="sheet-field">
        <text class="sheet-label">新的工作参数（{{edit.unit}}）</text>
        <input class="sheet-input" type="digit" :value="editInput" @input="onEditInput" placeholder="输入数值" />
      </view>
      <view class="sheet-field">
        <text class="sheet-label">人工干涉原因（超出预设范围时必填）</text>
        <input class="sheet-input" :value="editNote" @input="onNoteInput" placeholder="如：5 龄蚕食量大，按技术员要求加量" />
      </view>

      <view v-if="canConfig" class="sheet-field">
        <text class="sheet-label">预设工作范围（仅管理员可调）</text>
        <view class="sheet-double">
          <input class="sheet-input half" type="digit" :value="editLo" @input="onLoInput" placeholder="下限" />
          <input class="sheet-input half" type="digit" :value="editHi" @input="onHiInput" placeholder="上限" />
        </view>
      </view>

      <view class="sheet-tip">修改会记录「谁、何时、改前改后、原因」，并写入审计日志。</view>
      <view class="sheet-btns">
        <view class="btn-ghost" @tap="onCloseEdit">取消</view>
        <view class="btn-primary" @tap="onSaveParam">保存参数</view>
      </view>
      <view v-if="canConfig" class="sheet-btns">
        <view class="btn-ghost btn-flex" @tap="onSavePreset">仅修改预设范围</view>
      </view>
    </view>
  </view>
</template>

<script>
import { mpPage } from '@/utils/uni-shim.js'
// pages/machine/machine.js —— 机械化设备
//
// 数据来源分两段（交付单 v1.0 只给了病蚕/夹取这 3 个接口）：
//   ① 病蚕识别记录 + 夹取作业：后端接口 utils/clamp.js（真实数据，轮询刷新）
//   ② 5 台机械的运行状态与参数预设：本机模拟 utils/engine.js（后端暂无对应接口）
// 人工裁定「放行」后由服务端自动下发夹取，App 不再自己输入坐标启动作业。
import * as data from '@/utils/data.js'
import * as engine from '@/utils/engine.js'
import * as clamp from '@/utils/clamp.js'
import * as nav from '@/utils/nav.js'

export default mpPage({
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
    clamp.startPolling(this._barn || this.barnKey, this._clampTick)
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
    clamp.refreshAll(this._barn || this.barnKey)
    uni.stopPullDownRefresh()
  },

  refresh() {
    const key = this._barn || this.barnKey
    if (!key) { nav.skeletonDone(this); return }
    const s = engine.getMachineSummary(key)
    const st = data.getStatusSummary(key)
    const pending = (this.diseased || []).length
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
    if (this.edit) this.syncEdit(key)

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
      summary: Object.assign({}, this.summary, {
        pending: pending,
        needHuman: (this.summary.outOfPreset || 0) + pending,
      }),
    })
    nav.skeletonDone(this)
  },

  /** 手动刷新（接口异常时给用户的出口） */
  onRefreshClamp() {
    uni.showLoading({ title: '刷新中…', mask: true })
    clamp.refreshAll(this._barn || this.barnKey).then((p) => {
      uni.hideLoading()
      this.applyClamp(p)
      if (p.ok) uni.showToast({ title: '已刷新', icon: 'success' })
      else uni.showToast({ title: '刷新失败：' + (p.message || p.code), icon: 'none', duration: 2600 })
    })
  },

  /* ---------------- 人工裁定（放行 / 忽略本轮） ---------------- */
  /** 轻点「放行」只提示手势，真正下发必须长按（防止拇指滚动误触到唯一不可逆动作） */
  onReleaseHint() {
    uni.showToast({ title: '长按 0.8 秒才能放行', icon: 'none', duration: 1600 })
  },

  onConfirmYes(e) {
    // 长按触发：先震一下，让手指确认「这一下真的算数」
    if (uni.vibrateShort) {
      try {
        uni.vibrateShort({ type: 'heavy' })
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
    const item = (this.diseased || []).filter((x) => x.id === id)[0]
    if (!item) return
    if (!this.canConfirmRole) {
      uni.showToast({ title: data.can('manual').reason || '当前角色无权裁定', icon: 'none' })
      return
    }
    if (this.confirmingId) {
      uni.showToast({ title: '正在下发，请稍候', icon: 'none' })
      return
    }
    const isYes = decision === 'yes'
    uni.showModal({
      title: isYes ? '确认放行该病蚕箔' : '忽略本轮识别',
      content: isYes
        ? '「' + item.display + '」（置信度 ' + item.confText + '，疑似虫 ' + item.count + ' 头）\n放行后服务端会立即下发夹取，机械会真实动作：抓取该箔 → 码放到传送带。'
        : '「' + item.display + '」本轮不做处理；下一轮识别仍可能重新推送。',
      confirmText: isYes ? '确认放行' : '确认忽略',
      confirmColor: isYes ? '#8f1d14' : '#2454c9',
      success: (r) => {
        if (!r.confirm) return
        this.setData({ confirmingId: id })
        uni.showLoading({ title: isYes ? '正在下发夹取…' : '正在提交…', mask: true })
        clamp
          .confirmDiseased(id, {
            decision: decision,
            operator: data.getRole().name,
            note: '',
          })
          .then((res) => {
            uni.hideLoading()
            this.setData({ confirmingId: '' })
            if (res.ok) {
              const d = res.data || {}
              const msg = isYes
                ? '已放行' + (d.clampTaskId ? ' · 任务 ' + d.clampTaskId : '') + ' · ' + (d.placedText || '')
                : '已忽略本轮'
              uni.showToast({ title: msg, icon: 'none', duration: 2600 })
            } else {
              uni.showToast({ title: res.message || ('裁定失败：' + res.code), icon: 'none', duration: 3000 })
            }
            // 裁定成功后立即重拉列表与作业（交付单建议）
            clamp.refreshAll(this._barn || this.barnKey).then((p) => this.applyClamp(p))
          })
      },
    })
  },

  /** 查看病蚕图片（后端给的是绝对 URL，直接预览，不再拼 baseUrl） */
  onPreviewImage(e) {
    const ds = (e.currentTarget && e.currentTarget.dataset) || {}
    const id = ds.id
    const src = ds.src
    const item = (this.diseased || []).filter((x) => x.id === id)[0]
    const urls = item && item.images && item.images.length ? item.images : (src ? [src] : [])
    if (!urls.length) return
    uni.previewImage({ current: src || urls[0], urls: urls })
  },

  /** 参数面板打开时同步最新值（不动用户正在输入的内容） */
  syncEdit(key) {
    const e = this.edit
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
    const key = this._barn || this.barnKey
    const id = e.currentTarget.dataset.id
    const m = this.list.filter((x) => x.id === id)[0]
    if (!m) return
    if (!this.canManual.ok) {
      uni.showToast({ title: this.canManual.reason || '当前角色无权控制机械', icon: 'none' })
      return
    }
    const tokenId = (this.tokenInput || '').trim()
    if (this.canManual.needToken && !tokenId) {
      uni.showToast({ title: '操作员需先填写管理员签发的 ACTION_TOKEN', icon: 'none' })
      return
    }
    const act = m.on ? '停止' : '启动'
    uni.showModal({
      title: '机械控制确认',
      content: '确认要' + act + '「' + m.name + '（' + m.id + '）」吗？'
        + (this.canManual.needToken ? '\n将消耗令牌 ' + tokenId + '（单次有效）' : ''),
      confirmText: '确认' + act,
      success: (r) => {
        if (!r.confirm) return
        const res = engine.toggleMachine(key, id, tokenId)
        uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
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
    const m = this.list.filter((x) => x.id === id)[0]
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
    const key = this._barn || this.barnKey
    const e = this.edit
    if (!e) return
    if (!this.canManual.ok) {
      uni.showToast({ title: this.canManual.reason || '当前角色无权修改参数', icon: 'none' })
      return
    }
    const v = Number(this.editInput)
    const note = (this.editNote || '').trim()
    const outOfPreset = isFinite(v) && (v < e.presetLo || v > e.presetHi)
    if (outOfPreset && !note) {
      uni.showToast({ title: '超出预设范围需填写人工干涉原因', icon: 'none' })
      return
    }
    const content = '将「' + e.name + ' · ' + e.label + '」由 ' + e.value + ' ' + e.unit + ' 改为 ' + this.editInput + ' ' + e.unit
      + (outOfPreset ? '\n该值超出预设范围（' + e.presetLo + ' ~ ' + e.presetHi + ' ' + e.unit + '），将记录为人工干涉' : '')
    uni.showModal({
      title: '参数变更确认',
      content,
      confirmText: '确认修改',
      success: (r) => {
        if (!r.confirm) return
        const res = engine.setMachineParam(key, e.id, e.key, this.editInput, note, '')
        uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) this.setData({ edit: null, editNote: '' })
        this.refresh()
      },
    })
  },

  onSavePreset() {
    const key = this._barn || this.barnKey
    const e = this.edit
    if (!e) return
    if (!this.canConfig) {
      uni.showToast({ title: '仅管理员可修改预设工作范围', icon: 'none' })
      return
    }
    const note = (this.editNote || '').trim()
    if (!note) {
      uni.showToast({ title: '修改预设范围需填写变更原因', icon: 'none' })
      return
    }
    uni.showModal({
      title: '预设范围变更确认',
      content: '「' + e.name + ' · ' + e.label + '」预设范围由 ' + e.presetLo + ' ~ ' + e.presetHi + ' ' + e.unit +
        ' 改为 ' + this.editLo + ' ~ ' + this.editHi + ' ' + e.unit + '\n变更原因：' + note,
      confirmText: '确认变更',
      success: (r) => {
        if (!r.confirm) return
        const res = engine.setMachinePreset(key, e.id, e.key, this.editLo, this.editHi, note)
        uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) this.setData({ edit: null, editNote: '' })
        this.refresh()
      },
    })
  },

  goControl() {
    uni.switchTab({ url: '/pages/control/control' })
  },

  goDevice() {
    uni.navigateTo({ url: '/pages/device-detail/device-detail?id=heat01' })
  },

  goMine() {
    uni.switchTab({ url: '/pages/mine/mine' })
  },
})
</script>

<style>
/* machine.wxss（与原生小程序工程逐字节一致） */
.page {
  padding-bottom: 40rpx;
}

/* ---------------- 概要 ---------------- */
.mini-grid {
  display: flex;
  margin-top: 16rpx;
}

.mini-tile {
  flex: 1;
  background: #f7f9fc;
  border-radius: 14rpx;
  padding: 20rpx 8rpx;
  margin-right: 14rpx;
  text-align: center;
}

.mini-tile:last-child {
  margin-right: 0;
}

.mini-tile.warn {
  background: rgba(245, 158, 11, 0.12);
}

.mini-num {
  display: block;
  font-size: 36rpx;
  font-weight: 700;
  color: #1f2937;
  line-height: 1.2;
}

.mini-tile.warn .mini-num {
  color: #f59e0b;
}

.mini-cap {
  display: block;
  font-size: 21rpx;
  color: #8b95a7;
  margin-top: 6rpx;
}

.token-row {
  margin-top: 16rpx;
}

.token-input {
  background: #f7f9fc;
  border-radius: 12rpx;
  padding: 16rpx 20rpx;
  font-size: 24rpx;
}

/* ---------------- 机械卡 ---------------- */
.dev-kind {
  font-size: 21rpx;
  color: #a8b1c0;
  margin-left: 10rpx;
}

.m-spec {
  font-size: 22rpx;
  color: #8b95a7;
  line-height: 1.6;
  padding: 12rpx 0 6rpx;
}

.m-sec {
  margin-top: 18rpx;
  border-top: 1rpx solid #f0f3f8;
  padding-top: 16rpx;
}

.m-sec-title {
  font-size: 24rpx;
  font-weight: 600;
  color: #3d4a5c;
  margin-bottom: 10rpx;
}

/* ---------------- 参数行 ---------------- */
.p-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14rpx 0;
  border-bottom: 1rpx solid #f5f7fb;
}

.p-row:last-child {
  border-bottom: none;
}

.p-main {
  flex: 1;
  min-width: 0;
}

.p-label {
  font-size: 26rpx;
  color: #253044;
}

.p-preset {
  font-size: 20rpx;
  color: #a8b1c0;
  margin-top: 4rpx;
}

.p-side {
  display: flex;
  align-items: center;
}

.p-val {
  font-size: 28rpx;
  font-weight: 600;
  color: #1f2937;
  margin-right: 12rpx;
}

.p-val.p-out {
  color: #f59e0b;
}

/* ---------------- 病蚕识别记录（后端接口） ---------------- */
.api-warn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff7ed;
  border: 1rpx solid #fed7aa;
  border-radius: 14rpx;
  padding: 14rpx 18rpx;
  margin-bottom: 12rpx;
}

.api-warn-text {
  flex: 1;
  font-size: 22rpx;
  color: #b45309;
  line-height: 1.5;
}

.api-warn-act {
  font-size: 22rpx;
  color: #f59e0b;
  font-weight: 600;
  margin-left: 12rpx;
}

.dz-row {
  display: flex;
  align-items: flex-start;
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f5f7fb;
}

.dz-row:last-child {
  border-bottom: none;
}

.dz-thumb-wrap {
  width: 132rpx;
  height: 132rpx;
  border-radius: 12rpx;
  overflow: hidden;
  background: #eef2f8;
  margin-right: 16rpx;
  flex-shrink: 0;
}

.dz-thumb {
  width: 132rpx;
  height: 132rpx;
}

.dz-main {
  flex: 1;
  min-width: 0;
}

.dz-pos {
  display: flex;
  align-items: center;
  font-size: 27rpx;
  font-weight: 600;
  color: #253044;
}

.dz-count {
  font-size: 21rpx;
  font-weight: 400;
  color: #ef4444;
  margin-left: 12rpx;
}

.dz-meta {
  font-size: 22rpx;
  color: #8b95a7;
  line-height: 1.6;
  margin-top: 4rpx;
}

.dz-env {
  font-size: 21rpx;
  color: #6b7688;
  background: #f7f9fc;
  border-radius: 10rpx;
  padding: 8rpx 12rpx;
  margin-top: 8rpx;
}

.dz-badges {
  display: flex;
  flex-wrap: wrap;
  margin-top: 10rpx;
}

.dz-badges .badge {
  margin: 0 8rpx 6rpx 0;
}

/* 裁定区：放行是「会动物理设备」的动作，做成需要长按的实底红条；
   忽略只是本轮跳过，做成一行轻量文字链，两者不再等权并排 */
.dz-verdict {
  margin-top: 14rpx;
}

.vbar {
  min-height: 96rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #8f1d14;
  border-radius: 10rpx;
  padding: 12rpx 20rpx;
  box-sizing: border-box;
}

.vbar.is-busy {
  background: #a89b93;
}

.vbar-text {
  font-size: 30rpx;
  font-weight: 600;
  color: #ffffff;
  line-height: 42rpx;
}

.vbar-sub {
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.88);
  line-height: 34rpx;
}

.vlink {
  margin-top: 6rpx;
  padding: 26rpx 0;
  font-size: 24rpx;
  color: #6b7280;
  text-align: center;
}

/* ---------------- 夹取作业 ---------------- */
.job-item {
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f5f7fb;
}

.job-item:last-child {
  border-bottom: none;
}

.job-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.job-pos {
  font-size: 27rpx;
  font-weight: 600;
  color: #253044;
}

.job-line {
  font-size: 23rpx;
  color: #6b7688;
  line-height: 1.7;
}

.job-foot {
  margin-top: 8rpx;
}

/* ---------------- 变更记录 ---------------- */
.log-row {
  display: flex;
  padding: 10rpx 0;
  border-bottom: 1rpx solid #f5f7fb;
}

.log-row:last-child {
  border-bottom: none;
}

.log-time {
  width: 150rpx;
  font-size: 20rpx;
  color: #a8b1c0;
  flex-shrink: 0;
}

.log-text {
  flex: 1;
  font-size: 22rpx;
  color: #6b7688;
  line-height: 1.5;
}

.btn-flex {
  flex: 1;
}

.foot-tip {
  margin: 8rpx 24rpx 0;
  font-size: 21rpx;
  color: #a8b1c0;
  line-height: 1.6;
}

/* ---------------- 弹层 ---------------- */
.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 90;
}

.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  background: #ffffff;
  border-radius: 24rpx 24rpx 0 0;
  padding: 32rpx 28rpx 40rpx;
  z-index: 91;
  box-shadow: 0 -8rpx 32rpx rgba(31, 41, 55, 0.14);
}

.sheet-title {
  font-size: 32rpx;
  font-weight: 700;
  color: #1f2937;
}

.sheet-sub {
  font-size: 22rpx;
  color: #8b95a7;
  margin-top: 8rpx;
  line-height: 1.6;
}

.sheet-field {
  margin-top: 24rpx;
}

.sheet-label {
  display: block;
  font-size: 23rpx;
  color: #6b7688;
  margin-bottom: 10rpx;
}

.sheet-input {
  background: #f7f9fc;
  border-radius: 12rpx;
  padding: 18rpx 20rpx;
  font-size: 26rpx;
  color: #253044;
}

.sheet-double,
.sheet-triple {
  display: flex;
}

.sheet-input.half {
  flex: 1;
  margin-right: 14rpx;
}

.sheet-input.half:last-child {
  margin-right: 0;
}

.sheet-input.third {
  flex: 1;
  margin-right: 14rpx;
  text-align: center;
}

.sheet-input.third:last-child {
  margin-right: 0;
}

.sheet-tip {
  margin-top: 20rpx;
  font-size: 21rpx;
  color: #a8b1c0;
  line-height: 1.6;
}

.sheet-btns {
  display: flex;
  margin-top: 24rpx;
}

.sheet-btns .btn-ghost,
.sheet-btns .btn-primary {
  flex: 1;
  margin-right: 16rpx;
}

.sheet-btns .btn-ghost:last-child,
.sheet-btns .btn-primary:last-child {
  margin-right: 0;
}
</style>
