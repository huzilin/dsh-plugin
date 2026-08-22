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

import { useState, type CSSProperties } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ApprovalWait, DshApproveApprovalProps } from './index.ts'

/** The dsh-approve ask reason's opening line (the whitelist button shows only for these). */
const DSH_APPROVE_ASK_PREFIX = '命令在会话工作区之外运行'

/**
 * The exact command from the ask reason's LAST `命令：` line. The host writes
 * `命令：<command>` as the reason's final line, which the panel parses here.
 */
function whitelistCommandOf(reason: string | undefined): string | undefined {
  if (typeof reason !== 'string') return undefined
  const idx = reason.lastIndexOf('命令：')
  if (idx === -1) return undefined
  const rest = reason.slice(idx + 3).trim()
  return rest === '' ? undefined : rest
}

/**
 * Render the reason without its own `命令：` line (the command is displayed
 * once, below, in the prominent command line); real line breaks via <br />.
 */
function ReasonText({ text }: { text: string }) {
  const lines = text.split('\n').filter((line) => !line.startsWith('命令：'))
  if (lines.length === 0) return null
  return (
    <>
      {lines.map((line, index) => (
        <span key={index}>
          {line}
          {index < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </>
  )
}

/** Answer the approval through the carrier (same wire encoding as the core PendingApproval). */
async function answerApproval(wait: ApprovalWait, outcome: 'allowed-once' | 'rejected'): Promise<void> {
  const receipt = await wait.respond({
    ok: true,
    value: {
      sessionId: wait.sessionId,
      approvalId: wait.payload.approvalId,
      outcome,
    },
  })
  if (!receipt.accepted) {
    throw new Error(`approval response rejected: ${receipt.reason}`)
  }
}

/** Persist the exact command to the dsh-approve whitelist DIRECTLY (host route). */
async function whitelistAddDirect(command: string): Promise<void> {
  const response = await fetch('/dsh-approve/whitelist-add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  })
  let body: { ok?: boolean; error?: string } = {}
  try {
    body = await response.json() as { ok?: boolean; error?: string }
  } catch {
    /* keep status fallback */
  }
  if (!response.ok || body.ok !== true) {
    throw new Error(body.error ?? `whitelist-add failed: ${response.status}`)
  }
}

const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '8px calc(var(--dsh-composer-side-clearance) + 16px) 12px',
  },
  card: {
    overflow: 'hidden', width: '100%', maxWidth: 'var(--dsh-chat-content-width)',
    border: '1px solid var(--dsw-alias-state-warn-secondary)', borderRadius: 20,
    background: 'var(--dsw-specific-input-major)', boxShadow: 'var(--dsw-shadow-lv2)',
  },
  strip: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 16px', background: 'var(--dsw-alias-state-warn-tertiary)',
    color: 'var(--dsw-alias-state-warn-primary)', fontSize: 13, lineHeight: '18px',
  },
  dot: {
    width: 8, height: 8, borderRadius: '50%', background: 'var(--dsw-alias-state-warn-primary)',
  },
  body: {
    display: 'flex', flexDirection: 'column', gap: 6, boxSizing: 'border-box',
    maxHeight: 'var(--dsh-composer-text-max-height)', overflowY: 'auto',
    padding: '12px 16px 8px',
  },
  headline: {
    color: 'var(--dsw-alias-label-primary)', fontSize: 15, fontWeight: 500, lineHeight: '24px',
  },
  command: {
    // primary label color = near-black in light theme (the user asked for 黑色 /
    // prominent); stays readable in dark theme via the alias token.
    color: 'var(--dsw-alias-label-primary)',
    fontFamily: 'var(--ds-font-family-code)', fontSize: 13, lineHeight: '20px',
    wordBreak: 'break-all',
  },
  error: { padding: '0 16px 8px', color: 'var(--dsw-alias-state-error-primary)', fontSize: 12, lineHeight: '16px' },
  actionRow: { display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '14px 16px' },
}

/** The main panel body. */
export function ApprovalPanel({ matched, t }: DshApproveApprovalProps) {
  const [{ settled, error }, setState] = useState<{ settled: boolean; error: string | null }>({ settled: false, error: null })
  const reason = matched.payload.reason
  const command = whitelistCommandOf(reason)
  const allowWhitelist = reason?.startsWith(DSH_APPROVE_ASK_PREFIX) === true && command !== undefined

  const finish = async (outcome: 'allowed-once' | 'rejected', pre?: () => Promise<void>): Promise<void> => {
    setState({ settled: true, error: null })
    try {
      if (pre !== undefined) await pre()
      await answerApproval(matched, outcome)
    } catch (err) {
      setState({ settled: false, error: String(err instanceof Error ? err.message : err) })
    }
  }

  const reject = (): void => { void finish('rejected') }
  const allowOnce = (): void => { void finish('allowed-once') }
  const addToWhitelist = (): void => { void finish('allowed-once', () => whitelistAddDirect(command as string)) }

  return (
    <div style={styles.root} data-approval-key={matched.key}>
      <div style={styles.card}>
        <div style={styles.strip}><span style={styles.dot} />{t('approval.waiting')}</div>
        <div style={styles.body} data-approval-scroll="" tabIndex={0} role="group" aria-label={t('approval.waiting')}>
          <div style={styles.headline}>
            {reason !== undefined ? <ReasonText text={reason} /> : t('approval.waiting')}
          </div>
          {command !== undefined && <div style={styles.command}>{command}</div>}
        </div>
        {error !== null && <div style={styles.error}>{error}</div>}
        <div style={styles.actionRow}>
          <Button variant="outline" disabled={settled} onClick={reject}>
            {t('approval.reject')}
          </Button>
          {allowWhitelist && (
            <Button variant="outline" disabled={settled} onClick={addToWhitelist}>
              {t('approval.addToWhitelist')}
            </Button>
          )}
          <Button variant="primary" disabled={settled} onClick={allowOnce}>
            {t('approval.allowOnce')}
          </Button>
        </div>
      </div>
    </div>
  )
}