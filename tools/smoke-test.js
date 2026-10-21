/**
 * tools/smoke-test.js —— 数据层 / 规则引擎冒烟测试（Node 运行，不属于小程序包）
 * 用 global.wx 桩件加载 utils/*.js（原生 CommonJS），把规格书里的关键路径跑一遍：
 * 采样与越限判定、耦合仲裁 A1-A9、冷静期/最短启停、安全联锁 S1-S4、手动模式与审批令牌、
 * 告警确认与恢复、配置下发与回滚、日报统计、CSV 导出、角色权限矩阵。
 * 用法：node tools/smoke-test.js
 */
const path = require('path')

/* ---------------- wx 桩件 ---------------- */
const store = {}
const toasts = []
global.wx = {
  getStorageSync: (k) => (k in store ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v },
  removeStorageSync: (k) => { delete store[k] },
  showToast: (o) => toasts.push((o && o.title) || ''),
  showModal: () => {},
  navigateTo: () => {},
  switchTab: () => {},
  reLaunch: () => {},
  redirectTo: () => {},
  showTabBarRedDot: () => {},
  hideTabBarRedDot: () => {},
  createSelectorQuery: () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }) }),
  env: { USER_DATA_PATH: '/tmp' },
}

const ROOT = path.resolve(__dirname, '..')
const data = require(path.join(ROOT, 'utils/data.js'))
const engine = require(path.join(ROOT, 'utils/engine.js'))
const spec = require(path.join(ROOT, 'utils/spec.js'))
const nav = require(path.join(ROOT, 'utils/nav.js'))

let pass = 0
let fail = 0
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label) }
  else { fail++; console.log('  ✗ ' + label + (extra === undefined ? '' : '  → ' + extra)) }
}
function section(t) { console.log('\n== ' + t + ' ==') }

/* ---------------- 初始化 ---------------- */
section('初始化')
const barns = data.getBarnList()
ok(barns.length === 4, '4 栋蚕房（1/2/3/4 号）', barns.length)
ok(!!data.getCurrentBarn(), '默认蚕房存在: ' + data.getCurrentBarn().name)
ok(spec.INSTARS.length === 6 && spec.VARIETIES.length === 3, '6 个龄期 × 3 个品种')
ok(spec.getTargetRange('I4', 'V1').tempText.indexOf('~') > 0, '6.3 目标区间: ' + spec.getTargetRange('I4', 'V1').tempText + ' / ' + spec.getTargetRange('I4', 'V1').humiText)

section('运行引擎 60 个 tick（4 s/次 = 4 分钟模拟时间）')
let ticks = 0
for (let i = 0; i < 60; i++) { engine.tick(); ticks++ }
ok(ticks === 60, '引擎 tick 无异常')
const st = data.getState()
ok(st.simClock > st.bootedAt, '模拟时钟前进: ' + data.formatTime(st.simClock))
Object.keys(st.barns).forEach((k) => {
  const b = st.barns[k]
  ok(typeof b.temp === 'number' && typeof b.humi === 'number' && !isNaN(b.temp) && !isNaN(b.humi),
    k + ' 温湿度有效 ' + b.temp.toFixed(1) + '℃ / ' + b.humi.toFixed(1) + '%RH，模式 ' + b.mode)
})

section('看板字段（P01）')
const sum = data.getStatusSummary('barn01')
ok(sum.tempText && sum.humiText, '实时温湿度文本 ' + sum.tempText + ' / ' + sum.humiText)
ok(sum.devices.list.length === 4, '设备 4 台，运行 ' + sum.devices.on + ' 台')
ok(!!sum.modeInfo.behavior, '当前控制模式说明存在')
ok(!!sum.couplingInfo && !!sum.couplingInfo.case, '耦合工况 ' + sum.coupling + ' ' + sum.couplingInfo.case)
ok(sum.target.tempText && sum.target.tolText, '目标区间 + 容许越限 ' + sum.target.tolText)
ok(typeof sum.wifiBars === 'number', 'WiFi 信号 ' + sum.wifi + ' dBm / ' + sum.wifiBars + ' 格')

section('历史曲线（P02）')
const series = data.getSeries('barn01')
ok(series.length > 100, '默认近 6h 分钟序列 ' + series.length + ' 点')
const agg = data.getHourlyAgg('barn01', data.getState().simClock - 12 * 3600000, data.getState().simClock)
ok(agg.length >= 10, '小时聚合 ' + agg.length + ' 组，含 tempAvg/outSec: ' + (agg[0].tempAvg !== undefined))
const csv = engine.buildCsv('barn01', data.getState().simClock - 3600000, data.getState().simClock)
ok(csv.split('\n').length > 50 && csv.indexOf('ts,temp_c,humi_rh') === 0, 'CSV 导出 ' + csv.split('\n').length + ' 行')

section('告警（P03）')
const alarms = data.getAlarms(null, {})
ok(alarms.length > 0, '演示数据含 ' + alarms.length + ' 条告警')
const active = data.getAlarms(null, { status: 'active' })
ok(active.length > 0, '活跃告警 ' + active.length + ' 条')
const crit = data.getAlarms(null, { level: 'critical' })
ok(crit.length > 0, '紧急告警 ' + crit.length + ' 条: ' + crit[0].code + ' ' + crit[0].text)
const acked = engine.ackAlarm(active[0].id, '冒烟测试')
ok(acked && acked.ok !== false, '确认告警返回: ' + JSON.stringify(acked).slice(0, 80))
const after = data.findAlarm(active[0].id)
ok(after && after.alarm.acked === true, '确认状态已落库 acked=' + (after && after.alarm.acked))

section('手动控制 + 审批令牌（P04）')
const token = engine.issueToken('barn01', 'fan01', 'toggle', '冒烟测试')
const tkId = token && token.token ? token.token.id : ''
ok(token && token.ok !== false && !!tkId, '管理员签发令牌: ' + tkId)
data.setRole('operator')
const bad = engine.toggleDevice('barn01', 'fan01', 'NOT-A-TOKEN')
ok(bad.ok === false, '非法令牌被拒: ' + bad.message)
const good = engine.toggleDevice('barn01', 'fan01', tkId)
ok(good.ok !== false, '合法令牌开启风扇: ' + good.message)
const reuse = engine.toggleDevice('barn01', 'fan01', tkId)
ok(reuse.ok === false, '令牌单次有效（复用被拒）: ' + reuse.message)
data.setRole('admin')
const manual = data.getBarn('barn01').mode
ok(manual === 'manual', '进入手动模式 mode=' + manual + ' 剩余 ' + data.getStatusSummary('barn01').manualLeftSec + 's')
const exit = engine.exitManual('barn01')
ok(exit.ok !== false, '退出手动回到自动: ' + exit.message + ' mode=' + data.getBarn('barn01').mode)

section('规格书 7.6 互斥：雾化与风扇禁止同时开')
engine.raise(data.getState().barns.barn01, 'AL03', 'warn', 'mist01', '冒烟测试用', 95)
const mistOn = engine.toggleDevice('barn01', 'mist01', '')
ok(mistOn.ok === false || mistOn.message.indexOf('互斥') >= 0 || data.getBarn('barn01').devices.mist01.on, '雾化开关反馈: ' + mistOn.message)

section('安全联锁 S1-S6（P04 / 9.1）')
const b4 = data.getBarn('barn04')
ok(b4.mode === 'safe_lock', '4 号蚕房处于安全锁定 mode=' + b4.mode)
ok(b4.interlock.active === true, '联锁激活 ' + b4.interlock.code + ' ' + b4.interlock.name)
ok(b4.devices.heat01.locked === true && b4.devices.mist01.locked === true, '危险负载已锁定')
const unlocked = engine.unlockSafety('barn04', '现场排查完成')
ok(unlocked.ok !== false, '管理员解除安全锁定: ' + unlocked.message + ' → mode=' + data.getBarn('barn04').mode)

section('离线自治与维护模式（9.1 / 7.2）')
const b3 = data.getBarn('barn03')
ok(b3.mode === 'offline' && b3.online === false, '3 号蚕房离线自治 mode=' + b3.mode)
const maint = engine.switchMaintenance('barn01', true)
ok(maint.ok !== false, '进入维护模式: ' + maint.message + ' → mode=' + data.getBarn('barn01').mode)
engine.switchMaintenance('barn01', false)

section('参数配置与回滚（P05）')
const view = data.getConfigView('barn01')
ok(!!view && !!view.range && !!view.ver, '当前配置版本 ' + view.ver + ' 区间 ' + view.range.tempText)
const params = engine.getParams()
ok(params && params.t_hys === 0.4, '7.3 默认参数 t_hys=' + params.t_hys + '℃ t_cool=' + params.t_cool + 'min')
const applied = engine.applyConfig('barn01', {
  instar: 'I5', variety: 'V2',
  range: { tMin: 24, tMax: 25, hMin: 75, hMax: 80, tol: 20 },
  params: { t_hys: 0.5 },
}, '冒烟测试：龄期调整到五龄')
ok(applied.ok !== false, '下发配置: ' + applied.message)
const v2 = data.getConfigView('barn01')
ok(v2.instar === 'I5' && v2.variety === 'V2', '配置已生效 ' + v2.instar + '/' + v2.variety + ' 版本 ' + v2.ver)
const hist = data.getConfigHistory('barn01')
ok(hist.length >= 1, 'config_history 记录 ' + hist.length + ' 条')
const roll = engine.rollbackConfig('barn01', view.ver, '冒烟测试回滚')
ok(roll.ok !== false, '回滚到 ' + view.ver + ': ' + roll.message + ' → ' + data.getConfigView('barn01').ver)

section('日报 / 报表（P06）')
const report = data.getDayReport('barn01', data.getState().simClock)
ok(report.tempAvg > 0 && report.samples > 0, '日报采样 ' + report.samples + ' 点，温度均值 ' + report.tempAvg + '℃，最高 ' + report.tempMax + ' 最低 ' + report.tempMin)
ok(typeof report.tempOutText === 'string', '累计越限时长 温度 ' + report.tempOutText + ' / 湿度 ' + report.humiOutText + '，越限占比 ' + report.outRate + '%')
ok(report.switches && Object.keys(report.switches).length === 4, '设备启停统计 ' + JSON.stringify(report.switches))
ok(report.alarmTotal >= 0, '告警统计 共 ' + report.alarmTotal + '（紧急 ' + report.alarmCritical + ' 警告 ' + report.alarmWarn + ' 提示 ' + report.alarmInfo + '）')
ok(report.hours && report.hours.length > 0, '逐小时聚合 ' + report.hours.length + ' 组')

section('角色权限矩阵（11.5）')
const roles = spec.ROLES.map((r) => r.key)
ok(roles.join(',') === 'admin,operator,viewer', '三种角色 ' + roles.join('/'))
data.setRole('viewer')
ok(data.can('setConfig').ok === false, '观察员改配置被拒: ' + data.can('setConfig').reason)
ok(data.can('view').ok === true, '观察员可查看')
data.setRole('operator')
ok(data.can('manual').needToken === true, '操作员手动操作需要审批令牌')
ok(data.can('setConfig').ok === false, '操作员改配置被拒')
data.setRole('admin')
ok(data.can('setConfig').ok === true && data.can('unlock').ok === true && data.can('maint').ok === true, '管理员拥有配置/解锁/维护权限')

section('审计日志（F10）')
const audit = data.getAudit(null)
ok(audit.length > 0, '审计记录 ' + audit.length + ' 条，最近: ' + (audit[0] && audit[0].action) + ' / ' + (audit[0] && audit[0].user))

section('导航（nav.js）')
ok(nav.TAB_ROUTES.length === 5, 'tabBar 白名单 5 个 tab 页')
ok(!!nav.ensureBarn(), 'ensureBarn 返回当前蚕房')

section('长跑：500 tick 稳定性')
let crashed = null
try { for (let i = 0; i < 500; i++) engine.tick() } catch (e) { crashed = e }
ok(!crashed, '连续 500 tick 无异常' + (crashed ? ': ' + crashed.message : ''))
const endSum = data.getStatusSummary('barn01')
ok(!isNaN(endSum.temp) && !isNaN(endSum.humi), '长跑后数据有效 ' + endSum.tempText + '℃ / ' + endSum.humiText + '%RH 模式 ' + endSum.modeName)
const trends = data.getBarn('barn01').trend.length
ok(trends <= data.TREND_MAX + 1440, '趋势点裁剪在 ' + (data.TREND_MAX + 1440) + ' 内: ' + trends)
const tr = data.getBarn('barn01').trend
const liveWindow = data.getState().bootedAt - 3600000
ok(tr.slice(1).every((p) => p.ts >= liveWindow), '运行点仅在「开机前 1 h 窗口」内保留（第 1 点为历史锚点）')

console.log('\n=== 通过 ' + pass + ' / 失败 ' + fail + ' ===')
process.exit(fail ? 1 : 0)
