# ZCode 内网部署指南

面向把 ZCode 部署到隔离网络、只接入内网自建模型的场景。改造的完整外部网络行为清单见
[`INTRANET-NETWORK-AUDIT.md`](../INTRANET-NETWORK-AUDIT.md)。

---

## 1. 改造总览

ZCode 的出站流量已经收敛到少数几个可配置入口，因此**绝大部分内网适配是配置工作**，
只有三处需要改代码（本分支已完成）。

| 能力 | 状态 |
| --- | --- |
| 产品后端地址 | 环境变量可整体重定向 |
| 出站代理 / 自签 CA | 环境变量，覆盖 Electron、模型请求、MCP、子进程 |
| 遥测 / ARMS RUM | **默认关闭**，端点为空即不上报 |
| 插件 CDN（目录 + 资源） | 环境变量（本分支改造） |
| WebFetch 私网访问 | 环境变量白名单（本分支改造） |
| 本地模型 | 通过 Provider 配置接入，无需改代码 |

---

## 2. 快速开始

### 2.1 先确认配置从哪里生效

这决定了配置该写在哪里。**安装后的桌面 App 不读 `.env` 文件**，这点很容易踩坑。

| 运行形态 | `.env` 是否生效 | 说明 |
| --- | --- | --- |
| CLI / TUI（`zcode`） | ✅ 生效 | 从当前工作目录**向上逐级**查找 `.env`；已有 `process.env` 优先于文件（`dotenv` 以 `override: false` 加载） |
| 桌面 App — 开发态（`pnpm dev:desktop`） | ✅ 生效 | 读仓库根与 `packages/desktop` 下的 `.env` / `.env.local` |
| 桌面 App — **安装包** | ❌ **不生效** | `loadHostProcessEnvFromLocalFiles()` 在打包模式下直接 return，只保留一个打包标记 |
| Web 开发服务器 | 构建期读取 | Vite `loadEnv` |

依据：`packages/desktop/src/main/desktopRuntimeEnv.ts:154`（打包模式提前返回）与
`apps/zcode-cli/packages/cli/src/env.ts:74`（CLI 向上查找 `.env`）。

打包后的桌面 App 有三条配置途径：

1. **构建期注入** —— 推荐用于分发。构建时把 `.env` 放在仓库根，Vite 会通过
   `__ZCODE_ENDPOINT_ENV__` 把 `pickProductEndpointEnv` 白名单里的公开链接编进产物。
   覆盖范围：`ZCODE_BASE_URL` / `ZCODE_ENDPOINT_ORIGIN`、`BIGMODEL_API_BASE_URL`、
   `ZAI_OAUTH_ORIGIN`、`ZAI_BUSINESS_BASE_URL`、`ZAI_OAUTH_CLIENT_ID`、
   `ZCODE_OFFICIAL_PLUGIN_CDN_BASE_URL`。这样发出去的安装包已经指向内网，终端用户无需配置。

2. **操作系统级环境变量** —— 覆盖构建期未注入的部分（代理、CA、Provider 路径等）。
   - macOS：`launchctl setenv ZCODE_HTTP_PROXY http://proxy.intranet.example.com:8080`
     （对 GUI 启动的 App 生效，需重启 App；注销后失效）
   - Windows：用户级或系统级环境变量（`setx` 或「系统属性 → 环境变量」）
   - Linux：`~/.config/environment.d/*.conf`，或 desktop entry 里写 `Exec=env VAR=... zcode`

3. **Provider 配置** —— 安装包内固定读 `<resources>/config/provider/zcode-builtin.json`。
   要用外部文件，必须通过 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 指向（依赖途径 2）。

> ⚠️ 上面「安装包」这条路径**未经端到端验证**——当前环境无法构建安装包。
> 首次部署请按第 8 节清单逐项确认。

### 2.2 操作步骤

**CLI / TUI 或开发态：**

1. `cp .env.intranet.example .env`
2. 按内网环境修改，重点是 `ZCODE_BASE_URL`、代理 / CA、`ZCODE_OFFICIAL_PLUGIN_CDN_BASE_URL`
3. 准备两个 Provider 配置文件，路径写进 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` 与
   `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`（**必须同时提供**，只给一个会在启动时抛错）
4. 启动并按第 8 节验证

**分发安装包：**

1. 在构建机上把 `.env` 放在仓库根，再构建桌面安装包（构建期注入端点与插件 CDN）
2. 其余运行时变量用 OS 级环境变量下发（见 2.1 途径 2）

---

## 3. 本地模型接入

### 3.1 支持的接口类型

`ProviderApiConfig.type` 只接受三种取值：

| 取值 | 适用 |
| --- | --- |
| `openai-chat-completions` | vLLM、Ollama、LM Studio、SGLang、TGI 等 OpenAI 兼容服务 |
| `openai-responses` | OpenAI Responses API 兼容实现 |
| `anthropic-messages` | Anthropic Messages API 兼容实现 |

`baseUrl` 可以是任意 `http` / `https` 地址，因此内网自建服务直接填内网地址即可。

> 官方 Coding Plan 网关重写只对两条**精确匹配**的官方端点生效
> （`open.bigmodel.cn/api/anthropic/v1/messages` 与 `api.z.ai/api/anthropic/v1/messages`），
> 自建 Provider 不会被改写。

### 3.2 个人 Provider 配置

把 [`config/provider/local-models.example.json`](../config/provider/local-models.example.json)
复制到内网路径并按实际服务地址修改：

```json
{
  "schemaVersion": 1,
  "config": {
    "providerOrder": ["intranet-vllm"],
    "providerConfigRules": [
      {
        "providerId": "intranet-vllm",
        "providerName": "intranet-vllm",
        "enabled": true,
        "config": {
          "group": "standard-personal",
          "access": { "type": "api-key", "apiKey": "REPLACE_WITH_LOCAL_TOKEN" },
          "api": { "type": "openai-chat-completions", "baseUrl": "http://10.0.0.5:8000/v1" },
          "personalModelIds": ["qwen3-coder-30b"],
          "modelOrder": ["qwen3-coder-30b"]
        }
      }
    ],
    "modelConfigRules": {
      "providerModelRules": [
        { "providerId": "intranet-vllm", "modelId": "qwen3-coder-30b", "config": { "enabled": true } }
      ],
      "manualProviderModelRules": []
    }
  }
}
```

约束（schema 为 `.strict()`，多写字段会被拒绝）：

- `providerId` 不能以 `account:` 开头（该前缀保留给内置账号 Provider）。
- `config.group` 个人 Provider 只能取 `standard-personal`。
- 个人 Provider 不能声明 `builtinModelIds`。
- 同一个 `providerId` / `modelId` 不能同时出现在 `providerModelRules` 与
  `manualProviderModelRules` 中。

### 3.3 只显示内网模型（可选）

默认的内置 Provider 目录 `config/provider/zcode-builtin.json` 包含二十多个公网模型服务
（OpenAI、Anthropic、DeepSeek、Moonshot、MiniMax、通义、小米、OpenRouter 等）。内网部署
若希望设置页只出现自建模型，可指向裁剪版目录：

```bash
ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=/etc/zcode/provider-builtin.json
```

内容用 [`config/provider/zcode-builtin-intranet.example.json`](../config/provider/zcode-builtin-intranet.example.json)
（一份空的 Provider 目录）：

```json
{
  "schemaVersion": 1,
  "revision": 1,
  "config": {
    "providerConfigRules": { "templateRules": [], "providerRules": [] },
    "modelConfigRules": {
      "modelRules": [], "modelApiRules": [], "providerSiteRules": [],
      "templateModelRules": [], "builtinProviderModelRules": []
    }
  }
}
```

> ⚠️ 这是**可选且需自行验证**的步骤。清空内置目录会让所有依赖内置 Provider 的能力
> （Coding Plan 套餐、Off-Peak、官方 MCP 额度等）一并不可用——这通常是内网部署的预期结果，
> 但请先在测试环境确认设置页与模型选择入口表现正常。`revision` 是缓存失效用的整数，
> 内容变更时请递增。
>
> 内置目录文件受 `decodeZCodeBuiltinRelease` 校验（`scripts/builtin-provider-config.mjs`
> 在构建期复用同一校验），字段写错会在构建期直接失败。

---

## 4. WebFetch 内网放行

WebFetch 工具默认只允许公网目标，会拒绝 `localhost`、`*.local` 与全部私网 / 特殊用途 IP。
内网部署通过白名单显式放行：

```bash
ZCODE_WEBFETCH_ALLOW_PRIVATE_HOSTS=.intranet.example.com,10.0.0.0/8,192.168.0.0/16
```

| 写法 | 语义 |
| --- | --- |
| `*` | 放行全部私网目标（等价于关闭该策略） |
| `.intranet.example.com` | 后缀匹配，命中 `intranet.example.com` 与 `*.intranet.example.com` |
| `*.intranet.example.com` | 同上，两种写法等价 |
| `git.intranet.example.com` | 精确匹配该主机名 |
| `10.0.0.0/8` | 字面量 IP 的 CIDR 匹配，IPv4 / IPv6 均可 |

行为说明：

- **未配置时行为与改造前完全一致**，公网目标不受影响。
- 命中放行的目标**同时跳过 `http → https` 强制升级**。内网服务通常只监听明文 HTTP，
  强制升级会让放行形同虚设。请只把确实可信的地址写进白名单。
- 该策略由 `apps/zcode-cli/packages/core/src/tool/handlers/webfetch-private-egress.ts`
  单独拥有；URL 形态过滤与出站前复核两处都调用它，不会出现两套匹配逻辑。

---

## 5. 插件与插件商店

官方插件目录（`marketplace.json`）与插件展示资源（icon / hero）都从同一个 CDN 基址派生：

```bash
ZCODE_OFFICIAL_PLUGIN_CDN_BASE_URL=https://mirror.intranet.example.com/zcode/official-plugin
```

- 目录地址 = `${base}/marketplace.json`
- 资源基址 = `${base}/assets`
- 未配置时为线上 CDN `https://cdn-zcode.z.ai/zcode/official-plugin`。

### 内置插件现状

本仓库是上游的不完整开源发行版，**上游 monorepo 中的官方插件包目录并未随仓库分发**。
`official-plugin-definitions.ts` 原先声明的 12 个官方插件里，只有两个在本仓库中可实际 seed：

| 插件 | 状态 |
| --- | --- |
| `browser-use` | 可 seed（`apps/zcode-cli/packages/browser-use-plugin`） |
| `node-repl-host` | 可 seed（`apps/zcode-cli/packages/node-repl-host`） |
| 其余 10 个 | **插件包缺失，定义已裁剪** |

因此内网商店只会出现这两个内置插件。若需要 documents / pdf / presentations /
spreadsheets 等能力，需要先从官方发行包（DMG 或 `zcode` 运行包）中提取对应插件资产，
vendored 进仓库并恢复 `OFFICIAL_PLUGIN_DEFINITIONS` 条目与
`packages/shared/src/plugin-marketplaces.ts` 中的 `DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS`。

### 已知遗留

`packages/ui/src/v4/featureSuggestedPrompts.ts` 中仍有约 10 条推荐语料引用已裁剪的插件
（`plugin://pdf@…`、`plugin://presentations@…`、`plugin://computer-use@…` 等），
`packages/ui/src/lib/pluginIconSource.ts` 中也保留了对应图标映射。这些条目在裁剪前就已
指向不存在的插件，属于待清理项，不影响启动。

---

## 6. 遥测

无需任何操作。`packages/shared/src/env.ts` 中：

```ts
export const ZCODE_TELEMETRY_REPORT_ENDPOINT = process.env.ZCODE_TELEMETRY_REPORT_ENDPOINT ?? "";
export const ZCODE_ARMS_RUM_ENDPOINT = process.env.ZCODE_ARMS_RUM_ENDPOINT ?? "";
```

两个端点默认空字符串，且不内嵌进构建产物；上报函数首行判空即返回。**只要不设置这两个
环境变量，遥测与 ARMS RUM 就不会出网。**

若希望代码层面彻底禁用，可把同文件中的 `ZCODE_TELEMETRY_ENABLED` 改为 `false`。

---

## 7. 构建与发布

构建流水线见 [`.github/workflows/`](../.github/workflows/)：

| 工作流 | 用途 |
| --- | --- |
| `placeholder.yml` | 占位，仅用于启用 Actions 页面的手动运行按钮 |
| `verify.yml` | 手动跑 `pnpm typecheck` / `pnpm lint` / `pnpm architecture:check` |
| `build-desktop.yml` | 构建 Windows / macOS 桌面安装包 |
| `build-cli.yml` | 构建 Windows / macOS 命令行运行包 |

**所有工作流都只配置了 `workflow_dispatch`，没有任何自动触发器**——不会因为 push、
tag 或 PR 自动消耗构建资源。全部从 Actions 页面点 **Run workflow** 手动启动。

- 产物每次运行都上传为 Actions artifacts，保留 1 天。
- 在 `release_tag` 输入框填写 tag 名（或从 tag ref 手动运行），才会额外上传到 GitHub Release。
- `build-cli.yml` 的 `dist_base_url` 用于生成 `install.sh` 的下载根地址，留空则默认指向
  `https://github.com/<owner>/<repo>/releases/latest/download/`。

---

## 8. 验证清单

内网部署完成后建议逐项确认：

- [ ] 确认配置确实生效：CLI 用 `.env`；**安装包用 OS 级环境变量或构建期注入**（见 2.1）
- [ ] 应用启动无 `ZCODE_PLUGIN_SEED_INCOMPLETE` 类告警
- [ ] 设置页模型选择器只出现内网 Provider
- [ ] 向本地模型发起一次对话，确认无出网
- [ ] 插件商店能加载（指向内网镜像时）
- [ ] WebFetch 能读取白名单内的内网地址，且白名单外的私网地址仍被拒绝
- [ ] 断网（或抓包）确认无遥测上报
- [ ] 代理环境下 MCP server 与 Bash 工具能正常出网
