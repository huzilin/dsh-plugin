/**
 * dsh-approve client half: takes over the conversation composer's approval
 * seat so the 加入白名单 button (and the exact copy / black command line)
 * live entirely inside this plugin — zero DSH-core changes.
 *
 * The core ui-conversation registers its own ApprovalPanel on
 * `conversation.composer` at priority 1; chain slots run entries in ASCENDING
 * priority (lowest first, first matching `select` wins the seat), so this
 * entry registers at priority 0.5: it beats the core panel (1) for approval
 * waits, while question takeovers (default 0) still win when both kinds are
 * pending — matching core behavior.
 *
 * The panel itself is self-sufficient: the exact command comes from the ask
 * reason's `命令：` line (the host writes it), the whitelist button talks to
 * the host plugin's own /dsh-approve/whitelist-add route, and answering rides
 * the carrier's respond() (same wire shape as the core PendingApproval).
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PendingWait } from '@deepseek-ai/dsh-client-runtime/client'
import { ApprovalPanel } from './ApprovalPanel.tsx'
import { en, zh, type DshApproveKey } from './locales.ts'

/** The pending approval carrier this entry takes over. */
export type ApprovalWait = PendingWait<'approval'>

/** Full composer-takeover props for the approval panel: standard kit + the matched carrier. */
export interface DshApproveApprovalProps extends PropsRuntime<'conversation.composer'>, PropsLocale<typeof NS> {
  /** The selector-narrowed approval carrier. */
  matched: ApprovalWait
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dsh-approve approval panel's copy. */
    'dsh-approve': DshApproveKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'dsh-approve'

/** Required services: the slot registry and the panel's copy. */
export const inject = ['slots', 'locale']

/** Chain routing: claim the composer while an approval wait is pending (pure — owner props only). */
function selectApproval({ interactions }: ComposerChainProps): ApprovalWait | null {
  return interactions.find((i): i is ApprovalWait => i.kind === 'approval') ?? null
}

/**
 * Client plugin body: register the `dsh-approve` dictionaries and the
 * approval panel into the composer chain, shadowing the core panel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-approve: dictionaries')

  ctx.slots.inject('conversation.composer', () => ctx.slots.register(
    { name: 'conversation.composer', select: selectApproval, priority: 0.5, locale: NS },
    ApprovalPanel,
  ))
}