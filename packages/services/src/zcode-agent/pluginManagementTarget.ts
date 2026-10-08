import type { ZCodeAgentWorkspaceTarget } from "./zcodeAgentPluginParams.js";

export function resolvePluginManagementTarget(
  input: {
    workspacePath?: string;
    workspaceIdentity?: string;
    remoteSessionId?: string;
    scope?: string;
    configScope?: string;
  },
  managementWorkspacePath: () => string,
): ZCodeAgentWorkspaceTarget {
  if (input.workspacePath?.trim()) return input as ZCodeAgentWorkspaceTarget;
  // 视觉助手曾把全局配置绑定连通性测试的 cwd，导致无本地项目时无法设置。
  // 仅明确的 user scope 使用既有管理载体；远程身份和 workspace scope 不得回落本机。
  if (
    input.workspacePath !== undefined ||
    input.workspaceIdentity !== undefined ||
    input.remoteSessionId !== undefined ||
    (input.configScope ?? input.scope) !== "user"
  ) {
    throw new Error("Plugin configuration requires a workspace target or explicit user scope");
  }
  return { workspacePath: managementWorkspacePath() };
}
