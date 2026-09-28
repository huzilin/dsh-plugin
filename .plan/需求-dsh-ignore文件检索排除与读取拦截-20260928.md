---
type: research
date: 2026-09-28
status: active
origin: proactive
---

# 需求 · DSH ignore 文件：基于清单文件的检索排除与读取拦截（2026-09-28）

> **用户期望（照抄大意）**：「要能基于一个文件给出的目录，让 DSH 默认不检索、不读取。」
>
> **现状**（deepseek-harness 源码实测，2026-09-28）：file-reference-local 明文无 ignore 语义（README:129）；排除仅靠 deployment 注入 `excludedDirectories`（目录 basename、替换式默认 15 项、无单文件排除）；tool-fs `read` 无任何清单拦截。ZCode 已有同款能力（`.zcodeignore`），两 harness 行为不一致 → 同一仓两套检索面。

## 需求

1. **清单文件**：workspace 根一个 ignore 文件，每行一条目录/路径（支持 `#` 注释），**入 git 随仓分发**。
2. **两层生效**（与现状的本质差异——不只不索引）：
   - **检索/index**：file-reference-local 遍历与搜索跳过清单内路径（`search.ts` 遍历处）；
   - **读取拦截**：tool-fs `read`（`read.ts applyReadTool`）对清单内路径**拒绝返回**，错误信息注明「被 <清单文件> 排除」。
3. **语义细节**：
   - 条目形态：目录为主（repo 相对路径）；单文件排除可选；
   - 默认名单（15 项工程目录）与清单**合并**而非替换（修掉现 excludedDirectories 的替换式坑）；`.git` 等标准项保留兜底；
   - 生效范围：file-search / 遍历 / read 三处一致。

## 实现落点（deepseek-harness）

| 生效层 | 文件 | 动作 |
|:--|:--|:--|
| 检索/index | `packages/context/file-reference-local/src/search.ts` | 遍历前加载清单，跳过匹配路径 |
| 读取拦截 | `packages/fs/tool-fs/src/read.ts`（`applyReadTool`/`parseReadArgs`） | 目标路径命中清单 → 拒绝 + 指明排除来源 |
| 配置链 | deployment/workspace 注入处 | 清单文件发现与解析（含缺省=无清单不变） |

## 验收

清单含 `.archive/`、`.tmp/` 后：① file search 不返回其中任何文件；② tool-fs read 对其中路径返回排除错误（非文件内容）；③ 未列目录行为不变；④ `.git`/`node_modules` 默认排除不回退。

## 清单文件命名（二选一，实现时拍）

- **首选：兼容读取 `.zcodeignore`**——一份清单两 harness（ZCode/DSH）同时生效，免双维护；语义上它只是一份目录清单；
- 备选：独立 `.dshignore`（语义干净，但两仓两份清单需人工同步）。

## 立项

实现侧为 deepseek-harness 仓（本档为需求底稿）；dsh-plugin 侧断链清单 L4/0 挂链跟踪。
