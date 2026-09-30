---
type: approval
date: 2026-09-18
status: abandoned
origin: readability-rescue
---

# 待拍板：dsh-plan-view 接入 zcode 的口径与路线

## 一、原话照抄与语境

**用户原话（2026-09-18，逐字）**：「dsh-plan-view 可以接入 zcode」

**语境**：一句话提议，未指明「接入」指哪一层——是把这个计划视图（看 `.plan/` 的网页界面）搬到 ZCode 生态里能用，还是把插件附带的技能同步进 ZCode，还是让视图和 ZCode 会话互通。原话过简，无法据此动工，故展开成候选路线供拍板（origin = readability-rescue）。

**约束力分级**：「可以」是提议/方向性表达，非强制动作指令；无普适约束词。本轮动作 = 先验后行（评估可行性），不直接实现。

## 二、现状（本轮读码已核实，标注除外）

1. **dsh-plan-view 是纯客户端 DSH 插件**：`lib/server.js` 只有 14 行空壳（宿主半区无逻辑）；全部逻辑在浏览器端 `lib/client.js`（由 `src/client/PlanView.tsx` 构建）。它自己没有后端，界面以标签页形式注入 DSH 网页界面（cordis better-sidebar）。
2. **视图依赖宿主两条接口通道**（`src/client/api.ts`）：
   - `/sidebar/api/*`：`fs.tree` / `fs.read` / `fs.write` —— 读写工作区 `.plan/`（浏览与回写编辑）；
   - `/api/*`：`session/list`、`session/create`、`session/prompt`、`commands/execute` —— 找会话、给会话发消息、在会话里跑斜杠命令（plan-sync 补回写环依赖这一条）。
3. **ZCode 的扩展面**（官方配置指南写明）：skills（技能）、slash command（斜杠命令）、hooks（钩子）、MCP server（给 agent 挂工具的协议服务）、plugins（打包前四者）。**没有「往宿主界面注入网页标签页」的机制**【扩展面清单为文档佐证；「无注入面」是由清单得出的我的推断，未穷尽实测】。
4. **ZCode 侧已装同源技能副本**：`~/.zcode/skills/` 下 mp-to-approval、mp-plan-approve、mp-grilling、mp-wayfinder 等，与本仓库 `install-skills.sh` 的映射表一一对应——同一套技能两边各维护一份，存在漂移风险【已核实两边都存在；是否已实际漂移未逐一比对】。
5. **ZCode 是否有从外部驱动其会话的通道**（对等 `session/prompt` 的 HTTP/本地接口）【文档空白，待查证；查证结果决定路线乙/丁的成色上限】。

## 三、候选路线（每条：是什么 / 从哪来 / 影响什么 / 代价）

### 路线甲：静态导出视图
- **是什么**：新增一条导出命令，把 `.plan/` 渲染成自包含 HTML（数据内联进单个文件），浏览器打开即看。ZCode 侧接入形态 = 一个技能或斜杠命令。
- **从哪来**：ZCode 无注入面（现状 3），网页标签页塞不进宿主界面；导出是绕开宿主的最低耦合形态。
- **影响什么**：保留「人看」的全部价值（路线/工单/待拍板三页 + 依赖图）；丢「会话联动」（现状 2 第二条通道：从视图给会话发消息、跑 `/plan-approve`）。
- **代价**：中等工作量（数据层从 RPC 抽换为内联数据，加一个导出入口）；联动缺失（见拍板项 2）。

### 路线乙：独立本地服务
- **是什么**：起一个本地小服务，按同形接口实现 `/sidebar/api/*`，直接复用现有 client.js——DSH 和 ZCode 两个宿主共用同一个视图服务。
- **从哪来**：视图本就是「薄客户端 + 宿主接口」结构，接口面小（fs 三件套为主），同形复制的成本可控。
- **影响什么**：fs 三件套容易实现；`session/prompt`、`commands/execute` 在 ZCode 侧无对等物，联动要么裁掉、要么等现状 5 查证结果再补。
- **代价**：中偏大工作量；多一个常驻进程要维护；联动成色当前不确定。

### 路线丙：技能单源双宿主
- **是什么**：本仓库成为 plan 生态技能的唯一源，`install-skills.sh` 增加安装目标 `~/.zcode/skills/`（映射沿用现表），一条命令同步两个宿主。
- **从哪来**：现状 4 的双份维护漂移风险。
- **影响什么**：止血技能漂移；不产出「视图」，只解决「技能」这一半。
- **代价**：小；需先逐一比对现副本与仓库版的差异，拍板以谁为准。

### 路线丁：MCP server 暴露 plan 数据
- **是什么**：把 `.plan/` 的读写包成 MCP tools 挂给 ZCode 的 agent，让会话里的 agent 能查/改计划。
- **从哪来**：ZCode 原生扩展面中唯一能双向挂数据的形态。
- **影响什么**：受益者是 agent（不是人眼看的界面）；与视图互补不互替。
- **代价**：中等；价值场景需另行论证。

**推荐：丙 + 甲。** 理由：丙顺手止血漂移；甲不依赖现状 5 的查证就能交付「在 ZCode 工作区也能看计划」的价值；乙的核心增量（会话联动）恰是 ZCode 侧暂无对等物的部分，等查证有果再升级不迟。丁可作后续独立议题。

## 四、拍板项

### 拍板项 1：接入口径
选哪条路线（可组合）：甲 / 乙 / 丙 / 丁 / 组合。**推荐：丙 + 甲。**

### 拍板项 2：会话联动缺失是否接受
若选甲（或乙的裁剪版），视图在 ZCode 形态下没有「点按钮给会话发消息 / 跑 `/plan-approve`」的能力（plan-sync 回写环在 ZCode 侧的这一环暂缺）。是接受缺失（后续按现状 5 查证结果再补），还是一票否决（必须先查证外驱通道再动工）？

## 五、性质标注汇总

| 标注 | 内容 |
|---|---|
| 已核实（本轮读码） | 现状 1、2；现状 4 的存在性 |
| 文档有空白 | 现状 5（ZCode 外驱会话通道有无） |
| 我的推断 | 现状 3 的「无注入面」结论（由官方扩展面清单推出） |

---

> 拍板结论若为「要做」，按 plan-protocol 硬规则当场调 to-tickets 落票，本文件随后推进状态。

---

## 六、2026-09-18 拍板回写与查证结论（同日补）

**用户裁定（逐字）**：

> 「只要看视图能否嵌入或者 session 能否通过接口创建」（拍板项 1 改为查证任务）
> 「一票否决」（拍板项 2：联动能力缺失即不做）

### 查证结论一：视图能否嵌入 ZCode 界面 —— **不能**

**证据**（官方配置指南 `zcode-configuration-guide`，ZCode 官方插件文档）：ZCode 插件 manifest 可执行字段仅 `commands` / `skills` / `hooks` / `mcpServers` / `agents`；`channels` / `lspServers` / `outputStyles` / `settings` 明确「记录但不执行」。**不存在任何视图 / webview / 面板类字段**——插件体系没有往宿主界面注入 UI 的机制。【文档佐证充分；应用源码（app.asar）未穷举，结论由官方文档推出】

### 查证结论二：session 能否通过接口创建 —— **能（CLI/stdio 通道，非 HTTP）**

**证据**（本机实测，2026-09-18）：应用自带 CLI `zcode`（`/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`，v0.16.5，进程表中 `zcode-cli` / `zcode-host-local-1` 常驻）暴露完整无头（headless）接口：

- `--prompt <text>` / `-p --print`：不开界面直接跑一条 prompt（即可编程建会话）；
- `--resume <sessionId>` / `-c --continue`：按 sessionId 接续既有会话（对等 DSH 的 `session/prompt`）；
- `--surface desktop`：**无头 prompt / app-server 的会话可投影到桌面端界面**（用户在 ZCode 桌面端能看到这条会话）；
- `app-server`：ZCode Protocol stdio 常驻服务（双向协议，最接近 DSH 侧 `session/*` 的对等物）；
- 配套：`--json`（机器可读）、`--attach`（带文件）、`--mode`（权限模式）、`--max-turns`、`--allowed-tools`。

**反面证据**：桌面端四个宿主进程（ZCode 主进程 / 两个 zcode-cli / zcode-host-local-1）lsof 实测 **0 个 TCP 监听**——没有 HTTP 接口；通道形态是 stdio / CLI 子进程 / unix socket。

**未实测项**：`--prompt --surface desktop` 真跑一条、确认会话出现在桌面端——列为立项后第一个验收动作（会消耗 quota，故未在查证阶段执行）。

### 结论对路线的影响

- 嵌入不可行 → 「视图长在 ZCode 里」的形态不存在；视图只能是**独立窗口 / 浏览器标签页**（乙）或静态文件（甲）。
- 联动一票否决 + session 可接口创建 → **甲（静态导出）单独不满足否决线，出局**；可行形态收敛为 **乙升级版：独立本地视图服务 + 会话联动走 `zcode` headless / app-server 通道**（视图里点「发给会话」= 本地服务 spawn `zcode --resume <sid> --prompt` 或经 app-server 投递）。
- 丙（技能单源双宿主）与乙不冲突，可作为搭头同批做。

**当前推荐（更新）**：乙升级版（+可选丙）。**是否立项，待拍板**——裁定后按 plan-protocol 当场落票。

---

## 执行记录（2026-09-18 暂时废弃，plan-approve 结算）

**用户裁定原话（照抄）**：「两外两个暂时废弃」（与《待拍板-清理novel误写文档-20260918.md》一并处置）

- **status: pending → abandoned**：一句话提议（「dsh-plan-view 可以接入 zcode」）展开的候选路线，用户决定暂时搁置，不选任何路线。无取代者，故落 abandoned 而非 superseded。
- **复活方式**：想法重启时把 status 改回 pending；本文的现状核实（§二：插件接口通道 / ZCode 扩展面清单）届时仍可复用，免重查。
