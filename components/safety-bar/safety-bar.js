/**
 * components/safety-bar —— 全局安全状态条
 * 只在「安全锁定 / 离线自治 / 传感器失效」时出现，压在页面最顶部。
 * 这三件事都不该藏在徽标或脚注里：蚕房已经断电或失联时，用户第一眼必须看到。
 */

const data = require('../../utils/data.js')
const engine = require('../../utils/engine.js')

Component({
  properties: {
    /** 来源页（预留，便于后续埋点或回跳） */
    from: { type: String, value: '' },
  },

  data: {
    show: false,
    tone: '',
    title: '',
    detail: '',
    act: '处理 ›',
  },

  lifetimes: {
    attached() {
      this._tick = () => this.refresh()
      engine.subscribe(this._tick)
      this.refresh()
    },
    detached() {
      engine.unsubscribe(this._tick)
    },
  },

  methods: {
    refresh() {
      const b = data.getCurrentBarn()
      if (!b) {
        if (this.data.show) this.setData({ show: false })
        return
      }
      const s = data.getStatusSummary(b.barn)
      let patch = { show: false, tone: '', title: '', detail: '', act: '处理 ›' }

      if (s.mode === 'safe_lock') {
        patch = {
          show: true,
          tone: 'red',
          title: '安全锁定 · 仅排气扇可运行',
          detail: (s.interlock && s.interlock.active && s.interlock.reason)
            ? s.interlock.reason
            : '温湿度触发硬限保护，加热与雾化已强制断电',
          act: '去解除 ›',
        }
      } else if (!s.online) {
        patch = {
          show: true,
          tone: 'slate',
          title: '离线自治' + (s.offlineText ? ' · 已 ' + s.offlineText : ''),
          detail: '与服务器失联，正按本地策略维持；设置与控制暂不可用',
          act: '查看 ›',
        }
      } else if (!s.sensorOk) {
        patch = {
          show: true,
          tone: 'amber',
          title: '传感器失效 · 已切强制通风',
          detail: '温湿度读数不可信，自动控制暂停，等待人工处理',
          act: '查看 ›',
        }
      }

      // 每 4 s 会刷新一次，内容没变就不 setData
      const sig = patch.show + '|' + patch.tone + '|' + patch.title + '|' + patch.detail
      if (sig === this._sig) return
      this._sig = sig
      this.setData(patch)
    },

    onTap() {
      wx.switchTab({ url: '/pages/control/control' })
    },
  },
})
