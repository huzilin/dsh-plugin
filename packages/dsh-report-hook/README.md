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

### 已退役：⑤⑥ 侧边栏条款（2026-09-27 用户要求整条删除）

原⑤（文档一律用 `sidebar_open` 在侧边栏打开）与原⑥（已打开文档的刷新语义）
**已按用户要求整条删除，不再注入**。删除的是**条款本身**，不是能力——`sidebar_open`
工具是否可用由 `dsh-better-sidebar` 的 `agentOpenTools` 开关决定，与本 hook 无关。

下列查证结论**保留备查**（若将来要恢复该条款，先看这段，勿凭想象重写）：

| # | 事实 | 证据 |
|---|---|---|
| 1 | 模型侧**只有** `sidebar_open`，**没有**关闭文档页签的命令 | 全包 `grep "name: '"` 只有 `sidebar_open` + 8 个 `terminal_*`；`closeTab` 只存在于浏览器侧 service，调用方全是 UI 点击 |
| 2 | 模型**无法查询**哪些页签开着 | 无 list/tabs 类工具；`getSnapshot()` 只在浏览器侧，模型不可达 |
| 3 | 重复 `sidebar_open` 同路径**只聚焦，不刷新** | 页签 id 是 `editor:<绝对路径>`，命中 `openTabInActivePane` 的 id safety net → 直接 `return activateTab(...)`，返回**同一个 tab 对象**；而 tab 单元格 memo 比较 tab 引用（`tab-content-memo.ts`），引用不变 ⇒ 不重渲染、不重新读盘 |

**结论**：用户当时「关掉再重开以刷新」的诉求在模型侧**做不到**（`closeTab` 模型不可达）。
将来若要恢复条款，须先给 `dsh-better-sidebar` 补上 `sidebar_close` / 刷新类工具——
该插件的 `agent-terminals` 推送-对账模式（`reconcileAgentTerminals` 按 server 列表
差异增删页签）证明它已有 push 驱动的页签移除通道，新增此类工具是该模式的自然延伸。

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
（①~④ 存在性、未误写 `decision` 字段，以及**退役负向断言**——⑤⑥ 侧边栏条款
不得再出现在注入文案里，防止被误恢复而无人察觉）。

端到端手测：

```sh
echo '{"prompt":"这个方案要不要拍板？"}' | node scripts/report-hook.mjs   # 应输出注入 JSON
echo '{"prompt":"你好"}' | node scripts/report-hook.mjs                   # 应无输出
```
