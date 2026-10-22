# 蚕房环境调控系统 · uni-app 版（Vue 3）

由同目录的**微信小程序工程**（`../`，原生 WXML/WXSS/JS）用脚本机械迁移而来，页面与逻辑一一对应。

```
启动页：选择蚕房 → 实时看板（Tab）/ 历史曲线（Tab）/ 告警（Tab）/ 手动控制（Tab）/ 我的（Tab）
                                                              └ 参数配置 / 日报报表 / Agent 问答 / 设备详情 / 告警详情
```

## 一、在 HBuilderX 里运行

1. **文件 → 打开目录**，选择本文件夹（`uni-app` 这一层，不是它的上级）。左侧项目树应能看到 `pages.json`、`manifest.json`、`App.vue`、`main.js`，说明被识别为 uni-app 项目。
2. 配置微信开发者工具路径：**工具 → 设置 → 运行配置 → 微信开发者工具路径**。
3. 微信开发者工具里开启服务端口：**设置 → 安全设置 → 服务端口**。
4. **运行 → 运行到小程序模拟器 → 微信开发者工具**。首次运行会在 `unpackage/` 下生成编译产物并自动拉起微信开发者工具。

> AppID 已写在 `manifest.json` 的 `mp-weixin.appid`（`wxc80cf4238bca0889`），换成自己的即可。

## 二、发布

- 小程序：**发行 → 小程序-微信(仅适用于uni-app)**，产物在 `unpackage/dist/build/mp-weixin`，用微信开发者工具打开该目录上传。
- H5 / App：同菜单选对应项（tabBar 图标已配好，可直接运行）。

## 三、目录结构

```
uni-app/
├── App.vue                     # 应用入口：globalData + 全局样式（即原 app.wxss）
├── main.js                     # createSSRApp + app.mixin(uni-shim)
├── manifest.json               # 应用配置（AppID / vueVersion:3 等）
├── pages.json                  # 页面路由 + globalStyle + tabBar（即原 app.json + 各页 .json）
├── components/
│   ├── barn-bar/barn-bar.vue   # 顶部「当前蚕房」条（easycom 自动注册，页面里直接写 <barn-bar/>）
│   └── skeleton/skeleton.vue   # 骨架屏占位卡（easycom 自动注册，页面里直接写 <skeleton rows="{{3}}"/>）
├── pages/
│   ├── login/login.vue               # 登录（账号密码 + 服务器地址；未登录可进演示模式）
│   ├── room-select/room-select.vue   # 启动页：选择蚕房（4 栋卡片）
│   ├── index/index.vue               # P01 实时看板（Tab）
│   ├── history/history.vue           # P02 历史曲线（Tab）
│   ├── alerts/alerts.vue             # P03 告警列表（Tab）
│   ├── control/control.vue           # P04 手动控制（Tab，含机械化设备入口 / 待裁定病蚕数）
│   ├── machine/machine.vue           # 机械化设备 + 病蚕裁定 + 夹取作业（预设工作范围 + 人工干涉）
│   ├── mine/mine.vue                 # 个人中心（Tab，含「账号」卡与「后端接口」卡：登录/角色/退出、夹取接口地址）
│   ├── users/users.vue               # 操作员账户管理（仅管理员）
│   ├── tokens/tokens.vue             # 审批令牌签发 / 撤销（仅管理员）
│   ├── config/config.vue             # P05 参数配置（仅管理员）
│   ├── report/report.vue             # P06 日报/报表
│   ├── agent/agent.vue               # P07 Agent 问答
│   ├── device-detail/device-detail.vue
│   └── alarm-detail/alarm-detail.vue
├── static/                     # 静态资源：tab/ 下 5 组 tabBar 图标（<name>.png / <name>-on.png）
└── utils/
    ├── data.js                 # 模拟数据与查询（4 栋蚕房运行态、告警、日报、5 台机械化设备；病蚕记录改由后端提供）
    ├── engine.js               # 演示引擎：tick / 控制模式 / 安全联锁 / 审计 / 令牌
    ├── spec.js                 # 规格书常量：告警定义、权限矩阵、工具清单、参数范围
    ├── chart.js                # Canvas 2D 折线/双轴环境曲线/柱状/环形图
    ├── nav.js                  # tab 路由表 + ensureBarn() / goSelect() / backFrom() + skeletonBegin()/skeletonDone()
    ├── clamp.js                # 病蚕识别 / 人工裁定 / 夹取作业 后端接口客户端（轮询、错误码、归一化）
    ├── http.js                 # 统一请求层：信封解包（env/ish）、401 刷新重试、错误码归一
    ├── auth.js                 # 登录 / JWT 会话 / capabilities 能力判断 / 操作员账户 / 审批令牌
    ├── env.js                  # 环境调控 barn-api 客户端（realtime/history/alarms/manual）
    ├── live.js                 # 实时数据适配：5 s 轮询 → 写入 data.js 覆盖层，页面零改动
    └── uni-shim.js             # 迁移适配层（setData / mpPage / mpComponent）
```

## 四、迁移适配层（为什么页面代码长得像小程序）

页面 `<script>` 不是手写 Vue，而是原 `Page({...})` / `Component({...})` 经 `utils/uni-shim.js` 转换后的写法：

| 原小程序 | 迁移后 | 由谁完成 |
|---|---|---|
| `xxx.wxml` | `.vue` 的 `<template>`：`wx:if/elif/else`→`v-if/v-else-if/v-else`、`wx:for`→`v-for="(item, index) in x"`、`wx:key`→`:key`、`bindtap`→`@tap`、`catchtap`→`@tap.stop`、`catchtouchstart`→`@touchstart.stop`（catch 统一映射成 `.stop` 修饰符）、含 `{{}}` 的属性→`:attr="'字面量' + (表达式)"` | `../tools/migrate-to-uniapp.js` |
| `xxx.wxss` | `.vue` 的 `<style>` | **逐字节原样搬运**（`tools/check-uniapp.js` 会比对一致性） |
| `Page({ data, onLoad, 方法 })` | `export default mpPage({ data, onLoad, 方法 })` | `uni-shim.js`：`data` 字段→`data()` 深拷贝、生命周期钩子留在根级、其余方法进 `methods` |
| `Component({ properties, lifetimes, methods })` | `export default mpComponent({...})` | `uni-shim.js`：`properties`→`props`（`value`→`default`）、`attached`→`mounted`、`detached`→`unmounted` |
| `this.setData({ 'a.b': 1 }, cb)` | 同名方法 | `uni-shim.js` 全局 mixin，支持 `'a.b[0].c'` 路径与回调 |
| `App({ globalData, onLaunch })` | `export default { globalData, onLaunch }`（App.vue） | 转换器直接改写，`getApp().globalData` 照旧可用 |
| `wx.xxx()` / `module.exports` / `require` | `uni.xxx()` / `export` / `import` | 转换器；utils 已是 ES Module |

生命周期写法不变（`onLoad` / `onShow` / `onReady` / `onHide` / `onUnload` / `onPullDownRefresh` / `onShareAppMessage`）。

## 五、可复现的校验方式

原生工程与 uni-app 产物都能在 Node 下自检（无需 HBuilderX）：

```powershell
cd ..
node tools/check-pages.js      # 原生小程序：四件套齐全 / JSON 合法 / 插值标识符已定义
node tools/check-handlers.js   # 原生小程序：wxml 里每个 bind*/catch* 处理函数都有实现
node tools/smoke-test.js       # 原生小程序：数据层与业务规则冒烟（当前 61 项通过）
node tools/check-clamp.js      # 病蚕/裁定/夹取作业接口客户端：信封解包、错误码映射、重试策略、幂等键、视图归一化、轮询订阅（当前 83 项通过）
node tools/check-stub.js       # 本地桩服务自测：鉴权/信封/400/422/404/409/canConfirm/placed/图片（当前 52 项通过）
node tools/check-e2e.js        # 全链路：真实 utils/clamp.js → 真实 HTTP → 桩服务（当前 43 项通过）
node tools/stub-clamp-server.js # 起本地桩服务（默认 8787），隧道没通时用它在局域网联调 App
node tools/migrate-to-uniapp.js # 重新生成 uni-app 产物（改完原生工程后跑这个）
node tools/check-uniapp.js     # uni-app 产物静态校验：SFC 真实编译 + 逐页对齐 + 样式一致性
node tools/render-test.js      # uni-app 产物运行时校验：SSR 真实渲染 17 个页面/组件
```

> 组件按 uni-app 的 **easycom** 约定自动注册（`pages.json` 里 `easycom.autoscan: true`，组件放在 `components/<name>/<name>.vue`），所以页面模板里直接写 `<barn-bar/>`、`<skeleton/>`，不需要 import 或 `components: {}`。

**验证边界（如实说明）**：本机没有 HBuilderX / uni-app 编译工具链，所以**没有跑过真实的 uni-app 编译与真机运行**。已完成的是：① `@vue/compiler-sfc` 对每个 `.vue` 做真实 SFC 解析与模板/脚本编译（18 个文件 0 失败）；② 用 `@vue/server-renderer` 在 Node 里对 15 个页面 + 2 个组件做真实渲染（生命周期 `onLoad/onShow/onReady` 与组件 `attached` 均触发，canvas 绘图调用约 2100 次，0 失败），因此模板表达式、null 安全、事件方法存在性、canvas 代码路径都已实际执行过。首次编译若报错，多半是平台差异，请把报错发我。

> 渲染校验里组件用 `app.component()` 手动注册，等价于 easycom 的扫描结果；页面骨架屏的 420 ms 保底展示在同步 SSR 下不会到点，harness 会直接渲染页面主体（骨架屏组件本身单独渲染校验）。

## 六、后端接口（环境调控 + 病蚕裁定 / 夹取作业）

项目有**两套真实后端**，入口都在「我的」里，契约见 `前端接口交付.md` 与 `docs/实机对接接口.md`（第 11、12 节）。

### 6.1 环境调控 barn-api（登录后才启用）

| 模块 | 职责 |
|---|---|
| `utils/http.js` | 统一请求、信封解包、401 自动 refresh 后重试一次、错误码归一 |
| `utils/auth.js` | `POST /auth/login` 拿 JWT（access 7200 s）+ `GET /auth/me` 的 `capabilities[]`；`can(cap)` 决定按钮；会话存 `silk_auth_session_v1` |
| `utils/env.js` | `realtime / devices / alarms / confirmAlarm / history / schedulerState / manual / manualExit`；指令 target 映射 `heat01↔heater`、`mist01↔mist` |
| `utils/live.js` | 每 5 s 轮询 realtime + active alarms，装配成与 `data.getStatusSummary` 同形视图写入 data.js 覆盖层，页面代码不改 |

- 基址 `http://10.66.66.1/api`（**已含 /api**，只走 WireGuard 隧道）；联调实例可填 `http://127.0.0.1:8012/api`。
- **按能力控按钮**：`view / hist / ack / manual / config_change / token_issue / user_manage`，不要硬编码 role。
- 503（`mqtt_unavailable` / `publish_failed`）表示设备侧不在线，**不要自动重试**；令牌错误是 403 而不是 400。
- 我的 → 账号：打开「启动要求登录」后，冷启动会先落到登录页；关闭则直接进演示模式（本机模拟，不发网络请求）。
- 管理员在「操作员账户」「审批令牌」两个页面里管理账号与 ACTION_TOKEN。

### 6.2 病蚕裁定 / 夹取作业（ISH）

契约见 `20_前端交付单（安卓App接口与传参）.md`。

| 页面 | 用的接口 | 说明 |
|---|---|---|
| 机械化设备（`pages/machine`） | `GET /barns/{barn}/diseased?status=pending`、`POST /barns/{barn}/diseased/{trayId}/confirm`、`GET /barns/{barn}/clamp/jobs` | 病蚕卡 + 「放行 / 忽略」裁定 + 夹取作业列表 |
| 看板（`pages/index`）、手动控制（`pages/control`） | 同上（只读计数） | 待裁定病蚕数、需人为干涉数 |
| 我的（`pages/mine`） | `GET .../diseased`（测试连接） | 「后端接口」卡：地址 / 令牌 / 区域 / 测试连接 / 立即同步 / 最近请求 |

要点：

1. **地址与鉴权**：默认 `http://115.191.10.217:8000`（不含 /api，路径自带 `/api/*`，公网可达；隧道内也可指 `http://10.66.66.1/api`）（需先连 WireGuard 隧道），头 `Authorization: Bearer <任意非空>`。地址/令牌/区域在「我的 → 后端接口」里可改，存本地 Storage（键 `silk_clamp_v1`）。
2. **没有推送**：进入机械页后每 20 s 拉一次待裁定列表与作业列表；裁定成功后立即重拉。定时器只在 `utils/clamp.js` 里有一个，页面通过 `startPolling/stopPolling` 订阅，符合「页面不自起定时器」的约定。
3. **裁定 `yes` 会阻塞到阶段回执**（顺利 <2 s，最坏约 19 s），所以该请求超时设为 35 s；`no` 只是忽略本轮，下一轮仍会重推。重复相同裁定幂等，不同裁定返回 409 `already_decided`。
4. **`placed === true` 才代表真的夹取放到位**；按钮是否显示只看后端 `canConfirm`（字段缺失时按 `status=pending && level=info` 推导）。
5. **坐标口径已按交付单改为 3 列 × 1 排 × 4 层**（`utils/data.js` 的 `FRAME_LIMIT`）。
6. **已删除的模拟部分**：本机生成的病蚕记录 `createDiseased()`、坐标弹层启动码垛作业 `engine.startPalletJob()` / `cancelPalletJob()`、机械卡里的作业进度条；以及被 env.js/live.js 取代的旧预留层 `utils/gateway.js`（与 `tools/check-gateway.js`）。登录后温湿度、曲线、告警、设备控制全部走后端，仅未登录的演示模式才用本机模拟引擎。
7. **Android 明文 HTTP**：`manifest.json` 的 `app-plus.distribute.android` 已加 `usesCleartextTraffic: true` 与 `INTERNET` 权限；微信小程序侧在 `project.config.json` 里关了合法域名校验（`setting.urlCheck: false`），App 端若仍被拦，需在打包时勾选「不校验合法域名」或用自定义基座。
8. **隧道没通也能联调**：`node tools/stub-clamp-server.js` 起一个零依赖桩服务（默认 `8787`，按交付单口径造数据），App「我的 → 后端接口」把地址改成 `http://<本机局域网IP>:8787/api`、令牌随意非空即可跑通全链路。完整步骤、验收清单、错误码对照表见 **`docs/病蚕接口联调手册.md`**。

## 七、注意事项

1. **Vue 版本**：按 Vue 3 配置（`manifest.json` 的 `"vueVersion": "3"`，`main.js` 用 `createSSRApp`）。若要退回 Vue 2：把 `vueVersion` 改为 `"2"`，并把 `main.js` 换成
   ```js
   import Vue from 'vue'
   import App from './App'
   Vue.config.productionTip = false
   App.mpType = 'app'
   new Vue({ ...App }).$mount()
   ```
   页面代码是 Options API 写法，Vue 2 / Vue 3 都能跑（但 `uni-shim.js` 的 `mpPage/mpComponent` 依赖 Vue 3 的 `data()` 与 `props` 约定，Vue 2 下同样成立）。
2. **tabBar 图标**：5 个 tab 都已配好图标（`static/tab/<name>.png` 与选中态 `<name>-on.png`，微信小程序与 H5 / App 通用），`pages.json` 的 `tabBar.list` 里写了 `iconPath` / `selectedIconPath`；换图标时保持 81×81 px、PNG、透明底即可。
3. **Canvas 图表**：`utils/chart.js` 用 `<canvas type="2d">` + `uni.createSelectorQuery()`，与小程序一致；App 端需较新的编译器版本才支持 `type="2d"`。曲线进入视口才绘制（`chart.whenVisible()`，不支持 `createIntersectionObserver` 的平台立即绘制）。
4. **曲线手势**：历史曲线支持双指缩放 / 单指拖动 / 双击复位，靠 `catchtouchstart/touchmove/touchend/touchcancel`（迁移为 `@touchstart.stop` 等）阻止页面跟着滚动；跨度限制在 10 min ~ 所选时间段之间。
5. **骨架屏**：`components/skeleton` + `nav.skeletonBegin(page)` / `nav.skeletonDone(page)`；数据是本地同步模拟数据，`skeletonDone` 会保底展示 420 ms，避免骨架屏一闪而过（真实弱网请求把它换成请求回包即可）。
6. **不要用微信开发者工具直接打开本目录**（它不是原生小程序工程），请用 HBuilderX 打开并运行到微信开发者工具。
7. `unpackage/` 下若有旧编译产物（来自早期版本），重新运行一次即可覆盖；它不需要纳入交付。
8. 演示数据在 `utils/data.js` 中以「模拟运行态」方式生成，`utils/engine.js` 按规格书的 2 s 采样 / 10 s 控制 / 90 s 心跳等节奏驱动；真实闭环在 ESP32 固件 L2 层，前端只做展示与人工操作入口。
9. **实机对接**：环境数据走 `utils/http.js + auth.js + env.js + live.js`（登录后 5 s 轮询 realtime，写入 `utils/data.js` 覆盖层，页面代码不用改）；病蚕/夹取走 `utils/clamp.js`。旧的 `utils/gateway.js` 预留层已删除。后端需实现的接口、报文与错误码见 `docs/实机对接接口.md`（第 11、12 节）；APP 端如要换 MQTT/网关盒，只需替换 `utils/http.js` 的 `request()` 传输实现。
