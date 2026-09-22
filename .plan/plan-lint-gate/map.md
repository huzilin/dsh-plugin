# plan-lint 校验门禁 · 路线图

## Destination

`.plan/` 的结构性漂移（同票双档、缺 map.md、缺状态头/非法 status）由只读脚本一把抓出，说明页引用真实可用——不再靠人眼复盘。

## Notes

- **Source spec**: `.plan/待拍板-plan-lint门禁与说明页悬空引用-20260918.md`（用户拍板 A，原话「A」）
- 工单形态：实施工单（`type: task`，frontmatter 存 `status`），非 wayfinder 推演地图。
- 规则正本是 `skills/plan-protocol/SKILL.md` 第三节「文档形态约定」；脚本只是它的执行者，规则改动先改协议。

## Decisions so far

- 2026-09-18 用户拍板 A：建独立只读脚本 + 修说明页悬空引用（结算《待拍板-plan-lint门禁与说明页悬空引用-20260918》）。
- 2026-09-23 用户拍板「1A 2A 3 修复」：①分发内置随 skill（skill 自包含，装到哪个仓库都能跑）；②sh 收口为唯一实现（mjs 退役，GuideView 文案随改）；③install-skills.sh 目的地与清单修复并实际同步（源 spec：《待拍板-plan-lint随skill内置分发-20260923》，已 closed）。落票 02（sh 口径合流）→ 03（随 skill 分发内置）→ 04（install 修复与同步）。
