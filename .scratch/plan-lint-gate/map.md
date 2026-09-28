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
- 2026-09-27 用户拍板（novel 体检 D3 引出，原话「这个参考 /plan-protocol 是不是有哪里没对齐，如果是协议和 wayfinder 本身没对齐，那需要让协议对齐，然后再适配」）：立 [票 06 协议与 wayfinder 状态契约对齐](tickets/06-协议与wayfinder状态契约对齐.md)——体检实测三处未对齐：①`status` 字段存 vs 不存（协议「frontmatter 是权威」vs wayfinder 标 `deprecated` 且 lint 报错）；②状态词表（wayfinder 合法集无 `done`）；③后果实证=`.plan/micro-fixes` 四票全 `status: done`，`wayfinder-maps status` 读成「0 resolved · 4 open」。票内三选项，推荐改工具识别实施图票（A）。novel 侧适配票=`.plan/merge-prep-adapt/tickets/01`（序列上后置于本票结论）。**A/B/C 主体截至 2026-09-27 仍未裁定，票 06 保持 open。**
- 2026-09-27 用户拍板（`/plan-approve` 调用，原话「既然 impl 不合法，那我期望做的就是收口 1. 清理掉 plan 内任何 impl type 的说明 2. 统一 impl 和 task 的类型，以及 plan-view 插件的展示层。」）：`impl` 票型别名收口——协议三处（图二型/status 词表/type 取值约定）＋README 模板＋`run-qa-testcases` 筛图条件＋`plan-lint.sh` 注释已清；插件采「声明废弃＋存量读取容错」双轨（`LEGACY_TICKET_TYPES`），因 nvwa 15 张存量票未回扫、直接移除会致其静默掉出工单视图。**「impl 不合法」前提经实测更正为「协议追认的合法历史别名＋协议内部自相矛盾」**（「图二型」承认它、「type 取值约定」清单不收它）。跨仓回扫按用户「先只动 dsh-plugin 本仓」范围限定后置 → 立 [票 07 nvwa 存量 impl 票回扫](tickets/07-nvwa存量impl票回扫.md)。裁定正本 = `.plan/待拍板-协议与wayfinder状态契约对齐-20260927.md` 裁定 1（该文档保持 pending，因裁定 2 未落）。
- 2026-09-28 triage+grill 拍板：取代登记机械判据=「effort 票全 done ⇒ spec 必带 superseded-by 或已归档」（Q1=A），含存量补标（Q2=A）——立 [票 07](tickets/07-取代登记完备性校验.md)。plan-loop-rewrite 票 01 延后至全量 skills 盘点（老 matt 工具+plan 族）之后。
- 2026-09-28 拍板确认（「好继续」）：梳理文档 29 条处置 + 断链 L1-L5 全数确认——立 [票 08](tickets/08-收编tdd-code-review-codebase-design.md)（收编 tdd/code-review/codebase-design，解 L5）；L1/L3 契约补条款并入 plan-loop-rewrite 票 01；施工顺序=票 07 → 08 → 01。
- 2026-09-28 目录迁移令（用户裁定）：tracker 类对象迁回原版 .scratch/ 布局（审批档留 .plan/）——立 [票 09](tickets/09-目录迁移-tracker类对象迁回原版scratch布局.md)（大票，先 grill 三项 ☐ 议题）；处置表 #6/#8/#9/#22-26 涉 .plan 落位项改判「待迁移」。wayfinder 状态表示与获取机制说明已当轮回复（派生态 + frontier grep + plan view 同规则）。
- 2026-09-28 plan-approve 三轮拍板（审批档吸纳归档统一标记 Q1/Q2/Q4）：翻标机制 = **影响域清单 → 各域依次（可并发）处理回填 → 全部落地后翻 `archived: <主归宿>`**（取代「各吸纳者当场翻」；不嵌入状态机）；知识层（ADR/CONTEXT.md）免标、domain 内部自理与 plan-archive 无关；Q3 主体澄清后悬置待拍——立 [票 10](tickets/10-审批档吸纳归档机制-影响域清单与完成翻标.md)。同日第四轮拍板：**plan-approve 摘除主动落票**（只结算＋清单登记；落票后置清单驱动——plan-protocol 硬规则 1/4、plan-approve、to-approval 三正本已随拍板改写；取代 2026-09-24「保留落票环节」建议）。
- 2026-09-29 Q3 拍板（用户原话「随轮搬」）：已标 `archived:` 审批档随轮搬进 `.archive/rounds/`、未标者留 `.plan/`——票 09 G1 收敛（五议题→四议题）；裁定正本档 [待拍板-审批档吸纳归档统一标记](../../.plan/待拍板-审批档吸纳归档统一标记-20260928.md) 四项全清翻 closed（其自身翻标待票 10 落地后最后一手执行）。
- 2026-09-29 票 10 v2 简化（用户拍板「approval 文件的清单回填，不做，之前说过交给 grill 来做。grill 完全对话完成再 to-spec」）：状态化清单撤销；翻标改**双挂点**——结算即翻（纯知识档）/ to-spec 完成翻（`archived: <spec 落点>`）；to-spec 输入面条款同日撤销（恢复原版文档行为，不扫 `.plan/`）；lint 收敛为单 warn（closed 无标超 7 天）；plan-approve/to-approval 正本 v2 文本已随批落进。
- 2026-09-29 lint warn 撤销（用户拍板「这个就不通知了」）：审批档零检查——implemented 必已翻标无需通知、补充流程档无翻标挂点会永久误报、漏 to-spec 提醒归 plan-loop Brief；7 天参数作废。
- 2026-09-29 票 09 议题③④裁定：**存量迁移撤出施工范围**（实现全毕后用户单独推进）；**G2 撤销**（归档 = effort 全消后的轮归档，全局 qa/ledger 常驻 `.plan/qa|ledger/`）。议题①（to-tickets 自动建 map）②（assets/ 强化条款）解释已发，待用户定方向。
- 2026-09-29 票 09 议题①②裁定（**四议题全清，转纯施工**）：to-tickets **删自动建 map 补丁**（无 map 目录不加载，lint[2] 守门）；assets/ 保留随迁、强化条款（72h/串行/派生）维持；to-spec **窄解释维持**（宽解释不采纳）。
- 2026-09-29 实施收口（implement-spec 跑票，**降级模式：当前分支直推、逐票 commit**——交付物为 skill 文本+插件代码混合且含跨仓票，按 implement-spec「不合形」条款+用户 2026-09-27 选项甲偏好）：**全 effort 11 票全 done**——票 07b（lint[5] 取代登记+doc-authority spec 补标，d278f36）→ 票 08（收编 tdd/code-review/codebase-design，f8e2e9e）→ 票 07a（nvwa 15 票 impl→task 回扫 nvwa afd8e2a3 + 本仓 cb89dc4，impl 全 workdir 清零）→ 票 09（目录迁移施工：plan-protocol 归档节/文件类型条款/to-spec/to-tickets 删自动建 map/wayfinder/plan-archive 九步重写/plan-loop/plan-sync/qa 族/PlanView 双面加载 loadPlanMerged+issues 目录/plan-lint 多目录重构）→ 票 10（翻标双挂点+G4 前置判据+归档节条款草案随 09 落位）→ 票 06（过程留痕收尾翻 done）。**存量 `.plan/` 物理迁移按议题③裁定归用户单独推进**（插件双面加载过渡期已兜住显示）。
- 2026-09-29 存量迁移执行（用户令「存量切换到新的目录」）：五 effort（doc-authority/plan-lint-gate/plan-loop-rewrite/qa-skill-merge/skills-source-sync）`git mv` 进 `.scratch/`，结构原样；`.scratch/plan-lint-gate/待拍板-plan-lint随skill内置分发-20260923.md` 提到 `.plan/` 根层（审批档归位，closed 未翻标 → 留 `.plan/`）；引用 sweep 双向改指（docs 决策来源表/需求文档、根层审批档落地票指针、树内 Source spec/自指、跨层相对链接，共 15 文件）；handoffs 交接原文与 zg 档 lint 留痕两处历史引文按纪律保留。`.plan/` 余：审批档根层散件 + `handoffs/`（历史快照）+ `ledger/`（全局）+ `skill-doctor-reports/` 等无 map 杂项（不加载、不迁）。迁移后双面 lint 65 md 全绿。
