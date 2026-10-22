---
target: 小程序首屏 pages/index/index.wxml（含全站 15 页）
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 2
target_identity: "file:E:\\deepseek\\silkworm\\mini program\\pages\\index\\index.wxml"
target_fingerprint: "sha256:a07ea60b113905034b9fd7a703d9e211e0e7b9fdd2fb47d1d73fda9bd15840b7"
target_path: "E:\\deepseek\\silkworm\\mini program\\pages\\index\\index.wxml"
timestamp: 2026-10-22T12-19-58Z
slug: pages-index-index-wxml
---
# Critique — 养蚕环境调控小程序（首屏 pages/index/index.wxml，含全站 15 页）

Method: dual-agent（A: 20e9ce16 设计评审 · B: 419ad420 检测器+实测）

## 设计特异性判定
**category-interchangeable。** 内容自有（龄期/品种目标区间 utils/spec.js:27-34、A1–A9 耦合、箔/码垛/投叶/病蚕裁定、露点、S1–S6），形式不自有：蓝渐变 hero（app.wxss:298-334）+ 20rpx 白卡（app.wxss:16-22）+ chip + 5 tab 是小程序出厂骨架，换「蚕房→鱼塘、温度→溶氧」全部构图决策仍成立。无蚕架剖面、无龄期时间轴、无温湿度场。病蚕裁定（最领域化的对象）不在 tabBar，且藏两层。

确定性扫描：**not applicable（wxml）**。检测器对 pages/*.wxml 返回 exit 0 / []；HTML 对照页验证其有效（exit 2，报 low-contrast 1.2:1、tiny-text 9px）。量化结论全部来自源码机械测量。

## 设计健康度
| # | Heuristic | 分 | 关键问题 |
|---|---|---|---|
| 1 | 系统状态可见性 | 2 | SAFE_LOCK 仅 20rpx 徽标（index.wxml:80）；离线/传感器失效埋 21rpx 脚注（index.wxml:35）；barn-bar.wxss:42 的 !important 让在线/离线同色 |
| 2 | 贴近真实世界 | 4 | 龄期/品种/上蔟/箔/投叶/码垛/露点/耦合工况，语言确实是蚕房的 |
| 3 | 用户控制与自由 | 2 | 无撤销；解联锁后无重新锁定（control.wxml:35-61） |
| 4 | 一致性与标准 | 2 | 同设备两处开关（control.wxml:89 vs 设备详情）；骨架屏几何不一致 |
| 5 | 错误预防 | 2 | 机制齐备，但最危险动作形态最易误触（P0-1） |
| 6 | 识别而非回忆 | 2 | 需外部复制 32 位 ACTION_TOKEN；填原因时预设区间已滚出屏（machine.wxml:159-161） |
| 7 | 灵活性与效率 | 1 | 零加速器；9 个令牌 chip 平铺（control.js:153-155） |
| 8 | 美学与极简 | 3 | 克制一致；但 202 条字号声明中 95 条（47%）<12px |
| 9 | 错误恢复 | 2 | AL01–AL08 advice 好；离线/失败仅 toast |
| 10 | 帮助与文档 | 3 | S1–S6 折叠、工具目录、诚实 tip（machine.wxml:86） |
| **合计** | | **23/40** | **可接受**：领域素养高于均值，安全层级低于均值 |

## 认知负荷：高（8 项 5 项不合格）
单一焦点 ✗（control 7 卡 / 看板 5 卡+3 格+曲线+2 脚注）；分组 ✗（config.wxml:74-116 一卡 6+3+4）；视觉层级 ✗（越限 64rpx 红字 vs SAFE_LOCK 20rpx）；一次一件事 ✗（放行/忽略并排等权，machine.wxml:74-77）；决策点 ≤4 ✗（9/6/8 个 chip）；工作记忆 部分 ✗（原因框不复述当前值 vs 区间）；分组 ✓；渐进披露 ✓。

## 情绪旅程
峰值 machine.js:165-198（说清物理后果 + 危险选项染红）。低谷：冷启动 选蚕房 + 强制 420ms 骨架屏；更深低谷 SAFE_LOCK——蚕房已断电，界面仍是蓝渐变、紧急只是 20rpx 徽标；解联锁无「影响 N 路危险负载」的说明。

## 值得保留
1. utils/chart.js:243-254 — 目标区间绿带 + 限值虚线 + 越限红点：业务语义被画进图形。
2. machine.js:165-198 — 确认文案交代服务端下发、机械动作、物理顺序，危险选项染红。
3. utils/spec.js:27-34 + config.wxml:74-116 — TARGET_RANGES 是真实 6×3 农艺表，区间随龄期/品种变。

## 优先问题
**[P0] 病蚕 放行/忽略 = 两个 30.4px 高、间距 5px 的按钮，放行是绿色**（machine.wxml:74-77，machine.wxss:236-250）。放行会让抓取机真的抓取码垛（全 App 唯一不可逆物理动作）；绿色在本产品语义里=安全；mode=aspectFill thumb 一滑即误触；无震动/长按/回执。实测 .btn-mini 机械页 30.42px，12/20 可点元素 <44px。修：忽略降为 22rpx 文字链；放行整条 88rpx 实底红 + vibrateShort heavy + 可取消 3s 倒计时。→ /impeccable harden + /clarify

**[P0] SAFE_LOCK/离线/传感器失效无屏顶存在感**（index.wxml:80、index.wxml:35、barn-bar.wxss:42）。修：index.wxml:1 之上加全局状态条，mode∈{safe_lock,offline} 或 sensor_ok=false 时占 .lock-card 红样式；删 barn-bar.wxss:42 颜色覆盖。→ /impeccable layout + /colorize

**[P0] 状态色与微字号户外不可读**（#f59e0b/白 2.15:1、#10b981/白 2.54:1、#8b95a7/白 3.02:1、.btn-primary 渐变右端 3.16:1；正文 22rpx=11.44px、21rpx=10.92px）。修：.text-warn/.text-ok 换文字可用深色（#b45309/#047857），橙只作填充；阅读型小字提到 ≥24rpx。→ /impeccable typeset + /colorize

**[P1] 招牌功能不在 tabBar，冷启动还要过选择页**（app.json:32-36、app.json:2-3）。修：机械换进 tabBar、账号移到看板右上头像；首屏加「待裁定 N 头」直通条；记住蚕房后直接 switchTab。→ /impeccable shape + /layout

**[P1] 令牌审批 = 9 平铺 chip + 只能粘贴**（control.wxml 令牌卡、control.js:153-155）。修：只显示本页可操作设备并预选；内联显示解析结果与解析失败原因。→ /impeccable clarify

## 人设红旗
Casey（单手/手套/被打断）：.sw-btn≈33dp、.btn-mini 29–30dp、.chip 29.12dp×37 全低于 44dp；放行/忽略间距 5px 拇指滚动误触；确认仅模态无震动/声音；21rpx 脚注把 8 状态压一行。
Sam（无障碍）：越限只靠颜色（index.wxml:17,22）无箭头；.mode-* 2.2–2.5:1；无深色模式；rpx 不随系统字号缩放；全站 0 个 aria-role/aria-label、0 个 <button>。
Riley（异常路径）：后端地址/令牌/zone/请求日志在「我的」（mine.wxml:174-214）谁都能改指向；演示角色切换器（mine.wxml:61-66）让权限成摆设；告警详情每次渲染完整 AL01–AL08 目录（alarm-detail.wxml:76-91）；420ms 最短骨架屏让「已到达」读成「又卡了」。

## 小观察
.lg-red（index.wxss:204）死 CSS；告警详情显示原始 ISO8601 且「当前状态」打印两次（alarm-detail.wxml:27-33）；设备详情暴露 BOM（DHT22/GPIO/DC5V 0.42A）；同设备两处开关；骨架屏与 barn-bar 顺序不一致导致头部跳动；「重置演示数据」危险按钮留在关于卡；report/history 各写一套时间段 chip；无 wx.setKeepScreenOn；全站 1 个动画（skeleton 1.4s，无 reduced-motion）、0 transition。

## 值得想一想
1. 凌晨三点 SAFE_LOCK，首屏应只装一个事实，为何是第三张卡标题里的 20rpx 徽标？
2. 从看到病蚕照片到机械臂启动有几秒？那几秒需要的是两个相邻按钮，还是必须长按的承诺？
3. 15 页 5 tab，砍一个——为什么不是病蚕裁定？
