/**
 * dsh-approve policy engine — pure, unit-testable.
 *
 * Decision model (checked in this order):
 *
 *   1. EXACT whitelist match  → 'whitelist'  (the user pre-approved this exact
 *      command; explicit intent wins over the danger floor below).
 *   2. Dangerous command      → 'dangerous'  (fail-closed floor: rm, mkfs, dd
 *      to a block device, shutdown, fork bomb, curl|sh, ... — DENIED even in
 *      the session workspace).
 *   3. Outside the workspace  → 'outside'    (non-current-directory command
 *      with a different `workdir`/remote target and no whitelist hit — the
 *      human must confirm).
 *   4. Anything else          → 'current'    (a safe command running in the
 *      session workspace — no intervention).
 *
 * "Whitelist is exact full match": entries are compared to the trimmed
 * command string as plain string equality — no prefixes, no substrings, no
 * regex, no wildcards.
 */

import { homedir } from 'node:os'
import { resolve, sep } from 'node:path'

/**
 * Built-in danger floor: commands that are never allowed unattended, in ANY
 * directory, unless the exact command is whitelisted. System-level destructive
 * commands only — rm, chmod/chown root recursion, and curl/sh piping were
 * removed from the built-in floor per user decision (2026-08-22): those are
 * now governed by the normal policy (whitelist exact match / non-workspace
 * ask / in-workspace allow).
 */
export const DANGEROUS_PATTERNS = [
  // filesystem / partition / device leveling
  /\bmkfs(?:\.\w+)?\s+/,
  /\bdd\s+.*\bof=\/dev\/(?:sd|hd|nvme|disk|rdisk)/,
  /\b(?:fdisk|parted|gdisk|diskutil)\s+\/dev\//,
  // power state
  /\b(?:shutdown|reboot|halt|poweroff)\b/,
  // fork bomb
  /:\(\s*\)\s*\{[^}]*:\|:&/,
  // sudo variants of the system-level floor (mkfs / dd to a block device)
  /\bsudo\s+(?:\bmkfs\b|\bdd\b\s+.*\bof=\/dev\/)/,
]

/** Target tools whose `command`/`code` argument this plugin polices. */
export const SHELL_TOOLS = new Set(['bash', 'pwsh', 'ssh_exec', 'ssh_cluster'])

/** Tools that always run somewhere OTHER than the session workspace (remote hosts). */
export const REMOTE_TOOLS = new Set(['ssh_exec', 'ssh_cluster'])

/**
 * Classify one shell command string against a pattern list.
 * @param {string | undefined} command
 * @param {readonly RegExp[] | RegExp[]} [extraPatterns] extra deny patterns on top of the built-in floor.
 * @returns {'dangerous' | 'safe'}
 */
export function classifyCommand(command, extraPatterns = []) {
  if (typeof command !== 'string' || !command.trim()) return 'safe'
  const cmd = command.trim()
  for (const re of [...DANGEROUS_PATTERNS, ...extraPatterns]) {
    if (re instanceof RegExp && re.test(cmd)) return 'dangerous'
  }
  return 'safe'
}

/**
 * Exact full-match whitelist check: the trimmed command string must equal a
 * whitelist entry byte-for-byte. No prefix/substring/regex semantics.
 * @param {string | undefined} command
 * @param {readonly string[]} [whitelist]
 * @returns {boolean}
 */
export function isExactWhitelisted(command, whitelist = []) {
  if (typeof command !== 'string' || !command.trim()) return false
  const cmd = command.trim()
  return whitelist.some(entry => typeof entry === 'string' && entry.trim() === cmd)
}

/** Expand a leading `~`/`~/...` in a path and normalize it to a canonical form. */
function normalizePath(input, base) {
  let value = String(input).trim()
  if (value === '') return ''
  if (value === '~') value = homedir()
  else if (value.startsWith('~/')) value = `${homedir()}${value.slice(1)}`
  const resolved = resolve(base, value)
  // strip trailing separator (except the fs root) so `/ws/` and `/ws` compare equal
  return resolved.length > 1 && resolved.endsWith(sep) ? resolved.slice(0, -1) : resolved
}

/**
 * Where a command runs, relative to the session workspace. A `workdir` equal
 * to the workspace OR inside its tree (a subdirectory) counts as "current" —
 * the current project. Anything that escapes the workspace tree (another
 * project, /tmp, home, ...) is "outside".
 * @param {object} opts
 * @param {string | undefined} opts.workdir the tool call's `workdir` argument (absent → session workspace).
 * @param {string | undefined} opts.workspace the session workspace (agent's `session.header.cwd`).
 * @param {boolean} [opts.remote] the tool is a remote-exec tool (always "elsewhere").
 * @returns {'current' | 'outside'}
 */
export function commandScope({ workdir, workspace, remote = false }) {
  if (remote) return 'outside'
  // No explicit workdir → the tool's own default is the session workspace.
  if (typeof workdir !== 'string' || workdir.trim() === '') return 'current'
  // We cannot prove where the command runs without a workspace: fail closed.
  if (typeof workspace !== 'string' || workspace.trim() === '') return 'outside'
  const wd = normalizePath(workdir, workspace)
  const ws = normalizePath(workspace, workspace)
  if (wd === ws) return 'current'
  // descendant of the workspace → still the current project
  if (wd.startsWith(ws + sep)) return 'current'
  return 'outside'
}

/**
 * Decide one shell command.
 * @param {object} opts
 * @param {string | undefined} opts.command
 * @param {readonly string[]} [opts.whitelist] exact-match whitelist.
 * @param {readonly RegExp[]} [opts.denyPatterns] extra deny patterns.
 * @param {string | undefined} opts.workdir
 * @param {string | undefined} opts.workspace
 * @param {boolean} [opts.remote]
 * @param {boolean} [opts.enforceDanger] disable the built-in danger floor (default true).
 * @returns {'whitelist' | 'dangerous' | 'outside' | 'current' | undefined}
 *   `undefined` when there is no poliable command (not a command-carrying call).
 */
export function decide({ command, whitelist, denyPatterns, workdir, workspace, remote = false, enforceDanger = true }) {
  if (typeof command !== 'string' || !command.trim()) return undefined
  if (isExactWhitelisted(command, whitelist)) return 'whitelist'
  if (enforceDanger && classifyCommand(command, denyPatterns) === 'dangerous') return 'dangerous'
  return commandScope({ workdir, workspace, remote })
}