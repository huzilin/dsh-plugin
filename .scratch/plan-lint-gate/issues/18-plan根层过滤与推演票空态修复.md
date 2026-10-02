---
type: task
claimed_by: dsh-plugin 会话（implement-spec 直推）
---

# 18: `.plan` 根层过滤（路线页干净）+ 推演票空态崩溃修复

**Status:** resolved 2026-09-30
**Blocked by:** None — can start immediately

**What to build:** 用户 2026-09-30 报「路线页看到 issues 以外的内容」（截图：`.plan/` 根层 4 份调研档被当票展示 + `tickets/` 存量票），定性「路线就不该看到」。数据侧迁移（tickets/ 重编号 + 根层 9 份分流）经用户指令**挂账不动**，本票只修视图侧识别。

**Source spec:** 用户原话「先不要迁移，你要先解决这个不该看到的东西，被页面识别到的这个问题，这个也是我刚才这轮的重点」。

## 改造项

1. **`.plan` 侧根层展示白名单**：loadPlan 对 `effortScan=false`（.plan 侧）的根层 md 收集加 `PLAN_ROOT_ALLOW = /^(?:待拍板|已拍板)-/` 过滤——与 plan-lint 检查[9] 同判据、双源一致；形状不符的根层文件（复盘-/梳理-/需求- 类违例）不收集、不当票展示。与「.plan 子目录一律不作为 effort 加载（2026-09-29 拍板）」同构：视图不迁就违例数据。
2. **推演票空态崩溃修复**：SpeculationView 空态兜底引用了 GuideView 函数内局部组件 `Code`（票 12 潜伏 bug——空态分支此前从未执行），项 1 落地后 dsh-plugin 推演票归零、空态首跑即 `ReferenceError` 白屏。换原生 `<code>` 元素。

## Acceptance

- [x] 路线页（地图 tab）不再出现 `.plan/` 根层调研票（部署后用户浏览器验证口径：Open 列仅剩 17 号真票）
- [x] 推演票子页空态正常渲染、控制台零错误（隔离实例复现 → 修复 → 验证闭环）
- [x] 总览全局待拍板区不受影响（审批档形状仍收集）
- [x] `node --test test/` 6/6 绿

## Answer

两笔 commit：`f497572`（PLAN_ROOT_ALLOW 过滤，effortScan=false 分支）+ `51f63a7`（空态 `Code` → 原生 code）。均已部署 :3080（31528→2200→12999 三轮重启，末轮验证监听者 elapsed 与 bundle 特征对齐）。**边界**：`tickets/` 存量票仍在视图白名单内（存量只读兼容口径）照常显示——其「不该看到」只能靠数据迁移解决，迁移挂账用户名下（撞号需重编号，见票 17 立项背景）。README 同不收（lint[9] 豁免 = 不报违例，视图不展示，两语义不冲突）。
