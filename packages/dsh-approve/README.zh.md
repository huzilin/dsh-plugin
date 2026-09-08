# dsh-approve

DSH 命令白名单插件，基于 DSH 的 `tools/pre-execute` 与 `approval/request` 扩展点实现。

[English](README.md) | 中文

## 策略

对每条 shell 命令（`bash`、`pwsh`、`ssh_exec`、`ssh_cluster`），按下表顺序判定：

| # | 条件 | 结果 |
| --- | --- | --- |
| 1 | 与白名单**完整相同**（整条命令逐字节相等） | **放行** —— 任何目录都不再询问；该调用内部的沙箱升级审批也会自动放行（按 callId 关联） |
| 2 | 危险命令（**系统级**：`mkfs`、`dd of=/dev/...`、`fdisk/parted/gdisk/diskutil /dev/...`、`shutdown/reboot/halt/poweroff`、fork bomb、`sudo mkfs/dd`） | **拒绝** —— 派发前硬拦截，任何目录都不允许 |
| 3 | 非当前目录命令：`workdir` 指向会话工作区**之外**（其他项目、`/tmp`、home 等），或远程执行（`ssh_exec`/`ssh_cluster`） | **询问** —— 需要你确认，除非命中白名单 |
| 4 | 其余（会话工作区内、包括其子目录的安全命令） | **放行** —— 不干预 |

说明：
- **`rm`、`curl`、`sh`、`chmod -R … /`、`chown -R … /` 不在内置危险兜底里**（2026-08-22 用户决定）：这些命令按正常策略走 —— 在工作区外弹框询问，在工作区内直接执行。想重新拦截，在 `denyPatterns` 里加正则即可（如 `["^rm ", "\\bcurl\\b.*\\|\\s*sh\\b"]`）。
- **白名单是完整相同**：`whitelist` 条目与去除首尾空白后的整条命令做普通字符串相等比较 —— 不支持前缀、子串或通配符。把某条精确命令写进白名单即是你对它的显式预授权，因此优先于危险兜底（第 1 条先于第 2 条）。

“当前目录” = 会话工作区（`agent.session.header.cwd`）。`workdir` 等于工作区或位于其目录树内（子目录）都算“当前”；越过工作区树之外的才叫“非当前目录”，需要确认。

## 审批分层（DSH 自身审批保持开启）

插件**不代答 DSH 自身审批** —— 这是硬编码的（2026-08-22 用户决定，**没有** `suppressDshApproval` 配置项）。

- **Shell 命令**（`bash`/`pwsh`/`ssh_*`）：只由本插件把关 —— 白名单精确匹配（零提示）/ 系统级危险（拒绝）/ 非当前目录（走 DSH 核心 `ui-approval` 审批面板）。被**白名单**的命令自身沙箱升级按 callId 关联自动放行，白名单命令全程不再询问。
- **其余一切**（文件工具写工作区外、本插件不拥有的任何 `sandbox_permissions` 升级）：**DSH 原有审批照常弹给你**。插件不是一刀切的自动放行器，只在其上叠加命令级闸门。
- **白名单写入必须经你审批**。模型工具 `dsh_approve_whitelist_add` / `dsh_approve_whitelist_remove` 在改动 `~/.dsh/dsh-approve.json` **之前会先弹 DSH 审批框** —— agent 不能自主写白名单。审批弹框 UI 由 DSH 核心 `ui-approval` 提供（本插件不再覆盖 composer）。

## 架构（零内核改动）

插件是**纯宿主插件**，不修改 DSH 内核任何文件：

| 半区 | 文件 | 职责 |
| --- | --- | --- |
| 宿主 | `lib/server.js`（Node，`main`/`exports["."]`） | 策略引擎、`tools/pre-execute` / `approval/request` / `tools/post-execute` 钩子、模型工具、直连 HTTP 路由 |

审批弹框 UI 完全交给 DSH 核心 `ui-approval`（`conversation.composer` 上的原生面板）。本插件经 `approval/request` 钩子处理白名单命令的自动放行，需要人工确认的非白名单命令由核心面板呈现拒绝/允许。

> 历史：旧版曾在 `conversation.composer` 注册自定义三按钮面板（含「加入白名单」），因其按已废弃的客户端 API 选择器读取 `interactions`（现核心 currency 为单个 `pendingInteraction`）导致选择器崩溃，已移除该客户端半区。

## 确认框（由 DSH 核心 ui-approval 呈现）

需要人工确认的非白名单命令，由 DSH 核心的审批面板（`ui-approval`）呈现：拒绝 / 允许一次。

> ⚠️ 保持 DSH/会话审批策略为 `ask`。设为 `never` 会在监听器运行前拒绝所有请求，任何确认框都会被一并自动拒绝。

白名单（通过模型工具 `dsh_approve_whitelist_add` **经你审批后**添加）都是**完整相同**精确匹配，加入后不再被拦截。若你想在审批弹框里一键「加入白名单」+ 放行，需另做自定义 composer 面板（本插件当前不提供）。

## 安装（从 GitHub monorepo）

```sh
dsh plugin --profile web add 'github:huzilin/dsh-plugin#path:/packages/dsh-approve'
```

从远端仓库安装为真实依赖（**不再用本地符号链接**），`dsh plugin` 会自动把它加入 profile 的 bundle 层。随后**重启一次** `dsh web`：

- 插件经 **bundle 层**（`dsh.profile.bundles`）挂载 —— **不需要**在 `cordis.patch.yml` 用户层里加 insert 行，保持该文件为 `[]` 以免双挂载。
- 纯宿主插件，无客户端 bundle。

挂载标记（apply 时写入一次，用于验证是否加载）：`~/.dsh/dsh-approve.mounted`。

> 本地 push 后更新：`cd ~/.dsh/profiles/web && pnpm update dsh-approve`，再重启 `dsh web`。

## 配置

`~/.dsh/dsh-approve.json`：

```json
{
  "whitelist": [
    "rm -rf /tmp/build-cache",
    "git push origin main"
  ],
  "denyPatterns": [
    "^freshclam "
  ],
  "enforceDanger": true
}
```

- `whitelist` —— 精确完整命令字符串，任何目录都自动放行（配置**每次判定都重新读取**，手动编辑与运行时添加都即时生效，无需重启）。
- `denyPatterns` —— 在内置危险兜底之上的额外正则黑名单（非法正则会丢弃并记日志）。
- `enforceDanger` —— 设为 `false` 关闭内置危险兜底（高级）。**没有** `suppressDshApproval` 键：DSH 自身审批始终保留（见「审批分层」）。

## 模型工具

- `dsh_approve_status` —— 当前状态、白名单、危险兜底。
- `dsh_approve_whitelist_add(command)` —— 把一条精确命令写入白名单（即时落盘）。**必须先经你审批**：agent 发起时会弹 DSH 审批框，未获批准则拒绝写入。
- `dsh_approve_whitelist_remove(command)` —— 移除一条精确命令。**同样必须先经你审批**。

## 安全说明

- 拒绝是 fail-closed：deny/ask 用 `prepend: true` 短路 `tools/pre-execute` 瀑布，且后续任何单调守卫仍可拒绝。
- 危险兜底只保留系统级破坏类（mkfs、dd 写裸盘、分区工具、电源状态、fork bomb、sudo mkfs/dd）；`rm`/`curl`/`sh`/`chmod -R /`、`chown -R /` 已于 2026-08-22 移出内置兜底，如需重新硬拦截请在 `denyPatterns` 里加正则。
- DSH 自身沙箱升级审批**保持开启**（硬编码，无配置项）：插件不拥有的升级（文件工具等）照常弹人工确认；被白名单的 shell 命令升级询问按 callId 关联自动放行，白名单命令不再重复弹框。
- 白名单写入是原子的（tmp + rename）且**必须经人工审批**：模型工具先弹审批框再动 `~/.dsh/dsh-approve.json`（无弹框直接写入路径 —— 旧版弹框按钮已被移除）。`denyPatterns`/`enforceDanger` 写入时原样保留。

## License

MIT