---
type: approval
date: 2026-09-30
origin: proactive
---

# 待拍板：to-approval 落点参数化 ＋ plan-lint 归属一致性校验（2026-09-30）

**Status:** closed

## 〇、背景与你的两点要求（原话）

> 1. plan-lint 怎么知道当前场景是什么，怎么兜底。这个需要明确
> 2. 我认为应当给 to-approval 增加参数，让调用方传入，除了人工调用以外，都应当生成在对应 effort。需要帮我看到有没有遗漏的场景。

**一处理解修正（已确认）**：`disable-model-invocation: true` 语义 = 防自发加载、不防明文调用（2026-09-28 实测口径）——因此「人工调用 vs 非人工调用」在机制上**不可区分**（skill 执行时拿不到调用者身份信号），原规则的分界词需修正为：**默认落 effort、全局是例外必须显式声明**。

## 一、问题 1 的答案：lint 不需要知道场景

plan-lint 是无状态静态检查，永远拿不到会话上下文（哪个 effort 在活跃推演、某拍板主题归属谁）。「场景」知识换一个载体落盘：**审批档 frontmatter 增加归属声明字段**——

- 图内档：`effort: <slug>`（新字段）；
- 全局档：不带该字段（全局是 `.plan/approval/` 专属，路径即声明）。

lint 新增检查（拟编 [10] `approval-scope`）机械校验**声明与落点的一致性**：

| 档面 | 落点 | 判定 |
|---|---|---|
| `effort: X` | `.scratch/X/approval/` | ✓ |
| `effort: X` | 其他任何位置 | ✗ `approval-misplaced` |
| 无 `effort:` 字段 | `.plan/approval/` | ✓（全局） |
| 无 `effort:` 字段 | `.scratch/<任何>/approval/` | ✗ 缺归属声明 |
| 带 `effort:` | `.plan/approval/` | ✗ 全局档不得带 effort 字段 |

这样「场景」从两处来：**落参数时由调用方显式给**（写进声明），**收口时由 lint 校验声明没撒谎**。lint 全程不知场景、只验一致性——这是它能兜的全部，也是该兜的全部。（语义层「内容主题 vs 声明」错位仍不可机械判，归 plan-loop 盘点时人工软检查。）

## 二、问题 2 的方案：参数化形态

`/to-approval <effort-slug | global> [主题]`——**参数必填**：

- 人工无参调用 → skill 第一步问归属（用户在场，一问一答成本为零；有会话上下文时给推荐默认并确认）；
- 明文调用（plan-loop / 推演子代理 prompt）→ 调用方文本同步要求传参，effort 取调用处上下文（缺陷挂图下、票属图，天然有 slug）。

存量：`.plan/approval/` 31 档全局档无 `effort:` 字段 ✓ 免补；effort 内存量审批档（本仓现无）落地后补声明。

## 三、遗漏场景清单（全量盘点产出，5 处联动）

| # | 场景 | 现状问题 | 需动 |
|---|---|---|---|
| 1 | **grilling 补丁节**（自己写档不调 to-approval） | 写「saved under `.plan/`」——①收拢前旧口径；②无两级归属规则：图内拷问的问题档会写进全局 | grilling/SKILL.md 补丁节改两级规则 |
| 2 | **plan-loop 收口裁决单** | 落 `.plan/待拍板-收口裁决单-round-<NNN>-<日期>.md`（SKILL.md:69）——**09-30 检查[9] 严格化后即违例**（根层只容 README），plan-loop 下次收口必撞 lint。收拢 sweep 漏网（模板占位路径无实体文件，自动改写脚本按目标存在才改，正确地没动它） | 落点改 `.plan/approval/`（裁决单=跨图收口产物，全局件） |
| 3 | **plan-loop 盘点范围** | 「同时扫 待拍板-*.md」未写明范围——effort 内 `approval/` 档不在盘点语义，图内待拍板漏呈报 | 盘点范围写明两级 |
| 4 | **plan-loop:51 明文调用 to-approval** | 「缺陷暴露需求级分歧 → 转 to-approval 立审批档」无传参指示 | 加「传缺陷所属 effort slug」 |
| 5 | **PlanView 推演子代理**（EXPLORE_PROMPT） | 「需要人拍板的结论，用 to-approval 落成待拍板文档」无 effort 注入 | prompt 注入发起图的 slug |

不涉及：wayfinder（拍板记票面/map，不产独立审批档）、grill-with-docs（无落档指令，落档走 to-approval，参数化后自动覆盖）、to-spec / plan-approve（只翻标不产档）、install-skills.sh（改的是 skill 源文本，分发面不变）。

## 四、选项

- **A（推荐）**：全量落地 §一 + §二 + §三五处联动 + lint 新检查[10]，一拍一票清完。
- **B**：只做参数化与五处文本（§二+§三），lint 检查[10] 缓立——兜不住「声明缺失」，违背你第 1 点「需要明确」，不推荐。
- **C**：另立票分期——参数化与 lint 检查分两轮，颗粒度小但两次施工两次验证。

拍板 A 后建议以 plan-lint-gate 或新 effort 立票实施（改动面 = 2 个 skill 源 + plan-lint.sh + PlanView.tsx 重建 + 测试 + 协议正本一处）。

---

## 五、裁定记录（2026-09-30，plan-approve 结算）

**你的原话**：

> A
> plan-loop，默认就放到 .plan/approval/

- **A 全量落地**：参数化（§二）+ lint 声明一致性检查[10]（§一）+ 五处联动（§三）一轮清完。
- **追加裁定**：plan-loop（收口裁决单）**默认**落 `.plan/approval/`——裁决单是跨图收口产物、全局件，不需逐轮判断归属；plan-loop 场景的 to-approval 调用默认传 `global`（明确归属某图时才传该图 slug）。遗漏 #2/#3/#4 按「plan-loop 默认全局」统一处置。

**落地类型**：代码（to-approval / grilling / plan-loop 三 skill 源 + plan-lint.sh 检查[10] + PlanView.tsx 重建）+ 协议正本一处，本会话当场施工，commit 见结算汇报。
