/**
 * Plan 的共用标识：标签页类型 id 与图标。
 *
 * 右侧栏的 Plan 标签页（`index.tsx` 注册）与会话头部的一键入口
 * （`entry-button.tsx`）指向同一处定义——避免 id 字符串或图标形状两处各写一份
 * 而漂移。
 */

/** Plan 标签页的类型 id（注册描述符与入口按钮共用）。 */
export const PLAN_TAB_ID = 'dsh-plan-view:plan'

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
