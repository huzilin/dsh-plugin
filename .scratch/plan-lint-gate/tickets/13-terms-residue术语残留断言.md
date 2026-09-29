---
type: task
blocked_by: []
status: done 2026-09-29
claimed_by: zcode(dsh-plugin 会话)
---

# 13: terms-residue 术语残留断言（检查[7]，novel 移交方案 C 落地）

**What to build:** novel 2026-09-29 移交（`novel/.tmp/handoffs/2026-09-29-termsweep-into-plan-lint.md`，自包含方案 C）：把术语 sweep 的「验」半收编进 plan-lint——词表驱动、全仓活面、断言「无标记残留=0」；「改」半（sweep 替换动作）留各仓术语 SOP，不进 lint。用户拍板方向原话「我们要在 plugin 项目实现这个工具，我的建议是实现在 plan-lint……调整完成，可以走这个工具确定如何替换。这个可能需要嵌入 domain 的 skills」。用法场景：调整词汇表后跑本检查，得「哪些残留要替换、在哪、哪些是合法留痕不用动」（词表 `=>` 列给替换方向）。

## What to build

1. **`terms_check.py`**（skill scripts/ 新文件，python3 stdlib 只读断言）：词表格式＝词 ／ `词<TAB>标记1|标记2`（本词专属标记，行级豁免）／ `旧词 => 新词`（建议替换方向）／ `@mark`（扩充全局标记集）／ `#` 注释；默认标记集 20＝novel d4() MARKS generalize（去词化，`「…」更名` 由「更名」子串覆盖）；三条防坑（UTF-8 原生枚举、三计数对账不齐即中止、排除区显式清单）；零命中词 ⚠ 硬性警告（词表 typo=静默假绿）；`--self-test` 内置夹具自验。
2. **`plan-lint.sh`** 加 `--terms / --terms-roots` 选项（选项在治理目录前；不带 `--terms` 检查[7]整体跳过；带 `--terms` 且无治理目录时跳过 [1]-[6] 只跑 [7]）；sh 保持唯一入口（2026-09-23 拍板 2A 延续），py 只是检查[7]执行体；发现数经 summary-file 并入总数与退出码（0/1/2 契约不变）。
3. **协议与 skill 文本**：plan-protocol §三 加「术语残留断言」条款（检查语义正本，规则改动先改协议）；plan-approve 步骤 1 补 `--terms` 调用面；GuideView 常见疑问检查清单括注同步。
4. **install-skills.sh**：terms_check.py 随 plan-lint.sh 注入同往 7 个 skill 目录（注入副本按自身目录解析执行体，缺它带 `--terms` 即 exit 2），安装后自检两件齐。

## Acceptance

- [x] `--self-test` 全过（8 项断言：解析/中文文件名/零命中/豁免/排除区/对账/summary/形状）
- [x] 本仓不带 `--terms` 回归零变（76 md 全绿，检查[6] 等既有行为零回归；plain exit=0）
- [x] 带词表实跑（dsh-plugin 冒烟：退役词 `plan-lint.mjs` 冒烟词表一次性不入库——检出 9 处无标记提及（票 01/02 过程文档历史行，exit=1、并账 9 项）、1 命中带「退役」标记豁免、假词 ⚠；本仓未正式采用词表，词表按仓 opt-in）
- [x] novel 真机校准：例② 中文文件名夹具 `docs/验收残留夹具-临时-20260929.md` 检出（92→93→删后复原 92，exit 1）；例③ 假词 ⚠ 出现。**例① 预期不符＝新发现**：移交文档预期「强制定稿 残留 0」，实测全活面 92 处／SOP 双域 23 处（.plan 审批档与 qa 执行记录、qa/fixtures 冻结造数 XML、`protocol_driver.py` d4 自指行）——「09-29 已清干净」在机械断言下不成立，处置（补标记/收窄 roots/退役 d4）归 novel 侧会话，见移交档 §七
- [x] 中文文件名枚举进扫描计数（夹具即中文文件名，事故①回归钉）；`.archive/` 埋残留不扫出（92→93 仅 +1 佐证）；`*.pb.go` 同
- [x] `install-skills.sh` 分发后 7 skill 安装态 plan-lint.sh+terms_check.py 双件齐，与源逐字一致

## 落地注

- 2026-09-29 实施（本会话）。排除区第一版误做「剪一切隐藏目录」（沿 plan-lint.sh 习惯），冒烟即暴露会把必扫活面 `.plan`/`.scratch` 剪掉——改按移交文档 §四.3 名单剪（`.git/.archive/.tmp/.zvec-grep/node_modules`），隐藏只剪文件；教训：泛化规则跨工具搬运前先对正本清单。
- 设计缺口（移交文档未覆盖，novel 侧拍板项）：默认排除区固定、无词表侧扩充机制——qa/fixtures 冻结造数 XML 若判「合法留痕」无处登记，只能收窄 `--terms-roots`。不扩机制（YAGNI），novel 首版词表落盘时若确需再说。
- 退出码实测：有发现=1（并账 9/92）、干净=0、未知选项=2、词表缺文件=2。
- 「plan-lint 不管 qa」裁定（2026-09-20）不与本检查冲突：该裁定管 qa 文档不作票形态校验对象；检查[7] 对 qa 活面只做术语 grep，不碰形态。novel 参考域清单含 qa 系移交文档自带口径。
