# ponytail 为什么没被触发：诊断与最佳实践

> 编制日期：2026-09-15
> 证据来源：skill-doctor 本次 DSH 报告运行（11 份会话样本）+ ponytail 技能原文 + DSH 技能注入机制源码/实测

---

## 一、先给结论

`ponytail` 没被用过，**不是因为它写得不好，也不是因为它的触发描述写错了**。它的描述里明明写着 "Use on ANY coding task"，写得相当激进。

真正的原因是三件事叠加：

1. **它的触发条件太"泛"，泛到等于没有抓手**。"ANY coding task" 覆盖了几乎所有会话，但模型没有理由在一个具体任务里去加载一个"什么都能用"的技能——泛化的触发描述反而不触发，这是技能设计里最常见的失败模式。
2. **DSH 注入的技能目录只给名字 + 一段截断的描述**。模型在会话里看到的不是你写的完整描述，而是一个被截断的摘要（详见第三节实测）。截断之后，"Use on ANY coding task" 这半句的关键触发语**可能根本没进模型视野**。
3. **没有任何强制机制**。技能是"模型可以调用"的能力，不是"每轮必须生效"的规则。对比你的 `~/.dsh/AGENTS.md`——那个是每轮无条件注入的，所以它 100% 生效。

**一句话**：`ponytail` 现在是"可选建议"，而你期望的是"常驻纪律"。这是**机制错配**，改描述解决不了。

---

## 二、实测：它到底有没有被调用

**性质：实测。** 本次 11 份会话样本中：

| 指标 | 值 |
|---|---|
| `ponytail` 被调用次数 | **0** |
| 出现的唯一匹配 | 1 次，在 `9f5b6393` 会话中 |
| 该匹配的性质 | 模型在**朗读技能清单**找 `wayfinder-maps`，`ponytail` 只是被念到的名字 |

原文（`9f5b6393` 会话，模型自述）：
> let me re-check the available skills in this session's reminder: a11y-review, archify, ... migrate-to-shoehorn, **ponytail**, prototype, ...

这是模型在**清点目录**，不是调用。

对照本次样本里真正被触发的技能：

| 技能 | 触发会话数 |
|---|---|
| `caveman` | 3 |
| `dsh-knowledge` | 2 |
| `skill-doctor` | 2 |
| `mp-wayfinder` | 1 |
| `mp-prototype` | 1 |

**注意这个对照很有信息量**：`caveman` 触发了 3 次，`ponytail` 0 次。两者都是"改变做事风格"的技能，差别在哪？见下一节。

---

## 三、根因分析

### 根因 1：描述被截断（实测）

**性质：实测。** DSH 注入到会话里的技能目录，`ponytail` 条目实际是（从本次会话日志中提取的原文）：

```
- `ponytail`: Forces the laziest solution that actually works, simplest, shortest, most
  minimal. Channels a senior dev who has seen everything: question whether the task needs
  to exist at all (YAGNI), reach for the standard library before custom code, native
  platform features before dependencies, one line before fifty. Supports intensity levels:
  lite, full (default), ultra. Use on ANY coding task: writing, add
```

**结尾停在 "writing, add" —— 后面那半句 "Also use whenever the user says 'ponytail', 'be lazy', 'lazy mode'... or complains about over-engineering" 整个被截掉了。**

那句被截掉的话，恰恰是**最有效的触发器**——"当你抱怨过度设计时就用我"。模型看不到它。

**对比 `caveman`**（触发 3 次）：它的描述 652 字符，比 ponytail 的 886 字符**更短**，所以更可能完整进入模型视野。这不是巧合。

> 关于截断阈值：本次实测确认了"会发生截断"这一事实与截断位置，但**未逐行核实 DSH 源码里的具体字符阈值**，也未确认它是按字符还是按 token 截断。性质：**截断事实为实测，截断规则为推断**。

### 根因 2：「ANY coding task」是无效触发器（推断）

**性质：我的推断**（基于本次样本，样本量 11）。

技能要能触发，触发描述必须能回答一个问题：**"在什么具体时刻，我应该停下来加载它？"**

- `caveman` 能触发，因为它的触发是**明确的用户意图**——"less tokens"、"be brief"、用户显式要求省 token。这是一个**可观测的事件**。
- `ponytail` 要触发，需要模型在**每一个编码任务开始时**主动判断"这个任务适用懒惰原则"。但 "ANY coding task" 意味着"永远适用"，而"永远适用"在模型那里等于**没有决策点**——没有决策点就不会触发加载。

这是反直觉但常见的规律：**触发描述越宽，越不触发**。宽到覆盖一切的触发器，模型无法把它和"默认行为"区分开，于是它退化成了背景噪音。

### 根因 3：技能 ≠ 纪律（实测）

**性质：实测。** `ponytail` 挂在 `~/.dsh/.agent-presets/full/skills/` 下，走 DSH 的技能发现机制（rank 300，`customSkillDirs`）。技能机制的本质是**模型可选择调用的能力**。

而你的 `~/.dsh/AGENTS.md` 走的是 `agent-instructions` 插件——**每轮无条件注入**。所以：

| | 注入方式 | 生效保证 |
|---|---|---|
| `~/.dsh/AGENTS.md` 的约束 | 每轮强制注入 | **100%** |
| `ponytail` 技能 | 目录里列一个条目，模型自行决定是否加载 | **不确定** |

你自己在 AGENTS.md 里对"响应协议"、"汇报规范"这类**必须每轮生效**的规则，用的就是强制注入而不是技能——这个判断是对的。`ponytail` 的诉求（"ACTIVE EVERY RESPONSE"）与技能机制**天然矛盾**：

> ponytail 原文：`Persistence: ACTIVE EVERY RESPONSE. No drift back to over-building. Still active if unsure.`

**它自己要求"每轮生效"，但它被装在了一个"按需加载"的机制里。** 这不是使用姿势问题，是装载位置错了。

---

## 四、最佳实践：三条路，按可靠性排序

### 方案一：把 ponytail 的**纪律部分**上移到 `~/.dsh/AGENTS.md`（最可靠）

**做法**：不搬全文，只把**红线**变成常驻条款，与 `ponytail` 技能**共存**——AGENTS.md 放"什么时候必须想起来"，技能放"具体怎么做"。

这与你现有的架构**完全一致**。你的 AGENTS.md 开头就写着：

> 常驻注入的关键纪律指针。全文正本在各记忆库；此处只放**触发条件 + 红线**，**不复制正文**。本条是红线索引，不是正本。

按这个既有模式，可以加一段（示意）：

```markdown
## 编码纪律（每次改代码必触发）

正本：skill `ponytail`（强度 full）。红线：
1. **先问"这个要存在吗"**：投机性需求一律不做，一行说明拒绝理由。
2. **先看仓库里有没有**：复用既有 helper/type/pattern，重复实现是最常见的垃圾。
3. **stdlib → 原生特性 → 已装依赖 → 一行 → 最小实现**（阶梯顺序）。
4. **不主动加抽象**：单实现的接口、单产品的工厂、永不变化的配置项，都不加。
5. **删优于增**，最短可用 diff 胜出（但必须先理解问题）。
6. **输出克制**：代码优先，最多三行说明跳过了什么、何时该加。
```

**代价**：AGENTS.md 变长（你之前刚为它"太大"做过瘦身）。**收益**：从"不确定生效"变成"100% 生效"。

### 方案二：修描述，给它一个**具体决策点**（次可靠，但成本最低）

**做法**：把泛化的 "ANY coding task" 换成**可观测的触发时刻**。参考 `caveman` 的成功模式——触发词是用户能说出来的具体话。

建议改法（示意，不是最终稿）：

```yaml
description: >
  Forces the laziest solution that actually works...
  Use BEFORE writing any new code — before adding a dependency, before creating a new
  file, before writing a helper, and whenever the user says "ponytail", "be lazy",
  "lazy mode", "simplest solution", "yagni", or complains about over-engineering,
  bloat, boilerplate, or unnecessary dependencies.
```

关键改动：**"Use on ANY coding task" → "Use BEFORE writing any new code（具体动作 + 具体时刻）"**。

**代价**：仍然不能保证生效（方案三的问题依然存在），且描述变长**可能加剧截断**——必须把最关键的话放**最前面**。

> ⚠️ 这里有个反直觉的取舍：描述越长，越容易被截断；而截断点靠后，意味着**放在末尾的触发词等于没写**。当前 ponytail 把最好的触发词（"complains about over-engineering"）放在最末尾，正好是最容易被截掉的位置。**若走方案二，必须把用户触发词前移。**

### 方案三：把它改成 hook（最强制，但最重）

**做法**：DSH 有 hook 机制（你自己写过"汇报规范自动提醒"插件）。可以做一个 hook，在检测到写文件的工具调用时，自动注入 ponytail 的核心几条。

**代价**：需要开发维护一个插件，且每轮注入会持续消耗上下文预算。**除非方案一不够用，否则不建议**——方案一已经能达到同样的"每轮生效"效果，成本低得多。

---

## 五、我的建议

**方案一 + 方案二 组合，优先级明确：**

1. **先做方案一**（AGENTS.md 加编码纪律红线段）。这是唯一能**保证生效**的做法，且与你既有架构一致。
2. **再做方案二**（修描述，把触发词前移）。让技能在"用户显式抱怨过度设计"时也能被单独唤起，作为方案一的补充。
3. **方案三先不做**。等前两条跑一段时间，用 skill-doctor 复测触发率再决定。

---

## 六、一个可复用的迁移清单

本次诊断暴露的问题**不止 ponytail 一个**。同一份报告显示，`skills_used` 是 5/51——**其余 46 个技能在本次样本里触发率也是 0**，包括你很可能期望常驻的：

| 技能 | 本次触发 | 问题性质 |
|---|---|---|
| `ponytail` | 0 | 触发太泛 + 要求每轮生效 |
| `test-protocol` | 0 | 需确认是"没遇到场景"还是"触发词不灵" |
| `test-design-gate` | 0 | 同上 |
| `semantica-decision` | 0 | 同上 |

**建议的复测方法**（避免拍脑袋）：

1. 先在本次报告的基础上，扩样到 `--all-conversations` 或指定多个仓库，看这些技能在**更大样本**里的触发率——现在 11 份样本里全是 0，**不足以区分"触发设计有问题"和"样本里确实没遇到适用场景"**。
2. 对确认为 0 且**应该**触发的技能，逐个判断属于哪一类：**触发太泛**（改描述）/ **要求每轮生效**（上移 AGENTS.md）/ **场景确实没出现**（不用动）。

**性质说明**：本表"本次触发"列为实测；"问题性质"列中，`ponytail` 那行已在前文论证，`test-protocol`/`test-design-gate`/`semantica-decision` 三行**仅为待查项，我尚未分析它们的描述与样本场景**，不得当作已确诊的结论。
