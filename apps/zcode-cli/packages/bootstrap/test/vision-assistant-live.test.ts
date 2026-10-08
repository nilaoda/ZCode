import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPluginAgentStateId, VISION_ASSISTANT_PLUGIN_ID } from "@zcode/shared";
import { createVisionAssistantConfigPort } from "../src/app/vision-assistant-config.js";

test("驻留会话视觉配置端口每轮重读启停及模型覆盖，恢复插件不需要重建端口", async () => {
  const root = await mkdtemp(join(tmpdir(), "zcode-live-vision-"));
  try {
    const userConfigPath = join(root, "config.json");
    const plugin = join(root, "plugin");
    await mkdir(join(plugin, ".zcode-plugin"), { recursive: true });
    await mkdir(join(plugin, "agents"));
    await mkdir(join(root, "v2"));
    await writeFile(join(plugin, ".zcode-plugin", "plugin.json"), '{"name":"vision-assistant"}');
    await writeFile(
      join(plugin, "agents", "vision-reader.md"),
      "---\nname: vision-reader\ndescription: Inspect\ntools: []\ninjectAgentsMd: false\n---\nInspect image",
    );
    const port = createVisionAssistantConfigPort({
      userConfigPath,
      storageRoot: root,
      pluginStorageRoot: join(root, "plugins"),
      officialPluginRoots: [plugin],
    });
    const writeConfig = (enabled: boolean, suppressedBuiltins: string[] = []) =>
      writeFile(
        userConfigPath,
        JSON.stringify({
          plugins: {
            enabledPlugins: { [VISION_ASSISTANT_PLUGIN_ID]: enabled },
            suppressedBuiltins,
          },
        }),
      );
    const writeModel = (modelId: string) =>
      writeFile(
        join(root, "v2", "agents-state.json"),
        JSON.stringify({
          pluginAgentModelSelectionOverrides: {
            [createPluginAgentStateId(VISION_ASSISTANT_PLUGIN_ID, "vision-reader")]: {
              providerId: "test",
              modelId,
            },
          },
        }),
      );
    await writeConfig(false);
    assert.equal((await port.read()).enabled, false);
    await writeConfig(true);
    await writeModel("vision-a");
    assert.equal((await port.read()).profile?.modelSelection?.modelId, "vision-a");
    await writeModel("vision-b");
    assert.equal((await port.read()).profile?.modelSelection?.modelId, "vision-b");
    await writeConfig(true, [VISION_ASSISTANT_PLUGIN_ID]);
    assert.equal((await port.read()).enabled, false);
    await writeConfig(true);
    assert.equal((await port.read()).enabled, true);
    await writeFile(userConfigPath, "invalid json");
    await assert.rejects(port.read());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
