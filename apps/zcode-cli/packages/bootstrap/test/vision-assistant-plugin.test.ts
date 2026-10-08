import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import {
  VISION_ASSISTANT_PLUGIN_ID,
  DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS,
  createPluginAgentStateId,
} from "@zcode/shared";
import { loadPluginAgentProfiles } from "../src/subagents.js";
import { resolvePluginRuntimeFeatures } from "../src/app/plugin-runtime-features.js";
import { OFFICIAL_PLUGIN_DEFINITIONS } from "../src/app/official-plugin-definitions.js";

// 不访问商店或真实用户目录，验证离线资产、默认身份和既有模型覆盖共同装配。
test("离线视觉插件具备稳定身份，启停控制能力，模型覆盖复用子代理 state", async () => {
  const rootPath = fileURLToPath(new URL("../../vision-assistant-plugin/", import.meta.url));
  const manifest = JSON.parse(
    await readFile(
      new URL("../../vision-assistant-plugin/.zcode-plugin/plugin.json", import.meta.url),
      "utf8",
    ),
  );
  const definition = OFFICIAL_PLUGIN_DEFINITIONS.find((item) => item.name === manifest.name)!;
  assert.equal(definition.version, manifest.version);
  assert.equal(DEFAULT_ENABLED_OFFICIAL_PLUGIN_IDS.has(VISION_ASSISTANT_PLUGIN_ID), true);
  const plugin = {
    id: VISION_ASSISTANT_PLUGIN_ID,
    name: manifest.name,
    enabled: true,
    rootPath,
    components: [{ kind: "agent", items: [{ name: "vision-reader" }] }],
  };
  assert.equal(resolvePluginRuntimeFeatures({ plugins: [plugin] } as never).visionAssistant, true);
  assert.equal(
    resolvePluginRuntimeFeatures({ plugins: [{ ...plugin, enabled: false }] } as never)
      .visionAssistant,
    undefined,
  );
  const model = { providerId: "test", modelId: "vision", options: { reasoningLevel: "none" } };
  const loaded = loadPluginAgentProfiles({
    plugins: [plugin],
    modelSelectionOverrides: {
      [createPluginAgentStateId(VISION_ASSISTANT_PLUGIN_ID, "vision-reader")]: model,
    },
  } as never);
  const agent = loaded.profiles.find((item) => item.name === "vision-assistant:vision-reader")!;
  assert.deepEqual(agent.modelSelection, model);
  assert.deepEqual(agent.tools, []);
  assert.equal(agent.injectAgentsMd, false);
  assert.equal(loaded.diagnostics.length, 0);
});
