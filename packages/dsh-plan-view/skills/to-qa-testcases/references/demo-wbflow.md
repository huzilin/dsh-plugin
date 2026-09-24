# to-qa-testcases · 成品示例：wbflow v1.0 全量验收（dsh-flow 仓库）

> 一个**真实跑过**的完整测例项目，作为本 skill 产物《用例设计》cases.md 与可执行资产的形态参照。路径均相对 `dsh-flow` 仓库根。
> 它诞生于本 skill 之前，因此与骨架有若干差距（末节如实列出）——差距本身就是教训来源，不要照抄其缺口。
> 范围注记（2026-09-20 合并后）：《执行验收记录》《缺陷台账》两份骨架现归 `run-qa-testcases`；下表中 qa-execution-report / qa-defects 两行的形态参照随之移到该 skill 使用。

## 文件索引

| 产物 | 文件 | 对应骨架 |
|---|---|---|
| 用例设计 | `docs/v1.0/qa/qa-test-cases.md` | cases.md（A 接口 30 / B 流程 5 剧本 / C 分支 12 / D 对账 2） |
| 执行验收记录 | `docs/v1.0/qa/qa-execution-report.md` | test.md（结论先行、覆盖结果、过程有效性、回归指引） |
| 缺陷台账 | `docs/v1.0/qa/qa-defects.md` | defect.md（A~D 四节 + 发现源统计） |
| 诊断报告 | `docs/v1.0/qa/qa-diagnosis.md` | （defect.md 根因节的展开，本 skill 并入 B 节「根因定位」） |
| 资产说明 | `qa/README.md` | 资产清单 + 复跑三步 + 扩展约定 |
| 环境 | `qa/qa_env_up.sh` / `qa/qa_env_down.sh` | scratch 库 `wbflow_qa_<ts>` + 服务 :18081；凭据 `QA_MYSQL_PASSWORD` 注入，写 `/tmp/wbflow-qa-env.env` |
| 驱动 | `qa/qa_drive.py` | 全量验收驱动，末轮基线 195 PASS / 0 FAIL / 1 SKIP（约 40s） |
| 诊断最小环 | `qa/qa_diag_min.py` | 逐缺陷独立节（bug003 / bug004 / bug005 / bug008 / obs001），约 8s，软失败继续 |
| 结果 | `qa/qa-results.json` | 末轮逐用例结果（每次运行覆盖） |
| fixture | `docs/v1.0/qa/fixtures/` | 驱动自动生成（产物回读要求在 docs root 下） |

## 可复用模式（写新项目资产时直接照搬）

**驱动脚本 `qa_drive.py` 的四个构件**：
- `ck(cid, cond, detail)`：软失败断言——失败只记 `RESULTS`，不抛异常，一轮收齐全部缺陷；`skip(cid, reason)` 显式跳过必附因；
- `Req` 对象：把 create / assign / task_update / review / decide / advance 全步骤封装成方法，剧本函数只写业务序列，不重复 HTTP 细节；
- `WALKED` 列表：每条走完的需求 append 进去，末尾 D-1 产物矩阵对账自动遍历——**新增剧本零成本进对账**；
- `main()`：结果 `json.dump` + `sys.exit(1 if fail else 0)`，直接接 CI。

**库态对账**：`sql()` 只读直查 scratch 库；`audit_count(table, row, action, field, by)` 按审计行计数对账「谁在何时改了什么」——竞速类缺陷（BUG-009 幽灵评审位）就是靠 audit_log id 先后序实证的。

**环境成对**：`qa_env_up.sh` 建 scratch 库 + 迁移 + seed + 起服务；`qa_env_down.sh` 按端口杀进程 + DROP scratch 库，绝不触联调库 `wbflow`。（独库型隔离 = 并发维度取「环境」的实现方式之一，非默认要求；默认按业务域维度隔离，见骨架 §二「并发与环境红线」）

**多轮以末轮为准**：5 轮执行，前 4 轮修正的全是驱动侧问题（docs root 解析、anchor 契约嵌套、operator 归属、update 全量字段），执行报告 §2 逐条列出，与产品缺陷分开——这就是骨架 test.md §2「过程有效性」的来源。

## 这个示例证明了什么

- 协议通道做到位能抓什么：S1 死锁（plan 流程尾段 create_reqs 不被 exec 判据承认，唯一稳定复现路径就是黑盒全量）、S2 竞速（scanner 与 reproject 抢先，audit 实证）、5 条接口口径/判据类 S3；
- 协议通道做到位仍抓不到什么：用户同期发现 9 条（原型差距 4、纯视觉 1、业务语义断链 2、文档漂移 2）——逐条归因见 `references/case-library.md` CASE-001（案例库 2026-09-20 随合并迁入本 skill）。

## 与骨架的差距（如实，勿照抄）

| 差距 | 骨架要求 | 示例现状 | 补法 |
|---|---|---|---|
| 设计依据清单 | cases.md §1 七源盘点 | 只列 spec / 契约 / 架构 / seed，无原型、无用户批注 | 新项目从 §1 开始 |
| 呈现通道 | test.md §3 截图记录 | 无；被测对象限定「rd 服务」 | 有 FE 必走浏览器旅程 |
| 页面预期组 | cases.md P 组单列（P-1 UI 呈现 + P-2 使用交互），每元素位 ≥1+1 | 无 P 组（彼时骨架尚无此组）；纯视觉/布局/默认态问题全部漏到用户侧 | 有 UI 的项目按骨架 §2/§3 设 P 组 |
| 断言三维 | B 组每步业务语义层 | 只有协议层维度（相位 / current_node / last_decision / gate / round / 通知） | 每步加「角色所需 + 写读联动」 |
| 最小复现入口 | defect.md E 节：一条命令按用例过滤 | `qa_diag_min.py` 有逐缺陷函数但**无 CLI 过滤参数**，只能整跑；台账无 E 节 | 加 `--case` 过滤；每条缺陷登记 cmd |
| 用户批注回归组 | cases.md U 组 | 无 | 用户原话逐条转 U-xx |
| 文档一致性对账 | D 组含文档 vs 裁决正本 | D 组只对账 DB | 加 D-3 |
| 并发与环境红线 | 资源自命名零共享 + 临时工作目录禁 /tmp + 构建清理成文（骨架 §二「并发与环境红线」，2026-09-23 拍板） | 凭据文件写 `/tmp`；端口/目录无测例集标识；并发口径未声明 | 资源清单入 README；临时目录改仓库内 `qa/<集名>/.work/` |
