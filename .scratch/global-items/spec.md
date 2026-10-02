# Spec：全局件治理落地批（global-items）

> **决策来源**：`.plan/待拍板-全局件概念与全局目录-20260929.md`（2026-09-29 五项拍板全 A，closed，已翻 `archived:` 标）。写前已读架构正本 `docs/architecture.md`（2026-09-29）。**主体已于拍板结算当轮落地**（commit 1a38ef6 / b2aa101 / 01c8aa2 / 21e1a75），本 spec 如实划分「已落地对账面」与「剩余实施面」。

## Problem Statement

> **归宿（2026-09-29）**：→ docs/requirements/global-items-全局件治理.md §Problem

plan 生态全局性落点无名字、无定义、无判据，novel 迁移批暴露三处冲突（表述相抵、判据空白、双重身份目录靠推断）；DSH 安装目录变更后脚本目标死投递。

## Solution

> **归宿（2026-09-29）**：→ docs/requirements/global-items-全局件治理.md §Solution ＋ 契约正本 plan-protocol §三「全局件」条（协议文本已落地，commit 1a38ef6）

「全局件」封闭三件套入协议正本（定义/豁免/生命周期/归档口径一处定义）；plan-lint 根层白名单守门；安装目标迁 `~/.dsh/skills`；视图文案挂术语。

## User Stories

> **归宿（2026-09-29）**：→ docs/requirements/global-items-全局件治理.md §User Stories

八条用户故事见需求文档（跨仓会话/迁移批/维护者/归档会话/DSH 用户/视图用户/novel 维护者各视角），此处不复制。

## Implementation Decisions

> **归宿（2026-09-29）**：→ 契约正本 plan-protocol §三「全局件」条＋§四 G2/G4 修正 ＋ docs/architecture.md §三（安装两级制）——均已落地

1. **设名不换词**：「全局件」已是协议与视图文案的自发用词，正名补定义，成本最低；定义节落 plan-protocol §三（跨仓契约层），本仓 CONTEXT.md 不收（避免双正本）。
2. **封闭清单优先于判据枚举**：三件套白名单才能被 lint 机械守门；research/handoffs 写为「全局场景但非全局件」（docs/research 与 .tmp 各有归宿）。
3. **豁免优于强拆**：全局件目录内含 map.md（历史内嵌图）豁免 effort 判据，存量旧布局可读；强拆只赚目录语义纯净，付迁移成本。
4. **全局台账不入归档判据**：G4 判据③只清图内台账，长期在挂的全局债务不阻塞轮归档。
5. **守门进 lint 不进纪律**：白名单检查（检查 [6]，仅对 `.plan` 目录生效）是封闭清单能维持的机械保障；豁免 handoffs 与含 map.md 存量目录。
6. **安装目标跟随宿主**：SKILLS_DST 默认 `~/.dsh/skills`，脚本头注释留 ticket 04 历史（防考古误判），覆盖口 `SKILLS_DST` 保留。

## Testing Decisions

> **归宿（2026-09-29）**：→ docs/requirements/global-items-全局件治理.md §验收与测法

测外部行为不测内部形状：lint 走 CLI 退出码与报告文本（`/tmp` 夹具四态 + 本仓全量）；安装走 self-check + `diff -r` 全树；视图文案走构建 + grep，真机走查按「留证待审」后补（截图照拍不记「通过」）。已落地各票的验收以 commit 凭据对账（implement-spec 对账回写），不重做。

## Out of Scope

> **归宿（2026-09-29）**：→ docs/requirements/global-items-全局件治理.md §范围外

novel 侧改动、map.md 创建（wayfinder/用户职权）、CONTEXT.md 收词、视图行为变更、旧安装态清理。

## Further Notes

> **归宿（2026-09-29）**：→ archive（过程物）——已落地凭据：commit 1a38ef6（协议+回扫+拍板档）、b2aa101（lint 白名单+违例迁移）、01c8aa2（指针补记）、21e1a75（安装目标）；semantica `5f63f71e`（决策因录，链 novel 推断 `90bb0996`）

剩余实施面两票：05 视图文案统一、06 spec-only effort 视图适配（2026-09-29 用户拍板原话：「没有 map，就必须有 spec，只有 spec 就视为实施图。也要展示，需要页面兼容」）。本 effort 即首个 spec-only 实施图——判据扩展（map.md 或 spec.md）落地后自身被视图加载，原「无 map 待拍板」已决。
