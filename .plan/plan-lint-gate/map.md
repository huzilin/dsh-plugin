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
- 2026-09-27 用户拍板（novel 体检 D3 引出，原话「这个参考 /plan-protocol 是不是有哪里没对齐，如果是协议和 wayfinder 本身没对齐，那需要让协议对齐，然后再适配」）：立 [票 06 协议与 wayfinder 状态契约对齐](tickets/06-协议与wayfinder状态契约对齐.md)——体检实测三处未对齐：①`status` 字段存 vs 不存（协议「frontmatter 是权威」vs wayfinder 标 `deprecated` 且 lint 报错）；②状态词表（wayfinder 合法集无 `done`）；③后果实证=`.plan/micro-fixes` 四票全 `status: done`，`wayfinder-maps status` 读成「0 resolved · 4 open」。票内三选项，推荐改工具识别实施图票（A）。novel 侧适配票=`.plan/merge-prep-adapt/tickets/01`（序列上后置于本票结论）。
