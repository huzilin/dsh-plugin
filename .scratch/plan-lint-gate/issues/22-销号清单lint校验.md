---
type: task
---

# 22: 销号清单 lint 校验（E' spec 变更总线配套机械面）

**What to build:** 2026-10-04 E' 拍板（审批档 `.plan/approval/待拍板-文档sweep范围起草侧漏圈-20261003.md` §七 Q4）的加法配套项：spec「分流清单」（销号清单）目前只有协议文本定义（plan-protocol §三「变更总线与销号清单」条），无机械校验。本票给 plan-lint 新增检查：①spec 附分流清单时，断言「清单全清」方可作为退役凭据（与 G4 前置判据④「销号清单全清」配套——plan-archive 执行面）；②清单形态细则（清单写在 spec 何处、行格式、销号标记）需先在协议层定稿（本票前置），再落 lint 解析。注意与检查[5]（premature-supersede，本拍板同批已落）分工：[5] 管「退役时点不早于收口」，本票管「退役凭据不虚标」。

**Blocked by:** None — 协议条款已在位（plan-protocol「变更总线与销号清单」），形态细则可在本票内一并起草交拍板。

**Status:** open

## Acceptance

- [ ] 销号清单形态细则定稿（协议行格式＋销号标记），过用户拍板。
- [ ] plan-lint 新增检查：清单存在且含未销项时，spec 标 superseded-by 即报（或归档前置校验报）。
- [ ] 既有 effort spec（含 novel 侧）在新检查下零误报实测。
- [ ] install-skills.sh 分发后安装态同步生效（自检绿）。
