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

## 唯一审批闸门（DSH 自身审批已关闭）

- 插件会**自动代答所有 DSH 沙箱升级审批**（`approval/request` 中 reason 以 `escalate sandbox to` 开头的请求，任意工具），直接返回 `allowed-once`（配置项 `suppressDshApproval`，默认 `true`）。你只会看到本插件的确认框。
- ⚠️ 不要把 DSH/会话审批策略设为 `never`：`never` 会在任何监听器运行**之前**就拒绝所有请求，本插件的确认框也会被一并自动拒绝。请保持策略为 `ask`，让插件代答 DSH 的提示（弹框文案里会提醒这一点）。

## 架构（零内核改动）

插件是**同一个包的两个半区**，不修改 DSH 内核任何文件：

| 半区 | 文件 | 职责 |
| --- | --- | --- |
| 宿主 | `lib/server.js`（Node，`main`/`exports["."]`） | 策略引擎、`tools/pre-execute` / `approval/request` / `tools/post-execute` 钩子、模型工具、直连 HTTP 路由 |
| 客户端 | `lib/client.js`（浏览器包，`exports["./client"]`） | **接管审批弹框** —— 以 `priority: 0.5` 注册到 `conversation.composer` 链（chain 槽按 priority 升序选举：0.5 早于内核面板的 1，而提问接管在 0、两者并存时提问仍优先） |

客户端半区完全自足：精确命令取自 ask 文案的 `命令：` 行，「加入白名单」按钮直连 POST `/dsh-approve/whitelist-add`，应答走载体的 `respond()`（与内核 PendingApproval 同线格式）。

> ⚠️ 浏览器必须拿到**最新启动清单**才能加载客户端半区：改过客户端包后要清浏览器/webview 缓存（或用无痕窗口）刷新。`dsh.client.immediately: true` 让模块在启动时加载。

## 确认框（三个动作）

插件自己的面板渲染审批弹框（替换原生两按钮面板），按钮**直连宿主插件**：

| 动作 | 怎么操作 | 效果 |
| --- | --- | --- |
| 拒绝 | 按钮 | 阻止该命令 |
| 加入白名单 | 弹框按钮（直连插件路由） | 精确命令**立即落盘**，本次放行，以后永不拦截/不再询问 |
| 允许一次 | 按钮 | 本次放行该命令 |

白名单（无论手动编辑还是 `dsh_approve_whitelist_add` 添加）都是**完整相同**精确匹配，加入后不再被拦截。

## 安装

```sh
dsh plugin --profile web add link:/Users/huzilin/workdir/dsh-plugin/packages/dsh-approve
```

重启 `dsh web`（该方式把插件注册为 profile 的 bundle 层）。

**用户层安装（不依赖 pnpm）** —— ⚠️ 注意：运行中的 `dsh web` 虽然会监听 profile 的 `cordis.patch.yml`，但把新插件行**热插入**用户层目前会把宿主工具管线打崩（`Cannot read properties of undefined (reading 'kind')`）。不要热插：先写入这行，再带着它重启一次 `dsh web`（冷启动挂载没有问题）。步骤：

```sh
cd ~/.dsh/profiles/web && pnpm add link:/Users/huzilin/workdir/dsh-plugin/packages/dsh-approve
```

`~/.dsh/profiles/web/cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-approve
      name: 'dsh-approve'
```

挂载标记（apply 时写入一次，用于验证是否加载）：`~/.dsh/dsh-approve.mounted`。

## 构建（客户端半区）

宿主半区（`lib/server.js`）是纯 JS，无需构建。客户端半区是一份 tsdown 构建产物（`src/client/ → lib/client.js`，使用 DSH 客户端 face）：

```sh
/Users/huzilin/workdir/deepseek-harness/node_modules/.bin/tsdown
```

在本包根目录运行。重建后 DSH `modules` 服务会对 `lib/client.js` 内容重新哈希成新 `rev` —— 用**清过缓存**的浏览器刷新（或重启 `dsh web`）。

> 注意：不要在 `dsh web` 运行中往里加这行（热插入会打崩宿主；先停、再改、再启）。如果之后又用 `dsh plugin add`（第一种方式），请删掉用户层这一行，否则插件会被挂载两次（重复的 hook 监听器 + 状态工具注册冲突）。

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
- `enforceDanger` —— 设为 `false` 关闭内置危险兜底（高级）。
- `suppressDshApproval` —— 设为 `false` 则保留 DSH 自身的沙箱升级弹框，不再自动代答。

## 模型工具

- `dsh_approve_status` —— 当前状态、白名单、危险兜底、代答开关。
- `dsh_approve_whitelist_add(command)` —— 把一条精确命令写入白名单（即时落盘）。用户说「加入白名单」时使用。
- `dsh_approve_whitelist_remove(command)` —— 移除一条精确命令。

## 安全说明

- 拒绝是 fail-closed：deny/ask 用 `prepend: true` 短路 `tools/pre-execute` 瀑布，且后续任何单调守卫仍可拒绝。
- 危险兜底只保留系统级破坏类（mkfs、dd 写裸盘、分区工具、电源状态、fork bomb、sudo mkfs/dd）；`rm`/`curl`/`sh`/`chmod -R /`、`chown -R /` 已于 2026-08-22 移出内置兜底，如需重新硬拦截请在 `denyPatterns` 里加正则。
- `suppressDshApproval: true` 时对任意工具自动放行沙箱升级 —— 这是你要的取舍（「关 DSH 审批、单闸门」）。白名单 shell 命令的升级询问按 callId 关联自动放行；其余非升级询问仍交给人工。
- 白名单写入是原子的（tmp + rename），只动 `whitelist` 键，`denyPatterns`/`enforceDanger`/`suppressDshApproval` 原样保留。

## License

MIT