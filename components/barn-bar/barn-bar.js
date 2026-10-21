/**
 * components/barn-bar —— 顶部「当前蚕房 / 控制区」信息条
 * 显示 蚕房名 · 区号 · 品种 · 龄期 · 实时温湿度 · 控制模式 · 切换入口
 */

const data = require('../../utils/data.js')
const engine = require('../../utils/engine.js')

Component({
  properties: {
    /** 切换后要回到的页面路径（tab 页用 switchTab 回跳） */
    from: { type: String, value: '' },
    /** 是否显示右侧实时温湿度 */
    showMetrics: { type: Boolean, value: true },
  },

  data: {
    info: null,
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
        this.setData({ info: null })
        return
      }
      const range = data.getTarget(b.barn)
      const out = data.getOutOfRange(b.barn)
      this.setData({
        info: {
          barn: b.barn,
          zone: b.zone,
          name: b.name,
          area: b.area,
          online: b.online,
          temp: b.temp.toFixed(1),
          humi: b.humi.toFixed(1),
          tempOut: out.temp,
          humiOut: out.humi,
          modeName: data.modeName(b.mode),
          modeTone: data.modeTone(b.mode),
          varietyName: data.varietyName(b.variety),
          instarName: data.instarName(b.instar),
          targetText: range.tempText + ' / ' + range.humiText,
        },
      })
    },

    onSwitch() {
      wx.navigateTo({
        url: '/pages/room-select/room-select?from=' + encodeURIComponent(this.data.from || ''),
      })
    },
  },
})
