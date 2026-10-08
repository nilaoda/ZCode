import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { officialSeaPlugins } from "../apps/zcode-cli/packages/cli/scripts/sea-official-plugin-assets.mjs";
import { officialPluginPackages, stageOfficialPluginAssets } from "./official-plugin-assets.mjs";
import {
  REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES,
  REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS,
} from "../packages/server/src/remote/zcodeAgentOfficialPluginAssets.ts";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const visionAgentRelativePath = "packages/vision-assistant-plugin/agents/vision-reader.md";

async function fixture(root) {
  for (const plugin of officialPluginPackages) {
    const source = resolve(root, plugin.relativePath);
    const paths = [
      ".zcode-plugin/plugin.json",
      ...plugin.requiredSeedPaths,
      ...plugin.requiredRuntimePaths,
    ];
    for (const relative of paths) {
      const target = join(source, relative);
      await mkdir(dirname(target), { recursive: true });
      if (relative === ".zcode-plugin/plugin.json" || plugin.name === "vision-assistant") {
        await cp(resolve(repoRoot, plugin.relativePath, relative), target);
      } else {
        // 回归只验证分发资源，不运行 Browser/MCP；生成文件由最小 fixture 提供。
        await writeFile(target, `fixture: ${plugin.name}/${relative}`);
      }
    }
  }
}

test("桌面与远程 filesystem staging 复用 SEA 清单，真实视觉 Agent 正文进入发布目录", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-plugin-stage-"));
  try {
    await fixture(root);
    assert.deepEqual(
      officialPluginPackages.map((p) => p.name),
      officialSeaPlugins.map((p) => p.name),
    );
    const vision = officialPluginPackages.find((p) => p.name === "vision-assistant");
    assert.equal(vision.requiresRuntime, false);
    for (const targetName of ["desktop/glm", "remote/glm"]) {
      const targetRoot = join(root, targetName);
      await stageOfficialPluginAssets({ repoRoot: root, targetRoot, log: () => {} });
      const agent = await readFile(join(targetRoot, visionAgentRelativePath), "utf8");
      assert.equal(
        agent,
        await readFile(resolve(repoRoot, "apps/zcode-cli", visionAgentRelativePath), "utf8"),
      );
      for (const plugin of officialPluginPackages) {
        const manifest = JSON.parse(
          await readFile(join(targetRoot, plugin.stagedPath, ".zcode-plugin/plugin.json"), "utf8"),
        );
        assert.equal(manifest.name, plugin.name);
        assert.equal(manifest.version, plugin.version);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("内容插件缺失 Agent 正文时 staging 明确失败，不能生成残缺发布包", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-plugin-missing-"));
  try {
    await fixture(root);
    await rm(resolve(root, "apps/zcode-cli", visionAgentRelativePath));
    await assert.rejects(
      () =>
        stageOfficialPluginAssets({
          repoRoot: root,
          targetRoot: join(root, "release"),
          log: () => {},
        }),
      /vision-reader\.md/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("远程复用合同包含视觉助手 manifest 和 Agent 正文", () => {
  assert.ok(REMOTE_AGENT_OFFICIAL_PLUGIN_PACKAGE_NAMES.includes("vision-assistant-plugin"));
  assert.ok(
    REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS.includes(
      "vision-assistant-plugin/.zcode-plugin/plugin.json",
    ),
  );
  assert.ok(
    REMOTE_AGENT_OFFICIAL_PLUGIN_REQUIRED_RELATIVE_PATHS.includes(
      "vision-assistant-plugin/agents/vision-reader.md",
    ),
  );
});
