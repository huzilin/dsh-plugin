/**
 * Plan 的共用标识：官方侧边栏票 kind、定义 id 与图标。
 *
 * 右侧栏的 Plan 票（`index.tsx` 注册）与会话头部的一键入口
 * （`entry-button.tsx`）指向同一处定义——避免 kind/id 字符串或图标形状两处
 * 各写一份而漂移。
 */

/** Plan 票的 kind（`ctx.sidebarRight.openTab` 点名的路由判别名）。 */
export const PLAN_TAB_KIND = 'plan'

/** Plan 票实现的定义 id（正文 slot `sidebar.right.pane.tab` 的 key，与 definition.id 一致）。 */
export const PLAN_TAB_ID = 'dsh-plan-view/plan'

/**
 * Plan 图标：方框叠三条横线。
 * @param props - `size` 为图标边长（像素）。
 * @returns 一个随文字色着色的 SVG。
 */
export function PlanIcon({ size }: { size: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="14" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <line x1="4" y1="5" x2="12" y2="5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="4" y1="8" x2="12" y2="8" stroke="currentColor" strokeWidth="1.2" />
      <line x1="4" y1="11" x2="9" y2="11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}
