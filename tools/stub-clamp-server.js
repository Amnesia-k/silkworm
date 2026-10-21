/**
 * tools/stub-clamp-server.js —— 病蚕 / 裁定 / 夹取作业 的本地桩服务（零依赖）
 *
 * 用途：真实后端在 WireGuard 隧道后面（http://10.66.66.1/api），隧道没连上时
 * 安卓 App 无法联调。这个桩服务按《20_前端交付单（安卓App接口与传参）.md》v1.0
 * 逐条实现同样的路径、信封、错误码与阻塞行为，让 App 在局域网里就能跑通全链路：
 *
 *   GET  /api/barns/{barn}/diseased?status=pending|done|all&limit=1..500&zone=
 *   POST /api/barns/{barn}/diseased/{trayId}/confirm?zone=
 *   GET  /api/barns/{barn}/clamp/jobs?status=all|running|done&limit=&zone=
 *   GET  /api/barns/{barn}/patrol/status
 *   POST /api/barns/{barn}/patrol/run
 *   GET  /api/health
 *   GET  /images/xxx.png        （生成的占位图，验证「图片是绝对 URL」这条口径）
 *
 * 启动：node tools/stub-clamp-server.js [--port 8787]
 * 然后 App「我的 → 后端接口」把后端地址改成 http://<本机局域网IP>:8787/api
 *
 * 与真实后端的差异（仅此三处，都是为了能被反复点击测试）：
 *   1. 数据存内存，重启即复位；
 *   2. 裁定 yes 的「阻塞到有阶段回执」用 1.2 s 延时模拟（真实后端最坏 19 s）；
 *   3. 幂等键只在进程内生效（与真实后端一致）。
 */

'use strict'

const http = require('http')
const os = require('os')
const zlib = require('zlib')

const PORT = (() => {
  const i = process.argv.indexOf('--port')
  if (i >= 0 && process.argv[i + 1]) return Number(process.argv[i + 1])
  const j = process.argv.findIndex((a) => /^--port=/.test(a))
  if (j >= 0) return Number(process.argv[j].split('=')[1])
  return 8787
})()

const ZONE = 'zone01'
const BARN = 'barn01'

/* ------------------------------------------------------------------ */
/* 种子数据                                                            */
/* ------------------------------------------------------------------ */
function nowMinus(min) { return Date.now() - min * 60000 }

const TRAYS = [
  {
    trayId: 'T-20261017-0001',
    at: nowMinus(7),
    layer: 1, row: 1, col: 2,
    subHits: [1, 5],
    conf: 0.91,
    trayDiseaseCount: 3,
    level: 'info',
    status: 'pending',
    clampStatus: 'none',
    grade: 'auto',
    causeText: '巡检帧 #3 连续 2 帧命中，病灶面积 2.1%，置信度高于自动阈值',
    env: { t: 25.4, h: 78, tMin: 24.0, tMax: 25.0, hMin: 70, hMax: 75, outSec: 3660 },
    images: ['/images/tray-0001.png'],
    jobId: null, passId: '20261017-091500',
    decidedAt: 0, decision: '', operator: '',
  },
  {
    trayId: 'T-20261017-0002',
    at: nowMinus(34),
    layer: 2, row: 1, col: 1,
    subHits: [4],
    conf: 0.86,
    trayDiseaseCount: 1,
    level: 'info',
    status: 'pending',
    clampStatus: 'none',
    grade: 'auto',
    causeText: '单帧命中，置信度 0.86，建议人工复核后放行',
    env: { t: 24.6, h: 74, tMin: 24.0, tMax: 25.0, hMin: 70, hMax: 75, outSec: 0 },
    images: ['/images/tray-0002.png'],
    jobId: null, passId: '20261017-091500',
    decidedAt: 0, decision: '', operator: '',
  },
  {
    // 2 h 未确认 → 升到 warn，canConfirm 为 false（用来验证「按钮只认 canConfirm」）
    trayId: 'T-20261017-0003',
    at: nowMinus(133),
    layer: 3, row: 1, col: 3,
    subHits: [2, 6, 8],
    conf: 0.63,
    trayDiseaseCount: 5,
    level: 'warn',
    status: 'pending',
    clampStatus: 'none',
    grade: 'review',
    causeText: '已超过 2 小时未裁定，按规则升级为需复核；置信度偏低，请现场确认',
    env: { t: 26.1, h: 81, tMin: 25.0, tMax: 25.5, hMin: 80, hMax: 82, outSec: 7800 },
    images: ['/images/tray-0003.png'],
    jobId: null, passId: '20261017-073500',
    decidedAt: 0, decision: '', operator: '',
  },
  {
    trayId: 'T-20261017-0004',
    at: nowMinus(180),
    layer: 4, row: 1, col: 2,
    subHits: [7],
    conf: 0.95,
    trayDiseaseCount: 2,
    level: 'info',
    status: 'done',
    clampStatus: 'placed',
    grade: 'auto',
    causeText: '已由巡检轮次判定并完成夹取',
    env: { t: 24.8, h: 72, tMin: 24.0, tMax: 25.0, hMin: 70, hMax: 75, outSec: 120 },
    images: ['/images/tray-0004.png'],
    jobId: 'j-a9d6dca2f899', passId: '20261017-063000',
    decidedAt: nowMinus(176), decision: 'yes', operator: 'operator',
  },
  {
    trayId: 'T-20261017-0005',
    at: nowMinus(240),
    layer: 1, row: 1, col: 1,
    subHits: [3],
    conf: 0.58,
    trayDiseaseCount: 1,
    level: 'info',
    status: 'ignored',
    clampStatus: 'none',
    grade: 'low',
    causeText: '置信度 0.58，人工判定为噪点，本轮忽略',
    env: { t: 24.1, h: 71, tMin: 24.0, tMax: 25.0, hMin: 70, hMax: 75, outSec: 0 },
    images: ['/images/tray-0005.png'],
    jobId: null, passId: '20261017-053000',
    decidedAt: nowMinus(236), decision: 'no', operator: 'operator',
  },
]

let JOB_SEQ = 1
const JOBS = [
  {
    id: 'j-a9d6dca2f899',
    trayId: 'T-20261017-0004',
    layer: 4, row: 1, col: 2,
    source: 'auto',
    status: 'placed',
    startedAt: nowMinus(177),
    finishedAt: nowMinus(175),
    placed: true,
    reason: '自动判定置信度 0.95 ≥ 0.8',
  },
]

/** 「进行中」的作业过一会儿自动完成，模拟机械阶段推进 */
function advanceJobs() {
  const now = Date.now()
  JOBS.forEach((j) => {
    if (j.status === 'placing' && j.readyAt && now >= j.readyAt) {
      j.status = 'placed'
      j.finishedAt = now
      j.placed = true
      delete j.readyAt
      const tray = TRAYS.find((t) => t.trayId === j.trayId)
      if (tray) { tray.status = 'done'; tray.clampStatus = 'placed' }
    }
  })
}

function publicJob(j) {
  const o = Object.assign({}, j)
  delete o.readyAt
  // 交付单：id 与 jobId 是同一个值，两个字段都给
  o.jobId = j.jobId || j.id
  o.id = j.id
  return o
}

/* ------------------------------------------------------------------ */
/* 占位图（PNG 编码，验证「图片是绝对 URL，不要再拼 baseUrl」）          */
/* ------------------------------------------------------------------ */
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0 ^ -1
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff]
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

/** 生成一张 width×height 的纯色 PNG，带 2px 深色边框 */
function makePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  let p = 0
  for (let y = 0; y < height; y++) {
    raw[p++] = 0
    for (let x = 0; x < width; x++) {
      const edge = x < 2 || y < 2 || x >= width - 2 || y >= height - 2
      if (edge) { raw[p++] = 40; raw[p++] = 48; raw[p++] = 70 }
      else { raw[p++] = rgb[0]; raw[p++] = rgb[1]; raw[p++] = rgb[2] }
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const IMAGE_CACHE = {}
function imageFor(trayId) {
  if (!IMAGE_CACHE[trayId]) {
    const n = Number(String(trayId).replace(/\D/g, '')) || 1
    const palette = [[86, 122, 214], [96, 168, 132], [212, 138, 74], [150, 106, 206], [214, 92, 120]]
    IMAGE_CACHE[trayId] = makePng(120, 90, palette[n % palette.length])
  }
  return IMAGE_CACHE[trayId]
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */
function send(res, status, body, extraHeaders) {
  const json = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, Object.assign({
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'Authorization, X-Idempotency-Key, Content-Type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'cache-control': 'no-store',
  }, extraHeaders || {}))
  res.end(json)
}

function ok(res, data, total) {
  const body = { ok: true, data: data }
  if (total !== undefined) body.total = total
  send(res, 200, body)
}

function err(res, status, code, message) {
  send(res, status, { ok: false, error: { code: code, message: message } })
}

/** 病蚕记录 → 出参（补 display / canConfirm 这两个派生字段，与后端一致） */
function publicTray(t, host) {
  const canConfirm = t.status === 'pending' && t.level === 'info'
  return {
    trayId: t.trayId,
    at: t.at,
    layer: t.layer, row: t.row, col: t.col,
    display: '第 ' + t.layer + ' 层 · 第 ' + t.row + ' 排 · 第 ' + t.col + ' 列',
    subHits: t.subHits,
    conf: t.conf,
    trayDiseaseCount: t.trayDiseaseCount,
    level: t.level,
    status: t.status,
    clampStatus: t.clampStatus,
    grade: t.grade,
    canConfirm: canConfirm,
    causeText: t.causeText,
    env: t.env || {},
    images: (t.images || []).map((p) => (/^https?:\/\//.test(p) ? p : 'http://' + host + p)),
    jobId: t.jobId,
    passId: t.passId,
    decidedAt: t.decidedAt || null,
    decision: t.decision || null,
    operator: t.operator || null,
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let buf = ''
    req.on('data', (c) => { buf += c; if (buf.length > 1e6) req.destroy() })
    req.on('end', () => {
      if (!buf) return resolve({})
      try { resolve(JSON.parse(buf)) } catch (e) { resolve({ __invalid: true }) }
    })
    req.on('error', () => resolve({}))
  })
}

const IDEMPOTENCY = {}

const server = http.createServer(async (req, res) => {
  advanceJobs()

  if (req.method === 'OPTIONS') return send(res, 204, '')

  const host = req.headers.host || ('127.0.0.1:' + PORT)
  const u = new URL(req.url, 'http://' + host)
  let path = u.pathname.replace(/\/+$/, '') || '/'
  // baseUrl 自带 /api，但也允许不带前缀直连，方便 curl
  if (path.startsWith('/api/')) path = path.slice(4)

  const q = u.searchParams

  /* ---- 占位图 ---- */
  if (req.method === 'GET' && path.startsWith('/images/')) {
    const trayId = path.replace('/images/', '').replace(/\.png$/, '')
    const png = imageFor(trayId)
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length, 'cache-control': 'no-store' })
    return res.end(png)
  }

  /* ---- 鉴权：服务端只校验「存在且非空」 ---- */
  const auth = req.headers['authorization'] || ''
  if (!/^Bearer\s+\S+/.test(auth)) {
    return err(res, 401, 'unauthorized', '缺少或非法的 Authorization 头（需 Bearer <非空令牌>）')
  }

  if (req.method === 'GET' && path === '/health') {
    return ok(res, { service: 'stub-clamp', barn: BARN, zone: ZONE, trays: TRAYS.length, jobs: JOBS.length })
  }

  /* ---- GET /barns/{barn}/diseased ---- */
  const mDiseased = path.match(/^\/barns\/([^/]+)\/diseased$/)
  if (mDiseased && req.method === 'GET') {
    const status = q.get('status') || 'pending'
    if (['pending', 'done', 'all'].indexOf(status) < 0) {
      return err(res, 400, 'bad_status', 'status 只支持 pending / done / all，收到：' + status)
    }
    const limit = q.get('limit') === null ? 50 : Number(q.get('limit'))
    if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
      return err(res, 422, 'bad_limit', 'limit 必须在 1~500 之间，收到：' + q.get('limit'))
    }
    let list = TRAYS
    if (status === 'pending') list = TRAYS.filter((t) => t.status === 'pending')
    if (status === 'done') list = TRAYS.filter((t) => t.status !== 'pending')
    const items = list.slice(0, limit).map((t) => publicTray(t, host))
    return ok(res, items, items.length)
  }

  /* ---- POST /barns/{barn}/diseased/{trayId}/confirm ---- */
  const mConfirm = path.match(/^\/barns\/([^/]+)\/diseased\/([^/]+)\/confirm$/)
  if (mConfirm && req.method === 'POST') {
    const trayId = decodeURIComponent(mConfirm[2])
    const body = await readBody(req)
    if (body.__invalid) return err(res, 400, 'bad_json', '请求体不是合法 JSON')
    const decision = body.decision
    if (decision !== 'yes' && decision !== 'no') {
      return err(res, 400, 'bad_decision', 'decision 只支持 yes / no，收到：' + JSON.stringify(decision))
    }

    const tray = TRAYS.find((t) => t.trayId === trayId)
    if (!tray) return err(res, 404, 'tray_not_found', '裁定未生效：tray_not_found')

    // 幂等：同 key 直接回放；不同裁定 → 409
    const key = req.headers['x-idempotency-key']
    if (key && IDEMPOTENCY[key]) return ok(res, IDEMPOTENCY[key].data)
    if (tray.decision && tray.decision !== decision) {
      send(res, 409, {
        ok: false, conflict: true,
        error: { code: 'already_decided', message: '该记录已裁定为 ' + tray.decision + '，不能改为 ' + decision },
      })
      return
    }
    // 同一盘重复提交「相同」裁定：幂等，不报错也不再新建作业
    if (tray.decision === decision) {
      const same = {
        trayId: trayId,
        status: tray.status,
        decision: decision,
        operator: tray.operator,
        at: tray.decidedAt,
        clampTaskId: tray.jobId || null,
        placed: tray.clampStatus === 'placed',
        forwardedToAlertCenter: true,
        forwardedRaw: '{"idempotent":true}',
      }
      if (key) IDEMPOTENCY[key] = { at: Date.now(), data: same }
      return ok(res, same)
    }

    const operator = body.operator || 'operator'
    const at = Number(body.at) || Date.now()
    tray.decision = decision
    tray.operator = operator
    tray.decidedAt = at

    if (decision === 'no') {
      tray.status = 'ignored'
      const out = {
        trayId: trayId, status: 'ignored', decision: 'no', operator: operator, at: at,
        clampTaskId: null, placed: false,
        forwardedToAlertCenter: true, forwardedRaw: '{"level":"info","decision":"no"}',
      }
      if (key) IDEMPOTENCY[key] = { at: Date.now(), data: out }
      return ok(res, out)
    }

    // yes：立即下发夹取，阻塞到「有阶段回执」（这里用 1.2 s 模拟，真实后端最坏 19 s）
    tray.status = 'running'
    tray.clampStatus = 'dispatched'
    const jobId = 'j-' + (JOB_SEQ++).toString(16).padStart(12, '0')
    tray.jobId = jobId
    const job = {
      id: jobId, trayId: trayId, layer: tray.layer, row: tray.row, col: tray.col,
      source: 'confirmed', status: 'placing',
      startedAt: Date.now(), finishedAt: null, placed: false,
      reason: '人工确认放行',
      readyAt: Date.now() + 1200,
    }
    JOBS.unshift(job)

    await new Promise((r) => setTimeout(r, 1200))
    advanceJobs()

    const placedNow = job.status === 'placed'
    const out = {
      trayId: trayId,
      status: 'running',
      decision: 'yes',
      operator: operator,
      at: at,
      clampTaskId: jobId,
      placed: placedNow,
      forwardedToAlertCenter: true,
      forwardedRaw: '{"level":"info","decision":"yes","clampTaskId":"' + jobId + '"}',
    }
    if (key) IDEMPOTENCY[key] = { at: Date.now(), data: out }
    return ok(res, out)
  }

  /* ---- GET /barns/{barn}/clamp/jobs ---- */
  const mJobs = path.match(/^\/barns\/([^/]+)\/clamp\/jobs$/)
  if (mJobs && req.method === 'GET') {
    const status = q.get('status') || 'all'
    if (['all', 'running', 'done'].indexOf(status) < 0) {
      return err(res, 400, 'bad_status', 'status 只支持 all / running / done，收到：' + status)
    }
    const limit = q.get('limit') === null ? 50 : Number(q.get('limit'))
    if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
      return err(res, 422, 'bad_limit', 'limit 必须在 1~500 之间，收到：' + q.get('limit'))
    }
    let list = JOBS
    if (status === 'running') list = JOBS.filter((j) => ['pending', 'dispatched', 'moving', 'gripping', 'placing'].indexOf(j.status) >= 0)
    if (status === 'done') list = JOBS.filter((j) => ['placed', 'failed', 'ignored', 'cancelled'].indexOf(j.status) >= 0)
    const items = list.slice(0, limit).map(publicJob)
    return ok(res, items, items.length)
  }

  /* ---- GET /barns/{barn}/patrol/status ---- */
  const mPatrol = path.match(/^\/barns\/([^/]+)\/patrol\/status$/)
  if (mPatrol && req.method === 'GET') {
    return ok(res, {
      service: 'ish-clamp', barn: BARN, zone: ZONE,
      attached: true, enabled: true, running: false, mqtt_ready: true,
      passes: 12, last_pass: '20261017-091500', last_error: null,
      client_id: BARN + ZONE + '-ish-clamp',
    })
  }

  /* ---- POST /barns/{barn}/patrol/run（会动机械，App 不应调用） ---- */
  const mRun = path.match(/^\/barns\/([^/]+)\/patrol\/run$/)
  if (mRun && req.method === 'POST') {
    return ok(res, { started: true, passId: '20261017-091500', note: '桩服务：不会真的动机械' })
  }

  return err(res, 404, 'not_found', '桩服务未实现该路径：' + req.method + ' ' + path)
})

function lanIps() {
  const out = []
  const ifs = os.networkInterfaces()
  Object.keys(ifs).forEach((name) => {
    (ifs[name] || []).forEach((ni) => {
      if (ni.family === 'IPv4' && !ni.internal) out.push({ name: name, ip: ni.address })
    })
  })
  return out
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanIps()
  console.log('')
  console.log('  病蚕 / 裁定 / 夹取作业  桩服务已启动（按交付单 v1.0 口径）')
  console.log('  ────────────────────────────────────────────────────────────')
  console.log('  本机访问     http://127.0.0.1:' + PORT + '/api')
  ips.forEach((x) => {
    console.log('  局域网(手机)  http://' + x.ip + ':' + PORT + '/api    <- ' + x.name)
  })
  console.log('')
  console.log('  App「我的 -> 后端接口」填上面那条，令牌随便非空（如 test）')
  console.log('  自测： node tools/check-stub.js')
  console.log('  真实后端：把地址换回 http://10.66.66.1/api（需先连 WireGuard 隧道）')
  console.log('')
})
