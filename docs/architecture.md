# dsh-plugin 架构正本

> **本文职能**：本仓**全局架构唯一最新事实**。写「系统是什么、各部分怎么相连」——**横向**内容归此；域内「怎么定义／怎么算」的**纵向**内容归领域文档。
>
> **不写什么**：不写实现细节的一次性决策过程（那是 spec 的活，spec 用完即废）、不写词条定义（那是 `CONTEXT.md` 词汇正本）、不写单次评审结论（那是 `docs/adr/`）。
>
> **维护纪律**：`to-spec` 写前读、写完更新（协议 §二硬规则 5）；`plan-approve` 拍板若改变架构事实，末步更新。

## 一、本仓是什么

`dsh-plugin` 是 **DSH（DeepSeek Harness）的插件仓**——它不实现业务功能，而是**承载 plan 生态的契约层与渲染层**。三类产物：

| 产物 | 位置 | 是什么 |
|:--|:--|:--|
| **协议文本** | `packages/dsh-plan-view/skills/` | plan 一套 skill 的**共享契约**与各自的方法 |
| **渲染插件** | `packages/dsh-plan-view/src/` | 计划视图（只读为主的渲染方） |
| **分发脚本** | `packages/dsh-plan-view/scripts/install-skills.sh` | 把 skills 装到 `~/.dsh/.agent-presets/full/skills/` |

另有两个独立包：`packages/dsh-report-hook/`（汇报规范提醒钩子）、`packages/dsh-restart/`（重启宿主半身）。

## 二、三层结构（本仓最核心的横向事实）

```
        契约层（唯一真相源）
   packages/dsh-plan-view/skills/plan-protocol/
                │
      ┌─────────┴──────────┐
      ↓                    ↓
   各 skill 的方法      插件读取层
 （wayfinder/to-tickets/  （PlanView.tsx
  implement*/to-spec…）    按协议解析 .plan/）
      │                    │
      └─────────┬──────────┘
                ↓
        安装态（分发产物，非真相源）
   ~/.dsh/.agent-presets/full/skills/mp-*
```

**三条硬规则**：

1. **`plan-protocol` 是唯一契约层**——单据形态（`type` / `status` / `blocked_by` / 状态头）只此一处定义，其余 skill **指向它、不复述**。复述即制造第二个家，两处一旦漂移就会互相说谎。
2. **skill 的源正本在本仓 `skills/`，安装态是分发产物**——**改安装态等于绕开单一真相源**。要改 skill 必须先在本仓建/改正本，再跑 `install-skills.sh` 分发，最后核对双拷贝一致。
3. **插件是只读为主的渲染方**——唯一写回是派工那一刻把 `session` 绑上票面；归档轮整轮只读。

## 三、skill 分发的两级制（2026-09-27 定）

`install-skills.sh` 把 `.optional/` 下的 skill 分两档——

| 档位 | 成员 | 行为 | 理由 |
|:--|:--|:--|:--|
| **受管** | `implement`、`implement-spec`、`to-spec` | **每次覆盖同步** | 本仓持有其正本，且含上游没有的项目规则（落地即翻票、读时检查、归宿行）；不覆盖就会与正本漂移 |
| **播种** | 其余 `.optional/*` | **只播一次、不覆盖** | 上游 skill，用户可就地定制；覆盖会毁掉本地改动 |

**id 约定**：主 `skills/` 下默认用原名；需 `mp-` 前缀的在脚本 `case` 里显式列出（**不得用 `sed` 猜**——`sed 's/-//g'` 会把 `implement-spec` 错拼成 `implementspec`，导致装不到）。

## 四、plan 生态的三条流程

```
主流程：  grill/wayfinder → to-approval → plan-approve → to-spec → to-tickets → implement* → plan-sync
补充流程：问题发现 → to-approval → plan-approve → to-tickets → implement* → plan-sync
QA 流程： to-qa-testcases → run-qa-testcases →（有缺陷）diagnosing-bugs → 复测回 run-qa-testcases
```

`plan-loop` 跨三条流程做轮次编排，`plan-archive` 在整轮走完后归档。**详细职责表见 `plan-protocol` §一／§二**——此处只记流程形状，不复述职责。

## 五、文档权威分层（2026-09-27 拍板）

```
长期权威层（docs，持续维护、永不退役）
  ① arch 总纲      全仓唯一，写「系统是什么」        ← 本文
  ② 领域文档      每域一份，写「本域内怎么定义/怎么算」
  ③ 需求文档      docs/requirements/<effort>-<主题>.md，写「用户要什么」
一次性层
  ④ spec.md       写「这一批怎么做」；effort 关闭后作废并归档
过程层
  ⑤ 拍板档/推演图/票/开放项记录 → .archive/，不承担权威
```

**判据**：**长期权威是「现在是什么」，spec 是「这一批怎么改」。** 横向（各部分怎么相连）→ 本文；垂直（域内怎么定义/怎么算）→ 领域文档；DDL → 领域文档。

**自指纪律**：长期文档**自身即权威**，**不得把 spec 声明为「真相源」**；对 spec 的指针称「**决策来源**」，spec 归档后指向归档路径。

## 六、本仓的文档地图

| 文档 | 职能 |
|:--|:--|
| **本文** `docs/architecture.md` | 架构唯一正本（横向事实） |
| `CONTEXT.md` | **词汇正本**（glossary）——只收词与一句定义 |
| `docs/adr/` | 架构决策记录（单次决策的取舍与理由） |
| `packages/dsh-plan-view/skills/plan-protocol/SKILL.md` | **契约正本**——单据形态、流程、交接契约 |
| `.plan/` | 规划共享记忆（effort／票／拍板档）；契约见 `plan-protocol` |

## 七、决策来源

本文的横向事实**不是一次成型的**，来源于 `.plan/` 下的历次决策。指针记「为什么这么定」：

| 决策 | 来源（决策来源，非真相源） |
|:--|:--|
| 三层结构与「契约层唯一」 | `.plan/doc-authority/spec.md` 决策 1／3／6 |
| skill 分发两级制 | `.plan/doc-authority/tickets/03-implement-to-spec落读时检查.md` |
| 文档权威五层 | `.plan/doc-authority/spec.md` 决策 1~5 |
| 票态词表与四套状态机 | `.plan/plan-lint-gate/tickets/06-协议与wayfinder状态契约对齐.md`、`.plan/doc-authority/tickets/04-status与协议全局对齐.md` |

> spec 归档后，上表指针须改指 `.archive/` 路径。
