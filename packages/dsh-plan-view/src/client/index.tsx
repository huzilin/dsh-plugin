/**
 * dsh-plan-view client half: registers the Plan page in the DSH native
 * right Sidebar (official protocol), plus a one-click entry button in the
 * conversation header.
 *
 * 官方侧边栏协议接入（2026-09-29 迁移，此前挂 better-sidebar 自制右栏）：
 * definition 入 `ctx.sidebarRightTabs`，正文入 keyed slot
 * `sidebar.right.pane.tab`（key = definition.id），开票走
 * `ctx.sidebarRight.openTab(kind)`——官方四步（认领 → 聚焦 → 展开列 → 记账）
 * 自带展开，收起态可直接开票（ch12：「用户看不见不算打开」）。
 *
 * fs 读写走本插件自己的 `/plan-view/*` 数据面（server 半区 lib/server.js，票 19
 * 起与 better-sidebar 完全解耦）；会话/网关类走 `/api` 官方 Typert gateway。
 * Zero external process dependencies.
 */
import { type Context } from 'cordis'
import { PlanView } from './PlanView'
import { registerPlanEntry } from './entry-button'
import { registerInputBridge } from './input-bridge'
import { PLAN_TAB_ID, PLAN_TAB_KIND, PlanIcon } from './plan-icon'

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs']

export function apply(ctx: Context): void {
  // 输入桥（2026-09-24）：挂进会话输入区槽位，捕获宿主的 setDraft 供派单按钮
  // 做「草稿优先」注入——按钮只把指令填进输入框，人确认后再发送。
  ctx.effect(() => registerInputBridge(ctx))

  // 会话头部右上角的一键入口（2026-09-21 拍板）：点一下直接打开 Plan 票。
  ctx.effect(() => registerPlanEntry(ctx))

  // 票类型：纯页面 kind（不认资源地址，凭 kind 打开；同 kind 重复打开聚焦已有票）。
  // guide 条目让空面板引导页/添加控件也能开 Plan（对齐原 better-sidebar 的 + 菜单）。
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PLAN_TAB_ID,
    kind: PLAN_TAB_KIND,
    priority: 'builtin',
    title: () => 'Plan',
    guide: [{
      id: 'plan-entry',
      order: 50,
      title: () => 'Plan',
      description: () => '计划面板：.scratch/.plan 治理视图（工单、地图、待拍板、台账）',
      icon: PlanIcon,
    }],
  }))

  // 正文：官方 slot 只给 sessionId（session scope 标准 props）与 inject face；
  // cwd 由 PlanView 首帧 snapshot 的响应自带（服务端解析，票 19 起 sessionCwd
  // 预解析链退役——better-sidebar session.cwd 路由整条不再触碰）。
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: PLAN_TAB_ID,
      inject: () => ({ planCtx: ctx }),
    },
    PlanTabBody,
  ))
}

/**
 * 正文壳：sessionId（框架 props）+ planCtx（inject face）→ PlanView。加载中的
 * 目录解析也由 PlanView 内部的 snapshot 响应承担；解析失败给一行诊断而不是白屏。
 */
function PlanTabBody(props: { sessionId?: string; planCtx?: Context }): JSX.Element {
  const sessionId = props.sessionId
  if (sessionId === undefined) {
    return <div style={{ padding: 16, fontSize: 12, color: '#888' }}>Plan：无法解析会话（缺 sessionId）。</div>
  }
  return <PlanView ctx={props.planCtx as never} sessionId={sessionId} />
}
