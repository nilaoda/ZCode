import type { ICredentialService } from "#src/credential/credential.js";

/**
 * 判断某个 401 响应是否来自「当前生效的凭据」，用于决定是否触发全局退出。
 *
 * 本地化版本：**外部登录服务已整体移除**。原先按 `oauth:active_provider` 区分
 * Z.ai / BigModel 业务 access token 的分支已删除 —— 既然不存在任何 OAuth provider，
 * `oauth:active_provider` 永远不会被写入，那段匹配逻辑没有任何可达路径。
 *
 * 现在只保留 ZCode 平台 JWT 的判定，语义与改造前一致。
 *
 * 这里只判定候选请求；实际退出须由 OAuthService 在会话变更队列内复核，
 * 不能依赖异步旧快照。
 */
export async function isCurrentOAuthCredentialRequest(options: {
  input: string | URL;
  headers: Headers;
  credentialService: Pick<ICredentialService, "load">;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const authorization = options.headers.get("authorization")?.trim() ?? "";
  if (!authorization) return false;
  const currentJwt = (await options.credentialService.load("zcodejwttoken"))?.trim() ?? "";
  return Boolean(currentJwt) && authorization === `Bearer ${currentJwt}`;
}
