/**
 * tools/make-icons.js —— 生成 tabBar 图标（81×81 RGBA PNG，纯 Node，无第三方依赖）
 *
 * 为什么不直接放图：工程里没有图片素材，也不能装图形库；这里用「矢量形状 + 超采样光栅化」
 * 自己算像素，再用 zlib 手写 PNG，得到的是真正的 PNG 文件，微信/HBuilderX 都能直接用。
 *
 * 产出：static/tab/{dashboard,chart,alarm,control,mine}[-on].png
 *      并同步复制到 uni-app/static/tab/（uni-app 的 tabBar 图标必须放 static/）
 * 用法：node tools/make-icons.js
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const ROOT = path.resolve(__dirname, '..')
const OUT_MP = path.join(ROOT, 'static', 'tab')
const OUT_UNI = path.join(ROOT, 'uni-app', 'static', 'tab')

const SIZE = 81          // 微信 tabBar 推荐 81 × 81
const SS = 3             // 每轴 3 倍超采样 → 每像素 9 个子样本
const COLOR_OFF = [0x9a, 0xa7, 0xc4]  // #9aa7c4
const COLOR_ON = [0x3d, 0x6d, 0xf2]   // #3d6df2
const STROKE = 6.5

/* ---------------- 形状（返回 inside(x, y) 判定函数） ---------------- */

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = t < 0 ? 0 : (t > 1 ? 1 : t)
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy))
}

function polyline(pts, w) {
  const h = w / 2
  return function (x, y) {
    for (let i = 0; i < pts.length - 1; i++) {
      if (segDist(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= h) return true
    }
    return false
  }
}

function circleStroke(cx, cy, r, w) {
  const h = w / 2
  return function (x, y) {
    const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))
    return Math.abs(d - r) <= h
  }
}

function circleFill(cx, cy, r) {
  return function (x, y) {
    return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r
  }
}

function roundRectStroke(x0, y0, w0, h0, rad, w) {
  const h = w / 2
  const x1 = x0 + w0
  const y1 = y0 + h0
  return function (x, y) {
    const cx = Math.min(Math.max(x, x0 + rad), x1 - rad)
    const cy = Math.min(Math.max(y, y0 + rad), y1 - rad)
    const insideOuter = x >= x0 - h && x <= x1 + h && y >= y0 - h && y <= y1 + h
    if (!insideOuter) return false
    // 到圆角矩形轮廓的距离：用「到最近的角圆心/边」近似
    const dq = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy))
    if (x > x0 + rad && x < x1 - rad) return Math.abs(y - y0) <= h || Math.abs(y - y1) <= h
    if (y > y0 + rad && y < y1 - rad) return Math.abs(x - x0) <= h || Math.abs(x - x1) <= h
    return Math.abs(dq - rad) <= h
  }
}

function arcPts(cx, cy, r, a0, a1, n) {
  const out = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n)
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return out
}

const D2R = Math.PI / 180

/* ---------------- 五个图标 ---------------- */
/* 坐标空间 81×81，中心 40.5 */

const ICONS = {
  // 看板：2 × 2 圆角方块
  dashboard: [
    roundRectStroke(14, 14, 24, 24, 7, STROKE),
    roundRectStroke(43, 14, 24, 24, 7, STROKE),
    roundRectStroke(14, 43, 24, 24, 7, STROKE),
    roundRectStroke(43, 43, 24, 24, 7, STROKE),
  ],
  // 曲线：折线 + 底轴
  chart: [
    polyline([[14, 66], [67, 66]], 4.5),
    polyline([[16, 52], [31, 36], [45, 46], [61, 23]], STROKE),
    circleFill(61, 23, 4),
  ],
  // 告警：铃铛 + 顶钮 + 铃舌
  alarm: [
    circleFill(40.5, 17, 3.6),
    polyline([].concat(
      [[25.5, 51]],
      arcPts(40.5, 38, 15, 180 * D2R, 360 * D2R, 18),
      [[55.5, 51]]
    ), STROKE),
    polyline([[20, 51], [61, 51]], STROKE),
    circleFill(40.5, 61, 4.2),
  ],
  // 控制：三条滑杆 + 旋钮
  control: [
    polyline([[15, 24], [66, 24]], 5),
    polyline([[15, 40.5], [66, 40.5]], 5),
    polyline([[15, 57], [66, 57]], 5),
    circleFill(30, 24, 7.5),
    circleFill(52, 40.5, 7.5),
    circleFill(36, 57, 7.5),
  ],
  // 我的：头 + 肩
  mine: [
    circleStroke(40.5, 28, 12.5, STROKE),
    polyline(arcPts(40.5, 74, 23, 200 * D2R, 340 * D2R, 20), STROKE),
  ],
}

/* ---------------- 光栅化 ---------------- */

function raster(shapes) {
  const px = Buffer.alloc(SIZE * SIZE * 4)
  const step = 1 / SS
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let hit = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) * step
          const fy = y + (sy + 0.5) * step
          for (let s = 0; s < shapes.length; s++) {
            if (shapes[s](fx, fy)) { hit++; break }
          }
        }
      }
      const alpha = Math.round((hit / (SS * SS)) * 255)
      const o = (y * SIZE + x) * 4
      px[o] = 0
      px[o + 1] = 0
      px[o + 2] = 0
      px[o + 3] = alpha
    }
  }
  return px
}

/* ---------------- PNG 编码 ---------------- */

const CRC_TABLE = (function () {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

/** maskRGB：{r,g,b} 把栅格化得到的 alpha 蒙版着色成彩色 PNG */
function encodePng(mask, rgb) {
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
  let o = 0
  for (let y = 0; y < SIZE; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < SIZE; x++) {
      const a = mask[(y * SIZE + x) * 4 + 3]
      raw[o++] = rgb[0]
      raw[o++] = rgb[1]
      raw[o++] = rgb[2]
      raw[o++] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // color type: RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ---------------- 主流程 ---------------- */

function main() {
  fs.mkdirSync(OUT_MP, { recursive: true })
  fs.mkdirSync(OUT_UNI, { recursive: true })
  const written = []
  Object.keys(ICONS).forEach((name) => {
    const mask = raster(ICONS[name])
    const targets = [
      [path.join(OUT_MP, name + '.png'), COLOR_OFF],
      [path.join(OUT_MP, name + '-on.png'), COLOR_ON],
      [path.join(OUT_UNI, name + '.png'), COLOR_OFF],
      [path.join(OUT_UNI, name + '-on.png'), COLOR_ON],
    ]
    targets.forEach(([file, rgb]) => {
      const png = encodePng(mask, rgb)
      fs.writeFileSync(file, png)
      written.push([path.relative(ROOT, file), png.length])
    })
  })
  let total = 0
  written.forEach(([f, n]) => { total += n; console.log('  ' + f + '  ' + n + ' B') })
  console.log('图标 ' + Object.keys(ICONS).length + ' 个 × 2 态 × 2 目录 = ' + written.length + ' 个文件，共 ' + total + ' B')
  if (total / written.length > 40 * 1024) console.log('警告：单个文件超过 40 KB，微信 tabBar 不允许')
}

main()
