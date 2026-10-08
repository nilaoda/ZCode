import assert from "node:assert/strict";
import test from "node:test";
import { resolvePluginManagementTarget } from "../src/zcode-agent/pluginManagementTarget.js";

test("用户级插件设置不要求项目，使用既有管理进程载体", () => {
  const managementPath = () => "/internal/plugin-management";
  assert.deepEqual(resolvePluginManagementTarget({ configScope: "user" }, managementPath), {
    workspacePath: managementPath(),
  });
  assert.deepEqual(resolvePluginManagementTarget({ scope: "user" }, managementPath), {
    workspacePath: managementPath(),
  });
  for (const input of [
    {},
    { scope: "workspace" },
    { configScope: "workspace" },
    { scope: "user", workspaceIdentity: "remote-identity" },
    { scope: "user", remoteSessionId: "remote-session" },
  ]) {
    assert.throws(() => resolvePluginManagementTarget(input, managementPath));
  }
});

test("工作区插件配置保留远程身份，不改写为本机全局配置", () => {
  const target = {
    workspacePath: "/remote/project",
    workspaceIdentity: "remote-identity",
    remoteSessionId: "remote-session",
    configScope: "workspace",
  };
  assert.equal(
    resolvePluginManagementTarget(target, () => {
      throw new Error("Unexpected fallback");
    }),
    target,
  );
});
