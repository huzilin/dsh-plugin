---
type: task
blocked_by: []
status: done
---

# 03: plan 视图新增「🐞 缺陷」tab（插件侧）

**What to build:** `dsh-plan-view` 插件识别 `type: qa-defect` 的缺陷台账，新增「🐞 缺陷」tab（**按图过滤**，细到 map）；同时让 `qa/` 下的 cases/test 不被 plan 识别。

**Blocked by:** None — can start immediately（与票 01/02 并行，互不阻塞）

**Source spec:** `.plan/待拍板-测试技能族合并为两skill-20260920.md`（closed）第六节（6.2~6.7）。

## Acceptance

- [x] **`TicketKind` 加 `'defect'`**（`src/client/PlanView.tsx` L347）
- [x] **`ticketKind()` 识别 `qa-defect` → 返回 `'defect'`**，分支**必须先于默认 `return 'ticket'`**（照 `ledger` 的位置，L350 附近）
- [x] **`qa` 组白名单**（关键，裁定⑧的落地机制）：`collectTicketFiles` 里对 `group === 'qa'` 的目录**只保留 `type: qa-defect` 的文件，其余丢弃**。理由：cases.md/test.md **没有 frontmatter 就没有 type**，无法按 type 黑名单排除，只能用白名单；副产品是将来 qa 目录新增无头文件（README 等）也自动不可见
- [x] **`KIND_META` 加条目**（标签「缺陷」/ 图标 🐞 / 颜色）（L369）
- [x] **`TopView` 加 `'defects'`**（L1302）
- [x] **新增 `defects` 过滤**（照 `ledgers` 写法，L1353 附近）
- [x] **tabs 数组加缺陷页**（L1408）
- [x] **新增 `DefectView` 组件**（照 `LedgerView`，约 80~100 行，L1749 附近）
- [x] **解析「清单总览」表格**（裁定②方案 A）：插件**已有现成 markdown 表格解析器**（`md()` 的 table 分支 + `splitRow`/`isDivider`），复用它；**按表头文字取列**（不按列序号，防加减列错位）；**容错匹配**（含「严重度」或「严重程度」都认），老文档不至于立刻失效
- [x] **tab 作用域细到 map**（裁定④）：复用「🗺️ 路线」页已有的图选择器状态（`effortIdx` / `selectedDir`），切图时缺陷跟着切。与挂账台账的跨图聚合**有意不同**（挂账是 plan 级跨图债务，缺陷挂在具体图下）
- [x] **轮次筛选自动复用**（`.archive/rounds` 只读模式），历史轮次缺陷台账可回看
- [x] **说明页文案修正**（L1555）：现写「路线 / 工单 / 待拍板 / 台账 **四页**」，实际已有 6 个 tab，加缺陷后 7 个——改为不写死数字或列全
- [x] **构建 + 部署**：`pnpm build:client` → 拷到 `~/.dsh/profiles/web/node_modules/dsh-plan-view/lib/`；**冷启动**（kill 3080 后重跑 `dsh web`）+ 清浏览器缓存
- [x] **施工卫生**：`lib/client.js` 当前是 git 未提交修改态（`M`）——重建前先确认这批改动是否一并提交，避免新旧构建产物混淆
- [x] **验收（页面预期，P 组口径）**：
  - P-1 呈现：tab 可见、计数正确、卡片显示缺陷号/标题/严重度/类型/状态/发现源
  - P-2 交互：切图时缺陷跟着切；点卡片开详情看全文；轮次切换可回看历史（本仓无归档数据，按机制复用确认，见落地记录）
  - **反向断言**：`cases.md` / `test.md` **不出现在任何视图**（工单页、路线页、总览页）；`qa-defect` **不出现在工单页**

## 落地记录

- **日期**：2026-09-20 · **状态**：代码完成，页面验收待主会话浏览器走查（P-1/P-2/反向断言不勾）
- **落点**（全部在 `packages/dsh-plan-view/src/client/PlanView.tsx`，行号为完工实测）：
  - L347 `TicketKind` 加 `'defect'`；L358-360 `ticketKind()` 加 `qa-defect` 分支（先于默认 `return 'ticket'`，照 ledger 位置）
  - L375 `KIND_META` 加 `defect`（🐞 缺陷，`#f2555a`，与 ticket/approval/ledger/note 四色不撞）
  - **L576-585 qa 组白名单**：落点在 `loadPlan` 数据组装层（fsRead 读到内容、`deriveTicketStatus` 之后、进 tickets 数组之前）——不在票面原写的 `collectTicketFiles`：该函数只做 fsTree 不读文件内容，`type` 在那里不可知；主会话派工 prompt 已确认此落点（「L570-571 白名单落在这里」）。实现为 `.filter((t,i) => picked[i]?.group !== 'qa' || ticketKind(t) === 'defect')`，含机制注释（加头=被看见，不加头=不被看见）
  - L1316 `TopView` 加 `'defects'`；L1368 `defects` 过滤；L1384-1386 `mapDefects`（复用 `effortIdx`/`selectedDir`，细到 map）；L1434 tabs 加「🐞 缺陷」（count 按 mapDefects）；L1529 渲染分支
  - L1861-1973 `DefectView` 组件 + `parseDefectEntries`（首个表头含「缺陷号」的表格，按表头文字取列：缺陷号/标题/严重度〔严重度|严重程度〕/类型〔类型|domain〕/状态/发现源）+ `DEFECT_CLOSED`/`defectStateWord`（状态首词匹配，「已关闭（复测 PASS）」认已关闭）
  - L1579 说明页文案「路线 / 工单 / 待拍板 / 台账 四页」→「总览 / 路线 / 工单 / 待拍板 / 台账 / 缺陷 各页」
- **构建与部署**：构建命令实测为包内 `tsdown`（`build:client` script 即 `tsdown`；裸 `pnpm build:client` 被 pnpm verify-deps 跨仓 install 检查挡住，与本票改动无关，直跑 `tsdown` 二进制绕过）。构建通过（lib/index.js 123.46 kB + lib/client.js 141.54 kB）。整目录 4 文件拷贝到 `~/.dsh/profiles/web/node_modules/dsh-plan-view/lib/`，md5 双侧一致（client.js `01e4e605…`、client.js.map `7a1f0067…`、index.js `1b09b53c…`、server.js `87e763d8…`）。**未 commit；未重启服务**（3080 冷启动由主会话统一做，上表「构建+部署」框按此口径勾选）
- **施工卫生**：`lib/client.js` 原 M 态未提交改动（旧 md5 `510b5d17…`）按指示一并带入新构建，未回滚
- **解析器自检**：按骨架表头（`to-qa-testcases/references/testsuite-skeleton.md` L120）+ 变体表头（严重度/类型）各跑一例，列提取、状态首词、无表/无缺陷号表返回空均通过
- **反向断言推理链（代码级）**：`qa/` 是 effort 下非隐藏子目录 → cases/test/defect 都被 `collectTicketFiles` 收进 `picked`（group='qa'）→ 白名单在 `loadPlan` 里把 group='qa' 且 `ticketKind!=='defect'` 的条目**在 tickets 数组生成前丢弃**（cases/test 无头 → `!ty && !t.status` → 'note'，'note'/'ticket' 都被丢）→ 全部视图（路线=`routeTickets`、工单=`mapOwnTickets⊆routeTickets`、待拍板/台账/缺陷各自 kind 过滤、总览=`OverviewView(all)` 但只统计 ticket/approval 两种 kind、tab 计数、搜索仅在工单页 `mapOwnTickets` 内做、无导出功能）**全部消费同一 `all`（=PlanData.tickets）数组**，丢弃发生在数组生成之前 → 无任何视图旁路。`qa-defect` kind 亦不进工单页（`routeTickets` 只留 kind='ticket'，ViewC Kind 筛选也不含 defect）
- **代码评审（独立子代理，只读）**：可合入，无 P0/P1；1 条 P2 已随票修复——`ticketKind()` 里 `isPending` 分支原先排在显式 type 分支之前，`status: pending` 的 qa-defect/ledger 文件会被误判为 approval 再被 qa 白名单**静默吞掉**；修复 = qa-defect/ledger 显式声明分支上移到 `isPending` 之前（显式 type 优先于状态推断，ledger 同机制一并闭合）。已重建部署（client.js md5 `7bd7ea35…` 双侧一致），并用 `status: pending` 临时台账实测：修复后正常显示于缺陷页（修复前该文件不可见），验证后临时文件已删。另 6 条 P3 备注未改（野生状态词失配属文档口径、`\|` 转义为既有 splitRow 局限、幻影行概率低、总览在跑列表不筛 kind、注释计数漂移、tsdown 非确定性构建致 md5 分叉但内容等价），详见评审记录。
- **仍开口**：本票与上轮未提交改动均在 git 未提交态，按惯例待显式 commit 指令
- **页面预期验收（主会话浏览器走查，2026-09-20）**：环境 = kill 旧 3080 进程后 `pnpm dsh web --no-open` 冷启动（部署版 lib md5 `01e4e605…`）。造临时验收数据（`qa-skill-merge/qa/` 三件套：defect.md 带 `type: qa-defect` 真头 + 3 条覆盖 已关闭（复测 PASS）/修复中/新建 三态与 rd/fe/docs 三类型；cases.md/test.md 无头；另造无 qa/ 的临时图 qa-acceptance-tmp 验切图），**验收后已整体删除**。
  - **P-1 呈现 ✓**：「🐞 缺陷」tab 出现在 tab 栏；计数口径 = 缺陷台账**文件数**（qa-skill-merge 图=1，页内标「3 条」）——与台账页口径一致，非条目数，不算缺陷；卡片七字段全渲染（缺陷号/标题/严重度/类型/状态/发现源），状态首词匹配实测正确（「已关闭（复测 PASS）」呈绿色已关闭 chip；发现源「用户」正常呈现）
  - **P-2 交互 ✓**：切图联动双向实测——qa-skill-merge→缺陷 1（3 条），切 qa-acceptance-tmp→缺陷 0 + 空态文案「当前图没有缺陷台账。`.plan/<effort>/qa/` 下带 `type: qa-defect` 头的缺陷台账会按图列在这里」，页面重载后默认图恢复缺陷 1；点卡片开共享 modal，frontmatter 四字段全部识别（qa-defect / status: active / origin: proactive），「清单总览」9 列表全文渲染。**轮次回看降级为机制复用确认**：dsh-plugin `.plan` 无 `.archive/rounds` 历史数据无法真实走查，缺陷数据走与主目录同一 `loadPlan` + `readOnly` 透传（代码推理链），待首个真实归档轮次产生时顺带验证
  - **反向断言 ✓**：工单 tab 计数 5 = 5 张票（qa 三件套若泄漏应为 8，计数守恒排除泄漏）；「全部地图」Kanban 目视 5 卡全为工单票；工单页 Kind 筛选仅「🎫 工单 / ⏳ 待拍板 / 📄 说明」、Type 仅「• handoff / ⚡ task」——均无缺陷项；代码级推理链见上（丢弃先于 tickets 数组，全视图同源无旁路）
  - 走查备注：tab 按钮的可访问名点击在本环境下间歇超时，用坐标/重载绕过完成走查，属测试工具问题非插件缺陷
