# UI Prototype

Generate **several radically different UI variations** behind a single entry point, switchable at runtime. The user flips between variants, picks one (or steals bits from each), then throws the rest away.

If the question is about logic/state rather than what something looks like — wrong branch. Use [LOGIC.md](LOGIC.md).

## When this is the right shape

- "What should this page look like?"
- "I want to see a few options for this dashboard before committing."
- "Try a different layout for the settings screen."
- Any time the user would otherwise spend a day picking between three vague mockups in their head.

## The pattern, independent of platform

Three invariants define a UI prototype whatever the UI technology:

1. **All variants live behind one entry point** — the same page, screen, window, or view; only the rendering differs.
2. **Switching is cheap and stateless** — a URL param, CLI flag, env var, or bound key; the current variant is visible and shareable/reproducible.
3. **The switcher is obviously not part of the design** — visually distinct, and impossible to ship to production by accident.

The sections below spell this out for the web, the most common case. For other platforms, translate the same invariants:

- **TUI apps** — select the variant with a `--variant=B` flag, or cycle live with a bound key (e.g. `F2` / `v`); render the current variant's key and name in a corner of the frame.
- **Desktop apps (native/GUI toolkits)** — an env var read at startup, or a debug-menu item / keyboard shortcut that swaps the view at runtime; show the variant label in the window title.
- **Games / graphics** — a debug key cycles variants; draw the variant label as an overlay.
- **CLI output formatting** — a `--variant` flag; if the output is short, render all variants in one run, clearly labelled, for side-by-side comparison.

In every case, gate the switcher behind the project's debug/dev mechanism (a build flag, `#ifdef`, env check) so it can't reach production.

## 本仓形态：独立自包含单文件 html

原型不得挂接当前项目的前端工程（路由/页面），一律生成**自包含单文件 html**（inline CSS/JS、零外部依赖、浏览器双击直开），落 `.scratch/<effort-slug>/prototype/<name>.html`。

三条不变式全部保留，宿主为单文件：

1. **All variants live behind one entry point** — 一个 html 文件即全部变体。
2. **Switching is cheap and stateless** — `#variant=b` hash 切换（`file://` 下 query/search 与 hash 均可读，hash 免刷新、可分享、reload 稳定）；切换条显示当前变体名。
3. **The switcher is obviously not part of the design** — 底部浮动高对比切换条照旧（键盘 ←/→ 行为保留；「production gate」在独立 html 下不适用——它本来就永远不进工程构建）。

**单文件多变体骨架**（原生 JS，不用框架；变体可以是纯 CSS 换肤、也可以是 DOM 结构级差异）：

```html
<!-- prototype/three-step-flow.html — 三变体：分步布局 A/B/C，#variant= 切换 -->
<style> /* 全部样式 inline */ </style>
<main id="app"></main>
<nav id="switcher" style="position:fixed;bottom:16px;left:50%;transform:translateX(-50%)">
  <!-- ← A — 分步向导 →   高对比 pill，明显不属于设计本体 -->
</nav>
<script>
  const VARIANTS = { a: renderWizard, b: renderSingleColumn, c: renderTabs };
  const current = () => (location.hash.match(/variant=(\w)/) ?? [,'a'])[1];
  function render() { VARIANTS[current()](document.getElementById('app')); }
  addEventListener('hashchange', render); render();
</script>
```

「butting up against the rest of the app」的告诫（真空环境看不出密度问题）以**造数**方式补偿：html 内置贴近真实的假数据量（表格 20 行而非 3 行、真实长度的中文文案），别用 lorem ipsum。

非 web 平台（TUI/桌面/游戏）的翻译表不变——本仓形态只改 web 宿主。

## Process

### 1. State the question and pick N

Default to **3 variants**. More than 5 stops being radically different and starts being noise — cap there.

Write down the plan in one line, in the prototype's location or a top-of-file comment:

> "Three variants of the settings page, switchable via `?variant=`, on the existing `/settings` route."

This works whether the user is here to push back or not.

### 2. Generate radically different variants

Draft each variant. Hold each one to:

- The page's purpose and the data it has access to.
- The project's component library / styling system (TailwindCSS, shadcn, MUI, plain CSS, a TUI widget library, whatever).
- A clear exported component name, e.g. `VariantA`, `VariantB`, `VariantC`.

Variants must be **structurally different** — different layout, different information hierarchy, different primary affordance, not just different colours. Three slightly-tweaked card grids isn't a UI prototype, it's wallpaper. If two drafts come out too similar, redo one with explicit "do not use a card grid" guidance.

### 3. Wire them together

用上面的**单文件多变体骨架**把变体接进一个 html：`VARIANTS` 表注册各变体渲染函数，hash 驱动切换，切换条调 `location.hash`。变体间共享的数据/文案直接写在文件顶部的 `DATA` 常量里——自包含单文件没有外部 fetch。

### 4. Build the floating switcher

A small fixed-position bar at the bottom-centre of the screen with three pieces:

- **Left arrow** — cycles to the previous variant (wraps around).
- **Variant label** — shows the current variant key and, if the variant exports a name, that name too. e.g. `B — Sidebar layout`.
- **Right arrow** — cycles forward (wraps around).

Behaviour:

- Clicking an arrow updates the URL search param (use the framework's router — `router.replace` on Next, `navigate` on React Router, etc) so the variant is shareable and reload-stable.
- Keyboard: `←` and `→` arrow keys also cycle. Don't intercept arrow keys when an `<input>`, `<textarea>`, or `[contenteditable]` is focused.
- Visually distinct from the page (e.g. high-contrast pill, subtle shadow) so it's obviously not part of the design being evaluated.
- **Production gate**：独立 html 不进任何工程构建，无 production 泄漏面，无需 `NODE_ENV` 门控。（非 web 平台照旧走各自的 debug 门控。）

Put the switcher in a single shared component so both sub-shapes can reuse it. Locate it wherever shared UI lives in the project.

On non-web platforms the switcher shrinks to whatever the platform affords — a key binding plus a visible variant label is a complete switcher for a TUI or game. Keep the invariants: cheap to cycle, current variant always visible, never shippable.

### 5. Hand it over

Surface the URL (and the `?variant=` keys) — or the flag/key binding on other platforms. The user will flip through whenever they get to it. The interesting feedback is usually **"I want the header from B with the sidebar from C"** — that's the actual design they want.

### 6. Capture the answer and clean up

Once a variant has won, write down which one and why (commit message, ADR, spec, or a `NOTES.md` next to the prototype if running AFK and the user hasn't responded yet). Then, per the Effort 落点契约（SKILL.md）:

- **胜出决策**回填 spec/ADR——口径变更走销号分流，spec 引用胜出变体（`prototype/<name>.html` 相对路径＋`#variant=` 键）。
- **原型文件不删**：随 effort 归档留痕（归档即出视图）；删除落选变体与切换器的 cleanup 由**文件本体整体归档**承担——单文件多变体形态下变体共居一文件，无「落选变体散落工程」的腐烂面。

## Anti-patterns

- **Variants that differ only in colour or copy.** That's a tweak, not a prototype. Real variants disagree about structure.
- **Sharing too much code between variants.** A shared `<Header>` is fine; a shared `<Layout>` defeats the point. Each variant should be free to throw out the layout.
- **Wiring variants to real mutations.** Read-only prototypes are fine. If a variant needs to mutate, point it at a stub — the question is "what should this look like", not "does the backend work".
- **Promoting the prototype directly to production.** The variant code was written under prototype constraints (no tests, minimal error handling). Rewrite it properly when you fold it in.
