# dsh-approve

DSH command whitelist plugin. Built on the DSH `tools/pre-execute` and
`approval/request` extension points.

English | [中文](README.zh.md)

## Policy

For every shell command (`bash`, `pwsh`, `ssh_exec`, `ssh_cluster`), in order:

| # | Condition | Outcome |
| --- | --- | --- |
| 1 | Exact match in the whitelist (full command string, byte-for-byte) | **allow** — no confirmation, any directory; the call's in-tool sandbox escalation ask is auto-granted too (correlated by `callId`) |
| 2 | Dangerous **system-level** command (`mkfs`, `dd of=/dev/…`, `fdisk/parted/gdisk/diskutil /dev/…`, `shutdown/reboot/halt/poweroff`, fork bomb, `sudo mkfs/dd`) | **deny** — hard-blocked before dispatch, in ANY directory |
| 3 | Non-current-directory command: `workdir` points **outside** the session workspace tree (another project, `/tmp`, home, …), or a remote exec (`ssh_exec`/`ssh_cluster`) | **ask** — the human confirms unless whitelisted |
| 4 | Everything else (safe command in the session workspace, including its subdirectories) | **allow** — untouched |

Notes:
- **`rm`, `curl`, `sh`, `chmod -R … /`, `chown -R … /` are NOT in the built-in
  danger floor** (user decisions, 2026-08-22): they follow the normal policy —
  outside the workspace they ask, in the workspace they run. Re-add any of
  them via the `denyPatterns` config (e.g. `["^rm ", "\\bcurl\\b.*\\|\\s*sh\\b"]`).
- The whitelist is **exact full-match**: entries are compared to the trimmed
  command string with plain string equality — no prefixes, no substrings, no
  wildcards. Whitelisting an exact command is your explicit pre-approval, so
  it wins over the danger floor (case 1 before case 2).

"Current directory" = the session workspace (`agent.session.header.cwd`). A
`workdir` equal to the workspace or anywhere inside its tree counts as
current; everything that escapes it is "outside" and needs confirmation.

## Approval layering (DSH's own approval stays ON)

The plugin does **NOT** suppress DSH's own approval. It is hardcoded off
(2026-08-22 user decision — there is **no** `suppressDshApproval` config).

- **Shell commands** (`bash`/`pwsh`/`ssh_*`): policed by this plugin only —
  whitelist exact-match (zero prompt) / system-dangerous (deny) / non-workspace
  (ask via this plugin's 3-button dialog). A **whitelisted** command's own
  in-tool sandbox escalation is auto-granted by callId correlation, so
  whitelisted commands stay prompt-free end-to-end.
- **Everything else** — file tools writing outside the workspace, any
  `sandbox_permissions` escalation the plugin does not own: **DSH's original
  approval still prompts the human**. The plugin is NOT a blanket
  auto-approver; it only adds a command-level gate on top of DSH's approval.
- **Whitelist writes are human-gated.** The dialog's 加入白名单 button is your
  own click (= your approval). The model tools `dsh_approve_whitelist_add` /
  `dsh_approve_whitelist_remove` **require a human approval prompt** before
  touching `~/.dsh/dsh-approve.json` — an agent cannot whitelist autonomously.
- ⚠️ Keep the DSH/session approval policy at `ask`. Setting it to `never`
  rejects every ask *before* listeners run, so this plugin's confirmation
  dialog would be auto-rejected too.

## Architecture (zero DSH-core changes)

The plugin is a **single package with two halves**, no DSH core modification:

| Half | File | Role |
| --- | --- | --- |
| Host | `lib/server.js` (Node, `main`/`exports["."]`) | policy engine, `tools/pre-execute` / `approval/request` / `tools/post-execute` hooks, model tools, direct HTTP routes |
| Client | `lib/client.js` (browser bundle, `exports["./client"]`) | **takes over the approval dialog** — a `conversation.composer` chain entry registered at `priority: 0.5` (chain slots elect ascending priority; 0.5 beats the core panel's 1, while question takeovers at 0 still win when both kinds are pending) |

The client half is fully self-sufficient: the exact command comes from the ask
reason's `命令：` line, the 加入白名单 button POSTs to the host's
`/dsh-approve/whitelist-add` route, and answering rides the carrier's
`respond()` (same wire shape as the core PendingApproval).

> ⚠️ The browser must fetch a FRESH boot manifest to load the client half:
> clear the browser/webview cache (or use an incognito window) after changing
> the client bundle. The `dsh.client.immediately: true` declaration makes the
> module load at boot.

## The confirmation dialog (three actions)

The plugin's own panel renders the approval dialog (replacing the stock
two-button one):

| Action | How | Effect |
| --- | --- | --- |
| 拒绝 (Reject) | button | this command is blocked |
| 加入白名单 (add to whitelist) | button — the dialog `POST`s the exact command to `/dsh-approve/whitelist-add` (a route the plugin registers on the core `webServer` service) | persisted instantly, then this run is allowed; never blocked/asked again |
| 允许一次 (Allow once) | button | this command runs now |

Everything in the whitelist — added by the dialog button (your click) or by
`dsh_approve_whitelist_add` (which requires your approval first) — is
exact-full-match and never intercepted again.

## Install (from the GitHub monorepo)

```sh
dsh plugin --profile web add 'github:huzilin/dsh-plugin#path:/packages/dsh-approve'
```

This installs the package from the remote repo as a real dependency (no local
symlink), and `dsh plugin` automatically appends it to the profile's bundle
layers. Then restart `dsh web` **once**:

- The host half mounts via the **bundle layer** (`dsh.profile.bundles`), so
  **no user-layer `cordis.patch.yml` insert row is needed** — keep that file
  as `[]` to avoid double-mounting.
- The client half is discovered from `dsh.client` in package.json and served
  as `/plugins/dsh-approve/client.js`.

Mount marker (created once on apply, for verification): `~/.dsh/dsh-approve.mounted`.

> Updating after a local push: `cd ~/.dsh/profiles/web && pnpm update dsh-approve`,
> then restart `dsh web` (the client bundle rev changes need a cache-cleared
> browser reload).

## Build (client half)

The host half (`lib/server.js`) is plain JS — no build. The client half is a
tsdown bundle (`src/client/ → lib/client.js`) using the DSH client face:

```sh
/Users/huzilin/workdir/deepseek-harness/node_modules/.bin/tsdown
```

Run from this package root. After rebuilding, the DSH `modules` service
content-hashes `lib/client.js` into a new `rev` — refresh the browser with a
**cache-cleared** reload (or restart `dsh web`).

> Note: do not add the row while `dsh web` is running (hot reload of an
> insert wedges the host; stop, edit, start). If you later also run
> `dsh plugin add` (route 1), remove the user-layer row — otherwise the
> plugin mounts twice (duplicate hook listeners and a clashing status tool).

## Config

`~/.dsh/dsh-approve.json`:

```json
{
  "whitelist": [
    "rm -rf /tmp/build-cache",
    "git push origin main"
  ],
  "denyPatterns": [
    "^freshclam "
  ],
  "enforceDanger": true
}
```

- `whitelist` — exact full command strings to auto-allow anywhere (config is
  re-read on every decision, so edits — and runtime whitelist-add — apply
  immediately, no restart).
- `denyPatterns` — extra regex deny patterns on top of the built-in floor
  (invalid regexes are dropped with a log line).
- `enforceDanger` — `false` disables the built-in danger floor (advanced).
  There is NO `suppressDshApproval` key: DSH's own approval is always kept on
  (see "Approval layering").

## Model tools

- `dsh_approve_status` — active state, whitelist, danger floor.
- `dsh_approve_whitelist_add(command)` — persist one exact command to the
  whitelist (live). **Requires human approval** — the agent raises a DSH
  approval prompt and is denied unless you allow it.
- `dsh_approve_whitelist_remove(command)` — remove one exact command.
  **Also requires human approval.**

## Security notes

- Denials are fail-closed: the deny/ask decisions short-circuit the
  `tools/pre-execute` waterfall (`prepend: true`), and any later monotonic
  guard can still deny.
- The danger floor covers only system-level destructive patterns (mkfs, dd →
  block device, disk tools, power state, fork bomb, sudo mkfs/dd); rm, curl/sh,
  and chmod/chown root recursion were removed from it (2026-08-22) and can be
  re-added through `denyPatterns` if you want them hard-blocked again.
- DSH's own sandbox-escalation approval is **left intact** (hardcoded, no
  config): file tools / escalations the plugin does not own still ask the
  human. A whitelisted shell command's escalation ask is auto-granted via
  `callId` correlation so whitelisted commands never re-prompt.
- Whitelist writes are atomic (tmp + rename) and human-gated: the model tools
  raise an approval prompt before touching `~/.dsh/dsh-approve.json`; only the
  dialog's 加入白名单 button (your click) writes directly. `denyPatterns` /
  `enforceDanger` are preserved on write.

## License

MIT