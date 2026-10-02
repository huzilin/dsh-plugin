---
type: task
---

# 06: 视图适配 spec-only effort（无 map 有 spec 视为实施图并展示）

**Status:** resolved 2026-09-29

**What to build:** 2026-09-29 用户拍板（原话：「.scratch/global-items/ 无 map.md，6 个票形文件视图不加载 这个符合预期，这个需要视图层适配，没有 map，就必须有 spec，只有 spec 就视为实施图。也要展示，需要页面兼容」）——effort 判据扩展：`.scratch/` 下目录含 `map.md`（wayfinder 图）**或 `spec.md`（spec-only 实施图）**都算 effort；spec-only 图进 effort 分组（按票型自动归实施图组）、工单/审批等子页正常；路线页 destination 横幅空缺已安全兜底，chip 加 spec-only 标注。联动：plan-lint 检查 [2] 豁免同步扩为「缺 map **且**缺 spec 才报」；plan-protocol「effort 标志」条与 §二 to-tickets 行、to-tickets skill 文本同步口径。

**Blocked by:** None — can start immediately（判据扩展独立于票 05 文案）

**Source spec:** `.scratch/global-items/spec.md`

## Acceptance

- [x] loadPlan 子目录发现判据 = map.md 或 spec.md；spec-only effort 进 efforts（mapRaw 空），票照常加载
- [x] EffortChips 对 mapRaw 空的 effort 加 spec-only 标注（chip 后缀 📄 + title 说明「无 map.md，凭 spec.md 加载，路线页无 Destination」）
- [x] plan-lint 检查 [2] 口径同步：有 spec.md 落路径的目录不再报 missing-map；本仓全量 0 发现（global-items 两条发现消解，75 markdown）
- [x] plan-protocol「effort 标志」条、§二 to-tickets 行、to-tickets SKILL.md 口径一致（双源零漂移）；install-skills 同步过
- [x] esbuild transform 语法零错；bundle 已随构建链恢复一并复验过（`tsdown.standalone.ts`，2026-09-29，新判据与 spec-only 标注均编译进产物）

## 落地注

- 2026-09-29 implement-spec 降级模式（当前分支直推）：loadPlan 判据扩展（注释记拍板依据与兜底链）＋ EffortChips 标注 ＋ lint 检查[2] 加 `has_spec_on_path` 豁免（/tmp 夹具三态自测：map 图过、spec-only 过不报、bare 报）＋ 协议两条与 to-tickets 文本同步。本 effort 即首个 spec-only 实施图——判据扩展落地后自身被视图加载。
