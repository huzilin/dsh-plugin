---
type: task
blocked_by: []
status: done
---

# 04: Playwright 接入协议改票（形态正本 + 两 skill 同步改 + 装态回补）

**What to build:** 把已拍定的 Playwright 接入方案落成协议文本，端到效果 = 文字模型（无视觉）在任何项目跑 QA 时，有可依的呈现通道资产形态与降级规程：新建形态正本 `to-qa-testcases/references/playwright-assets.md`（D5 六项 + DOM 探针清单 + 无视觉三态口径 + VLM 位置表的唯一权威），to 侧加指针、run 侧同步改四处、验收记录骨架补视觉维附注口径，装态双侧回补。

**Blocked by:** None — can start immediately

**真相源:** `.plan/待拍板-to-qa-testcases接入playwright-20260921.md`（status: closed，2026-09-22 六项全裁：R=A / D5=六项推荐 / D6=A / D1=A / D2=A / D3=A）。术语口径见仓库根 `CONTEXT.md`。

## Acceptance

- [x] **形态正本 `references/playwright-assets.md`**（D1 裁决 A）：承载唯一权威版本——D5 六项（spec 落仓库 `qa/e2e/`；用例编号绑定 test 标题 + `--grep` 过滤，不引 testTag；薄壳 `qa/run-e2e.sh` 统一入口，软失败/json/退出码用 Playwright 原生；截图 `<用例编号>-<步骤>.png` 落 `qa/screenshots/`；storageState 复用 + 登录走真实接口链路，env_up 供环境 Playwright 只连不启；spec 语言随项目栈）＋ DOM 探针清单（boundingBox 判重叠/换行/撑破、getComputedStyle 对照设计 token、`document.fonts.check`、`naturalWidth===0` 裂图、axe-core 对比度）＋ 无视觉三态口径（视觉维 = 既有三态「未覆盖 + 附注（留证待审）」，不出「通过」；截图纪律不变）＋ VLM 位置表（断言设计时要 / 复测执行不要 / 复测后抽审可选）
- [x] **to-qa-testcases SKILL.md**：资产三原则节只加一句指针（一处定义、其余指针），正文无形态复述；参考材料节补形态正本条目
- [x] **testsuite-skeleton.md**：§二资产表「驱动脚本」行提及 Playwright 形态 + 指针；骨架结构与章节名不动
- [x] **run-qa-testcases SKILL.md 四处**（D2 裁决 A）：①Process 2 呈现通道执行 = Playwright 套件 + 截图留证 + 无视觉降级 / 有视觉抽查看图；②交接契约 E 节 fe 缺陷最小复现入口 = `npx playwright test -g <编号>`（协议通道缺陷仍走原驱动命令）；③复测识别**不新增机制**明写（自然语言触发语 + 条目状态「待复测」+ 多轮以末轮为准；复测 = 同一条命令）；④红线句补明「Playwright 真浏览器走查属呈现通道，不得以协议通道代出通过」
- [x] **qa-records-skeleton.md §3**：P 组记录口径补视觉维「未覆盖 + 附注（留证待审）」用法说明（另：E 节 cmd 示例补 fe 形态 `npx playwright test -g P-12`）
- [x] **术语 sweep**：五词（协议通道/呈现通道/固化回归/探索走查/DOM 探针）在本批协议文本中与 `CONTEXT.md` 口径逐字一致；avoid 词（回归腿/探索腿/页面腿/接口腿/前后端通道/人工走查）扫描零残留（既有拍板措辞「呈现腿/协议腿」不在 avoid 清单，未动）
- [x] **装态回补**：两 skill 改动同步 `~/.zcode/skills/` 与 `~/.dsh/.agent-presets/full/skills/`（手动同步——QA 两 skill 不在 install-skills.sh 具名清单），`diff -rq` 三侧逐字一致已留痕
- [ ] **commit 待显式指令**：本票改动 + 审批文档 + CONTEXT.md + .plan 档案同批，完工后等用户指令

## 落地记录

- **日期**：2026-09-22 · **状态**：协议文本完成，三侧（源仓 / ZCode 装态 / DSH 装态）`diff -rq` 逐字一致；**commit 待用户显式指令**
- **施工中发现并修复漂移**：源仓两 skill 落后于装态——2026-09-21 拍板（缺陷拆文件 DEF-NN、`qa_cases` 票面回写、条目状态「新建」改「待复测」系词表改动、full 分账口径）只改了装态未回补源仓。处置 = 先把装态权威版回补源仓（3 文件：to SKILL.md / run SKILL.md / qa-records-skeleton.md），再在最新基线上落本票改动；本次 git diff 同时含「回补层」与「本票层」，commit 时一并入库即为正确基线
- **附带修正**：run SKILL.md Process 步骤编号 6/6 重复（票面标记回写与落盘自检同为 6）→ 改为 6/7
- **落点**（全部在 `packages/dsh-plan-view/skills/`）：`to-qa-testcases/references/playwright-assets.md`（新增，形态正本）；`to-qa-testcases/SKILL.md`（参考材料 + 资产三原则节各一句指针）；`to-qa-testcases/references/testsuite-skeleton.md`（§二驱动脚本行）；`run-qa-testcases/SKILL.md`（呈现通道 bullet / 红线 bullet / 第 4 步 E 节 / 第 5 步复测句 + 编号修正）；`run-qa-testcases/references/qa-records-skeleton.md`（§3 视觉维口径 + E 节 cmd 示例）
- **验证方式**：`diff -rq` 三侧一致；`rg` avoid 词零残留；五词计数 24 处命中（正本 7 / run SKILL 7 / to SKILL 5 / skeleton 5）
- **仍开口**：①commit 待指令（含 .plan/CONTEXT.md 同批）；②装态生效需新开会话（skill 会话启动扫描）
