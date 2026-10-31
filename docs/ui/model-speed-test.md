# 模型设置页「测速」按钮

Status: shipped（mock 验证）

## 背景

用户配置自定义 Provider 后需要快速了解该模型的解码吞吐（tok/s），以判断本地/中转端点的真实速度。模型列表每行已有「测试连接」按钮（`provider/testModelConnectivity`），本特性在同一行复用同一条链路增加「测速」模式。

## 口径

与上下文浮窗 decodeWindow（CLI 侧 `recordDecodeSample`）完全一致：

- `ttftMs` = 请求发起到首个正文 `text_delta` 到达。
- `decodeMs` = 首个正文 delta → 流结束。
- `decodeTps` = `outputTokens / (decodeMs / 1000)`。
- 任一项缺失（适配器未产出 delta/usage、decodeMs ≤ 0）时 `metrics` 整体省略，UI 显示「缺少计时数据」的成功态，不伪造数字。

## 防缓存策略

供应商对相同请求前缀有 KV/prompt 缓存，固定探测串会让 TTFT 失真、整响应缓存让两次测速失去独立性：

- prompt 固定指令框架 + 每次注入 `seed = base36(now)-base36(random)` 与随机词。
- 行数（128 行）刻意高于 `maxOutputTokens`（256），probe 稳定以 `finishReason=length` 顶满预算结束——解码工作量跨模型一致，不受输出长度习惯影响。
- decode 吞吐与输出内容熵无关（逐 token 前向计算），随机词只为缓存失效，不影响口径。

## 成本

speed 模式一次探测 ≈ 256 output tokens + 少量 input tokens，按目标 Provider 计费；connectivity 模式保持 `maxOutputTokens: 1` 不变。测速超时 30s（连接探测保持 60s 通用超时）。

## 请求链路

UI（`ModelRowInput` 测速按钮）→ `useModelProviders.testModelConnectivity(providerId, modelId, "speed")` → `IProviderSettingsService.testModelConnectivity({mode:"speed"})`（host）→ 协议 `provider/testModelConnectivity`（请求可选 `mode`，结果可选 `metrics`）→ CLI `testModelConnectivity`（speed probe 流式累计）。

协议 schema 均为 `.strict()` + optional 新字段：旧版本对端不发/不读这些键，向后兼容。

## UI 行为

- 按钮：行内测试按钮旁的仪表图标（`TID_MODEL_PROVIDER_MODEL_SPEED_BUTTON-{index}`），provider 未启用或行编辑为空时禁用。
- 反馈：`ProviderDetailFeedback`，dedupeKey `model-speed:{providerId}:{modelId}`；pending 常驻 → success（tok/s + 首字延迟 + token 数）/ success 无指标 / failure（8s）。
