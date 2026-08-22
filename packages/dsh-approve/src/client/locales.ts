/** Copy for the dsh-approve approval panel (this plugin owns its own namespace). */

export const zh = {
  'approval.waiting': '等待审批',
  'approval.reject': '拒绝',
  'approval.allowOnce': '允许一次',
  'approval.addToWhitelist': '加入白名单',
} as const

export const en = {
  'approval.waiting': 'Waiting for approval',
  'approval.reject': 'Reject',
  'approval.allowOnce': 'Allow once',
  'approval.addToWhitelist': 'Add to whitelist',
} as const

export type DshApproveKey = keyof typeof zh