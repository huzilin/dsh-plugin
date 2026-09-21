/**
 * Plan 的会话头部入口按钮。
 *
 * 在会话标题栏右上角那一排（`conversation.session.header.utilities`）挂一个
 * Plan 图标按钮，点一下直接打开右侧栏的 Plan 标签页——把原先「展开右侧栏 →
 * 点 + → 从类型列表里挑 Plan」三步压成一步。
 *
 * 该位是「列表型」（list）：用本插件自己的 id 注册即并列新增一行，不会顶掉
 * 邻居（better-sidebar 的底部面板开关、Watcher 状态等）。
 *
 * 打开动作走插件自己的服务 `ctx.betterSidebar.openTab`：默认目标就是 DSH 原生
 * 右侧栏，且打开这个动作本身会把右侧栏展开（服务内部写死），因此不需要我们
 * 再调任何展开接口。标签页描述符带 `single: true`，重复点击只会聚焦已开的那一个。
 */
import type { Context } from 'cordis'
import { PLAN_TAB_ID, PlanIcon } from './plan-icon'

/** 本入口在会话头部那一排里的位置：排在底部面板开关（10）之后、状态类控件之前。 */
const ENTRY_ORDER = 50

/** 按钮样式：跟随头部其它图标控件的观感（继承文字色、无边框、悬停给一点底色）。 */
const buttonStyle: Record<string, string | number> = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 4,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  lineHeight: 0,
}

/**
 * 入口按钮本体。
 * @param props - 该位为会话作用域；`open` 由注册项的 inject 面提供。
 * @returns 一个 Plan 图标按钮。
 */
function PlanEntryButton({ open }: { open: () => void }): JSX.Element {
  return (
    <button
      type="button"
      style={buttonStyle}
      title="打开 Plan"
      aria-label="打开 Plan"
      data-plan-entry="header"
      onClick={open}
      onMouseEnter={event => { event.currentTarget.style.background = 'rgba(255,255,255,.08)' }}
      onMouseLeave={event => { event.currentTarget.style.background = 'transparent' }}
    >
      <PlanIcon size={16} />
    </button>
  )
}

/**
 * 注册入口按钮。
 * @param ctx - 客户端根上下文（需已注入 `slots` 与 `betterSidebar`）。
 * @returns 注销函数。
 */
export function registerPlanEntry(ctx: Context): () => void {
  return ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
    {
      name: 'conversation.session.header.utilities',
      id: 'dsh-plan-view:header-entry',
      order: ENTRY_ORDER,
      registrant: 'dsh-plan-view',
      inject: () => ({ open: () => { ctx.betterSidebar.openTab({ type: PLAN_TAB_ID }) } }),
    },
    PlanEntryButton,
  ))
}
