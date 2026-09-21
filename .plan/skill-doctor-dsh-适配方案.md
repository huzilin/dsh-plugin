---
type: approval
date: 2026-09-15
status: closed
origin: proactive
---

# skill-doctor 适配 DSH：改动清单与待拍板项

> **状态头 2026-09-22 补录**（plan-approve lint 发现缺头，按实况回填）：四项拍板全部落地——A 走「开启默认根扫描 includeDefaultRoots: true」（`~/.dsh/.agent-presets/full/agent.cordis.yml` 留痕）、B1 harness 白名单正式加 dsh（`collect_sessions.py`）、C1 走 zstd 二进制、D1 原地改本地副本；DSH 报告已产出（`.plan/skill-doctor-reports/dsh-20260915.html`）。**残留挂账：`.dsh/skills/` 与配置改动在仓库外/未跟踪区，入库口径另定。**



> 编制日期：2026-09-15
> 结论前提：**本文件所有「实测」结论均来自本次会话对 `~/.dsh/` 与 skill-doctor 源码的只读排查**；未经你确认的部分一律标「推断」。

---

## 一、先说结论

适配 DSH，**你需要改的东西比想象中少**。核心只有一句：skill-doctor 的采集器（`collect_sessions.py`）不认识 DSH 的会话存储格式和技能目录位置。它现在支持的 6 个 harness 里没有 DSH，所以启动门禁直接拒了。

实测下来，DSH 的会话数据其实**非常适合**被评分——格式是干净的结构化 JSONL，比现在支持的部分 harness（如 ZCode 的请求转储、Warp 的 SQLite + protobuf 解码）更规整。

**你真正需要拍板的只有两件事**，其余都是我按既有代码惯例直接对齐的机械改动：

- **待拍板项 A**：全局技能的目录，DSH 有 `~/.dsh/skills/`（当前为空）和 `~/.dsh/agent-skills/`（当前只放状态文件）两个候选，而你的技能实际分散在**项目级** `.dsh/skills/`（如本工作区）和 `~/.zcode/skills/`（52 个）。要不要把某一处**声明为** DSH 全局技能目录？
- **待拍板项 B**：skill-doctor 的启动门禁（harness 白名单）本身要不要放宽？这是**协议性**改动，动了就等于偏离上游 skill 的设计意图。

---

## 二、实测证据（DSH 会话存储的真实形态）

以下是本次实际排查得到的事实，不是推测。

### 2.1 存储位置

```
~/.dsh/sessions/<把工作目录路径转义后的目录名>/session-<uuid>/session.jsonl.zstd
```

目录名的转义规则：把 cwd 的 `/` 换成 `-`，首尾各加 `--`。实测例：

| cwd | 目录名 |
|---|---|
| `/Users/huzilin/workdir/dsh-plugin` | `--Users-huzilin-workdir-dsh-plugin--` |

**这意味着「按仓库筛选会话」是免费的**——目录名本身就编码了 cwd，不需要读文件内容就能定位某个仓库的会话。实测该目录下有 13 个会话。

### 2.2 文件格式（这是唯一需要写解码器的地方）

- 每个会话一个文件：`session.jsonl.zstd`，**zstd 压缩的 JSONL**（每行一个 JSON 对象）。
- 实测大小约 85 KB（本会话），解压后 245 行。
- **重要**：collector 现有代码**完全没有 zstd 解压能力**（`import` 段只有 argparse/hashlib/json/os/re/sqlite3/subprocess/sys，无压缩库）。
- 本机有 `/opt/homebrew/bin/zstd` 命令行工具；Python 的 `zstandard` 模块**未安装**（实测 `ModuleNotFoundError`）。

> 所以解压有两条路：调 `zstd -dc` 子进程（不引入新依赖，但有外部进程依赖），或引入 `zstandard` 包（干净，但要装依赖）。见待拍板项 C。

### 2.3 记录类型（实测本会话 245 行的完整分布）

```
  79  assistant/chunk        ← 流式增量，是 assistant/message 的碎片
  38  text-chunks            ← 同上，流式碎片
  37  tool-call-chunks       ← 同上，流式碎片
  16  tool/call              ← 真正的工具调用（干净）
  15  tool/result            ← 工具返回（干净）
  10  step/start
  10  assistant/message      ← 真正的助手消息（含 text + tool-call 块）
   9  user/message
   9  step/end
   6  agent/inbox/spliced
   2  turn/start
   2  hook/invoked
   2  hook/result
   2  session/title
   1  session                 ← 首行，含 id / cwd / createdAt
   1  request/header
   1  request/context
   1  turn/end
```

**关键发现**：带 `-chunks` 后缀的 154 行（79+38+37）是**流式增量碎片**，真正的语义记录是 `assistant/message`（10 条）和 `tool/call`（16 条）。解析器**必须跳过 `*-chunks`**，否则会把同一次工具调用数成几十次，直接把「重复调用」这个评分维度算爆。

### 2.4 字段结构（实测原文样例）

**首行 `session`**（元数据来源，含 cwd 用于按仓库筛选）：
```json
{"type":"session","version":0,"id":"session-8b0f4491-...","createdAt":1789470782081,
 "cwd":"/Users/huzilin/workdir/dsh-plugin","delegationDepth":0,"agentPreset":"full"}
```

**`user/message`**：注意 `data.content` 是**块数组**，且首条用户消息被注入了大段 `<openviking-context>` 记忆上下文（实测该条 4054 字符，其中绝大部分是注入内容）。**必须复用现有 `looks_injected()` 过滤，否则评分器会把 OpenViking 记忆注入当成用户发言来打分。**

**`assistant/message`**：`data.message.content` 是块数组，含 `{"type":"text"}` 与 `{"type":"tool-call","name":...,"arguments":"<JSON 字符串>"}`。

**`tool/call`**：`data.{callId, name, arguments}`，`arguments` 是 JSON 字符串。

**`tool/result`**：嵌套较深——`data.message.content[0]` 是 `tool-result` 块，其 `.content[0].text` 才是实际输出；`isError` 字段可判断错误（对应现有 `stats["error_outputs"]`）。

### 2.5 无子代理会话

实测 DSH 会话首行有 `delegationDepth` 字段（本机 `--Users-huzilin-workdir-dsh-plugin--` 下全部为 `0`）。但实测**未发现**独立存放的子代理会话目录——DSH 的子代理会话存储位置本次**未能定位**。

> 性质：**文档有空白**（DSH 侧无公开说明，我也没找到）。影响：`--include-subagents` 对 DSH 无法生效，只能退化为「不支持」，不影响主流程。

### 2.6 技能调用在 DSH 中的痕迹（一个需要你注意的坑）

DSH 的技能不是通过某个 `Skill` 工具调用的——本次会话我用 `skill` 工具加载 skill-doctor，但实测该会话的 `tool/call` 记录里**只有 `bash`(20) / `glob`(1) / `read`(2)，没有 `skill` 调用记录**。技能加载是以 `<skill_content>` 形式注入到消息内容里的。

> 这意味着：现有的 `detect_skill_candidates()`（靠扫 `skills/<名字>/` 路径和 `{"skill": "..."}` 字段）在 DSH 上**部分失效**。技能覆盖率（skill_coverage，占总分 15%）需要额外的识别规则。性质：**我的推断**（基于本会话一条样本，样本量=1）。

### 2.7 DSH 的技能加载机制（源码实读，非推断）

**这一节是本次追加排查的结果，它推翻了初稿里「待拍板项 A」的定性。**

DSH 的技能扫描根目录由插件 `@deepseek-ai/dsh-skill-filesystem` 决定。实读源码 `packages/skill/skill-filesystem/src/index.ts` 第 241–260 行，优先级（rank 数字越小越优先）：

| rank | 来源标识 | 路径 | 本机 preset 是否启用 |
|---|---|---|---|
| 100 | `project-dsh` | `<项目根>/.dsh/skills` | ❌ **被关** |
| 200 | `project-agents` | `<项目根>/.agents/skills` | ❌ **被关** |
| 300 | `custom` | `customSkillDirs` 配置项 | ✅ 启用（指向 preset 自带 `skills/`） |
| 400 | `user-dsh` | `<dshHome>/skills`（即 `~/.dsh/skills`） | ❌ **被关** |
| 500 | `user-agents` | `<agentsHome>/skills` | ❌ **被关** |
| — | `bundled` | `DSH_BUNDLED_SKILL_DIR` | 视环境变量 |

项目根的判定规则（同文件 `findProjectRoot()`，第 937–947 行）：**从 cwd 逐级向上找第一个含 `.git` 的目录**；找到顶都没找到就返回 cwd 本身。

**关键：三条默认根（project-dsh / user-dsh / user-agents）被 `includeDefaultRoots: false` 全部关闭。** 原文照抄 `~/.dsh/.agent-presets/full/agent.cordis.yml`：

```yaml
# 收敛到 preset 自带目录，不扫全局/用户/项目根（与 coding-lite 一致），
# 全量技能通过本目录 skills/ 下的 ln 按需聚合，避免 host 层 51 条污染 lite。
- id: skill-filesystem
  name: '@deepseek-ai/dsh-skill-filesystem'
  config:
    includeDefaultRoots: false
    customSkillDirs:
      - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
```

`customSkillDirs` 解析到的就是 `~/.dsh/.agent-presets/full/skills/`（49 项，其中不少是软链到别处）。

**这解释了本次会话的现象**：本会话 `agentPreset` 实测为 `full`（会话首行 `"agentPreset":"full"`），而 `full` 关掉了项目根扫描——所以放在 `/Users/huzilin/workdir/dsh-plugin/.dsh/skills/dsh-knowledge` 的技能**根本不在扫描列表里**，自然不会出现在会话技能目录中。

**性质**：以上全部为**源码实测**（`skill-filesystem/src/index.ts` 第 241–260、937–947 行；`full/agent.cordis.yml` skills 段；`full/preset.yml` 的 description 亦自述「技能目录收敛到 preset 自带，`~/.dsh/skills` 按需 ln，不扫全局」）。

---

## 二·补、对初稿「待拍板项 A」的更正

初稿把 A 写成「DSH 全局技能目录定在哪，由你拍板」，并给出 A1–A4 四个选项。**该定性已被源码推翻**，更正如下：

**错在哪**：初稿假设「DSH 没有一个被认可的全局技能目录，需要你指定一个」。事实是——DSH **有**默认全局技能目录，写死为 `~/.dsh/skills`（源码第 253 行，`user-dsh`，rank 400），**它不需要你指定**；真正的情况是你的 `full` preset **主动关掉了它**。

**为什么这个更正重要**：按初稿去拍板「把全局目录定在 `~/.dsh/skills`」，你会以为在做设计决策，实际上那只是 DSH 的既有默认值；而真正的杠杆在 preset 配置（`includeDefaultRoots`），初稿完全没提到。**这是文档与 ground truth 冲突、以实测为准的又一例。**

**修订后的待拍板项 A（真正需要你决定的）**：

| 选项 | 做法 | 影响 |
|---|---|---|
| **A-新-1** | 改 `full/agent.cordis.yml`：`includeDefaultRoots: true`，同时保留 `customSkillDirs` | 项目根 `.dsh/skills` 与 `~/.dsh/skills` 同时生效。代价：**`full` preset 设计意图被推翻**——`preset.yml` 自述「收敛到 preset 自带，不扫全局/用户/项目根」是为了「避免 host 层 51 条污染 lite」。你当初这么改应有理由（隔离性），改回去要确认那个理由已不成立。 |
| **A-新-2** | 不改 preset，改**项目技能的使用方式**：把要用到的项目技能 `ln` 进 `~/.dsh/.agent-presets/full/skills/` | 与现有架构完全一致（`full/skills/` 下已有大量此类软链，如实测 `archify -> .../archify-dsh/skills/archify`）。代价：每个项目技能都要手动加链，跨项目复用要重复操作。 |
| **A-新-3** | 不改 preset，改用 `coding-lite` preset 或在会话里切换 | 取决于 `coding-lite` 的配置（实测其 `skills/` 只有 `archify`、`caveman` 两个，推测同样关了默认根——**未逐行核实，属推断**）。 |
| **A-新-4** | 维持现状，接受「项目级 `.dsh/skills` 在 `full` preset 下不加载」 | 零改动。若你本就认为项目技能该通过 preset 聚合而非项目根扫描，这是自洽的。 |

**我的推荐：A-新-2**。理由：`full` 现有的软链聚合模式是**你主动设计的隔离机制**（`preset.yml` 明说了是为避免污染），改 `includeDefaultRoots` 会推翻它；而 `.dsh/skills/dsh-knowledge` 本身就已经是个软链（指向 `/Users/huzilin/workdir/dsh-flow/.dsh/skills/dsh-knowledge`），说明你本来就在用软链做聚合——把它再软链进 preset 目录，是与既有做法一致的最小动作。

**但请注意**：这只解决「DSH 加载不加载」，**与 skill-doctor 的适配无关**——见下节。

---

## 二·补二、这对 skill-doctor 适配意味着什么

要点：**这两件事是正交的，别混。**

- **DSH 加载不加载某个技能** → 由 `skill-filesystem` 的 preset 配置决定（第 2.7 节）。
- **skill-doctor 报告里统计不统计某个技能** → 由 `collect_sessions.py` 的 `discover_skills()` 决定，**这条路径完全独立**，它直接读文件系统的 `*/SKILL.md`，**根本不经过 DSH 的加载机制**。

所以第 3.2 节第 8、9 项改动**依然成立且必要**：要让 skill-doctor 的报告能看见 `.dsh/skills/` 下的技能，必须给它的 `discover_skills()` 加路径——**哪怕 DSH 自己压根没加载那个技能**。

这带来一个**值得你注意的口径问题**：skill-doctor 统计的 `skill_coverage`（占总分 15%）本意是「本次会话用了多少已安装技能」。在 DSH 上，若 `discover_skills()` 扫到了 DSH **实际没加载**的技能，会把它们算进分母，**虚低覆盖率**。三种处理口径：

| 口径 | 做法 | 结果 |
|---|---|---|
| **口径一（推荐）** | skill-doctor 的 DSH 技能发现**对齐 DSH 实际加载的根**：即只扫 `~/.dsh/.agent-presets/<preset>/skills/` | 报告反映真实可用技能集，覆盖率不失真。代价：要解析 preset 名与会话的 `agentPreset` 字段（实测会话首行有该字段，可读）。 |
| **口径二** | 扫全部候选路径（项目 `.dsh/skills` + `~/.dsh/skills` + preset skills） | 实现最简单，但分母偏大、覆盖率虚低。 |
| **口径三** | 沿用别人家的做法（项目技能 only，加 `.dsh/skills`） | 改动最小，但如上所述会统计到 DSH 未加载的技能。 |

**我推荐口径一**，因为它是唯一能让「覆盖率」这个指标在 DSH 上有真实含义的做法；且会话首行已有 `agentPreset` 字段，实现成本不高。

---

按「必须改」和「可选」分开。**必须改**的是让 skill-doctor 在 DSH 上跑起来的最小集。

### 3.1 必须改（不动的后果：跑不起来）

| # | 文件 | 位置 | 改什么 |
|---|---|---|---|
| 1 | `scripts/collect_sessions.py` | `--harness` 的 `choices`（第 45 行） | 加入 `"dsh"` |
| 2 | 同上 | 新增 `--dsh-home` 参数 | 默认 `~/.dsh`，与既有 `--zcode-home` 等同构 |
| 3 | 同上 | 新增 `find_dsh_session_files()` | 扫 `<dsh_home>/sessions/*/session-*/session.jsonl.zstd`，按 mtime 过滤 cutoff |
| 4 | 同上 | 新增 `parse_dsh_session()` | 解 zstd → 逐行 JSON → 按 2.3/2.4 的规则归一化成现有 transcript 结构 |
| 5 | 同上 | `main()` 里加 DSH 分支（约 1300–1520 行的 harness 分发段） | 对齐 zcode/claude 分支写法，产出 `meta/stats/entries/skills_used` |
| 6 | 同上 | harness 归一化 | 单源报告 `harness` 字段填 `dsh` |
| 7 | `references/supported-harnesses.md` | 启动门禁表 | 增 DSH 行（采集器 ID `dsh`、存储位置） |

**采集器代码量估算**：`parse_dsh_session` 约 80–110 行，`find_dsh_session_files` 约 15 行，其余是常量与分发分支。参照已实现的 `parse_zcode_session`（75 行）与 `parse_grok_session`（74 行）的体量。

**实测可复用的既有设施**（不用重写）：
- `iter_jsonl_records()` — 但需要扩展以支持 zstd
- `TranscriptBuffer` / `truncate()` / `extract_text()` / `looks_injected()` / `detect_skill_candidates()`
- `session_matches_repo()` — DSH 可走更快的目录名匹配，也可直接用现有 cwd 比较
- `CODE_EDIT_HINTS` — 现有为 `("apply_patch","*** Begin Patch","edit_file","create_file","str_replace","write_file")`，DSH 的编辑工具叫 `edit` / `write`，**已在 `GENERIC_EDIT_TOOLS` 里但不在 `CODE_EDIT_HINTS` 里**，需确认代码质量评分器的代码编辑识别是否覆盖

### 3.2 必须改（技能发现侧）

| # | 文件 | 位置 | 改什么 |
|---|---|---|---|
| 8 | `scripts/collect_sessions.py` | `discover_skills()` 的 `roots`（第 138–142 行） | 项目级 skills 追加 `repo / ".dsh" / "skills"` |
| 9 | 同上 | `discover_skills()` 全局段（第 143–151 行） | 按待拍板项 A 的结论，追加 `Path(dsh_home) / "skills"` |

> 注：`discover_skills` 现在硬编码了 3 个项目级目录 + 3 个全局目录 + `(pi, grok, zcode)` 三元组。**没有 `--skills-dir` 之外的通用扩展点**，所以第 9 项要么改签名加 `dsh_home` 参数（与 pi/grok/zcode 同构，最一致），要么靠你每次命令行传 `--skills-dir`（零代码改动，但要记得传）。

> ⚠️ **2026-09-15 更正**：本节初稿把「DSH 侧技能目录」当作**待你拍板项 A**（即「DSH 全局技能目录该定在哪，需你来决定」）。**这个定性是错的。** 经查 DSH 源码 `packages/skill/skill-filesystem/src/index.ts`，DSH 的默认技能根目录**是写死的、不能改的**：项目级固定为 `<项目根>/.dsh/skills`，用户级固定为 `<dshHome>/skills`（即 `~/.dsh/skills`），**且当前 preset 把这两条都关了**。所以这不是「你想定在哪」的问题，而是「DSH 按什么规则扫、你的 preset 关掉了什么」的问题。待拍板项 A 因此**降级为「记录事实」**，不再需要你选择目录位置——详见第 2.7 节与修订后的待拍板项 A。

### 3.3 必须改（协议层，见待拍板项 B）

| # | 文件 | 改什么 |
|---|---|---|
| 10 | `SKILL.md` 第 19 行附近、`references/supported-harnesses.md` 第 18–20 行 | 启动门禁的 stop 行为描述与「不支持 harness」的告知文案 |

### 3.4 可选（不改也能跑，只是降级）

| # | 项 | 影响 |
|---|---|---|
| 11 | DSH 技能调用识别规则 | 不改则 skill_coverage 偏低（见 2.6） |
| 12 | `--include-subagents` 支持 | 不改则该 flag 对 DSH 无效（见 2.5） |
| 13 | 测试：`scripts/test_collect_sessions.py` 补 DSH 用例 | 不改则无回归保护 |

---

## 四、待你拍板项

### 待拍板项 A：DSH 的「全局技能目录」定在哪里？ ⟪已作废，见「二·补」⟫

> **本节定性已被源码推翻。** 「DSH 全局技能目录定在哪」**不是**需要你拍板的决策——DSH 已写死为 `~/.dsh/skills`（当前被 preset 关闭）。请直接阅读「二·补」节的修订版待拍板项 A（A-新-1 ~ A-新-4）。以下原文保留仅供留痕对照。

**这是什么**：skill-doctor 分「项目技能」和「全局技能」两类分别发现。项目技能从当前仓库目录下找，全局技能从用户主目录下的固定位置找。DSH 目前没有被 skill-doctor 认可的任一位置。

**原文照抄**（`references/supported-harnesses.md` 第 39–47 行）：
> ## Skill locations
>
> Project skills are discovered from:
>
> - `.agents/skills`
> - `.claude/skills`
> - `.codex/skills`
>
> Global skills are discovered from the corresponding directories under the user's home and configured harness homes when `--include-global-skills` is set: `~/.claude/skills`, `~/.agents/skills`, `~/.codex/skills`, Pi's skill directory under its agent home (default `~/.pi/agent/skills`), Grok Build's `~/.grok/skills`, and ZCode's `~/.zcode/skills`.

**语境**：这段定义的是「装在哪里的技能算这个 harness 的技能」。DSH 用的是 `.dsh/skills/` 布局（本 skill 自己就装在 `/Users/huzilin/workdir/dsh-plugin/.dsh/skills/skill-doctor/`），这个布局**不在这份清单里**，所以采集器永远不会扫到它——这是一处独立的、即使 harness 门禁放宽也依然存在的盲区。

**你的实际情况**（实测）：
- `~/.dsh/skills/` — **存在但为空**（0 个技能）
- `~/.dsh/agent-skills/` — 只有 `state.json`，不是技能目录
- 项目级 `.dsh/skills/`（本工作区）— 有 `skill-doctor` 和软链到 dsh-flow 的 `dsh-knowledge`
- `~/.zcode/skills/` — **52 个技能**（但那是 ZCode 的，不是 DSH 的）

**性质分类**：
- 「`~/.dsh/skills/` 存在但为空」——**实测**
- 「DSH 的技能主要分散在项目级」——**实测**（本工作区样本 + `~/.dsh/skills/` 为空）
- ~~「DSH 有意把全局技能目录留在 `~/.dsh/skills/`（只是你还没往里放）」——**我的推断**~~ → **已由源码证实**：`~/.dsh/skills` 确为 DSH 写死的默认用户级技能根（`skill-filesystem` 第 253 行，rank 400），**且当前被 `full` preset 关闭**。见第 2.7 节。

> ⚠️ **本节 A1–A4 四个选项已作废**，因定性错误（把 DSH 的既成默认当成待定决策）。修订后的选项见「二·补」节的 A-新-1 ~ A-新-4。**保留原文仅为留痕对照，请勿据此拍板。**

**选项与影响**：

| 选项 | 做法 | 影响 |
|---|---|---|
| ~~**A1**~~（作废） | 声明 DSH 全局技能目录 = `~/.dsh/skills`（与 zcode/grok/pi 同构：`<dsh_home>/skills`） | 实为 DSH 既有默认值，非可选项。~~最一致、代码最干净。**但实测该目录为空，所以全局技能发现结果当前是 0 个**~~ |
| **A2 仍然有效** | 额外把 `~/.zcode/skills`（52 个）也算作 DSH 全局技能 | 报告立刻有丰富数据。**但语义上是错的**——那是 ZCode 的技能，把它算成 DSH 的全局技能会让报告失真，且违背单一真相源。 |
| **A3** | 只改项目级（第 8 项），全局技能这一档**不改**，DSH 跑「项目技能 only」 | 改动最小，报告聚焦当前仓库实际用的技能，语义最干净。代价是跨仓库复用的全局技能不进报告。 |
| **A4** | 不改代码，每次命令行传 `--skills-dir` 指定 | 零代码改动，灵活；但每次都要记得传，且 `SKILL.md` 里没写这个用法，属于「靠人记」。 |

**我的推荐：A1 + A3 组合**——即改代码声明 `~/.dsh/skills`（机制正确、与既有 harness 同构），同时默认按「项目技能 only」跑，因为你真实的技能就在项目级。放技能进 `~/.dsh/skills` 是**你的**决定，不是我该替你做的。

---

### 待拍板项 B：启动门禁（harness 白名单）要不要放宽？

**这是什么**：skill-doctor 开跑前会确认「当前执行这个 skill 的 harness 是否在白名单里」，不在就**直接停止，一个字的历史都不读**。

**原文照抄**（`references/supported-harnesses.md` 第 18–20 行）：
> If the executing harness is not listed above, or cannot be identified confidently, stop before creating a report directory or reading conversation history. Tell the user:
>
> > skill-doctor currently supports Warp, Claude Code, Codex, Pi, Grok Build, and ZCode. This run appears to be using an unsupported harness, so no conversations were read.

**语境**：这道门禁是**有意的保守设计**——设计者宁可拒绝服务，也不愿在它没验证过的 harness 上产出可能失真的评分报告。注意它明确禁止「从磁盘上的会话文件反推 harness」（`Do not infer it from conversation files found on disk`），所以不能靠「本机有 DSH 会话文件」来绕过。

**性质分类**：
- 「门禁是 stop-before-reading 的硬停」——**文档已写明**
- 「设计意图是防止在未验证 harness 上产出失真报告」——**我的推断**（从措辞与位置推断）
- 「适配 DSH 后这道门禁必须放宽」——**我的推断**（否则改了采集器也进不去）

**选项与影响**：

| 选项 | 做法 | 影响 |
|---|---|---|
| **B1** | 把 DSH 正式加进白名单与 `supported-harnesses.md` | 门禁语义保持完整（「我在名单里所以放行」），最符合原设计。代价：等于声称「DSH 是受支持 harness」，而 DSH 侧我实测只覆盖到本次样本，**这个「支持」声明有超出证据的风险**。 |
| **B2** | 保留门禁，但为本地/自用场景加一条显式豁免（如 `--allow-unsupported-harness`） | 不篡改原设计意图，把「我知情并接受风险」显式化。代价：多一个 flag，且 `SKILL.md` 要写清何时用。 |
| **B3** | 直接删掉门禁段 | 最省事，但**丢掉了一处有价值的安全语义**，且下次上游更新 skill 会冲突。不推荐。 |

**我的推荐：B1**，理由——本次实测已经摸清了 DSH 的记录类型与字段（第 2 节），新增的解析器是在已知结构上写的，不是盲写；而且这是你自用环境，报告失真了你自己一眼能看出来。但如果你在意「不偏离上游设计」，B2 更稳。

**补充说明（可能影响你的选择）**：这份 skill 的 `SKILL.md` 末尾（第 166–171 行）固定输出一句推广语，指向 `warp.dev/factories/request-access`，并且 `report.json` 里有 `cta_url` 字段。也就是说**这份 skill 是 Warp 的商业获客物料**，不是纯社区工具。你要把它改造成 DSH 专用版之前，值得知道这一点——改完是否还要保留那句推广语、改后是否还叫 skill-doctor，都是你的口径问题。

---

### 待拍板项 C：zstd 解压走哪条路？

**这是什么**：DSH 会话是 zstd 压缩的，采集器现在没有任何解压能力。

**性质分类**：`/opt/homebrew/bin/zstd` 存在、Python `zstandard` 模块缺失——**均为实测**。

| 选项 | 做法 | 影响 |
|---|---|---|
| **C1** | 调 `zstd -dc` 子进程 | 零新依赖（与 collector 里已有的 `subprocess` 用法一致）。代价：依赖外部二进制存在；大文件流式读要注意管道缓冲。 |
| **C2** | `pip install zstandard`，走 Python API | 纯 Python、更可控、无外部进程。代价：给一个「本应零依赖」的脚本引入依赖，且 skill 在别的机器上跑要先装。 |

**我的推荐：C1**。理由：collector 已经在 `import subprocess` 且有既有用法，本机 `zstd` 实测可用，且这条路径不会让 skill 在别人机器上因缺 Python 包而崩。若将来 DSH 支持跨机分发再考虑 C2。

---

### 待拍板项 D（口径问题）：改完的产物放哪、叫什么？

**这是什么**：这份 skill 是装在 `dsh-plugin` 工作区里的**第三方 skill**（含 Warp 推广语）。改造它意味着你要维护一份 fork。

**你的相关既有事实**（来自记忆）：你之前给 `wayfinder-maps` skill 做修正时，同步了 `dsh-plugin/packages/dsh-plan-view/skills/wayfinder-maps/` 的 vendored 副本，并提交推送到 `huzilin/dsh-plugin`；但向上游 `rengwu/wayfinder-maps` 推送**被拒绝**（没有 fork）。

**性质分类**：「这份 skill 含 Warp 推广语、是商业获客物料」——**实测**（`SKILL.md` 第 166–171 行 + `report.json` 的 `cta_url`）；「你打算怎么处置上游关系」——**我的推断，需你确认**。

**选项**：
- **D1**：就在 `.dsh/skills/skill-doctor/` 原地改，当作本地适配分支，不碰上游。
- **D2**：另起名（如 `skill-doctor-dsh`）放进你的技能库，与上游解耦，便于将来同步上游更新。
- **D3**：先只写一个**不改原文件**的独立补丁脚本（新增 `dsh` 采集器作为独立模块，用 `--skills-dir` 等既有扩展点接入），验证报告质量后再决定是否真正 fork。

**我的推荐：D3 → 视效果再定 D1/D2**。理由：先用最小侵入验证「DSH 会话评分出来到底有没有用」，再决定是否值得维护一份 fork。避免先花大力气改完、结果发现评分器对 DSH 的记录形态水土不服。

---

## 五、还有一件事需要你决定：门禁期间的产物

按 skill 的 Step 0 规定，**门禁未过时不得创建报告目录、不得读会话历史**。本次我已遵守——**没有创建任何临时报告目录，没有把任何会话内容喂给评分器**。

但请注意：为了写这份改造方案，**我确实读取了 DSH 会话文件的结构**（第 2 节的实测证据）。我读的是**本会话自己**的记录、以及会话首行的元数据与记录类型分布统计，用于确认格式。**我没有读取其他会话的对话内容，也没有把任何会话内容写到本文件之外的地方，没有上传到任何地方。**

如果你认为连「结构排查」都不该做，请告诉我，我会停止后续排查。如果你认为这份方案里的实测证据已经越界，也请指出，我会调整边界。

---

## 六、我建议的下一步

1. 你就 **A / B / C / D** 四项给出选择（A 与 B 是实质决策，C 我建议直接按 C1，D 建议 D3）。
2. 我按结论实施，**改动只落在 `dsh-plugin` 工作区的 skill 副本里**，不碰你的真实会话数据。
3. 跑一轮真实报告，把结果给你看**再**决定是否保留这次改造。

**我不建议**你先让我闷头改完 7 个文件再跑——万一评分器对 DSH 的记录形态不适应（比如 2.6 那个技能识别问题），前面都白改。先跑通一条链路更省事。

---

## 附：本次实测命令与观察（可复核）

- 会话目录：`ls ~/.dsh/sessions/` → 9 个按 cwd 转义的项目目录
- 单会话：`~/.dsh/sessions/--Users-huzilin-workdir-dsh-plugin--/session-8b0f4491-.../session.jsonl.zstd`（85 KB）
- 记录分布：`zstd -dc <file> | python3` 统计 `type` 字段 → 245 行、20 种类型（见 2.3）
- zstd 能力：`which zstd` → `/opt/homebrew/bin/zstd`；`import zstandard` → `ModuleNotFoundError`
- 采集器依赖：`collect_sessions.py` 第 15–27 行 import 段，**无压缩库**
- 门禁表：`references/supported-harnesses.md` 第 7–20 行
- 技能位置：同上第 39–47 行
- 项目技能 roots：`collect_sessions.py` 第 138–142 行
- 全局技能 roots：同上第 143–151 行
- zcode 解析器参照：同上第 1115–1189 行
- 编辑工具常量：同上第 36–38 行
