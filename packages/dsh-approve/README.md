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

## Single approval gate (DSH's own approval is off)

- The plugin **auto-answers every DSH sandbox-escalation approval**
  (`approval/request` whose reason starts with `escalate sandbox to`, for ANY
  tool) with `allowed-once` (config `suppressDshApproval`, default
  `true`). You will only ever see this plugin's own confirmation dialog.
- ⚠️ Do NOT set the DSH/session approval policy to `never`: `never` rejects
  every ask *before* listeners run, so this plugin's confirmation dialog
  would be auto-rejected too. Keep the policy at `ask` and let the plugin
  auto-answer DSH's prompts. (The ask dialog's text reminds you of this.)

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

Everything in the whitelist — added by config or by
`dsh_approve_whitelist_add` — is exact-full-match and never intercepted again.

## Install

```sh
dsh plugin --profile web add link:/Users/huzilin/workdir/dsh-plugin/packages/dsh-approve
```

Restart `dsh web` (this registers the package as a profile bundle layer).

**User-layer (no pnpm) install** — ⚠️ known caveat: a running `dsh web`
watches the profile's `cordis.patch.yml`, but live-INSERTING a new plugin row
into the hot-reloaded user layer currently wedges the running host's tool
pipeline (`Cannot read properties of undefined (reading 'kind')`). Do NOT
hot-insert: write the row, then restart `dsh web` once with the row present
at boot (cold mount is fine). Install steps:

```sh
cd ~/.dsh/profiles/web && pnpm add link:/Users/huzilin/workdir/dsh-plugin/packages/dsh-approve
```

`~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-approve
      name: 'dsh-approve'
```

Mount marker (created once on apply, for verification): `~/.dsh/dsh-approve.mounted`.

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
- `suppressDshApproval` — `false` keeps DSH's own sandbox-escalation prompts
  instead of auto-answering them.

## Model tools

- `dsh_approve_status` — active state, whitelist, floors, suppression flag.
- `dsh_approve_whitelist_add(command)` — persist one exact command to the
  whitelist (live). Use when the user says "加入白名单".
- `dsh_approve_whitelist_remove(command)` — remove one exact command.

## Security notes

- Denials are fail-closed: the deny/ask decisions short-circuit the
  `tools/pre-execute` waterfall (`prepend: true`), and any later monotonic
  guard can still deny.
- The danger floor covers only system-level destructive patterns (mkfs, dd →
  block device, disk tools, power state, fork bomb, sudo mkfs/dd); rm, curl/sh,
  and chmod/chown root recursion were removed from it (2026-08-22) and can be
  re-added through `denyPatterns` if you want them hard-blocked again.
- With `suppressDshApproval: true`, sandbox escalation is auto-granted for
  every tool — the trade-off you asked for ("DSH approval off, one gate").
  A whitelisted shell command's escalation ask is auto-granted via `callId`
  correlation; every non-escalation ask this plugin does not own still
  reaches the human.
- Whitelist writes are atomic (tmp + rename) and only touch the exact
  `whitelist` key; `denyPatterns`/`enforceDanger`/`suppressDshApproval` are
  preserved.

## License

MIT