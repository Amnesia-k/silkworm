<template>
  <view class="page-wrap">
    <!-- pages/config/config.wxml —— P05 参数配置（仅管理员可修改） -->
    <barn-bar from="/pages/config/config" />

    <skeleton v-if="loading" :rows="3" />

    <view v-if="!loading" class="page-body">

      <!-- 权限提示 -->
      <view v-if="!canConfig" class="card">
        <view class="card-header">
          <text class="card-title text-danger">无权修改调控参数</text>
          <text class="card-sub">仅管理员</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">权限校验</text>
          <text class="kv-value text-danger">{{permReason}}</text>
        </view>
        <view class="tip">仅管理员可修改；其他角色只读，可在「我的」页切换角色。</view>
      </view>

      <!-- 当前配置（data.getConfigView） -->
      <view v-if="config" class="card">
        <view class="card-header">
          <text class="card-title">当前配置</text>
          <text :class="'badge ' + (canConfig ? 'badge-green' : 'badge-gray')">{{canConfig ? '管理员可修改' : '只读模式'}}</text>
          <text class="badge badge-blue">{{config.ver}}</text>
          <text class="card-sub">{{config.updatedText}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">蚕房 / 控制区</text>
          <text class="kv-value">{{config.barn}} / {{config.zone}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">当前龄期 / 品种</text>
          <text class="kv-value">{{config.instarName}}（{{config.instar}}）/ {{config.varietyName}}（{{config.variety}}）</text>
        </view>
        <view class="divider"></view>
        <view class="kv-grid">
          <view class="kv-item">
            <view class="kv-item-label">温度目标</view>
            <view class="kv-item-value">{{config.range.tempText}}</view>
          </view>
          <view class="kv-item">
            <view class="kv-item-label">湿度目标</view>
            <view class="kv-item-value">{{config.range.humiText}}</view>
          </view>
          <view class="kv-item">
            <view class="kv-item-label">设定值（区间中心）</view>
            <view class="kv-item-value">{{config.range.tSet}}<text class="kv-item-unit">℃</text> / {{config.range.hSet}}<text class="kv-item-unit">%RH</text></view>
          </view>
          <view class="kv-item">
            <view class="kv-item-label">容许越限</view>
            <view class="kv-item-value">{{config.range.tol}}<text class="kv-item-unit">min</text></view>
          </view>
        </view>
        <view class="divider"></view>
        <view class="kv-row">
          <text class="kv-label">最后修改人</text>
          <text class="kv-value">{{config.by}}</text>
        </view>
        <view class="kv-row">
          <text class="kv-label">变更备注</text>
          <text class="kv-value note-value">{{config.note}}</text>
        </view>
      </view>

      <!-- 目标区间编辑：龄期 / 品种（规格书 6.3 十八行表） -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">目标区间</text>
          <text class="card-sub">龄期 · 品种对照</text>
        </view>

        <view class="pick-row">
          <text class="pick-label">龄期</text>
          <view class="chip-row">
            <text v-for="(item, index) in instars" :key="item.code" :class="'chip ' + (instar === item.code ? 'chip-on' : '')" :data-code="item.code" @tap="onPickInstar">{{item.name}}</text>
          </view>
        </view>

        <view class="pick-row">
          <text class="pick-label">品种</text>
          <view class="chip-row">
            <text v-for="(item, index) in varieties" :key="item.code" :class="'chip ' + (variety === item.code ? 'chip-on' : '')" :data-code="item.code" @tap="onPickVariety">{{item.name}}</text>
          </view>
        </view>

        <view class="divider"></view>

        <view class="field-grid">
          <view class="field-row">
            <text class="field-label">温度下限</text>
            <input class="field-input" type="digit" :value="tMin" data-key="tMin" @input="onRangeInput" :disabled="!canConfig" />
            <text class="field-unit">℃</text>
          </view>
          <view class="field-row">
            <text class="field-label">温度上限</text>
            <input class="field-input" type="digit" :value="tMax" data-key="tMax" @input="onRangeInput" :disabled="!canConfig" />
            <text class="field-unit">℃</text>
          </view>
          <view class="field-row">
            <text class="field-label">湿度下限</text>
            <input class="field-input" type="digit" :value="hMin" data-key="hMin" @input="onRangeInput" :disabled="!canConfig" />
            <text class="field-unit">%RH</text>
          </view>
          <view class="field-row">
            <text class="field-label">湿度上限</text>
            <input class="field-input" type="digit" :value="hMax" data-key="hMax" @input="onRangeInput" :disabled="!canConfig" />
            <text class="field-unit">%RH</text>
          </view>
        </view>

        <view v-if="preview" class="preview-box">
          <text class="preview-line">该组合默认值：{{preview.tempText}} / {{preview.humiText}}</text>
          <text class="preview-line">{{preview.tolText}}</text>
        </view>

        <view v-if="localError" class="err-box">{{localError}}</view>
      </view>

      <!-- 控制参数（spec.CONTROL_PARAMS + engine.getParams，按 spec.PARAM_GROUPS 折成温度/湿度/保护三组） -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">控制参数</text>
          <text class="card-sub">共 {{params.length}} 项 · 分 {{paramGroups.length}} 组</text>
        </view>

        <view v-for="(g, gi) in paramGroups" :key="g.key" class="pgroup">
          <view class="pgroup-head" :data-key="g.key" @tap="onToggleGroup">
            <view class="pgroup-main">
              <text class="pgroup-name">{{g.name}}</text>
              <text class="pgroup-count">{{g.count}} 项</text>
              <text v-if="g.changedCount > 0" class="badge badge-orange">{{g.changedCount}} 项待下发</text>
            </view>
            <text :class="'pgroup-arrow ' + (g.open ? 'pgroup-arrow-on' : '')">{{g.open ? '收起' : '展开'}}</text>
          </view>
          <view v-if="!g.open" class="pgroup-sum">{{g.summary}}</view>

          <view v-if="g.open" class="pgroup-body">
            <view v-for="(item, index) in g.list" :key="item.key" class="param">
              <view class="param-head">
                <text class="param-label">{{item.label}}</text>
                <text v-if="item.changed" class="param-flag">待下发</text>
                <text :class="'param-value ' + (item.changed ? 'text-primary' : '')">{{item.showValue}}<text class="param-unit">{{item.unit}}</text></text>
              </view>
              <slider class="param-slider" :min="item.min" :max="item.max" :step="item.step" :value="item.value" activeColor="#3d6df2" backgroundColor="#eef2f8" block-size="18" :disabled="!canConfig" :data-gi="gi" :data-li="index" :data-flat="item.flat" :data-key="item.key" @changing="onParamChanging" @change="onParamChange" />
              <view class="param-foot">
                <text class="param-range">可调 {{item.minText}} ~ {{item.maxText}} {{item.unit}}</text>
                <text class="param-side">生效位置：{{item.side}}</text>
              </view>
            </view>
          </view>
        </view>

        <view v-if="paramChanged === 0" class="tip">点分组展开，拖动滑块调整参数；点「确认下发」并填写变更原因后才会写入。</view>
      </view>

      <!-- 变更原因 + 下发 -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">变更原因</text>
          <text class="card-sub">{{paramChanged > 0 ? paramChanged + ' 项待下发' : '必填'}}</text>
        </view>
        <textarea class="note-input" :value="note" maxlength="120" placeholder="例：I4→I5 转龄，按两广二号目标区间下调 1℃" @input="onNoteInput" :disabled="!canConfig" />
        <button :class="'btn-primary apply-btn ' + (canConfig ? '' : 'btn-disabled')" @tap="onApply">确认下发配置</button>
      </view>

      <!-- 历史参数版本（data.getConfigHistory） -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">历史参数版本</text>
          <text class="card-sub">共 {{history.length}} 条 · 可回滚旧版本</text>
        </view>
        <view v-if="history.length === 0" class="empty">暂无历史参数版本</view>
        <view v-for="(item, index) in history" :key="item.ver" class="list-item">
          <view class="list-main">
            <view class="list-name">版本 {{item.ver}}<text class="badge badge-gray name-badge">{{item.by}}</text></view>
            <view class="list-meta">{{item.timeText}} · {{item.rangeText}}</view>
            <view class="list-meta">变更原因：{{item.note}}</view>
          </view>
          <view class="list-tail">
            <text :class="'btn-mini ' + (canConfig ? '' : 'btn-disabled')" :data-ver="item.ver" @tap="onRollback">回滚</text>
          </view>
        </view>
      </view>

      <!-- 安全联锁（只读，spec.INTERLOCKS 前 4 条） -->
      <view class="card">
        <view class="card-header">
          <text class="card-title">安全联锁</text>
          <text class="card-sub">只读 · 优先级最高</text>
        </view>
        <view v-for="(item, index) in interlocks" :key="item.code" class="lk">
          <view class="lk-head">
            <text class="tag-solid lk-code">{{item.code}}</text>
            <text class="lk-name">{{item.name}}</text>
          </view>
          <view class="lk-line"><text class="lk-key">触发</text>{{item.trigger}}</view>
          <view class="lk-line"><text class="lk-key">动作</text>{{item.action}}</view>
        </view>
      </view>


    </view>
  </view>
</template>

<script>
import { mpPage } from '@/utils/uni-shim.js'
// pages/config/config.js —— P05 参数配置（规格书 12.1 P05，仅管理员可修改）
// 依据《环境调控规格书》2.4 / 6.3 / 7.3 / 7.5 / 7.7 / 11.5
import * as data from '@/utils/data.js'
import * as engine from '@/utils/engine.js'
import * as spec from '@/utils/spec.js'
import * as nav from '@/utils/nav.js'

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

export default mpPage({
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
    const open = this.groupOpen
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
    this.setData({ groupOpen: this.groupOpen === key ? '' : key })
  },

  onPickInstar(e) {
    this.applyPick(e.currentTarget.dataset.code, this.variety)
  },

  onPickVariety(e) {
    this.applyPick(this.instar, e.currentTarget.dataset.code)
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
    if (this.localError) this.setData({ localError: '' })
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
      uni.showToast({ title: perm.reason, icon: 'none' })
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
      uni.showToast({ title: perm.reason, icon: 'none' })
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
      uni.showToast({ title: err, icon: 'none' })
      return
    }
    const note = (this._note || '').trim()
    if (!note) {
      uni.showToast({ title: '请填写变更原因（写入 config_history）', icon: 'none' })
      return
    }
    const instar = this.instar
    const variety = this.variety
    const base = spec.getTargetRange(instar, variety)
    const changedCount = Object.keys(this._pending).length
    const content = '将下发：' + instar + '/' + variety + ' ' + tempText(tMin) + '~' + tempText(tMax) + '℃ / ' +
      numText(hMin) + '~' + numText(hMax) + '%RH（' + base.tolText + '），变更原因：' + note +
      (changedCount ? '；含 ' + changedCount + ' 项控制参数调整' : '')
    uni.showModal({
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
        uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
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
      uni.showToast({ title: perm.reason, icon: 'none' })
      return
    }
    const ver = e.currentTarget.dataset.ver
    const note = '回滚到 ' + ver
    uni.showModal({
      title: '确认回滚配置',
      content: '将把龄期/品种与目标区间回滚到版本 ' + ver + '，并写入 config_history。变更原因：' + note,
      confirmText: '确认下发',
      success: (r) => {
        if (!r.confirm) return
        const res = engine.rollbackConfig(this._barnKey, ver, note)
        uni.showToast({ title: res.message, icon: res.ok ? 'success' : 'none' })
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
</script>

<style>
/* config.wxss（与原生小程序工程逐字节一致） */
/* pages/config/config.wxss —— P05 参数配置页私有样式（配色：主蓝 #3d6df2 / 绿 #10b981 / 橙 #f59e0b / 红 #ef4444） */

/* ---------------- 顶部 ---------------- */
.hero-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 22rpx;
}

/* ---------------- 龄期 / 品种选择 ---------------- */
.pick-row {
  display: flex;
  align-items: flex-start;
  padding: 10rpx 0;
}

.pick-label {
  width: 76rpx;
  flex: none;
  font-size: 24rpx;
  color: #8b95a7;
  line-height: 56rpx;
}

.pick-row .chip-row {
  flex: 1;
  min-width: 0;
}

/* ---------------- 目标区间输入 ---------------- */
.field-grid {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
}

.field-row {
  width: 48%;
  display: flex;
  align-items: center;
  margin-bottom: 16rpx;
}

.field-label {
  font-size: 24rpx;
  color: #5b6474;
  width: 116rpx;
  flex: none;
}

.field-input {
  flex: 1;
  min-width: 0;
  height: 64rpx;
  line-height: 64rpx;
  padding: 0 18rpx;
  box-sizing: border-box;
  background: #f7f9fc;
  border: 1rpx solid #e3e9f2;
  border-radius: 12rpx;
  font-size: 26rpx;
  color: #1f2937;
  text-align: center;
}

.field-unit {
  width: 62rpx;
  flex: none;
  margin-left: 8rpx;
  font-size: 22rpx;
  color: #8b95a7;
}

.preview-box {
  background: rgba(61, 109, 242, 0.06);
  border-radius: 14rpx;
  padding: 16rpx 18rpx;
  margin-top: 6rpx;
}

.preview-line {
  display: block;
  font-size: 22rpx;
  color: #3d6df2;
  line-height: 1.6;
}

.err-box {
  margin-top: 12rpx;
  background: rgba(239, 68, 68, 0.08);
  border-radius: 14rpx;
  padding: 14rpx 18rpx;
  font-size: 24rpx;
  color: #ef4444;
}

/* ---------------- 控制参数（温度 / 湿度 / 保护 三组，可折叠） ---------------- */
.pgroup {
  border-bottom: 1rpx solid #f2f5fa;
}

.pgroup:last-child {
  border-bottom: none;
}

.pgroup-head {
  display: flex;
  align-items: center;
  padding: 22rpx 0;
}

.pgroup-main {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
}

.pgroup-name {
  font-size: 28rpx;
  font-weight: 600;
  color: #1f2937;
}

.pgroup-count {
  margin-left: 12rpx;
  font-size: 20rpx;
  color: #a8b1c0;
}

.pgroup-main .badge {
  margin-left: 12rpx;
}

.pgroup-arrow {
  font-size: 22rpx;
  color: #8b95a7;
  padding-left: 12rpx;
}

.pgroup-arrow-on {
  color: #3d6df2;
}

.pgroup-sum {
  font-size: 21rpx;
  color: #8b95a7;
  line-height: 34rpx;
  padding: 0 0 20rpx;
}

.pgroup-body {
  padding-bottom: 6rpx;
}

.pgroup-body .param:last-child {
  border-bottom: none;
  padding-bottom: 12rpx;
}

.param {
  padding: 18rpx 0;
  border-bottom: 1rpx solid #f2f5fa;
}

.param:last-child {
  border-bottom: none;
  padding-bottom: 4rpx;
}

.param-head {
  display: flex;
  align-items: center;
}

.param-label {
  font-size: 26rpx;
  color: #1f2937;
}

.param-flag {
  margin-left: 12rpx;
  padding: 0 12rpx;
  border-radius: 999rpx;
  font-size: 18rpx;
  line-height: 30rpx;
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.14);
}

.param-value {
  margin-left: auto;
  font-size: 32rpx;
  font-weight: 700;
  color: #1f2937;
}

.param-unit {
  font-size: 20rpx;
  font-weight: 400;
  color: #8b95a7;
  margin-left: 4rpx;
}

.param-slider {
  margin: 4rpx 8rpx 0;
}

.param-foot {
  display: flex;
  align-items: center;
  font-size: 20rpx;
  color: #a8b1c0;
}

.param-side {
  margin-left: auto;
}

/* ---------------- 变更原因 ---------------- */
.note-input {
  width: 100%;
  height: 160rpx;
  box-sizing: border-box;
  padding: 18rpx;
  background: #f7f9fc;
  border: 1rpx solid #e3e9f2;
  border-radius: 14rpx;
  font-size: 26rpx;
  color: #1f2937;
  line-height: 1.5;
}

.note-foot {
  margin-top: 12rpx;
}

.note-value {
  max-width: 420rpx;
  text-align: right;
}

/* ---------------- 历史版本 ---------------- */
.name-badge {
  margin-left: 12rpx;
}

.btn-mini {
  display: inline-block;
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
  border: 1rpx solid rgba(61, 109, 242, 0.4);
  background: #ffffff;
  color: #3d6df2;
  font-size: 22rpx;
  line-height: 36rpx;
}

/* ---------------- 安全联锁（只读） ---------------- */
.lk {
  padding: 16rpx 0;
  border-bottom: 1rpx solid #f2f5fa;
}

.lk:last-child {
  border-bottom: none;
  padding-bottom: 4rpx;
}

.lk-head {
  display: flex;
  align-items: center;
}

.lk-code {
  background: #ef4444;
}

.lk-name {
  margin-left: 12rpx;
  font-size: 26rpx;
  font-weight: 600;
  color: #1f2937;
}

.lk-line {
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #5b6474;
  line-height: 1.6;
}

.lk-key {
  display: inline-block;
  width: 62rpx;
  color: #8b95a7;
}

/* ---------------- 页脚 ---------------- */
.foot-tip {
  margin: 20rpx 24rpx;
}

/* ---------------- 下发按钮（卡内） ---------------- */
.apply-btn {
  width: 100%;
  margin-top: 20rpx;
}
</style>
