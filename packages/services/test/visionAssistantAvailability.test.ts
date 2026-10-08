import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "@zcode/rpc";
import { VISION_ASSISTANT_PLUGIN_ID } from "@zcode/shared";
import { listVisionModelCandidates, type ModelSelectionView } from "@zcode/provider";
import { createPluginManagementService } from "../src/plugins/pluginManagementService.js";

function modelView(revision: number, modelIds: string[]): ModelSelectionView {
  return {
    revision,
    providers: [
      {
        providerId: "configured",
        providerName: "Configured",
        config: {},
        models: modelIds.map((modelId) => ({
          modelId,
          config: {
            properties: { inputFormat: { supportsImage: modelId.startsWith("vision") } },
            optionSpecs: { reasoningLevel: { values: ["none"] } },
          },
        })),
      },
    ],
  } as ModelSelectionView;
}

function fixture(
  initial: ModelSelectionView,
  beforeWrite: (input: { enabled: boolean }) => Promise<void> = async () => {},
) {
  let view = initial;
  let enabled = true;
  const changed = new Emitter<ModelSelectionView>();
  const writes: unknown[] = [];
  const plugin = () => ({ id: VISION_ASSISTANT_PLUGIN_ID, enabled });
  const service = createPluginManagementService({
    modelSelectionService: {
      onDidChange: changed.event,
      getView: async () => view,
    },
    zcodeAgentService: {
      listPlugins: async () => ({ plugins: [plugin()], diagnostics: [] }),
      setPluginEnabled: async (input) => {
        writes.push(input);
        await beforeWrite(input);
        enabled = input.enabled;
        return { plugin: plugin(), enabled };
      },
    } as Parameters<typeof createPluginManagementService>[0]["zcodeAgentService"],
  });
  return {
    service,
    writes,
    change: (next: ModelSelectionView) => {
      view = next;
      changed.fire(next);
    },
  };
}

function nextPluginChange(service: ReturnType<typeof createPluginManagementService>) {
  return new Promise<void>((resolve) => {
    const subscription = service.onDidChange(() => {
      subscription.dispose();
      resolve();
    });
  });
}

test(
  "只使用已配置视觉候选，最后一个被移除时由 Host 持久化关闭，新增不自动启用",
  { timeout: 5000 },
  async () => {
    const f = fixture(modelView(1, ["text", "vision-a"]));
    try {
      assert.deepEqual(
        listVisionModelCandidates(modelView(1, ["text", "vision-a"])).map(
          (c) => c.selection.modelId,
        ),
        ["vision-a"],
      );
      f.change(modelView(2, ["text", "vision-a", "vision-b"]));
      assert.equal(f.writes.length, 0);
      f.change(modelView(3, ["text", "vision-b"]));
      assert.equal(f.writes.length, 0);
      const disabled = nextPluginChange(f.service);
      f.change(modelView(4, ["text"]));
      await disabled;
      assert.deepEqual(f.writes, [
        { pluginId: VISION_ASSISTANT_PLUGIN_ID, enabled: false, scope: "user" },
      ]);
      await assert.rejects(() =>
        f.service.setPluginEnabled({
          pluginId: VISION_ASSISTANT_PLUGIN_ID,
          enabled: true,
          scope: "user",
        }),
      );
      f.change(modelView(5, ["vision-c"]));
      assert.equal(
        (await f.service.listPlugins({ configScope: "user" })).plugins[0].enabled,
        false,
      );
      assert.equal(f.writes.length, 1);
      // 旧空视图不能关闭用户在新视图下重新启用的助手。
      await f.service.setPluginEnabled({
        pluginId: VISION_ASSISTANT_PLUGIN_ID,
        enabled: true,
        scope: "user",
      });
      f.change(modelView(4, []));
      assert.equal((await f.service.listPlugins({ configScope: "user" })).plugins[0].enabled, true);
    } finally {
      f.service.disposeAll();
    }
  },
);

test("初始成功读取零候选也会自动关闭", { timeout: 5000 }, async () => {
  const f = fixture(modelView(1, []));
  const disabled = nextPluginChange(f.service);
  try {
    await disabled;
    assert.equal(f.writes.length, 1);
  } finally {
    f.service.disposeAll();
  }
});

test("Host 关闭阻止尚未完成的模型读取触发写入", async () => {
  const f = fixture(modelView(1, []));
  f.service.disposeAll();
  await f.service.listPlugins({ configScope: "user" });
  assert.equal(f.writes.length, 0);
});

test("启用 RPC 途中移除最后一个模型，完成启用后仍会持久化关闭", { timeout: 5000 }, async () => {
  let started!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const f = fixture(modelView(1, ["vision-a"]), async (input) => {
    if (input.enabled) {
      started();
      await gate;
    }
  });
  try {
    await f.service.setPluginEnabled({
      pluginId: VISION_ASSISTANT_PLUGIN_ID,
      enabled: false,
      scope: "user",
    });
    let events = 0;
    const closed = new Promise<void>((resolve) => {
      const subscription = f.service.onDidChange(() => {
        if (++events === 2) {
          subscription.dispose();
          resolve();
        }
      });
    });
    const enabling = f.service.setPluginEnabled({
      pluginId: VISION_ASSISTANT_PLUGIN_ID,
      enabled: true,
      scope: "user",
    });
    await entered;
    f.change(modelView(2, []));
    release();
    await enabling;
    await closed;
    assert.equal((await f.service.listPlugins({ configScope: "user" })).plugins[0].enabled, false);
    assert.equal(f.writes.length, 3);
  } finally {
    release();
    f.service.disposeAll();
  }
});

test("模型初始化错误保留启用状态，不能把读取失败当成零候选", async () => {
  let writes = 0;
  const service = createPluginManagementService({
    modelSelectionService: {
      onDidChange: new Emitter<ModelSelectionView>().event,
      getView: async () => {
        throw new Error("Fixture model read failed");
      },
    },
    zcodeAgentService: {
      listPlugins: async () => ({
        plugins: [{ id: VISION_ASSISTANT_PLUGIN_ID, enabled: true }],
        diagnostics: [],
      }),
      setPluginEnabled: async () => {
        writes++;
        throw new Error("Unexpected write");
      },
    } as Parameters<typeof createPluginManagementService>[0]["zcodeAgentService"],
  });
  try {
    await assert.rejects(() =>
      service.setPluginEnabled({
        pluginId: VISION_ASSISTANT_PLUGIN_ID,
        enabled: true,
        scope: "user",
      }),
    );
    assert.equal((await service.listPlugins({ configScope: "user" })).plugins[0].enabled, true);
    assert.equal(writes, 0);
  } finally {
    service.disposeAll();
  }
});
