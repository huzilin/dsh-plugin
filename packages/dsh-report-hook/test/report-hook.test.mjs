import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDecisionRequest, classifyPrompt, loadReminder } from '../scripts/report-hook.mjs'

test('命中：明确要方案（决策）', () => {
  assert.equal(isDecisionRequest('这个怎么弄，给我两个方案'), true)
  assert.equal(isDecisionRequest('帮我对比下这几个方案，选哪个好'), true)
  assert.equal(isDecisionRequest('给个方案我拍板'), true)
  assert.ok(loadReminder().includes('原文照抄'))
  assert.ok(classifyPrompt('给个方案') !== null)
})

test('命中：要审批 / 拍板', () => {
  assert.equal(isDecisionRequest('这个要不要审批通过'), true)
  assert.equal(isDecisionRequest('你来拍板吧'), true)
  assert.equal(isDecisionRequest('这几个能不能定下来'), true)
})

test('命中：如何取舍 / 怎么办', () => {
  assert.equal(isDecisionRequest('这两个方案怎么取舍'), true)
  assert.equal(isDecisionRequest('这个 bug 怎么办，怎么处理'), true)
  assert.equal(isDecisionRequest('这条路应不应该走，我拿不定'), true)
})

test('命中边界：技术追问里的决策词', () => {
  // 技术追问不当决策 —— 但「怎么处理一个 bug」其实是要决策，故命中是合理的。
  assert.equal(isDecisionRequest('这个报错怎么处理'), true)
})

test('不命中：普通开场/客套', () => {
  assert.equal(isDecisionRequest('你好'), false)
  assert.equal(isDecisionRequest('谢谢，我先看看'), false)
  assert.equal(isDecisionRequest('请解释一下这个概念'), false)
  assert.equal(isDecisionRequest('简单介绍下这个模块'), false)
})

test('不命中：纯技术追问（无决策语境词）', () => {
  assert.equal(isDecisionRequest('这个函数怎么调用'), false)
  assert.equal(isDecisionRequest('node 里如何处理异步'), false)
  assert.equal(isDecisionRequest('这个库支持不支持断点续传'), false)
})

test('不命中：空输入', () => {
  assert.equal(isDecisionRequest(''), false)
  assert.equal(isDecisionRequest('   '), false)
  assert.equal(isDecisionRequest(undefined), false)
})

test('注入文案要点：含四条硬规则与"忽略"降级', () => {
  const t = loadReminder()
  for (const k of ['说听得懂的话', '展开说', '原文', '性质', '忽略本提醒']) {
    assert.ok(t.includes(k), `提醒应包含「${k}」`)
  }
  // 防止误写了 decision 字段
  assert.ok(!t.includes('"decision"'))
})

test('注入文案⑤：审批文档落盘后必须用 sidebar_open 打开', () => {
  const t = loadReminder()
  assert.ok(t.includes('⑤'), '提醒应有第⑤条（交付形态）')
  assert.ok(t.includes('sidebar_open'), '提醒应点名 sidebar_open 工具')
  assert.ok(t.includes('侧边栏'), '提醒应说明打开位置是侧边栏')
  // 覆盖用户原话的两层要求：要拍板的文档 + 一般的文档输出
  assert.ok(t.includes('审批文档'), '提醒应覆盖「要拍板的文档」')
  assert.ok(t.includes('一般性的文档输出'), '提醒应覆盖「一般文档输出」')
  // 退化路径必须写明，避免工具不可用时 agent 卡死
  assert.ok(t.includes('不可用'), '提醒应给出 sidebar_open 不可用时的退化路径')
})

test('注入文案⑤：文档打开要求与是否要拍板解耦', () => {
  const t = loadReminder()
  // 结语必须明说「与是否要拍板无关」，否则 agent 可能因判定为非决策而跳过打开
  assert.ok(t.includes('与是否要拍板无关'), '结语应声明⑤独立于拍板判定')
})

test('注入文案⑥：如实声明「无法关闭/无法得知已开」，不得谎报刷新', () => {
  const t = loadReminder()
  assert.ok(t.includes('⑥'), '提醒应有第⑥条（已打开文档的处置）')
  // 核心诚实性约束：必须说清模型做不到关闭与查询
  assert.ok(t.includes('关闭'), '提醒应说明关闭能力')
  assert.ok(t.includes('做不到'), '提醒应如实声明关闭/查询做不到')
  assert.ok(t.includes('谎称'), '提醒应禁止谎报刷新成功')
  // 重复打开的真实语义必须写明是「聚焦」而非刷新
  assert.ok(t.includes('聚焦'), '提醒应说明重复打开只是聚焦')
  // 不得诱导用户点会弹确认框的刷新按钮（用户明确要求「不要弹提示」）
  assert.ok(t.includes('刷新按钮'), '提醒应点名不要诱导点刷新按钮')
  assert.ok(t.includes('弹确认框') || t.includes('弹框'), '提醒应说明刷新按钮会弹框')
})

test('classifyPrompt：非决策返回 null（不注入）', () => {
  assert.equal(classifyPrompt('你好'), null)
  assert.equal(classifyPrompt('这个函数怎么调用'), null)
})

test('正则不含过宽误伤边界', () => {
  // 『选……课』不应命中（无决策语境词佐证；weak 的"哪"等需 context）
  assert.equal(isDecisionRequest('我选了这门课当做选修'), false)
  // 『你觉得……』不应命中（"你觉得"是陈述不是请决策）——靠无 strong/weak 触发
  assert.equal(isDecisionRequest('你没觉得这个设计合理'), false)
})

test('stdin 空 payload 安全', async () => {
  // 直接 import 模块不触发 main（仅在作为脚本执行时）；此处验证 export 不依赖 stdin
  assert.equal(isDecisionRequest(''), false)
})