import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPluginAgentStateId, VISION_ASSISTANT_PLUGIN_ID } from "@zcode/shared";
import { createSubagentsService } from "../src/subagents/subagentsService.js";

test("备用视觉模型复用持久化子代理覆盖，不依赖插件启用或发现", async () => {
  const directory = await mkdtemp(join(tmpdir(), "zcode-vision-config-"));
  const agentId = createPluginAgentStateId(VISION_ASSISTANT_PLUGIN_ID, "vision-reader");
  const selection = {
    providerId: "example",
    modelId: "vision",
    options: { reasoningLevel: "none" },
  };
  try {
    const service = createSubagentsService({ homeDir: directory });
    await service.setPluginAgentModelOverride({ agentId, modelSelection: selection });
    assert.deepEqual(await service.getPluginAgentModelOverride({ agentId }), {
      modelSelection: selection,
    });
    const reopened = createSubagentsService({ homeDir: directory });
    assert.deepEqual(await reopened.getPluginAgentModelOverride({ agentId }), {
      modelSelection: selection,
    });
    await reopened.setPluginAgentModelOverride({ agentId });
    assert.deepEqual(await reopened.getPluginAgentModelOverride({ agentId }), {
      modelSelection: undefined,
    });
    await assert.rejects(() => reopened.getPluginAgentModelOverride({ agentId: "invalid" }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
