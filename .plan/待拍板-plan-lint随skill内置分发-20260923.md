---
type: approval
date: 2026-09-23
status: closed
origin: review
---

# 待拍板：plan-lint 随 skill 内置分发（修复 plan-approve / plan-sync 悬空引用）

## 背景与原话

**用户原话（本轮触发，逐字）**：「novel 报没安装，是不是应该把 plan lint 内置到这几个 skill 里？」

**上下文原话（另一 session 在 novel 侧跑 plan-approve 的输出，逐字）**：

> plan-approve 流程走起：先 lint，收 pending 集，再按你拍定的内容结算。
> plan-lint 脚本在本机不存在（skill 引用了但没装，记为漂移）。手工等价检查+收 pending 集。

**「这几个 skill」口径确认（助手界定，可纠正）**：实指引用 lint 的两个——`plan-approve` 与 `plan-sync`，两者 Process 第 1 步都是 "Run the drift lint first. `bash scripts/plan-lint.sh` (in this plugin's package)"（plan-approve/SKILL.md L15、plan-sync/SKILL.md L17）。

## 缺口成因链（三层，逐层证据）

### 第一层：skill 安装态缺脚本（novel 报的直接原因）

- 【文档已写明】skill 文本按**插件整包**形态写引用（"in this plugin's package"）——插件装上时 `scripts/` 随包在，引用成立。
- 【实测】实际分发走 DSH 安装态：`~/.zcode/skills/mp-plan-approve` → 软链 → `~/.dsh/.agent-presets/full/skills/mp-plan-approve/`，该目录**只有 SKILL.md 一个文件**（mp-plan-sync 同）。`scripts/` 没跟着走。
- 【实测】novel 仓库（`~/workdir/novel`）无 dsh-plugin checkout → 脚本在任何非本仓工作区都不可达，悬空是必然，不是偶发。

### 第二层：sh / mjs 双实现口径分叉（内置前必须收口）

- 【文档已写明】票 01（plan-lint-gate/tickets/01）交付物是 `scripts/plan-lint.mjs`（Node 版）；skill 引用的 `scripts/plan-lint.sh`（纯 bash 版）是后来另写的。两者规则正本同为 plan-protocol §三。
- 【实测·2026-09-23 对 novel/.plan 实跑 sh 版】报 29 项，绝大多数是**假阳性**：
  - qa 三件套 `cases.md`×9、`test.md`×9 被当双档——sh 没实现 mjs 的跳过集合（`['.archive','node_modules','assets','qa']`）；
  - 各 effort 自己的 `01-`/`02-` 票互相判为双档——sh 的同票双档按全局 basename 判，mjs 按 effort 内判定。
- 【文档已写明·一致性红线】「`plan-lint` 先不管 qa：跳过集合保持不变」是 2026-09-20 已拍板裁定（handoff 2026-09-20-qa-skill-merge 第二节，正本在方案文档第七节）→ **sh 现状违反既有拍板**，合流不是新决策，是执行旧裁定。
- 【实测·反证】同日对 dsh-plugin 本仓跑 sh 版绿（豁免目录 handoffs 已同步进 sh）——sh 只在本仓验证过，从未对 novel 这类重度 .plan 仓验证。

### 第三层：同步机制 install-skills.sh 本身漂移（修了前两层也会白发）

- 【文档已写明】技能处置协议：「安装态单一真相源为 DSH agent-presets；源仓改动后需跑 scripts/install-skills.sh 同步到安装态」「install-skills.sh 只装 7 个具名 skill，其余暂靠手动同步」。
- 【实测】脚本目的地写死 `~/.dsh/skills`——该目录现为**空目录**（2026-09-15），实际安装态在 `~/.dsh/.agent-presets/full/skills`。跑今天的脚本装不到活安装态。
- 【实测】具名清单 7 个里**没有 plan-sync**（当年手动同步进的），也没有 2026-09-20 后入库的 to-qa-testcases / run-qa-testcases。
- 【实测·对方案有利】脚本用 `cp -R` **整目录**拷贝 skill → 脚本放进 skill 源目录即可自动随包，无需新造分发机制（前提：目的地修正）。

## 拍板项

### 项 1（主拍板）：plan-lint 的分发形态

| 方案 | 做法 | 得 | 失 |
|---|---|---|---|
| **A. 内置随 skill 分发**（推荐） | 脚本放进 `skills/plan-approve/scripts/`（正本）与 `skills/plan-sync/scripts/`（安装期注入或同步副本）；两个 SKILL.md 第 1 步改「跑本 skill 目录下 scripts/plan-lint.sh」 | skill 自包含，装到哪个仓库都能跑（novel 直接获益）；相对路径无机器耦合；`cp -R` 机制天然带走，兑现 skill 文本原有设计意图 | skill 目录内多副本（与 SKILL.md 同地位——都是源仓的安装产物，真相仍在源仓，靠同步机制保一致） |
| B. 全局单副本 | 装到 `~/.dsh/.agent-presets/full/` 下固定位置（如 `bin/`），skill 文本引该路径，传 `<仓库>/.plan` 作参（sh 已支持参） | 全机一份、零副本 | 绝对路径进 skill 文本，skill 失去自包含；skill 再分发到别的布局即断；与「skill 文本不该知道机器布局」的通用做法相悖 |
| C. 现状合法化 | 把「手工等价检查」写进 skill 作降级路径 | 零工程量 | lint 永不真跑；plan-lint-gate 的 Destination（「说明页引用真实可用——不再靠人眼复盘」）落空；漂移只被发现不被修复 |

**推荐 A**。理由：①它就是 skill 文本原设计意图（"in this plugin's package"），只是分发侧断了一环；②sh 零依赖、自带 `.plan` 路径参数、bash 3.2 兼容，天生适合内置；③与既有拍板架构（安装态 = DSH agent-presets，源仓为真相）一致——skill 目录里的一切都是安装产物，副本不是第二真相源。

### 项 2：双实现合流方向（若项 1 选 A/B 需定；选 C 可缓）

- **a. sh 收口为唯一实现**（推荐）：把 mjs 的跳过集合（qa/assets/node_modules）与双档判定口径（effort 内判定）对齐进 sh；mjs 退役，GuideView 说明页文案改指 skill 内脚本。理由：消费方是 skill（任意仓库、裸 bash 最稳，原脚本即按「兼容 bash 3.2、只用 sort/awk/uniq」设计）；规则只有一份，改一处。
- **b. mjs 收口**：口径现成是准的；但 skill 运行从此依赖 node，「零依赖 bash」的设计意图作废；GuideView 文案不用改。
- **c. 维持双实现仅对齐口径**：每次规则改动双写（handoffs 豁免时已双写过一轮），成本持续，不推荐。

### 项 3：install-skills.sh 修复（项 1 无论选哪个都需修，共同前提）

- 目的地改 `.agent-presets/full/skills`（【文档空白】`.agent-presets` 是否由 DSH 自身另有回填机制，落票时先核实，避免双写打架）；
- 具名清单补 plan-sync；to-qa-testcases / run-qa-testcases 是否入清单一并核（对应「其余暂靠手动同步」的既记缺口）；
- 同步后加一道在位自检（如 `test -f <安装态>/mp-plan-approve/scripts/plan-lint.sh`）。

## 拍板后的落地切分（预告——拍板即由 to-tickets 立票）

1. **票一（前置）**：口径合流——sh 对齐 mjs 跳过集合与双档判定；对 novel 与 dsh-plugin 双仓实跑，sh 与 mjs 输出一致才收（novel 首跑的真发现——如 R12 三档、双状态机定稿双档——归 novel 侧 plan-approve 收口，不在本仓扩大）。
2. **票二**：分发——脚本进两个 skill 目录；两个 SKILL.md 第 1 步文本改写；（若项 2 选 a）GuideView 文案同步改。
3. **票三**：install-skills.sh 目的地与清单修正 + 实际执行同步 + 安装态验证（novel 会话实跑 lint 为验收）。

## 影响面与一致性

- 术语：`plan-lint` 名称不变，无术语变更 SOP 触发。
- 协议：plan-protocol §三「非治理目录」条款不变；qa「保持跳过」裁定由票一落实执行（属纠偏，非改口径）。
- plan-lint-gate 路线图：项 1 选 A 即兑现该 effort 的 Destination（说明页引用真实可用），gate 项目随之可收口。
- 记忆归属：本仓库不在 OpenViking 写入白名单（novel / dsh-flow / semantica），plan-lint entity 的「环境缺口」条目待拍板落地后由白名单会话或你显式要求时刷新。

## 结算记录（2026-09-23，plan-approve 结算会话）

**拍板原话（逐字）**：「1A 2A 3 修复」。

| 项 | 裁定 | 落点 |
|---|---|---|
| 项 1 分发形态 | **A**：内置随 skill 分发 | 票 [03-随skill分发内置](tickets/03-随skill分发内置.md) |
| 项 2 双实现合流 | **A**（即选项 a）：sh 收口为唯一实现，mjs 退役 | 票 [02-sh口径合流](tickets/02-sh口径合流.md)（合流与对拍）+ 票 03（mjs 退役与文案随改） |
| 项 3 install-skills.sh | **修复** | 票 [04-install脚本修复与同步](tickets/04-install脚本修复与同步.md) |

前置依赖：02 先收口径（不能把假阳性 lint 装进 novel）→ 03 分发内置 → 04 同步与 novel 实跑验收。文档状态 pending → closed；后续 entity「环境缺口」刷新记白名单会话账（见影响面节）。
