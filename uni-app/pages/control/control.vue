<template>
  <view class="page-wrap">
    <!-- pages/control/control.wxml —— P04 手动控制（规格书 12.1 P04 / 7.2 / 7.5 / 7.6 / 7.7 / 11.6） -->
    <barn-bar from="/pages/control/control" />

    <!-- 加载态：骨架屏 -->
    <skeleton v-if="loading" :rows="3" />

    <view v-if="!loading" class="page-body">

      <!-- ============ 模式卡 ============ -->
      <view v-if="st" class="card">
        <view class="card-header">
          <text class="card-title">当前控制模式</text>
          <text class="card-sub">{{st.barn}} / {{st.zone}}</text>
          <text :class="'badge mode-' + (st.modeTone) + ' card-right'">{{st.modeName}}</text>
        </view>
        <template v-if="modeInfo">
          <view class="mode-behavior">{{modeInfo.behavior}}</view>
          <view class="kv-row">
            <text class="kv-label">进入条件</text>
            <text class="kv-value">{{modeInfo.enter}}</text>
          </view>
          <view class="kv-row">
            <text class="kv-label">退出条件</text>
            <text class="kv-value">{{modeInfo.exit}}</text>
          </view>
        </template>
        <view v-if="st.mode === 'manual'" class="manual-count">
          <text>手动模式剩余 </text>
          <text class="mono text-warn">{{manualLeftText}}</text>
          <text class="text-sub">（超过 30 min 自动退回自动调控）</text>
        </view>
      </view>

      <!-- ============ 安全锁定提示卡 ============ -->
      <view v-if="interlock" class="card lock-card">
        <view class="card-header">
          <text class="card-title text-danger">⛔ 安全锁定生效（SAFE_LOCK）</text>
          <text class="badge badge-red card-right">{{interlock.code}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">联锁项</text>
          <text class="kv-value text-danger">{{interlock.name}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">触发原因</text>
          <text class="kv-value">{{interlock.reason}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">发生时间</text>
          <text class="kv-value">{{interlockAtText}}</text>
        </view>
        <view class="tip">危险负载已强制断电，须管理员现场确认后解除。</view>
        <view :class="'btn-danger btn-full ' + (permUnlock.ok ? '' : 'btn-disabled')" @tap="onUnlock">解除安全锁定</view>
        <view v-if="showUnlock" class="unlock-box">
          <input class="memo-input" :value="unlockReason" @input="onUnlockReason" placeholder="请填写解除原因（必填，写入审计日志）" />
          <view class="btn-row">
            <view class="btn-ghost" @tap="onUnlockCancel">取消</view>
            <view class="btn-primary" @tap="onUnlockSubmit">提交解除</view>
          </view>
        </view>
      </view>

      <!-- ============ 设备控制卡（4 台） ============ -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">设备控制</text>
          <text class="card-sub">共 {{devices.length}} 台</text>
        </view>
        <view class="tip">雾化片与风扇不可同时开启；加热片与风扇同时开启最多 5 min。</view>
        <view class="divider"></view>

        <view v-for="(item, index) in devices" :key="item.id" class="list-item">
          <view class="list-main" @tap="goDevice" :data-id="item.id">
            <view class="list-name">
              <view :class="'dot ' + (item.on ? 'dot-green' : 'dot-gray')"></view>
              {{item.name}}
              <text class="tag-solid dev-kind">{{item.kindName}}</text>
            </view>
            <view class="list-meta">{{item.id}} · {{item.model}}</view>
            <view class="list-meta">
              <text :class="item.on ? 'text-ok' : 'text-sub'">{{item.stateText}}</text>
              <text class="text-sub"> · 累计运行 {{item.runtimeText}} · 今日启停 {{item.switchesToday}} 次</text>
            </view>
            <view class="list-meta text-sub">最近启停 {{item.lastSwitchText}}</view>
            <view v-if="item.locked" class="list-meta text-danger">🔒 {{item.lockText}}</view>
            <view v-if="item.faultCode" class="list-meta text-danger">故障码 {{item.faultCode}}</view>
          </view>
          <view class="list-tail">
            <view :class="'sw-btn ' + (item.on ? 'sw-on' : '') + ' ' + (item.disabled ? 'btn-disabled' : '')" @tap="onToggleDevice" :data-id="item.id">{{item.actionText}}</view>
          </view>
        </view>
        <view v-if="devices.length === 0" class="empty">当前蚕房暂无可控设备</view>
        <view class="tip">点设备名看详情；开关需二次确认。</view>
      </view>

      <!-- ============ 机械化设备入口（空调/排气扇/投叶漏斗/抓取机/码垛机） ============ -->
      <view class="card" @tap="goMachine">
        <view class="card-header">
          <text class="card-title">机械化设备</text>
          <text class="card-more">进入 ›</text>
        </view>
        <view class="tip">空调 / 排气扇 / 投叶漏斗 / 抓取机 / 码垛机，各有预设工作范围，超范围需人工修正。</view>
        <view v-if="mSummary">
          <view class="kv-row"><text class="kv-label">运行中</text><text class="kv-value">{{mSummary.on}} / {{mSummary.total}} 台</text></view>
          <view class="kv-row"><text class="kv-label">参数越界</text><text :class="'kv-value ' + (mSummary.outOfPreset > 0 ? 'text-danger' : '')">{{mSummary.outOfPreset}} 项</text></view>
          <view class="kv-row"><text class="kv-label">待裁定病蚕</text><text :class="'kv-value ' + (mSummary.pending > 0 ? 'text-warn' : '')">{{mSummary.pending}} 箔</text></view>
          <view class="kv-row"><text class="kv-label">需人为干涉</text><text :class="'kv-value ' + (mSummary.needHuman > 0 ? 'text-danger' : 'text-ok')">{{mSummary.needHuman}} 项</text></view>
        </view>
      </view>

      <!-- ============ 审批令牌区 ============ -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">审批令牌 ACTION_TOKEN</text>
          <text class="card-sub">5 min 内单次有效</text>
        </view>
        <view class="tip">操作员手动开关须携带管理员签发的令牌；维护模式免令牌。</view>
        <view v-if="lastTokenId" class="token-issued">本次签发令牌：<text class="mono text-ok">{{lastTokenId}}</text></view>
        <view class="divider"></view>

        <!-- 管理员：签发令牌 -->
        <template v-if="isAdmin">
          <view class="section-title">签发令牌（管理员）</view>
          <view class="chip-row">
            <view v-for="(item, index) in tokenTargets" :key="item.id" :class="'chip ' + (issueTarget === item.id ? 'chip-on' : '')" @tap="onIssueTarget" :data-id="item.id">{{item.name}}</view>
          </view>
          <input class="memo-input" :value="issueMemo" @input="onIssueMemo" placeholder="备注（可选，写入审计日志）" />
          <view class="btn-primary btn-full" @tap="onIssueToken">签发令牌</view>
        </template>

        <!-- 非管理员：填写令牌 -->
        <template v-else>
          <view class="section-title">填写令牌（操作员）</view>
          <input class="memo-input" :value="tokenInput" @input="onTokenInput" placeholder="粘贴管理员签发的 ACTION_TOKEN" />
          <view class="tip">令牌 5 min 内单次有效，且限设备与动作。</view>
        </template>

        <view class="divider"></view>

        <!-- 令牌列表 -->
        <view class="section-title">令牌列表（{{tokens.length}}）</view>
        <view v-for="(item, index) in tokens" :key="item.id" class="list-item">
          <view class="list-main">
            <view class="list-name mono">{{item.id}}</view>
            <view class="list-meta">适用 {{item.barn}} / {{item.zone}} · 目标 {{item.target}} · 动作 {{item.action}}</view>
            <view class="list-meta">签发 {{item.issuedText}} · 到期 {{item.expireText}}</view>
            <view class="list-meta">签发人 {{item.issuedBy}}</view>
          </view>
          <view class="list-tail">
            <view :class="'badge ' + (item.statusText === '有效' ? 'badge-green' : (item.statusText === '已过期' ? 'badge-gray' : 'badge-blue'))">{{item.statusText}}</view>
            <view class="list-meta">剩余 {{item.remainText}}</view>
            <view v-if="isAdmin && !item.used" class="revoke-btn" @tap="onRevokeToken" :data-id="item.id">撤销</view>
          </view>
        </view>
        <view v-if="tokens.length === 0" class="empty">暂无令牌，管理员签发后操作员方可执行手动开关</view>
      </view>

      <!-- ============ 模式操作按钮 ============ -->
      <view v-if="st" class="card">
        <view class="card-header">
          <text class="card-title">模式操作</text>
          <text class="card-sub">当前 {{st.modeName}}</text>
        </view>
        <input v-if="permMaint.ok" class="memo-input" :value="maintMemo" @input="onMaintMemo" placeholder="维护备注（可选，写入审计日志）" />
        <view v-if="!permMaint.ok" class="tip">{{permMaint.reason}}，无法切换维护模式。</view>
        <view class="btn-row">
          <view :class="'btn-ghost ' + (st.mode === 'manual' ? '' : 'btn-disabled')" @tap="onExitManual">退出手动模式</view>
          <view :class="'btn-primary ' + (permMaint.ok ? '' : 'btn-disabled')" @tap="onToggleMaint">{{st.mode === 'maint' ? '退出维护模式' : '进入维护模式'}}</view>
        </view>
        <view class="tip">手动开关、解除锁定、模式切换均需二次确认。</view>
      </view>

      <!-- ============ 安全联锁说明卡 ============ -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">安全联锁说明</text>
          <text class="card-more" @tap="onToggleIl">{{ilOpen ? '收起' : '展开 S1~S6'}}</text>
        </view>
        <template v-if="ilOpen">
        <view v-for="(item, index) in interlocks" :key="item.code" class="il-row">
          <view class="il-head">
            <text :class="'il-code ' + (item.danger ? 'il-danger' : '')">{{item.code}}</text>
            <text :class="'il-name ' + (item.danger ? 'text-danger' : '')">{{item.name}}</text>
            <text v-if="item.danger" class="badge badge-red il-tag">进入 SAFE_LOCK</text>
          </view>
          <view class="tip">触发条件：{{item.trigger}}</view>
          <view class="tip">联锁动作：{{item.action}}</view>
          <view class="tip">解除条件：{{item.release}}</view>
        </view>
        </template>
        <view v-else class="tip">展开查看每条联锁的触发条件、动作与解除条件。</view>
      </view>

    </view>
  </view>
</template>

<script>
import { mpPage } from '@/utils/uni-shim.js'
// pages/control/control.js —— P04 手动控制（主要角色：管理员、操作员）
import * as data from '@/utils/data.js'
import * as engine from '@/utils/engine.js'
import * as spec from '@/utils/spec.js'
import * as nav from '@/utils/nav.js'
import * as clamp from '@/utils/clamp.js'
import * as live from '@/utils/live.js'
import * as auth from '@/utils/auth.js'

/** S1~S4 会进入 SAFE_LOCK，说明卡中标红 */
const SAFE_LOCK_CODES = ['S1', 'S2', 'S3', 'S4']

export default mpPage({
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
    clamp.startPolling(this._barn || this.barnKey, this._clampTick)
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
    const ms = this.mSummary || {}
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
    const st = this.st
    if (!st || st.mode !== 'manual') return
    const left = Math.max(0, this.manualLeftSec - 1)
    this.setData({ manualLeftSec: left, manualLeftText: data.formatDuration(left) })
  },

  refresh() {
    const barnKey = this._barn || this.barnKey
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
    const clampPending = this.clampPending || 0
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
    const barnKey = this._barn || this.barnKey
    const dev = this.devices.filter((d) => d.id === id)[0]
    if (!dev) return
    if (!this.permManual.ok) {
      uni.showToast({ title: this.permManual.reason || '当前角色无权执行手动控制', icon: 'none' })
      return
    }
    if (!dev.canSwitch) {
      uni.showToast({ title: dev.locked ? (dev.lockText || '设备已联锁锁定') : '当前状态不允许远端手动控制', icon: 'none' })
      return
    }
    const tokenId = (this.tokenInput || '').trim()
    if (this.permManual.needToken && !tokenId) {
      uni.showToast({ title: '操作员需先填写管理员签发的 ACTION_TOKEN', icon: 'none' })
      return
    }
    const content = '确认要' + dev.actionText + '「' + dev.name + '（' + dev.id + '）」吗？'
      + (this.permManual.needToken ? '\n将消耗令牌 ' + tokenId + '（单次有效）' : '')
    uni.showModal({
      title: '手动控制确认',
      content,
      confirmText: '确认下发',
      success: (r) => {
        if (!r.confirm) return
        /* 登录后走真实下发接口 POST /control/manual；未登录走本机模拟 */
        if (live.enabled()) {
          live.toggle(barnKey, id, !dev.on, { token: tokenId }).then((res) => {
            uni.showToast({
              title: res.ok ? (res.mode === 'manual' ? '已下发，进入手动模式' : '指令已下发') : res.message,
              icon: res.ok ? 'success' : 'none',
            })
            if (res.ok) this.setData({ tokenInput: '' })
            setTimeout(() => this.refresh(), 1200)
          })
          return
        }
        const res = engine.toggleDevice(barnKey, id, tokenId)
        uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) this.setData({ tokenInput: '' })
        this.refresh()
      },
    })
  },

  goDevice(e) {
    const id = e.currentTarget.dataset.id
    uni.navigateTo({ url: '/pages/device-detail/device-detail?id=' + id })
  },

  goMachine() {
    uni.navigateTo({ url: '/pages/machine/machine' })
  },

  /** 安全联锁说明默认收起，避免页面信息过载 */
  onToggleIl() {
    this.setData({ ilOpen: !this.ilOpen })
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
    const barnKey = this._barn || this.barnKey
    if (!this.isAdmin) {
      uni.showToast({ title: '审批令牌只能由管理员签发', icon: 'none' })
      return
    }
    /* 登录后令牌由后端签发（POST /control/tokens）；未登录走本机模拟 */
    if (auth.isLoggedIn()) {
      auth.issueToken({ target: this.issueTarget, action: 'manual', memo: this.issueMemo }).then((res) => {
        uni.showToast({ title: res.ok ? '令牌已签发' : res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) {
          this.setData({ lastTokenId: res.token ? res.token.id : '', issueMemo: '' })
          this.refresh()
        }
      })
      return
    }
    const res = engine.issueToken(barnKey, this.issueTarget, 'toggle', this.issueMemo)
    uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
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
    const barnKey = this._barn || this.barnKey
    uni.showModal({
      title: '撤销令牌',
      content: '确认撤销令牌 ' + id + '？撤销后立即作废。',
      confirmText: '确认下发',
      success: (r) => {
        if (!r.confirm) return
        const res = engine.revokeToken(barnKey, id)
        uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        this.refresh()
      },
    })
  },

  /* ---------------- 模式操作 ---------------- */
  onExitManual() {
    const barnKey = this._barn || this.barnKey
    const st = this.st
    if (!st || st.mode !== 'manual') {
      uni.showToast({ title: '当前不在手动模式', icon: 'none' })
      return
    }
    uni.showModal({
      title: '退出手动模式',
      content: '退出后设备交回『' + (st.online ? '自动' : '离线自治') + '』调控。确认退出？',
      confirmText: '确认下发',
      success: (r) => {
        if (!r.confirm) return
        if (live.enabled()) {
          live.exitManual(barnKey).then((res) => {
            uni.showToast({ title: res.ok ? '已退出手动模式' : res.message, icon: res.ok ? 'success' : 'none' })
            setTimeout(() => this.refresh(), 1200)
          })
          return
        }
        const res = engine.exitManual(barnKey)
        uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        this.refresh()
      },
    })
  },

  onMaintMemo(e) {
    this.setData({ maintMemo: e.detail.value })
  },

  onToggleMaint() {
    const barnKey = this._barn || this.barnKey
    const st = this.st
    if (!this.permMaint.ok) {
      uni.showToast({ title: this.permMaint.reason || '仅管理员可切换维护模式', icon: 'none' })
      return
    }
    if (!st) return
    const on = st.mode !== 'maint'
    const memo = (this.maintMemo || '').trim()
    uni.showModal({
      title: on ? '进入维护模式' : '退出维护模式',
      content: on
        ? '维护模式不下发自动指令、抑制非 critical 告警，需管理员操作。确认进入？'
        : '退出维护模式后将回到『' + (st.online ? '自动' : '离线自治') + '』。确认退出？',
      confirmText: '确认下发',
      success: (r) => {
        if (!r.confirm) return
        const res = engine.switchMaintenance(barnKey, on, memo)
        uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
        if (res.ok) this.setData({ maintMemo: '' })
        this.refresh()
      },
    })
  },

  /* ---------------- 解除安全锁定（二次确认 + 必填原因） ---------------- */
  onUnlock() {
    const st = this.st
    if (!this.permUnlock.ok) {
      uni.showToast({ title: this.permUnlock.reason || '仅管理员可解除安全锁定', icon: 'none' })
      return
    }
    if (!st || st.mode !== 'safe_lock') {
      uni.showToast({ title: '当前不在安全锁定状态', icon: 'none' })
      return
    }
    uni.showModal({
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
    const barnKey = this._barn || this.barnKey
    const reason = (this.unlockReason || '').trim()
    if (!reason) {
      uni.showToast({ title: '请填写解除安全锁定的原因', icon: 'none' })
      return
    }
    const res = engine.unlockSafety(barnKey, reason)
    uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
    if (res.ok) this.setData({ showUnlock: false, unlockReason: '' })
    this.refresh()
  },
})
</script>

<style>
/* control.wxss（与原生小程序工程逐字节一致） */
/* pages/control/control.wxss —— 仅补充全局样式未覆盖的新类 */

/* 模式徽标：.badge.mode-* 提高优先级，避免与全局 .mode-* 卡片底色冲突 */
.badge.mode-green { background: #e7f9f1; color: #10b981; }
.badge.mode-orange { background: #fef4e6; color: #f59e0b; }
.badge.mode-blue { background: #eaf0ff; color: #3d6df2; }
.badge.mode-red { background: #fdecec; color: #ef4444; }
.badge.mode-gray { background: #eef1f5; color: #8a94a6; }

.card-right { margin-left: auto; }

/* 模式行为说明 */
.mode-behavior {
  margin: 12rpx 0 8rpx;
  padding: 16rpx 20rpx;
  background: #f7f9fc;
  border-radius: 12rpx;
  font-size: 24rpx;
  line-height: 1.6;
  color: #5b6472;
}

/* 手动倒计时 */
.manual-count {
  margin-top: 16rpx;
  padding: 16rpx 20rpx;
  background: #fff7e6;
  border-radius: 12rpx;
  font-size: 26rpx;
  color: #8a5a00;
}
.manual-count .mono { font-size: 32rpx; font-weight: 700; }

/* 安全锁定卡 */
.lock-card {
  border: 2rpx solid #ef4444;
  background: #fff5f5;
}
.lock-card .card-title { color: #c0392b; }
.unlock-box {
  margin-top: 16rpx;
  padding-top: 16rpx;
  border-top: 2rpx dashed #f0b3b3;
}

/* 通用备注 / 令牌输入框 */
.memo-input {
  margin: 12rpx 0;
  padding: 18rpx 24rpx;
  background: #f4f6f9;
  border-radius: 12rpx;
  font-size: 26rpx;
  color: #2c3542;
}

/* 通栏按钮（.btn-row 之外使用） */
.btn-full {
  display: block;
  margin: 16rpx 0;
  text-align: center;
}

/* 设备行 */
.dev-kind { margin-left: 12rpx; }
.sw-btn {
  min-width: 120rpx;
  padding: 14rpx 26rpx;
  border-radius: 999rpx;
  text-align: center;
  font-size: 26rpx;
  font-weight: 600;
  color: #3d6df2;
  background: #eaf0ff;
  border: 2rpx solid #c9d9ff;
}
.sw-btn.sw-on {
  color: #10b981;
  background: #e7f9f1;
  border-color: #b8ecd6;
}

/* 令牌 */
.token-issued {
  margin-top: 12rpx;
  padding: 16rpx 20rpx;
  background: #e7f9f1;
  border-radius: 12rpx;
  font-size: 26rpx;
  color: #0f7a58;
}
.revoke-btn {
  margin-top: 8rpx;
  padding: 8rpx 20rpx;
  border-radius: 999rpx;
  font-size: 22rpx;
  color: #ef4444;
  background: #fdecec;
  border: 2rpx solid #f7c6c6;
  text-align: center;
}

/* 联锁说明 */
.il-row {
  padding: 20rpx 0;
  border-bottom: 2rpx solid #f0f2f5;
}
.il-row:last-child { border-bottom: none; }
.il-head {
  display: flex;
  align-items: center;
}
.il-code {
  min-width: 64rpx;
  margin-right: 12rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  font-size: 24rpx;
  font-weight: 700;
  text-align: center;
  color: #5b6472;
  background: #eef1f5;
}
.il-code.il-danger {
  color: #ffffff;
  background: #ef4444;
}
.il-name {
  font-size: 28rpx;
  font-weight: 600;
  color: #2c3542;
}
.il-tag { margin-left: auto; }
</style>
