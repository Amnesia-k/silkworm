/**
 * app.js —— 全局入口
 * 启动模拟引擎（utils/engine.js 全局定时器），各页面只订阅、不各自起定时器，
 * 保证看板 / 曲线 / 告警 / 控制各页看到的是同一时刻的同一份状态。
 */

const data = require('./utils/data.js')
const engine = require('./utils/engine.js')
const gateway = require('./utils/gateway.js')

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
    // 实机对接（预留）：默认 sim 模式下 start() 直接返回 false，不发起任何网络请求；
    // 切到 live 后按配置走 WebSocket 推送或 HTTP 轮询，数据写入 utils/data.js 的实机覆盖层。
    gateway.start()
  },

  onShow() {
    engine.start()
    gateway.start()
  },

  onHide() {
    engine.stop()
    gateway.stop()
  },

  onError(err) {
    console.error('[app error]', err)
  },
})
