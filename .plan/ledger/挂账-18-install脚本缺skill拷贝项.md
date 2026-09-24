---
type: ledger
date: 2026-09-24
status: closed
origin: review
---

# 挂账-18 install 脚本缺 plan-protocol 拷贝项

- 状态: 已销
- 卡点: 无——当轮修复
- 启动条件: 已满足（2026-09-24 当轮落地）
- 来源: 2026-09-24 dsh-plugin 会话盘点发现（2026-09-20 两条单向漂移的成因之一）；用户拍板「按建议修改」+ 挂账「可」

## 发现与处置

install-skills.sh 拷贝清单不含 plan-protocol——安装态 `mp-plan-protocol` 一直靠人工拷贝对齐，一旦漏拷即生单向漂移。处置：拷贝逻辑改 glob 全量（并行 session 同轮改写，含 plan-archive / plan-protocol 映射）；本会话补 `diagnosing-bugs → mp-diagnosing-bugs` 映射（防 glob 默认装出错位 id），并把 plan-lint 注入面从 approve/sync 扩到收口六 skill（mp-diagnosing-bugs、run-qa-testcases、mp-implement、mp-implement-spec）。

销账注记：2026-09-24 当轮修复并跑 install 验证——mp-plan-protocol、mp-diagnosing-bugs 由脚本安装，六目标 lint 注入全中，self-check 通过；源仓=安装态 diff 归零。改动未 commit，待用户过目。
