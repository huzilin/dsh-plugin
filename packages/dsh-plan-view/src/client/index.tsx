/**
 * dsh-plan-view client half: registers a plan tab in the better-sidebar, plus a
 * one-click entry button in the conversation header.
 *
 * Reads `.plan/` wayfinder maps via the sidebar fs.read API, derives ticket
 * status per the TRACKER-MARKDOWN contract, and renders a grouped list +
 * dependency graph view. Zero external process dependencies.
 */
import type {} from 'dsh-better-sidebar/lib/types/context-types'
import type { Context } from 'cordis'
import { PlanView } from './PlanView'
import { registerPlanEntry } from './entry-button'
import { PLAN_TAB_ID, PlanIcon } from './plan-icon'

export const inject = ['betterSidebar', 'slots']

export function apply(ctx: Context): void {
  // 会话头部右上角的一键入口（2026-09-21 拍板）：点一下直接打开 Plan 标签页，
  // 省掉「展开右侧栏 → 点 + → 挑 Plan」三步。
  ctx.effect(() => registerPlanEntry(ctx))

  ctx.effect(() =>
    ctx.betterSidebar.registerTab({
      id: PLAN_TAB_ID,
      title: () => 'Plan',
      icon: (size) => <PlanIcon size={size} />,
      order: 46,
      single: true,
      component: (props) => <PlanView {...props} />,
    })
  )
}
