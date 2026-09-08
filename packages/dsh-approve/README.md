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
  (ask — presented by DSH core `ui-approval`). A **whitelisted** command's own
  in-tool sandbox escalation is auto-granted by callId correlation, so
  whitelisted commands stay prompt-free end-to-end.
- **Everything else** — file tools writing outside the workspace, any
  `sandbox_permissions` escalation the plugin does not own: **DSH's original
  approval still prompts the human**. The plugin is NOT a blanket
  auto-approver; it only adds a command-level gate on top of DSH's approval.
- **Whitelist writes are human-gated.** The model tools
  `dsh_approve_whitelist_add` / `dsh_approve_whitelist_remove` **require a
  human approval prompt** before touching `~/.dsh/dsh-approve.json` — an agent
  cannot whitelist autonomously.
- ⚠️ Keep the DSH/session approval policy at `ask`. Setting it to `never`
  rejects every ask *before* listeners run, so no confirmation dialog appears.

## Architecture (zero DSH-core changes)

The plugin is a **pure host plugin**, no DSH core modification:

| Half | File | Role |
| --- | --- | --- |
| Host | `lib/server.js` (Node, `main`/`exports["."]`) | policy engine, `tools/pre-execute` / `approval/request` / `tools/post-execute` hooks, model tools, direct HTTP routes |

The approval-dialog UI is entirely DSH core `ui-approval` (the native panel on
`conversation.composer`). This plugin's `approval/request` hook auto-grants
already-whitelisted calls; non-whitelisted commands that need a human decision
are presented by the core panel (Reject / Allow once).

> Historical: an earlier version registered a custom three-button composer
> panel (with an "add to whitelist" button) at `priority: 0.5`. Its selector
> read the deprecated `ComposerChainProps.interactions` array (the current core
> currency is a single `pendingInteraction`), so it crashed on render. That
> client half was removed; whitelisting now goes through the human-gated model
> tool `dsh_approve_whitelist_add`.

## The confirmation dialog (presented by DSH core ui-approval)

Non-whitelisted commands that need a human decision are presented by DSH
core's approval panel (`ui-approval`): Reject / Allow once.

> ⚠️ Keep the DSH/session approval policy at `ask`. Setting it to `never`
> rejects every ask *before* listeners run, so no confirmation dialog appears.

Everything in the whitelist — added via `dsh_approve_whitelist_add` (which
requires your approval first) — is exact-full-match and never intercepted
again. If you want an "add to whitelist + allow" one-click button in the
dialog itself, that needs a custom composer panel (this plugin does not ship
one anymore).

## Install (from the GitHub monorepo)

```sh
dsh plugin --profile web add 'github:huzilin/dsh-plugin#path:/packages/dsh-approve'
```

This installs the package from the remote repo as a real dependency (no local
symlink), and `dsh plugin` automatically appends it to the profile's bundle
layers. Then restart `dsh web` **once**:

- The plugin mounts via the **bundle layer** (`dsh.profile.bundles`), so
  **no user-layer `cordis.patch.yml` insert row is needed** — keep that file
  as `[]` to avoid double-mounting.
- Pure host plugin — no client bundle.

Mount marker (created once on apply, for verification): `~/.dsh/dsh-approve.mounted`.

> Updating after a local push: `cd ~/.dsh/profiles/web && pnpm update dsh-approve`,
> then restart `dsh web`.

## Build

The plugin (`lib/server.js`) is plain JS — no build step.

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
  raise an approval prompt before touching `~/.dsh/dsh-approve.json` (there is
  no direct-write dialog-button path anymore — the old client panel was
  removed). `denyPatterns` / `enforceDanger` are preserved on write.

## License

MIT