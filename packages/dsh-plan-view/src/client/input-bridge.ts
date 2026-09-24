/**
 * 输入桥：把宿主输入区的草稿写入能力（setDraft）捕获成按钮可调用的 injector。
 *
 * 机制参考 dsh-mattpocock-skills-deck 的 StatusBar（MIT）：在 `conversation.input.dock`
 * 槽位挂一个不渲染任何东西的组件，宿主向该槽位组件传 `props.inputActions.setDraft`
 * （往当前会话输入框填文字）和 `props.sessionId`。组件把 setDraft 按会话 id 登记进
 * 模块级注入表；跨会话用 pendingDraft 交接——调用方把草稿挂到目标会话名下再切过去
 * （`sessions.open`），输入区随会话切换重新挂载时把交接草稿消费掉。
 *
 * 按钮语义因此是「草稿优先」：点按钮只把指令填进输入框，人确认后再发送，不静默派活。
 * 宿主没提供 setDraft 时由调用方兜底（复制到剪贴板）。
 */
import { useEffect } from 'react'
import type { Context } from 'cordis'

type DraftSetter = (text: string) => void

/** 每个已挂载输入区（= 当前打开的会话）的 setDraft，按会话 id 登记。 */
const setters = new Map<string, DraftSetter>()

/** 跨会话交接：草稿正文 + 目标会话。目标会话的输入区挂载时消费一次。 */
let pendingDraft: string | null = null
let pendingTarget: string | null = null

/**
 * 输入桥组件本体。挂在 `conversation.input.dock` 槽位，不渲染任何可见物。
 * @param props - 宿主传入；只消费 `sessionId` 与 `inputActions.setDraft`。
 */
export function InputBridge(props: { sessionId?: string; inputActions?: { setDraft?: DraftSetter } }): null {
  const sid = props.sessionId
  const set = props.inputActions?.setDraft
  useEffect(() => {
    if (sid === undefined || typeof set !== 'function') return
    setters.set(sid, set)
    // 会话切换导致输入区重挂（或本组件首次追上目标会话）时消费交接草稿。
    if (pendingDraft !== null && pendingTarget === sid) {
      const text = pendingDraft
      pendingDraft = null
      pendingTarget = null
      set(text)
    }
    return () => { if (setters.get(sid) === set) setters.delete(sid) }
  }, [sid, set])
  return null
}

/**
 * 把草稿送进目标会话的输入框。
 * @returns `'injected'` 目标会话正开着，已立即填入；`'queued'` 已挂成交接草稿，
 * 调用方须随后 `sessions.open(sessionId)` 切过去，输入区重挂时自动消费。
 */
export function deliverDraft(sessionId: string, text: string): 'injected' | 'queued' {
  const set = setters.get(sessionId)
  if (set !== undefined) { set(text); return 'injected' }
  pendingDraft = text
  pendingTarget = sessionId
  return 'queued'
}

/**
 * 注册输入桥槽位。
 * @param ctx - 客户端根上下文（需已注入 `slots`）。
 * @returns 注销函数；槽位不可用时返回空操作（桥挂不上不应拖垮整个插件）。
 */
export function registerInputBridge(ctx: Context): () => void {
  try {
    return ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
      {
        name: 'conversation.input.dock',
        id: 'dsh-plan-view:input-bridge',
        order: 60,
        registrant: 'dsh-plan-view',
      },
      InputBridge,
    ))
  } catch {
    return () => {}
  }
}
