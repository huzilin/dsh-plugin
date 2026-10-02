---
type: task
---

# 02: plan-lint 检查[6] `.plan` 根层白名单

**Status:** resolved 2026-09-29

**What to build:** plan-lint.sh 新增检查 [6] `plan-root-whitelist`：仅当遍历目录名为 `.plan` 时生效——根层子目录白名单 qa/ledger，豁免 handoffs（存量）与含 map.md 子目录（存量旧布局 effort），清单外即报；头注释「抓五类漂移」扩为六类并记判据正本。

**Blocked by:** 01（白名单清单 = 协议「全局件」封闭清单）

**Source spec:** `.scratch/global-items/spec.md`

## Acceptance

- [x] `/tmp` 夹具四态自测：清单外目录报 `plan-root-whitelist`，qa/ledger/handoffs 与含 map.md 存量目录豁免
- [x] 本仓全量（`.scratch` + `.plan`，68 个 markdown）0 发现
- [x] 脚本 `bash -n` 语法过、安装注入面七个目标自检全过
