---
type: task
blocked_by: []
status: open
---

# 04: prototype 保留平台无关框架、移植上游两块实质点（拍板 D.D2）

**What to build:** 本仓 platform-agnostic 框架（UI.md 三不变量 + 多平台翻译表、SKILL.md/LOGIC.md 的 TUI 路线）保留；从源侧 7 月两次升级移植两块实质点：①When-done 捕获法——用「原型作为 primary source：提交 throwaway 分支、在实现票留 context pointer」替换本仓「Delete or absorb / NOTES.md」段（SKILL.md 末段，源侧 0375c88/cdec9f6 版本为底，措辞去 em-dash 化适配）；②LOGIC.md 补 web 情形形态指引——宿主为 web 时优先「单文件可分享 HTML demo（无安装、非开发者可驱动、domain language 按钮）」（源侧 6bcbcb0 理念），作为平台无关框架内的一种形态选项而非替代 TUI。

**Blocked by:** None — can start immediately

**Source spec:** `.plan/待拍板-skills源同步引入-20260925.md` §待拍板 D

## Acceptance

- [ ] When-done 段换为 primary source 捕获法（throwaway 分支 + context pointer），原 Delete or absorb 措辞清零
- [ ] LOGIC.md 含 web→可分享 HTML demo 的形态指引，平台无关框架（多平台翻译表等）未被删除
- [ ] 零外部引用自查通过；文风与本仓现文一致
- [ ] 跑 `scripts/install-skills.sh` 同步安装态
