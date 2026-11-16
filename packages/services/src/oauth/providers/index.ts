import type { ApiClient } from "@zcode/shared";
import type { OAuthRuntimeConfig } from "../runtimeConfig.js";
import type { OAuthProviderAdapter } from "./providerAdapter.js";

/**
 * OAuth provider adapter 工厂。
 *
 * 本分支只发行 Local 身份：外部登录服务已整体移除。
 * 不依赖运行时环境变量，确保桌面、Web 与独立 CLI 都不会创建登录 adapter。
 */
export function createOAuthProviderAdapters(
  _config?: OAuthRuntimeConfig,
  _options?: { apiClient?: ApiClient },
): OAuthProviderAdapter[] {
  return [];
}

export type { OAuthProviderAdapter, OAuthProviderContext } from "./providerAdapter.js";

export { readLinkedBigModel } from "./zaiProviderAdapter.js";
