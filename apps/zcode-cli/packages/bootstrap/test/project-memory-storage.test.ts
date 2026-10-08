import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { DefaultRuntimeConfig } from "@zcode/contracts";
import { resolveAppRuntimeConfig, runtimeConfigLogContext } from "../src/app/runtime-config.js";

// 直接验证 bootstrap 装配及 identity，避免只测共享路径函数却遗漏实际 Agent 配置。
test("Agent 项目记忆跟随 Host profile，保留独立 CLI 和子代理存储语义", () => {
  const create = (env: NodeJS.ProcessEnv) =>
    resolveAppRuntimeConfig({
      cliStorageRoot: "/legacy/cli",
      storageRoot: "/legacy",
      configResult: { config: DefaultRuntimeConfig } as never,
      options: { env } as never,
      subagentOutputRootDir: "/legacy/cli/agents",
      workingDirectory: "/workspace/example",
      workspaceIdentity: " remote-workspace-identity ",
    }).runtimeConfig;
  const host = create({ ZCODE_DATA_BASE_DIR: "/profile" });
  assert.equal(host.memory?.cliStorageRoot, join("/profile", ".zcode", "cli"));
  assert.equal(host.memory?.storageRoot, "/legacy");
  assert.equal(host.memory?.workspaceIdentity, "remote-workspace-identity");
  assert.ok(
    runtimeConfigLogContext(host, "/workspace/example").memoryRoot?.startsWith(
      join("/profile", ".zcode", "cli", "memories", "projects"),
    ),
  );
  assert.equal(create({}).memory?.cliStorageRoot, "/legacy/cli");
});
