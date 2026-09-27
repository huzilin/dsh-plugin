---
type: task
blocked_by: []
status: open
---

# 07: nvwa 存量 `type: impl` 票回扫为 `task`

**What to build:** 把 nvwa 仓 `.plan/dna-ab-full/tickets/` 下 **15 张 `type: impl` 票**回扫为 `type: task`，使 `impl` 票型别名在存量中彻底清零；清零后删除插件读取层的 `LEGACY_TICKET_TYPES` 容错集合。

**Blocked by:** None — can start immediately（本票为跨仓动作，dsh-plugin 侧已完成的废弃改动不依赖它）

**Source spec:** `.plan/待拍板-协议与wayfinder状态契约对齐-20260927.md`（用户 2026-09-27 `/plan-approve` 裁定，原话见该文档 §裁定记录）

## 背景

用户 2026-09-27 裁定收口 `impl` 票型：

> 既然 impl 不合法，那我期望做的就是收口
> 1. 清理掉 plan 内任何 impl type 的说明
> 2. 统一 impl 和 task 的类型，以及 plan-view 插件的展示层。

**前提更正（实测）**：`impl` 并非「不合法」，而是**被协议追认为合法的历史别名**（旧表述「实施图票型 `task`/`impl`」，附「`impl` 为早期别名，不再新用」）——真正的缺陷是**协议内部自相矛盾**（「图二型」承认它、「`type` 取值约定」清单不收它）。dsh-plugin 侧已按「废弃别名」口径收口；**存量票的回扫按用户裁定属「做法乙（彻底清零）」，但范围被限定为「先只动 dsh-plugin 本仓」**，故 nvwa 15 票立本票后置处理。

## 为什么不能直接删插件容错

插件 `PlanView.tsx` 的 `ticketKind()`（`:386`）用 `TICKET_TYPES` 判定文档是否归「工单」类：

```ts
if (ty && !TICKET_TYPES.has(ty)) return 'note'
```

若在存量票未回扫时把 `'impl'` 移出该集合，nvwa 那 15 张票会被判成 `'note'`，**静默掉出工单视图**（这正是该处注释 2026-09-24 起反复警示的失效模式：`// A repo writing type: impl must not start with every row filtered out.`）。故 dsh-plugin 侧采取「声明废弃 + 读取容错」双轨：协议词表只收 `task`，插件 `LEGACY_TICKET_TYPES = new Set(['impl'])` 保留读取。

## 待回扫清单（15 张，实测）

`nvwa/.plan/dna-ab-full/tickets/`：

- `AIT1-lieflat-shouxiao-shice.md`、`AIT2-aitone-guard-guhua.md`、`AIT3-l2-gaixie-mangce.md`
- `OPT1-writecheck-midu-yingmen.md`、`OPT2-weizhi-pianli-prompt.md`、`OPT3-kaiju-zhangxing-ku.md`
- `OPT4-shuang-pingwei-jiaocha.md`、`OPT5-lengmen-30-duizhao.md`、`OPT6-yanzhenglun-shoukou.md`
- `OPT7-a-paiban-duiqi-shidian.md`、`OPT7-b-r4-dipingxin-shuangpingwei.md`、`OPT7-c-liushuixian-guhua.md`
- `OPT8-a-r5-quanliang.md`、`OPT8-b-gouzi-li-zhuanxiang.md`、`T1-wuyuliao-sanzuozhe-wuliao-qingli.md`

## 回扫口径

1. **只改 frontmatter 的 `type:` 值**：`type: impl` → `type: task`；其余字段（`blocked_by`/`status`）一律不动；
2. **正文零改动**——本回扫是 `type` 词表迁移，不是内容重写；不新增/删除任何章节；
3. **在 `map.md` 的 Notes 补一行**迁移注记（日期 + 迁移范围 + 依据本票），使该图读者知道曾有此形态；
4. 按协议「形态契约变更回扫」条款，此回扫属**该条款的存量迁移项**，完成后即视为条款履行。

## 收尾联动（dsh-plugin 侧）

nvwa 15 票回扫完成、`type: impl` 全 workdir 清零后，**回 dsh-plugin 删除插件读取层的 `LEGACY_TICKET_TYPES`**：

- `packages/dsh-plan-view/src/client/PlanView.tsx:363` 删 `const LEGACY_TICKET_TYPES = new Set(['impl'])` 及其上方注释块；
- `:357` `TICKET_TYPES` 恢复为字面量 `new Set(['task', 'research', 'prototype', 'grilling'])`；
- `:415` `IMPL_TYPES` 恢复为 `new Set(['task'])`；
- `:1001` 注释「carrying legacy `type: impl` tickets (nvwa, not yet swept)」同步删除；
- 重新构建（`tsdown`）并跑 `install-skills.sh` 校验两处 md5 一致。

**注意不要误删**（`impl` 另有两个非票型身份，见 `PlanView.tsx:412-414` 注释）：`MapKind = 'speculation' | 'impl'`（插件内部类型名，实施图分组标识）与历史目录路径支持 `impl/`、`impl-fe/`（`resolveEfforts` 的 workstream 分支）——这两者与票型无关，**永久保留**。

## Acceptance

- [ ] nvwa 15 张票 `type:` 全部为 `task`，正文零改动
- [ ] `grep -rn '^type: impl' ~/workdir/*/.plan` 全 workdir 零命中
- [ ] nvwa `map.md` 补迁移注记
- [ ] dsh-plugin 插件 `LEGACY_TICKET_TYPES` 已删除，`TICKET_TYPES` / `IMPL_TYPES` 收为 `task` 单一值
- [ ] `MapKind='impl'` 与 `impl/`、`impl-fe/` 路径支持**仍在**（未被误删）
- [ ] 插件重新构建通过；`install-skills.sh` 后源仓与安装态 md5 一致
- [ ] 两侧 plan-lint 收尾零漂移
