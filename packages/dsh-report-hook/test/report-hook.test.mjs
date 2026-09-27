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

// 【2026-09-27 用户要求整条删除】原⑤（sidebar_open 打开文档）与⑥（刷新语义）
// 已退役。以下用例改为「负向断言」，防止条款被误恢复而无人察觉。
test('退役断言：⑤⑥ 侧边栏条款不得再出现在注入文案里', () => {
  const t = loadReminder()
  assert.ok(!t.includes('sidebar_open'), '提醒不应再点名 sidebar_open 工具')
  assert.ok(!t.includes('侧边栏'), '提醒不应再要求把文档开到侧边栏')
  assert.ok(!t.includes('⑤'), '提醒不应再有第⑤条')
  assert.ok(!t.includes('⑥'), '提醒不应再有第⑥条')
  assert.ok(!t.includes('与是否要拍板无关'), '结语不应再声明⑤独立于拍板判定')
  assert.ok(!t.includes('刷新按钮'), '提醒不应再提及刷新按钮')
})

test('退役断言：条款①~④完整保留（删除⑤⑥不得误伤前四条）', () => {
  const t = loadReminder()
  for (const k of ['①', '②', '③', '④']) {
    assert.ok(t.includes(k), `提醒应保留第${k}条`)
  }
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