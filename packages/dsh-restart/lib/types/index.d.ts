/**
 * dsh-restart — permanent "restart the whole DeepSeek Harness" plugin.
 *
 * Registers a model-callable `restart_harness` tool and a `/restart` command
 * that reload plugins and configuration by restarting the DSH node process.
 *
 * Restart mechanism (Node-native):
 *   - discovery is unnecessary: this plugin runs INSIDE the DSH node process, so
 *     `process.pid` / `process.cwd()` / `process.execPath` / `process.execArgv` /
 *     `process.argv` are read directly.
 *   - relaunch: spawn a detached `node -e` helper (survives the parent's exit via
 *     `detached: true` + `stdio: 'ignore'` + `unref()`), which waits until the old
 *     process releases the listen port, then spawns the new DSH (same argv + cwd,
 *     stdout/stderr appended to timestamped logs). The old process then
 *     `process.exit(0)`s after `delayMs` so the tool result can flush first.
 *   - a "process index" file (`$DSH_HOME/dsh-process.json`) is still written at
 *     boot for external inspection (pid + cwd + command line).
 *
 * @module dsh-restart
 */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "dsh-restart";
export declare const inject: string[];
export declare function apply(ctx: Context): void;
