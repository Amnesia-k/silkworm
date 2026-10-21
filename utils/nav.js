/**
 * utils/nav.js —— 蚕房上下文与页面跳转
 * 启动页为 pages/room-select（选择蚕房），未选蚕房时任何 tab 页都会回到选择页。
 */

const data = require('./data.js')

/** 五个 tab 页路径（room-select 回跳白名单） */
const TAB_ROUTES = [
  '/pages/index/index',
  '/pages/history/history',
  '/pages/alerts/alerts',
  '/pages/control/control',
  '/pages/mine/mine',
]

/** 确保已选蚕房；未选则回选择页并返回 null */
function ensureBarn() {
  const b = data.getCurrentBarn()
  if (!b) {
    wx.reLaunch({ url: '/pages/room-select/room-select' })
    return null
  }
  return b
}

/** 跳转到蚕房选择页（navigateTo，可带 from 回跳目标） */
function goSelect(from) {
  wx.navigateTo({ url: '/pages/room-select/room-select?from=' + encodeURIComponent(from || '') })
}

/** 从选择页返回：from 是 tab 页则 switchTab，否则 navigateBack */
function backFrom(from) {
  if (from && TAB_ROUTES.indexOf(from) >= 0) {
    wx.switchTab({ url: from })
  } else if (from) {
    wx.redirectTo({ url: from })
  } else {
    wx.switchTab({ url: '/pages/index/index' })
  }
}

/**
 * 骨架屏：页面 onLoad 里调用，记录进入时刻。
 * 本工程数据为同步的模拟数据，refresh() 会在首帧渲染前就跑完，
 * 若直接 setData({loading:false}) 骨架屏一帧都不会显示；因此骨架屏至少展示 SKELETON_MS。
 *
 * 两个必须遵守的约定（都踩过坑）：
 * 1) 只能用 setData 读写 loading，**不要碰 page.data**：原生小程序页面有 page.data，
 *    uni-app（Vue3）的页面实例没有 .data（只有 this.$data），一旦按 page.data 判断
 *    「存在与否」，uni-app 侧就会静默空转，loading 永远停在 true —— 表现就是
 *    「点进去一直在渲染/加载不出来」。两端的唯一共同点就是 setData。
 * 2) 骨架屏必须有兜底上限：任何页面 refresh() 抛异常或漏调 skeletonDone 时，
 *    也不能永久停在骨架屏上（SKELETON_MAX_MS 到点强制解除并打日志）。
 */
const SKELETON_MS = 420
const SKELETON_MAX_MS = 3000

/** 页面实例是否可写：两端唯一可靠的共同点是 setData */
function canWrite(page) {
  return !!page && typeof page.setData === 'function'
}

function skeletonBegin(page) {
  if (!canWrite(page)) return
  page._skAt = Date.now()
  page.setData({ loading: true })
  if (page._skTimer) clearTimeout(page._skTimer)
  page._skTimer = setTimeout(() => {
    page._skTimer = null
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[skeleton] 兜底解除骨架屏：该页 refresh() 可能抛异常或未调用 skeletonDone')
    }
    page.setData({ loading: false })
  }, SKELETON_MAX_MS)
}

/** 数据就绪后调用：满 SKELETON_MS 再隐藏骨架屏（可重复调用） */
function skeletonDone(page) {
  if (!canWrite(page)) return
  const wait = Math.max(0, SKELETON_MS - (Date.now() - (page._skAt || 0)))
  const hide = () => {
    if (page._skTimer) { clearTimeout(page._skTimer); page._skTimer = null }
    page.setData({ loading: false })
  }
  if (wait === 0) {
    hide()
    return
  }
  setTimeout(hide, wait)
}

module.exports = { TAB_ROUTES, ensureBarn, goSelect, backFrom, skeletonBegin, skeletonDone, SKELETON_MS, SKELETON_MAX_MS }

