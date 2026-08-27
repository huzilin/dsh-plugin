/**
 * dsh-plan-view client half: registers a plan tab in the better-sidebar.
 *
 * Reads `.plan/` wayfinder maps via the sidebar fs.read API, derives ticket
 * status per the TRACKER-MARKDOWN contract, and renders a grouped list +
 * dependency graph view. Zero external process dependencies.
 */
import type {} from 'dsh-better-sidebar/lib/types/context-types'
import type { Context } from 'cordis'
import { PlanView } from './PlanView'

export const inject = ['betterSidebar', 'slots']

export function apply(ctx: Context): void {
  ctx.effect(() =>
    ctx.betterSidebar.registerTab({
      id: 'dsh-plan-view:plan',
      title: () => 'Plan',
      icon: (size) => (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
          <line x1="4" y1="5" x2="12" y2="5" stroke="currentColor" strokeWidth="1.2" />
          <line x1="4" y1="8" x2="12" y2="8" stroke="currentColor" strokeWidth="1.2" />
          <line x1="4" y1="11" x2="9" y2="11" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      ),
      order: 46,
      single: true,
      component: (props) => <PlanView {...props} />,
    })
  )
}
