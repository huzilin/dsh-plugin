---
name: prototype
description: Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like.
---

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## 本仓落点契约（2026-10-04 拍板；偏离 mp 原版处，其余逐字保留）

**mp 原版**把原型代码放在「真实使用位置旁边」（UI 原型嵌进项目前端工程的路由/页面）。**本仓改造为 effort 治理形态**：

- **产物一律落 effort 原型目录 `.scratch/<effort-slug>/prototype/`**（effort 目录白名单成员，随 effort 整轮归档；无 effort 归属的独立原型不落此目录）。
- **UI 原型＝自包含单文件 html**（inline CSS/JS，零外部依赖，浏览器直接打开），**不挂接当前项目的前端工程**——mp 原版 sub-shape A（嵌现有页面）在本仓退役；多变体切换保留（`#variant=` hash 切换＋底部浮动切换条，`file://` 下可用）。
- **引用形态**：spec／票面按相对路径引用 `prototype/<name>.html`（「挂到 spec」）；plan-view 的 effort「原型」tab 展示该目录内 html（视图侧 = plan-lint-gate 票 24）。
- **判定完成后**：胜出决策回填 spec/ADR（口径变更走 E' 销号分流），原型文件**随 effort 归档留痕不删**——「delete or absorb」的 absorb 落在决策文档，文件本体归档即出视图。

LOGIC 分支（终端状态机原型）产物同样落 `prototype/`（脚本＋README 同置）；「logic module 可移植、TUI 壳用后即弃」的 mp 原版纪律不变。

## Pick a branch

Identify which question is being answered — from the user's prompt, the surrounding code, or by asking if the user is around:

- **"Does this logic / state model feel right?"** → [LOGIC.md](LOGIC.md). Build a tiny interactive terminal app that pushes the state machine through cases that are hard to reason about on paper.
- **"What should this look like?"** → [UI.md](UI.md). Generate several radically different UI variations behind a single entry point, switchable at runtime.

The two branches produce very different artifacts — getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default to whichever branch better matches the surrounding code (a backend module → logic; a page, screen, or view → UI) and state the assumption at the top of the prototype.

## Rules that apply to both

1. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used (next to the module or page it's prototyping for) so context is obvious — but name it so a casual reader can see it's a prototype, not production. For throwaway UI routes or screens, obey whatever structural convention the project already uses; don't invent a new top-level structure. **（本仓例外：产物统一落 effort 的 `prototype/` 目录，见「本仓落点契约」——context 由 effort 归属承载，不靠物理毗邻。）**
2. **One command to run.** Whatever the project's existing task runner supports — `make <name>`, `pnpm <name>`, `python <path>`, `cargo run --bin <name>`, `mix run <path>`, etc. The user must be able to start it without thinking.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE — wipe me" name.
4. **Skip the polish.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast and then delete it.
5. **Surface the state.** After every action (logic) or on every variant switch (UI), print or render the full relevant state so the user can see what changed.
6. **Delete or absorb when done.** When the prototype has answered its question, either delete it or fold the validated decision into the real code — don't leave it rotting in the repo.

## When done

The _answer_ is the only thing worth keeping from a prototype. Capture it somewhere durable (commit message, ADR, spec, or a `NOTES.md` next to the prototype) along with the question it was answering. If the user is around, that capture is a quick conversation; if not, leave the placeholder so they (or you, on the next pass) can fill in the verdict before deleting the prototype.
