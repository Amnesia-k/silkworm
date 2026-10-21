/**
 * components/skeleton —— 通用骨架屏（加载态占位）
 * 用法：<skeleton wx:if="{{loading}}" rows="3" /> / <skeleton wx:if="{{loading}}" rows="4" hero="true" />
 * rows 会收敛到 1~6，避免传入异常值时渲染出过多占位卡片。
 */
Component({
  properties: {
    rows: { type: Number, value: 3 },
    hero: { type: Boolean, value: false },
  },
  data: { rowList: [0, 1, 2] },
  observers: {},
  lifetimes: {
    attached() {
      const n = Math.max(1, Math.min(6, Number(this.data.rows) || 3))
      const list = []
      for (let i = 0; i < n; i++) list.push(i)
      this.setData({ rowList: list })
    },
  },
})
