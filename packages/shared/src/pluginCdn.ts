import { readProductEndpointEnv } from "./zcodeEndpoint.js";

/**
 * 官方插件 CDN 基址。
 *
 * 插件目录（marketplace.json）与插件展示资源（icon / hero）都从同一基址派生，
 * 因此这里只暴露**一个**配置项，避免两处各配一遍导致漂移。
 *
 * 默认值指向线上 CDN，行为与改造前一致；内网部署通过
 * `ZCODE_OFFICIAL_PLUGIN_CDN_BASE_URL` 指向自建镜像。
 *
 * 取值同时兼容三种消费方：
 * - Node（Agent / CLI / 主进程）：读取 `process.env`。
 * - Renderer（Web / 桌面渲染进程）：读取构建期注入的 `__ZCODE_ENDPOINT_ENV__`。
 * 两者都由 `readProductEndpointEnv()` 统一合并，不新增第二条读取路径。
 */

export const ZCODE_OFFICIAL_PLUGIN_CDN_BASE_URL_ENV = "ZCODE_OFFICIAL_PLUGIN_CDN_BASE_URL";

export const DEFAULT_OFFICIAL_PLUGIN_CDN_BASE_URL =
  "https://cdn-zcode.z.ai/zcode/official-plugin";

type PluginCdnEnv = Record<string, string | undefined>;

/**
 * 宽松归一化：插件资源属于展示性内容，配置写错时退回默认 CDN 即可，
 * 不应因为一个图标基址把整个界面或启动流程打断。
 * 这与 `normalizeZCodeEndpointOrigin` 对产品端点「配置错误即抛错」的取舍不同。
 */
function normalizeCdnBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_OFFICIAL_PLUGIN_CDN_BASE_URL;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return DEFAULT_OFFICIAL_PLUGIN_CDN_BASE_URL;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_OFFICIAL_PLUGIN_CDN_BASE_URL;
  }
}

export function resolveOfficialPluginCdnBaseUrl(
  env: PluginCdnEnv = readProductEndpointEnv(),
): string {
  return normalizeCdnBaseUrl(env[ZCODE_OFFICIAL_PLUGIN_CDN_BASE_URL_ENV]);
}

/** 官方市场目录地址，对应 CDN 上的 `marketplace.json`。 */
export function buildOfficialPluginMarketplaceUrl(env?: PluginCdnEnv): string {
  return `${resolveOfficialPluginCdnBaseUrl(env)}/marketplace.json`;
}

/** 插件展示资源基址（icon / hero），对应 CDN 上的 `assets/` 目录。 */
export function buildOfficialPluginAssetsBaseUrl(env?: PluginCdnEnv): string {
  return `${resolveOfficialPluginCdnBaseUrl(env)}/assets`;
}
