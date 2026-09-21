import type { OAuthProviderAdapter } from "./providerAdapter.js";

/**
 * OAuth provider adapter 工厂。
 *
 * 本地化版本：**外部登录服务已整体移除**，这里恒定返回空数组。
 *
 * 不再接受 config / apiClient 参数：既然不存在任何 provider，就不该再要求调用方
 * 注入凭据与 ApiClient —— 那种"必须传入但永远用不到"的参数会误导后续维护者。
 * `oauthService` 会拿到 0 个 adapter，所有登录相关链路自然进入空转状态。
 */
export function createOAuthProviderAdapters(): OAuthProviderAdapter[] {
  return [];
}

export type { OAuthProviderAdapter, OAuthProviderContext } from "./providerAdapter.js";
