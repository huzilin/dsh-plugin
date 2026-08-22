// dsh-approve client rev 1787384690
window.__ModuleLoader__.load({
	id: "dsh-approve",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/ApprovalPanel.tsx
		/**
		* dsh-approve approval panel: the composer-takeover seat for pending
		* approvals, replacing the core ui-conversation panel (registered by this
		* plugin at priority 0.5 on `conversation.composer`).
		*
		* Self-sufficient by design:
		*  - the exact command is read from the ask reason's LAST `命令：` line (the
		*    host writes it), so no session/node-index dependency;
		*  - the 加入白名单 button persists directly to the host plugin's
		*    /dsh-approve/whitelist-add route, then allows this run once;
		*  - answering uses the carrier's respond() with the same wire shape as the
		*    core PendingApproval (sessionId + approvalId + outcome).
		*
		* Styling is inline (CSS variables ride the theme tokens) so this client
		* bundle needs no CSS pipeline.
		*/
		/** The dsh-approve ask reason's opening line (the whitelist button shows only for these). */
		const DSH_APPROVE_ASK_PREFIX = "命令在会话工作区之外运行";
		/**
		* The exact command from the ask reason's LAST `命令：` line. The host writes
		* `命令：<command>` as the reason's final line, which the panel parses here.
		*/
		function whitelistCommandOf(reason) {
			if (typeof reason !== "string") return void 0;
			const idx = reason.lastIndexOf("命令：");
			if (idx === -1) return void 0;
			const rest = reason.slice(idx + 3).trim();
			return rest === "" ? void 0 : rest;
		}
		/**
		* Render the reason without its own `命令：` line (the command is displayed
		* once, below, in the prominent command line); real line breaks via <br />.
		*/
		function ReasonText({ text }) {
			const lines = text.split("\n").filter((line) => !line.startsWith("命令："));
			if (lines.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: lines.map((line, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [line, index < lines.length - 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("br", {}) : null] }, index)) });
		}
		/** Answer the approval through the carrier (same wire encoding as the core PendingApproval). */
		async function answerApproval(wait, outcome) {
			const receipt = await wait.respond({
				ok: true,
				value: {
					sessionId: wait.sessionId,
					approvalId: wait.payload.approvalId,
					outcome
				}
			});
			if (!receipt.accepted) throw new Error(`approval response rejected: ${receipt.reason}`);
		}
		/** Persist the exact command to the dsh-approve whitelist DIRECTLY (host route). */
		async function whitelistAddDirect(command) {
			const response = await fetch("/dsh-approve/whitelist-add", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ command })
			});
			let body = {};
			try {
				body = await response.json();
			} catch {}
			if (!response.ok || body.ok !== true) throw new Error(body.error ?? `whitelist-add failed: ${response.status}`);
		}
		const styles = {
			root: {
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				padding: "8px calc(var(--dsh-composer-side-clearance) + 16px) 12px"
			},
			card: {
				overflow: "hidden",
				width: "100%",
				maxWidth: "var(--dsh-chat-content-width)",
				border: "1px solid var(--dsw-alias-state-warn-secondary)",
				borderRadius: 20,
				background: "var(--dsw-specific-input-major)",
				boxShadow: "var(--dsw-shadow-lv2)"
			},
			strip: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				padding: "10px 16px",
				background: "var(--dsw-alias-state-warn-tertiary)",
				color: "var(--dsw-alias-state-warn-primary)",
				fontSize: 13,
				lineHeight: "18px"
			},
			dot: {
				width: 8,
				height: 8,
				borderRadius: "50%",
				background: "var(--dsw-alias-state-warn-primary)"
			},
			body: {
				display: "flex",
				flexDirection: "column",
				gap: 6,
				boxSizing: "border-box",
				maxHeight: "var(--dsh-composer-text-max-height)",
				overflowY: "auto",
				padding: "12px 16px 8px"
			},
			headline: {
				color: "var(--dsw-alias-label-primary)",
				fontSize: 15,
				fontWeight: 500,
				lineHeight: "24px"
			},
			command: {
				color: "var(--dsw-alias-label-primary)",
				fontFamily: "var(--ds-font-family-code)",
				fontSize: 13,
				lineHeight: "20px",
				wordBreak: "break-all"
			},
			error: {
				padding: "0 16px 8px",
				color: "var(--dsw-alias-state-error-primary)",
				fontSize: 12,
				lineHeight: "16px"
			},
			actionRow: {
				display: "flex",
				justifyContent: "flex-end",
				gap: 8,
				padding: "14px 16px"
			}
		};
		/** The main panel body. */
		function ApprovalPanel({ matched, t }) {
			const [{ settled, error }, setState] = (0, react.useState)({
				settled: false,
				error: null
			});
			const reason = matched.payload.reason;
			const command = whitelistCommandOf(reason);
			const allowWhitelist = reason?.startsWith(DSH_APPROVE_ASK_PREFIX) === true && command !== void 0;
			const finish = async (outcome, pre) => {
				setState({
					settled: true,
					error: null
				});
				try {
					if (pre !== void 0) await pre();
					await answerApproval(matched, outcome);
				} catch (err) {
					setState({
						settled: false,
						error: String(err instanceof Error ? err.message : err)
					});
				}
			};
			const reject = () => {
				finish("rejected");
			};
			const allowOnce = () => {
				finish("allowed-once");
			};
			const addToWhitelist = () => {
				finish("allowed-once", () => whitelistAddDirect(command));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: styles.root,
				"data-approval-key": matched.key,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: styles.card,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.strip,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: styles.dot }), t("approval.waiting")]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.body,
							"data-approval-scroll": "",
							tabIndex: 0,
							role: "group",
							"aria-label": t("approval.waiting"),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: styles.headline,
								children: reason !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ReasonText, { text: reason }) : t("approval.waiting")
							}), command !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: styles.command,
								children: command
							})]
						}),
						error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: styles.error,
							children: error
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.actionRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									disabled: settled,
									onClick: reject,
									children: t("approval.reject")
								}),
								allowWhitelist && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									disabled: settled,
									onClick: addToWhitelist,
									children: t("approval.addToWhitelist")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "primary",
									disabled: settled,
									onClick: allowOnce,
									children: t("approval.allowOnce")
								})
							]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/locales.ts
		/** Copy for the dsh-approve approval panel (this plugin owns its own namespace). */
		const zh = {
			"approval.waiting": "等待审批",
			"approval.reject": "拒绝",
			"approval.allowOnce": "允许一次",
			"approval.addToWhitelist": "加入白名单"
		};
		const en = {
			"approval.waiting": "Waiting for approval",
			"approval.reject": "Reject",
			"approval.allowOnce": "Allow once",
			"approval.addToWhitelist": "Add to whitelist"
		};
		//#endregion
		//#region src/client/index.ts
		/** Dictionary namespace owned by this plugin. */
		const NS = "dsh-approve";
		/** Required services: the slot registry and the panel's copy. */
		const inject = ["slots", "locale"];
		/** Chain routing: claim the composer while an approval wait is pending (pure — owner props only). */
		function selectApproval({ interactions }) {
			return interactions.find((i) => i.kind === "approval") ?? null;
		}
		/**
		* Client plugin body: register the `dsh-approve` dictionaries and the
		* approval panel into the composer chain, shadowing the core panel.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-approve: dictionaries");
			ctx.slots.inject("conversation.composer", () => ctx.slots.register({
				name: "conversation.composer",
				select: selectApproval,
				priority: .5,
				locale: NS
			}, ApprovalPanel));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map// 1787384669 force rev change
