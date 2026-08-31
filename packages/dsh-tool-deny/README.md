# dsh-tool-deny

预设级工具裁剪插件：用 core tools service 的 `ctx.tools.restrict({deny})` 把 host 无条件注入、但本预设用不到的工具（如 `restart_harness`、`notify_test`）从 **模型可见 schema + 系统提示** 中整体移除 —— 真实省 token，不是运行时拦截。

## 为什么是 preset 行而不是改 host 插件源码

限制落在预设自己的 scope 层（scope 链 `view()` 逐层求交），天然 per-preset：full / liangshen / team 等其它预设完全不受影响；未来任何预设想裁任何工具（notify、dsh_approve_*、mcp__semantica_* …）都是同一行配置。

## 用法

1. 安装到 profile（以 web 为例）：

   ```json
   "dependencies": {
     "dsh-tool-deny": "link:/Users/huzilin/workdir/dsh-plugin/packages/dsh-tool-deny"
   },
   "dsh": { "profile": { "bundles": [ "dsh-tool-deny" ] } }
   ```

   然后 `pnpm install`（profile 目录下）。

2. 在预设的 `agent.cordis.yml` 加一行：

   ```yaml
   - id: tool-deny
     name: dsh-tool-deny
     config:
       deny:
         - restart_harness
         - notify_test
   ```

## 防御性

`tools.restrict()` 对未注册的全局工具名会抛错并导致整个预设挂载失败。插件先把 `config.deny` 过滤为 `ctx.tools.get(n) !== undefined` 的名字，host 缺工具时降级为 no-op。

## 语义要点（core: `packages/core/tools/src/index.ts`）

- `restrict({deny})`（:1071）：名字必须在 `view(scope).restrictableNames` 内，否则抛错；
- 各 scope 层的限制是 **交集**（`view()` :1152 `layers.every(layer => layer.admits(name))`），所以 preset 层的 deny 对其下所有 agent 生效；
- 被 deny 的工具离开 schema 和提示词 —— 这是省 token 的根源。
