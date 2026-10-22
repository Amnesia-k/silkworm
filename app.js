/**
 * app.js —— 全局入口
 * 启动模拟引擎（utils/engine.js 全局定时器），各页面只订阅、不各自起定时器，
 * 保证看板 / 曲线 / 告警 / 控制各页看到的是同一时刻的同一份状态。
 */

const data = require('./utils/data.js')
const engine = require('./utils/engine.js')
const live = require('./utils/live.js')

App({
  globalData: {
    /** 当前蚕房 key，如 barn01（规格书 1.6） */
    currentBarn: '',
    /** 当前角色：admin / operator / viewer（规格书 2.4、11.5） */
    role: 'admin',
  },

  onLaunch() {
    const b = data.getCurrentBarn()
    this.globalData.currentBarn = b ? b.barn : ''
    this.globalData.role = data.getState().role
    engine.start()
    // 已登录 = 实时数据：轮询 barn-api 的 realtime / alarms，写入 data.js 实机覆盖层；
    // 未登录 = 演示模式：页面读本机模拟引擎，不发任何网络请求。
    if (live.enabled() && this.globalData.currentBarn) live.start(this.globalData.currentBarn)
  },

  onShow() {
    engine.start()
    if (live.enabled() && this.globalData.currentBarn) live.start(this.globalData.currentBarn)
  },

  onHide() {
    engine.stop()
    live.stop()
  },

  onError(err) {
    console.error('[app error]', err)
  },
})
