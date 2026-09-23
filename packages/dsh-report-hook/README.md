# dsh-report-hook

汇报规范自动提醒 hook。每次用户发言时判断「这句是不是在要决策 / 审批 / 拍板」，
命中就往 agent 上下文注入一段提醒，把《汇报语言与审批材料规范》变成**当场可执行的动作**，
而不是一个还需要 agent 自己想起来去翻的指针。

## 它怎么工作

```
用户发言
  → DSH hooks-claude-code 桥接（agent/pre-step, UserPromptSubmit）
  → node scripts/report-hook.mjs（stdin 收 JSON payload）
  → 命中：stdout 输出 {"hookSpecificOutput":{...,"additionalContext":"…"}} ⇒ 注入
  → 未命中：空 stdout + exit 0 ⇒ 不注入（这就是「不误伤」）
```

判断是两段式正则：**强决策词**命中即判定；否则需要**弱决策词 + 决策语境词**同时命中。
触发词清单在 `scripts/report-hook.mjs` 底部的 `DECISION_TRIGGERS`，增补同义说法改那里。

判定偏「宁可多提醒」——注入文案自带「若无需拍板可忽略」的降级说明，越界提醒无实质危害，
漏提醒才违背本插件存在的意义。

## 注入文案的条款

| 条款 | 内容 | 约束力 |
|---|---|---|
| ① | 说听得懂的话——少用英文与非技术专业词 | 命中即适用 |
| ② | 展开说，不许甩词条——禁止「一个词/一个编号 + 问怎么处理」 | 命中即适用 |
| ③ | 要审批必须交文档——落盘的审批文档须含原文照抄 + 语境 + 条款关系 + 选项与影响 | 需要拍板时 |
| ④ | 性质必须分类标注——区分「文档已写明 / 文档有空白 / 你的推断」 | 需要拍板时 |
| ⑤ | **文档必须在侧边栏打开**——凡产出文档一律用 `sidebar_open` 打开 | **与是否拍板无关** |
| ⑥ | **已打开的文档：重复打开只聚焦，不是刷新**——如实声明做不到关闭/刷新 | **与是否拍板无关** |

### 关于⑤（2026-09-11 新增）

用户拍板原话：

> 「里面要求将要拍板并落的文档，最后直接调 sidebar_open 打开。并要求一般的文档输出格式，
> 要求都是 sidebar 打开的。」

所以⑤有两层，两层都要覆盖：

1. **要拍板的文档**：③落盘的审批文档，写盘后立刻 `sidebar_open` 打开，让用户当场读全文；
2. **一般文档输出**：报告、设计稿、分析、总结、方案对比……凡是落盘成文件的产出，同样一律打开。

关键点：**⑤独立于拍板判定**。哪怕这轮不是「要决策」，只要产出了文档，就得打开。
这一点写在文案结语里，否则 agent 会因为判定为非决策而跳过打开。

退化路径：`sidebar_open` 不可用（工具未开启 / 调用失败）时，退化为「给路径」并说明原因。

### 关于⑥（2026-09-11 追加，**能力边界条款**）

用户追加原话：

> 「增加要求，让 agent 判断，当前文档是否已经打开，如果处于打开转给他，帮我关闭，并重新打开」
> 随后澄清：「不要弹提示」

**这个要求按字面做不到。** 我查证了 `dsh-better-sidebar` 源码，三条硬事实：

| # | 事实 | 证据 |
|---|---|---|
| 1 | 模型侧**只有** `sidebar_open`，**没有**关闭文档页签的命令 | 全包 `grep "name: '"` 只有 `sidebar_open` + 8 个 `terminal_*`；`closeTab` 只存在于浏览器侧 service，调用方全是 UI 点击 |
| 2 | 模型**无法查询**哪些页签开着 | 无 list/tabs 类工具；`getSnapshot()` 只在浏览器侧，模型不可达 |
| 3 | 重复 `sidebar_open` 同路径**只聚焦，不刷新** | 页签 id 是 `editor:<绝对路径>`，命中 `openTabInActivePane` 的 id safety net → 直接 `return activateTab(...)`，返回**同一个 tab 对象**；而 tab 单元格 memo 比较 tab 引用（`tab-content-memo.ts`），引用不变 ⇒ 不重渲染、不重新读盘 |

**唯一能真正刷新的路径**是让页签卸载后重建（`closeTab` 之后再 `openFile`，因为 `closeTab` 会 `filter` 掉该页签、编辑器随之卸载）——但 `closeTab` 模型不可达。

**关于「不要弹提示」**：人工刷新按钮在草稿未保存时会 `window.confirm` 弹框
（`EditorHost.tsx` 的 `refreshFile`）；而**打开路径完全不经过 `confirm()`**
（已 grep 确认 `service.ts` / `Sidebar.tsx` 无 confirm 调用）。
所以如果当初按「重开即刷新」的错误理解去写，反而会误导 agent；现在⑥明确：
**不要诱导用户点那个会弹框的刷新按钮**。

因此⑥的落地形态是**诚实边界条款**，而不是假装能做到：

- 照常 `sidebar_open` 打开（保证文档在前台可见）；
- 若怀疑内容陈旧，**如实说明**「重复打开只会聚焦，我没有关闭/刷新页签的权限」，
  并给出用户可执行的替代（手动关页签后我再开 / 告知你看的是旧版）；
- **禁止**谎称刷新成功、**禁止**去找不存在的关闭命令浪费轮次、**禁止**诱导点会弹框的按钮。

> 若将来上游给 `dsh-better-sidebar` 补了 `sidebar_close` / 刷新类工具，⑥可以升级为
> 「自动关闭再重开」。该插件的 `agent-terminals` 推送-对账模式
> （`reconcileAgentTerminals` 按 server 列表差异增删页签）证明它已有 push 驱动的
> 页签移除通道，新增此类工具是该模式的自然延伸。

## 前置依赖：sidebar_open 工具

⑤ 依赖 `dsh-better-sidebar` 插件提供的 `sidebar_open` 工具。该工具**默认关闭**，
需要在 `~/.dsh/settings.yaml` 开启：

```yaml
dsh-better-sidebar:
  agentOpenTools: true
```

开启后 `sidebar_open` 才会注入到模型工具集。它的能力：

- **本地文件** → 侧边栏编辑器打开（同路径已开则聚焦，不重复开 Tab）
- **本地文件夹** → 开一个以该目录为根的文件树窗口
- **http(s) 网页** → 侧边栏内嵌浏览器打开

内容型打开会**自动展开侧边栏面板**（保证落在看得见的地方）；非当前会话的打开会排队，
等该会话侧边栏下次显示时投递。

## 安装 / 挂载

profile 的 `cordis.patch.yml` 里挂桥接，`configPath` 指向本包的 `hooks/hooks.json`：

```yaml
- insert:
    - id: hooks-claude-code
      name: '@deepseek-ai/dsh-hooks-claude-code'
      config:
        configPath: /Users/huzilin/workdir/dsh-plugin/packages/dsh-report-hook/hooks/hooks.json
```

`hooks.json` 里的 command 用**绝对路径**指向 `scripts/report-hook.mjs`。
因为 profile 指的是仓库内的这个文件，**改脚本即生效，无需拷贝或重装**。

改完 `hooks.json` 或桥接配置需要重启 DSH；只改 `report-hook.mjs` 的文案则下次发言即生效。

## 测试

```sh
node --test test/report-hook.test.mjs
```

覆盖：三类命中断言、三类不命中断言、正则误伤边界，以及文案结构断言
（①~⑤ 存在性、`sidebar_open` 与「一般性的文档输出」都在、⑤ 与拍板解耦、未误写 `decision` 字段）。

端到端手测：

```sh
echo '{"prompt":"这个方案要不要拍板？"}' | node scripts/report-hook.mjs   # 应输出注入 JSON
echo '{"prompt":"你好"}' | node scripts/report-hook.mjs                   # 应无输出
```
