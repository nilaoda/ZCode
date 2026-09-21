# ZCode 内网部署指南

面向把 ZCode 部署到隔离网络、只接入自建本地模型的场景。改造的完整外部网络行为清单见
[`INTRANET-NETWORK-AUDIT.md`](../INTRANET-NETWORK-AUDIT.md)。

---

## 0. 已移除的能力（本版本默认行为）

**外部登录服务已整体移除**，应用不需要、也不提供任何账号登录。

| 已移除 | 实现位置 | 说明 |
| --- | --- | --- |
| OAuth provider（zai / bigmodel） | `packages/services/src/oauth/providers/index.ts` | 工厂恒定返回空数组；`zaiProviderAdapter` / `bigmodelProviderAdapter` / 两个 providerConfig 及 `runtimeConfig` 已删除 |
| OAuth 401 退出判定中的业务 token 分支 | `oauth/oauthUnauthorizedRequest.ts` | 只保留 ZCode 平台 JWT 判定 |
| 启动时「无可用 Provider 就强制登录」门禁 | `packages/ui/src/lib/rootStartupGate.ts` | `shouldEnableProviderAvailabilityLoginEntryGuard()` 返回 `false`，冷启动直接进工作台 |
| UI 登录入口 | `packages/ui/src/Root.tsx` | 不再传入 `onLogin`，登录按钮自动隐藏 |
| 云端 Provider 与模板 | `config/provider/zcode-builtin.json` | 见 §3.3，内置目录已是纯本地版本 |

**结果**：冷启动直接进入工作台；没有模型时用户到「设置 → 模型供应商 → 新增」自行添加
本地模型即可，不会被任何登录页拦住。

> 仍未删除（不可达，属后续清理项）：`WelcomeScreen.tsx`、`LoginApiKeyForm.tsx`、
> `root/useRootOAuthEffects.ts` 等 OAuth 会话恢复钩子，以及 `onLogin` 属性的透传链路。
> 它们已无任何可达路径，但删除涉及跨组件改动，未在本次一并处理。

---

## 1. 改造总览

ZCode 的出站流量已经收敛到少数几个可配置入口，因此**绝大部分内网适配是配置工作**，
只有少数几处需要改代码（本分支已完成）。

| 能力 | 状态 |
| --- | --- |
| **外部登录（OAuth）** | **已整体移除**，应用无需登录 |
| **内置 Provider 目录** | **已收敛为纯本地**，只能新增自定义 Provider |
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

### 3.3 内置目录已是纯本地（默认行为）

`config/provider/zcode-builtin.json` 已改造为**只服务本地模型**的版本，无需额外配置：

| 已清空 | 原因 |
| --- | --- |
| `providerConfigRules.providerRules`（8 条） | 全部是 `account:zai-*` / `account:bigmodel-*` 订阅套餐 Provider，依赖外部登录 |
| `providerConfigRules.templateRules`（20 条） | zai / bigmodel / OpenAI / Anthropic / DeepSeek / Moonshot / MiniMax / 通义 / 小米 / OpenRouter / opencode 等云端服务模板 |
| `modelConfigRules.builtinProviderModelRules`（26 条） | 引用已移除的 provider id |
| `modelConfigRules.templateModelRules`（244 条） | 引用已移除的 template id |

**刻意保留** `modelConfigRules` 中的 `modelRules`（84）/ `modelApiRules`（72）/
`providerSiteRules`（52）：这些是按「模型名 / baseUrl」匹配的能力元数据，其中包含
`modelMatch: ".*"` 的兜底规则（默认上下文窗口等）。清空它们会连兜底默认值一起丢掉，
反而让本地模型的能力解析退化。保留的规则不会被云端服务触发，因为对应的 baseUrl 不会出现。

结果：设置页只能新增自定义 Provider，不再出现任何云端供应商。新增入口在
「设置 → 模型供应商 → 新增」，填任意 `baseUrl` 与协议类型即可（见 3.2）。

> `revision` 已随内容变更递增（30 → 31）。它是缓存失效计数器，后续修改该文件时必须继续递增。
> 文件受 `decodeZCodeBuiltinRelease` 校验（`scripts/builtin-provider-config.mjs`
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
- `build-desktop.yml` 的 `preview_identity` 输入默认开启，产出可与官方版并存的包（见第 8 节）。
- `build-cli.yml` 的 `dist_base_url` 用于生成 `install.sh` 的下载根地址，留空则默认指向
  `https://github.com/<owner>/<repo>/releases/latest/download/`。

> 两个构建流水线都会显式注入 `ZCODE_ENV=production`。缺少它时 `ZCODE_ENV` 会回退为 `test`，
> 导致产品身份变成 Preview、产物名被加 `_TEST` 后缀、包内指向测试后端。

---

## 8. 与官方版本共存

目标是让本版本与官方 ZCode **并排安装、同时运行、互不干扰**。构建时启用 Local 身份即可，
**装完默认就是隔离的，不需要任何环境变量**。

### 8.1 桌面端：Local 身份

构建时设 `ZCODE_LOCAL_IDENTITY=1`（对应 `build-desktop.yml` 的 `local_identity` 输入，
默认开启）。它与 `ZCODE_ENV` 是**两个独立的轴**：前者决定产品身份，后者决定后端环境。

| | 官方版 | 本版本（Local 身份） |
| --- | --- | --- |
| `productName` | `ZCode` | `ZCode Local` |
| `appId` | `dev.zcode.app` | `dev.zcode.app.local` |
| Electron `userData` | `<appData>/ZCode` | `<appData>/ZCode Local` |
| **业务数据根** | `~/.zcode` | **`~/.zcode-local-home/.zcode`** |
| CUA Helper 安装目录 | 默认 variant | `local` variant |
| Linux 可执行 / 包名 | `zcode` | `zcode-local` |
| Windows AppUserModelId | `dev.zcode.app` | `dev.zcode.app.local` |
| 产物文件名 | `ZCode-<版本>-…` | `ZCode Local-<版本>-…` |

因此两版有各自的应用包、各自的 Electron 状态目录、各自的业务数据根，
同时运行不会触发单实例锁冲突，也不会互相覆盖任务、设置、凭据或插件缓存。

`ZCODE_ENV=production` 保证产物名不带 `_TEST` 后缀——该后缀标记的是**后端环境**而非身份。

依据：`packages/desktop/scripts/desktop-product-identity.mjs`、
`packages/desktop/src/main/desktopDataBaseDirBootstrap.ts`、
`packages/desktop/src/main/desktopRuntimeEnv.ts`、`packages/desktop/src/main/index.ts:261-272`。

**用户级配置与日志也已隔离**。仓库里原本散落着大量按真实家目录解析的 `~/.zcode/**`
路径（用户命令、技能、插件、CLI 配置与 MCP 配置、AGENTS.md、会话库、日志、rollout、
workflows、hook 信任库等），它们不会跟随自定义数据根。现已统一收敛到
`@zcode/shared/node` 的 `resolveZCodeUserRootDir()`：

| 原先路径 | 现在 | 说明 |
| --- | --- | --- |
| `~/.zcode/commands` | `<数据根>/commands` | 用户级 slash 命令 |
| `~/.zcode/skills`、`~/.zcode/plugins` | `<数据根>/…` | 用户级技能与插件 |
| `~/.zcode/cli/config.json` | `<数据根>/cli/config.json` | CLI 与 MCP 用户配置 |
| `~/.zcode/AGENTS.md` | `<数据根>/AGENTS.md` | 用户级指令 |
| `~/.zcode/cli/db/db.sqlite` | `<数据根>/cli/db/db.sqlite` | CLI 会话库 |
| `~/.zcode/cli/log`、`rollout`、`debug` | `<数据根>/…` | 日志与轨迹 |
| `~/.zcode/workflows`、`security/…` | `<数据根>/…` | 脚本工作流与 hook 信任库 |

**仍然共用（刻意不改）**：

| 路径 | 为什么不动 |
| --- | --- |
| `~/.claude`、`~/.agents`、`~/.codex` | **跨工具**配置约定，与 Claude Code / Codex 等共享；改掉会把别的工具的配置搬到它们不认识的位置。由 `resolveAgentConfigBaseDir()` 按路径首段判断，只有 `.zcode` 跟随数据根 |
| `~/Library`、`AppData` 等 OS 目录 | Chrome/Chromium 探测、Finder 集成等系统级资源 |
| 用户显式设置的 `ZCODE_STORAGE_DIR` | 优先级高于身份默认值，用户指定即生效 |

实现入口：`packages/shared/src/node/zcodeUserRoot.ts`。选它是因为
`apps/zcode-cli/*` 全树都不依赖 `@zcode/services`，`@zcode/shared` 是唯一公共依赖。
`packages/services` 内部仍优先用自己的 `getZCodeDataRootDir()`（额外支持运行时
`setDataBaseDir()`），桌面主进程在调用它的同时会把同一个值写入
`ZCODE_DATA_BASE_DIR`，保证两套机制与子进程解析到同一个根。

### 8.2 为什么另起 Local 身份，而不是复用 Preview

上游已有 `ZCODE_PREVIEW_IDENTITY=1` 的 Preview 身份，但它**有意与正式版共享业务数据**
（`desktopRuntimeEnv.ts` 注释：「Preview 与生产版共享任务、配置和凭据……不改写
ZCODE_HOME / ZCODE_DATA_BASE_DIR 业务数据根」）——上游的用途是让 Preview 用户拿真实数据试用。

本版本的需求相反，所以新增了第三种身份：

| 身份 | 应用名 | 业务数据根 | 用途 |
| --- | --- | --- | --- |
| `production` | ZCode | `~/.zcode` | 官方正式版 |
| `preview` | ZCode Preview | `~/.zcode`（有意共享） | 上游的试用包 |
| `local` | ZCode Local | `~/.zcode-local-home/.zcode` | 自建 / 纯本地模型发行版 |

三种身份的 `appId` 与 `productName` 互不相同。所有 `=== "production"` 的既有判断
（自动更新、正式版专属菜单等）会让 Local 自然落入「非正式版」分支，这正是预期行为。

数据根的优先级：显式 `ZCODE_DATA_BASE_DIR` > 设置里的 `dataBaseDir` > 身份默认值。
前两者仍然生效，不会被身份默认值覆盖。

### 8.3 CLI：需要显式改名

CLI 运行包的 `install.sh` 默认装到 `~/.zcode/runtime`，并在 `~/.local/bin` 建
`zcode` 命令——**会直接覆盖官方 CLI**。三个变量可避免冲突：

```bash
ZCODE_DIST_HOME="$HOME/.zcode-local-home/runtime" \
ZCODE_DIST_BIN_DIR="$HOME/.local/bin" \
ZCODE_DIST_COMMAND_NAME="zcode-local" \
sh install.sh
```

`ZCODE_DIST_COMMAND_NAME` 是本分支新增的开关（默认 `zcode`，不改变原有行为），
只影响生成的 wrapper 文件名，运行包内部的 `bin/zcode.mjs` 路径不变。

> Windows 没有对应的安装脚本，只能手动解压；命令名冲突需自行处理 PATH。
>
> CLI 侧没有「身份」概念，数据根同样由 `ZCODE_DATA_BASE_DIR` 控制——
> 想与官方 CLI 隔离，需要自行设置它。

### 8.4 现状小结

| 项 | 状态 |
| --- | --- |
| 桌面端并排安装 / 同时运行 | 默认启用（Local 身份） |
| 桌面端业务数据隔离 | **默认启用**，装完即隔离，无需环境变量 |
| 桌面端 Electron 状态隔离 | 默认启用 |
| 用户级配置 / 日志 / CLI 会话库 | **默认启用**，随数据根走 |
| 跨工具目录（`.claude` / `.agents` / `.codex`） | 共用（刻意，属跨工具约定） |
| CLI 并存 | 需手动传三个变量改名与改路径 |
| CLI 数据隔离 | 需自行设 `ZCODE_DATA_BASE_DIR` |

> Local 身份的 Dynamic Workflow 灰度不做强制开启（该行为只对 Preview 身份生效），
> 因此 Local 包使用 Host 端默认档位。

---

## 9. 验证清单

内网部署完成后建议逐项确认：

- [ ] 确认配置确实生效：CLI 用 `.env`；**安装包用 OS 级环境变量或构建期注入**（见 2.1）
- [ ] 应用启动无 `ZCODE_PLUGIN_SEED_INCOMPLETE` 类告警
- [ ] 设置页模型选择器只出现内网 Provider
- [ ] 向本地模型发起一次对话，确认无出网
- [ ] 插件商店能加载（指向内网镜像时）
- [ ] WebFetch 能读取白名单内的内网地址，且白名单外的私网地址仍被拒绝
- [ ] 断网（或抓包）确认无遥测上报
- [ ] 代理环境下 MCP server 与 Bash 工具能正常出网
- [ ] 与官方版共存时：两版可同时启动，且业务数据互不覆盖（见 8.1）
- [ ] 确认本版本数据落在 `~/.zcode-local-home/.zcode`，而非官方版的 `~/.zcode`
