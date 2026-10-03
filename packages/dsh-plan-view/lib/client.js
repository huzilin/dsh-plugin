window.__ModuleLoader__.load({
	id: "dsh-plan-view",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/api.ts
		async function planView(method, payload) {
			const resp = await fetch(`/plan-view/${method}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload)
			});
			const parsed = await resp.json();
			if (!resp.ok || parsed?.ok !== true) throw new Error(parsed?.error?.message ?? `HTTP ${resp.status}`);
			return parsed.value;
		}
		/** Load the whole governance view in one request. cwd comes back server-resolved. */
		function snapshot(sessionId, round) {
			return planView("snapshot", round === void 0 ? { sessionId } : {
				sessionId,
				round
			});
		}
		/**
		* B1 binding write-back: upsert one frontmatter key on a ticket file. The
		* server does read-modify-write atomically, so the client never needs the
		* file's current content (fsRead left with the better-sidebar decoupling).
		*/
		function bindTicket(sessionId, path, key, value) {
			return planView("write", {
				sessionId,
				path,
				key,
				value
			});
		}
		async function rpc(method, args) {
			const resp = await fetch(`/api/${method}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					type: "client-request",
					rpcId: crypto.randomUUID(),
					method,
					payload: { args }
				})
			});
			const full = await resp.json();
			if (!resp.ok || full.result?.ok !== true) throw new Error(full.result?.error?.message ?? `HTTP ${resp.status}`);
			return full.result.value;
		}
		async function sessionList() {
			return (await rpc("session/list", { _request: {} })).items;
		}
		/** E1 liveness probe: find the session in the list, undefined when absent. */
		async function sessionAlive(sessionId) {
			return (await sessionList()).find((s) => s.sessionId === sessionId);
		}
		//#endregion
		//#region src/client/input-bridge.ts
		/**
		* 输入桥：把宿主输入区的草稿写入能力（setDraft）捕获成按钮可调用的 injector。
		*
		* 机制参考 dsh-mattpocock-skills-deck 的 StatusBar（MIT）：在 `conversation.input.dock`
		* 槽位挂一个不渲染任何东西的组件，宿主向该槽位组件传 `props.inputActions.setDraft`
		* （往当前会话输入框填文字）和 `props.sessionId`。组件把 setDraft 按会话 id 登记进
		* 模块级注入表；跨会话用 pendingDraft 交接——调用方把草稿挂到目标会话名下再切过去
		* （`sessions.open`），输入区随会话切换重新挂载时把交接草稿消费掉。
		*
		* 按钮语义因此是「草稿优先」：点按钮只把指令填进输入框，人确认后再发送，不静默派活。
		* 宿主没提供 setDraft 时由调用方兜底（复制到剪贴板）。
		*/
		/** 每个已挂载输入区（= 当前打开的会话）的 setDraft，按会话 id 登记。 */
		const setters = /* @__PURE__ */ new Map();
		/** 跨会话交接：草稿正文 + 目标会话。目标会话的输入区挂载时消费一次。 */
		let pendingDraft = null;
		let pendingTarget = null;
		/**
		* 输入桥组件本体。挂在 `conversation.input.dock` 槽位，不渲染任何可见物。
		* @param props - 宿主传入；只消费 `sessionId` 与 `inputActions.setDraft`。
		*/
		function InputBridge(props) {
			const sid = props.sessionId;
			const set = props.inputActions?.setDraft;
			(0, react.useEffect)(() => {
				if (sid === void 0 || typeof set !== "function") return;
				setters.set(sid, set);
				if (pendingDraft !== null && pendingTarget === sid) {
					const text = pendingDraft;
					pendingDraft = null;
					pendingTarget = null;
					set(text);
				}
				return () => {
					if (setters.get(sid) === set) setters.delete(sid);
				};
			}, [sid, set]);
			return null;
		}
		/**
		* 目标会话的输入桥是否已就绪（该会话的输入区已挂载、setDraft 已登记）。
		* `deliverDraft` 返回 `'queued'` 后调用方据此判断交接草稿是否已被消费。
		*/
		function isBridged(sessionId) {
			return setters.has(sessionId);
		}
		/**
		* 把草稿送进目标会话的输入框。
		* @returns `'injected'` 目标会话正开着，已排入立即填入（宿主 setDraft 在宏任务里
		* 触发——实测它可能同步挂死，绝不能留在调用方的 await 链上）；`'queued'` 已挂成
		* 交接草稿，调用方须随后 `sessions.open(sessionId)` 切过去，输入区重挂时自动消费。
		*/
		function deliverDraft(sessionId, text) {
			const set = setters.get(sessionId);
			if (set !== void 0) {
				setTimeout(() => {
					try {
						set(text);
					} catch {}
				}, 0);
				return "injected";
			}
			pendingDraft = text;
			pendingTarget = sessionId;
			return "queued";
		}
		/**
		* 注册输入桥槽位。
		* @param ctx - 客户端根上下文（需已注入 `slots`）。
		* @returns 注销函数；槽位不可用时返回空操作（桥挂不上不应拖垮整个插件）。
		*/
		function registerInputBridge(ctx) {
			try {
				return ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
					name: "conversation.input.dock",
					id: "dsh-plan-view:input-bridge",
					order: 60,
					registrant: "dsh-plan-view"
				}, InputBridge));
			} catch {
				return () => {};
			}
		}
		//#endregion
		//#region src/client/file-path.ts
		/**
		* 票面文件路径的两个纯函数：①按会话地址化（点击打开用）；②按工作区相对化
		* （页面显示用）。抽出来是因为渲染点有十来个，各写一遍必然漂移；且本模块
		* 无 React、无 DOM，可直接被 `node --test` 加载（见 `test/file-path.test.js`）。
		*
		* 地址形态镜像官方 `@deepseek-ai/dsh-util-workspace-path` 的 `sessionFileAddress`：
		* `dsh-resource://file/session/<sessionId>/<path>`，路径段逐段百分号编码。
		* 不直接依赖该包——本插件自包含（零运行时依赖，见 api.ts 同款取舍），而地址
		* 语法是右侧栏契约的一部分，宿主换语法时全站一起换，此处不是唯一的耦合点。
		*
		* **绝对路径在地址里带前导空段**（`…/session/<id>//Users/…`）——这不是笔误，
		* 是官方语法：`parseFileAddress` 靠那个空段把路径还原成绝对形式。视图显示的是
		* 相对工作区的短路径（见 `displayPath`），所以常态下不出现；仓外文件才走这条。
		*/
		/** 编码一个路径段：保留 `:` 字面量，让 Windows 盘符读起来仍是原样。 */
		const encodeSegment = (segment) => encodeURIComponent(segment).replace(/%3A/gi, ":");
		/**
		* 一个文件在某个会话下的资源地址——与聊天里 `@文件`、文件树点开是同一条地址，
		* 右侧栏据此路由到文本预览类型。
		*
		* 传进来的路径本就可相对或绝对：绝对路径的地址里保留一个前导空段（官方语法），
		* 相对路径则原样拼在会话 id 后。
		* @param sessionId - 读取该文件的会话 id。
		* @param path - 绝对路径，或相对该会话工作目录的路径。
		* @returns `dsh-resource://file/session/<sessionId>/<path>` 地址。
		*/
		function fileAddress(sessionId, path) {
			const encoded = path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").split("/").map(encodeSegment).join("/");
			return `dsh-resource://file/session/${encodeSegment(sessionId)}/${encoded}`;
		}
		/**
		* 页面显示用的路径：在工作目录内显示相对形式（`.scratch/<effort>/issues/14-….md`），
		* 仓外路径原样显示（绝对路径）——相对化只为好读，不改变它指向的文件。
		* @param path - 文件的绝对路径（或已相对的路径）。
		* @param cwd - 会话工作目录；未知则原样返回。
		* @returns 显示路径。
		*/
		function displayPath(path, cwd) {
			const normalized = path.replace(/\\/g, "/");
			const root = cwd?.replace(/\\/g, "/").replace(/\/+$/, "");
			if (root === void 0 || root === "") return normalized;
			if (normalized === root) return ".";
			return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized;
		}
		/**
		* 票面 `assets:` 引用是否指向这个资产文件（推演产物三视图归组用，票 21）。
		* 票面按契约写 repo-relative（`.scratch/<slug>/assets/x.md`，实测也有缺 `.scratch/`
		* 前缀、带 `./`、写裸文件名的形态），收集到的是绝对路径——归一成相对 cwd 比较
		* 相等，再兜底 `assets/` 之后的尾段比对（裸文件名跨 effort 撞名属票作者自担的歧义）。
		* @param absPath - 收集到的资产文件绝对路径。
		* @param ref - 票面 `assets:` 数组里的一条引用，按写入原形。
		* @param cwd - 会话工作目录；未知则退化为整串比对。
		*/
		function sameAssetRef(absPath, ref, cwd) {
			const r = ref.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
			if (r === "") return false;
			const abs = absPath.replace(/\\/g, "/");
			if (r === abs || r === displayPath(abs, cwd)) return true;
			const tail = abs.split("/assets/").pop();
			const rTail = r.split("/assets/").pop();
			return tail !== void 0 && rTail === tail;
		}
		//#endregion
		//#region src/client/PlanView.tsx
		/**
		* Plan view v2: reads the governance roots (.scratch/ — all efforts, tracker
		* layout + .plan/ — global only: approval/ & global qa/ledger, never an
		* effort), derives ticket status per the TRACKER-MARKDOWN
		* contract, and renders the tabbed surface:
		*   总览 · 地图（Kanban / Table / Relation DAG ＋ map/spec 正文子页）· 测例 ·
		*   缺陷 · 台账 · ADR · CONTEXT · 说明（2026-09-30 读取契约拍版）
		*
		* All views share a unified dark theme and markdown-rendered detail panels.
		* Self-contained: uses its own api module, inline styles, zero CSS deps.
		*/
		function parseFrontmatter(raw) {
			const fm = {};
			let body = raw;
			const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
			if (m && m[1] != null) {
				for (const line of m[1].split("\n")) {
					const kv = line.match(/^([^:]+):\s*(.*)$/);
					if (kv?.[1] != null && kv?.[2] != null) fm[kv[1].trim()] = kv[2].trim();
				}
				body = m[2] ?? "";
			}
			return {
				fm,
				body
			};
		}
		/** Read a `**Label:** value` line from the document body (2026-10-02 carrier move).
		*  Fence-aware: a ticket quoting the format must not thereby declare a status.
		*  Returns undefined when the line is absent, so callers can fall back to
		*  frontmatter for documents written before the migration. */
		function bodyField(body, label) {
			const re = new RegExp(`^\\s*(?:[-*>]\\s*)?\\*\\*${label}:\\*\\*\\s*(.+?)\\s*$`, "im");
			for (const seg of stripFences(body).split(/\n\s*\n/)) {
				const m = seg.match(re);
				if (m?.[1] !== void 0) return m[1].replace(/[*`]/g, "").trim();
			}
		}
		function deriveTicketStatus(file, raw) {
			const { fm, body } = parseFrontmatter(raw);
			const titleMatch = raw.match(/^#\s+(.+)$/m);
			const t = {
				id: ticketId(file),
				file,
				title: titleMatch?.[1]?.replace(/`[^`]*`/g, "")?.trim() ?? file,
				type: fm.type,
				blockedBy: parseBlockedBy(bodyField(body, "Blocked by") ?? fm.blocked_by),
				assets: parseAssetRefs(fm.assets),
				done: false,
				outOfScope: false,
				claimedBy: fm.claimed_by,
				status: bodyField(body, "Status") ?? fm.status,
				date: fm.date,
				origin: fm.origin,
				session: fm.session,
				originSession: fm["origin_session"],
				body,
				qaCases: fm.qa_cases === "true",
				qaTested: fm.qa_tested === "true",
				qaAccepted: fm.qa_accepted === "true"
			};
			const st = displayStatus(t);
			t.done = st === "done";
			t.outOfScope = st === "out_of_scope";
			return t;
		}
		function stripFences(body) {
			const out = [];
			let fence = null;
			for (const line of body.split("\n")) {
				const m = line.match(/^\s*(```+|~~~+)/);
				if (fence === null) {
					if (m) {
						fence = m[1][0] ?? "`";
						out.push("");
					} else out.push(line);
				} else {
					if (m && m[1][0] === fence) fence = null;
					out.push("");
				}
			}
			return out.join("\n");
		}
		function hasSection(body, name) {
			const heading = `## ${name}`;
			const re = new RegExp(`^${heading}\\b`, "m");
			const segOf = (text) => {
				const m = re.exec(text);
				if (!m || m.index === void 0) return null;
				const after = text.slice(m.index + m[0].length);
				const stop = after.search(/^## /m);
				return stop >= 0 ? after.slice(0, stop) : after;
			};
			const seg = segOf(stripFences(body));
			if (seg !== null && /\n\S/.test(seg)) return true;
			const rawSeg = segOf(body);
			if (seg !== null && rawSeg !== null && /^\s*\n\s*(```|~~~)/.test(rawSeg)) return true;
			return false;
		}
		function statusWord(t) {
			const raw = (t.status ?? "").trim().toLowerCase();
			if (raw.startsWith("superseded-by")) return "superseded";
			return raw.split(/[\s(#:—-]/)[0] ?? "";
		}
		function displayStatus(t) {
			if (hasSection(t.body, "Answer")) return "done";
			if (hasSection(t.body, "Ruled out")) return "out_of_scope";
			const w = (t.status ?? "").trim().toLowerCase().split(/[\s(#:—-]/)[0];
			if (w === "resolved" || w === "done" || w === "closed") return "done";
			if (w === "claimed" || t.claimedBy) return "claimed";
			return "open";
		}
		function ticketId(file) {
			return file.replace(/\.md$/i, "");
		}
		function shortId(t) {
			return (t.id.match(/^([A-Za-z]*\d+)/)?.[1] ?? t.id).slice(0, 4).toUpperCase();
		}
		function ticketSeqKey(t) {
			const m = t.id.match(/^([A-Za-z]*)(\d+)/);
			return [
				m?.[1] ?? "",
				m ? parseInt(m[2], 10) : Number.MAX_SAFE_INTEGER,
				t.id
			];
		}
		function compareTicketSeq(a, b) {
			const ka = ticketSeqKey(a), kb = ticketSeqKey(b);
			return ka[0].localeCompare(kb[0]) || ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0);
		}
		function normalizeRef(raw) {
			return ticketId(raw.trim().replace(/^["']|["']$/g, "").split("/").pop() ?? "");
		}
		function parseBlockedBy(value) {
			const v = (value ?? "").trim();
			if (/^none\b/i.test(v) && !/^none[a-z]/i.test(v)) return [];
			return v.replace(/[\[\]]/g, "").split(",").map(normalizeRef).filter(Boolean);
		}
		function parseAssetRefs(value) {
			return (value ?? "").replace(/[\[\]]/g, "").split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
		}
		function resolveRef(ref, byId) {
			if (byId.has(ref)) return ref;
			if (/^\d+$/.test(ref)) {
				const padded = ref.padStart(2, "0");
				if (byId.has(padded)) return padded;
			}
			for (const id of byId.keys()) if (id === ref || id.startsWith(`${ref}-`) || id.split("-")[0] === ref) return id;
		}
		function escapeHtml(s) {
			return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		}
		/** Inline spans: code, bold, italic, links. Runs on already-escaped text. */
		function inline(s) {
			return s.replace(/`([^`]+)`/g, "<code class=\"pvm-code\">$1</code>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a class=\"pvm-a\" href=\"$2\" target=\"_blank\" rel=\"noreferrer\">$1</a>");
		}
		const splitRow = (line) => line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
		const isDivider = (line) => /^\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes("-");
		function md(text) {
			const lines = text.split("\n");
			const out = [];
			let i = 0;
			let para = [];
			let list = [];
			let olist = [];
			let quote = [];
			const flushPara = () => {
				if (para.length) {
					out.push(`<p class="pvm-p">${para.map(inline).join("<br/>")}</p>`);
					para = [];
				}
			};
			const flushList = () => {
				if (list.length) {
					out.push(`<ul class="pvm-ul">${list.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`);
					list = [];
				}
			};
			const flushOlist = () => {
				if (olist.length) {
					out.push(`<ol class="pvm-ol">${olist.map((x) => `<li>${inline(x)}</li>`).join("")}</ol>`);
					olist = [];
				}
			};
			const flushQuote = () => {
				if (quote.length) {
					out.push(`<blockquote class="pvm-quote">${quote.map(inline).join("<br/>")}</blockquote>`);
					quote = [];
				}
			};
			const flushAll = () => {
				flushPara();
				flushList();
				flushOlist();
				flushQuote();
			};
			while (i < lines.length) {
				const line = lines[i] ?? "";
				if (line.match(/^\s*```(\w*)\s*$/)) {
					flushAll();
					const buf = [];
					i++;
					while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? "")) {
						buf.push(lines[i] ?? "");
						i++;
					}
					i++;
					out.push(`<pre class="pvm-pre"><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
					continue;
				}
				if (line.includes("|") && isDivider(lines[i + 1] ?? "")) {
					flushAll();
					const head = splitRow(line);
					i += 2;
					const body = [];
					while (i < lines.length && (lines[i] ?? "").includes("|") && !/^\s*$/.test(lines[i] ?? "")) {
						body.push(splitRow(lines[i] ?? ""));
						i++;
					}
					out.push("<div class=\"pvm-tw\"><table class=\"pvm-table\"><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" + body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("") + "</tbody></table></div>");
					continue;
				}
				const h = line.match(/^(#{1,6})\s+(.*)$/);
				if (h && h[1] && h[2] !== void 0) {
					flushAll();
					const lvl = h[1].length;
					const tag = lvl <= 1 ? "h2" : lvl === 2 ? "h3" : "h4";
					out.push(`<${tag} class="pvm-h">${inline(h[2])}</${tag}>`);
					i++;
					continue;
				}
				if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
					flushAll();
					out.push("<hr class=\"pvm-hr\"/>");
					i++;
					continue;
				}
				const q = line.match(/^>\s?(.*)$/);
				if (q) {
					flushPara();
					flushList();
					flushOlist();
					quote.push(q[1] ?? "");
					i++;
					continue;
				}
				const ul = line.match(/^\s*[-*+]\s+(.*)$/);
				if (ul) {
					flushPara();
					flushOlist();
					flushQuote();
					list.push(ul[1] ?? "");
					i++;
					continue;
				}
				const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
				if (ol) {
					flushPara();
					flushList();
					flushQuote();
					olist.push(ol[1] ?? "");
					i++;
					continue;
				}
				if (/^\s*$/.test(line)) {
					flushAll();
					i++;
					continue;
				}
				flushList();
				flushOlist();
				flushQuote();
				para.push(line);
				i++;
			}
			flushAll();
			return out.join("");
		}
		const BG = "#151517";
		const HEADER_BG = "#1b1b1c";
		const CARD = "#232324";
		const CARD_DARK = "#1f1f20";
		const RAISED = "#2c2c2e";
		const TEXT = "#e9ecf2";
		const TEXT_DIM = "#adb2b8";
		const TEXT_FAINT = "#81858c";
		const BORDER = "rgba(255,255,255,.10)";
		const BORDER_LIGHT = "rgba(255,255,255,.06)";
		const ACCENT = "#4176e6";
		const ACCENT_SOFT = "#609bfa";
		const LOCKED = "#b8860b";
		const CHIP_BG = "rgba(255,255,255,.07)";
		const MD_CSS = `
.pvm-p{margin:.5em 0;line-height:1.75}
.pvm-h{margin:1.1em 0 .5em;font-weight:700;color:${TEXT};line-height:1.4}
h2.pvm-h{font-size:17px;border-bottom:1px solid ${BORDER_LIGHT};padding-bottom:.3em}
h3.pvm-h{font-size:15px}
h4.pvm-h{font-size:13.5px;color:${TEXT_DIM}}
.pvm-ul,.pvm-ol{margin:.5em 0;padding-left:1.5em}
.pvm-ul li,.pvm-ol li{margin:.25em 0;line-height:1.7}
.pvm-quote{margin:.6em 0;padding:.5em .9em;border-left:3px solid ${ACCENT};background:rgba(255,255,255,.04);border-radius:0 6px 6px 0;color:${TEXT_DIM}}
.pvm-code{background:rgba(255,255,255,.09);padding:1px 5px;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;color:${ACCENT_SOFT}}
.pvm-pre{margin:.7em 0;padding:.8em 1em;background:#141416;border:1px solid ${BORDER_LIGHT};border-radius:8px;overflow:auto}
.pvm-pre code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:${TEXT_DIM};white-space:pre}
.pvm-tw{margin:.7em 0;overflow:auto;border:1px solid ${BORDER_LIGHT};border-radius:8px}
/* 表格宽度（2026-10-02 用户反馈：最小格宽 + 横向滚动）：
   width:max-content 让表按内容定宽、不再被压缩；min-width:100% 让窄表仍铺满容器
   （缺它则短表缩成一小坨，右栏留白突兀）。两者缺一不可——只有 min-width 到格子
   上时表格依旧会压缩以适配容器，永远不溢出、也就永远不出现横向滚动。
   th/td 的 min-width 是「最小格宽」本体：列窄到这个下限即止，不再压缩到只剩表头
   文字宽（旧样式下短列被压到 45px，读作挤压变形）。td 的 max-width + break-word
   给超长单元格封顶并允许折行，避免单列无限伸长把表推成一条长带。 */
.pvm-table{border-collapse:collapse;width:max-content;min-width:100%;font-size:12.5px}
.pvm-table th{background:${RAISED};color:${TEXT};font-weight:700;text-align:left;padding:7px 10px;border-bottom:1px solid ${BORDER};white-space:nowrap;min-width:72px}
.pvm-table td{padding:7px 10px;border-bottom:1px solid ${BORDER_LIGHT};color:${TEXT_DIM};vertical-align:top;min-width:72px;max-width:320px;word-break:break-word}
.pvm-table tr:last-child td{border-bottom:none}
.pvm-a{color:${ACCENT_SOFT};text-decoration:none}
.pvm-a:hover{text-decoration:underline}
.pvm-hr{border:none;border-top:1px solid ${BORDER_LIGHT};margin:1em 0}
`;
		const TYPE_THEME = {
			research: {
				icon: "🔍",
				color: ACCENT
			},
			grilling: {
				icon: "🔥",
				color: "#f2555a"
			},
			prototype: {
				icon: "🛠️",
				color: "#f7ad31"
			},
			task: {
				icon: "⚡",
				color: ACCENT_SOFT
			}
		};
		const TYPE_FALLBACK = {
			icon: "•",
			color: "#888"
		};
		const NO_TYPE = "\0no-type";
		const typeTheme = (t) => TYPE_THEME[t ?? ""] ?? TYPE_FALLBACK;
		const DOT = {
			open: "#81858c",
			claimed: "#f7ad31",
			done: "#4ed17e",
			out_of_scope: "#61666b"
		};
		const STATUS_LABELS = {
			open: "Open",
			claimed: "Claimed",
			done: "Resolved",
			out_of_scope: "Out of scope"
		};
		const STATUS_ORDER = [
			"open",
			"claimed",
			"done",
			"out_of_scope"
		];
		/**
		* 在右栏打开一个治理目录下的文件。
		* @param ctx - 客户端根上下文（需注入 `sidebarRight`）。
		* @param scope - 当前会话作用域：地址按会话解析路径。
		* @param path - 文件的绝对路径；缺省时退回文件名（服务端按会话 cwd 解析）。
		* @returns 是否已发起打开（服务缺失时 false，调用方据此提示）。
		*/
		function openFileInSidebar(ctx, scope, path, fallbackName) {
			try {
				const sidebar = ctx?.get?.("sidebarRight");
				if (sidebar?.openResource === void 0) return false;
				sidebar.openResource(fileAddress(scope.sessionId, path ?? fallbackName));
				return true;
			} catch {
				return false;
			}
		}
		/**
		* 票面的文件路径行：一行等宽小字，点击在右栏打开该文件。
		*
		* 显示的是**相对工作区**的路径（`.scratch/doc-authority/issues/05-….md`），仓外
		* 文件显示绝对路径——相对化只为好读。整行是按钮（键盘可达、有 hover 反馈），
		* 并 `stopPropagation`：卡片本身点击是「打开详情弹窗」，两件事不能互相吞掉。
		* @param props.ticket - 该行所属的票（取 `path` / `file`）。
		* @param props.scope - 会话作用域，决定地址解析与相对化基准。
		* @param props.ctx - 客户端根上下文。
		* @param props.size - 字号，默认 10.5；详情弹窗用 11.5。
		* @returns 路径按钮。
		*/
		function FilePath({ ticket, scope, ctx, size = 10.5 }) {
			const full = ticket.path;
			const shown = full === void 0 ? ticket.file : displayPath(full, scope.cwd);
			const open = (e) => {
				e.stopPropagation();
				openFileInSidebar(ctx, scope, full, ticket.file);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: open,
				title: `点击在右栏打开：${full ?? ticket.file}`,
				style: {
					display: "block",
					maxWidth: "100%",
					padding: 0,
					border: "none",
					background: "transparent",
					textAlign: "left",
					fontFamily: "ui-monospace,Menlo,monospace",
					fontSize: size,
					lineHeight: 1.5,
					color: TEXT_FAINT,
					cursor: "pointer",
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap"
				},
				onMouseEnter: (e) => {
					e.currentTarget.style.color = ACCENT_SOFT;
					e.currentTarget.style.textDecoration = "underline";
				},
				onMouseLeave: (e) => {
					e.currentTarget.style.color = TEXT_FAINT;
					e.currentTarget.style.textDecoration = "none";
				},
				children: shown
			});
		}
		const TICKET_TYPES = /* @__PURE__ */ new Set([
			"task",
			"research",
			"prototype",
			"grilling"
		]);
		/** Approval documents are `type: approval`, or any doc carrying a pending-style status. */
		function ticketKind(t) {
			const ty = (t.type ?? "").trim().toLowerCase();
			if (ty === "approval") return "approval";
			if (ty === "qa-defect") return "defect";
			if (ty === "ledger") return "ledger";
			if (t.group === "qa" && (t.file === "cases.md" || /^cases-/.test(t.file))) return "cases";
			if (isPending(t)) return "approval";
			if (ty === "spec" || ty === "design" || /^(map|readme|index)$/i.test(t.id)) return "note";
			if (!ty && !t.status) return "note";
			if (ty && !TICKET_TYPES.has(ty)) return "note";
			return "ticket";
		}
		const KIND_META = {
			ticket: {
				label: "工单",
				icon: "🎫",
				color: ACCENT_SOFT
			},
			approval: {
				label: "待拍板",
				icon: "⏳",
				color: "#f7ad31"
			},
			ledger: {
				label: "台账",
				icon: "📒",
				color: "#4ed17e"
			},
			defect: {
				label: "缺陷",
				icon: "🐞",
				color: "#f2555a"
			},
			cases: {
				label: "测例",
				icon: "🧪",
				color: "#609bfa"
			},
			note: {
				label: "说明",
				icon: "📄",
				color: TEXT_FAINT
			}
		};
		const SPECULATION_TICKET_META = {
			research: {
				label: "调研票",
				icon: "🔍",
				color: "#b48ef7"
			},
			prototype: {
				label: "原型票",
				icon: "🧩",
				color: "#ff9f6e"
			},
			grilling: {
				label: "拷问票",
				icon: "🔥",
				color: "#5ad8cd"
			}
		};
		/** Render meta for a ticket: speculation types carry their own badge, others use the kind default. */
		function ticketDisplayMeta(t) {
			const k = ticketKind(t);
			if (k === "ticket") {
				const m = SPECULATION_TICKET_META[(t.type ?? "").trim().toLowerCase()];
				if (m) return m;
			}
			return KIND_META[k];
		}
		const SPECULATION_TYPES = /* @__PURE__ */ new Set([
			"research",
			"grilling",
			"prototype"
		]);
		const IMPL_TYPES = /* @__PURE__ */ new Set(["task"]);
		function mapKind(dir, tickets) {
			let speculation = false, impl = false;
			for (const t of tickets) {
				if (t.effort !== dir) continue;
				const ty = (t.type ?? "").trim().toLowerCase();
				if (SPECULATION_TYPES.has(ty)) speculation = true;
				if (IMPL_TYPES.has(ty)) impl = true;
			}
			if (speculation) return "speculation";
			if (impl) return "impl";
		}
		const MAP_KIND_META = {
			speculation: {
				label: "推演图",
				icon: "🗺️"
			},
			impl: {
				label: "实施图",
				icon: "🛠️"
			}
		};
		/** 四类单据各自的「已完成」判据（跨坐标系不可共用词表）。 */
		function isSettled(t, kind) {
			if (kind === "ticket") return displayStatus(t) === "done";
			if (kind === "approval") return !isPending(t);
			if (kind === "ledger") {
				const e = parseLedgerEntries(t.body)[0];
				return e !== void 0 && (e.state === "已销" || e.state === "已转票");
			}
			if (kind === "defect") {
				const single = parseDefectFile(t);
				if (single !== void 0) return DEFECT_CLOSED.has(defectStateWord(single.state));
				const entries = parseDefectEntries(t.body);
				return entries.length > 0 && entries.every((d) => DEFECT_CLOSED.has(defectStateWord(d.state)));
			}
			return false;
		}
		/**
		* spec.md 是否已归档（协议「取代登记」，2026-10-02 用户需求②）。
		* 正本 plan-protocol「spec 生命周期与归宿行」（2026-10-04 E' 拍板：spec 退役
		* 只发生在 effort 归档，票尽不再触发必标）——`superseded-by:` 注记即退役凭据。
		* 注记位置协议限定两种——frontmatter
		* `status: superseded-by:<归宿>`（首选），或**头部 10 行内**引用块。
		* 「埋正文深处不算」（协议明写，doc-authority 复盘实证 23% 可检索率是旧病），
		* 故此处只认这两个位置，不做全文正则——否则一份「提及」别人被取代的 spec
		* 会把自己判成已归档。
		*/
		function isSpecArchived(specRaw) {
			if (!specRaw) return false;
			const fm = specRaw.match(/^---\n([\s\S]*?)\n---/);
			if (fm && /^\s*status:\s*superseded-by:/m.test(fm[1] ?? "")) return true;
			const head = specRaw.split("\n").slice(0, 10).join("\n");
			return /superseded-by/i.test(head);
		}
		/**
		* 一张图的完成度。返回 `pct` 与锁区两个读数。
		*
		* 口径（2026-10-02 用户拍板，10% 档 2026-10-03 追加）：
		*  - 四类单据全计（ticket/approval/ledger/qa-defect），完成判据各按自己坐标系。
		*  - **实施图**的 `spec.md` 占**一个名额**：未归档 ⇒ 分母 +1 且该项未完成，
		*    故「票全做完但 spec 没归档」= n/(n+1)，永远到不了 100%。spec 归档后满分
		*    变为 100%。推演图无 spec.md，不加项。
		*  - 实施图缺 `qa/cases.md` ⇒ 完成度**封顶 80%**；有测例但缺执行验收记录
		*    （`qa/test.md`）⇒ **封顶 90%**。`lockPct`（20/10）标出「够不到的那一段」，
		*    供进度条把右端画成黄色锁区（2026-10-03 用户拍板的展示要求）。
		*
		* `locked` 为 true 表示**存在结构性缺口导致上不去 100%**（缺测例 / 缺测试文档
		* 两种），供卡片在进度右侧显示锁死标识；spec 未归档不置 locked——它是分母里的
		* 正常一项，属于「还有活没干」，与「条件缺失、干了也到不了」是两回事。
		*
		* @param own     该图自有单据 + 根层松散件（与卡片其它计数同口径）
		* @param dir     图目录（判断 qa/cases.md、qa/test.md 与 spec.md 归属）
		* @param cases   全部测例文档（含 effort 归属字段）
		* @param tests   全部执行验收记录（qa/test.md / test-*.md，含 effort 归属字段）
		* @param kind    图型
		* @param specRaw 该图 spec.md 正文；无 spec 传 undefined
		*/
		function effortProgress(own, dir, cases, tests, kind, specRaw) {
			const countable = own.filter((t) => {
				const k = ticketKind(t);
				if (k === "note" || k === "cases") return false;
				if (k === "ticket" && t.outOfScope) return false;
				return true;
			});
			const settled = countable.filter((t) => isSettled(t, ticketKind(t))).length;
			const specCounted = kind === "impl" && !!specRaw;
			const specArchived = isSpecArchived(specRaw);
			const denom = countable.length + (specCounted ? 1 : 0);
			const numer = settled + (specCounted && specArchived ? 1 : 0);
			let pct = denom > 0 ? Math.round(numer / denom * 100) : 0;
			const hasCases = cases.some((c) => c.effort === dir);
			const hasTest = tests.some((t) => t.effort === dir);
			const lockPct = kind !== "impl" ? 0 : hasCases ? hasTest ? 0 : 10 : 20;
			const lockKind = lockPct === 20 ? "cases" : lockPct === 10 ? "test" : void 0;
			if (lockPct > 0) pct = Math.min(pct, 100 - lockPct);
			return {
				pct,
				locked: lockPct > 0,
				lockPct,
				lockKind,
				hasCases,
				hasTest,
				specCounted,
				specArchived
			};
		}
		/** 锁区的角标文案与悬停说明（总览卡片条与子页头部条共用，防两处漂移）。 */
		function lockCopy(kind) {
			return kind === "test" ? {
				chip: "🔒 缺测试文档 10%",
				title: "已有测例（qa/cases.md）但没有执行验收记录（qa/test.md）：测过没记录不算收口，上限锁在 90%"
			} : {
				chip: "🔒 缺测例 20%",
				title: "缺 qa/cases.md：测例是实施图的验收前提，上限锁在 80%，补齐前到不了 100%"
			};
		}
		/** effort 全局进度条（2026-10-03 拍板②）：读数 = effortProgress（四类单据全计＋
		*  spec 名额＋锁区），与总览卡同一个数；工单/待拍板/缺陷/台账四个子页头部共用。
		*  prog 为 undefined（「全部地图」聚合态，无单一 effort）时不渲染。 */
		function EffortProgressBar({ prog }) {
			const lockTitle = prog.locked ? lockCopy(prog.lockKind).title : "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: "8px 16px 0",
					display: "flex",
					alignItems: "center",
					gap: 10
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							flex: 1,
							height: 6,
							borderRadius: 3,
							background: CHIP_BG,
							border: `1px solid ${BORDER}`,
							overflow: "hidden",
							position: "relative"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
							height: "100%",
							width: `${prog.pct}%`,
							borderRadius: 3,
							background: `linear-gradient(90deg, #4ed17e, ${ACCENT})`
						} }), prog.locked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							title: lockTitle,
							style: {
								position: "absolute",
								top: 0,
								right: 0,
								bottom: 0,
								width: `${prog.lockPct}%`,
								background: LOCKED,
								cursor: "help"
							}
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: {
							fontSize: 12,
							fontWeight: 700,
							color: prog.locked ? LOCKED : "#4ed17e",
							minWidth: 36,
							textAlign: "right",
							fontVariantNumeric: "tabular-nums"
						},
						children: [prog.pct, "%"]
					}),
					prog.locked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						title: lockTitle,
						style: {
							fontSize: 10.5,
							fontWeight: 700,
							color: LOCKED,
							background: `${LOCKED}1f`,
							border: `1px solid ${LOCKED}66`,
							borderRadius: 4,
							padding: "1px 5px",
							whiteSpace: "nowrap",
							cursor: "help"
						},
						children: lockCopy(prog.lockKind).chip
					})
				]
			});
		}
		/** Frontmatter `status` marks a document as an approval awaiting a ruling. */
		function isPending(t) {
			return statusWord(t) === "pending";
		}
		/** Whole days since the document's `date`. Undefined when there is no usable date. */
		function ageDays(t) {
			if (!t.date) return void 0;
			const then = Date.parse(t.date);
			if (Number.isNaN(then)) return void 0;
			return Math.max(0, Math.floor((Date.now() - then) / 864e5));
		}
		function ageLabel(t) {
			const d = ageDays(t);
			if (d === void 0) return void 0;
			if (d === 0) return "今天";
			return `挂了 ${d} 天`;
		}
		function parseRoundsIndex(raw) {
			const out = /* @__PURE__ */ new Map();
			let inSection = false;
			let inTable = false;
			for (const line of raw.split("\n")) {
				if (/^#{1,6}\s/.test(line)) {
					inSection = /^#{1,6}\s+轮次索引/.test(line);
					inTable = false;
					continue;
				}
				if (!line.trimStart().startsWith("|")) {
					if (inTable) {
						inSection = false;
						inTable = false;
					}
					continue;
				}
				if (!inSection) continue;
				inTable = true;
				const cells = line.split("|").map((c) => c.trim());
				const id = (cells[1] ?? "").replace(/`/g, "");
				if (!id || id.includes("--") || id === "round-id") continue;
				out.set(id, {
					id,
					topic: cells[2] || void 0
				});
			}
			return out;
		}
		function roundsOf(snap) {
			const meta = snap.rounds.readmeRaw !== null ? parseRoundsIndex(snap.rounds.readmeRaw) : /* @__PURE__ */ new Map();
			return snap.rounds.ids.map((id) => meta.get(id) ?? { id });
		}
		const ROOT_GROUP = "\0root";
		function classify(t) {
			return ticketKind(t);
		}
		/**
		* snapshot（一次请求的全量数据）→ PlanData：契约解析（frontmatter/状态/kind/qa
		* 白名单过滤）留在客户端不动，只把「遍历+读取」换成了服务端一次返回。
		*/
		function assemblePlanData(snap) {
			const parsed = snap.files.map((f) => ({
				...deriveTicketStatus(f.name, f.content),
				path: f.path,
				effort: f.from,
				group: f.group
			}));
			const adrs = parsed.filter((t) => t.group === "adr");
			const assetFiles = parsed.filter((t) => t.group === "assets");
			const tickets = parsed.filter((t) => t.group !== "adr" && t.group !== "assets").filter((t) => t.group !== "qa" || ticketKind(t) === "defect" || t.file === "cases.md").sort((a, b) => (a.effort ?? "").localeCompare(b.effort ?? "") || compareTicketSeq(a, b));
			const qaTests = parsed.filter((t) => t.group === "qa" && (t.file === "test.md" || /^test-/.test(t.file)));
			const efforts = snap.efforts.map((e) => ({
				dir: e.dir,
				mapRaw: e.mapRaw,
				specRaw: e.specRaw ?? void 0
			}));
			const primary = efforts.find((e) => e.mapRaw !== "") ?? efforts[0];
			return {
				tickets,
				qaTests,
				adrs,
				assetFiles,
				effortDir: primary?.dir ?? snap.cwd,
				mapRaw: primary?.mapRaw ?? null,
				efforts
			};
		}
		const shortSession = (id) => id.replace(/^session-/, "").slice(0, 8);
		const EXPLORE_PROMPT = (t) => `继续推演这张工单：${t.path ?? t.file}\n\n先读票面原文与它引用的文档，然后继续未决项的推演；需要人拍板的结论，用 to-approval 落成待拍板文档——调用时传本图 effort slug（${effortSlugOf(t)}）作落点参数，档落该图 approval/ 并带 effort: 声明（2026-09-30 拍板 A：默认 effort，全局必须显式）。`;
		const effortSlugOf = (t) => t.effort && t.effort !== ROOT_GROUP ? t.effort.split("/").pop() ?? "" : "（本票无图归属，请先向用户确认落点 effort 或 global）";
		const ADVANCE_PROMPT = (t) => `推进这张工单：${t.path ?? t.file}\n\n按票面实施；完成后按 plan-protocol 回写票面状态（status 与落地注）。`;
		function sessionsOf(ctx) {
			try {
				return ctx?.get?.("sessions");
			} catch {
				return;
			}
		}
		/** 给会话改名，失败不阻断派单（deck 同款：命名是锦上添花）。 */
		function renameSession(sessions, sessionId, title) {
			try {
				const scopeCtx = sessions.scope?.(sessionId);
				const r = (scopeCtx !== void 0 ? sessions.sessionOf?.(scopeCtx) : void 0)?.rename?.(title);
				if (r !== void 0 && typeof r.catch === "function") r.catch(() => {});
			} catch {}
		}
		/** 注入走不通时的兜底：把指令复制到剪贴板，人手动粘贴。返回给用户看的话。 */
		async function copyFallback(text) {
			try {
				await navigator.clipboard?.writeText(text);
				return "指令已复制到剪贴板——粘贴到输入框确认后发送。";
			} catch {
				return "此环境连剪贴板都不可用，请手动把指令粘进输入框。";
			}
		}
		function DetailModal({ ticket, planDir, scope, ctx, sessions, onChanged, onClose, readOnly }) {
			const [busy, setBusy] = (0, react.useState)(null);
			const [msg, setMsg] = (0, react.useState)(null);
			const [rebind, setRebind] = (0, react.useState)(false);
			const fullBody = ticket.body;
			(0, react.useEffect)(() => {
				const onKey = (e) => {
					if (e.key === "Escape") onClose();
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onClose]);
			/**
			* 触发宿主会话切换（`sessions.open`）。实测宿主 select→通知→渲染链可能同步
			* 挂死，因此绝不留在 await 链上：宏任务里调用、吞掉一切异常，调用即视为已触发。
			*/
			const openSessionDetached = (sessionId) => {
				const open = sessionsOf(ctx)?.open;
				if (open === void 0) return false;
				setTimeout(() => {
					try {
						const r = open(sessionId);
						if (r !== void 0 && r !== null && typeof r.catch === "function") r.catch(() => {});
					} catch {}
				}, 0);
				return true;
			};
			/**
			* 把指令草稿送进目标会话的输入框。目标会话正开着就立即（宏任务）填；否则经
			* 输入桥挂交接草稿、触发切换，并等输入区重挂消费掉草稿。每一步都即时反馈，
			* 看门狗保证 UI 永不卡在 busy 态，指令最终兜底进剪贴板——绝不静默丢失。
			*/
			const deliverPrompt = async (sessionId, text, okMsg) => {
				if (sessionId === void 0) {
					setMsg(await copyFallback(text));
					return;
				}
				if (deliverDraft(sessionId, text) === "injected") {
					setMsg(okMsg);
					return;
				}
				if (!openSessionDetached(sessionId)) {
					setMsg(`已选好 session ${shortSession(sessionId)}，但此环境无法切换会话。${await copyFallback(text)}`);
					return;
				}
				setMsg(`正在切到 session ${shortSession(sessionId)}…`);
				const deadline = Date.now() + 1e4;
				while (!isBridged(sessionId) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
				if (isBridged(sessionId)) setMsg(okMsg);
				else setMsg(`已触发切到 session ${shortSession(sessionId)}；指令会在输入区就绪时自动填入，若一直没出现：${await copyFallback(text)}`);
			};
			/** 动作总看门狗：任何环节挂死（含宿主内部），15 秒后强制恢复 UI 并把指令兜底进剪贴板。 */
			const withWatchdog = async (key, work, fallbackText) => {
				setMsg(null);
				setBusy(key);
				let finished = false;
				const watchdog = new Promise((resolve) => setTimeout(() => {
					if (finished) return;
					setBusy(null);
					(fallbackText !== void 0 ? copyFallback(fallbackText()) : Promise.resolve("")).then((extra) => setMsg(`操作超时（宿主无响应）。${extra}`));
				}, 15e3));
				await Promise.race([work.then(() => {
					finished = true;
				}), watchdog]);
				if (finished) setBusy(null);
			};
			/** Pure jump with the E1 liveness check. */
			const jump = async (sessionId) => {
				setMsg(null);
				setBusy("jump");
				try {
					if (await sessionAlive(sessionId) === void 0) {
						setMsg("该 session 已不可用（可能已被回收）。");
						return;
					}
					if (!openSessionDetached(sessionId)) {
						setMsg("此环境没有跳转能力（sessions 服务不可用）。");
						return;
					}
					setMsg(`正在切到 session ${shortSession(sessionId)}…`);
				} catch (e) {
					setMsg(`跳转失败：${e.message}`);
				} finally {
					setBusy(null);
				}
			};
			/** New session via the client runtime, write the B1 binding, prefill, jump. */
			const createAndBind = async (promptText) => {
				await withWatchdog("create", async () => {
					const sessions = sessionsOf(ctx);
					if (sessions?.create === void 0) {
						setMsg(`此环境没有会话创建能力（sessions 服务不可用）。${await copyFallback(promptText)}`);
						return;
					}
					const sessionId = await sessions.create(scope.cwd === void 0 ? {} : { cwd: scope.cwd });
					const target = ticket.path ?? `${planDir}/tickets/${ticket.file}`;
					await bindTicket(scope.sessionId, target, "session", sessionId);
					renameSession(sessions, sessionId, `#${shortId(ticket)} ${ticket.title}`.slice(0, 60));
					onChanged();
					await deliverPrompt(sessionId, promptText, `已在新 session ${shortSession(sessionId)} 预填指令（草稿，确认后发送），绑定已写回票面。`);
				}, () => promptText);
			};
			/** ①/② draft-first dispatch on a ticket: refill the bound session, else create one. */
			const dispatchTicket = async (mode) => {
				const promptText = mode === "explore" ? EXPLORE_PROMPT(ticket) : ADVANCE_PROMPT(ticket);
				if (ticket.session === void 0) {
					await createAndBind(promptText);
					return;
				}
				await withWatchdog(mode, async () => {
					setRebind(false);
					let live;
					try {
						live = await sessionAlive(ticket.session);
					} catch {
						live = void 0;
					}
					if (live === void 0) {
						setRebind(true);
						setMsg("绑定的 session 已不可用。可新建 session 并重新绑定。");
						return;
					}
					await deliverPrompt(ticket.session, promptText, `指令已填进 session ${shortSession(ticket.session)} 的输入框，确认后发送。`);
				}, () => promptText);
			};
			/** ③ 拍板: prefill `/plan-approve <doc>` in the session the user is looking at. */
			const settle = async () => {
				const line = `/plan-approve ${ticket.file}`;
				await withWatchdog("settle", async () => {
					await deliverPrompt(scope.sessionId, line, "已把 /plan-approve 预填进当前会话输入框，确认后发送。");
					onChanged();
				}, () => line);
			};
			const kind = ticketKind(ticket);
			const pending = isPending(ticket);
			const boundLive = ticket.session !== void 0 ? sessions.get(ticket.session) : void 0;
			const btn = (label, onClick, key, tone = ACCENT) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				disabled: busy !== null,
				onClick,
				style: {
					padding: "5px 12px",
					borderRadius: 7,
					border: `1px solid ${tone}`,
					background: `${tone}1a`,
					color: tone,
					cursor: busy === null ? "pointer" : "default",
					fontSize: 12,
					fontWeight: 600,
					opacity: busy === null || busy === key ? 1 : .5
				},
				children: busy === key ? "…" : label
			});
			const actions = [];
			if (!readOnly) {
				if (kind === "ticket") {
					if (ticket.session !== void 0 && rebind) {
						actions.push(btn("新建 session 并重新绑定", () => void createAndBind(ADVANCE_PROMPT(ticket)), "create", "#f7ad31"));
						actions.push(btn("取消", () => {
							setRebind(false);
							setMsg(null);
						}, "cancel", "#666"));
					} else {
						if (ticket.session === void 0) actions.push(btn("🧭 开始推演", () => void dispatchTicket("explore"), "explore"));
						actions.push(btn("▶ 推进", () => void dispatchTicket("advance"), "advance"));
					}
				}
				if (kind === "approval" && pending) actions.push(btn("✅ 拍板（预填 /plan-approve）", () => void settle(), "settle", "#4ed17e"));
			}
			const jumps = [];
			if (ticket.session !== void 0) jumps.push([ticket.session, "绑定 session"]);
			if (ticket.originSession !== void 0) jumps.push([ticket.originSession, "来源 session"]);
			const body = fullBody ?? ticket.body;
			const chipRow = jumps.map(([id, label]) => {
				if (!isDshSession(id)) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					title: `外部 agent session: ${id}——点击复制恢复命令`,
					onClick: () => {
						const cmd = `zcode --resume ${id}`;
						navigator.clipboard?.writeText(cmd);
						setMsg(`已复制恢复命令：${cmd}（粘贴到终端执行）`);
					},
					style: {
						fontSize: 11,
						padding: "2px 9px",
						borderRadius: 999,
						background: "#609bfa18",
						color: "#609bfa",
						border: `1px solid ${BORDER}`,
						cursor: "pointer"
					},
					children: [
						"📎 ",
						label,
						" ",
						id
					]
				}, id);
				const live = sessions.get(id);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					title: `${label}: ${id}${live === void 0 ? "（已不可用）" : live.running ? "（运行中）" : "（空闲）"}`,
					onClick: () => {
						if (busy === null) jump(id);
					},
					style: {
						fontSize: 11,
						padding: "2px 9px",
						borderRadius: 999,
						background: live !== void 0 ? "#2ecc7118" : CHIP_BG,
						color: live !== void 0 ? "#4ed17e" : "#888",
						border: `1px solid ${BORDER}`,
						cursor: "pointer"
					},
					children: [
						live === void 0 ? "⚪" : live.running ? "🟢" : "⚪",
						" ",
						label,
						" ",
						shortSession(id)
					]
				}, id);
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					position: "fixed",
					inset: 0,
					background: "rgba(0,0,0,.6)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					zIndex: 100
				},
				onClick: onClose,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						width: "min(1080px, 94vw)",
						maxHeight: "88vh",
						display: "flex",
						flexDirection: "column",
						background: HEADER_BG,
						border: `1px solid ${BORDER}`,
						borderRadius: 14,
						boxShadow: "0 16px 48px rgba(0,0,0,.55)"
					},
					onClick: (e) => e.stopPropagation(),
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: MD_CSS }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								padding: "16px 20px 0",
								display: "flex",
								alignItems: "center",
								gap: 8
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: DOT[displayStatus(ticket)] },
									children: typeTheme(ticket.type).icon
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 16,
										fontWeight: 700,
										color: TEXT,
										lineHeight: 1.4,
										flex: 1
									},
									children: ticket.title
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									style: {
										background: "transparent",
										border: "none",
										color: "#888",
										fontSize: 18,
										cursor: "pointer"
									},
									onClick: onClose,
									children: "✕"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: { padding: "2px 20px 0" },
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
								ticket,
								scope,
								ctx,
								size: 11.5
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								padding: "0 20px 12px",
								display: "flex",
								gap: 6,
								flexWrap: "wrap",
								marginTop: 8,
								borderBottom: `1px solid ${BORDER_LIGHT}`
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: CHIP_BG,
										color: "#888",
										border: `1px solid ${BORDER}`
									},
									children: ["#", shortId(ticket)]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: `${ticketDisplayMeta(ticket).color}22`,
										color: ticketDisplayMeta(ticket).color
									},
									children: [
										ticketDisplayMeta(ticket).icon,
										" ",
										ticketDisplayMeta(ticket).label
									]
								}),
								ticket.type && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: `${typeTheme(ticket.type).color}22`,
										color: typeTheme(ticket.type).color
									},
									children: ticket.type
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: CHIP_BG,
										color: DOT[displayStatus(ticket)],
										border: `1px solid ${BORDER}`
									},
									children: STATUS_LABELS[displayStatus(ticket)]
								}),
								ticket.claimedBy && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: "#f0a50022",
										color: "#f7ad31"
									},
									children: ["👤 ", ticket.claimedBy]
								}),
								ticket.qaCases && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: "#609bfa22",
										color: "#609bfa"
									},
									children: "🧪 测例已构建"
								}),
								ticket.qaTested && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: "#4ed17e22",
										color: "#4ed17e"
									},
									children: "🧪 已测试"
								}),
								ticket.qaAccepted && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: "#2ecc7122",
										color: "#4ed17e"
									},
									children: "🏁 已验收"
								}),
								ticket.status && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: CHIP_BG,
										color: "#aaa",
										border: `1px solid ${BORDER}`
									},
									children: ["status: ", ticket.status]
								}),
								ageLabel(ticket) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: "#ffa94d22",
										color: "#f7ad31"
									},
									children: ageLabel(ticket)
								}),
								ticket.origin && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: CHIP_BG,
										color: "#888",
										border: `1px solid ${BORDER}`
									},
									children: ["origin: ", ticket.origin]
								}),
								ticket.blockedBy.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontSize: 11,
										padding: "2px 9px",
										borderRadius: 999,
										background: "#ff6b6b22",
										color: "#f2555a"
									},
									children: ["blocked_by: ", ticket.blockedBy.map((n) => `#${n}`).join(", ")]
								}),
								chipRow
							]
						}),
						(actions.length > 0 || msg !== null) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								padding: "10px 20px",
								borderBottom: `1px solid ${BORDER_LIGHT}`,
								display: "flex",
								gap: 8,
								alignItems: "center",
								flexWrap: "wrap"
							},
							children: [
								actions,
								boundLive?.running === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										color: "#4ed17e"
									},
									children: "🟢 session 运行中"
								}),
								msg !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 12,
										color: TEXT_DIM,
										flex: 1,
										minWidth: 200
									},
									children: msg
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								flex: 1,
								overflowY: "auto",
								padding: "14px 20px 20px",
								fontSize: 13,
								color: TEXT_DIM
							},
							dangerouslySetInnerHTML: { __html: md(body) }
						})
					]
				})
			});
		}
		function ViewA({ tickets, planDir, scope, ctx, sessions, onChanged, destination, readOnly, prog }) {
			const [focus, setFocus] = (0, react.useState)(null);
			const groups = (0, react.useMemo)(() => {
				const g = {
					done: [],
					out_of_scope: [],
					claimed: [],
					open: []
				};
				for (const t of tickets) g[displayStatus(t)].push(t);
				return g;
			}, [tickets]);
			const waiting = (0, react.useMemo)(() => tickets.filter(isPending).sort((a, b) => (ageDays(b) ?? -1) - (ageDays(a) ?? -1)), [tickets]);
			const active = tickets.filter((t) => !t.outOfScope);
			const done = tickets.filter((t) => t.done).length;
			const aggPct = active.length > 0 ? Math.round(done / active.length * 100) : 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					minHeight: 0,
					overflow: "hidden",
					display: "flex",
					flexDirection: "column",
					background: BG,
					color: TEXT
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "12px 16px 0",
							display: "flex",
							justifyContent: "space-between"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 14,
								fontWeight: 700
							},
							children: "Kanban"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								fontSize: 12,
								color: "#888"
							},
							children: [
								tickets.length,
								" tickets · ",
								done,
								" done"
							]
						})]
					}),
					!readOnly && waiting.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							margin: "8px 16px 0",
							padding: "8px 12px",
							borderRadius: 8,
							background: "#3a2410",
							border: "1px solid #7a4a15",
							fontSize: 13
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								fontWeight: 700,
								color: "#f7ad31",
								marginBottom: 4
							},
							children: [
								"⏳ 等你拍板（",
								waiting.length,
								"）"
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: 3
							},
							children: waiting.map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								onClick: () => setFocus(t),
								style: {
									display: "flex",
									alignItems: "center",
									gap: 8,
									cursor: "pointer",
									color: "#e8c9a0"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontFamily: "monospace",
											fontSize: 11,
											color: "#f7ad31"
										},
										children: shortId(t)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											flex: 1,
											overflow: "hidden",
											textOverflow: "ellipsis",
											whiteSpace: "nowrap"
										},
										children: t.title
									}),
									ageLabel(t) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: 11,
											color: "#f7ad31",
											flexShrink: 0
										},
										children: ageLabel(t)
									})
								]
							}, t.id))
						})]
					}),
					destination && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							margin: "8px 16px 0",
							padding: "8px 12px",
							borderRadius: 8,
							background: HEADER_BG,
							border: `1px solid ${BORDER}`,
							color: "#aaa",
							fontSize: 13
						},
						children: destination
					}),
					prog === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							margin: "8px 16px 0",
							display: "flex",
							alignItems: "center",
							gap: 10
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								flex: 1,
								height: 6,
								borderRadius: 3,
								background: CHIP_BG,
								border: `1px solid ${BORDER}`,
								overflow: "hidden"
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
								height: "100%",
								width: `${aggPct}%`,
								borderRadius: 3,
								background: `linear-gradient(90deg, #4ed17e, ${ACCENT})`
							} })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								fontSize: 12,
								fontWeight: 700,
								color: "#4ed17e",
								minWidth: 36,
								textAlign: "right"
							},
							children: [aggPct, "%"]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							display: "flex",
							gap: 10,
							padding: "12px 16px",
							overflowX: "auto"
						},
						children: STATUS_ORDER.filter((s) => groups[s].length > 0).map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								flex: "1 1 0",
								minWidth: 200,
								display: "flex",
								flexDirection: "column",
								background: BG,
								border: `1px solid ${BORDER_LIGHT}`,
								borderRadius: 10,
								overflow: "hidden"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									padding: "7px 10px",
									display: "flex",
									alignItems: "center",
									gap: 7,
									borderBottom: `1px solid ${BORDER_LIGHT}`,
									background: HEADER_BG
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
										width: 7,
										height: 7,
										borderRadius: "50%",
										background: DOT[s]
									} }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontWeight: 700,
											fontSize: 12
										},
										children: STATUS_LABELS[s]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: 11,
											color: "#888"
										},
										children: groups[s].length
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									flex: 1,
									overflowY: "auto",
									padding: 6,
									display: "flex",
									flexDirection: "column",
									gap: 6
								},
								children: groups[s].map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										padding: 8,
										borderRadius: 8,
										background: CARD,
										border: `1px solid ${BORDER}`,
										cursor: "pointer"
									},
									onClick: () => setFocus(t),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												display: "flex",
												alignItems: "center",
												gap: 6
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: {
														fontSize: 10,
														fontFamily: "monospace",
														color: "#888",
														background: CHIP_BG,
														borderRadius: 999,
														minWidth: 20,
														height: 20,
														padding: "0 4px",
														boxSizing: "border-box",
														display: "flex",
														alignItems: "center",
														justifyContent: "center",
														fontWeight: 700
													},
													children: shortId(t)
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: { fontSize: 12 },
													children: ticketDisplayMeta(t).icon
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: {
														flex: 1,
														fontSize: 12,
														fontWeight: 600,
														lineHeight: 1.3,
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap"
													},
													children: t.title
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
											ticket: t,
											scope,
											ctx
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												display: "flex",
												gap: 4,
												marginTop: 6,
												flexWrap: "wrap"
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													style: {
														fontSize: 10,
														padding: "1px 5px",
														borderRadius: 999,
														background: `${ticketDisplayMeta(t).color}22`,
														color: ticketDisplayMeta(t).color
													},
													children: [
														ticketDisplayMeta(t).icon,
														" ",
														ticketDisplayMeta(t).label
													]
												}),
												t.type && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: {
														fontSize: 10,
														padding: "1px 5px",
														borderRadius: 999,
														background: `${typeTheme(t.type).color}22`,
														color: typeTheme(t.type).color
													},
													children: t.type
												}),
												isPending(t) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													style: {
														fontSize: 10,
														padding: "1px 5px",
														borderRadius: 999,
														background: "#ffa94d33",
														color: "#f7ad31"
													},
													children: ageLabel(t) ?? "待拍板"
												}),
												t.claimedBy && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													style: {
														fontSize: 10,
														padding: "1px 5px",
														borderRadius: 999,
														background: "#f0a50022",
														color: "#f7ad31"
													},
													children: ["👤 ", t.claimedBy]
												}),
												t.blockedBy.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													style: {
														fontSize: 10,
														padding: "1px 5px",
														borderRadius: 999,
														background: "#ff6b6b22",
														color: "#f2555a"
													},
													children: [" ", t.blockedBy.map((n) => `#${n}`).join(",")]
												}),
												t.qaCases && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													title: "测例已构建（qa_cases）",
													style: {
														fontSize: 10,
														padding: "1px 5px",
														borderRadius: 999,
														background: "#609bfa22",
														color: "#609bfa"
													},
													children: "🧪 测例"
												}),
												t.qaTested && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													title: "测例已执行（qa_tested）",
													style: {
														fontSize: 10,
														padding: "1px 5px",
														borderRadius: 999,
														background: "#4ed17e22",
														color: "#4ed17e"
													},
													children: "🧪 已测试"
												}),
												t.qaAccepted && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													title: "验收通过（qa_accepted）",
													style: {
														fontSize: 10,
														padding: "1px 5px",
														borderRadius: 999,
														background: "#2ecc7122",
														color: "#4ed17e"
													},
													children: "🏁 已验收"
												})
											]
										})
									]
								}, t.file))
							})]
						}, s))
					}),
					focus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: focus,
						planDir,
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setFocus(null),
						readOnly
					})
				]
			});
		}
		function ViewC({ tickets, planDir, scope, ctx, sessions, onChanged, readOnly }) {
			const [query, setQuery] = (0, react.useState)("");
			const OUTSTANDING = ["open", "claimed"];
			const [statusSet, setStatusSet] = (0, react.useState)(() => new Set(OUTSTANDING));
			const allTypes = (0, react.useMemo)(() => {
				const named = [...new Set(tickets.map((t) => t.type).filter((x) => !!x))].sort();
				return tickets.some((t) => !t.type) ? [...named, NO_TYPE] : named;
			}, [tickets]);
			const [typeSet, setTypeSet] = (0, react.useState)(() => new Set(Object.keys(TYPE_THEME)));
			const [kindSet, setKindSet] = (0, react.useState)(() => /* @__PURE__ */ new Set([
				"ticket",
				"approval",
				"note"
			]));
			const typeInit = (0, react.useRef)(false);
			(0, react.useEffect)(() => {
				if (typeInit.current || tickets.length === 0) return;
				typeInit.current = true;
				setTypeSet(new Set(allTypes));
			}, [allTypes, tickets.length]);
			const [onlyBlocked, setOnlyBlocked] = (0, react.useState)(false);
			const [sort, setSort] = (0, react.useState)({
				key: "num",
				dir: 1
			});
			const [detail, setDetail] = (0, react.useState)(null);
			const rows = (0, react.useMemo)(() => {
				let out = tickets.filter((t) => {
					if (onlyBlocked && t.blockedBy.length === 0) return false;
					if (!statusSet.has(displayStatus(t))) return false;
					if (!kindSet.has(ticketKind(t))) return false;
					if (allTypes.length > 0 && !typeSet.has(t.type ?? NO_TYPE)) return false;
					if (query && !`${t.title} ${t.body} ${t.claimedBy ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
					return true;
				});
				out = [...out].sort((a, b) => {
					let v = 0;
					if (sort.key === "num") v = a.id.localeCompare(b.id, void 0, { numeric: true });
					else if (sort.key === "status") v = STATUS_ORDER.indexOf(displayStatus(a)) - STATUS_ORDER.indexOf(displayStatus(b));
					else if (sort.key === "kind") v = ticketKind(a).localeCompare(ticketKind(b));
					else v = (a.type ?? "").localeCompare(b.type ?? "");
					return v * sort.dir;
				});
				return out;
			}, [
				tickets,
				query,
				statusSet,
				typeSet,
				kindSet,
				onlyBlocked,
				sort
			]);
			const toggle = (set, v) => {
				const nx = new Set(set);
				if (nx.has(v)) nx.delete(v);
				else nx.add(v);
				return nx;
			};
			const sortBy = (key) => setSort((s) => s.key === key ? {
				key,
				dir: s.dir === 1 ? -1 : 1
			} : {
				key,
				dir: 1
			});
			const arrow = (key) => sort.key === key ? sort.dir === 1 ? " ↑" : " ↓" : "";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					minHeight: 0,
					overflow: "hidden",
					display: "flex",
					flexDirection: "column",
					background: BG,
					color: TEXT
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "10px 16px",
							background: HEADER_BG,
							borderBottom: `1px solid ${BORDER}`,
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: 10
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 14,
								fontWeight: 700
							},
							children: "Table"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								fontSize: 12,
								color: "#888"
							},
							children: [
								rows.length,
								"/",
								tickets.length,
								" tickets",
								statusSet.size < STATUS_ORDER.length && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: "#666" },
									children: "（默认隐藏已完成；勾 Status 里的 Done 可看）"
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							flex: 1,
							display: "flex",
							overflow: "hidden"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								width: 200,
								flexShrink: 0,
								background: HEADER_BG,
								borderRight: `1px solid ${BORDER}`,
								padding: 12,
								display: "flex",
								flexDirection: "column",
								gap: 14,
								overflowY: "auto"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 10,
										fontWeight: 700,
										color: "#777",
										textTransform: "uppercase",
										marginBottom: 4
									},
									children: "Search"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									style: {
										width: "100%",
										padding: "5px 8px",
										borderRadius: 6,
										border: `1px solid ${BORDER}`,
										background: HEADER_BG,
										color: TEXT,
										fontSize: 12,
										outline: "none",
										boxSizing: "border-box"
									},
									placeholder: "title / body / owner…",
									value: query,
									onChange: (e) => setQuery(e.target.value)
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 10,
										fontWeight: 700,
										color: "#777",
										textTransform: "uppercase",
										marginBottom: 4
									},
									children: "Status"
								}), STATUS_ORDER.map((s) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: 6,
										fontSize: 12,
										color: TEXT_DIM,
										cursor: "pointer",
										padding: "1px 0"
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											type: "checkbox",
											checked: statusSet.has(s),
											onChange: () => setStatusSet(toggle(statusSet, s))
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: { color: DOT[s] },
											children: "●"
										}),
										" ",
										STATUS_LABELS[s]
									]
								}, s))] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 10,
										fontWeight: 700,
										color: "#777",
										textTransform: "uppercase",
										marginBottom: 4
									},
									children: "Kind"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										display: "flex",
										flexWrap: "wrap",
										gap: 4
									},
									children: [
										"ticket",
										"approval",
										"note"
									].map((k) => {
										const meta = KIND_META[k];
										const on = kindSet.has(k);
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: {
												fontSize: 10,
												padding: "2px 7px",
												borderRadius: 999,
												cursor: "pointer",
												border: `1px solid ${meta.color}`,
												color: on ? "#fff" : meta.color,
												background: on ? meta.color : "transparent"
											},
											onClick: () => setKindSet(toggle(kindSet, k)),
											children: [
												meta.icon,
												" ",
												meta.label
											]
										}, k);
									})
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										fontSize: 10,
										fontWeight: 700,
										color: "#777",
										textTransform: "uppercase",
										marginBottom: 4
									},
									children: "Type"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										display: "flex",
										flexWrap: "wrap",
										gap: 4
									},
									children: allTypes.map((t) => {
										const theme = t === NO_TYPE ? {
											icon: "∅",
											color: TEXT_FAINT
										} : typeTheme(t);
										const on = typeSet.has(t);
										const label = t === NO_TYPE ? "（无 type）" : t;
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: {
												fontSize: 10,
												padding: "2px 7px",
												borderRadius: 999,
												cursor: "pointer",
												border: `1px solid ${theme.color}`,
												color: on ? "#fff" : theme.color,
												background: on ? theme.color : "transparent"
											},
											onClick: () => setTypeSet(toggle(typeSet, t)),
											children: [
												theme.icon,
												" ",
												label
											]
										}, t);
									})
								})] }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									style: {
										display: "flex",
										alignItems: "center",
										gap: 6,
										fontSize: 12,
										color: TEXT_DIM,
										cursor: "pointer"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										type: "checkbox",
										checked: onlyBlocked,
										onChange: (e) => setOnlyBlocked(e.target.checked)
									}), " Only blocked"]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									style: {
										marginTop: "auto",
										padding: "6px 0",
										borderRadius: 6,
										border: `1px solid ${BORDER}`,
										background: HEADER_BG,
										color: "#888",
										cursor: "pointer",
										fontSize: 11
									},
									onClick: () => {
										setQuery("");
										setStatusSet(new Set(OUTSTANDING));
										setTypeSet(new Set(allTypes));
										setKindSet(/* @__PURE__ */ new Set([
											"ticket",
											"approval",
											"note"
										]));
										setOnlyBlocked(false);
									},
									children: "Reset"
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								flex: 1,
								overflowY: "auto",
								padding: 12
							},
							children: rows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									padding: 40,
									textAlign: "center",
									color: TEXT_FAINT
								},
								children: "No matching tickets"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("table", {
								style: {
									width: "100%",
									borderCollapse: "separate",
									borderSpacing: 0,
									background: HEADER_BG,
									borderRadius: 8,
									overflow: "hidden",
									fontSize: 12
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", { children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", {
										style: {
											textAlign: "left",
											padding: "7px 10px",
											fontSize: 10,
											fontWeight: 700,
											color: "#777",
											textTransform: "uppercase",
											borderBottom: `1px solid ${BORDER}`,
											background: HEADER_BG,
											cursor: "pointer"
										},
										onClick: () => sortBy("num"),
										children: ["# ", arrow("num")]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										style: {
											textAlign: "left",
											padding: "7px 10px",
											fontSize: 10,
											fontWeight: 700,
											color: "#777",
											textTransform: "uppercase",
											borderBottom: `1px solid ${BORDER}`,
											background: HEADER_BG
										},
										children: "Title"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", {
										style: {
											textAlign: "left",
											padding: "7px 10px",
											fontSize: 10,
											fontWeight: 700,
											color: "#777",
											textTransform: "uppercase",
											borderBottom: `1px solid ${BORDER}`,
											background: HEADER_BG,
											cursor: "pointer"
										},
										onClick: () => sortBy("kind"),
										children: ["Kind ", arrow("kind")]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", {
										style: {
											textAlign: "left",
											padding: "7px 10px",
											fontSize: 10,
											fontWeight: 700,
											color: "#777",
											textTransform: "uppercase",
											borderBottom: `1px solid ${BORDER}`,
											background: HEADER_BG,
											cursor: "pointer"
										},
										onClick: () => sortBy("type"),
										children: ["Type ", arrow("type")]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("th", {
										style: {
											textAlign: "left",
											padding: "7px 10px",
											fontSize: 10,
											fontWeight: 700,
											color: "#777",
											textTransform: "uppercase",
											borderBottom: `1px solid ${BORDER}`,
											background: HEADER_BG,
											cursor: "pointer"
										},
										onClick: () => sortBy("status"),
										children: ["Status ", arrow("status")]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										style: {
											textAlign: "left",
											padding: "7px 10px",
											fontSize: 10,
											fontWeight: 700,
											color: "#777",
											textTransform: "uppercase",
											borderBottom: `1px solid ${BORDER}`,
											background: HEADER_BG
										},
										children: "Owner"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										style: {
											textAlign: "left",
											padding: "7px 10px",
											fontSize: 10,
											fontWeight: 700,
											color: "#777",
											textTransform: "uppercase",
											borderBottom: `1px solid ${BORDER}`,
											background: HEADER_BG
										},
										children: "Blocked"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("th", {
										style: {
											textAlign: "left",
											padding: "7px 10px",
											fontSize: 10,
											fontWeight: 700,
											color: "#777",
											textTransform: "uppercase",
											borderBottom: `1px solid ${BORDER}`,
											background: HEADER_BG
										},
										children: "Path"
									})
								] }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: rows.map((t) => {
									const th = typeTheme(t.type);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
										style: { cursor: "pointer" },
										onClick: () => setDetail(t),
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid ${BORDER_LIGHT}`,
													fontFamily: "monospace",
													color: TEXT_FAINT,
													fontSize: 11
												},
												children: shortId(t)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid ${BORDER_LIGHT}`,
													fontWeight: 600,
													color: TEXT,
													maxWidth: 200,
													overflow: "hidden",
													textOverflow: "ellipsis",
													whiteSpace: "nowrap"
												},
												children: t.title
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid ${BORDER_LIGHT}`
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													style: {
														padding: "1px 6px",
														borderRadius: 999,
														background: `${ticketDisplayMeta(t).color}1e`,
														color: ticketDisplayMeta(t).color,
														border: `1px solid ${ticketDisplayMeta(t).color}44`,
														fontSize: 11
													},
													children: [
														ticketDisplayMeta(t).icon,
														" ",
														ticketDisplayMeta(t).label
													]
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid ${BORDER_LIGHT}`
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													style: {
														padding: "1px 6px",
														borderRadius: 999,
														background: `${th.color}1e`,
														color: th.color,
														border: `1px solid ${th.color}44`,
														fontSize: 11
													},
													children: [
														th.icon,
														" ",
														t.type ?? "（无 type）"
													]
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid ${BORDER_LIGHT}`
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													style: {
														display: "flex",
														alignItems: "center",
														gap: 5
													},
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
														width: 7,
														height: 7,
														borderRadius: "50%",
														background: DOT[displayStatus(t)]
													} }), STATUS_LABELS[displayStatus(t)]]
												})
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid ${BORDER_LIGHT}`,
													color: t.claimedBy ? "#f7ad31" : TEXT_FAINT
												},
												children: t.claimedBy ?? "—"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid ${BORDER_LIGHT}`,
													color: t.blockedBy.length > 0 ? "#f2555a" : TEXT_FAINT,
													fontFamily: "monospace",
													fontSize: 11
												},
												children: t.blockedBy.length > 0 ? t.blockedBy.map((n) => `#${n}`).join(" ") : "—"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
												style: {
													padding: "7px 10px",
													borderBottom: `1px solid ${BORDER_LIGHT}`,
													maxWidth: 260
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
													ticket: t,
													scope,
													ctx
												})
											})
										]
									}, t.file);
								}) })]
							})
						})]
					}),
					detail && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: detail,
						planDir,
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setDetail(null),
						readOnly
					})
				]
			});
		}
		const NODE_W = 176;
		const STEP_X = 200;
		const NODE_H = 66;
		const RUNG_TOP = 140;
		const RUNG_STEP = 110;
		const START_Y = 36;
		const END_GAP = 110;
		const CAP_H = 30;
		const CAP_W = 100;
		const START = "\0start";
		const END = "\0end";
		function layoutGraph(tickets) {
			const grid = tickets.filter((t) => !t.outOfScope);
			const side = tickets.filter((t) => t.outOfScope);
			const byId = new Map(tickets.map((t) => [t.id, t]));
			const deps = /* @__PURE__ */ new Map();
			for (const t of tickets) deps.set(t.id, t.blockedBy.map((r) => resolveRef(r, byId)).filter((x) => x !== void 0));
			const depsOf = (t) => deps.get(t.id) ?? [];
			const depth = /* @__PURE__ */ new Map();
			const visit = (n) => {
				if (depth.has(n)) return depth.get(n);
				const t = byId.get(n);
				if (!t) return 0;
				const d = depsOf(t).filter((b) => byId.has(b) && !byId.get(b).outOfScope).reduce((m, b) => Math.max(m, visit(b)), 0) + 1;
				depth.set(n, d);
				return d;
			};
			for (const t of grid) visit(t.id);
			const maxL = Math.max(1, ...grid.map((t) => depth.get(t.id)));
			const layers = Array.from({ length: maxL }, () => []);
			for (const t of grid) layers[depth.get(t.id) - 1].push(t);
			const cmp = (a, b) => a.id.localeCompare(b.id, void 0, { numeric: true });
			layers[0].sort(cmp);
			for (let l = 1; l < maxL; l++) {
				const upIdx = /* @__PURE__ */ new Map();
				layers[l - 1].forEach((t, i) => upIdx.set(t.id, i));
				layers[l].sort((a, b) => {
					const pa = depsOf(a).filter((p) => upIdx.has(p)), pb = depsOf(b).filter((p) => upIdx.has(p));
					return pa.reduce((s, p) => s + upIdx.get(p), 0) / Math.max(1, pa.length) - pb.reduce((s, p) => s + upIdx.get(p), 0) / Math.max(1, pb.length) || cmp(a, b);
				});
			}
			const maxCount = Math.max(...layers.map((o) => o.length), 1);
			const W_MAIN = Math.max(600, maxCount * STEP_X + 40);
			const sideGap = 48;
			const sideRows = /* @__PURE__ */ new Map();
			let maxSideRow = 0;
			for (const t of side) {
				const p = depsOf(t).find((b) => byId.has(b) && !byId.get(b).outOfScope);
				let tier = 0;
				if (p !== void 0) {
					const parentTier = layers.findIndex((l) => l.some((tk) => tk.id === p));
					tier = (parentTier >= 0 ? parentTier : 0) + 1;
				}
				const yKey = RUNG_TOP + tier * RUNG_STEP;
				if (!sideRows.has(yKey)) sideRows.set(yKey, []);
				sideRows.get(yKey).push(t);
				maxSideRow = Math.max(maxSideRow, sideRows.get(yKey).length);
			}
			const W = side.length > 0 ? Math.max(W_MAIN, W_MAIN + sideGap + (maxSideRow - 1) * STEP_X + NODE_W + 40) : W_MAIN;
			const pos = /* @__PURE__ */ new Map();
			layers.forEach((o, li) => {
				const lw = o.length * STEP_X - 24;
				const left = (W_MAIN - lw) / 2;
				o.forEach((t, i) => {
					const x = left + i * STEP_X;
					pos.set(t.id, {
						x,
						cx: x + NODE_W / 2,
						y: RUNG_TOP + li * RUNG_STEP
					});
				});
			});
			const laneX = W_MAIN + sideGap;
			const sidePos = /* @__PURE__ */ new Map();
			for (const [y, row] of sideRows) row.forEach((t, i) => {
				const x = laneX + i * STEP_X;
				sidePos.set(t.id, {
					x,
					cx: x + NODE_W / 2,
					y
				});
			});
			const childrenOf = /* @__PURE__ */ new Map();
			const edges = [];
			for (const t of grid) {
				const n = t.id;
				for (const p of depsOf(t)) if (byId.has(p) && !byId.get(p).outOfScope) {
					const key = `e${p}-${n}`;
					edges.push({
						from: p,
						to: n,
						key
					});
					if (!childrenOf.has(p)) childrenOf.set(p, []);
					childrenOf.get(p).push(n);
				}
			}
			layers[0].map((t) => t.id).forEach((r, i) => edges.push({
				from: START,
				to: r,
				key: `s${i}`
			}));
			grid.filter((t) => (childrenOf.get(t.id) ?? []).length === 0 && t.done).map((t) => t.id).forEach((l, i) => edges.push({
				from: l,
				to: END,
				key: `l${i}`
			}));
			for (const t of side) {
				const n = t.id;
				const p = depsOf(t).find((b) => byId.has(b));
				if (p !== void 0) edges.push({
					from: p,
					to: n,
					dashed: true,
					key: `d${p}-${n}`
				});
			}
			const endY = RUNG_TOP + (maxL - 1) * RUNG_STEP + END_GAP;
			const maxSideY = sidePos.size > 0 ? Math.max(...[...sidePos.values()].map((p) => p.y)) : 0;
			return {
				pos,
				sidePos,
				edges,
				W,
				H: Math.max(endY + CAP_H / 2 + 40, maxSideY + NODE_H + 40),
				capX: W_MAIN / 2,
				endY,
				startCapY: START_Y - CAP_H / 2,
				endCapY: endY - CAP_H / 2
			};
		}
		function ViewD({ tickets, planDir, scope, ctx, sessions, onChanged, readOnly }) {
			const [sel, setSel] = (0, react.useState)(null);
			const [hover, setHover] = (0, react.useState)(null);
			const { pos, sidePos, edges, W, H, capX, startCapY, endCapY, endY } = (0, react.useMemo)(() => layoutGraph(tickets), [tickets]);
			const focus = tickets.find((t) => t.id === sel) ?? null;
			const conn = (n) => {
				const keys = /* @__PURE__ */ new Set();
				for (const e of edges) if (e.from === n || e.to === n) keys.add(e.key);
				return keys;
			};
			const mk = (x1, y1, x2, y2) => `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					background: BG,
					color: TEXT,
					overflow: "hidden"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "12px 16px 8px",
							display: "flex",
							justifyContent: "space-between"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 14,
								fontWeight: 700
							},
							children: "Relation"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								fontSize: 12,
								color: "#888"
							},
							children: [tickets.length, " tickets · hover / click node to highlight edges"]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							overflow: "auto",
							position: "relative",
							cursor: "default"
						},
						onClick: () => setSel(null),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								position: "relative",
								width: W,
								height: H,
								margin: "0 auto"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										position: "absolute",
										left: capX - CAP_W / 2,
										top: startCapY,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										width: CAP_W,
										height: CAP_H,
										borderRadius: 999,
										background: CARD,
										border: `2px solid ${BORDER}`,
										fontSize: 12,
										fontWeight: 800,
										color: TEXT,
										boxShadow: "0 2px 10px rgba(0,0,0,.4)"
									},
									children: "Start"
								}),
								[...pos.entries()].map(([n, p]) => {
									const t = tickets.find((x) => x.id === n);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											position: "absolute",
											display: "flex",
											background: CARD,
											borderRadius: 10,
											overflow: "hidden",
											cursor: "pointer",
											zIndex: 3,
											boxShadow: sel === n || hover === n ? "0 4px 20px rgba(0,0,0,.5), 0 0 0 2px #fff3" : "0 3px 12px rgba(0,0,0,.3)",
											border: `1px solid ${BORDER}`,
											width: NODE_W,
											height: NODE_H,
											left: p.x,
											top: p.y
										},
										onClick: (e) => {
											e.stopPropagation();
											setSel(n);
										},
										onMouseEnter: () => setHover(n),
										onMouseLeave: () => setHover(null),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
											width: 4,
											flexShrink: 0,
											borderTopLeftRadius: 10,
											borderBottomLeftRadius: 10,
											background: DOT[displayStatus(t)]
										} }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												padding: "7px 8px 7px 8px",
												flex: 1,
												minWidth: 0,
												display: "flex",
												flexDirection: "column",
												gap: 3
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: {
														display: "flex",
														alignItems: "center",
														gap: 5
													},
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															style: {
																fontSize: 9,
																fontFamily: "monospace",
																color: "#888",
																background: CHIP_BG,
																borderRadius: 999,
																minWidth: 18,
																height: 18,
																padding: "0 4px",
																boxSizing: "border-box",
																display: "flex",
																alignItems: "center",
																justifyContent: "center",
																fontWeight: 700
															},
															children: shortId(t)
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															style: { fontSize: 12 },
															children: ticketDisplayMeta(t).icon
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															style: {
																fontSize: 11,
																fontWeight: 700,
																color: TEXT,
																lineHeight: 1.3,
																overflow: "hidden",
																textOverflow: "ellipsis",
																whiteSpace: "nowrap",
																flex: 1
															},
															children: t.title
														})
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: {
														fontSize: 9,
														color: TEXT_FAINT,
														display: "flex",
														gap: 6
													},
													children: [STATUS_LABELS[displayStatus(t)], t.claimedBy && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [" 👤 ", t.claimedBy] })]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
													ticket: t,
													scope,
													ctx,
													size: 9
												})
											]
										})]
									}, n);
								}),
								[...sidePos.entries()].map(([n, p]) => {
									const t = tickets.find((x) => x.id === n);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											position: "absolute",
											display: "flex",
											background: CARD_DARK,
											borderRadius: 10,
											overflow: "hidden",
											cursor: "pointer",
											zIndex: 3,
											boxShadow: "0 2px 8px rgba(0,0,0,.3)",
											border: "2px dashed #383860",
											width: NODE_W,
											height: NODE_H,
											left: p.x,
											top: p.y
										},
										onClick: (e) => {
											e.stopPropagation();
											setSel(n);
										},
										onMouseEnter: () => setHover(n),
										onMouseLeave: () => setHover(null),
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
											width: 4,
											flexShrink: 0,
											background: "rgba(255,255,255,.16)"
										} }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												padding: "7px 8px 7px 8px",
												flex: 1,
												minWidth: 0,
												display: "flex",
												flexDirection: "column",
												gap: 3
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: {
														display: "flex",
														alignItems: "center",
														gap: 5
													},
													children: [
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															style: {
																fontSize: 9,
																fontFamily: "monospace",
																color: "#888",
																background: CHIP_BG,
																borderRadius: 999,
																minWidth: 18,
																height: 18,
																padding: "0 4px",
																boxSizing: "border-box",
																display: "flex",
																alignItems: "center",
																justifyContent: "center",
																fontWeight: 700
															},
															children: shortId(t)
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															style: { fontSize: 12 },
															children: "⛔"
														}),
														/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															style: {
																fontSize: 11,
																fontWeight: 700,
																color: TEXT,
																lineHeight: 1.3,
																overflow: "hidden",
																textOverflow: "ellipsis",
																whiteSpace: "nowrap",
																flex: 1
															},
															children: t.title
														})
													]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													style: {
														fontSize: 9,
														color: TEXT_FAINT
													},
													children: "ruled out"
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
													ticket: t,
													scope,
													ctx,
													size: 9
												})
											]
										})]
									}, n);
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: {
										position: "absolute",
										left: capX - CAP_W / 2,
										top: endCapY,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										width: CAP_W,
										height: CAP_H,
										borderRadius: 999,
										background: CARD,
										border: `2px solid ${BORDER}`,
										fontSize: 12,
										fontWeight: 800,
										color: TEXT,
										boxShadow: "0 2px 10px rgba(0,0,0,.4)"
									},
									children: "End"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
									width: W,
									height: H,
									style: {
										position: "absolute",
										left: 0,
										top: 0,
										pointerEvents: "none",
										zIndex: 1
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("defs", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("marker", {
										id: "da",
										viewBox: "0 0 10 10",
										refX: "8.5",
										refY: "5",
										markerWidth: "6",
										markerHeight: "6",
										orient: "auto-start-reverse",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
											d: "M 0 0 L 10 5 L 0 10 z",
											fill: "#454570"
										})
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("marker", {
										id: "da2",
										viewBox: "0 0 10 10",
										refX: "8.5",
										refY: "5",
										markerWidth: "6",
										markerHeight: "6",
										orient: "auto-start-reverse",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
											d: "M 0 0 L 10 5 L 0 10 z",
											fill: TEXT
										})
									})] }), edges.map((e) => {
										const aPos = e.from === START ? {
											cx: capX,
											y: startCapY
										} : pos.get(e.from);
										const bPos = e.to === END ? {
											cx: capX,
											y: endY
										} : pos.get(e.to) ?? sidePos.get(e.to);
										if (!aPos || !bPos) return null;
										const active = hover ?? sel;
										const connected = active === null || conn(active).has(e.key);
										const sx = aPos.cx, sy = e.from === START ? startCapY + CAP_H : aPos.y + NODE_H;
										const ex = e.to === END ? capX : bPos.cx;
										const ey = e.to === END ? endY : e.dashed ? bPos.y : bPos.y + NODE_H / 2;
										const sw = e.dashed ? 1.4 : connected ? 3 : 1.4;
										const sc = e.dashed ? "rgba(255,255,255,.35)" : connected ? TEXT : "rgba(255,255,255,.22)";
										return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
											d: mk(sx, sy, ex, ey),
											fill: "none",
											stroke: sc,
											strokeWidth: sw,
											strokeDasharray: e.dashed ? "5 4" : void 0,
											opacity: active !== null && !connected ? .45 : 1,
											markerEnd: connected && !e.dashed ? "url(#da2)" : e.dashed ? void 0 : "url(#da)",
											style: { transition: "stroke-width .18s, opacity .18s" }
										}, e.key);
									})]
								})
							]
						})
					}),
					focus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: focus,
						planDir,
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setSel(null),
						readOnly
					})
				]
			});
		}
		function effortStage(own) {
			const open = own.filter((t) => ticketKind(t) === "ticket" && (displayStatus(t) === "open" || displayStatus(t) === "claimed"));
			const pend = own.filter((t) => ticketKind(t) === "approval" && isPending(t));
			const byId = new Map(own.map((t) => [t.id, t]));
			const unmet = (t) => t.blockedBy.some((r) => {
				const b = resolveRef(r, byId);
				const bt = b === void 0 ? void 0 : byId.get(b);
				return bt !== void 0 && (displayStatus(bt) === "open" || displayStatus(bt) === "claimed");
			});
			const frontier = open.filter((t) => !unmet(t));
			if (open.length > 0) return frontier.length > 0 ? {
				stage: "② 落地链中",
				color: ACCENT_SOFT
			} : {
				stage: "⛔ 卡 blocked",
				color: "#f2555a"
			};
			if (pend.length > 0) return {
				stage: "① 决策循环中",
				color: "#f7ad31"
			};
			return {
				stage: "✅ 收口",
				color: "#4ed17e"
			};
		}
		function inEffort(t, dir) {
			return t.effort === dir || t.effort === ROOT_GROUP;
		}
		const isDshSession = (id) => id.startsWith("session-");
		function SpeculationTypeView({ kind, tickets, assetFiles, cwd, planDir, scope, ctx, sessions, onChanged, readOnly }) {
			const [focus, setFocus] = (0, react.useState)(null);
			const rows = (0, react.useMemo)(() => tickets.filter((t) => (t.type ?? "").trim().toLowerCase() === kind), [tickets, kind]);
			if (rows.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					padding: 24,
					fontSize: 12.5,
					color: TEXT_FAINT
				},
				children: [
					"当前范围没有 ",
					SPECULATION_TICKET_META[kind]?.label ?? kind,
					"——它们由 wayfinder 推演产出，票 frontmatter ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						style: {
							fontSize: 11,
							background: HEADER_BG,
							border: `1px solid ${BORDER}`,
							borderRadius: 4,
							padding: "1px 5px"
						},
						children: "type"
					}),
					" 区分，产物经 ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
						style: {
							fontSize: 11,
							background: HEADER_BG,
							border: `1px solid ${BORDER}`,
							borderRadius: 4,
							padding: "1px 5px"
						},
						children: "assets:"
					}),
					" 字段链接。"
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					overflow: "auto",
					padding: "10px 14px"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							fontSize: 11,
							color: TEXT_FAINT,
							marginBottom: 8
						},
						children: [
							SPECULATION_TICKET_META[kind]?.icon,
							" ",
							SPECULATION_TICKET_META[kind]?.label,
							" 全量清单（含已收口）；「产物」列 = 票 frontmatter assets: 字段命中的资产文件（存仓、经字段链接、不贴正文）。"
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("table", {
						style: {
							width: "100%",
							borderCollapse: "collapse",
							fontSize: 12.5
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("tbody", { children: rows.map((t) => {
							const linked = t.assets.length === 0 ? [] : assetFiles.filter((a) => a.path !== void 0 && t.assets.some((ref) => sameAssetRef(a.path, ref, cwd)));
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("tr", {
								style: {
									cursor: "pointer",
									borderBottom: `1px solid ${BORDER_LIGHT}`
								},
								onClick: () => setFocus(t),
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										style: {
											padding: "7px 10px",
											width: 1,
											whiteSpace: "nowrap"
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: {
												fontSize: 10,
												padding: "1px 6px",
												borderRadius: 999,
												background: `${ticketDisplayMeta(t).color}1e`,
												color: ticketDisplayMeta(t).color,
												border: `1px solid ${ticketDisplayMeta(t).color}44`
											},
											children: [
												ticketDisplayMeta(t).icon,
												" ",
												ticketDisplayMeta(t).label
											]
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										style: {
											padding: "7px 10px",
											color: TEXT
										},
										children: t.title
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										style: {
											padding: "7px 10px",
											whiteSpace: "nowrap",
											color: TEXT_FAINT
										},
										children: displayStatus(t)
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										style: {
											padding: "7px 10px",
											whiteSpace: "nowrap",
											color: TEXT_FAINT,
											fontSize: 11
										},
										children: t.effort && t.effort !== ROOT_GROUP ? t.effort.split("/").pop() : ""
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										style: {
											padding: "7px 10px",
											maxWidth: 300
										},
										children: linked.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: { color: TEXT_FAINT },
											children: "—"
										}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: {
												display: "flex",
												flexWrap: "wrap",
												gap: 4
											},
											children: linked.map((a) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
												ticket: a,
												scope,
												ctx
											}, a.path))
										})
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("td", {
										style: {
											padding: "7px 10px",
											maxWidth: 260
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
											ticket: t,
											scope,
											ctx
										})
									})
								]
							}, t.path);
						}) })
					}),
					focus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: focus,
						planDir,
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setFocus(null),
						readOnly
					})
				]
			});
		}
		function EffortChips({ efforts, all, effortIdx, setEffortIdx, countFor, totalCount, right }) {
			const groups = [
				"speculation",
				"impl",
				void 0
			].map((kind) => ({
				kind,
				items: efforts.map((e, i) => ({
					e,
					i,
					kind: mapKind(e.dir, all)
				})).filter((w) => w.kind === kind)
			})).filter((g) => g.items.length > 0);
			const allOn = effortIdx < 0;
			const allAccepted = (dir) => {
				const work = all.filter((t) => inEffort(t, dir) && ticketKind(t) === "ticket" && !t.outOfScope);
				return work.length > 0 && work.every((t) => t.qaAccepted);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					gap: 6,
					padding: "10px 14px 8px",
					flexWrap: "wrap",
					borderBottom: `1px solid ${BORDER_LIGHT}`,
					alignItems: "center"
				},
				children: [
					efforts.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						onClick: () => setEffortIdx(-1),
						style: {
							fontSize: 11.5,
							padding: "4px 12px",
							borderRadius: 999,
							cursor: "pointer",
							border: `1px solid ${allOn ? ACCENT : BORDER}`,
							color: allOn ? ACCENT : TEXT_FAINT,
							background: allOn ? `${ACCENT}22` : "transparent"
						},
						children: ["全部地图 ", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { opacity: .7 },
							children: totalCount
						})]
					}),
					groups.map((g) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: {
							display: "inline-flex",
							gap: 6,
							alignItems: "center",
							flexWrap: "wrap"
						},
						children: [
							groups.length > 1 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 10,
									color: TEXT_FAINT,
									padding: "3px 2px"
								},
								children: g.kind ? `${MAP_KIND_META[g.kind].icon} ${MAP_KIND_META[g.kind].label}` : "📄 其他"
							}),
							g.items.map(({ e, i, kind }) => {
								const on = effortIdx === i;
								const done = allAccepted(e.dir);
								const accent = done ? "#4ed17e" : ACCENT;
								const specOnly = e.mapRaw === "";
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									onClick: () => setEffortIdx(i),
									title: `${e.dir}${specOnly ? "（spec-only 实施图：无 map.md，凭 spec.md 加载，工单页无 Destination）" : ""}${done ? "（全部工单已验收）" : ""}`,
									style: {
										fontSize: 11.5,
										padding: "4px 12px",
										borderRadius: 999,
										cursor: "pointer",
										border: `1px solid ${on ? accent : done ? "#4ed17e55" : BORDER}`,
										color: on || done ? accent : TEXT_FAINT,
										background: on ? `${accent}22` : "transparent"
									},
									children: [
										kind ? MAP_KIND_META[kind].icon : "🗺️",
										" ",
										e.dir.split("/").pop(),
										specOnly ? " 📄" : "",
										" ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: { opacity: .7 },
											children: countFor(e.dir)
										})
									]
								}, e.dir);
							}),
							g !== groups[groups.length - 1] && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
								width: 1,
								height: 16,
								background: BORDER,
								margin: "0 4px"
							} })
						]
					}, String(g.kind))),
					right && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							marginLeft: "auto",
							display: "inline-flex",
							alignItems: "center"
						},
						children: right
					})
				]
			});
		}
		function OverviewView({ tickets, efforts, cases, tests, defects, ledgers, effortIdx, setEffortIdx, planDir, scope, ctx, sessions, onChanged, readOnly }) {
			const [focus, setFocus] = (0, react.useState)(null);
			const byId = new Map(tickets.map((t) => [t.id, t]));
			const selectedDir = effortIdx >= 0 ? efforts[effortIdx]?.dir : void 0;
			const shownEfforts = effortIdx < 0 ? efforts : efforts.filter((_, i) => i === effortIdx);
			const visible = (0, react.useMemo)(() => selectedDir === void 0 ? tickets : tickets.filter((t) => inEffort(t, selectedDir)), [tickets, selectedDir]);
			const unmetBlocker = (t) => t.blockedBy.some((r) => {
				const b = resolveRef(r, byId);
				const bt = b === void 0 ? void 0 : byId.get(b);
				return bt !== void 0 && (displayStatus(bt) === "open" || displayStatus(bt) === "claimed");
			});
			const oldestPending = (0, react.useMemo)(() => visible.filter((t) => ticketKind(t) === "approval" && isPending(t)).sort((a, b) => (ageDays(b) ?? -1) - (ageDays(a) ?? -1)).slice(0, 5), [visible]);
			const longestBlocked = (0, react.useMemo)(() => visible.filter((t) => ticketKind(t) === "ticket" && (displayStatus(t) === "open" || displayStatus(t) === "claimed") && unmetBlocker(t)).sort((a, b) => (ageDays(b) ?? -1) - (ageDays(a) ?? -1)).slice(0, 5), [visible]);
			const running = (0, react.useMemo)(() => visible.filter((t) => t.session !== void 0 && (displayStatus(t) === "open" || displayStatus(t) === "claimed")), [visible]);
			const readyTickets = (0, react.useMemo)(() => visible.filter((t) => ticketKind(t) === "ticket" && displayStatus(t) === "open" && !unmetBlocker(t)), [visible]);
			const stuckTickets = (0, react.useMemo)(() => visible.filter((t) => displayStatus(t) === "claimed" && (() => {
				const s = t.session !== void 0 ? sessions.get(t.session) : void 0;
				return s === void 0 || !s.running || (ageDays(t) ?? 0) >= 2;
			})()), [visible, sessions]);
			const openDefects = (0, react.useMemo)(() => defects.flatMap((f) => {
				const single = parseDefectFile(f);
				if (single !== void 0) return DEFECT_CLOSED.has(defectStateWord(single.state)) ? [] : [{
					ticket: f,
					label: `${single.id} ${single.title}`,
					sub: single.state
				}];
				return parseDefectEntries(f.body).filter((d) => !DEFECT_CLOSED.has(defectStateWord(d.state))).map((d) => ({
					ticket: f,
					label: `${d.id} ${d.title}`,
					sub: d.state
				}));
			}), [defects]);
			const activeLedgers = (0, react.useMemo)(() => ledgers.flatMap((f) => {
				const e = parseLedgerEntries(f.body)[0];
				if (e === void 0 || ledgerStage(e, f.effort, tickets) !== "可启动") return [];
				return [{
					ticket: f,
					label: `${e.id} ${e.title}`,
					sub: e.source || f.effort?.split("/").pop() || ""
				}];
			}), [ledgers, tickets]);
			const row = (t, right) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				onClick: () => setFocus(t),
				style: {
					display: "flex",
					alignItems: "center",
					gap: 8,
					padding: "6px 8px",
					borderRadius: 7,
					cursor: "pointer",
					background: "transparent"
				},
				onMouseEnter: (e) => {
					e.currentTarget.style.background = RAISED;
				},
				onMouseLeave: (e) => {
					e.currentTarget.style.background = "transparent";
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 10,
							fontFamily: "monospace",
							color: TEXT_FAINT,
							minWidth: 28
						},
						children: shortId(t)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						style: {
							flex: 1,
							minWidth: 0,
							display: "flex",
							flexDirection: "column",
							gap: 1
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 12.5,
								color: TEXT,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap"
							},
							children: t.title
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
							ticket: t,
							scope,
							ctx,
							size: 10
						})]
					}),
					right
				]
			}, `${t.effort}/${t.file}`);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					overflowY: "auto",
					padding: 16,
					display: "flex",
					flexDirection: "column",
					gap: 14
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(EffortChips, {
						efforts,
						all: tickets,
						effortIdx,
						setEffortIdx,
						countFor: (dir) => tickets.filter((t) => inEffort(t, dir) && ticketKind(t) === "ticket").length,
						totalCount: tickets.filter((t) => ticketKind(t) === "ticket").length
					}),
					[
						"speculation",
						"impl",
						void 0
					].map((kind) => ({
						kind,
						items: shownEfforts.map((e, i) => ({
							e,
							i
						})).filter(({ e }) => mapKind(e.dir, tickets) === kind)
					})).filter((g) => g.items.length > 0).map((g) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 8
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								fontSize: 12,
								fontWeight: 700,
								color: TEXT_DIM
							},
							children: [g.kind ? `${MAP_KIND_META[g.kind].icon} ${MAP_KIND_META[g.kind].label}` : "📄 其他地图", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: {
									fontWeight: 400,
									color: TEXT_FAINT,
									marginLeft: 6
								},
								children: [g.items.length, " 张"]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								gap: 10,
								flexWrap: "wrap"
							},
							children: g.items.map(({ e }) => {
								const own = tickets.filter((t) => t.effort === e.dir || t.effort === ROOT_GROUP);
								const kind = mapKind(e.dir, tickets);
								const prog = effortProgress(own, e.dir, cases, tests, kind, e.specRaw);
								const { pct, locked, lockPct, lockKind } = prog;
								const unsettled = own.filter((t) => {
									const k = ticketKind(t);
									if (k === "note" || k === "cases") return false;
									if (k === "ticket" && t.outOfScope) return false;
									return !isSettled(t, k);
								}).length;
								const { stage, color } = effortStage(own);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										flex: "1 1 220px",
										minWidth: 220,
										padding: "10px 12px",
										borderRadius: 10,
										background: CARD,
										border: `1px solid ${BORDER}`,
										borderTop: `3px solid ${color}`
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: {
												fontSize: 11,
												color: TEXT_FAINT,
												fontFamily: "monospace",
												overflow: "hidden",
												textOverflow: "ellipsis",
												whiteSpace: "nowrap"
											},
											children: e.dir.split("/").pop()
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											style: {
												fontSize: 15,
												fontWeight: 700,
												color,
												margin: "3px 0 6px"
											},
											children: stage
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												display: "flex",
												alignItems: "center",
												gap: 6
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: {
														flex: 1,
														height: 5,
														borderRadius: 3,
														background: CHIP_BG,
														overflow: "hidden",
														position: "relative"
													},
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: {
														height: "100%",
														width: `${pct}%`,
														background: `linear-gradient(90deg, #4ed17e, ${ACCENT})`
													} }), locked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
														title: lockCopy(lockKind).title,
														style: {
															position: "absolute",
															top: 0,
															right: 0,
															bottom: 0,
															width: `${lockPct}%`,
															background: LOCKED,
															cursor: "help"
														}
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													style: {
														fontSize: 11,
														fontWeight: 700,
														color: locked ? LOCKED : "#4ed17e",
														minWidth: 34,
														textAlign: "right",
														fontVariantNumeric: "tabular-nums"
													},
													children: [pct, "%"]
												}),
												locked && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													title: lockCopy(lockKind).title,
													style: {
														fontSize: 10.5,
														fontWeight: 700,
														color: LOCKED,
														background: `${LOCKED}1f`,
														border: `1px solid ${LOCKED}66`,
														borderRadius: 4,
														padding: "1px 4px",
														whiteSpace: "nowrap",
														cursor: "help"
													},
													children: lockCopy(lockKind).chip
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												fontSize: 11,
												color: TEXT_FAINT,
												marginTop: 5
											},
											children: [
												unsettled,
												" 项在途 · ",
												own.filter((t) => ticketKind(t) === "approval" && isPending(t)).length,
												" 待拍板",
												prog.specCounted && !prog.specArchived && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													title: "spec.md 是 effort 的一次性实施文档：随 effort 关闭作废归档（带 superseded-by: 注记或随轮归档）。未归档前本图到不了 100%。",
													style: {
														color: "#f7ad31",
														marginLeft: 6
													},
													children: "📄 spec 未归档"
												}),
												(() => {
													const dn = defects.filter((t) => t.effort === e.dir).length;
													if (dn === 0) return null;
													return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														style: {
															color: "#f2555a",
															marginLeft: 6
														},
														children: ["🐞 ", dn]
													});
												})()
											]
										})
									]
								}, e.dir);
							})
						})]
					}, String(g.kind))),
					(() => {
						const groups = [
							{
								title: "🚀 可开工（前置已满足）",
								color: ACCENT_SOFT,
								rows: readyTickets.map((t) => ({
									ticket: t,
									label: t.title,
									sub: `#${shortId(t)} · ${t.effort?.split("/").pop() ?? ""}`
								}))
							},
							{
								title: "🐞 待处理缺陷",
								color: "#f2555a",
								rows: openDefects
							},
							{
								title: "📒 可启动挂账",
								color: "#f7ad31",
								rows: activeLedgers
							},
							{
								title: "⏱ 卡在执行中（session 未运行 / 丢失 / 超 2 天）",
								color: "#e8894a",
								rows: stuckTickets.map((t) => {
									const s = t.session !== void 0 ? sessions.get(t.session) : void 0;
									const ext = t.session !== void 0 && !isDshSession(t.session);
									return {
										ticket: t,
										label: t.title,
										sub: ext ? `📎 zcode session：${t.session}` : s === void 0 ? "session 已丢失" : !s.running ? "session 空闲中" : `已 ${ageLabel(t) ?? "多日"}`
									};
								})
							}
						];
						const total = groups.reduce((n, g) => n + g.rows.length, 0);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								padding: "10px 12px",
								borderRadius: 10,
								background: CARD,
								border: `1px solid ${BORDER}`
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									fontSize: 12,
									fontWeight: 700,
									color: TEXT,
									marginBottom: 8
								},
								children: ["🚀 待推进 ", /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontWeight: 400,
										color: TEXT_FAINT
									},
									children: [total, " 项"]
								})]
							}), total === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: 12,
									color: TEXT_FAINT
								},
								children: "当前没有待推进项——开工的都在轨，挂账无活债，缺陷无未关闭。"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									display: "grid",
									gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
									gap: 10
								},
								children: groups.map((g) => g.rows.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										border: `1px solid ${BORDER_LIGHT}`,
										borderRadius: 8,
										padding: "8px 10px"
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											fontSize: 11,
											fontWeight: 700,
											color: g.color,
											marginBottom: 4
										},
										children: [
											g.title,
											" ",
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													fontWeight: 400,
													color: TEXT_FAINT
												},
												children: g.rows.length
											})
										]
									}), g.rows.map((r) => row(r.ticket, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										style: {
											fontSize: 10,
											color: TEXT_FAINT,
											flexShrink: 0
										},
										children: r.sub
									})))]
								}, g.title))
							})]
						});
					})(),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 12,
							flexWrap: "wrap"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								flex: "1 1 320px",
								minWidth: 300,
								padding: "10px 12px",
								borderRadius: 10,
								background: CARD,
								border: `1px solid ${BORDER}`
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: 12,
									fontWeight: 700,
									color: "#f7ad31",
									marginBottom: 6
								},
								children: "⏳ 最久待拍板"
							}), oldestPending.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: 12,
									color: TEXT_FAINT
								},
								children: "没有挂起的拍板。"
							}) : oldestPending.map((t) => row(t, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 11,
									color: "#f7ad31",
									flexShrink: 0
								},
								children: ageLabel(t) ?? "pending"
							})))]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								flex: "1 1 320px",
								minWidth: 300,
								padding: "10px 12px",
								borderRadius: 10,
								background: CARD,
								border: `1px solid ${BORDER}`
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: 12,
									fontWeight: 700,
									color: "#f2555a",
									marginBottom: 6
								},
								children: "⛔ 最长等待 blocker"
							}), longestBlocked.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: {
									fontSize: 12,
									color: TEXT_FAINT
								},
								children: "没有等依赖的票。"
							}) : longestBlocked.map((t) => row(t, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 11,
									color: "#f2555a",
									fontFamily: "monospace",
									flexShrink: 0
								},
								children: t.blockedBy.map((n) => `#${n}`).join(" ")
							})))]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "10px 12px",
							borderRadius: 10,
							background: CARD,
							border: `1px solid ${BORDER}`
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: 12,
								fontWeight: 700,
								color: ACCENT_SOFT,
								marginBottom: 6
							},
							children: "🔗 后台任务（绑 session 的在途票）"
						}), running.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: 12,
								color: TEXT_FAINT
							},
							children: "没有。从工单详情里「开始推演 / 推进」会在这里出现。"
						}) : running.map((t) => {
							const ext = t.session !== void 0 && !isDshSession(t.session);
							const s = t.session !== void 0 ? sessions.get(t.session) : void 0;
							return row(t, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: {
									fontSize: 11,
									fontFamily: "monospace",
									flexShrink: 0,
									color: ext ? "#609bfa" : s === void 0 ? "#666" : s.running ? "#4ed17e" : TEXT_FAINT
								},
								children: [
									ext ? `📎 zcode：${t.session}` : s === void 0 ? "⚪ 已回收" : s.running ? "🟢 运行中" : "⚪ 空闲",
									" ",
									t.session !== void 0 && isDshSession(t.session) && shortSession(t.session)
								]
							}));
						})]
					}),
					focus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: focus,
						planDir,
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setFocus(null),
						readOnly
					})
				]
			});
		}
		/**
		* 字号缩放（2026-10-02 用户需求：右上角可调字号）。
		*
		* 步进式档位而非连续滑块：档位可枚举、可记忆、点击即到位，读的人知道自己在哪一档。
		* 范围 0.8–1.4 兼顾「小屏塞得下」与「字太小看不清」，超出范围两端都没有实际用途。
		*/
		const FONT_SCALES = [
			.8,
			.9,
			1,
			1.1,
			1.25,
			1.4
		];
		const FONT_SCALE_KEY = "dsh-plan-view:font-scale";
		/** 读上次选择；无记录/损坏/越界一律回 1（默认），绝不让坏值把页面缩没了。 */
		function loadFontScale() {
			try {
				const raw = globalThis.localStorage?.getItem(FONT_SCALE_KEY);
				if (raw === null || raw === void 0) return 1;
				const n = Number(raw);
				return FONT_SCALES.includes(n) ? n : 1;
			} catch {
				return 1;
			}
		}
		function saveFontScale(n) {
			try {
				globalThis.localStorage?.setItem(FONT_SCALE_KEY, String(n));
			} catch {}
		}
		/**
		* 初始/换轮后应选中的图下标。`-1` = 「全部地图」聚合态。
		*
		* 单图仓（efforts.length === 1）直接选中第 0 张：此时「全部地图」与「这张图」的
		* 正文完全等价，但 mapdoc/specdoc 两个子页只在选中态才插入（`selEffort` 判空），
		* 于是单图用户永远要多点一次芯片才能看到「🗺️ map / 📄 spec」（2026-10-02 用户反馈）。
		*
		* 多图仓（≥2）保持 `-1`：聚合视角是有信息量的默认；「优先选第一张」会静默藏起
		* 其余图的票，属于无依据的推断。零图仓同样是 `-1`（无芯片可选）。
		*/
		function defaultEffortIdx(effortCount) {
			return effortCount === 1 ? 0 : -1;
		}
		function PlanView(props) {
			const { ctx } = props;
			const sessionId = props.sessionId;
			const [cwd, setCwd] = (0, react.useState)(void 0);
			const scope = {
				sessionId,
				cwd
			};
			const [data, setData] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(true);
			const [top, setTop] = (0, react.useState)("map");
			const [mapSub, setMapSub] = (0, react.useState)("route");
			const [effortIdx, setEffortIdx] = (0, react.useState)(0);
			const [variant, setVariant] = (0, react.useState)("A");
			const [sessions, setSessions] = (0, react.useState)(() => /* @__PURE__ */ new Map());
			const [rounds, setRounds] = (0, react.useState)([]);
			const [round, setRound] = (0, react.useState)(null);
			const load = (0, react.useCallback)(async () => {
				setLoading(true);
				setError(null);
				try {
					const snap = await snapshot(sessionId, round ?? void 0);
					setCwd((prev) => prev === snap.cwd ? prev : snap.cwd);
					const r = assemblePlanData(snap);
					if (r.efforts.length === 0 && r.tickets.length === 0 && r.adrs.length === 0 && r.assetFiles.length === 0) {
						setError("empty");
						setLoading(false);
						return;
					}
					setRounds(roundsOf(snap));
					setContextRaw(snap.contextRaw);
					setData(r);
				} catch {
					setError("failed");
				} finally {
					setLoading(false);
				}
			}, [sessionId, round]);
			const loadSessions = (0, react.useCallback)(() => {
				sessionList().then((items) => setSessions(new Map(items.map((s) => [s.sessionId, s])))).catch(() => setSessions(/* @__PURE__ */ new Map()));
			}, []);
			(0, react.useEffect)(() => {
				load();
			}, [load]);
			(0, react.useEffect)(() => {
				loadSessions();
			}, [loadSessions]);
			(0, react.useEffect)(() => {
				setEffortIdx(-1);
			}, [round]);
			const effortCount = data?.efforts.length ?? 0;
			(0, react.useEffect)(() => {
				setEffortIdx(defaultEffortIdx(effortCount));
			}, [effortCount, round]);
			const [contextRaw, setContextRaw] = (0, react.useState)(null);
			const [fontScale, setFontScale] = (0, react.useState)(() => loadFontScale());
			const onChanged = (0, react.useCallback)(() => {
				load();
				loadSessions();
			}, [load, loadSessions]);
			const all = data?.tickets ?? [];
			const adrs = data?.adrs ?? [];
			const assetFiles = data?.assetFiles ?? [];
			const routeTickets = (0, react.useMemo)(() => all.filter((t) => classify(t) === "ticket"), [all]);
			const approvals = (0, react.useMemo)(() => all.filter((t) => classify(t) === "approval"), [all]);
			const ledgers = (0, react.useMemo)(() => all.filter((t) => classify(t) === "ledger"), [all]);
			const defects = (0, react.useMemo)(() => all.filter((t) => classify(t) === "defect"), [all]);
			const cases = (0, react.useMemo)(() => all.filter((t) => ticketKind(t) === "cases"), [all]);
			const qaTests = (0, react.useMemo)(() => data?.qaTests ?? [], [data?.qaTests]);
			const mapOwnTickets = routeTickets;
			const selectedDir = effortIdx >= 0 ? data?.efforts[effortIdx]?.dir : void 0;
			const mapTickets = (0, react.useMemo)(() => effortIdx < 0 ? mapOwnTickets : mapOwnTickets.filter((t) => t.effort === selectedDir || t.effort === ROOT_GROUP), [
				mapOwnTickets,
				effortIdx,
				selectedDir
			]);
			const mapDefects = (0, react.useMemo)(() => defects.filter((t) => t.effort !== ROOT_GROUP && (effortIdx < 0 || t.effort === selectedDir)), [
				defects,
				effortIdx,
				selectedDir
			]);
			const mapApprovals = (0, react.useMemo)(() => effortIdx < 0 ? approvals : approvals.filter((t) => selectedDir !== void 0 && inEffort(t, selectedDir)), [
				approvals,
				effortIdx,
				selectedDir
			]);
			const globalLedgers = (0, react.useMemo)(() => ledgers.filter((t) => t.effort === ROOT_GROUP), [ledgers]);
			const mapLedgers = (0, react.useMemo)(() => ledgers.filter((t) => t.effort !== ROOT_GROUP && (effortIdx < 0 || t.effort === selectedDir)), [
				ledgers,
				effortIdx,
				selectedDir
			]);
			const mapCases = (0, react.useMemo)(() => effortIdx < 0 ? cases : cases.filter((t) => t.effort === selectedDir), [
				cases,
				effortIdx,
				selectedDir
			]);
			const destination = (0, react.useMemo)(() => {
				const mapRaw = effortIdx >= 0 ? data?.efforts[effortIdx]?.mapRaw : data?.mapRaw;
				if (!mapRaw) return null;
				return mapRaw.match(/## Destination\s*\n([\s\S]*?)(?=\n## |\n$)/)?.[1]?.trim().split("\n")[0]?.trim() ?? null;
			}, [
				data?.efforts,
				data?.mapRaw,
				effortIdx
			]);
			const refreshBtn = (label = "⟳") => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				onClick: () => void load(),
				disabled: loading,
				title: "重新读取治理目录 .scratch/.plan（别处改了文件时用）",
				"aria-label": "刷新",
				style: {
					padding: "5px 10px",
					border: `1px solid ${BORDER}`,
					borderRadius: 6,
					background: "transparent",
					color: loading ? "#555" : "#aaa",
					cursor: loading ? "default" : "pointer",
					fontSize: 12
				},
				children: loading ? "…" : label === "⟳" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					style: {
						fontSize: 22,
						lineHeight: 1
					},
					children: "⟳"
				}) : label
			});
			if (loading) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					gap: 10,
					background: BG,
					color: "#888"
				},
				children: "Loading…"
			});
			if (error || !data) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					gap: 10,
					background: BG,
					color: "#888"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: round === null ? "No .scratch/.plan found in current directory." : `轮次 ${round} 读取失败（目录可能已被移动或删除）。` }),
					refreshBtn("⟳ 重新读取"),
					" "
				]
			});
			const planDir = data.effortDir;
			const readOnly = round !== null;
			const selEffort = effortIdx >= 0 ? data.efforts[effortIdx] : void 0;
			const tabBtn = (active) => ({
				padding: "8px 14px",
				border: "none",
				borderRadius: 7,
				cursor: "pointer",
				background: active ? CARD : "transparent",
				color: active ? TEXT : "#888",
				fontSize: 12,
				fontWeight: active ? 700 : 400
			});
			const stepFontScale = (dir) => {
				const i = FONT_SCALES.indexOf(fontScale);
				const next = FONT_SCALES[Math.min(FONT_SCALES.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir))];
				if (next === void 0 || next === fontScale) return;
				setFontScale(next);
				saveFontScale(next);
			};
			const fontBtn = (atEnd) => ({
				padding: "2px 6px",
				border: "none",
				borderRadius: 4,
				background: "transparent",
				color: atEnd ? "#555" : TEXT_DIM,
				cursor: atEnd ? "default" : "pointer",
				fontSize: 11,
				fontWeight: 700
			});
			const mapTab = (active) => ({
				padding: "8px 14px 9px",
				border: "none",
				borderRadius: 0,
				cursor: "pointer",
				background: "transparent",
				color: active ? TEXT : "#888",
				fontSize: 12,
				fontWeight: active ? 700 : 400,
				borderBottom: active ? `2px solid ${ACCENT_SOFT}` : "2px solid transparent"
			});
			const subBtn = (active) => ({
				padding: "6px 14px",
				border: `1px solid ${active ? BORDER : "transparent"}`,
				borderRadius: 7,
				cursor: "pointer",
				background: active ? HEADER_BG : "transparent",
				color: active ? TEXT : "#888",
				fontSize: 11.5,
				fontWeight: active ? 700 : 400
			});
			const openTickets = (list) => list.filter((t) => ticketKind(t) === "ticket" && (displayStatus(t) === "open" || displayStatus(t) === "claimed")).length;
			const openLedgerCount = (list) => list.filter((t) => {
				const e = parseLedgerEntries(t.body)[0];
				if (e === void 0) return false;
				const stage = ledgerStage(e, t.effort, mapTickets);
				return stage === "可启动" || stage === "阻塞中";
			}).length;
			const openDefectCount = (list) => list.reduce((n, f) => {
				const single = parseDefectFile(f);
				if (single !== void 0) return n + (DEFECT_CLOSED.has(defectStateWord(single.state)) ? 0 : 1);
				return n + parseDefectEntries(f.body).filter((d) => !DEFECT_CLOSED.has(defectStateWord(d.state))).length;
			}, 0);
			const pendingApprovals = (list) => list.filter((t) => ticketKind(t) === "approval" && isPending(t)).length;
			const specCount = (type) => mapTickets.filter((t) => (t.type ?? "").trim().toLowerCase() === type).length;
			const selKind = effortIdx >= 0 && selectedDir !== void 0 ? mapKind(selectedDir, mapOwnTickets) : void 0;
			const selProg = (() => {
				if (effortIdx < 0 || selectedDir === void 0 || selEffort === void 0) return void 0;
				return effortProgress(all.filter((t) => t.effort === selectedDir || t.effort === ROOT_GROUP), selectedDir, cases, qaTests, selKind, selEffort.specRaw);
			})();
			const roundsSelect = rounds.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
				value: round ?? "",
				onChange: (e) => setRound(e.target.value === "" ? null : e.target.value),
				title: "按轮查看历史归档（.archive/rounds，只读）",
				style: {
					padding: "4px 8px",
					borderRadius: 6,
					border: `1px solid ${round !== null ? "#7a4a15" : BORDER}`,
					background: HEADER_BG,
					color: round !== null ? "#f7ad31" : TEXT_DIM,
					fontSize: 12,
					outline: "none",
					maxWidth: 280,
					cursor: "pointer"
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
					value: "",
					children: "📍 现行（.scratch + .plan）"
				}), rounds.map((r) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("option", {
					value: r.id,
					children: [
						"🗄️ ",
						r.id,
						r.topic ? ` · ${r.topic}` : ""
					]
				}, r.id))]
			});
			const tabs = [
				{
					id: "overview",
					label: "🧭 总览",
					count: pendingApprovals(approvals)
				},
				{
					id: "map",
					label: "🗺️ 地图",
					count: openTickets(mapOwnTickets)
				},
				{
					id: "cases",
					label: "🧪 测例",
					count: cases.length
				},
				{
					id: "defects",
					label: "🐞 缺陷",
					count: openDefectCount(defects)
				},
				{
					id: "ledger",
					label: "📒 台账",
					count: openLedgerCount(globalLedgers)
				},
				{
					id: "adr",
					label: "🏛️ ADR",
					count: adrs.length
				},
				{
					id: "context",
					label: "📐 CONTEXT",
					count: 0
				},
				{
					id: "guide",
					label: "📖 说明",
					count: 0
				}
			];
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					minHeight: 0,
					overflow: "hidden",
					display: "flex",
					flexDirection: "column",
					background: BG,
					color: TEXT,
					fontFamily: "sans-serif",
					fontSize: 14,
					zoom: fontScale
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 4,
							padding: "8px 12px",
							borderBottom: `1px solid ${BORDER}`,
							background: HEADER_BG,
							alignItems: "center"
						},
						children: [tabs.map((t) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							style: tabBtn(top === t.id),
							onClick: () => setTop(t.id),
							children: [t.label, t.id !== "guide" && t.count > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									marginLeft: 5,
									fontSize: 11,
									color: t.id === "approvals" || t.id === "overview" ? "#f7ad31" : "#777"
								},
								children: t.count
							})]
						}, t.id)), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								marginLeft: "auto",
								display: "flex",
								alignItems: "center",
								gap: 6
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: 1,
									padding: "2px 4px",
									border: `1px solid ${BORDER}`,
									borderRadius: 6,
									background: "transparent"
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: () => stepFontScale(-1),
										disabled: fontScale === FONT_SCALES[0],
										title: "缩小字号",
										"aria-label": "缩小字号",
										style: fontBtn(fontScale === FONT_SCALES[0]),
										children: "−"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										title: "当前字号（整页等比缩放）",
										"aria-live": "polite",
										style: {
											fontSize: 10.5,
											color: TEXT_DIM,
											minWidth: 30,
											textAlign: "center",
											fontVariantNumeric: "tabular-nums"
										},
										children: [Math.round(fontScale * 100), "%"]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										onClick: () => stepFontScale(1),
										disabled: fontScale === FONT_SCALES[FONT_SCALES.length - 1],
										title: "放大字号",
										"aria-label": "放大字号",
										style: fontBtn(fontScale === FONT_SCALES[FONT_SCALES.length - 1]),
										children: "+"
									})
								]
							}), refreshBtn()]
						})]
					}),
					round !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "6px 12px",
							background: "#241d10",
							borderBottom: "1px solid #7a4a1566",
							fontSize: 12,
							color: "#e8c9a0",
							display: "flex",
							gap: 10,
							alignItems: "center",
							flexWrap: "wrap"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							"🗄️ 历史轮次快照（只读）：",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { fontFamily: "ui-monospace,Menlo,monospace" },
								children: round
							}),
							rounds.find((r) => r.id === round)?.topic ? ` · ${rounds.find((r) => r.id === round)?.topic}` : ""
						] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { color: "#a98d5f" },
							children: "归档内容勿据以实现；派活 / 拍板动作已停用。"
						})]
					}),
					top === "map" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						data.efforts.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EffortChips, {
							efforts: data.efforts,
							all,
							effortIdx,
							setEffortIdx,
							countFor: (dir) => mapOwnTickets.filter((t) => inEffort(t, dir)).length,
							totalCount: mapOwnTickets.length,
							right: roundsSelect
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								gap: 2,
								padding: "4px 14px 0",
								borderBottom: `1px solid ${BORDER}`,
								background: BG,
								alignItems: "center"
							},
							children: [
								[
									"route",
									"🎫 工单",
									openTickets(mapTickets)
								],
								...selEffort === void 0 ? [] : selEffort.mapRaw !== "" ? [[
									"mapdoc",
									"🗺️ map",
									0
								]] : selEffort.specRaw ? [[
									"specdoc",
									"📄 spec",
									0
								]] : [],
								[
									"approvals",
									"⏳ 待拍板",
									pendingApprovals(mapApprovals)
								],
								[
									"ledger",
									"📒 台账",
									openLedgerCount(mapLedgers)
								],
								[
									"defects",
									"🐞 缺陷",
									openDefectCount(mapDefects)
								],
								[
									"cases",
									"🧪 测例",
									mapCases.reduce((n, f) => n + (f.body.match(/^\|\s*[A-Z]-?\d+/gm)?.length ?? 0), 0)
								],
								[
									"chain",
									"🧪 串联",
									buildChain(mapTickets, mapDefects, mapLedgers, mapCases).nodes.length
								],
								...selKind === "speculation" ? [
									[
										"research",
										"🔍 调研",
										specCount("research")
									],
									[
										"prototype",
										"🧩 原型",
										specCount("prototype")
									],
									[
										"grilling",
										"🔥 拷问",
										specCount("grilling")
									]
								] : []
							].map(([id, label, n]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								style: { ...mapTab(mapSub === id) },
								onClick: () => setMapSub(id),
								children: [label, n > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										marginLeft: 5,
										fontSize: 11,
										color: mapSub === id ? ACCENT_SOFT : "#777"
									},
									children: n
								})]
							}, id))
						}),
						selProg !== void 0 && [
							"route",
							"approvals",
							"ledger",
							"defects"
						].includes(mapSub) && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(EffortProgressBar, { prog: selProg }),
						mapSub === "route" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									gap: 4,
									padding: "9px 14px",
									background: BG
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: subBtn(variant === "A"),
										onClick: () => setVariant("A"),
										children: "📋 Kanban"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: subBtn(variant === "D"),
										onClick: () => setVariant("D"),
										children: "📊 Relation"
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										style: subBtn(variant === "C"),
										onClick: () => setVariant("C"),
										children: "Table"
									})
								]
							}),
							variant === "A" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ViewA, {
								tickets: mapTickets,
								planDir,
								scope,
								ctx,
								sessions,
								onChanged,
								destination,
								readOnly,
								prog: selProg
							}),
							variant === "D" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ViewD, {
								tickets: mapTickets,
								planDir,
								scope,
								ctx,
								sessions,
								onChanged,
								readOnly
							}),
							variant === "C" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ViewC, {
								tickets: mapTickets,
								planDir,
								scope,
								ctx,
								sessions,
								onChanged,
								readOnly
							})
						] }),
						mapSub === "mapdoc" && selEffort !== void 0 && selEffort.mapRaw !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DocCard, {
							icon: "🗺️",
							title: "map.md",
							path: `${selEffort.dir}/map.md`,
							scope,
							ctx,
							body: selEffort.mapRaw
						}),
						mapSub === "specdoc" && selEffort !== void 0 && !!selEffort.specRaw && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DocCard, {
							icon: "📄",
							title: "spec.md",
							path: `${selEffort.dir}/spec.md`,
							scope,
							ctx,
							body: selEffort.specRaw
						}),
						mapSub === "approvals" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ApprovalsView, {
							approvals: mapApprovals,
							scope,
							ctx,
							sessions,
							onChanged,
							readOnly
						}),
						mapSub === "ledger" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LedgerView, {
							ledgers: mapLedgers,
							mapTickets,
							scope,
							ctx,
							sessions,
							onChanged,
							readOnly
						}),
						mapSub === "defects" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DefectView, {
							defects: mapDefects,
							scope,
							ctx,
							sessions,
							onChanged,
							readOnly
						}),
						mapSub === "chain" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChainView, {
							tickets: mapTickets,
							defects: mapDefects,
							ledgers: mapLedgers,
							cases: mapCases,
							planDir,
							scope,
							ctx,
							sessions,
							onChanged,
							readOnly
						}),
						mapSub === "cases" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CasesView, {
							cases: mapCases,
							scope,
							ctx,
							readOnly
						}),
						mapSub === "research" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpeculationTypeView, {
							kind: "research",
							tickets: mapTickets,
							assetFiles,
							cwd,
							planDir,
							scope,
							ctx,
							sessions,
							onChanged,
							readOnly
						}),
						mapSub === "prototype" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpeculationTypeView, {
							kind: "prototype",
							tickets: mapTickets,
							assetFiles,
							cwd,
							planDir,
							scope,
							ctx,
							sessions,
							onChanged,
							readOnly
						}),
						mapSub === "grilling" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpeculationTypeView, {
							kind: "grilling",
							tickets: mapTickets,
							assetFiles,
							cwd,
							planDir,
							scope,
							ctx,
							sessions,
							onChanged,
							readOnly
						})
					] }),
					top === "cases" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							flex: 1,
							display: "flex",
							flexDirection: "column",
							overflow: "hidden"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								padding: "8px 14px",
								borderBottom: `1px solid ${BORDER}`,
								fontSize: 11,
								color: TEXT_FAINT
							},
							children: "测例聚合（2026-09-30 拍板拆分）：各 effort `qa/cases.md` ＋ 全局回测 `.plan/qa/cases-*.md`；图内测例也在地图页「🧪 测例」子页按图查看。"
						}), cases.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CasesView, {
							cases,
							scope,
							ctx,
							readOnly
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								flex: 1,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								color: TEXT_FAINT
							},
							children: "暂无测例文档（一图一份 `qa/cases.md`；无图归属回测落 `.plan/qa/cases-*.md`）。"
						})]
					}),
					top === "defects" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							flex: 1,
							display: "flex",
							flexDirection: "column",
							overflow: "hidden"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								padding: "8px 14px",
								borderBottom: `1px solid ${BORDER}`,
								fontSize: 11,
								color: TEXT_FAINT
							},
							children: "缺陷聚合（2026-09-30 拍板拆分）：各 effort `qa/DEF-*.md` ＋ 全局无图归属 `.plan/qa/` 缺陷；图内缺陷也在地图页「🐞 缺陷」子页按图查看。"
						}), defects.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DefectView, {
							defects,
							scope,
							ctx,
							sessions,
							onChanged,
							readOnly
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								flex: 1,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								color: TEXT_FAINT
							},
							children: "暂无缺陷文档（`type: qa-defect` 一缺陷一文件，加头 = 被看见）。"
						})]
					}),
					top === "adr" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AdrView, {
						adrs,
						scope,
						ctx
					}),
					top === "context" && (contextRaw !== null && contextRaw !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DocCard, {
						icon: "📐",
						title: "CONTEXT.md",
						path: cwd === void 0 ? "CONTEXT.md" : `${cwd}/CONTEXT.md`,
						scope,
						ctx,
						body: contextRaw
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: TEXT_FAINT,
							fontSize: 12,
							padding: 24,
							textAlign: "center"
						},
						children: contextRaw === null ? "读取 CONTEXT.md…" : "本仓仓根暂无 CONTEXT.md（领域词汇表/概念正本落点；建立后本页自动呈现）。"
					})),
					top === "guide" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GuideView, { scope }),
					top === "ledger" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LedgerView, {
						ledgers: globalLedgers,
						mapTickets,
						scope,
						ctx,
						sessions,
						onChanged,
						readOnly
					}),
					top === "overview" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(OverviewView, {
						tickets: all,
						efforts: data.efforts,
						cases,
						tests: qaTests,
						defects,
						ledgers,
						effortIdx,
						setEffortIdx,
						planDir,
						scope,
						ctx,
						sessions,
						onChanged,
						readOnly
					})
				]
			});
		}
		function GuideView({ scope }) {
			const H = ({ children }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: 14,
					fontWeight: 700,
					color: TEXT,
					margin: "20px 0 8px"
				},
				children
			});
			const P = ({ children, style }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					fontSize: 12.5,
					lineHeight: 1.8,
					color: TEXT_DIM,
					margin: "6px 0",
					...style
				},
				children
			});
			const Code = ({ children }) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
				style: {
					background: "rgba(255,255,255,.08)",
					padding: "1px 5px",
					borderRadius: 4,
					fontFamily: "ui-monospace,Menlo,monospace",
					fontSize: 11.5,
					color: ACCENT_SOFT
				},
				children
			});
			const Box = ({ title, who, tone, children }) => {
				const c = tone === "decide" ? "#f7ad31" : tone === "ok" ? "#4ed17e" : "#609bfa";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						flex: "1 1 140px",
						minWidth: 140,
						padding: "9px 11px",
						borderRadius: 8,
						background: CARD,
						border: `1px solid ${c}55`,
						borderTop: `3px solid ${c}`
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: 12,
								fontWeight: 700,
								color: c
							},
							children: title
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: 10.5,
								color: TEXT_FAINT,
								marginTop: 3,
								fontFamily: "ui-monospace,Menlo,monospace",
								wordBreak: "break-all"
							},
							children: who
						}),
						children && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								fontSize: 11,
								color: TEXT_DIM,
								marginTop: 5,
								lineHeight: 1.6
							},
							children
						})
					]
				});
			};
			const Arrow = () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					alignSelf: "center",
					color: TEXT_FAINT,
					fontSize: 15,
					padding: "0 1px"
				},
				children: "→"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					flex: 1,
					overflowY: "auto",
					padding: "4px 18px 28px"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: { maxWidth: 900 },
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(H, { children: "这个页面是什么" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(P, { children: [
							"第一行页签（2026-09-30 拍板）：总览 / 地图 / 测例 / 缺陷 / 台账 / ADR / CONTEXT / 说明。测例与缺陷各自成页并",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "聚合全局"
							}),
							"（各 effort ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "qa/" }),
							" ＋ ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: ".plan/qa/" }),
							"）； 【ADR】渲染仓根 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "docs/adr/" }),
							"（架构决策记录，知识层只读展示，2026-09-30 拍板）； 【CONTEXT】渲染仓根 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "CONTEXT.md" }),
							"（词汇表/领域正本）。地图页内：推演图第 2 子页为【map】 （map.md 正文）、实施图（spec-only）第 2 子页为【spec】（spec.md 正文）。 各页显示的是两个治理目录下的 markdown：tracker 类（spec / map / issues 票）在 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: ".scratch/" }),
							"， 审批档与全局缺陷/台账在 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: ".plan/" }),
							"。本页说明这些文件怎么产生、谁维护、怎么流转。完整的流程协议 （每环节的位置与交接契约）记在同仓 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "skills/plan-protocol/SKILL.md" }),
							"，本页是它的可视化速览。"
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(P, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "台账 / 缺陷 / 测例三类都有「图内」与「全局」两个落点"
							}),
							"（2026-10-02 拍板口径）： 有图归属的落该图的 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: ".scratch/<effort>/qa|ledger/" }),
							"，随图整轮归档； 无图归属的（SOP 回测、整页回测这类挂不到具体工单的）落 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: ".plan/qa|ledger/" }),
							"，常驻不随轮走。 拿不准归哪边时",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "留全局"
							}),
							"（宁少拆不错拆）。",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: ".plan/approval/" }),
							" 的全局审批档则不同——它",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "搭 effort 归档的车"
							}),
							"： 被标了 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "archived:" }),
							" 的随某一轮一并搬走，没标的一直留在这里等。"
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(H, { children: "主流程：先决策，再落地" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(P, { children: [
							"「",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "已知要做"
							}),
							"」时走这条链——把需求写成 spec，再拆票实现。"
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								gap: 5,
								flexWrap: "wrap",
								margin: "10px 0",
								alignItems: "center"
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Box, {
								title: "① 决策循环",
								who: "grill / wayfinder → to-approval → plan-approve",
								tone: "decide",
								children: "一轮轮收敛：把模糊决策拷问清楚、落待拍板、逐项拍板"
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								display: "flex",
								gap: 5,
								flexWrap: "wrap",
								margin: "6px 0 4px",
								alignItems: "center"
							},
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 11,
									color: TEXT_FAINT,
									marginRight: 2
								},
								children: "决策定案（结论是「要做 X」）↓"
							})
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 5,
								flexWrap: "wrap",
								margin: "4px 0"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Box, {
									title: "② 定需求",
									who: "to-spec",
									tone: "ok",
									children: [
										"产出 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "spec.md" }),
										"；写前读架构正本、写完更新"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Arrow, {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Box, {
									title: "③ 拆票",
									who: "to-tickets",
									tone: "ok",
									children: "一票一文件、每票切穿各层、写明谁阻塞谁"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Arrow, {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Box, {
									title: "④ 执行",
									who: "implement / implement-spec",
									tone: "ok",
									children: "按票派 subagent，并行实现、逐个合并"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Arrow, {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Box, {
									title: "⑤ 回写",
									who: "plan-sync（执行时同步）",
									tone: "ok",
									children: [
										"勾验收项、置 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "Status" }),
										" 行、补落地注"
									]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(P, {
							style: { marginTop: 2 },
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
									style: { color: TEXT },
									children: "回写发生在两处，是同一件事的两种时机"
								}),
								"：执行类 skill 在每张票合并落地时",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
									style: { color: TEXT },
									children: "当场"
								}),
								"翻状态；",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "plan-sync" }),
								" 事后对账，把「看起来已完成、票面没翻」的条目找回补齐。两者不是两套流程。"
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(H, { children: "补充流程：需要拍板的问题 / 缺口" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(P, { children: [
							"「",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "发现一个 bug / 缺口"
							}),
							"」时走这条链——先拍板定论，依据就是拍板文档本身。"
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								gap: 5,
								flexWrap: "wrap",
								margin: "10px 0"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Box, {
									title: "问题发现",
									who: "用户反馈 / code review / 走查 / QA 缺陷升级",
									tone: "decide",
									children: "需要拍板定论的问题 / 缺口"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Arrow, {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Box, {
									title: "待拍板文档",
									who: "to-approval → plan-approve",
									tone: "decide",
									children: ["落文档、拍板；", /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
										style: { color: TEXT },
										children: "依据 = 这份文档本身"
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Arrow, {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Box, {
									title: "依据",
									who: "（不追加、不新建 spec）",
									tone: "read",
									children: "拍板文档自带原话 + 争议 + 结论，天然当上游"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Arrow, {}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Box, {
									title: "接回落地链",
									who: "to-tickets → implement → plan-sync",
									tone: "ok",
									children: "同上 ③ ④ ⑤"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(P, { children: [
							"两条流在「",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "结论 = 要做某件事"
							}),
							"」处汇合：拍板结论若要求干活，",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "plan-approve 在影响域清单登记票项"
							}),
							"（只结算、不落票——2026-09-28 拍板）， 落票由清单驱动后置执行（plan-loop「定案未拆票」行动行或实施会话调 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "to-tickets" }),
							"）， 而不是把结论留在文档里等人再拆一次。"
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(H, { children: "票的形态约定" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(P, { children: [
							"一个 effort 目录下，票按",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "一票一文件"
							}),
							"放："
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								fontSize: 12,
								lineHeight: 1.9,
								color: TEXT_DIM,
								background: "#141416",
								border: `1px solid ${BORDER_LIGHT}`,
								borderRadius: 8,
								padding: "10px 14px",
								margin: "8px 0",
								fontFamily: "ui-monospace,Menlo,monospace"
							},
							children: [
								".scratch/<effort>/ \xA0",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: TEXT_FAINT },
									children: "← tracker 类（spec/map/issues 票）"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"\xA0\xA0map.md \xA0",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: TEXT_FAINT },
									children: "← effort 标志：没有它，整个目录不被加载"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"\xA0\xA0issues/",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"\xA0\xA0\xA0\xA001-<slug>.md \xA0",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: TEXT_FAINT },
									children: "← frontmatter: type；正文: **Status:** / **Blocked by:**"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"\xA0\xA0\xA0\xA002-<slug>.md",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"\xA0\xA0approval/ \xA0",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: TEXT_FAINT },
									children: "← 图内审批档（待拍板-*.md，grill / wayfinder 生成）"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"\xA0\xA0qa/ \xA0",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: TEXT_FAINT },
									children: "← 图内测例（cases.md）＋ 缺陷（DEF-*）"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"\xA0\xA0ledger/ \xA0",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: TEXT_FAINT },
									children: "← 图内台账（挂账-NN-*），随图归档"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"\xA0\xA0qa/ \xA0",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: TEXT_FAINT },
									children: "← 图内测例（cases.md）＋ 缺陷（DEF-*）"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								"\xA0\xA0ledger/ \xA0",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: TEXT_FAINT },
									children: "← 图内台账（挂账-NN-*），随图归档"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
								".plan/ \xA0",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { color: TEXT_FAINT },
									children: "← 全局件目录：approval/（全局审批档，2026-09-30 收拢拍板）＋ qa/（无图归属缺陷/测例）＋ ledger/（全局台账）——三件即封闭清单，清单外新子目录由 plan-lint 拦"
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(P, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "为什么必须一票一文件"
							}),
							"：把多张票写进同一个文件（如 ",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "tickets.md" }),
							"）， 按文件读取的一方会把它当成",
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
								style: { color: TEXT },
								children: "一张票"
							}),
							"，里面的票全部丢失—— 本插件就是按文件读的。合并文件看起来整齐，代价是内容不可见。"
						] }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(H, { children: "几个常见疑问" }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								fontSize: 12.5,
								lineHeight: 1.85,
								color: TEXT_DIM
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: { margin: "10px 0" },
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "票和待拍板有什么区别？"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
										"票是",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "等被做"
										}),
										"的活（正文 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "**Status:** open/claimed/resolved" }),
										"）； 待拍板是",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "等你做决定"
										}),
										"的文档（正文 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "**Status:** pending" }),
										"）。 两者状态都写",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "正文行"
										}),
										"，不再写 frontmatter（2026-10-02 起；frontmatter 只留 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "type" }),
										" 等事实字段）。 拍板结论若要干活，就该当场生成票——两者不是同一个东西，但会接力。"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: { margin: "10px 0" },
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "四种票型怎么认？"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "task" }),
										"＝执行票（🛠️ 落码验收，实施图的原子）；",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "research" }),
										"＝调研票（🔍 查证并产出引用式笔记进 assets/）；",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "prototype" }),
										"＝原型票（🧩 做粗糙实物给讨论反应）；",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "grilling" }),
										"＝拷问票（🔥 逐题拍板）。 推演图（后三种组成）终点是",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "决策清零"
										}),
										"，实施图（task）终点是",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "落码验收"
										}),
										"； 卡片上的彩色徽标即票型身份；推演图子页「🔍 调研 / 🧩 原型 / 🔥 拷问」按票型全量列出这三种票与其 assets: 关联产物（2026-09-30 拍板：三视图取代聚合推演票页，仅推演图可见；工单页 Table 变体默认只显 open/claimed，收口票看这里）。"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: { margin: "10px 0" },
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "进度条右端的黄色锁区是什么？"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
										"实施图的完成度有两道",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "结构性上限"
										}),
										"（2026-10-02/10-03 拍板）： 没有 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "qa/cases.md" }),
										"（测例）锁右端 20%、封顶 80%；有测例但没有 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "qa/test.md" }),
										"（执行验收记录）锁右端 10%、封顶 90%。黄色段 = ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "干了也够不到的那一段"
										}),
										"， 补齐缺件才解锁；推演图没有 qa 通道，不参与这条口径。"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: { margin: "10px 0" },
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "看到状态不对怎么办？"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
										"结构漂移先用只读脚本查：",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "bash ~/.zcode/skills/mp-plan-approve/scripts/plan-lint.sh 仓库根/.scratch 仓库根/.plan" }),
										"（同票双档、缺 map.md、文档头违规、合体票文件、effort 票尽未标 superseded-by、.plan 根层白名单；仓里有机器可读词表时加 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "--terms 词表" }),
										"，检查[7] 再断言全仓术语无标记残留）； 再跑 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "plan-sync" }),
										" 对账票面与实际进度（对照 git 提交判定，先报告差异再改）。 两者都只报告、不擅自改。"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: { margin: "10px 0" },
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "归档在哪？"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
										"已完成内容由 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "plan-archive" }),
										"（手动触发）迁到 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: ".archive/" }),
										"， 并 sweep 全仓引用（含归档区自身）、标过时/废弃。归档区的「现行权威」表是引用断链的高发地，每次归档都要维护它。",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
										"归档时",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "全局 qa/ 与 ledger/ 不搬"
										}),
										"（常驻），但",
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", {
											style: { color: TEXT },
											children: [
												"已标 ",
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "archived:" }),
												" 的全局审批档一并搭车搬走"
											]
										}),
										"（2026-10-02 拍板）；",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "plan-sync" }),
										" 收尾会先核一遍归档前置判据并报告。 归档时",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "全局 qa/ 与 ledger/ 不搬"
										}),
										"（常驻）， 但",
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", {
											style: { color: TEXT },
											children: [
												"已标 ",
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "archived:" }),
												" 的全局审批档一并搭车搬走"
											]
										}),
										"（2026-10-02 拍板）。",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "plan-sync" }),
										" 收尾会先核一遍归档前置判据并报告，不必等归档时才发现缺件。 右上角「轮次」选择器可切进某一轮的快照（",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: ".archive/rounds/<round-id>/" }),
										"）， 按轮只读查看当时的地图 / 工单 / 拍板。"
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: { margin: "10px 0" },
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
											style: { color: TEXT },
											children: "历史遗留的 impl/ 、impl-fe/ 目录？"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
										"那是早期形态的实施工单，正在逐步废弃。它们的票现在也出现在「🗺️ 地图 → 🎫 工单」子页（Kanban/Table/Relation），不再单独成页； 收尾时并入 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "issues/" }),
										"。",
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", {
											style: { color: TEXT },
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "tickets/" }), " 同样是非法目录名"]
										}),
										"—— 票只认 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "issues/" }),
										"（存量 ",
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "tickets/" }),
										" 待迁移）。"
									]
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								marginTop: 22,
								paddingTop: 12,
								borderTop: `1px solid ${BORDER_LIGHT}`,
								fontSize: 11,
								color: TEXT_FAINT
							},
							children: [
								"本页内容随约定演进；若与 ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "skills/" }),
								" 下的 skill 正文或 ",
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Code, { children: "plan-protocol" }),
								" 冲突，以 skill 为准。"
							]
						})
					]
				})
			});
		}
		function approvalState(t) {
			if (statusWord(t) === "pending") return "pending";
			return "settled";
		}
		function ApprovalsView({ approvals, scope, ctx, sessions, onChanged, readOnly }) {
			const [focus, setFocus] = (0, react.useState)(null);
			const [filter, setFilter] = (0, react.useState)(readOnly ? "all" : "pending");
			const counts = (0, react.useMemo)(() => ({
				pending: approvals.filter((t) => approvalState(t) === "pending").length,
				settled: approvals.filter((t) => approvalState(t) === "settled").length,
				all: approvals.length
			}), [approvals]);
			const shown = (0, react.useMemo)(() => {
				return [...filter === "all" ? approvals : approvals.filter((t) => approvalState(t) === filter)].sort((a, b) => (ageDays(b) ?? -1) - (ageDays(a) ?? -1));
			}, [approvals, filter]);
			if (approvals.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					color: TEXT_FAINT,
					padding: 24,
					textAlign: "center"
				},
				children: [
					readOnly ? "该轮次没有拍板文档。" : "没有待你拍板的文档。",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 12,
							color: TEXT_FAINT
						},
						children: "审批文档写 `status: pending` 后会出现在这里。"
					})
				]
			});
			const chip = (id, label) => {
				const on = filter === id;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					onClick: () => setFilter(id),
					style: {
						fontSize: 11,
						padding: "2px 9px",
						borderRadius: 999,
						cursor: "pointer",
						border: `1px solid ${on ? "#f7ad31" : BORDER}`,
						color: on ? "#f7ad31" : "#888",
						background: on ? "#ffa94d1a" : "transparent"
					},
					children: [
						label,
						" ",
						counts[id]
					]
				}, id);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "8px 14px",
							borderBottom: `1px solid ${BORDER}`,
							display: "flex",
							alignItems: "center",
							gap: 6,
							flexWrap: "wrap"
						},
						children: [
							chip("pending", "⏳ 待拍板"),
							chip("settled", "✓ 已结案"),
							chip("all", "全部")
						]
					}),
					shown.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: TEXT_FAINT,
							fontSize: 13
						},
						children: filter === "pending" ? "没有等你拍板的文档。" : "该筛选下没有文档。"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							overflowY: "auto",
							padding: 12,
							display: "flex",
							flexDirection: "column",
							gap: 8
						},
						children: shown.map((t) => {
							const age = ageDays(t);
							const hot = approvalState(t) === "pending" && age !== void 0 && age >= 7;
							const settled = approvalState(t) === "settled";
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								onClick: () => setFocus(t),
								style: {
									padding: 12,
									borderRadius: 10,
									background: settled ? CARD_DARK : CARD,
									border: `1px solid ${hot ? "#7a4a15" : BORDER}`,
									cursor: "pointer",
									opacity: settled ? .75 : 1
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: 8
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 13,
													color: settled ? TEXT_FAINT : "#f7ad31"
												},
												children: settled ? "✓" : "⏳"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													flex: 1,
													fontSize: 13,
													fontWeight: 700,
													color: settled ? TEXT_FAINT : TEXT,
													lineHeight: 1.4
												},
												children: t.title
											}),
											!settled && age !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 11,
													padding: "2px 8px",
													borderRadius: 999,
													background: hot ? "#7a4a1533" : CHIP_BG,
													color: hot ? "#f7ad31" : "#888",
													flexShrink: 0
												},
												children: ageLabel(t)
											})
										]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
										ticket: t,
										scope,
										ctx
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											gap: 6,
											flexWrap: "wrap",
											marginTop: 7
										},
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 10,
													padding: "1px 6px",
													borderRadius: 999,
													background: settled ? "#2ecc7122" : "#ffa94d22",
													color: settled ? "#4ed17e" : "#f7ad31"
												},
												children: t.status ?? "pending"
											}),
											t.origin && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												style: {
													fontSize: 10,
													padding: "1px 6px",
													borderRadius: 999,
													background: CHIP_BG,
													color: "#888"
												},
												children: ["origin: ", t.origin]
											}),
											t.date && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 10,
													padding: "1px 6px",
													borderRadius: 999,
													background: CHIP_BG,
													color: "#888"
												},
												children: t.date
											})
										]
									})
								]
							}, t.file);
						})
					}),
					focus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: focus,
						planDir: "",
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setFocus(null),
						readOnly
					})
				]
			});
		}
		const LEDGER_STATES = [
			"阻塞中",
			"可启动",
			"在挂",
			"已销",
			"已转票"
		];
		/** 挂账阶段实时计算（2026-09-21 拍板）：带 `- 阻塞:` 的条目按依赖票的当前状态
		*  即时判定「阻塞中 / 可启动」——即使文件状态词还没被 implement 写回，页面
		*  也永远显示正确阶段。销账态原样保留。 */
		function ledgerStage(e, mapTickets) {
			if (e.state === "已销" || e.state === "已转票") return e.state;
			const unmet = e.blocked.filter((n) => {
				const t = mapTickets.find((x) => {
					const m = x.file.match(/^(\d+)-/);
					return m !== null && m !== void 0 && parseInt(m[1], 10) === parseInt(n, 10);
				});
				return t === void 0 || displayStatus(t) !== "done" && !t.outOfScope;
			});
			if (e.state === "阻塞中") return unmet.length > 0 ? "阻塞中" : "可启动";
			return unmet.length > 0 ? "阻塞中" : e.state === "可启动" ? "可启动" : "可启动";
		}
		/** 解析台账条目：`### 挂账-NN 标题` 小节 + `- 状态/卡点/启动条件/来源:` 固定字段。 */
		function parseLedgerEntries(body) {
			const out = [];
			const sections = /(^|\n)### 挂账-/.test(body) ? body.split(/^### /m).slice(1) : body.split(/^# /m).slice(1);
			for (const sec of sections) {
				const m = (sec.split("\n")[0]?.trim() ?? "").match(/^(挂账-[\w.-]+)\s+(.+)$/);
				if (!m?.[1] || !m[2]) continue;
				const field = (name) => sec.match(new RegExp(`^- ${name}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
				const rawState = field("状态") || "在挂";
				const core = LEDGER_STATES.find((s) => rawState.startsWith(s)) ?? rawState;
				const note = core === rawState ? "" : rawState.slice(core.length).replace(/^[（(]\s*/, "").replace(/[)）]\s*$/, "");
				const blocked = [];
				for (const bm of field("阻塞").matchAll(/#?(\d+)/g)) blocked.push(bm[1] ?? "");
				out.push({
					id: m[1],
					title: m[2],
					state: core,
					stateNote: note,
					blocker: field("卡点"),
					blocked: blocked.filter(Boolean),
					startWhen: field("启动条件"),
					source: field("来源")
				});
			}
			return out;
		}
		function LedgerView({ ledgers, mapTickets, scope, ctx, sessions, onChanged, readOnly }) {
			const [focus, setFocus] = (0, react.useState)(null);
			const [filter, setFilter] = (0, react.useState)("unsold");
			const stageOf = (t) => {
				const e = parseLedgerEntries(t.body)[0];
				return e === void 0 ? "可启动" : ledgerStage(e, t.effort, mapTickets);
			};
			const shown = filter === "all" ? ledgers : ledgers.filter((t) => {
				const s = stageOf(t);
				if (filter === "unsold") return s === "可启动" || s === "阻塞中";
				return s === filter;
			});
			const stageCount = (s) => ledgers.filter((t) => stageOf(t) === s).length;
			const counts = {
				ready: stageCount("可启动"),
				blocked: stageCount("阻塞中"),
				spawned: ledgers.filter((t) => (parseLedgerEntries(t.body)[0]?.state ?? "").startsWith("已转票")).length,
				closed: ledgers.filter((t) => (parseLedgerEntries(t.body)[0]?.state ?? "").startsWith("已销")).length
			};
			const chip = (active) => ({
				fontSize: 11,
				padding: "3px 10px",
				borderRadius: 999,
				cursor: "pointer",
				border: `1px solid ${active ? ACCENT : BORDER}`,
				color: active ? ACCENT : TEXT_FAINT,
				background: active ? `${ACCENT}22` : "transparent"
			});
			if (ledgers.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					color: TEXT_FAINT,
					padding: 24,
					textAlign: "center"
				},
				children: [
					"没有台账条目。",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 12,
							color: TEXT_FAINT
						},
						children: "一账一文件：全局件放 `.plan/ledger/挂账-NN-slug.md`，图内放 `.scratch/<effort>/ledger/`，frontmatter 带 `type: ledger`。"
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "10px 14px 0",
							borderBottom: `1px solid ${BORDER}`,
							fontSize: 11,
							color: TEXT_FAINT,
							display: "flex",
							gap: 12,
							alignItems: "center",
							flexWrap: "wrap"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: { paddingBottom: 8 },
							children: "挂账 = 发现但当下不做/做不了的项；带 `- 阻塞: 票NN` 的条目由 implement 落地后自动重算阶段。一账一文件。"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								marginLeft: "auto",
								display: "inline-flex",
								gap: 6,
								alignItems: "center",
								paddingBottom: 8
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: chip(filter === "unsold"),
									onClick: () => setFilter("unsold"),
									children: ["未销 ", counts.ready + counts.blocked]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: chip(filter === "ready"),
									onClick: () => setFilter("ready"),
									children: ["🚀 可启动 ", counts.ready]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: chip(filter === "blocked"),
									onClick: () => setFilter("blocked"),
									children: ["⛔ 阻塞中 ", counts.blocked]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: chip(filter === "spawned"),
									onClick: () => setFilter("spawned"),
									children: ["已转票 ", counts.spawned]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: chip(filter === "closed"),
									onClick: () => setFilter("closed"),
									children: ["已销 ", counts.closed]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: chip(filter === "all"),
									onClick: () => setFilter("all"),
									children: ["全部 ", ledgers.length]
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							flex: 1,
							overflowY: "auto",
							padding: 14,
							display: "flex",
							flexDirection: "column",
							gap: 12
						},
						children: [shown.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								padding: 24,
								textAlign: "center",
								color: TEXT_FAINT,
								fontSize: 12
							},
							children: filter === "unsold" ? "没有未销的挂账——该销的都销了。" : "没有符合筛选的条目。"
						}), shown.map((t) => {
							const entries = parseLedgerEntries(t.body);
							const single = entries.length === 1 ? entries[0] : void 0;
							if (single !== void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								onClick: () => setFocus(t),
								style: {
									padding: "10px 12px",
									borderRadius: 10,
									background: CARD,
									border: `1px solid ${BORDER}`,
									cursor: "pointer"
								},
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
									ticket: t,
									scope,
									ctx
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LedgerCard, { entry: single })]
							}, t.file);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: 8
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: 8
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: 13,
												fontWeight: 700,
												color: TEXT
											},
											children: t.title
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: {
												fontSize: 10,
												padding: "1px 6px",
												borderRadius: 999,
												background: CHIP_BG,
												color: "#888"
											},
											children: [entries.length, " 笔在账"]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
										ticket: t,
										scope,
										ctx
									}),
									entries.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										onClick: () => setFocus(t),
										style: {
											padding: 12,
											borderRadius: 10,
											background: CARD,
											border: `1px solid ${BORDER}`,
											cursor: "pointer",
											fontSize: 12,
											color: TEXT_FAINT
										},
										children: "未解析出台账条目（需要 `# 挂账-NN` 标题或 `### 挂账-NN` 小节格式），点开看全文。"
									}),
									entries.map((e) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										onClick: () => setFocus(t),
										style: {
											padding: "10px 12px",
											borderRadius: 10,
											background: CARD,
											border: `1px solid ${BORDER}`,
											cursor: "pointer"
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(LedgerCard, { entry: e })
									}, e.id))
								]
							}, t.file);
						})]
					}),
					focus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: focus,
						planDir: "",
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setFocus(null),
						readOnly
					})
				]
			});
		}
		const LEDGER_STATE_COLOR = {
			"阻塞中": {
				bg: "#ff6b6b22",
				fg: "#f2555a"
			},
			"可启动": {
				bg: "#ffa94d22",
				fg: "#f7ad31"
			},
			"在挂": {
				bg: "#ffa94d22",
				fg: "#f7ad31"
			},
			"已销": {
				bg: "#2ecc7122",
				fg: "#4ed17e"
			},
			"已转票": {
				bg: "#609bfa22",
				fg: "#609bfa"
			}
		};
		function LedgerCard({ entry: e }) {
			const tone = LEDGER_STATE_COLOR[e.state] ?? {
				bg: CHIP_BG,
				fg: TEXT_FAINT
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "flex",
						alignItems: "center",
						gap: 8,
						flexWrap: "wrap"
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 10,
								padding: "1px 8px",
								borderRadius: 999,
								background: tone.bg,
								color: tone.fg,
								flexShrink: 0
							},
							children: e.state
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 11.5,
								fontFamily: "ui-monospace,Menlo,monospace",
								color: TEXT_DIM,
								flexShrink: 0
							},
							children: e.id
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								flex: 1,
								minWidth: 200,
								fontSize: 13,
								fontWeight: 700,
								color: TEXT
							},
							children: e.title
						}),
						e.source && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 10,
								color: TEXT_FAINT,
								flexShrink: 0
							},
							children: e.source
						})
					]
				}),
				e.stateNote && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						fontSize: 11,
						color: tone.fg,
						marginTop: 4,
						lineHeight: 1.5
					},
					children: ["状态注记：", e.stateNote]
				}),
				e.blocker && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						fontSize: 12,
						color: TEXT_DIM,
						marginTop: 6,
						lineHeight: 1.5
					},
					children: ["卡点：", e.blocker]
				}),
				e.startWhen && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						fontSize: 12,
						color: "#4ed17e",
						marginTop: 3,
						lineHeight: 1.5
					},
					children: ["启动条件：", e.startWhen]
				})
			] });
		}
		function parseDefectEntries(body) {
			const lines = body.split("\n");
			for (let i = 0; i < lines.length - 1; i++) {
				const head = lines[i] ?? "";
				if (!head.includes("缺陷号") || !isDivider(lines[i + 1] ?? "")) continue;
				const cols = splitRow(head);
				const col = (...names) => cols.findIndex((c) => names.some((n) => c.includes(n)));
				const ix = {
					id: col("缺陷号"),
					title: col("标题"),
					severity: col("严重度", "严重程度"),
					kind: col("类型", "domain"),
					state: col("状态"),
					source: col("发现源")
				};
				const cell = (row, k) => k >= 0 ? row[k] ?? "" : "";
				const out = [];
				for (let j = i + 2; j < lines.length; j++) {
					const line = lines[j] ?? "";
					if (!line.includes("|") || /^\s*$/.test(line)) break;
					const cells = splitRow(line);
					const id = cell(cells, ix.id);
					if (!id) continue;
					out.push({
						id,
						title: cell(cells, ix.title),
						severity: cell(cells, ix.severity),
						kind: cell(cells, ix.kind),
						state: cell(cells, ix.state),
						source: cell(cells, ix.source)
					});
				}
				return out;
			}
			return [];
		}
		const DEFECT_CLOSED = /* @__PURE__ */ new Set([
			"已关闭",
			"关闭",
			"挂起"
		]);
		const defectStateWord = (s) => s.trim().split(/[\s(（#:：—-]/)[0] ?? "";
		/** 一缺陷一文件形态（2026-09-21 拍板）：`# DEF-NN 标题` + 字段行；旧单文件「清单总览」多条目形态返回 undefined。 */
		function parseDefectFile(t) {
			if (/^## 清单总览/m.test(t.body) || /\|\s*缺陷号/.test(t.body)) return void 0;
			const m = t.body.match(/^# (DEF-[\w.-]+)\s*(.*)$/m);
			if (m === null) return void 0;
			const field = (name) => t.body.match(new RegExp(`^- ${name}:\\s*(.+)$`, "m"))?.[1]?.trim() ?? "";
			return {
				id: m[1] ?? "",
				title: (m[2] ?? "").trim() || field("标题"),
				severity: field("严重度"),
				kind: field("类型"),
				state: field("状态") || "待修复",
				source: field("发现源"),
				assignee: field("Assignee"),
				cases: field("关联用例"),
				gap: field("测试设计缺口")
			};
		}
		function DefectView({ defects, scope, ctx, sessions, onChanged, readOnly }) {
			const [focus, setFocus] = (0, react.useState)(null);
			if (defects.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					color: TEXT_FAINT,
					padding: 24,
					textAlign: "center"
				},
				children: [
					"当前图没有缺陷台账。",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 12,
							color: TEXT_FAINT
						},
						children: "`.scratch/<effort>/qa/`（存量图 `.plan/<effort>/qa/`）下带 `type: qa-defect` 头的缺陷台账会按图列在这里。"
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							padding: "8px 14px",
							borderBottom: `1px solid ${BORDER}`,
							fontSize: 11,
							color: TEXT_FAINT
						},
						children: "缺陷挂在具体图下（按当前选中的图过滤，切图联动）；一缺陷一文件（`qa/DEF-NN-*.md`），点卡片看全文。"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							overflowY: "auto",
							padding: 12,
							display: "flex",
							flexDirection: "column",
							gap: 10
						},
						children: defects.map((t) => {
							const single = parseDefectFile(t);
							if (single !== void 0) {
								const closed = DEFECT_CLOSED.has(defectStateWord(single.state));
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										display: "flex",
										flexDirection: "column",
										gap: 8
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												display: "flex",
												alignItems: "center",
												gap: 8
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												style: {
													fontSize: 13,
													fontWeight: 700,
													color: TEXT
												},
												children: [
													single.id,
													" ",
													single.title
												]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 10,
													padding: "1px 6px",
													borderRadius: 999,
													background: CHIP_BG,
													color: "#888"
												},
												children: "一缺陷一文件"
											})]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
											ticket: t,
											scope,
											ctx
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											onClick: () => setFocus(t),
											style: {
												padding: "10px 12px",
												borderRadius: 10,
												background: closed ? CARD_DARK : CARD,
												border: `1px solid ${BORDER}`,
												cursor: "pointer",
												opacity: closed ? .75 : 1
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													alignItems: "center",
													gap: 8
												},
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															fontSize: 10,
															padding: "1px 8px",
															borderRadius: 999,
															background: closed ? "#2ecc7122" : "#ffa94d22",
															color: closed ? "#4ed17e" : "#f7ad31",
															flexShrink: 0
														},
														children: single.state
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															flex: 1,
															fontSize: 13,
															fontWeight: 700,
															color: TEXT
														},
														children: single.title
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															fontSize: 10,
															fontFamily: "monospace",
															color: TEXT_FAINT,
															flexShrink: 0
														},
														children: single.id
													})
												]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													gap: 6,
													flexWrap: "wrap",
													marginTop: 6
												},
												children: [
													single.severity && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														style: {
															fontSize: 10,
															padding: "1px 6px",
															borderRadius: 999,
															background: CHIP_BG,
															color: "#888"
														},
														children: ["严重度 ", single.severity]
													}),
													single.kind && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														style: {
															fontSize: 10,
															padding: "1px 6px",
															borderRadius: 999,
															background: CHIP_BG,
															color: "#888"
														},
														children: ["类型 ", single.kind]
													}),
													single.source && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														style: {
															fontSize: 10,
															padding: "1px 6px",
															borderRadius: 999,
															background: CHIP_BG,
															color: "#888"
														},
														children: ["发现源 ", single.source]
													})
												]
											})]
										})
									]
								}, `${t.effort}/${t.file}`);
							}
							const entries = parseDefectEntries(t.body);
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: {
									display: "flex",
									flexDirection: "column",
									gap: 8
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: {
											display: "flex",
											alignItems: "center",
											gap: 8
										},
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												fontSize: 13,
												fontWeight: 700,
												color: TEXT
											},
											children: t.title
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: {
												fontSize: 10,
												padding: "1px 6px",
												borderRadius: 999,
												background: CHIP_BG,
												color: "#888"
											},
											children: [entries.length, " 条"]
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
										ticket: t,
										scope,
										ctx
									}),
									entries.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										onClick: () => setFocus(t),
										style: {
											padding: 12,
											borderRadius: 10,
											background: CARD,
											border: `1px solid ${BORDER}`,
											cursor: "pointer",
											fontSize: 12,
											color: TEXT_FAINT
										},
										children: "未解析出缺陷条目（需要「清单总览」表格，表头含缺陷号/标题/严重度等列），点开看全文。"
									}),
									entries.map((e) => {
										const closed = DEFECT_CLOSED.has(defectStateWord(e.state));
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											onClick: () => setFocus(t),
											style: {
												padding: "10px 12px",
												borderRadius: 10,
												background: closed ? CARD_DARK : CARD,
												border: `1px solid ${BORDER}`,
												cursor: "pointer",
												opacity: closed ? .75 : 1
											},
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													alignItems: "center",
													gap: 8
												},
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															fontSize: 10,
															padding: "1px 8px",
															borderRadius: 999,
															background: closed ? "#2ecc7122" : "#ffa94d22",
															color: closed ? "#4ed17e" : "#f7ad31",
															flexShrink: 0
														},
														children: e.state || "待修复"
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															flex: 1,
															fontSize: 13,
															fontWeight: 700,
															color: TEXT
														},
														children: e.title
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															fontSize: 10,
															fontFamily: "monospace",
															color: TEXT_FAINT,
															flexShrink: 0
														},
														children: e.id
													})
												]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												style: {
													display: "flex",
													gap: 6,
													flexWrap: "wrap",
													marginTop: 6
												},
												children: [
													e.severity && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														style: {
															fontSize: 10,
															padding: "1px 6px",
															borderRadius: 999,
															background: CHIP_BG,
															color: "#888"
														},
														children: ["严重度 ", e.severity]
													}),
													e.kind && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														style: {
															fontSize: 10,
															padding: "1px 6px",
															borderRadius: 999,
															background: CHIP_BG,
															color: "#888"
														},
														children: ["类型 ", e.kind]
													}),
													e.source && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														style: {
															fontSize: 10,
															padding: "1px 6px",
															borderRadius: 999,
															background: CHIP_BG,
															color: "#888"
														},
														children: ["发现源 ", e.source]
													})
												]
											})]
										}, e.id);
									})
								]
							}, `${t.effort}/${t.file}`);
						})
					}),
					focus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: focus,
						planDir: "",
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setFocus(null),
						readOnly
					})
				]
			});
		}
		const CHAIN_EDGE_STYLE = {
			source: {
				color: "#f7ad31",
				label: "出自票"
			},
			spawn: {
				color: "#609bfa",
				label: "转票落地"
			},
			mention: {
				color: "#f2555a",
				label: "提及关联"
			},
			cover: {
				color: "#4ed17e",
				label: "测例覆盖"
			},
			dep: {
				color: "rgba(255,255,255,.30)",
				dashed: true,
				label: "blocked"
			}
		};
		const chainTicketByNum = (list, n) => list.find((t) => {
			const m = t.file.match(/^(\d+)-/);
			return m !== null && m !== void 0 && parseInt(m[1], 10) === n;
		});
		function buildChain(tickets, defects, ledgers, cases) {
			const NODE_W = 250, INDENT = 64, TOP = 20;
			const nodes = [];
			const pos = /* @__PURE__ */ new Map();
			const edges = [];
			const ticketNodes = tickets.map((t) => ({
				key: `t:${t.id}`,
				kind: "ticket",
				ticket: t,
				title: t.title,
				badge: STATUS_LABELS[displayStatus(t)],
				badgeColor: DOT[displayStatus(t)],
				sub: `#${shortId(t)} · ${ticketKind(t) === "approval" ? "待拍板" : "工单"}`
			}));
			const ledgerNodes = ledgers.map((t) => {
				const e = parseLedgerEntries(t.body)[0];
				return {
					key: `l:${e?.id ?? t.id}`,
					kind: "ledger",
					ticket: t,
					title: e ? `${e.id} ${e.title}` : t.title,
					badge: e?.state ?? "在挂",
					badgeColor: (e?.state ?? "在挂").startsWith("阻塞中") ? "#f2555a" : (e?.state ?? "在挂").startsWith("可启动") || (e?.state ?? "").startsWith("在挂") ? "#f7ad31" : "#4ed17e",
					sub: e ? `挂账 · ${e.source || "无来源"}` : "挂账"
				};
			});
			const defectNodes = [];
			const defectSections = [];
			for (const f of defects) {
				const single = parseDefectFile(f);
				if (single !== void 0) {
					const closed = DEFECT_CLOSED.has(defectStateWord(single.state));
					const node = {
						key: `d:${f.id}/${single.id}`,
						kind: "defect",
						ticket: f,
						title: single.title,
						badge: single.id,
						badgeColor: closed ? "#4ed17e" : "#f2555a",
						sub: `${f.effort?.split("/").pop() ?? ""} · ${single.state}`
					};
					defectNodes.push(node);
					defectSections.push({
						key: node.key,
						text: f.body,
						node
					});
					continue;
				}
				const sections = f.body.split(/^## (DEF-[\w.-]+)/m);
				for (let i = 1; i < sections.length; i += 2) {
					const id = sections[i] ?? "";
					const text = sections[i + 1] ?? "";
					const table = parseDefectEntries(f.body).find((d) => d.id === id);
					const closed = (table?.state ?? "").startsWith("已关闭");
					const node = {
						key: `d:${f.id}/${id}`,
						kind: "defect",
						ticket: f,
						title: table?.title ?? id,
						badge: id,
						badgeColor: closed ? "#4ed17e" : "#f2555a",
						sub: `${f.effort?.split("/").pop() ?? ""} · ${table?.state ?? ""}`
					};
					defectNodes.push(node);
					defectSections.push({
						key: node.key,
						text,
						node
					});
				}
			}
			const casesNodes = cases.map((f) => ({
				key: `c:${f.id}`,
				kind: "cases",
				ticket: f,
				title: f.title,
				badge: "🧪 测例",
				badgeColor: "#4ed17e",
				sub: `${f.effort?.split("/").pop() ?? ""} · 覆盖被测票`
			}));
			const all = [
				...ticketNodes,
				...ledgerNodes,
				...defectNodes,
				...casesNodes
			];
			const byKey = new Map(all.map((n) => [n.key, n]));
			for (const l of ledgerNodes) {
				const body = l.ticket.body;
				const src = parseLedgerEntries(body)[0]?.source ?? "";
				for (const m of src.matchAll(/票\s*(\d+)/g)) {
					const t = chainTicketByNum(tickets, parseInt(m[1] ?? "0", 10));
					if (t !== void 0) edges.push({
						from: `t:${t.id}`,
						to: l.key,
						kind: "source"
					});
				}
				for (const m of body.matchAll(/tickets\/(\d+)-/g)) {
					const t = chainTicketByNum(tickets, parseInt(m[1] ?? "0", 10));
					if (t !== void 0 && !edges.some((e) => e.from === l.key && e.to === `t:${t.id}`)) edges.push({
						from: l.key,
						to: `t:${t.id}`,
						kind: "spawn"
					});
				}
			}
			for (const ds of defectSections) {
				for (const m of ds.text.matchAll(/挂账-(\d+)/g)) {
					const target = `l:挂账-${m[1]}`;
					if (byKey.has(target) && !edges.some((e) => e.from === target && e.to === ds.key)) edges.push({
						from: target,
						to: ds.key,
						kind: "mention"
					});
				}
				for (const m of ds.text.matchAll(/(?:^|[^\w-])票\s*(\d+)/g)) {
					const t = chainTicketByNum(tickets, parseInt(m[1] ?? "0", 10));
					if (t !== void 0 && !edges.some((e) => e.to === ds.key && e.from === `t:${t.id}`)) edges.push({
						from: `t:${t.id}`,
						to: ds.key,
						kind: "mention"
					});
				}
				for (const m of ds.text.matchAll(/tickets\/(\d+)-/g)) {
					const t = chainTicketByNum(tickets, parseInt(m[1] ?? "0", 10));
					if (t !== void 0 && !edges.some((e) => e.to === ds.key && e.from === `t:${t.id}`)) edges.push({
						from: `t:${t.id}`,
						to: ds.key,
						kind: "mention"
					});
				}
			}
			for (const c of casesNodes) for (const m of c.ticket.body.matchAll(/票\s*(\d+)/g)) {
				const t = chainTicketByNum(tickets, parseInt(m[1] ?? "0", 10));
				if (t !== void 0 && !edges.some((e) => e.to === c.key && e.from === `t:${t.id}`)) edges.push({
					from: `t:${t.id}`,
					to: c.key,
					kind: "cover"
				});
			}
			const depById = new Map(tickets.map((t) => [t.id, t]));
			for (const t of tickets) for (const r of t.blockedBy) {
				const b = resolveRef(r, depById);
				if (b !== void 0 && depById.has(b)) edges.push({
					from: `t:${b}`,
					to: `t:${t.id}`,
					kind: "dep"
				});
			}
			const degree = /* @__PURE__ */ new Map();
			for (const e of edges) {
				degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
				degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
			}
			const connected = all.filter((n) => (degree.get(n.key) ?? 0) > 0 || n.kind !== "ticket");
			const orphanOfKind = {
				ticket: 0,
				ledger: 0,
				defect: 0
			};
			for (const n of all) if ((degree.get(n.key) ?? 0) === 0 && n.kind === "ticket") orphanOfKind.ticket++;
			const parentOf = /* @__PURE__ */ new Map();
			const childrenOf = /* @__PURE__ */ new Map();
			const treeEdges = [];
			const crossEdges = [];
			for (const e of edges) {
				if (!byKey.has(e.from) || !byKey.has(e.to)) {
					crossEdges.push(e);
					continue;
				}
				if (!parentOf.has(e.to)) {
					parentOf.set(e.to, e.from);
					if (!childrenOf.has(e.from)) childrenOf.set(e.from, []);
					childrenOf.get(e.from).push(e.to);
					treeEdges.push(e);
				} else crossEdges.push(e);
			}
			const kindOrder = {
				ticket: 0,
				ledger: 1,
				defect: 2
			};
			const roots = connected.filter((n) => !parentOf.has(n.key)).sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.key.localeCompare(b.key));
			let row = 0;
			const walk = (key, depth) => {
				const node = byKey.get(key);
				const x = depth * INDENT;
				const y = TOP + row * 80;
				row++;
				nodes.push({
					node,
					x,
					y
				});
				pos.set(key, {
					x,
					y
				});
				for (const c of childrenOf.get(key) ?? []) walk(c, depth + 1);
			};
			for (const r of roots) walk(r.key, 0);
			const maxRight = Math.max(...nodes.map((n) => n.x + NODE_W), NODE_W);
			const H = Math.max(TOP + row * 80, 120) + 30;
			return {
				nodes,
				treeEdges,
				crossEdges,
				pos,
				W: maxRight + 40,
				H,
				orphans: orphanOfKind
			};
		}
		function ChainView({ tickets, defects, ledgers, cases, planDir, scope, ctx, sessions, onChanged, readOnly }) {
			const [focus, setFocus] = (0, react.useState)(null);
			const [active, setActive] = (0, react.useState)(null);
			const { nodes, treeEdges, crossEdges, pos, W, H, orphans } = (0, react.useMemo)(() => buildChain(tickets, defects, ledgers, cases), [
				tickets,
				defects,
				ledgers,
				cases
			]);
			const NODE_W = 250;
			const connectedEdges = (0, react.useMemo)(() => {
				const m = /* @__PURE__ */ new Map();
				if (active === null) return m;
				for (const e of [...treeEdges, ...crossEdges]) if (e.from === active || e.to === active) {
					if (!m.has(active)) m.set(active, /* @__PURE__ */ new Set());
					m.get(active).add(`${e.from}->${e.to}`);
				}
				return m;
			}, [
				treeEdges,
				crossEdges,
				active
			]);
			const isConnected = (e) => active === null || (connectedEdges.get(active)?.has(`${e.from}->${e.to}`) ?? false);
			const mk = (x1, y1, x2, y2) => `M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`;
			const NODE_H = 68;
			const KIND_COLOR = {
				ticket: "#609bfa",
				ledger: "#f7ad31",
				defect: "#f2555a",
				cases: "#4ed17e"
			};
			const KIND_LABEL = {
				ticket: "工单/拍板",
				ledger: "挂账",
				defect: "缺陷",
				cases: "测例"
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					background: BG,
					color: TEXT,
					overflow: "hidden"
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "10px 16px 6px",
							display: "flex",
							gap: 14,
							alignItems: "center",
							flexWrap: "wrap"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: 13,
									fontWeight: 700
								},
								children: "🧪 串联（实验）"
							}),
							Object.entries(KIND_COLOR).map(([kind, c]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: {
									display: "inline-flex",
									alignItems: "center",
									gap: 4,
									fontSize: 10,
									color: TEXT_FAINT
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
										width: 3,
										height: 12,
										background: c,
										display: "inline-block",
										borderRadius: 2
									} }),
									" ",
									KIND_LABEL[kind]
								]
							}, kind)),
							Object.entries(CHAIN_EDGE_STYLE).map(([kind, s]) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: {
									display: "inline-flex",
									alignItems: "center",
									gap: 4,
									fontSize: 10,
									color: TEXT_FAINT
								},
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
										width: 16,
										height: 2,
										background: s.color,
										display: "inline-block"
									} }),
									" ",
									s.label
								]
							}, kind)),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: {
									fontSize: 11,
									color: TEXT_FAINT,
									marginLeft: "auto"
								},
								children: [
									nodes.length,
									" 节点 · ",
									treeEdges.length + crossEdges.length,
									" 条连线 · 关系自文档文本抽取"
								]
							})
						]
					}),
					orphans.ticket + orphans.ledger + orphans.defect > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "2px 16px 4px",
							fontSize: 10.5,
							color: TEXT_FAINT
						},
						children: [
							"另有 ",
							orphans.ticket,
							" 张工单与其他条目无关联、未画入——在票面对应文档里写上「票 NN」「挂账-NN」即可入链。"
						]
					}),
					nodes.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: TEXT_FAINT
						},
						children: "当前图没有可串联的票 / 挂账 / 缺陷。"
					}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							flex: 1,
							overflow: "auto",
							position: "relative"
						},
						onClick: () => setActive(null),
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								position: "relative",
								width: W,
								height: H,
								margin: "0 auto"
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
								width: W,
								height: H,
								style: {
									position: "absolute",
									left: 0,
									top: 0,
									pointerEvents: "none",
									zIndex: 1
								},
								children: [treeEdges.map((e, i) => {
									const a = pos.get(e.from), b = pos.get(e.to);
									if (a === void 0 || b === void 0) return null;
									const st = CHAIN_EDGE_STYLE[e.kind];
									const on = isConnected(e);
									const sx = a.x + NODE_W, sy = a.y + NODE_H / 2;
									const ex = b.x, ey = b.y + NODE_H / 2;
									const slotX = ex - 18;
									const d = ey === sy ? `M ${sx} ${sy} L ${ex} ${ey}` : `M ${sx} ${sy} L ${slotX} ${sy} L ${slotX} ${ey} L ${ex} ${ey}`;
									return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
										d,
										fill: "none",
										stroke: on ? st.color : "rgba(255,255,255,.16)",
										strokeWidth: on ? 2.2 : 1.4,
										opacity: active !== null && !on ? .3 : 1
									}, `t${i}`);
								}), crossEdges.map((e, i) => {
									const a = pos.get(e.from), b = pos.get(e.to);
									if (a === void 0 || b === void 0) return null;
									const on = isConnected(e);
									return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
										d: mk(a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2),
										fill: "none",
										stroke: on ? "#609bfa" : "rgba(255,255,255,.14)",
										strokeWidth: on ? 2 : 1.3,
										strokeDasharray: "5 4",
										opacity: active !== null && !on ? .3 : 1
									}, `x${i}`);
								})]
							}), nodes.map(({ node, x, y }) => {
								const on = active === node.key || edgesRelated(node.key, active, treeEdges, crossEdges);
								return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									onClick: (ev) => {
										ev.stopPropagation();
										setActive(node.key);
										setFocus(node.ticket);
									},
									onMouseEnter: () => setActive(node.key),
									onMouseLeave: () => setActive(null),
									style: {
										position: "absolute",
										left: x,
										top: y,
										width: NODE_W,
										height: NODE_H,
										zIndex: 3,
										display: "flex",
										background: CARD,
										borderRadius: 10,
										overflow: "hidden",
										cursor: "pointer",
										border: `1px solid ${active === node.key ? TEXT : BORDER}`,
										boxShadow: active === node.key ? "0 4px 18px rgba(0,0,0,.5)" : "0 2px 8px rgba(0,0,0,.3)",
										opacity: active !== null && !on ? .4 : 1,
										transition: "opacity .15s"
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: {
											width: 4,
											flexShrink: 0,
											background: KIND_COLOR[node.kind]
										} }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												padding: "7px 9px",
												flex: 1,
												minWidth: 0,
												display: "flex",
												flexDirection: "column",
												gap: 3
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: {
														display: "flex",
														alignItems: "center",
														gap: 6,
														paddingRight: 14
													},
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															fontSize: 9,
															padding: "1px 6px",
															borderRadius: 999,
															flexShrink: 0,
															background: CHIP_BG,
															color: "#999"
														},
														children: node.badge
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: {
															fontSize: 11,
															fontWeight: 700,
															color: TEXT,
															lineHeight: 1.3,
															overflow: "hidden",
															textOverflow: "ellipsis",
															whiteSpace: "nowrap",
															flex: 1
														},
														children: node.title
													})]
												}),
												node.sub && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													style: {
														fontSize: 9,
														color: TEXT_FAINT,
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap"
													},
													children: node.sub
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
													ticket: node.ticket,
													scope,
													ctx,
													size: 9
												})
											]
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											title: node.badge,
											style: {
												position: "absolute",
												right: 7,
												top: 7,
												width: 8,
												height: 8,
												borderRadius: 999,
												background: node.badgeColor,
												boxShadow: "0 0 0 2px rgba(0,0,0,.25)"
											}
										})
									]
								}, node.key);
							})]
						})
					}),
					focus && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DetailModal, {
						ticket: focus,
						planDir,
						scope,
						ctx,
						sessions,
						onChanged,
						onClose: () => setFocus(null),
						readOnly
					})
				]
			});
		}
		function edgesRelated(key, active, treeEdges, crossEdges) {
			if (active === null) return true;
			for (const e of [...treeEdges, ...crossEdges]) if (e.from === key && e.to === active || e.from === active && e.to === key) return true;
			return false;
		}
		function DocCard({ icon, title, path, scope, ctx, body }) {
			const open = () => openFileInSidebar(ctx, scope, path, path);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					minHeight: 0,
					overflowY: "auto",
					padding: 12
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: MD_CSS }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						border: `1px solid ${BORDER}`,
						borderRadius: 10,
						background: CARD,
						overflow: "hidden"
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							padding: "10px 14px",
							borderBottom: `1px solid ${BORDER}`,
							display: "flex",
							alignItems: "center",
							gap: 8,
							background: HEADER_BG
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								fontSize: 13,
								fontWeight: 700,
								color: TEXT
							},
							children: [
								icon,
								" ",
								title
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							onClick: open,
							title: `点击在右栏打开：${path}`,
							style: {
								fontSize: 10.5,
								fontFamily: "ui-monospace,Menlo,monospace",
								color: TEXT_FAINT,
								background: "transparent",
								border: "none",
								padding: 0,
								cursor: "pointer",
								textAlign: "left",
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap"
							},
							children: path
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							padding: "10px 14px 14px",
							fontSize: 13,
							color: TEXT_DIM
						},
						dangerouslySetInnerHTML: { __html: md(body) }
					})]
				})]
			});
		}
		function CasesView({ cases, scope, ctx, readOnly }) {
			if (cases.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					color: TEXT_FAINT,
					padding: 24,
					textAlign: "center"
				},
				children: [
					"当前图没有测例文档。",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 12,
							color: TEXT_FAINT
						},
						children: "`to-qa-testcases` 产出的 `.plan/<effort>/qa/cases.md` 会按图列在这里（一图一份，不拆文件）。"
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					flex: 1,
					minHeight: 0,
					overflow: "hidden",
					display: "flex",
					flexDirection: "column"
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						flex: 1,
						minHeight: 0,
						overflowY: "auto",
						padding: 12,
						display: "flex",
						flexDirection: "column",
						gap: 12
					},
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: MD_CSS }), cases.map((c) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							border: `1px solid ${BORDER}`,
							borderRadius: 10,
							background: CARD,
							overflow: "hidden"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								padding: "10px 14px",
								borderBottom: `1px solid ${BORDER}`,
								display: "flex",
								alignItems: "center",
								gap: 8,
								background: HEADER_BG
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								style: {
									fontSize: 13,
									fontWeight: 700,
									color: TEXT
								},
								children: ["🧪 ", c.title]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
								ticket: c,
								scope,
								ctx
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								padding: "10px 14px 14px",
								fontSize: 13,
								color: TEXT_DIM
							},
							dangerouslySetInnerHTML: { __html: md(c.body) }
						})]
					}, `${c.effort}/${c.file}`))]
				})
			});
		}
		const ADR_STATUS_META = {
			proposed: {
				label: "proposed",
				color: "#f7ad31"
			},
			accepted: {
				label: "accepted",
				color: "#4ed17e"
			},
			deprecated: {
				label: "deprecated",
				color: "#f2555a"
			},
			superseded: {
				label: "superseded",
				color: "#f2555a"
			}
		};
		function AdrView({ adrs, scope, ctx }) {
			const sorted = (0, react.useMemo)(() => [...adrs].sort((a, b) => a.id.localeCompare(b.id)), [adrs]);
			if (sorted.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					color: TEXT_FAINT,
					padding: 24,
					textAlign: "center"
				},
				children: [
					"本仓仓根暂无 ",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "docs/adr/" }),
					"。",
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							fontSize: 12,
							color: TEXT_FAINT
						},
						children: "架构决策记录落 `docs/adr/NNNN-<slug>.md`（格式正本 domain-modeling/ADR-FORMAT.md），落第一份后本页自动呈现。"
					})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					flex: 1,
					overflowY: "auto",
					padding: 12,
					display: "flex",
					flexDirection: "column",
					gap: 12
				},
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: MD_CSS }), sorted.map((a) => {
					const s = ADR_STATUS_META[statusWord(a)];
					const num = a.id.match(/^(\d{4})/)?.[1] ?? a.id;
					const title = a.title.replace(/^(?:ADR[-:\s]*)?\d{4}[-:\s]+/, "") || a.title;
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							border: `1px solid ${BORDER}`,
							borderRadius: 10,
							background: CARD,
							overflow: "hidden"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								padding: "10px 14px",
								borderBottom: `1px solid ${BORDER}`,
								display: "flex",
								alignItems: "center",
								gap: 8,
								background: HEADER_BG,
								flexWrap: "wrap"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontFamily: "ui-monospace,Menlo,monospace",
										fontSize: 12,
										fontWeight: 700,
										color: ACCENT_SOFT
									},
									children: ["ADR-", num]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 13,
										fontWeight: 700,
										color: TEXT
									},
									children: title
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										padding: "2px 8px",
										borderRadius: 999,
										border: `1px solid ${s ? `${s.color}55` : "#555"}`,
										color: s ? s.color : "#999"
									},
									children: s ? s.label : "未标"
								}),
								a.date && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: 11,
										color: TEXT_FAINT
									},
									children: a.date
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FilePath, {
									ticket: a,
									scope,
									ctx
								})
							]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: {
								padding: "10px 14px 14px",
								fontSize: 13,
								color: TEXT_DIM
							},
							dangerouslySetInnerHTML: { __html: md(a.body) }
						})]
					}, a.path ?? a.file);
				})]
			});
		}
		//#endregion
		//#region src/client/plan-icon.tsx
		/**
		* Plan 的共用标识：官方侧边栏票 kind、定义 id 与图标。
		*
		* 右侧栏的 Plan 票（`index.tsx` 注册）与会话头部的一键入口
		* （`entry-button.tsx`）指向同一处定义——避免 kind/id 字符串或图标形状两处
		* 各写一份而漂移。
		*/
		/** Plan 票的 kind（`ctx.sidebarRight.openTab` 点名的路由判别名）。 */
		const PLAN_TAB_KIND = "planview";
		/** Plan 票实现的定义 id（正文 slot `sidebar.right.pane.tab` 的 key，与 definition.id 一致）。 */
		const PLAN_TAB_ID = "dsh-plan-view/plan";
		/**
		* Plan 图标：方框叠三条横线。
		* @param props - `size` 为图标边长（像素）。
		* @returns 一个随文字色着色的 SVG。
		*/
		function PlanIcon({ size }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "1",
						y: "1",
						width: "14",
						height: "14",
						rx: "3",
						stroke: "currentColor",
						strokeWidth: "1.5"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "4",
						y1: "5",
						x2: "12",
						y2: "5",
						stroke: "currentColor",
						strokeWidth: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "4",
						y1: "8",
						x2: "12",
						y2: "8",
						stroke: "currentColor",
						strokeWidth: "1.2"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
						x1: "4",
						y1: "11",
						x2: "9",
						y2: "11",
						stroke: "currentColor",
						strokeWidth: "1.2"
					})
				]
			});
		}
		//#endregion
		//#region src/client/entry-button.tsx
		/** 本入口在会话头部那一排里的位置：排在底部面板开关（10）之后、状态类控件之前。 */
		const ENTRY_ORDER = 50;
		/** 按钮样式：跟随头部其它图标控件的观感（继承文字色、无边框、悬停给一点底色）。 */
		const buttonStyle = {
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center",
			padding: 4,
			border: "none",
			borderRadius: 6,
			background: "transparent",
			color: "inherit",
			cursor: "pointer",
			lineHeight: 0
		};
		/**
		* 入口按钮本体。
		* @param props - 该位为会话作用域；`open` 由注册项的 inject 面提供。
		* @returns 一个 Plan 图标按钮。
		*/
		function PlanEntryButton({ open }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				style: buttonStyle,
				title: "打开 Plan",
				"aria-label": "打开 Plan",
				"data-plan-entry": "header",
				onClick: open,
				onMouseEnter: (event) => {
					event.currentTarget.style.background = "rgba(255,255,255,.08)";
				},
				onMouseLeave: (event) => {
					event.currentTarget.style.background = "transparent";
				},
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlanIcon, { size: 16 })
			});
		}
		/**
		* 注册入口按钮。
		* @param ctx - 客户端根上下文（需已注入 `slots` 与 `sidebarRight`）。
		* @returns 注销函数。
		*/
		function registerPlanEntry(ctx) {
			return ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "dsh-plan-view:header-entry",
				order: ENTRY_ORDER,
				registrant: "dsh-plan-view",
				inject: () => ({ open: () => {
					try {
						ctx.sidebarRight.openTab(PLAN_TAB_KIND);
					} catch {}
				} })
			}, PlanEntryButton));
		}
		//#endregion
		//#region src/client/index.tsx
		const inject = [
			"slots",
			"sidebarRight",
			"sidebarRightTabs"
		];
		function apply(ctx) {
			ctx.effect(() => registerInputBridge(ctx));
			ctx.effect(() => registerPlanEntry(ctx));
			ctx.effect(() => ctx.sidebarRightTabs.register({
				id: PLAN_TAB_ID,
				kind: PLAN_TAB_KIND,
				priority: "builtin",
				title: () => "Plan",
				guide: [{
					id: "plan-entry",
					order: 50,
					title: () => "Plan",
					description: () => "计划面板：.scratch/.plan 治理视图（工单、地图、待拍板、台账）",
					icon: PlanIcon
				}]
			}));
			ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
				name: "sidebar.right.pane.tab",
				key: PLAN_TAB_ID,
				inject: () => ({ planCtx: ctx })
			}, PlanTabBody));
		}
		/**
		* 正文壳：sessionId（框架 props）+ planCtx（inject face）→ PlanView。加载中的
		* 目录解析也由 PlanView 内部的 snapshot 响应承担；解析失败给一行诊断而不是白屏。
		*/
		function PlanTabBody(props) {
			const sessionId = props.sessionId;
			if (sessionId === void 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					padding: 16,
					fontSize: 12,
					color: "#888"
				},
				children: "Plan：无法解析会话（缺 sessionId）。"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PlanView, {
				ctx: props.planCtx,
				sessionId
			});
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map