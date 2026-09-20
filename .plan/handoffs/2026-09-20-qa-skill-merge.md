---
type: handoff
date: 2026-09-20
status: closed
origin: retrospective
---

# Handoff：QA 技能族合并 + 缺陷台账接入 plan（设计已决、待实装）

> **【已结案 2026-09-20】** 三张票全部实施完毕并回写（01/02/03 均 status: done），票 03 通过页面预期验收（P-1/P-2/反向断言）与独立代码评审（可合入；1 条 P2 已修+实测，6 条 P3 备案）。执行记录见 `.plan/qa-skill-merge/map.md` Decisions 节与各票落地记录。留用户的开口：①新开会话验证 skill 列表（run-qa-testcases 出现、test-design-gate/test-protocol 消失）；②全部改动未 commit，待显式指令；③plan-protocol 源仓 L76 与安装态在本轮之前已分叉的一行待裁决（票 02 落地记录有备案）。以下为交接原文，供追溯。

> 本轮把「测试技能族四个收成两个 + 缺陷台账进 plan 视图」从一句疑问推进到**设计已决、工单已立、待实现**。本文只交代上下文、裁定、风险与下一步；**完整方案见 `.plan/待拍板-测试技能族合并为两skill-20260920.md`（已 closed，十一项裁定全定），不要重复造**。

## 一、这一轮在做什么

用户起于一句疑问：「`to-qa-testcases` 和 `test-design-gate` 是不是有重叠，我期望有一个专门基于测试用例执行 + 缺陷管理的 skill」。实测确认重叠属实（同一套方法论被三个 skill 各写一遍，连触发词都叠），于是收敛为**两个 skill**，并追加了 impl map 组织、目录对齐、缺陷台账进 plan 等要求。

**最终形态**：

| | 现在 | 合并后 | 干什么 |
|---|---|---|---|
| skill 1 | `to-qa-testcases`（120 行，四件事全包） | **`to-qa-testcases`**（收窄） | 构建测例：七源盘点 → 用例设计 → 可执行资产 |
| skill 2 | `test-design-gate`（85 行） | **`run-qa-testcases`**（新建） | 跑测例并出缺陷报告：执行 → 验收记录 → 缺陷台账 → 返工闭环 |
| skill 3 | `test-protocol`（35 行 + 5 参考文件） | 并入上面两个 | — |

## 二、十一项裁定（正本在方案文档第七节，此处只列索引）

用户已全部拍完，**无剩余待拍项**。关键几条（原话在方案文档第二节）：

- **命名**：`to-qa-testcases` 保留 + `run-qa-testcases` 新建；`test-design-gate`/`test-protocol` 注销。
- **缺陷分类**：条目级「类型」字段，值域 `rd`/`fe`/`arch`/`docs`——**用既有 role_id，不用 backend/frontend**（项目做过 `be→rd` 术语统一，证据见方案文档 3.1）。
- **只有缺陷加头**：「只有缺陷加头，其他不要被 plan 识别」→ 只给 `qa/defect.md` 补四字段头；cases/test 不加头、不进视图。
- **tab 细到 map**：缺陷 tab 按图过滤（与挂账台账的跨图聚合**有意不同**）。
- **`plan-lint` 先不管 qa**：跳过集合保持不变。

## 三、本轮关键实测（非推断，可直接采信）

1. **三个 skill 内容确实重叠**：七源盘点/断言三维/双通道在三个 skill 里各出现 2 次以上，同一方法论写三遍。
2. **一条真断链**：`to-qa-testcases` 全文 **0 处**提到 `test-protocol`（grep 零命中），但它第 3 步就要建隔离库造数——正是 test-protocol 管的「造数禁令」。手册摆在门口，干活的人从没被要求看。
3. **一处职责错位**：`test-design-gate` 加载时机是「写用例前」，但它 6 条准出里有 3 条属执行阶段（截图记录、用户环境巡检、缺陷回写）。
4. **插件里已有「实施图」概念**（`MAP_KIND_META`：推演图/实施图，按票型推导），用户要求不是新造概念。
5. **`plan-lint` 早已预留 qa 位置**：跳过集合 `['.archive','node_modules','assets','qa']`——「qa 作为 effort 子目录」是既有设计意图，只是从没 skill 落地。
6. **三件套全量仿真**（复刻插件 `collectTicketFiles` + `ticketKind`）：`defect.md`/`cases.md`/`test.md` **全部会被当成工单**。加 defect 分支只修好 defect。
7. **「归入说明类」不够**：工单表默认 `kindSet` 含 `note`（源码 L865），说明类默认勾选 → 仍会显示。必须**在收集阶段丢弃**。
8. **QA 协议零规定文档头**：`to-qa-testcases` 骨架 grep `frontmatter`/`状态头`/`type:`/`status:` **零命中**——这是真空白（对照：`plan-protocol` 明文规定四字段头）。
9. **现有台账三种写法全不合规**：novel 写在 ```yaml 围栏里、n3-w5 用引用块、dsh-flow 完全没头 → 插件全读不到。
10. **安装拓扑**：三个 skill 在 `~/.dsh/.agent-presets/full/skills/` 下是**真实目录**（非软链），且**不在任何 git 仓库**（`git rev-parse` 全 no-git）；ZCode 侧是软链指过来。

## 四、已立工单（三张，正本在 `.plan/qa-skill-merge/`）

| 票 | 内容 | 依赖 | 关键验收点 |
|---|---|---|---|
| **01** | `to-qa-testcases` 收窄 | 无 | 吸收 gate 设计侧 + 案例库；迁出执行段；落点改 `.plan/<effort>/qa/cases.md`；骨架给缺陷台账补头；表头统一 |
| **02** | 新建 `run-qa-testcases` | 被 01 阻塞 | 吸收 to-qa 执行段 + gate 执行侧 + protocol 全部 5 文件；**补断链**（显式引用 protocol）；单图/full 两种调用；注销两个旧 skill 前**先备份** |
| **03** | plan 视图新增「🐞 缺陷」tab | 无（**可与 01/02 并行**） | `qa` 组**白名单**（只留 `type: qa-defect`）；按图过滤；解析清单总览表；说明页文案修正 |

票面已写进全部细节（改动点带源码行号、反向断言、施工卫生），**实现方不必重读方案文档全文**，但遇到「为什么这么定」时回去查方案文档对应节。

## 五、开工前必须注意的坑（血泪项）

1. **票 02 的备份是硬要求**：三个 skill **不在任何 git 仓库**，注销前必须按既有惯例备份到 `skills-removed-<日期>/`，否则删了找不回。
2. **票 03 的施工卫生**：`packages/dsh-plan-view/lib/client.js` 当前是 **git 未提交修改态**（`M`），且本地构建与已安装版本 **md5 一致**（都是 `510b5d17…`）。重建前先确认这批未提交改动是否一并提交，避免新旧构建产物混淆。
3. **插件改完必须冷启动**：kill 3080 后重跑 `dsh web` + 清浏览器缓存（旧 index.html 会持续加载旧 boot graph）。
4. **skill 改完需新开会话**：skill 在会话启动时扫描，当前会话不会看到新 skill。
5. **白名单机制是裁定推导出来的，不是原始要求**：因为 cases/test 不加头 → 没有 `type` → 无法按 type 黑名单排除，只能白名单。实现时不要「优化」回黑名单。
6. **本轮产物未 commit**：`.plan/qa-skill-merge/`（4 文件）与方案文档在 git 里是**未跟踪状态**（`??`）。按用户惯例，commit 需显式指令——**不要擅自提交**。

## 六、下一步聚焦（建议顺序）

1. **并行两路派活**（用户惯例：主会话只做设计/对齐，实现派独立 session）：
   - **A 路**：票 01 → 票 02（串行，02 被 01 阻塞）
   - **B 路**：票 03（独立，可与 A 路并行）
2. 每票完成后按 `implement` 契约**当场回写票面**（status + 勾验收框 + 落地记录），不留给 plan-sync 事后补。
3. 票 03 完成后走**页面预期验收**（P-1 呈现 + P-2 交互 + 反向断言「cases/test 不出现在任何视图」），符合用户「测例须含页面预期验收」的口径。
4. 全部完成后：跑代码评审 → 按用户指令决定是否 commit。

## 七、相关产物索引

- **方案正本**：`.plan/待拍板-测试技能族合并为两skill-20260920.md`（closed，十一项裁定 + 全部实测证据 + 改动点行号）
- **工单地图**：`.plan/qa-skill-merge/map.md` + `tickets/01~03`
- **待改 skill**：`~/.dsh/.agent-presets/full/skills/{to-qa-testcases,test-design-gate,test-protocol}/`（ZCode 侧软链：`~/.zcode/skills/<同名>`）
- **待改插件**：`/Users/huzilin/workdir/dsh-plugin/packages/dsh-plan-view/`（`src/client/PlanView.tsx` 为主）
- **参考实现**：同文件 `LedgerView`（挂账台账，2026-09-19 落地）——缺陷 tab 照它做
- **协议正本**：`packages/dsh-plan-view/skills/plan-protocol/SKILL.md` 第三节（文档形态约定，票 02 要扩它的 `type` 词表）
- **下游消费者**：`dsh-flow/qa/qa_doc_audit.py`、`qa_live_audit.py`（注释引用 to-qa 骨架 D-3/D-4）；`dsh-flow/docs/v1.0/qa/qa-defects.md`、`qa-execution-report.md`（4 处引用待 sweep）

## 八、suggested skills（下一 agent 按环境取用，仅列本任务相关）

- **implement** / **implement-spec**：按票实施与编排（本任务三张票，A 路串行 + B 路并行）。
- **test-design-gate**：**改它之前先读它**——票 01/02 要拆分它的内容，读原文才知道哪段归哪边（注销后此 skill 不存在，属一次性参考）。
- **test-protocol**：同上，票 02 要吸收它全部 5 个参考文件。
- **writing-for-agents**：改写 skill 文案时用（信息层级、触发词、单一真相源——本次合并的核心原则就是它）。
- **plan-protocol**：理解 plan 生态契约；票 02 要扩它的 `type` 词表。
- **plan-approve** / **to-tickets**：本轮已用（结案 + 立票）；后续若拍板项再出现时用。
- **browser-pilot**：票 03 的页面预期验收（tab 可见性、切图联动、反向断言）需要真实浏览器走查。
- **handoff**：本 skill，延续交接。
