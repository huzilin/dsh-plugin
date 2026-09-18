---
type: handoff
date: 2026-09-18
status: closed
origin: retrospective
---

# Handoff：计划视图交互蓝图（grill-with-docs 全流程）

> 本轮把"计划视图四页（地图/工单/待拍板/总览）如何与 dsh session 联动"从设想推进到了**设计已决、待实现**的状态。本文只交代上下文、决策、未决与下一步聚焦；完整设计见 `.plan/待拍板-计划视图交互蓝图-20260918.md`，不要重复造。

## 一、背景与已完成的上下文

- 前序轮已修好 `.plan` ↔ `dsh-plan-view` 插件协议（路线/工单/待拍板三页可见且正确），并交付了 `plan-protocol`（公共协议 skill）、`plan-archive`（归档 skill）、说明页两流程重画、`to-spec`/`plan-approve` 接入架构正本。相关 commit：`dsh-plugin` `08d0372`、`novel` `1d97cfe`。
- 本轮目标：让 grill-with-docs 通过 plan 完成"推演 + 开发"全流程——即四页都能**看 + 跳 + 派活**。

## 二、本轮关键发现（实测，非推断）

1. **定向派能力确实存在，第一版误判已更正**。最初以为"让某 session 跑 skill"缺地基；经用户指正、查 `novel/.agents/skills/dsh-knowledge/`（ch02/ch03/patterns）与 harness 源码，确认 harness 经 Typert 暴露给浏览器客户端：`sessionController.prompt` / `commands.execute(agentId, line)` / `subagents.prompt`，均按 `agentId(=sessionId)` 调用。
2. **插件侧尚未接这些能力**：`dsh-plan-view` 当前 `inject: ['betterSidebar','slots']`，`api.ts` 只 `fetch('/sidebar/api/fs.tree'|'fs.read')`（只读）。
3. **写端点走 `/api` RPC**：实测 harness 测试代码 `rpc.call('/api','commands/execute',{args:{agentId,line}})`——与 `/sidebar/api` 同构，只是前缀不同。意味着插件可能只需在 `api.ts` 的 fetch 封装里换 method 名即可触达定向派，**前提是侧边栏插件被授权调用这些写端点**。

## 三、已决设计决策（B1/C1/D1/E1，详见蓝图文档第四节）

- **B1**：session 绑定存 frontmatter 字段——票 `session:`、拍板文档 `origin_session:`、后台任务写回 `sessionId`。不另建 bindings.json（避免双源漂移）。
- **C1**：非阻塞任务列表显示 `sessionId` + 状态（running/done/failed，来自 session/subagent 事件）+ 一键 `openSession`。
- **D1**：总览页 = 阶段指示（决策循环①中 / 落地链②中 / 卡待拍板 / 卡 blocked）+ 跨 effort 聚合 frontier / 最久 pending 拍板 / 最长等待 blocker + 点击跳转。
- **E1**：跳转前 `sessionQuery` 校验 session 存活；死则提示「新建 session 并重新绑定 / 取消」。

## 四、未决 / 实现风险（开工前必须先验证）

- **最大未知 = 权限面，不是能力面**：侧边栏插件是否被授权调 `/api` 的 `commands`/`session`/`subagents` 写端点，尚未验证。决定实现是「加 fetch 封装（轻）」还是「改 harness 授权/路由（重）」。**实现第一步必须实测**，不假设。
- **写回 `.plan/` 权限**：派发动作落盘 frontmatter 时，是插件直写（`fs.write` 是否可用）还是委托被派发的 agent 在 skill 内写，未定。
- 这两点未验证前不承诺工期。

## 五、下一步聚焦（建议顺序）

1. **验证权限面**（阻塞项）：在插件里加最小探针，调 `commands/list` 看侧边栏是否有权限；钉死「轻/重」路线。
2. 扩展 `api.ts`：加 `sessionList` / `sessionPrompt` / `commandExecute`（封装 `runSkillOnSession` 语义层）/ `subagentPrompt` / `sessionGet`。
3. 扩展 `index.tsx` 的 `inject`（或直接走 fetch，保持 self-contained）。
4. 实现四页动作层（①②③④，详见蓝图第六节实现契约）。
5. 实现后刷新：动作返回后重新读 `.plan/` + 查 session 状态（轮询或手动 ⟳）。

> 跨 harness 改动（若权限验证结果是「重」路线）需用户单独许可，按既有规矩不擅自改 harness。

## 六、相关产物索引

- 设计正本：`.plan/待拍板-计划视图交互蓝图-20260918.md`（已 `closed`，含〇节地基核实 v2 + 第四节 B/C/D/E 已决 + 第六节实现契约）
- 流程协议：`.plan/待拍板-流程协议化与plan-archive-20260918.md`（已 `closed`，两条流程 + 四交付物裁定）
- 插件源码：`/Users/huzilin/workdir/dsh-plugin/packages/dsh-plan-view/`（PlanView.tsx / src/client/api.ts / src/client/index.tsx）
- 调研知识库：`novel/.agents/skills/dsh-knowledge/chapters/ch02-agent-loop-events.md`、`ch03-session-system.md`、`patterns.md`
- 已交付 skill：`dsh-plugin/.../skills/plan-protocol/`、`plan-archive/`（均已 copy 至 `~/.dsh/.agent-presets/full/skills/mp-plan-*`）

## 七、suggested skills（下一 agent 按环境取用）

- **dsh-knowledge**：查 harness session/agent/命令的客户端可达能力（实现前核实权限面时必查）。
- **plan-protocol**：理解 plan 一套 skill 的位置与交接契约（实现动作层时对齐）。
- **plan-approve** / **to-tickets** / **to-spec**：③【拍板】实际调用的目标 skill，实现 `commandExecute` 落点。
- **handoff**：本 skill，延续交接。
- **writing-for-agents**：若需补/改 skill 文案规范时参考。

## 八、诚实边界

- 能力地基、B/C/D/E 决策均为实测/已决；**权限面与 `.plan/` 写回权限两项尚未验证**，是开工第一风险。
- 蓝图文档的 UI 从未浏览器实机验证（无 GUI 访问）；实现后需真机走查。
- 本轮未修改任何 harness 代码，仅 novel 侧文档（`1c31326`）+ 此前 dsh-plugin 提交。

## 九、执行记录（2026-09-18，ZCode 会话收口）

本文所列五步已全部执行完毕，handoff 关闭（status: closed）。

1. **权限面已验证，轻路线成立**：`/api` 的信任围栏只防 DNS rebinding / 跨站（Host + Origin + sec-fetch-site），**没有按插件的权限层**（源码自述 "this fence is not an auth layer"）。真机 curl 实测 `commands/list`（假 agentId 返回类型化 `session/not-found`）与 `session/list`（返回真实 session 清单）全链路通过。无需改 harness。
2. **api.ts 扩展完成**：`rpc()` 信封（`POST /api/<ns>/<method>` + `{type:'client-request',rpcId,method,payload:{args}}`）、`sessionList` / `sessionAlive`（E1）/ `sessionCreate` / `sessionPrompt`（queue 非阻塞）/ `commandExecute` / `fsWrite`。⚠️ wire 字段名 = Host 参数名（`session/*` 用 `_request`，commands 用 `agentId`）。
3. **动作层完成**（DetailModal 共享，四页通用）：① 🧭 开始推演 / ② ▶ 推进（建 session + B1 写回 `session:` frontmatter + queue 派发 + openSession）；③ ✅ 拍板（`/plan-approve <file>` 派到 origin_session ?? 当前 session）+ 绑定/来源 session 跳转 chip（E1 存活校验，死 session 提示可新建重绑）。总览页（D1）：effort 阶段卡片 + 最久待拍板 + 最长等待 blocker + 后台任务（C1 运行状态）。动作后重读 .plan/ + session 快照。
4. **构建部署**：tsdown 构建，lib 拷贝至 `~/.dsh/profiles/web/node_modules/dsh-plan-view`（md5 一致），浏览器刷新即生效。
5. **真机走查通过**：总览页（5 条最久待拍板带挂起天数、blocker/后台任务空态）、工单弹层（🧭 开始推演 + ▶ 推进按钮、chips、markdown 渲染）、待拍板弹层（✅ 拍板按钮、挂了 1 天、origin chip）全部正确。

**诚实边界（未实弹项）**：派发按钮未真实点击（当前 scope session 正在运行等你拍板，注入 /plan-approve 或新建 session 会产生真实副作用）；已实测的是 `session/list`、`commands/list` 两条读链路 + 信任围栏 + 描述符严格校验行为；`session/create`、`session/prompt`、`fs.write`、`uiWorkspace.openSession` 按同一信封/路由实现，形状来自生成描述符，首用如报错按 wire 字段名排查。源码改动（api.ts / PlanView.tsx + lib）未 git commit。
