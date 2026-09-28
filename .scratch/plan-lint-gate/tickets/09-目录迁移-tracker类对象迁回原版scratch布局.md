---
type: task
blocked_by: []
status: done
---

# 09: 目录迁移——tracker 类对象从 .plan/ 迁回原版 .scratch/ 布局

## Question

用户裁定（2026-09-28）：「本仓实际用 `.plan/` 这个忽略，我们使用原版的目录，所以对应的目录都要调整。比如 plan-protocol。」

**迁移内容**（原版 local 布局，`issue-tracker-local.md`）：

- tracker 类对象（spec / map / issues 票）→ `.scratch/<feature-slug>/`（spec.md、map.md、issues/NN-<slug>.md）
- 审批文档 → 留 `.plan/`（原版 grilling 本就落 `.plan/`）
- 受影响 skills：plan-protocol（路径条款）、to-spec、to-tickets、wayfinder（TRACKER-MARKDOWN）、plan-approve/plan-lint（校验对象）、plan-archive（搬移源）、plan-loop/plan-sync（盘点对象）、plan view（PlanView.tsx 加载与 effort 识别）

**先 grill 三项 ☐ 议题再动手**：①to-tickets「自动建 map」补丁去留；②wayfinder assets/ 目录与强化条款（串行/72h/派生）保留范围；③存量数据物理迁移 or 双读过渡。

来源：《梳理-skills全量对照盘点-20260928.md》§二·补3（影响面清单）；原版参照 §11.9 合并目录树。
- 2026-09-28 补充细化裁定六条（调研复盘目录/词汇表状态标记/ADR 必填与原地标废/测例编号+按例重跑/test 多轮同文件/DEF-<effort>-NN 全局唯一 + .tmp 收纳 + 目录对齐总则）——见《梳理-文件类型与获取总表》§三·补，迁移方案 grill 以此为基准。
- 2026-09-28 triage 补充：plan-archive 机制明确化 + 新裁定下冲突 G1（审批档归档处置）/G2（全局 qa/ledger 归档时机）并入本票 grill 清单（现三议题 → 五议题）；G3 归档源路径随施工改写；G4 归档前置四判据 / G5 检索面条款入协议草案。详见《梳理-文件类型与获取总表》§归档机制明确化。
- 2026-09-28 晚改判批注：审批档生命周期口径已改判（Q1/Q2 拍板：closed →（影响域清单登记 → 各域依次处理回填 → 全部落地）→ 翻 `archived: <归宿>`；知识层 ADR/CONTEXT.md 免标、domain 内部自理与 plan-archive 无关）——**G1 议题按新机制复核**；G4 前置判据增「审批档清单全勾或已标」。裁定正本 = [`../../../.plan/待拍板-审批档吸纳归档统一标记-20260928.md`](../../../.plan/待拍板-审批档吸纳归档统一标记-20260928.md)。
- 2026-09-29 Q3 拍板（用户原话「随轮搬」）：**G1 已解**——已标 `archived:` 的审批档随轮搬进 `.archive/rounds/<round-id>/`、未标者留 `.plan/`，判别器 = 标记本身，三选 grill 撤销。grill 清单五议题 → **四议题**（G2 全局 qa/ledger 归档时机 + ①to-tickets 自动建 map 去留 + ②wayfinder assets 保留范围 + ③存量迁移方式）。G4 前置判据「清单全勾或已标」获拍板背书。
- 2026-09-29 议题③④裁定：③**存量迁移撤出本票施工范围**——全部实现完毕后由用户单独推进（用户原话「迁移，但这个你不要列在任务中，全部实现完毕后，我再单独推进」）；④**G2 撤销**——归档时机 = effort 全消（票尽 + qa_accepted + 缺陷全关 + 台账全消）后的轮归档，不设独立批量归档时机，全局 qa/ledger 常驻 `.plan/qa|ledger/`，属轮成员随轮走（用户原话「qa 中缺陷和 ledger 全消，effort 才能翻转，所以也就不能归档。而全部都解决了才能归档」）。议题①②解释已发（map.md = 文件、effort = 目录、判据 = 目录含 map.md；assets/ = 调研证据目录），待用户定方向。
- 2026-09-29 议题①②裁定（**grill 清单全清，本票转纯施工**）：①**to-tickets 删「自动建 map」补丁**（用户原话「to-tickets 不自动补 map」）——施工项并入本票 to-tickets 改写；后果已明示并接受：无 map.md 目录不被视图加载，由 plan-lint 检查[2]（目录有票缺 map）守门；②**assets/ 保留并随迁移走**（用户拍板「包括 assets」），强化条款（72h stale / 串行 / 派生状态）维持现状、随 G3 源路径改写。同日确认：to-spec 窄解释维持（宽解释不采纳，discharge/归宿行/正本联动三加装保留）。

## Acceptance

- [x] plan-protocol 全文改写：§三目录布局总则（官方有→`.scratch/<feature-slug>/`；effort 挂钩 qa/ledger/assets 随迁；全局审批档留 `.plan/`、调研复盘→`docs/research/`、一次性杂项→`.tmp/`）＋ effort 标志（判据不变、目录根改 `.scratch/`）＋审批档归属（一律落 `.plan/` 根层，slug 关联）＋缺陷/测例/台账图内路径改 `.scratch/`（全局件常驻 `.plan/`）＋调研复盘落点新条款
- [x] §四 归档节按新裁定重写：G1（已标 `archived:` 随轮搬/未标留）＋G2（effort 全消后轮归档，全局件常驻）＋G3（源=`.scratch/`）＋G4（前置四判据：票尽+qa_accepted、缺陷全关、台账全消、spec 已标/审批清）＋G5（归档完成=出检索面）＋R1（头部 `archived: <round-id>` 标识，git mv 同批）＋R2（轮外断链巡检只报不改）；新增 §四·补「文件类型与获取」收编条款（总表 A–D 精简落协议）
- [x] to-spec：落点 `.scratch/<feature-slug>/spec.md`；R2 联动（长期文档不留指向 tracker 区的活指针，决策来源记归宿行/审批档内）；**翻标挂点②条款落位**（discharge 后对消化的审批档翻 `archived: <spec 落点>`）
- [x] to-tickets：落点 `.scratch/<slug>/issues/NN-*.md`；**「自动建 map」补丁删除**（议题①拍板，改守门说明）；模板注释 resolved 残留顺手清除
- [x] wayfinder：SKILL.md + TRACKER-MARKDOWN.md 全部路径改 `.scratch/<effort>/`＋`issues/`；assets/ 保留随迁、72h/串行/派生强化条款维持（议题②）
- [x] plan-archive 全文重写：九步→九步（+R1 标识步、步⑤ sweep 降级 R2 巡检、+G5 检索面收口步）；轮完成判据改 G4 前置四判据；成员清单/README 模板随 G3 改写
- [x] plan-loop/plan-sync：盘点对象改双治理目录（`.scratch/` + `.plan/` 审批档）；plan-loop Brief 增「closed 无 `archived:` 标审批档」（漏 to-spec 提醒归位，票 10 挂账）；顺手清 resolved 残留两处
- [x] qa 族（to-qa-testcases/run-qa-testcases + 两骨架 references）：图内 qa 落点改 `.scratch/<effort>/qa/`；根层 `.plan/qa/` 全局件不变；DEF 编号全局唯一 `DEF-<effort-slug>-NN` 措辞落 run 侧
- [x] implement/implement-spec/diagnosing-bugs/to-approval/research/skills README：spec 检查/票回写/lint 调用示例/落点句全部随迁；to-approval 落点条款改 `.plan/` 根层（子目录形态随迁移失效）＋顺手修正其遗留「lint 7 天 warn」句（与票 10 第 4 项撤销拍板冲突）
- [x] PlanView.tsx：新增 `loadPlanMerged` 双面合并加载（`.scratch/` + `.plan/`；轮目录单面原样）；`collectTicketFiles` 认 `issues/`（与存量 `tickets/` 平级）；GuideView/LedgerView/DefectView 文案与布局图更新；tsdown 构建通过
- [x] plan-lint.sh 重构多目录双面扫描（参数可传多目录、省略自动发现 `.scratch`/`.plan`，两面对跑发现累计）；[4] 认 `issues/`+`tickets/`、合体票文件双名；[5] spec 票目录双认；合成探针（双面/issues 识别/补标翻绿/单参）全过
- [x] **存量数据零迁移**（议题③：实现全毕后用户单独推进）——插件双面加载使存量 `.plan/` 图过渡期继续可见，迁移完成前无视图空窗

## 落地注

- 2026-09-29 实施，与票 10 同批。六条批复（调研复盘 docs/research/、词汇表三态、ADR 免标、测例编号、test 多轮、DEF 全局唯一）已按《梳理-文件类型与获取总表》§三·补落协议对应条款；G3/G4/G5/R1/R2 落 plan-archive 与协议 §四。
- **过渡期披露**：插件已切 `.scratch/` 为主加载面，本仓存量图仍在 `.plan/` 旧布局——双面合并加载已兜住显示；**存量物理迁移（git mv）归用户单独推进**，迁移后旧布局目录自然消失。
- install-skills.sh 已同步全部安装态（源↔安装态 diff 仅注入 scripts 差异，本体一致）；plan-protocol description 加引号修复校验拦截（冒号+空格在裸标量中非法）。
