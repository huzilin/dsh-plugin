# dsh-zvec-router

预设级**检索路由**插件：给 DeepSeek Harness 补一个 `code_search` 复合工具——**一次调用同时拿到精确证据与语义证据**，并把 `tool:grep` / `tool:glob` 的提示词改成「按证据类型路由」。

## 为什么不是「把 grep 全换成 zvec」

| | 精确检索（ripgrep 路） | 语义检索（向量索引路） |
|---|---|---|
| 覆盖 | `rg_exhaustive` 全量，实时读盘 | `ranked_sample` 抽样 |
| 新鲜度 | 立即可见 | 索引去抖（默认 750ms）后才可见，结果可能标 `possibly_stale` |
| 适合 | 已知标识符/字面量/正则/配置键/报错串、**完整出现位置清单** | 措辞或位置未知、跨文件架构/关系/数据流/设计意图 |

两者是**互补而非替代**。把 grep 全量换成语义检索，等于把「列出全部出现位置」这种确定性查询降级成抽样式召回，并给「改完即验」引入陈旧窗口。所以本插件做的是**路由**：保留原生 `grep`/`glob` 权威地位，用提示词告诉模型什么时候该走哪条路，并给一个一次拿全两者的复合工具。

上游 zvec-grep 自己的 MCP 规则也是这个口径（`dist/mcp/tools.js`）：exact lookup 用 rg，语义/混合任务先用 `zvec_grep_search` 定位再用 rg 聚焦验证。

## 两个贡献

### 1. `code_search` 工具

| 参数 | 作用 |
|---|---|
| `pattern` | ripgrep 正则 → **穷举**、读盘的匹配清单 |
| `query` | 自然语言意图 → 语义发现的**排序样本** |
| `path` | 限定文件/目录（精确路走 `rgPaths`，语义路走 `includePaths`） |
| `glob` | 文件 glob 过滤，如 `*.ts` |
| `exactLimit` | 精确路条数上限（默认 20，最大 100） |
| `semanticLimit` | 语义路条数上限（默认 5，0 = 关闭） |

两者都给 = 一次拿全；只给一个 = 只跑那一路。返回带 `coverage`（`rg_exhaustive` / `rg_truncated` / `ranked_sample`）与逐条 `status`（`fresh` / `possibly_stale`），**穷举清单和抽样结果不会被混淆**。

语义路失败（索引未就绪/缺失）不拖垮整个调用：降级为 `semantic.status = "unavailable"` 并附原因，精确路照常返回。

### 2. 提示词路由

shadow 掉第一方 `tool:grep` / `tool:glob` 段（`systemPrompt.section()` 同名覆盖，`order` 仍用核心的 `TOOL_GREP` / `TOOL_GLOB` 槽位），改为按证据类型路由的措辞，并明确点出 `zvec_search` 与 `code_search` 分别扮演什么角色。

原生 `grep` / `glob` **保持注册且权威**——不做任何 dispatch 期拦截或改参（`PreToolDecision` 本就排除改写参数）。

## 安装

以 web profile 为例（本地 `link:` 安装，与 `dsh-tool-deny` 同款做法）：

```json
// ~/.dsh/profiles/web/package.json
{
  "dependencies": {
    "dsh-zvec-router": "link:/Users/huzilin/workdir/dsh-plugin/packages/dsh-zvec-router"
  }
}
```

然后 `cd ~/.dsh/profiles/web && pnpm install`。

### 依赖：`@zvec/zvec-grep`

本插件**复用已有的 zvec 引擎**，不新增第二份：`@sugarforever/dsh-zvec-grep` 已把它装进 profile。若未装该插件，需自行 `pnpm add @zvec/zvec-grep`。

> **坑（已实测）**：`link:` 安装的插件，Node 按**真实路径**（profile 树外）解析裸标识符，profile 里 hoist 的 `@zvec/zvec-grep` 看不见 → `ERR_MODULE_NOT_FOUND`。且 `import.meta.resolve` 的 parent 参数在部分 Node 版本被忽略、`require.resolve` 看不到 `exports`-only 的 ESM 包。因此插件改为**按目录探测**，优先级：`DSH_ZVEC_ROUTER_RESOLVE_FROM` → `$DSH_HOME/profiles/{web,desktop}` → `~/.dsh/profiles/{web,desktop}`（内置缺省，harness 默认落 `~/.dsh` 却不导出 `DSH_HOME`，故直接写死兜底，无需任何环境变量即可命中）。读该包 `package.json` 的 `exports`/`main` 得到入口文件，用绝对 URL import；全失败才回落到裸标识符。

## 配置

在预设的 `agent.cordis.yml` 加一行：

```yaml
- id: zvec-router
  name: dsh-zvec-router
  config:
    mountTool: true      # 注册 code_search（默认 true）
    routePrompt: true    # shadow tool:grep / tool:glob 提示段（默认 true）
    exactLimit: 20
    semanticLimit: 5
    excerptChars: 700
    timeoutMs: 30000
    # embedding: local/potion-code-16m-v2   # 省略则用引擎默认
    # device: auto                          # auto|cpu|metal|vulkan|cuda
```

预设里**不要**重复挂 `@sugarforever/dsh-zvec-grep`：那是 host（profile bundle）层的行，preset 层再挂会双挂载。

## 生命周期

- 引擎按 **workspace root** 懒创建并缓存，同源 session 共享一个实例；`createZvecGrep` 返回 promise，缓存存的是 promise，避免并发重复创建。
- 关闭挂在 `ctx.effect()` 上，插件卸载时 `closeAll()` 释放全部引擎（含 native binding 与嵌入模型）。
- 每次调用带 `timeoutMs` 兜底，native 资源卡住会变成工具错误而不是挂住整个 turn。

## 验证

冒烟脚本对真实仓库跑过（DSH 本体，230MB 索引）：

```
BOTH        451ms  exact[rg_exhaustive n=4]  semantic[ready ranked_sample n=5]
REGEX_ALT    79ms  exact[rg_truncated  n=5 TRUNC]          # | 交替正则生效
ANCHOR      120ms  exact[rg_exhaustive n=1]                # ^ 锚定生效
PATH+GLOB    28ms  exact[rg_exhaustive n=4]                # path + glob 作用域
SEM_ONLY    148ms  semantic[ready ranked_sample n=5]
NO_MATCH    117ms  exact[rg_exhaustive n=0]
BAD_REGEX     3ms  exact[unavailable n=0 ERR:Search failed]
EMPTY_ARGS       THREW（明确报错，不是静默返回）
disposed clean
```

## 与 `dsh-tool-deny` 的关系

正交。`dsh-tool-deny` 用 `restrict({deny})` **移除**工具（省 token）；本插件**新增**一个工具并**改写**提示词路由。两者可同 preset 共存。
