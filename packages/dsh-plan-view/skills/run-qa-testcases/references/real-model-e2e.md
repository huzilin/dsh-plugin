# 真 LLM E2E 方法（替身之外的必经一关）

> 正本迁移自 OpenViking preferences（2026-09-12 收编）。来源：novel 仓库 2026-09-08 首次真模型全链路 E2E（写→审→量化，opencode zen go 网关）。替身测试只能验证结构与契约，真模型再暴露两类替身永远测不出的缺陷域。semantica ae02cd74。

## 触发锚

接入新 LLM 网关 / 更换模型 / 修改网关路由 / 新增「全默认参数」契约路径时必跑；日常随发版例行（不能一次定终身）。

## 核心结论

替身（Fake/httptest）测「管道与契约」，真模型测「格式文明差异 + 连接生命周期」。接真模型后 E2E 应例行跑，不能一次定终身（上游会换模型/网关会改路由）。

## 真模型典型缺陷域（novel 实证）

1. **输出格式文明差异**：模型包 markdown ```json 围栏、缺约定字段（classification）。修法三层防线：prompt 定死「仅一个 JSON 对象，禁围栏禁解释文字」+ 解析层剥围栏（首个 {..} 平衡块提取，勿用正则）+ 兜底分类（安全网，绝不因此失败）。
2. **HTTP 连接生命周期**：Go http.Client keep-alive 池在网关侧断连后持续复用半开连接——每次请求挂起直到超时；curl 每次新连接所以「curl 通、服务端挂」假象。修法 DisableKeepAlives: true（低频 LLM 调用零成本）。判别法：curl 对照 + UA/HTTP2 伪装排除客户端特征，剩连接复用即中。
3. **上游抖动呈窗口期**：503/500 集中在时间窗内连发，worker 重试连打会全撞坏窗口。退避曲线扛得住，别改成即时重试。
4. **reasoning 模型时间预算**：GLM-5.3 类先吐 reasoning_content 再出 content，千字成稿 40-90s，timeout 预算 ≥600s；响应解析只取 message.content。

## 网关接入 checklist

- 会话/路由头（如 x-opencode-session）走**通用 extra_headers 配置透传**，不做 provider 特判
- key 正本在 ~/.dsh/.credentials.yaml refs（env 同源）；上游 5xx 先用 curl 复刻「同形状调用」判别：直连通=客户端问题（头/连接池），直连挂=供应商窗口
- 非推理小模型（deepseek-v4-flash）审校类调用 2-5s/次，优先当批量 worker 模型；写稿用强模型

## 落库口径

真机 E2E 的 HTTP 层语义（version=0 回落当前版这类「契约默认值」）单测常显式传参测不到——E2E 脚本必须有一条「全默认参数」路径。
