# ZCode 内网化改造：外部网络行为清单

> 排查范围：全仓 `packages/`、`apps/zcode-cli/`、`scripts/`、`config/`（排除 `node_modules`、`dist`）。
> 目标：识别所有出网行为，评估改造为「纯内网 + 本地模型」所需改动。

> **改造进度**：本报告第 9 节列出的 P1 项与 P0 中的配置类改动已落地，
> 操作步骤见 [`docs/intranet-deployment.md`](docs/intranet-deployment.md)。
> 尚未解决的只有 P0 的插件资产 vendoring（需要从官方发行包提取，仓库内无法完成）。
> 本报告保留为**排查时的原始记录**，文中的事实性错误已在对应位置就地更正。

---

## 0. 结论摘要

| 维度 | 结论 |
| --- | --- |
| 出站行为是否已收敛 | **是**。产品后端走单一端点解析器，代理/CA 有统一出口策略，可直接重定向。 |
| 默认是否联网 | **否**。遥测与 ARMS RUM 端点默认为空字符串，未配置即不上报。 |
| 是否有现成内网基建 | **部分有**。`intranetDefaults.ts` + 内网探针服务已存在，但只覆盖**构建期依赖下载**。 |
| 最大硬阻塞 | **官方插件包在本仓库缺失**（见 §7），内网无法从 CDN 补齐，商店会是空的。 |
| 次大硬阻塞 | **WebFetch 工具主动拦截私网地址**（见 §5.1），需改代码。 |
| 本地模型 | **可直接接**。Provider 配置支持任意 `baseUrl` + `openai-chat-completions`，且官方网关重写只对官方端点生效。 |

---

## 1. 出站流量的统一收敛点（改造的总开关）

### 1.1 产品端点解析器 — `packages/shared/src/zcodeEndpoint.ts`

所有 ZCode 平台请求的唯一地址来源。硬编码默认值 + 环境变量覆盖：

| 常量 | 默认值 | 覆盖变量 |
| --- | --- | --- |
| `DEFAULT_ZCODE_ENDPOINT_ORIGIN` | `https://zcode.z.ai` | `ZCODE_BASE_URL` / `ZCODE_ENDPOINT_ORIGIN` |
| `DEFAULT_BIGMODEL_API_ORIGIN` | `https://bigmodel.cn` | `BIGMODEL_API_BASE_URL` |
| `DEFAULT_ZAI_OAUTH_ORIGIN` | `https://chat.z.ai` | `ZAI_OAUTH_ORIGIN` |
| `DEFAULT_ZAI_BUSINESS_BASE_URL` | `https://api.z.ai` | `ZAI_BUSINESS_BASE_URL` |
| `DEFAULT_ZAI_OAUTH_CLIENT_ID` | `client_P8X5CMWmlaRO9gyO-KSqtg` | `ZAI_OAUTH_CLIENT_ID` / `ZAI_OAUTH_APP_ID` |

派生出：`/api/v1`、`/cn/share/callback`、`/api/v1/zcode-plan`、`/api/v1/zcode-plan/anthropic`、`/api/v1/zcode-plan/billing/{current,balance}`。

**改造要点**：把这 5 个变量指向内网网关即可重定向绝大部分平台流量。但注意 `rewriteZCodeEndpointUrl()` 只在 URL origin **等于** `https://zcode.z.ai` 时才重写 —— 如果内网代码里残留写死的 `zcode.z.ai`，会被正确重写；但若改成了别的域名，则不会被重写。

### 1.2 代理 / 自定义 CA — 覆盖面最广的一层

| 变量 | 作用 | 覆盖范围 |
| --- | --- | --- |
| `ZCODE_HTTP_PROXY` | 出站代理 | Electron session、模型请求、MCP、子进程 |
| `ZCODE_NO_PROXY` | 代理排除列表（支持 `*`、`.suffix`、`host:port`、`[v6]`） | 同上 |
| `ZCODE_AGENT_CA_CERT` | 自定义 CA 证书文件路径 | 同上 |

关键实现：
- `packages/desktop/src/main/desktopNetworkPolicy.ts` — Electron `setProxy` + `setCertificateVerifyProc`。设置页还可配 `httpProxy` / `httpProxyNoProxy` / `httpProxyCaCertPath` / `embeddedBrowserAllowInsecureCertificates`。**默认 session 使用 `direct` 模式，不继承系统代理**。
- `apps/zcode-cli/packages/adapters/src/network/http-config.ts` — 代理解析与 TLS CA 加载。
- `apps/zcode-cli/packages/adapters/src/network/subprocess-env.ts` — `applyNetworkEgressEnv()` 把代理/NO_PROXY/CA 注入子进程环境（同时写 `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NODE_EXTRA_CA_CERTS`/`SSL_CERT_FILE`/`CURL_CA_BUNDLE`/`GIT_SSL_CAINFO` 等）。
- `apps/zcode-cli/packages/adapters/src/network/proxy-fetch.ts` — `createNetworkProxyFetch()`，被模型请求（`model-execution.ts`）和 MCP HTTP transport 使用。

`applyNetworkEgressEnv` 的调用点：Bash/exec 命令、MCP stdio server、插件市场 git clone。

**结论**：内网若有统一代理 + 自签 CA，这套机制基本够用，**优先走这条路，代码改动最小**。

### 1.3 内网基建（已存在但覆盖有限）

`packages/shared/src/intranetDefaults.ts`（另有 `.mjs` 副本供构建脚本用）：

```
INTRANET_MACHINE_HOST        → http://<host>:12345/zcode            (INTRANET_ASSET_BASE_URL)
ZCODE_DEPS_BASE_URL          → <asset>/deps                          (INTRANET_DEPS_BASE_URL)
内网探针                     → http://<host>:3850/api/intranet/probe (INTRANET_PROBE_SERVICE_URL)
```

当前只被 `packages/desktop/scripts/bundle.mjs`（electron-builder-binaries）和 `scripts/prepare-prebuilds.mjs` 使用。**内网探针**（`packages/services/src/system/systemService.ts`）是一个 TCP/HTTP 连通性诊断工具，带 `x-zcode-intranet-token` 头，不是出网依赖。

---

## 2. 产品后端出网清单（走 §1.1 端点）

| # | 行为 | 代码位置 | 路径 |
| --- | --- | --- | --- |
| 1 | 通用 API 客户端 | `packages/services/src/providers/api/nodeApiClient.ts:129` | `{origin}/api/v1/**` |
| 2 | OAuth token 交换 | `oauth/providers/{zai,bigmodel}ProviderConfig.ts` | `/api/v1/oauth/token` |
| 3 | OAuth 授权页 | `oauth/providers/zaiProviderConfig.ts:36` | `{chat.z.ai}/api/oauth/authorize` |
| 4 | OAuth userinfo | `oauth/providers/zaiProviderConfig.ts:52` | `{chat.z.ai}/api/oauth/userinfo` |
| 5 | OAuth 设备码流程 | `oauth/oauthService.ts:609,688` | `/api/v1/oauth/cli/init`、`/api/v1/oauth/cli/poll/{flowId}` |
| 6 | 客户端配置下发 | `client-config/clientConfigService.ts:70`、`provider-node/src/zcode-builtin-download.ts:50` | `/api/v1/client/configs` |
| 7 | 遥测上报 | `services/src/telemetry/telemetryCore.ts:337` | `ZCODE_TELEMETRY_REPORT_ENDPOINT` |
| 8 | ARMS RUM | `desktop/src/main/appARMSBootstrap.ts:268` | `ZCODE_ARMS_RUM_ENDPOINT` |
| 9 | 反馈提交 | `services/src/feedback/feedbackHttpClient.ts` | `/api/v1` |
| 10 | 会话分享 | `services/src/conversation-share/conversationShareHttpClient.ts` | 分享服务 |
| 11 | MCP 用量额度 | `usage-stats/providers/zcodeMcpQuotaProvider.ts:24` | `/api/v1/mcp/usage` |
| 12 | 套餐订阅列表 | `usage-stats/providers/bigmodelSubscriptionProvider.ts:24` | `{api.z.ai}/api/biz/subscription/list` |
| 13 | 额度查询 | `usage-stats/providers/bigmodelUsageQuotaProvider.ts:72` | `/api/monitor/usage/quota/limit` |
| 14 | Coding Plan 重置 | 同上 :73 | `/api/v1/coding-plan/reset` |
| 15 | Off-Peak 服务 | `session/offPeakServerClient.ts:165` | `/api/v1/off-peak**` |
| 16 | Coding Plan 模型网关 | `adapters/src/model/official-coding-plan-gateway.ts` | `/api/v1/ultra/**` |
| 17 | Electron 更新清单 | `desktop/src/main/manifestUpdateProvider.ts:22` | `/api/v1/releases/electron/manifest` |
| 18 | 自动更新 feed | `desktop/src/main/autoUpdater.ts:27` | `ZCODE_UPDATE_FEED_URL`（1 小时轮询） |
| 19 | 强制更新守卫 | `desktop/src/main/forceUpdateGuard.ts:13` | `/api/v1/client/configs` |

### 遥测默认状态（好消息）

`packages/shared/src/env.ts`：

```ts
export const ZCODE_TELEMETRY_ENABLED: boolean = true;                      // 常量恒真
export const ZCODE_TELEMETRY_REPORT_ENDPOINT = process.env.ZCODE_TELEMETRY_REPORT_ENDPOINT ?? "";
export const ZCODE_ARMS_RUM_ENDPOINT = process.env.ZCODE_ARMS_RUM_ENDPOINT ?? "";
```

总开关恒为 `true`，但**两个端点默认空字符串，且不内嵌构建产物**。`sendReport()` 第一行就是 `if (!ZCODE_TELEMETRY_ENABLED || !ZCODE_TELEMETRY_REPORT_ENDPOINT) return;`。

→ **不设这两个环境变量，遥测与 RUM 自动关闭，无需改代码。** 若要彻底杜绝，可把 `env.ts:50` 改成 `false`。

---

## 3. CDN / 静态资源（部分硬编码，需改代码）

| # | 用途 | 位置 | 是否可配 |
| --- | --- | --- | --- |
| 1 | 远程资源包（Electron 资源） | `desktop/src/main/remoteCdn.ts:4` `DEFAULT_CDN_BASE_URL = "https://cdn-zcode.z.ai"` | ✅ `ZCODE_CDN_BASE_URL` |
| 2 | 远程资源包（server 侧） | `server/src/remote/remoteAssetCdn.ts` | ✅ `ZCODE_REMOTE_ASSET_CDN_BASE_URL` |
| 3 | **插件市场目录** | `shared/src/plugin-marketplaces.ts:37` | ❌ **硬编码** |
| 4 | **插件资源（icon/hero）** | `ui/src/v4/featureSuggestedPrompts.ts:11`、`bootstrap/src/app/official-plugin-definitions.ts:58` | ❌ **硬编码（两处）** |
| 5 | 产品文档链接 | `ui/src/lib/productDocs.ts:2` | ❌ 硬编码 |
| 6 | 分享页下载链接 | `web/src/share/ConversationShareLandingPage.tsx:91` | ❌ 硬编码 |
| 7 | Rive 动画资源 | `ui/src/components/ai-elements/persona.tsx:59-84` | ❌ 硬编码到 vercel blob |

第 3 项是**内网插件商店的关键**：

```ts
// packages/shared/src/plugin-marketplaces.ts
export const DEFAULT_PLUGIN_MARKETPLACES: DefaultPluginMarketplace[] = [{
  id: ZCODE_OFFICIAL_PLUGIN_MARKETPLACE_ID,
  source: "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json",
  ...
}];
```

内网必须把它指向自建市场 URL，或改为纯本地市场。

---

## 4. 第三方模型服务

`config/provider/zcode-builtin.json`（180 KB）内置模型能力目录，含以下域名：

```
api.z.ai / z.ai / open.bigmodel.cn / bigmodel.cn / chat.z.ai
api.moonshot.cn / platform.kimi.com
api.minimaxi.com / platform.minimaxi.com
api.deepseek.com / platform.deepseek.com
dashscope.aliyuncs.com / dashscope-intl.aliyuncs.com / bailian.console.aliyun.com / modelstudio.console.aliyun.com
api.xiaomimimo.com / platform.xiaomimimo.com
api.openai.com / platform.openai.com
api.anthropic.com / console.anthropic.com
api.x.ai / console.x.ai
openrouter.ai / opencode.ai
```

该文件是**模型能力元数据**（上下文窗口、输入输出格式、是否支持 tool call 等），不是端点清单。结构：`config.providerConfigRules.providerRules`(8) + `config.modelConfigRules.{modelRules(84), modelApiRules(72), providerSiteRules(52), templateModelRules(244), builtinProviderModelRules(26)}`。

**注意**：该文件本身不产生出网请求，真正的出网由用户选中的 Provider 的 `baseUrl` 决定。

---

## 5. Agent 工具出网

### 5.1 WebFetch — 会**主动拦截**内网地址 ⚠️

`apps/zcode-cli/packages/core/src/tool/handlers/webfetch-egress-guard.ts`

```ts
export function assertWebFetchLiteralEgress(url: URL): void {
  if (isLocalHostname(hostname))  // localhost / *.localhost
    throw webFetchError("EgressBlocked", "WebFetch cannot access private or local hostnames", ...);
  if (!isIpLiteral(hostname)) return;
  assertPublicIpAddress(hostname, ...);   // 拒绝所有非 unicast / 私网 IP
}
```

`isPublicIpv4` 还显式排除 `198.18.0.0/15`；`isPublicIpv6` 排除 6 个 special-use 网段；并处理 IPv4-mapped 与 NAT64/DNS64 前缀还原。

→ **内网场景必须改这里**：要么放宽策略，要么加一个「允许内网 CIDR」的白名单开关。

### 5.2 WebSearch — 走模型原生能力

`websearch.ts` 不调外部搜索 API，而是把 `web_search` 作为 provider-native tool 交给模型（`PROVIDER_WEBSEARCH_TOOL_NAME = "web_search"`）。
→ 接本地模型后该工具自然失效（或报错），**无需改造，但要考虑是否从工具列表里摘掉**。

### 5.3 其他

| 工具 | 出网方式 |
| --- | --- |
| Bash / 终端 | 用户命令，继承 §1.2 代理配置 |
| MCP server | 用户配置，stdio 子进程注入代理/CA，HTTP transport 走 `createNetworkProxyFetch` |
| 内置浏览器 | Electron `<webview>` 独立 partition，默认跟随系统代理 |
| browser-use / computer-use 插件 | 走内置浏览器，不下载 Playwright/Chromium（**无 Playwright 依赖**） |

---

## 6. 构建期依赖下载

| # | 资源 | 默认源 | 覆盖变量 |
| --- | --- | --- | --- |
| 1 | npm 包 | `https://registry.npmjs.org`（`.npmrc`） | `--registry` / 内网私服 |
| 2 | Node dist（远程预编译） | `https://cdn.npmmirror.com/binaries/node` | `ZCODE_NODE_DIST_MIRROR` |
| 3 | Electron 二进制 | `https://npmmirror.com/mirrors/electron/`（`mise.toml`） | `ELECTRON_MIRROR` |
| 4 | electron-builder-binaries | 官方源 | ✅ 内网 `ZCODE_DEPS_BASE_URL`/`INTRANET_MACHINE_HOST` |
| 5 | 原生搜索工具（bfs/ugrep/ripgrep） | **已 vendored**，不下载 | — |
| 6 | 原生搜索工具源码重建（可选） | `codeload.github.com`、`github.com/*/releases`、`sourceware.org` | 见 `scripts/native-search-tools-config.mjs` |
| 7 | CLI 发行包自更新 | `packages/zcode-server-cli/src/runtime/releaseDownload.ts` | `ZCODE_DIST_BASE_URL` |

第 5 项确认：`apps/zcode-cli/dependencies/README.md` 明确写「Native search preparation does not download archives or fall back to a mirror」，产物在 `apps/zcode-cli/dependencies/native-search/`（含 `SHA256SUMS`）。

---

## 7. 阻塞项：官方插件包在本仓库缺失 ⚠️⚠️

`apps/zcode-cli/packages/bootstrap/src/app/official-plugin-definitions.ts` 声明了 12 个官方插件，`rootCandidates` 指向 `packages/<name>-plugin`。**这些目录全部不存在**：

```
缺失  packages/android-emulator-plugin     缺失  packages/restore-legacy-sessions-plugin
缺失  packages/browser-use-plugin          缺失  packages/skill-creator-plugin
缺失  packages/image-search-plugin         缺失  packages/zcode-cua-plugin
缺失  packages/ios-simulator-plugin        缺失  packages/zcode-guide-plugin
缺失  packages/node-repl-host              缺失  packages/plugin-creator-plugin
```

实际存在的插件目录只有三个：`apps/zcode-cli/packages/browser-use-plugin` 与
`apps/zcode-cli/packages/node-repl-host`（两者都有 `.zcode-plugin/plugin.json`，可被 seed），
以及 `apps/zcode-cli/packages/superpowers-plugin`（只有 LICENSE，且不在官方定义清单内）。
其余 `packages/*-plugin` 全部不存在。

而 `DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS` 默认启用：`browser-use`、`image-search`、`documents`、`pdf`、`presentations`、`spreadsheets`、`node-repl-host`、`skill-creator`、`plugin-creator`、`zcode-guide`。

**缺失时的实际行为（本报告初版此处有误，已更正）**：`resolveFilesystemSeedSource()`
（`bundled-plugins.ts:294`）用 `flatMap` 加 `if (!rootPath) return []` 把找不到 seed 根的
插件**静默跳过** —— 既不 seed，也**不产生任何告警**。`ZCODE_PLUGIN_SEED_INCOMPLETE`
（`bundled-plugins.ts:113`）只在**根目录存在但缺 `requiredSeedPaths` 所列文件**时才触发，
即"插件包在、但内容残缺"的场景。

所以真正的问题不是启动噪音，而是：这些定义仍会被 `DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS`
与商店 listing 回退当成「存在且默认启用」，在设置页留下永远无法加载的条目。

→ **内网部署必须解决**：这些插件既不在仓库里，又拿不到官方 CDN，商店会是空的。可选方案：
1. 从官方发行包（DMG / zcode tar.gz）中提取插件资产，vendored 进内网仓库；
2. 自建 `marketplace.json`，只放内网自研/裁剪后的插件；
3. 若只需核心能力，从 `DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS` 和 `OFFICIAL_PLUGIN_DEFINITIONS` 中裁剪掉不需要的插件定义，消除启动警告。

---

## 8. 本地模型接入（可行，无需改代码）

### 8.1 配置能力

`packages/provider/src/config/provider-data-schema.ts`：

```ts
export const providerApiTypeDataSchema = z.enum([
  "anthropic-messages",
  "openai-chat-completions",
  "openai-responses",
]);
// baseUrl: nonBlankRequiredString.pipe(z.string().url())
// headers: z.record(z.string(), z.string()).readonly().nullable().optional()
```

Access 类型：`api-key`、`zhipu-coding-plan-api-key`、`zhipu-account`。

→ 任何暴露 OpenAI 兼容接口的本地推理服务（Ollama / vLLM / SGLang / LM Studio / TGI）都能接：

```json
{
  "api": { "type": "openai-chat-completions", "baseUrl": "http://10.0.0.5:8000/v1" },
  "access": { "type": "api-key", "apiKey": "<local-token>" }
}
```

### 8.2 官方网关不会干扰自建 Provider

`official-coding-plan-gateway.ts` 只重写两条精确匹配的官方端点：

```
https://open.bigmodel.cn/api/anthropic/v1/messages → {zcode origin}/api/v1/ultra/anthropic/v1/messages
https://api.z.ai/api/anthropic/v1/messages          → {zcode origin}/api/v1/ultra-zai/anthropic/v1/messages
```

代码注释明确：「用户自建 provider 与第三方模型服务不受影响」。按协议 + 主机 + 端口 + 路径精确匹配。

### 8.3 配置文件位置

| 文件 | 变量 | 说明 |
| --- | --- | --- |
| 内置 Provider 配置 | `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | 默认 `config/provider/zcode-builtin.json` |
| 内置（打包产物） | `ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE` | SEA/发行包内嵌副本 |
| 个人 Provider 配置 | `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` | 默认文件名 `provider_config.json` |

`packages/provider-node/src/runtime-paths.ts` 要求内置与个人路径**同时提供**，只给一个会抛错。

**内网建议**：把 `zcode-builtin.json` 裁剪成只保留本地模型的条目，用 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 指向内网副本，避免用户在设置页看到一堆公网 Provider。

---

## 9. 改造清单（按优先级）

### P0 — 不改就跑不起来

| 项 | 动作 |
| --- | --- |
| 插件资产 | 解决 §7，否则商店空、默认插件缺失 |
| 产品端点 | 设 `ZCODE_BASE_URL` 指向内网网关（或自建 `client/configs` 等接口） |
| 插件市场 | 改 `plugin-marketplaces.ts:37` 硬编码 CDN 地址 |
| 本地模型 | 准备裁剪后的 `zcode-builtin.json` + `provider_config.json` |

### P1 — 必须改代码

| 项 | 文件 | 动作 |
| --- | --- | --- |
| WebFetch 私网拦截 | `webfetch-egress-guard.ts` | 加内网 CIDR 白名单开关 |
| 插件资源 base | `official-plugin-definitions.ts:58`、`featureSuggestedPrompts.ts:11` | 改指向内网 |
| 遥测彻底关闭 | `shared/src/env.ts:50` | 改 `ZCODE_TELEMETRY_ENABLED = false`（可选，默认已关） |
| 自动更新 | `autoUpdater.ts` | 内网禁用或指向内网 feed |

### P2 — 按需

| 项 | 说明 |
| --- | --- |
| 登录鉴权 | OAuth 链路若内网无对应服务，需评估「免登录 + 仅本地 API Key」路径 |
| 产品文档 / 分享页外链 | `productDocs.ts`、`ConversationShareLandingPage.tsx`，纯展示，可留 |
| 构建源 | `.npmrc` registry、`ELECTRON_MIRROR`、`ZCODE_NODE_DIST_MIRROR` |
| Rive 动画 | `persona.tsx` 疑似未使用的 ai-elements 组件，可确认后删除 |

### 推荐的最小改动路径

若内网有统一代理 + 自签 CA，**优先只做配置，不改代码**：

```bash
ZCODE_BASE_URL=https://zcode.intranet.corp
ZCODE_HTTP_PROXY=http://proxy.intranet.corp:8080
ZCODE_NO_PROXY=.intranet.corp,10.0.0.0/8,localhost
ZCODE_AGENT_CA_CERT=/etc/pki/intranet-ca.pem
ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=/etc/zcode/provider-intranet.json
ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=/var/lib/zcode/provider_config.json
ZCODE_NODE_DIST_MIRROR=https://mirror.intranet.corp/node
ZCODE_DIST_BASE_URL=https://mirror.intranet.corp/zcode/
# 不设置 ZCODE_TELEMETRY_REPORT_ENDPOINT / ZCODE_ARMS_RUM_ENDPOINT → 遥测自动关闭
```

剩余必须改代码的只有 3 处：WebFetch 私网拦截、插件市场地址、插件资源 base。

---

## 10. 附：环境变量总表（网络相关）

| 变量 | 用途 |
| --- | --- |
| `ZCODE_BASE_URL` / `ZCODE_ENDPOINT_ORIGIN` | ZCode 平台 origin |
| `BIGMODEL_API_BASE_URL` | BigModel origin |
| `ZAI_OAUTH_ORIGIN` / `ZAI_BUSINESS_BASE_URL` / `ZAI_OAUTH_CLIENT_ID` / `ZAI_OAUTH_APP_ID` | 智谱 OAuth 与业务 API |
| `ZCODE_CDN_BASE_URL` | 桌面远程资源 CDN |
| `ZCODE_REMOTE_ASSET_CDN_BASE_URL` | 远程资源完整覆盖地址（需带版本号） |
| `ZCODE_HTTP_PROXY` / `ZCODE_NO_PROXY` / `ZCODE_AGENT_CA_CERT` | 代理与 TLS |
| `ZCODE_REMOTE_HTTP_PROXY` / `ZCODE_REMOTE_NO_PROXY` | 远程工作区（SSH/WSL）代理 |
| `ZCODE_TELEMETRY_REPORT_ENDPOINT` / `ZCODE_ARMS_RUM_ENDPOINT` | 遥测端点（默认空 = 关闭） |
| `ZCODE_UPDATE_FEED_URL` | 自动更新 feed |
| `ZCODE_DIST_BASE_URL` | CLI 安装/更新下载根地址 |
| `ZCODE_NODE_DIST_MIRROR` | Node dist 镜像 |
| `INTRANET_MACHINE_HOST` / `ZCODE_DEPS_BASE_URL` | 内网依赖镜像 |
| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` / `ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE` / `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` | Provider 配置 |
| `ZCODE_TOOL_ENV_PASSTHROUGH_JSON` | 工具环境变量透传（可带代理变量） |
| `ZCODE_DEV_REMOTE_ASSET_USE_CDN` | 开发态是否走 CDN |

---

*生成时间：2026-09-21*
