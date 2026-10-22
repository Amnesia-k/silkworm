# 设计方向：Oura（暖纸 / 桑绿 / 发丝线）

> 2025-10 由 `impeccable critique`（`.impeccable/critique/2026-10-22T12-19-58Z__pages-index-index-wxml.md`）得出：
> 现状 23/40，判定 category-interchangeable。选定 Oura 作为整站视觉语言，**看板（index）与机械（machine）两页已打样落地**，其余 13 页待铺。

## 一、为什么是 Oura

- 材质对得上：蚕丝是暖白，桑叶是森林绿/橄榄/鼠尾草，蚕室灯光是金——Oura 的调色板几乎是照着蚕来的。
- 隐喻对得上：Oura 是「一个身体的生命体征系统」，这里是「一个蚕房的生命体征系统」，看板于是从「卡片列表」变成「一次读数」。
- 顺手解决 P0-3：土色加深后天然过对比度，橙/绿不必再当亮色文字用。

## 二、Token

| 角色 | 值 | 用途 |
|---|---|---|
| canvas | `#f7f1e8` | 页面底色（暖纸） |
| surface | `#fffdf8` | 弹层/输入底 |
| ink | `#1c1b1a` | 正文与数字 |
| stone | `#6b6257` | 次要文字（5.33:1） |
| hairline | `#e1dcd3` | 分区线（1rpx） |
| hairline-soft | `#ece5d8` | 列表内分隔 |
| forest | `#224228` | 在线/正常/主强调（9.96:1） |
| olive | `#5c6f5d` | 次级绿 |
| sage | `#849671` | 湿度曲线、目标带边 |
| sage-pale | `#ced4b8` | 目标区间带 |
| gold | `#af751b` | 平均线/警戒 |
| gold-ink | `#8a5a12` | 金色文字（5.27:1） |
| alert | `#8f1d14` | 危险实底/危险文字（7.95:1） |
| action | `#2454c9` | 唯一操作色（6.59:1） |

字体：数字用衬线 `Georgia, "Times New Roman", "Songti SC", serif` 仅用于**生命体征数字与仪表读数**；中文一律系统无衬线。Oura 的 Editorial New 无中文字形，这是唯一刻意的偏离。

## 三、全局硬规则（P0，已改 `app.wxss`）

1. 阅读型字号 **≥24rpx**（≈12.5px）；两个打样页已做到 0 条 <12px。
2. 可点元素 **≥88rpx**（≈44px）高：`.chip`、`.btn-*` 用 `min-height`；`.card-more`、`.sbar-act`、`.note-act`、`.vlink` 用「垂直 padding + 负 margin」扩大热区而不撑高版面。
3. 状态色只作文字，且必须用深值：橙 `#b45309`、绿 `#047857`、红 `#b3261e`、蓝 `#2454c9`。
4. 不再使用「彩色胶囊」表达状态；徽标在 Oura 页内退化为纯文字（`.oura .badge { background: transparent; padding: 0 }`）。
5. 不用左侧色条（craft floor 明确拒绝 >1px 的侧边条）：越限提示改用整块暖底 note。

## 四、看板 / 机械两页做了什么

**看板 `pages/index`**
- 两个 104rpx 衬线数字并列，下面各一条 **目标区间刻度尺**（浅色段=目标区间，竖线=当前值，越限转红）。
- 越限从「一列红字」改为一条暖底 note + 「去控制 ›」。
- 卡片退化为发丝线分段（无背景、无圆角、无阴影）。
- 三格速览：去卡片，改发丝线分隔的无卡三格，数字用衬线。
- 图例配色改为 ink / sage / sage-pale / gold。

**机械 `pages/machine`**
- 概览三格同上处理。
- 病蚕裁定：**放行**从 30.4px 绿色小按钮改为整条 96rpx 实底红 `#8f1d14`，且**必须长按 0.8 s**（轻点只提示手势），长按触发 `wx.vibrateShort({type:'heavy'})` 并进入原有的二次确认；**忽略**降为 24rpx 文字链。这一条是整轮 P0 里唯一涉及不可逆物理动作的。
- 参数行数值用衬线；越界值用 `#8a5a12`；弹层底色改暖纸。

**安全状态条 `components/safety-bar`**
- 新增组件，挂在页面最顶部。`safe_lock` → 深红，离线 → 深灰，传感器失效 → 琥珀；白字对比度 7.1~12.3:1。
- 正常时不渲染、不占位；每 4s 刷新一次且内容不变就不 `setData`。

## 五、其余 13 页铺开顺序（建议）

1. `control`：7 张卡 → 分组分段；令牌 chip 只显示本页可操作设备并预选。
2. `alerts` / `alarm-detail`：告警行改编辑体（级别小字 + 衬线编号）。
3. `history` / `report`：曲线配色换 ink/sage/gold；统计条去卡片。
4. `config`：四组手风琴沿用，滑杆数值改衬线。
5. `mine` / `users` / `tokens` / `login` / `agent` / `device-detail` / `room-select`：套 `.oura` 类 + 换色，工作量最小。

落地方式：给页面根节点加 `class="oura"`，在页面 wxss 里补 `page { background: #f7f1e8 }` 与 `.oura .card { ... }` 三件套（参考 `pages/index/index.wxss` 头部）。

## 六、验证边界

- 已跑：`check-pages` 0 问题、`check-handlers` 18 组件、`smoke-test` 61/0、`migrate` 15 页 + 3 组件 + 10 utils、`check-uniapp` 19/19、`render-test` 18/18（canvas 2168 次）。
- 字号/对比度/热区：脚本实测 **0 条 <12px、17/17 对比度达标、0 条热区不足**（脚本为一次性，未入库）。
- 未做：真机观感、深色模式、系统字号缩放（rpx 不跟随）、`aria`/无障碍播报。这几条仍是 next。
