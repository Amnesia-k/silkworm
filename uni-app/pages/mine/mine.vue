<template>
  <view class="page-wrap">
    <!-- 加载态：骨架屏（barn-bar 在 page-body 之内，随 page-body 一起隐藏） -->
    <skeleton v-if="loading" :rows="3" />

    <view v-if="!loading" class="page-body mine-page">

      <barn-bar from="/pages/mine/mine" />

      <!-- ===================== 用户与角色 ===================== -->
      <view v-if="role" class="card">
        <view class="card-header">
          <view class="card-title">用户与角色</view>
          <view class="card-more">本机演示</view>
        </view>
        <view class="user-row">
          <view class="user-avatar">{{role.name}}</view>
          <view class="user-main">
            <view class="user-name">{{role.name}}</view>
            <view class="user-desc">{{roleDesc}}</view>
          </view>
        </view>
        <view class="divider"></view>
        <view class="kv-row">
          <text class="kv-label">职责范围</text>
          <text class="kv-value">{{role.scope}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">使用终端</text>
          <text class="kv-value">{{role.terminals}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">按职责分工人数</text>
          <text class="kv-value">{{role.headcount}}</text>
        </view>

        <view class="divider"></view>
        <view class="section-title">切换角色（演示用，立即生效）</view>
        <view class="chip-row">
          <view v-for="(item, index) in roleList" :key="item.key" :class="'chip ' + (role.key === item.key ? 'chip-on' : '')" :data-key="item.key" @tap="onRole">{{item.name}}</view>
        </view>
        <view class="tip">角色切换只影响本机权限判定，真实权限由服务端下发。</view>
      </view>

      <!-- ===================== 当前蚕房 ===================== -->
      <view v-if="status" class="card">
        <view class="card-header">
          <view class="card-title">当前蚕房</view>
          <view class="card-more" @tap="onSwitchBarn">切换蚕房</view>
        </view>
        <view class="barn-row">
          <view class="barn-name">{{status.name}}</view>
          <view :class="'badge mode-' + (status.modeTone)">{{status.modeName}}</view>
          <view :class="'badge ' + (status.online ? 'badge-green' : 'badge-gray')">{{status.online ? '在线' : '离线'}}</view>
        </view>
        <view class="card-sub">{{status.barn}} · {{status.zone}} · {{status.group}} · 面积 {{status.area}} m² · {{status.instarName}} · {{status.varietyName}}</view>

        <view class="kv-grid">
          <view class="kv-item">
            <view class="kv-item-label">当前温度</view>
            <view class="kv-item-value">{{status.tempText}}<text class="kv-item-unit">℃</text></view>
          </view>
          <view class="kv-item">
            <view class="kv-item-label">当前湿度</view>
            <view class="kv-item-value">{{status.humiText}}<text class="kv-item-unit">%RH</text></view>
          </view>
          <view class="kv-item">
            <view class="kv-item-label">目标温度</view>
            <view class="kv-item-value">{{status.target.tempText}}</view>
          </view>
          <view class="kv-item">
            <view class="kv-item-label">目标湿度</view>
            <view class="kv-item-value">{{status.target.humiText}}</view>
          </view>
        </view>

        <view class="kv-row">
          <text class="kv-label">越限状态</text>
          <text :class="'kv-value ' + (status.outOfRange.inRange ? 'text-ok' : 'text-warn')">{{status.outOfRange.levelName}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">通信</text>
          <text class="kv-value">{{status.online ? status.wifiText : status.offlineText}}</text>
        </view>
        <view v-if="config" class="kv-row">
          <text class="kv-label">配置版本</text>
          <text class="kv-value mono">{{config.ver}} · {{config.updatedText}} · {{config.by}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">活跃告警</text>
          <text class="kv-value">{{status.alarms.active}} 条（紧急 {{status.alarms.critical}} / 警告 {{status.alarms.warn}} / 提示 {{status.alarms.info}}）</text>
        </view>

        <view class="divider"></view>
        <view class="section-title">设备台账（{{status.devices.on}}/{{status.devices.total}} 台运行，点击看详情）</view>
        <view class="chip-row">
          <view v-for="(d, index) in devices" :key="d.id" class="chip" :data-id="d.id" @tap="onGoDevice">{{d.name}} · {{d.stateText}}</view>
        </view>
        <view class="tip">离线时仅展示本机缓存数据：最近上报 {{status.lastReportText}}。</view>
      </view>

      <view v-if="!status" class="empty">正在读取蚕房上下文…</view>

      <!-- ===================== 功能入口 ===================== -->
      <view class="card">
        <view class="card-header">
          <view class="card-title">功能入口</view>
          <view class="card-more">P02 ~ P07</view>
        </view>
        <view v-for="(entry, index) in entries" :key="entry.key" class="list-item" :data-key="entry.key" @tap="onNav">
          <view class="list-main">
            <view class="list-name">{{entry.title}} <text class="entry-code">{{entry.code}}</text></view>
            <view class="list-meta">{{entry.sub}}</view>
          </view>
          <view class="list-tail">
            <text v-if="badges[entry.key]" class="badge badge-blue">{{badges[entry.key]}}</text>
            <text class="arrow">›</text>
          </view>
        </view>
      </view>

      <!-- ===================== 审计日志 ===================== -->
      <view class="card">
        <view class="card-header">
          <view class="card-title">审计日志</view>
          <view class="card-more" @tap="onToggleAudit">{{auditOpen ? '收起' : '展开最近 10 条'}}</view>
        </view>
        <view class="card-sub">写操作与 Agent 提问均写入审计日志，不可修改</view>

        <view v-if="auditOpen">
          <view v-if="!auditList.length" class="empty">暂无审计记录</view>
          <view v-for="(log, index) in auditList" :key="log.key" class="audit-item">
            <view class="audit-head">
              <text class="audit-time mono">{{log.timeText}}</text>
              <text class="badge badge-gray">{{log.user}}</text>
            </view>
            <view class="audit-body">
              <text class="audit-action">{{log.action}}</text>
              <text v-if="log.target" class="audit-target mono">→ {{log.target}}</text>
            </view>
            <view v-if="log.memo" class="audit-memo">备注：{{log.memo}}</view>
            <view v-if="log.tokenId" class="audit-token mono">令牌：{{log.tokenId}}</view>
          </view>
        </view>
      </view>

      <!-- ===================== 后端接口（病蚕识别 / 夹取作业） ===================== -->
      <view class="card">
        <view class="card-header">
          <view class="card-title">后端接口</view>
          <view class="card-more" @tap="onToggleApi">{{apiOpen ? '收起' : '设置'}}</view>
        </view>
        <view class="card-sub">病蚕识别与夹取作业的数据由后端提供；温湿度、曲线、告警与设备控制暂无后端接口，仍走本机模拟。</view>

        <view class="api-state">
          <text :class="'badge ' + (api.ok ? 'badge-green' : 'badge-red')">{{api.ok ? '接口正常' : '接口异常'}}</text>
          <text class="api-state-text">上次 {{api.lastSyncText}} · 请求 {{api.requests}} 次 · 待裁定 {{api.pending}} 条</text>
        </view>
        <view v-if="api.message" class="api-err">{{api.message}}</view>

        <view v-if="apiOpen">
          <view class="api-field">
            <text class="api-label">后端地址</text>
            <input class="api-input mono" :value="api.baseUrl" placeholder="http://10.66.66.1/api" data-k="baseUrl" @input="onApiInput" @blur="onApiSave" />
          </view>
          <view class="api-field">
            <text class="api-label">访问令牌</text>
            <input class="api-input mono" :value="api.token" placeholder="Bearer Token（服务端只校验非空）" data-k="token" @input="onApiInput" @blur="onApiSave" />
          </view>
          <view class="api-field">
            <text class="api-label">蚕区 zone</text>
            <input class="api-input mono" :value="api.zone" placeholder="zone01" data-k="zone" @input="onApiInput" @blur="onApiSave" />
          </view>

          <view class="btn-row">
            <view class="btn-ghost" @tap="onApiTest">测试连接</view>
            <view class="btn-ghost" @tap="onApiRefresh">立即同步</view>
            <view class="btn-ghost" @tap="onApiReset">恢复默认</view>
          </view>

          <view class="section-title">最近请求（最近 5 条）</view>
          <view v-if="apiLog.length" class="api-log">
            <view v-for="(item, index) in apiLog" :key="item.key" class="api-log-item mono">{{item.clock}} · {{item.method}} · {{item.ok ? '✓' : '✗'}} {{item.code}} · {{item.ms}}ms</view>
          </view>
          <view v-if="!apiLog.length" class="empty">暂无请求记录</view>
          <view class="tip">无推送，进入机械页后每 {{api.pollText}} 拉一次待裁定病蚕；裁定「放行」由服务端自动下发夹取，App 只看夹取作业的「已放到位」。接口见 docs/实机对接接口.md。</view>
        </view>
      </view>

      <!-- ===================== 关于 ===================== -->
      <view class="card">
        <view class="card-header">
          <view class="card-title">关于</view>
        </view>
        <view class="kv-row">
          <text class="kv-label">系统名称</text>
          <text class="kv-value">蚕房环境调控系统</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">设计依据</text>
          <text class="kv-value">《环境调控规格书》</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">配置版本</text>
          <text class="kv-value mono">{{aboutVer}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">数据来源</text>
          <text class="kv-value">病蚕/夹取：后端接口 {{api.baseUrl}}；环境数据：本机模拟引擎</text>
        </view>
        <view class="tip">演示环境：温湿度、曲线、告警与设备控制按模拟时钟推进；病蚕识别与夹取作业由后端提供（接口见 docs/实机对接接口.md）。</view>
        <view class="divider"></view>
        <view class="btn-danger btn-full" @tap="onReset">重置演示数据</view>
      </view>

    </view>
  </view>
</template>

<script>
import { mpPage } from '@/utils/uni-shim.js'
// pages/mine/mine.js —— 个人中心（tabBar 第 5 格）
//
// 数据全部来自 utils/data.js（模拟演示引擎），角色切换只影响本机权限判定
// （规格书 11.5 角色权限矩阵）；真实权限由服务端在 H5 管理后台下发。
import * as data from '@/utils/data.js'
import * as engine from '@/utils/engine.js'
import * as spec from '@/utils/spec.js'
import * as nav from '@/utils/nav.js'
import * as clamp from '@/utils/clamp.js'

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

export default mpPage({
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
      uni.showToast({ title: '当前已是' + cur.name, icon: 'none' })
      return
    }
    const r = data.setRole(key)
    this.refresh()
    uni.showToast({ title: '已切换为' + r.name + '，权限已按规格书 11.5 生效', icon: 'success' })
  },

  /* ---------------- 功能入口分发 ---------------- */
  onNav(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'config' && !this.perms.setConfig) {
      uni.showToast({ title: data.can('setConfig').reason, icon: 'none' })
      return
    }
    if (key === 'agent' && !this.perms.agent) {
      uni.showToast({ title: data.can('agent').reason, icon: 'none' })
      return
    }
    if (key === 'report' && !this.perms.report) {
      uni.showToast({ title: data.can('report').reason, icon: 'none' })
      return
    }
    if (key === 'config') {
      uni.navigateTo({ url: '/pages/config/config?from=' + encodeURIComponent('/pages/mine/mine') })
    } else if (key === 'report') {
      uni.navigateTo({ url: '/pages/report/report?from=' + encodeURIComponent('/pages/mine/mine') })
    } else if (key === 'agent') {
      uni.navigateTo({ url: '/pages/agent/agent?from=' + encodeURIComponent('/pages/mine/mine') })
    } else if (key === 'control') {
      uni.switchTab({ url: '/pages/control/control' })
    } else if (key === 'machine') {
      if (!data.can('manual').ok) {
        uni.showToast({ title: data.can('manual').reason, icon: 'none' })
        return
      }
      uni.navigateTo({ url: '/pages/machine/machine?from=' + encodeURIComponent('/pages/mine/mine') })
    } else if (key === 'alerts') {
      uni.switchTab({ url: '/pages/alerts/alerts' })
    } else if (key === 'history') {
      uni.switchTab({ url: '/pages/history/history' })
    }
  },

  /* ---------------- 审计日志展开 / 收起 ---------------- */
  onToggleAudit() {
    const open = !this.auditOpen
    const patch = { auditOpen: open }
    if (open) {
      const list = data.getAudit(this.barnKey).slice(0, 10)
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
    this.setData({ apiOpen: !this.apiOpen })
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
    if (!r.ok) uni.showToast({ title: r.message || r.code, icon: 'none' })
    this.refresh()
  },

  /** 测试连接：拉一次待裁定病蚕列表 */
  onApiTest() {
    uni.showToast({ title: '正在测试连接…', icon: 'none' })
    clamp.ping().then((r) => {
      uni.showToast({
        title: r.ok ? '连接正常 · ' + r.ms + ' ms' : (r.message || r.code),
        icon: 'none',
        duration: r.ok ? 1500 : 3000,
      })
      this.refresh()
    })
  },

  /** 立即同步一次（待裁定病蚕 + 夹取作业） */
  onApiRefresh() {
    uni.showToast({ title: '正在同步…', icon: 'none' })
    clamp.refreshAll(this.barnKey).then((p) => {
      uni.showToast({
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
    uni.showToast({ title: '已恢复默认接口配置', icon: 'success' })
  },

  /* ---------------- 关于 / 重置演示数据 ---------------- */
  onReset() {
    uni.showModal({
      title: '重置演示数据',
      content: '将清空本机演示引擎的遥测、告警、审计与配置历史，并回到默认蚕房。该操作不可撤销，确认继续？',
      confirmText: '确认下发',
      success: (r) => {
        if (!r.confirm) return
        data.resetDemo()
        if (!data.getCurrentBarn()) data.setCurrentBarn('barn01')
        this.refresh()
        uni.showToast({ title: '演示数据已重置', icon: 'success' })
      },
    })
  },

  /* ---------------- 设备台账入口（带设备 id 进设备详情） ---------------- */
  onGoDevice(e) {
    const id = e.currentTarget.dataset.id || 'heat01'
    uni.navigateTo({
      url: '/pages/device-detail/device-detail?id=' + id + '&from=' + encodeURIComponent('/pages/mine/mine'),
    })
  },
})
</script>

<style>
/* mine.wxss（与原生小程序工程逐字节一致） */
/* pages/mine/mine.wxss —— 仅补充全局样式（app.wxss）没有的个人中心专用类 */

.mine-page {
  padding-bottom: 40rpx;
}

/* ---------------- 用户与角色 ---------------- */
.user-row {
  display: flex;
  align-items: center;
  padding: 6rpx 0 14rpx;
}

.user-avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #3d6df2, #6f95ff);
  color: #ffffff;
  font-size: 22rpx;
  line-height: 88rpx;
  text-align: center;
  overflow: hidden;
  flex-shrink: 0;
}

.user-main {
  flex: 1;
  margin-left: 20rpx;
}

.user-name {
  font-size: 32rpx;
  font-weight: 600;
  color: #2d3748;
}

.user-desc {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #8b95a7;
  line-height: 30rpx;
}

/* ---------------- 当前蚕房 ---------------- */
.barn-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.barn-name {
  font-size: 32rpx;
  font-weight: 600;
  color: #2d3748;
  margin-right: 14rpx;
}

.barn-row .badge {
  margin-right: 10rpx;
}

/* ---------------- 功能入口 ---------------- */
.entry-code {
  font-size: 20rpx;
  color: #3d6df2;
  background: rgba(61, 109, 242, 0.08);
  border-radius: 8rpx;
  padding: 2rpx 8rpx;
  margin-left: 8rpx;
}

.arrow {
  margin-left: 10rpx;
  font-size: 30rpx;
  color: #c4ccd8;
}

/* ---------------- 审计日志 ---------------- */
.audit-item {
  padding: 14rpx 0;
  border-top: 1rpx solid #eef2f8;
}

.audit-item:first-child {
  border-top: none;
}

.audit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.audit-time {
  font-size: 22rpx;
  color: #8b95a7;
}

.audit-body {
  display: flex;
  align-items: baseline;
  margin-top: 6rpx;
}

.audit-action {
  font-size: 26rpx;
  color: #2d3748;
  font-weight: 500;
}

.audit-target {
  margin-left: 10rpx;
  font-size: 22rpx;
  color: #3d6df2;
}

.audit-memo,
.audit-token {
  margin-top: 4rpx;
  font-size: 22rpx;
  color: #8b95a7;
  line-height: 30rpx;
}

.audit-token {
  color: #f59e0b;
}

/* ---------------- 数据源（实机对接预留） ---------------- */
.api-state {
  display: flex;
  align-items: center;
  margin-top: 10rpx;
}

.api-state .badge {
  margin-right: 12rpx;
}

.api-state-text {
  font-size: 22rpx;
  color: #8b95a7;
}

.api-err {
  margin-top: 8rpx;
  font-size: 22rpx;
  color: #ef4444;
  line-height: 30rpx;
}

.api-field {
  margin-top: 14rpx;
}

.api-label {
  display: block;
  margin-bottom: 6rpx;
  font-size: 22rpx;
  color: #8b95a7;
}

.api-input {
  width: 100%;
  box-sizing: border-box;
  height: 68rpx;
  padding: 0 16rpx;
  font-size: 24rpx;
  color: #2d3748;
  background: #f6f8fb;
  border: 1rpx solid #e5e9f0;
  border-radius: 10rpx;
}

.api-log {
  margin-top: 8rpx;
}

.api-log-item {
  font-size: 22rpx;
  color: #5a6577;
  line-height: 34rpx;
}

/* ---------------- 通用 ---------------- */
.btn-full {
  width: 100%;
  text-align: center;
  margin-top: 8rpx;
}
</style>
