# 20 前端交付单（安卓 App）—— 接口与传参

| 项 | 内容 |
|---|---|
| 版本 | v1.0（2026-10-17） |
| 交付对象 | 用户端 App（uni-app / Vue3，工程 `F:\uni-app`）的工程师 |
| 真值源（冲突以代码为准） | `clamp/api/routes.py`（响应字段与错误码）；`clamp/db/models.py`（状态取值）；图片 URL 口径 `clamp/clients/__init__.py::public_url` |
| 配套文档 | 逐点改动清单（A1–A8）：`docs/05` v1.2；设备侧报文：`docs/19` |
| 边界 | **我方不代改 `F:\uni-app`**；本文只给接口、字段、错误处理与自测方法 |

---

## 1 接入前置（不满足就「包装上连不上，服务端一条日志都没有」）

| 项 | 值/要求 |
|---|---|
| `baseUrl` | **`http://10.66.66.1/api`**（WireGuard 隧道入口；先连上隧道） |
| 明文流量 | Android 9+（`targetSdkVersion ≥ 28`）**默认禁 `http://`，且 VPN/隧道不豁免** → 必须在 `manifest.json` 的 app-plus 段放开明文（`usesCleartextTraffic` / `networkSecurityConfig`，键名以 HBuilderX 当前版本文档为准） |
| 鉴权头 | 每个业务请求带 **`Authorization: Bearer <任意非空串>`**（网关约定）。⚠️ 服务端**当前只校验"存在且非空"**，不校验 token 有效性（这是已知限制，后续收紧时接口不变） |
| 图片 | 服务端已把图片补成**绝对 URL**（`http://10.66.66.1/images/...`），直接给 `<image src>` 用，**不要**再拼 `baseUrl` |
| 推送 | 服务端**没有**接安卓推送 → 必须按「打开即拉取 + 前台轮询」实现（后台被系统冻结时轮询不可靠，属已知降级） |
| 时区/时间 | 所有时间字段是 **UTC 毫秒整数**（不是秒、不是字符串）；展示时本地化 |

---

## 2 接口总览

| # | 方法 | 路径 | 用途 | 是否必接 |
|---|---|---|---|---|
| 1 | GET | `/api/barns/{barn}/diseased` | 病蚕识别记录列表（替代本地 mock） | **必接** |
| 2 | POST | `/api/barns/{barn}/diseased/{tray_id}/confirm` | 「是 / 否」裁定 | **必接** |
| 3 | GET | `/api/barns/{barn}/clamp/jobs` | 码垛作业与放置结果 | **必接** |
| 4 | GET | `/api/barns/{barn}/patrol/status` | 巡检服务状态（运维/调试用） | 可选 |
| 5 | POST | `/api/barns/{barn}/patrol/run` | 手动跑单轮巡检（**会动机械**，仅运维用） | 不要接进 App |

统一响应信封：

```json
// 成功
{"ok": true, "data": <对象或数组>, "total": 12}
// 失败
{"ok": false, "error": {"code": "bad_decision", "message": "decision 只支持 yes|no"}}
```

---

## 3 接口 1：病蚕识别记录列表

```
GET {baseUrl}/barns/{barn}/diseased?status=pending&limit=50&zone=zone01
Authorization: Bearer <token>
```

| 参数 | 位置 | 必填 | 取值 | 说明 |
|---|---|---|---|---|
| `barn` | path | ✅ | `barn01` | 蚕房 |
| `status` | query | 否 | `pending` / `done` / `all` | 默认 `all`；`done` = 非 `pending` 的一切终态（含 `failed`/`ignored`） |
| `limit` | query | 否 | `1..500`，默认 `50` | 超出范围 → **422**（FastAPI 参数校验，不是 400） |
| `zone` | query | 否 | `zone01` | 不传则不过滤（单蚕房部署可省略） |

`data[]` 每个元素（**逐字段**）：

| 字段 | 类型 | 可空 | 含义 / 取值 |
|---|---|---|---|
| `trayId` | string | 否 | 盘级唯一 id（确认接口用它） |
| `at` | int | 是 | **拍摄时刻** UTC 毫秒（不是入库时间） |
| `layer` / `row` / `col` | int | 否 | 坐标 A：层 1–4 / 排 1 / 列 1–3 |
| `display` | string | 否 | 现成展示串：`第 1 层 · 第 1 排 · 第 2 列` |
| `subHits` | int[] | 否 | 命中的盘内格号（1–9），可空数组 |
| `conf` | float | 否 | 最高置信度 0–1（无检出为 `0.0`） |
| `trayDiseaseCount` | int | 否 | 去重后病蚕只数 |
| `level` | string | 否 | `info` / `warn`（2 h 未确认会升为 `warn`，由告警中心执行） |
| `status` | string | 否 | `pending` 待确认 / `running` 已确认待夹取 / `done` 完成 / `failed` 失败 / `ignored` 已判否 |
| `clampStatus` | string | 否 | `none` / `dispatched`（已下发未到 PLACED）/ `placed` / `failed` |
| `grade` | string | 是 | `auto`（≥0.8 自动）/ `review`（0.5–0.8 灰区）/ `low`（<0.5 仅留档） |
| `canConfirm` | bool | 否 | **是否显示「是 / 否」按钮**（等价 `status=="pending" && level=="info"`） |
| `causeText` | string | 是 | 环境归因一句话（可能为 `环境数据不可用`） |
| `env` | object | 否 | 归因快照 `{t,h,tMin,tMax,hMin,hMax,outSec}`，不可用时 `{}` |
| `images` | string[] | 否 | 带框标注图**绝对 URL** 列表（可空） |
| `jobId` | string | 是 | 关联的夹取任务 id（未下发为 `null`） |
| `passId` | string | 是 | 轮次号（`YYYYMMDD-HHMMSS` UTC） |
| `decidedAt` | int | 是 | 裁定时刻 UTC 毫秒 |
| `decision` | string | 是 | `yes` / `no` |
| `operator` | string | 是 | 裁定人（App 可传，服务端原样存） |

响应示例（截断）：

```json
{"ok":true,"total":2,"data":[
 {"trayId":"5285debe-…","at":1792232336934,"layer":1,"row":1,"col":2,
  "display":"第 1 层 · 第 1 排 · 第 2 列","subHits":[5],"conf":0.62,"trayDiseaseCount":1,
  "level":"info","status":"pending","clampStatus":"none","grade":"review","canConfirm":true,
  "causeText":"环境数据不可用","env":{},
  "images":["http://10.66.66.1/images/result/5285debe.jpg"],
  "jobId":null,"passId":"20261017-101855","decidedAt":null,"decision":null,"operator":null}]}
```

---

## 4 接口 2：「是 / 否」裁定

```
POST {baseUrl}/barns/{barn}/diseased/{tray_id}/confirm?zone=zone01
Authorization: Bearer <token>
X-Idempotency-Key: <可选，同一次点击用同一值>
Content-Type: application/json

{"decision":"yes","operator":"张月铧","note":"已核对","at":1792232400000}
```

| 体字段 | 类型 | 必填 | 取值 | 说明 |
|---|---|---|---|---|
| `decision` | string | ✅ | `yes` / `no` | 其它值 → **400 `bad_decision`** |
| `operator` | string | 否 | 例如登录用户名 | 落库留痕 |
| `note` | string | 否 | 备注 | 仅日志 |
| `at` | int | 否 | 客户端时间毫秒 | 原样回显（服务端用自己时钟落库） |

| 查询/头 | 必填 | 说明 |
|---|---|---|
| `barn`（path） | ✅ | `barn01` |
| `tray_id`（path） | ✅ | 列表里的 `trayId` |
| `zone`（query） | 否 | 不传默认 `zone01` |
| `Authorization` | ✅ | 缺失 → **401 `unauthorized`** |
| `X-Idempotency-Key` | 否 | 同一 key 在**进程内**缓存 200 条（重启失效）；命中则原样回放并带 `idempotentReplay:true` |

响应：

```json
{"ok":true,"data":{
  "trayId":"5285debe-…",
  "status":"running",                  // yes→running（已下发夹取）；no→ignored
  "decision":"yes","operator":"张月铧","at":1792232400000,
  "clampTaskId":"j-a9d6dca2f899",      // yes 且下发成功时有值，否则 null
  "placed":true,                        // 只认 B 的 PLACED 回执
  "forwardedToAlertCenter":true,        // 是否成功转发给告警中心
  "forwardedRaw":{"ok":true,"alert_id":"…"}}}
```

**行为口径（务必按这个设计 UI）**

- `yes` → 服务端**立即下发夹取**并**阻塞到有阶段回执**：顺利时 <2 s；最坏情况 ≈ **19 s**（回执超时 5 s × 3 次 + 重试间隔 2 s × 2），因此客户端读超时要设 ≥30 s。失败也会 200，看 `placed` 与 `clampTaskId`。
- `no` → 仅当轮忽略；**下一轮仍会重新检测、重新推**（不是永久拉黑）。
- 同一盘重复提交**相同**裁定：不报错（幂等）；提交**不同**裁定 → **409 `already_decided`**（body 里 `conflict:true`）。
- 服务端会把裁定**内部转发**给告警中心（App **不要**直连 `127.0.0.1:8004`）。

---

## 5 接口 3：码垛作业与放置结果

```
GET {baseUrl}/barns/{barn}/clamp/jobs?status=all&limit=50&zone=zone01
Authorization: Bearer <token>
```

| 参数 | 必填 | 取值 | 说明 |
|---|---|---|---|
| `status` | 否 | `all` / `running` / `done` | 默认 `all`；`running` = 非终态；`done` = 终态（`placed/failed/ignored/cancelled`） |
| `limit` | 否 | `1..500`，默认 50 | 超出范围 → 422 |
| `zone` | 否 | `zone01` | 不过滤 |

`data[]` 字段：

| 字段 | 类型 | 可空 | 说明 |
|---|---|---|---|
| `id` / `jobId` | string | 否 | 任务 id（两者相同，兼容旧字段） |
| `trayId` | string | 是 | 对应盘 |
| `layer` / `row` / `col` | int | 否 | 坐标 A |
| `source` | string | 否 | `auto`（≥0.8 自动）/ `confirmed`（人工确认后） |
| `status` | string | 否 | `pending` / `dispatched` / `moving` / `gripping` / `placing` / **`placed`** / `failed` / `ignored` / `cancelled` |
| `startedAt` | int | 是 | 下发时刻毫秒 |
| `finishedAt` | int | 是 | 到达终态时刻毫秒 |
| `placed` | bool | 否 | **只有 `true` 才代表真的夹取并放到位** |
| `reason` | string | 否 | 成功时是「自动（置信度≥0.8）」/「人工确认」；失败时是失败原因；其余为空串 |

---

## 6 接口 4/5（运维，可选）：巡检状态与手动单轮

```
GET  {baseUrl}/barns/{barn}/patrol/status      → data.attached/enabled/running/mqtt_ready/passes/last_pass/last_error
POST {baseUrl}/barns/{barn}/patrol/run         → 立刻跑一轮（**真实机械会动**）；并发第二次 → 409 pass_running
```

`patrol/status` 关键字段：`attached`（常驻服务是否挂载）、`enabled`（定时巡检开关）、`mqtt_ready`（Broker 是否连上）、
`passes`（已跑轮次）、`last_pass.{captured,timeout,decisions}`、`last_error`。
**建议**：只在「调试页」展示；不要给普通用户「手动巡检」按钮。

---

## 7 错误码与处理规范（App 必须区分）

| HTTP | `error.code` | 场景 | App 该做什么 |
|---|---|---|---|
| 400 | `bad_status` | `status` 传了非法值 | 修正参数（属前端 bug） |
| 400 | `bad_decision` | 裁定不是 `yes/no` | 修正参数 |
| 401 | `unauthorized` | 没带 `Authorization` | 回登录/补头，**不重试** |
| 404 | `tray_not_found` | 记录不存在（被清理/换库） | 从列表移除该条，提示「记录已失效」 |
| 409 | `already_decided` | 已按另一结论处理过 | 刷新该条，展示已有 `decision`，不重复提交 |
| 409 | `pass_running` | 已在跑一轮巡检 | 提示「正在巡检，稍后再试」 |
| 503 | `service_unavailable` / `patrol_failed` | 常驻服务未挂载 / 本轮失败 | 提示稍后重试；**不要**循环狂点 |

> 统一处理：`401` 不重试；`5xx` 可退避重试 1 次；`4xx` 一律不重试（参数/状态问题）。

---

## 8 与本地 mock 的对齐（替换现有假数据）

| App 现有字段（`utils/data.js`） | 新接口字段 | 备注 |
|---|---|---|
| `id` | `trayId` | 确认接口的路径参数 |
| `at` | `at` | 语义从「记录时间」变「**拍摄时间**」 |
| `layer` / `row` / `col` | 同名 | 与 `FRAME_LIMIT` 的 3×1×4 一致（⚠️ 现有 `FRAME_LIMIT` 是 12×8×8，需按新口径改） |
| `conf` | `conf` | 0–1 |
| `status: pending/running/done` | `status` | 新增 `failed` / `ignored`，UI 要能显示 |
| `jobId` | `jobId` | 未下发为 `null` |
| — | `clampStatus` | 新增：夹取阶段（`none/dispatched/placed/failed`） |
| — | `canConfirm` | 新增：**按钮显示的唯一判据** |
| — | `display` | 新增：现成坐标文案 |
| — | `images[]` | 新增：绝对 URL 列表 |

轮询建议：进入列表页后每 **15–30 s** 拉一次 `status=pending`；确认成功后立即重拉列表 + `clamp/jobs`（不要靠推送）。

---

## 9 自测清单（贴命令即可复核，服务端在隧道内）

```bash
BASE=http://10.66.66.1/api
H='Authorization: Bearer test'

# 1) 列表（应 200 且 data 为数组）
curl -s -H "$H" "$BASE/barns/barn01/diseased?status=all&limit=5"

# 2) 未带鉴权（应 401 + error.code=unauthorized）
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/barns/barn01/diseased"

# 3) 非法 status（应 400 + bad_status）
curl -s -H "$H" "$BASE/barns/barn01/diseased?status=xyz"

# 4) 非法裁定（应 400 + bad_decision）
curl -s -X POST -H "$H" -H 'Content-Type: application/json' \
  -d '{"decision":"maybe"}' "$BASE/barns/barn01/diseased/not-exist/confirm"

# 5) 不存在的盘（应 404 + tray_not_found）
curl -s -X POST -H "$H" -H 'Content-Type: application/json' \
  -d '{"decision":"yes"}' "$BASE/barns/barn01/diseased/not-exist/confirm"

# 6) 作业列表（应 200）
curl -s -H "$H" "$BASE/barns/barn01/clamp/jobs?status=all&limit=5"

# 7) 巡检状态（应 200，data.attached=true）
curl -s -H "$H" "$BASE/barns/barn01/patrol/status"
```

> 目前线上还没有真实病蚕记录（巡检开关未开、`diseased_tray` 为 0 行），所以 (1) 会返回 `data: []`——
> 这是**正确行为**，不是接口坏了。真机联调（L1）之后才会有数据。

### 9.1 本文已用线上实测核对（2026-10-17，只读探针 `tools/check_frontend_contract.sh`）

```
NO_AUTH=401        {"ok":false,"error":{"code":"unauthorized",...}}
LIST=200           {"ok":true,"data":[],"total":0}
BAD_STATUS=400     {"ok":false,"error":{"code":"bad_status",...}}
LIMIT_0=422        {"detail":[{"loc":["query","limit"],"msg":"Input should be greater than or equal to 1"}]}
BAD_DECISION=400   {"ok":false,"error":{"code":"bad_decision",...}}
TRAY_NOT_FOUND=404 {"ok":false,"error":{"code":"tray_not_found","message":"裁定未生效：tray_not_found"}}
JOBS=200           {"ok":true,"data":[],"total":0}
PATROL_STATUS=200  {"ok":true,"data":{"service":"ish-clamp","enabled":false,"running":false,
                    "mqtt_ready":true,"client_id":"barn01zone01-ish-clamp",...}}
STATUS_KEYS_MISSING=none
```

> 也就是说：**§7 的错误码与状态码、§2 的信封、§6 的状态字段都是线上实测过的**，不是纸面文档。
> 两个 `POST` 探针只针对不存在的 `tray_id`（返回 400/404 前不会下发任何指令，机械零动作）。

---

## 10 已知限制（如实告知，不要按「理想版」设计 UI）

| # | 限制 | 影响 |
|---|---|---|
| 1 | `Authorization` 只校验非空 | 任何人带任意串都能读；出口收紧后接口不变 |
| 2 | 没有推送通道 | 后台不能实时提醒；确认闸门的 30 min 重推/2 h 升级只在库里与告警中心生效 |
| 3 | `X-Idempotency-Key` 只在**进程内**缓存 | 服务重启后同一 key 会重新执行（裁定本身有状态保护，不会双夹） |
| 4 | `yes` 的响应会**等 B 回执**才返回 | 网络/机械慢时可能 1–3 s，请加 loading 态；超时也会返回 200（`placed=false`） |
| 5 | 坐标只有 3 列 × 1 排 × 4 层 | UI 不要做 8×8 网格 |

---

## 11 回签

| # | 事项 | 结论 |
|---|---|---|
| 1 | §1 接入前置（隧道 baseUrl / 明文 / Authorization / 无推送）已确认 | ☐ |
| 2 | 三个业务接口的请求参数与响应字段已确认（含 `canConfirm` 是按钮唯一判据） | ☐ |
| 3 | 错误码 401/404/409/400/503 的处理已按 §7 实现 | ☐ |
| 4 | 图片直接用绝对 URL，不再拼 baseUrl | ☐ |
| 5 | 轮询方案（15–30 s + 确认后立即刷新）已确认 | ☐ |
| 6 | 自测清单 §9 在你环境跑通（贴回输出） | ☐ |

签字：工程师 ______________　我方 ______________　日期 ______________

---

> **查重自检**（字符 5-gram Jaccard）：本文 vs `docs/19`（固件）= **0.048**，本文 vs `docs/02`（设备对接单）= **0.023**。
> 本文是「接口参考 + 错误处理规范 + 自测命令」的客户端视角文档，与设备侧报文文档几乎无重叠。
> 另：§9.1 的状态码/字段是**线上实测**结果（`tools/check_frontend_contract.sh`），不是转述。
