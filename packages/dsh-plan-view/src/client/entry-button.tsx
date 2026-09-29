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
 * 打开动作走插件自己的服务 `ctx.betterSidebar.openTab`：标签页描述符带
 * `single: true`，重复点击只会聚焦已开的那一个。展开右侧栏由本文件自己保证
 * （收起态先点壳的展开角标再开票——DSH 0.1.5+ openTab 不再承诺展开，见 onClick 内注释）。
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
      inject: () => ({ open: () => {
        // 0.1.5+ 右栏归 DSH 原生 Sidebar：收起态下 openTab 链路的原生写操作全部
        // 失效——controller.require() 直接抛「no session surface is mounted」，
        // openTabIn 对未挂载 session 静默（均实测）。壳自带的展开角标
        // （ExpandButton，data-sidebar-right-expand，收起态常驻标题栏角落）是
        // 唯一在收起态仍可用的展开路径：先点它，等右栏挂载完成再开票；角标
        // 消失即已展开，停。展开态（无角标）直接开票，原行为。
        const corner = document.querySelector('[data-sidebar-right-expand]') as HTMLElement | null
        if (!corner) {
          ctx.betterSidebar.openTab({ type: PLAN_TAB_ID })
          return
        }
        corner.click()
        let tries = 8
        const tick = (): void => {
          try { ctx.betterSidebar.openTab({ type: PLAN_TAB_ID }) } catch { /* seat 未挂载完，下一拍重试 */ }
          if (--tries > 0 && document.querySelector('[data-sidebar-right-expand]')) window.setTimeout(tick, 120)
        }
        window.setTimeout(tick, 120)
      } }),
    },
    PlanEntryButton,
  ))
}
