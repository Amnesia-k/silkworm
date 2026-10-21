/**
 * utils/chart.js —— 基于 Canvas 2D 的轻量图表绘制
 * 提供折线图（多序列 + 渐变填充）与环形图（donut）
 */

function getCanvas(selector, scope) {
  return new Promise((resolve, reject) => {
    const query = scope ? wx.createSelectorQuery().in(scope) : wx.createSelectorQuery()
    query
      .select(selector)
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          reject(new Error('canvas not found: ' + selector))
          return
        }
        const { node, width, height } = res[0]
        const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        const dpr = sys.pixelRatio || 2
        node.width = width * dpr
        node.height = height * dpr
        const ctx = node.getContext('2d')
        ctx.scale(dpr, dpr)
        resolve({ ctx, width, height })
      })
  })
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/**
 * 折线图
 * @param {object} canvas { ctx, width, height }
 * @param {object} opts { labels: string[], series: [{ data:number[], color:string, fill?:boolean }], yMin?, yMax?, yTicks? }
 */
function drawLineChart(canvas, opts) {
  const { ctx, width, height } = canvas
  const { labels = [], series = [], yTicks = 4 } = opts

  ctx.clearRect(0, 0, width, height)

  const padL = 34
  const padR = 12
  const padT = 14
  const padB = 24
  const plotW = width - padL - padR
  const plotH = height - padT - padB

  // 计算 y 轴范围
  let all = []
  series.forEach((s) => {
    all = all.concat(s.data)
  })
  let min = opts.yMin != null ? opts.yMin : Math.min.apply(null, all)
  let max = opts.yMax != null ? opts.yMax : Math.max.apply(null, all)
  if (min === max) {
    min -= 1
    max += 1
  }
  const pad = (max - min) * 0.12
  min -= pad
  max += pad

  const xAt = (i) => padL + (i / (labels.length - 1 || 1)) * plotW
  const yAt = (v) => padT + (1 - (v - min) / (max - min)) * plotH

  // 网格 + y 轴刻度
  ctx.strokeStyle = '#eef1f6'
  ctx.lineWidth = 1
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= yTicks; i++) {
    const v = min + ((max - min) * i) / yTicks
    const y = yAt(v)
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(width - padR, y)
    ctx.stroke()
    ctx.fillStyle = '#9aa7c4'
    ctx.fillText(v.toFixed(1), padL - 6, y)
  }

  // x 轴标签（抽 5 个）
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const step = Math.max(1, Math.floor(labels.length / 5))
  for (let i = 0; i < labels.length; i += step) {
    ctx.fillStyle = '#9aa7c4'
    ctx.fillText(labels[i], xAt(i), height - padB + 6)
  }

  // 折线 / 面积
  series.forEach((s) => {
    const pts = s.data.map((v, i) => ({ x: xAt(i), y: yAt(v) }))
    // 平滑曲线
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1]
      const p1 = pts[i]
      const cpX = (p0.x + p1.x) / 2
      ctx.bezierCurveTo(cpX, p0.y, cpX, p1.y, p1.x, p1.y)
    }
    ctx.strokeStyle = s.color
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.stroke()

    if (s.fill) {
      const grad = ctx.createLinearGradient(0, padT, 0, height - padB)
      grad.addColorStop(0, s.color + '55')
      grad.addColorStop(1, s.color + '00')
      ctx.beginPath()
      ctx.moveTo(pts[0].x, height - padB)
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]
        if (i === 0) ctx.lineTo(p.x, p.y)
        else {
          const p0 = pts[i - 1]
          const cpX = (p0.x + p.x) / 2
          ctx.bezierCurveTo(cpX, p0.y, cpX, p.y, p.x, p.y)
        }
      }
      ctx.lineTo(pts[pts.length - 1].x, height - padB)
      ctx.closePath()
      ctx.fillStyle = grad
      ctx.fill()
    }
  })
}

/**
 * 环形图（donut）
 * @param {object} canvas { ctx, width, height }
 * @param {object} opts { items: [{name, value, color}], centerTitle?, centerSub?, lineWidth? }
 */
function drawDonut(canvas, opts) {
  const { ctx, width, height } = canvas
  const { items = [], centerTitle = '', centerSub = '', lineWidth = 20 } = opts

  ctx.clearRect(0, 0, width, height)

  const total = items.reduce((sum, it) => sum + it.value, 0)
  if (!total) return

  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(width, height) / 2 - lineWidth / 2 - 4
  const gap = total > 1 ? 0.03 : 0 // 弧度间隙

  let start = -Math.PI / 2
  items.forEach((it) => {
    const angle = (it.value / total) * Math.PI * 2
    const sweep = Math.max(angle - gap, 0.02)
    ctx.beginPath()
    ctx.arc(cx, cy, radius, start + gap / 2, start + sweep - gap / 2)
    ctx.strokeStyle = it.color
    ctx.lineWidth = lineWidth
    ctx.lineCap = 'round'
    ctx.stroke()
    start += angle
  })

  // 中心文字
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#111827'
  ctx.font = 'bold 22px sans-serif'
  ctx.fillText(centerTitle, cx, cy - 10)
  ctx.fillStyle = '#8b95a7'
  ctx.font = '11px sans-serif'
  ctx.fillText(centerSub, cx, cy + 16)
}

/**
 * 温湿度双轴曲线（规格书 12.1 P02）：左轴温度℃、右轴湿度%RH，
 * 目标区间用淡色条带标出（规格书 1.3 target range），越限点用红点标注。
 * @param {object} canvas { ctx, width, height }
 * @param {object} opts { labels:string[], temp:number[], humi:number[],
 *                        range:{tMin,tMax,hMin,hMax}, showHumi?:boolean,
 *                        reveal?:number 画出比例, outMask?:number[] 越限区间, annotate?:boolean 峰谷标注 }
 */
function drawEnvChart(canvas, opts) {
  const { ctx, width, height } = canvas
  const { labels = [], temp = [], humi = [], range = null, showHumi = true } = opts
  const annotate = opts.annotate !== false // 最高 / 最低标注（默认开）
  const showAvg = opts.avg !== false // 平均温度参考线（默认开）
  // reveal：0~1，只画出曲线的前 reveal 段（进入视口后逐帧提高，形成「曲线自己长出来」的过程）
  const reveal = opts.reveal == null ? 1 : Math.max(0, Math.min(1, opts.reveal))
  const tAvg = temp.length ? temp.reduce((a, c) => a + c, 0) / temp.length : 0

  ctx.clearRect(0, 0, width, height)

  const padL = 36
  const padR = showHumi ? 38 : 12
  const padT = 16
  const padB = 26
  const plotW = width - padL - padR
  const plotH = height - padT - padB
  const n = labels.length

  // 温度轴范围：把目标区间一并纳入
  let tMin = Math.min.apply(null, temp)
  let tMax = Math.max.apply(null, temp)
  if (range) {
    tMin = Math.min(tMin, range.tMin)
    tMax = Math.max(tMax, range.tMax)
  }
  let tPad = Math.max((tMax - tMin) * 0.25, 0.6)
  const tLo = tMin - tPad
  const tHi = tMax + tPad

  let hLo = 0
  let hHi = 100
  if (showHumi && humi.length) {
    let a = Math.min.apply(null, humi)
    let b = Math.max.apply(null, humi)
    if (range) {
      a = Math.min(a, range.hMin)
      b = Math.max(b, range.hMax)
    }
    const p = Math.max((b - a) * 0.25, 3)
    hLo = Math.max(0, a - p)
    hHi = Math.min(100, b + p)
  }

  const xAt = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * plotW)
  const yT = (v) => padT + (1 - (v - tLo) / (tHi - tLo)) * plotH
  const yH = (v) => padT + (1 - (v - hLo) / (hHi - hLo)) * plotH

  // 目标区间：淡绿底色 + 上下限虚线（只标温度，湿度目标线省略以免画面杂乱）
  if (range) {
    ctx.fillStyle = 'rgba(16, 185, 129, 0.07)'
    ctx.fillRect(padL, yT(range.tMax), plotW, Math.max(1, yT(range.tMin) - yT(range.tMax)))
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.55)'
    ctx.lineWidth = 1
    ;[range.tMax, range.tMin].forEach((v) => {
      ctx.beginPath()
      ctx.moveTo(padL, yT(v))
      ctx.lineTo(padL + plotW, yT(v))
      ctx.stroke()
    })
    ctx.setLineDash([])
  }

  // 越限区间高亮底色（规格书 12.1 P02）：淡红竖条，不再逐点画红点（避免曲线杂乱）
  const mask = opts.outMask || null
  if (mask && mask.length) {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.06)'
    let s = -1
    for (let i = 0; i < n; i++) {
      const on = mask[i] ? 1 : 0
      if (on && s < 0) s = i
      if ((!on || i === n - 1) && s >= 0) {
        const e = on && i === n - 1 ? i : i - 1
        const x0 = xAt(s)
        const x1 = xAt(Math.min(e + 1, n - 1))
        ctx.fillRect(x0, padT, Math.max(2, x1 - x0), plotH)
        s = -1
      }
    }
  }

  // 网格 + 左轴（温度）
  ctx.strokeStyle = '#eef1f6'
  ctx.lineWidth = 1
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  const ticks = 4
  for (let i = 0; i <= ticks; i++) {
    const y = padT + (plotH * i) / ticks
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(padL + plotW, y)
    ctx.stroke()
    ctx.fillStyle = '#9aa7c4'
    ctx.fillText((tHi - ((tHi - tLo) * i) / ticks).toFixed(1), padL - 6, y)
    if (showHumi) {
      ctx.textAlign = 'left'
      ctx.fillText((hHi - ((hHi - hLo) * i) / ticks).toFixed(0), padL + plotW + 6, y)
      ctx.textAlign = 'right'
    }
  }

  // x 轴标签
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const step = Math.max(1, Math.floor(n / 5))
  for (let i = 0; i < n; i += step) {
    ctx.fillStyle = '#9aa7c4'
    ctx.fillText(labels[i], xAt(i), height - padB + 8)
  }

  const drawLine = (arr, yFn, color, fill) => {
    if (!arr.length) return
    const pts = arr.map((v, i) => ({ x: xAt(i), y: yFn(v) }))
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1]
      const p1 = pts[i]
      const cpX = (p0.x + p1.x) / 2
      ctx.bezierCurveTo(cpX, p0.y, cpX, p1.y, p1.x, p1.y)
    }
    ctx.strokeStyle = color
    ctx.lineWidth = 2.4
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()
    if (fill) {
      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH)
      grad.addColorStop(0, color + '44')
      grad.addColorStop(1, color + '00')
      ctx.beginPath()
      ctx.moveTo(pts[0].x, padT + plotH)
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]
        if (i === 0) ctx.lineTo(p.x, p.y)
        else {
          const p0 = pts[i - 1]
          const cpX = (p0.x + p.x) / 2
          ctx.bezierCurveTo(cpX, p0.y, cpX, p.y, p.x, p.y)
        }
      }
      ctx.lineTo(pts[pts.length - 1].x, padT + plotH)
      ctx.closePath()
      ctx.fillStyle = grad
      ctx.fill()
    }
  }

  // ---- 曲线主体：reveal < 1 时用裁剪区实现「从左向右画出」 ----
  if (reveal < 1) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, padL + plotW * reveal + 6, height)
    ctx.clip()
  }

  drawLine(temp, yT, '#3d6df2', true)
  if (showHumi) drawLine(humi, yH, '#10b981', false)

  if (reveal < 1) {
    ctx.restore()
    // 笔尖高亮点：让「正在画」这件事看得见
    const hi = Math.min(temp.length - 1, Math.round(reveal * (n - 1)))
    if (temp.length) {
      ctx.beginPath()
      ctx.arc(xAt(hi), yT(temp[hi]), 4.2, 0, Math.PI * 2)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
      ctx.lineWidth = 2.4
      ctx.strokeStyle = '#3d6df2'
      ctx.stroke()
    }
  }

  // 标注只在曲线画完之后出现（否则标注先跳出来、线还在长，看着乱）
  if (reveal < 1) return

  // 平均温度参考线（规格书 12.1 P02：平均值标注）
  if (showAvg && temp.length > 1) {
    const ya = yT(tAvg)
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = 'rgba(139, 149, 167, 0.9)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(padL, ya)
    ctx.lineTo(padL + plotW, ya)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.font = '10px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillStyle = '#6b7280'
    const avgText = '平均 ' + tAvg.toFixed(1) + '℃'
    const aw = ctx.measureText ? ctx.measureText(avgText).width : 40
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.fillRect(padL + 3, ya - 13, aw + 4, 12)
    ctx.fillStyle = '#6b7280'
    ctx.fillText(avgText, padL + 5, ya - 2)
  }

  // 峰谷标注：只标温度的最高 / 最低（湿度极值放在下方统计条里，避免画面拥挤）
  if (annotate && temp.length > 2) {
    const iMax = indexOfExtreme(temp, 'max')
    const iMin = indexOfExtreme(temp, 'min')
    labelExtreme(ctx, xAt(iMax), yT(temp[iMax]), '最高 ' + temp[iMax].toFixed(1) + '℃', '#ef4444', true)
    labelExtreme(ctx, xAt(iMin), yT(temp[iMin]), '最低 ' + temp[iMin].toFixed(1) + '℃', '#3d6df2', false)
  }
}

/**
 * 柱状图（规格书 12.1 P06 日报：逐小时越限时长）
 * @param {object} canvas { ctx, width, height }
 * @param {object} opts { labels:string[], values:number[], color?:string, unit?:string, reveal?:number }
 */
function drawBars(canvas, opts) {
  const { ctx, width, height } = canvas
  const { labels = [], values = [], color = '#3d6df2' } = opts

  ctx.clearRect(0, 0, width, height)

  const padL = 30
  const padR = 10
  const padT = 12
  const padB = 24
  const plotW = width - padL - padR
  const plotH = height - padT - padB
  const n = values.length || 1

  const maxV = Math.max.apply(null, values.concat([1]))
  const yAt = (v) => padT + (1 - v / (maxV * 1.15)) * plotH

  ctx.strokeStyle = '#eef1f6'
  ctx.lineWidth = 1
  ctx.font = '10px sans-serif'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 3; i++) {
    const y = padT + (plotH * i) / 3
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(padL + plotW, y)
    ctx.stroke()
    ctx.fillStyle = '#9aa7c4'
    ctx.fillText(Math.round((maxV * 1.15 * (3 - i)) / 3), padL - 5, y)
  }

  const reveal = opts.reveal == null ? 1 : Math.max(0, Math.min(1, opts.reveal))
  if (reveal < 1) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, padL + plotW * reveal + 4, height)
    ctx.clip()
  }

  const slot = plotW / n
  const bw = Math.max(4, slot * 0.55)
  values.forEach((v, i) => {
    const x = padL + slot * i + (slot - bw) / 2
    const y = yAt(v)
    roundRect(ctx, x, y, bw, padT + plotH - y, 3)
    ctx.fillStyle = v > 0 ? color : '#e8edf5'
    ctx.fill()
    if (i % Math.max(1, Math.floor(n / 6)) === 0) {
      ctx.fillStyle = '#9aa7c4'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(labels[i] || '', x + bw / 2, height - padB + 8)
    }
  })

  if (reveal < 1) ctx.restore()
}

/* ------------------------------------------------------------------ */
/* 可见时机 + 渐进绘制（修「进页面时曲线已画完、滚到那儿看不到出现过程」）  */
/* ------------------------------------------------------------------ */

function easeOutCubic(p) {
  return 1 - Math.pow(1 - p, 3)
}

/** 返回数组最大值/最小值的下标 */
function indexOfExtreme(arr, mode) {
  let idx = 0
  for (let i = 1; i < arr.length; i++) {
    if (mode === 'max' ? arr[i] > arr[idx] : arr[i] < arr[idx]) idx = i
  }
  return idx
}

/** 在曲线峰谷处画小圆点 + 数值标签 */
function labelExtreme(ctx, x, y, text, color, above) {
  ctx.beginPath()
  ctx.arc(x, y, 3, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.font = '11px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = above ? 'bottom' : 'top'
  const tx = Math.min(Math.max(x, 30), 9999)
  const ty = above ? y - 7 : y + 7
  // 白色垫底，保证标签压在曲线上也看得清
  const w = ctx.measureText ? ctx.measureText(text).width : 48
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)'
  ctx.fillRect(tx - w / 2 - 3, above ? ty - 12 : ty - 1, w + 6, 13)
  ctx.fillStyle = color
  ctx.fillText(text, tx, ty)
}

/**
 * 元素进入视口后才执行绘制（只触发一次）
 * @param {object} scope 页面实例（this）
 * @param {string} selector 触发元素选择器，如 '#envChartWrap'
 * @param {function} draw 绘制回调
 * @param {object} [opts] { bottom?:number 视口下边界内缩, top?:number, once?:boolean }
 * @returns {object} 观察器，可 disconnect()
 */
function whenVisible(scope, selector, draw, opts) {
  const o = opts || {}
  const once = o.once !== false
  let fired = false
  const idle = { disconnect() {} }
  // 基础库/平台不支持交叉观察器时（如 H5、App 端或旧基础库）直接绘制，保证曲线不丢
  if (typeof wx.createIntersectionObserver !== 'function') {
    draw()
    return idle
  }
  const timers = []
  const clearTimers = () => {
    while (timers.length) clearTimeout(timers.pop())
  }
  const go = () => {
    if (fired && once) return
    fired = true
    clearTimers()
    draw()
  }
  let io = null
  try {
    io = wx.createIntersectionObserver(scope, { thresholds: [0, 0.2] })
    io.relativeToViewport({
      top: o.top == null ? 0 : o.top,
      bottom: o.bottom == null ? -30 : o.bottom,
    })
  } catch (e) {
    draw()
    return idle
  }
  io.observe(selector, (res) => {
    if (!res || res.intersectionRatio <= 0) return
    go()
  })
  /* 兜底：观察器在节点尚未渲染时挂上可能永远不回调（页面 onShow 早于首次渲染），
     这里自查节点位置；最后一次机会无论是否在视口内都画出来，宁可不做动画也不能空白 */
  const check = (attempt) => {
    timers.push(
      setTimeout(() => {
        if (fired) return
        let q = wx.createSelectorQuery()
        if (scope && q.in) q = q.in(scope)
        q.select(selector)
          .boundingClientRect((rect) => {
            if (fired || !rect) {
              if (!fired && attempt < 3) check(attempt + 1)
              return
            }
            let vh = 0
            try {
              const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
              vh = (info && info.windowHeight) || 0
            } catch (e) {
              vh = 0
            }
            const inView = !vh || (rect.top < vh - 16 && rect.bottom > 0)
            if (inView || attempt >= 3) go()
            else if (attempt < 3) check(attempt + 1)
          })
          .exec()
      }, 1200),
    )
  }
  check(1)
  return {
    disconnect() {
      clearTimers()
      try {
        io.disconnect()
      } catch (e) {
        /* 忽略：部分基础库重复 disconnect 会报错 */
      }
    },
  }
}

/**
 * 渐进绘制环境曲线：每帧提高 reveal，形成从左向右画出的过程
 * @param {object} canvas chart.getCanvas 的返回值
 * @param {object} opts drawEnvChart 的参数
 * @param {number} [duration] 时长 ms（默认 760）
 * @param {function} [onDone] 画完回调
 * @returns {object} { cancel() }
 */
function drawEnvChartReveal(canvas, opts, duration, onDone) {
  const dur = duration || 760
  const t0 = Date.now()
  let timer = null
  const frame = () => {
    const p = Math.min(1, (Date.now() - t0) / dur)
    drawEnvChart(canvas, Object.assign({}, opts, { reveal: easeOutCubic(p) }))
    if (p < 1) timer = setTimeout(frame, 32)
    else if (onDone) onDone()
  }
  frame()
  return {
    cancel() {
      if (timer) clearTimeout(timer)
    },
  }
}

module.exports = {
  getCanvas,
  drawLineChart,
  drawDonut,
  drawEnvChart,
  drawEnvChartReveal,
  whenVisible,
  drawBars,
  roundRect,
}
